// Package search finds offers in the stored-price database.
//
// The model follows ADR-0001: an offer is made of legs, and a leg is a list of flights
// (today always exactly one: a direct leg).
package search

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OfferKind tells a one-way offer from a round-trip offer.
type OfferKind string

// OneWay is the kind of a one-way offer: a single leg.
const OneWay OfferKind = "oneWay"

// Query is what the traveller searches for.
type Query struct {
	HomeAirports []string
	Destination  Destination
	TravelWindow TravelWindow
}

// Destination is where the traveller wants to fly; for now a set of airports.
type Destination struct {
	Airports []string
}

// TravelWindow is the date range the whole offer must fit into. Both days are inclusive.
type TravelWindow struct {
	From, To time.Time
}

// Offer is a single search result with a total price.
type Offer struct {
	Kind     OfferKind
	Outbound Leg
	Price    Price
	// PriceFetchedAt is when the oldest stored price of the offer's flights was fetched.
	PriceFetchedAt time.Time
}

// Leg is one-way travel made of one or more flights.
type Leg struct {
	Flights []Flight
}

// IsDirect reports whether the leg is made of exactly one flight.
func (l Leg) IsDirect() bool { return len(l.Flights) == 1 }

// Flight is a single flight with its stored price.
type Flight struct {
	DepartureAirport string
	ArrivalAirport   string
	Departure        LocalTime
	Arrival          LocalTime
	OriginalPrice    Money
	FetchedAt        time.Time
}

// LocalTime is a wall-clock date and time at an airport, in that airport's time zone.
type LocalTime struct {
	// DateTime holds the wall-clock reading only; its time.Location is meaningless.
	DateTime time.Time
	TimeZone string
}

// Money is an amount in minor units (grosze, cents) of a currency.
type Money struct {
	Amount   int64
	Currency string
}

// Price is an offer price in PLN.
type Price struct {
	Money
	// Approximate is true when any flight was converted from another currency.
	Approximate bool
}

// Searcher runs searches against the stored-price database.
type Searcher struct {
	pool *pgxpool.Pool
}

// NewSearcher returns a Searcher reading from pool.
func NewSearcher(pool *pgxpool.Pool) *Searcher {
	return &Searcher{pool: pool}
}

// OneWay returns one-way offers of direct flights from the home airports to the destination
// within the travel window, cheapest first; equally priced offers go by departure, then by airports.
// Flights in a currency with no exchange rate yet are left out.
func (s *Searcher) OneWay(ctx context.Context, q Query) ([]Offer, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT f.departure_airport, f.arrival_airport,
			f.departure_date + f.departure_time, dep.time_zone,
			f.arrival_date + f.arrival_time, arr.time_zone,
			f.price_amount, f.price_currency, f.fetched_at,
			CASE WHEN f.price_currency = 'PLN' THEN f.price_amount
				ELSE round(f.price_amount * rate.rate)::bigint END AS price_pln
		FROM flights f
		JOIN airports dep ON dep.code = f.departure_airport
		JOIN airports arr ON arr.code = f.arrival_airport
		LEFT JOIN LATERAL (
			SELECT r.rate FROM exchange_rates r
			WHERE r.currency = f.price_currency
			ORDER BY r.rate_date DESC
			LIMIT 1
		) rate ON true
		WHERE f.departure_airport = ANY($1)
			AND f.arrival_airport = ANY($2)
			AND f.departure_date >= $3
			AND f.arrival_date <= $4
			AND f.price_amount IS NOT NULL
			AND (f.price_currency = 'PLN' OR rate.rate IS NOT NULL)
		ORDER BY price_pln, f.departure_date, f.departure_time, f.departure_airport, f.arrival_airport`,
		q.HomeAirports, q.Destination.Airports, q.TravelWindow.From, q.TravelWindow.To)
	if err != nil {
		return nil, fmt.Errorf("query flights: %w", err)
	}
	flights, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (pricedFlight, error) {
		var f pricedFlight
		err := row.Scan(&f.DepartureAirport, &f.ArrivalAirport,
			&f.Departure.DateTime, &f.Departure.TimeZone,
			&f.Arrival.DateTime, &f.Arrival.TimeZone,
			&f.OriginalPrice.Amount, &f.OriginalPrice.Currency, &f.FetchedAt,
			&f.pricePLN)
		return f, err
	})
	if err != nil {
		return nil, fmt.Errorf("read flights: %w", err)
	}

	offers := make([]Offer, 0, len(flights))
	for _, f := range flights {
		offers = append(offers, Offer{
			Kind:     OneWay,
			Outbound: Leg{Flights: []Flight{f.Flight}},
			Price: Price{
				Money:       Money{Amount: f.pricePLN, Currency: "PLN"},
				Approximate: f.OriginalPrice.Currency != "PLN",
			},
			PriceFetchedAt: f.FetchedAt,
		})
	}
	return offers, nil
}

// pricedFlight is a flight with its original price converted into PLN at the exchange rate.
type pricedFlight struct {
	Flight
	pricePLN int64
}
