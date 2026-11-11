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

const (
	// RoundTrip is the kind of a round-trip offer: an outbound and an inbound leg.
	RoundTrip OfferKind = "roundTrip"
	// OneWay is the kind of a one-way offer: a single leg.
	OneWay OfferKind = "oneWay"
)

// Query is what the traveller searches for.
type Query struct {
	Kind         OfferKind
	HomeAirports []string
	Destination  Destination
	TravelWindow TravelWindow
	// StayLength applies to round-trip offers only.
	StayLength StayLength
	Filters    Filters
	// Sort is ByPrice when empty.
	Sort SortOrder
}

// Destination is where the traveller wants to fly; for now a set of airports.
type Destination struct {
	Airports []string
}

// TravelWindow is the date range the whole offer must fit into. Both days are inclusive.
type TravelWindow struct {
	From, To time.Time
}

// StayLength is the range of nights of a round-trip offer, both ends inclusive.
type StayLength struct {
	Min, Max int
}

// Offer is a single search result with a total price.
type Offer struct {
	Kind     OfferKind
	Outbound Leg
	// Inbound is nil for a one-way offer.
	Inbound *Leg
	// Nights is the number of hotel nights of a round-trip offer (GLOSSARY: Night); 0 for a one-way offer.
	Nights int
	Price  Price
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

// Search returns offers of q's kind made of direct flights that pass q's filters, in q's sort order.
// Flights in a currency with no exchange rate yet are left out.
func (s *Searcher) Search(ctx context.Context, q Query) ([]Offer, error) {
	var offers []Offer
	var err error
	switch q.Kind {
	case RoundTrip:
		offers, err = s.roundTrip(ctx, q)
	case OneWay:
		offers, err = s.oneWay(ctx, q)
	default:
		return nil, fmt.Errorf("unknown kind of offer %q", q.Kind)
	}
	if err != nil {
		return nil, err
	}
	offers = q.Filters.apply(offers)
	q.Sort.apply(offers)
	return offers, nil
}

// pricedFlights is a common table expression of the flights that have a price in PLN:
// each flight's original price converted at the latest exchange rate (ADR-0006),
// rounded to minor units.
const pricedFlights = `
	priced AS NOT MATERIALIZED (
		SELECT f.departure_airport, f.arrival_airport,
			f.departure_date, f.departure_time, dep.time_zone AS departure_time_zone,
			f.arrival_date, f.arrival_time, arr.time_zone AS arrival_time_zone,
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
		WHERE f.price_amount IS NOT NULL
			AND (f.price_currency = 'PLN' OR rate.rate IS NOT NULL)
	)`

// flightColumns selects a row of pricedFlights under alias in the order pricedFlight.scanTargets expects.
func flightColumns(alias string) string {
	return fmt.Sprintf(`%[1]s.departure_airport, %[1]s.arrival_airport,
		%[1]s.departure_date + %[1]s.departure_time, %[1]s.departure_time_zone,
		%[1]s.arrival_date + %[1]s.arrival_time, %[1]s.arrival_time_zone,
		%[1]s.price_amount, %[1]s.price_currency, %[1]s.fetched_at, %[1]s.price_pln`, alias)
}

// oneWay returns one-way offers from the home airports to the destination within the travel window;
// equally priced offers go by departure, then by airports.
func (s *Searcher) oneWay(ctx context.Context, q Query) ([]Offer, error) {
	rows, err := s.pool.Query(ctx, `WITH`+pricedFlights+`
		SELECT `+flightColumns("o")+`
		FROM priced o
		WHERE o.departure_airport = ANY($1)
			AND o.arrival_airport = ANY($2)
			AND o.departure_date >= $3
			AND o.arrival_date <= $4
		ORDER BY o.price_pln, o.departure_date, o.departure_time, o.departure_airport, o.arrival_airport`,
		q.HomeAirports, q.Destination.Airports, q.TravelWindow.From, q.TravelWindow.To)
	if err != nil {
		return nil, fmt.Errorf("query flights: %w", err)
	}
	offers, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Offer, error) {
		var out pricedFlight
		if err := row.Scan(out.scanTargets()...); err != nil {
			return Offer{}, err
		}
		price, fetchedAt := offerPrice(out)
		return Offer{
			Kind:           OneWay,
			Outbound:       Leg{Flights: []Flight{out.Flight}},
			Price:          price,
			PriceFetchedAt: fetchedAt,
		}, nil
	})
	if err != nil {
		return nil, fmt.Errorf("read flights: %w", err)
	}
	return offers, nil
}

// roundTrip pairs an outbound flight from a home airport to the destination with an inbound flight
// from the same destination airport back to any home airport. The pair fits within the travel window
// (outbound departure on its first day at the earliest, inbound arrival on its last day at the latest)
// and its nights within the stay length. Equally priced offers go by outbound departure,
// then inbound departure, then airports.
func (s *Searcher) roundTrip(ctx context.Context, q Query) ([]Offer, error) {
	rows, err := s.pool.Query(ctx, `WITH`+pricedFlights+`
		SELECT `+flightColumns("o")+`, `+flightColumns("i")+`, n.nights
		FROM priced o
		JOIN priced i ON i.departure_airport = o.arrival_airport
		-- A hotel night is counted from the outbound arrival date, or the day before
		-- when the outbound flight lands before 06:00 local time, up to the inbound departure date.
		CROSS JOIN LATERAL (
			SELECT i.departure_date - (o.arrival_date - (o.arrival_time < '06:00')::int) AS nights
		) n
		WHERE o.departure_airport = ANY($1)
			AND o.arrival_airport = ANY($2)
			AND i.arrival_airport = ANY($1)
			AND o.departure_date >= $3
			AND i.arrival_date <= $4
			-- Both times are local at the destination airport.
			AND i.departure_date + i.departure_time > o.arrival_date + o.arrival_time
			AND n.nights BETWEEN $5 AND $6
		ORDER BY o.price_pln + i.price_pln,
			o.departure_date, o.departure_time, i.departure_date, i.departure_time,
			o.departure_airport, o.arrival_airport, i.arrival_airport`,
		q.HomeAirports, q.Destination.Airports, q.TravelWindow.From, q.TravelWindow.To,
		q.StayLength.Min, q.StayLength.Max)
	if err != nil {
		return nil, fmt.Errorf("query flight pairs: %w", err)
	}
	offers, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Offer, error) {
		var out, in pricedFlight
		var nights int
		if err := row.Scan(append(append(out.scanTargets(), in.scanTargets()...), &nights)...); err != nil {
			return Offer{}, err
		}
		price, fetchedAt := offerPrice(out, in)
		return Offer{
			Kind:           RoundTrip,
			Outbound:       Leg{Flights: []Flight{out.Flight}},
			Inbound:        &Leg{Flights: []Flight{in.Flight}},
			Nights:         nights,
			Price:          price,
			PriceFetchedAt: fetchedAt,
		}, nil
	})
	if err != nil {
		return nil, fmt.Errorf("read flight pairs: %w", err)
	}
	return offers, nil
}

// pricedFlight is a flight with its original price converted into PLN at the exchange rate.
type pricedFlight struct {
	Flight
	pricePLN int64
}

// scanTargets returns pointers for a row selected by flightColumns.
func (f *pricedFlight) scanTargets() []any {
	return []any{&f.DepartureAirport, &f.ArrivalAirport,
		&f.Departure.DateTime, &f.Departure.TimeZone,
		&f.Arrival.DateTime, &f.Arrival.TimeZone,
		&f.OriginalPrice.Amount, &f.OriginalPrice.Currency, &f.FetchedAt,
		&f.pricePLN}
}

// offerPrice sums the flights' prices in PLN, approximate when any flight is priced in another currency,
// and returns it with the fetch time of the oldest stored price.
func offerPrice(flights ...pricedFlight) (Price, time.Time) {
	price := Price{Money: Money{Currency: "PLN"}}
	var oldest time.Time
	for _, f := range flights {
		price.Amount += f.pricePLN
		if f.OriginalPrice.Currency != "PLN" {
			price.Approximate = true
		}
		if oldest.IsZero() || f.FetchedAt.Before(oldest) {
			oldest = f.FetchedAt
		}
	}
	return price, oldest
}
