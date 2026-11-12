// Package search finds offers in the stored-price database.
//
// The model follows ADR-0001: an offer is made of legs, and a leg is a list of flights
// (today always exactly one: a direct leg).
package search

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hasia17/gocitybreak/backend/internal/catalogue"
	"github.com/hasia17/gocitybreak/backend/internal/leave"
)

// OfferKind tells a one-way offer from a round-trip offer.
type OfferKind string

const (
	// RoundTrip is the kind of a round-trip offer: an outbound and an inbound leg.
	RoundTrip OfferKind = "roundTrip"
	// OneWay is the kind of a one-way offer: a single leg.
	OneWay OfferKind = "oneWay"
)

// IsRoundTrip reports whether a query of kind k searches for round-trip offers;
// an empty kind does, round trip being the default kind of offer.
func (k OfferKind) IsRoundTrip() bool {
	return k == "" || k == RoundTrip
}

// Query is what the traveller searches for.
type Query struct {
	// Kind is the kind of offer searched for; an empty Kind is a round trip, the default kind of offer.
	Kind         OfferKind
	HomeAirports []string
	Destination  Destination
	// TravelWindow selects flexible dates; its zero value is absent when FixedDates is set.
	TravelWindow TravelWindow
	// FixedDates selects exact local departure dates instead of a travel window and stay length.
	FixedDates *FixedDates
	// StayLength is required for a flexible round trip and absent with FixedDates.
	StayLength *StayLength
	// WorkStart and WorkEnd are offsets from midnight in the home airport's local time,
	// from which the leave days of round-trip offers are counted. Nil means the default work
	// hours, 09:00–17:00; an explicit 00:00 is a set work start, not an unset one.
	WorkStart, WorkEnd *time.Duration
	Filters            Filters
	// Sort is the order of the offers; by price when unset.
	Sort SortOrder
}

// SortOrder is the order in which offers are returned.
type SortOrder string

const (
	// ByPrice sorts offers by ascending offer price.
	ByPrice SortOrder = "price"
	// ByLeaveDays sorts round-trip offers by ascending leave days, then by price.
	ByLeaveDays SortOrder = "leaveDays"
)

// Destination is where the traveller wants to fly: any number of airports, cities and countries,
// or anywhere, minus the exclusions.
type Destination struct {
	catalogue.Codes
	// Anywhere covers all airports reachable from the home airports; the codes are then ignored.
	Anywhere bool
	// Exclusions are airports, cities and countries removed from the destination.
	Exclusions catalogue.Codes
}

// TravelWindow is the date range the whole offer must fit into. Both days are inclusive.
type TravelWindow struct {
	From, To time.Time
}

// FixedDates names each leg's local departure date; Inbound is unused for a one-way offer.
type FixedDates struct {
	Outbound, Inbound time.Time
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
	// LeaveDays is the number of leave days of a round-trip offer (GLOSSARY: Leave days); 0 for a one-way offer.
	LeaveDays int
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

// QueryError reports a query that breaks a rule of the search; its message is meant for the traveller.
type QueryError struct {
	Reason string
}

func (e *QueryError) Error() string { return e.Reason }

// Search returns offers of q's kind made of direct flights that pass q's filters, in q's sort order.
// Flights in a currency with no exchange rate yet are left out. Every rule of q and every default
// of the search live here: a query that breaks a rule returns a *QueryError before any stored data
// is read, an empty kind is a round trip, and work hours left unset become the default work hours.
func (s *Searcher) Search(ctx context.Context, q Query) ([]Offer, error) {
	q = q.withDefaults()
	if err := q.validate(); err != nil {
		return nil, err
	}
	c, err := catalogue.Load(ctx, s.pool)
	if err != nil {
		return nil, fmt.Errorf("load airport catalogue: %w", err)
	}
	// GLOSSARY: Home airports are chosen among the supported airports only.
	for _, code := range q.HomeAirports {
		if !c.IsSupported(code) {
			return nil, &QueryError{fmt.Sprintf("home airport %q is not a supported airport", code)}
		}
	}
	destination := q.Destination.airports(c)
	var offers []Offer
	if q.Kind == RoundTrip {
		offers, err = s.roundTrip(ctx, q, destination)
	} else {
		offers, err = s.oneWay(ctx, q, destination)
	}
	if err != nil {
		return nil, err
	}
	offers = q.Filters.apply(offers)
	q.Sort.apply(offers)
	return offers, nil
}

// The work hours a query's leave days are counted from when it sets none.
const (
	defaultWorkStart = 9 * time.Hour
	defaultWorkEnd   = 17 * time.Hour
)

// withDefaults returns q with its defaults applied: an empty kind is a round trip (see IsRoundTrip),
// and work hours left unset become the default work hours.
func (q Query) withDefaults() Query {
	if q.Kind.IsRoundTrip() {
		q.Kind = RoundTrip
	}
	if q.WorkStart == nil {
		q.WorkStart = new(defaultWorkStart)
	}
	if q.WorkEnd == nil {
		q.WorkEnd = new(defaultWorkEnd)
	}
	return q
}

// validate checks the rules of a query that need no stored data, on a query with its defaults
// applied; each rule it breaks is reported as a *QueryError.
func (q Query) validate() error {
	switch q.Kind {
	case RoundTrip, OneWay:
	default:
		return &QueryError{fmt.Sprintf("kind must be %q or %q", RoundTrip, OneWay)}
	}
	switch q.Sort {
	case "", ByPrice:
	case ByLeaveDays:
		// One-way offers have no leave days.
		if q.Kind != RoundTrip {
			return &QueryError{fmt.Sprintf("sort %q applies to round trips only", q.Sort)}
		}
	default:
		return &QueryError{fmt.Sprintf("sort must be %q or %q", ByPrice, ByLeaveDays)}
	}
	if len(q.HomeAirports) == 0 {
		return &QueryError{"homeAirports must not be empty"}
	}
	if !q.Destination.Anywhere && q.Destination.IsEmpty() {
		return &QueryError{"destination must name airports, cities or countries, or be anywhere"}
	}
	hasWindow := q.TravelWindow != (TravelWindow{})
	if hasWindow == (q.FixedDates != nil) {
		return &QueryError{"exactly one of travelWindow or fixedDates is required"}
	}
	if q.FixedDates != nil {
		if q.FixedDates.Outbound.IsZero() {
			return &QueryError{"fixedDates.outbound is required"}
		}
		if q.Kind == RoundTrip {
			if q.FixedDates.Inbound.IsZero() {
				return &QueryError{"fixedDates.inbound is required for a round trip"}
			}
			if q.FixedDates.Inbound.Before(q.FixedDates.Outbound) {
				return &QueryError{"fixedDates.inbound must not be before fixedDates.outbound"}
			}
		}
		if q.StayLength != nil {
			return &QueryError{"stayLength must be absent with fixedDates"}
		}
	}
	if q.TravelWindow.To.Before(q.TravelWindow.From) {
		return &QueryError{"travelWindow.to must not be before travelWindow.from"}
	}
	// A stay length is a round-trip matter only.
	if q.Kind == RoundTrip && q.FixedDates == nil {
		if q.StayLength == nil {
			return &QueryError{"stayLength is required for a round trip"}
		}
		if q.StayLength.Min < 0 {
			return &QueryError{"stayLength.min must not be negative"}
		}
		if q.StayLength.Max < q.StayLength.Min {
			return &QueryError{"stayLength.max must not be less than stayLength.min"}
		}
	}
	if q.Filters.MaxLeaveDays != nil && *q.Filters.MaxLeaveDays < 0 {
		return &QueryError{"maxLeaveDays must not be negative"}
	}
	return nil
}

// airports expands d into the codes of its airports in c: a city into every airport of the city,
// a country into every airport of the country, anywhere into every airport we know; then removes the exclusions.
func (d Destination) airports(c *catalogue.Catalogue) []string {
	var airports []string
	if d.Anywhere {
		airports = c.AirportCodes()
	} else {
		airports = c.AirportsIn(d.Codes)
	}
	excluded := c.AirportsIn(d.Exclusions)
	return slices.DeleteFunc(airports, func(a string) bool { return slices.Contains(excluded, a) })
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

// oneWay returns one-way offers within the travel window or on the fixed departure date;
// equally priced offers go by departure, then by airports.
func (s *Searcher) oneWay(ctx context.Context, q Query, destination []string) ([]Offer, error) {
	from, to := q.TravelWindow.From, q.TravelWindow.To
	if q.FixedDates != nil {
		from, to = q.FixedDates.Outbound, q.FixedDates.Outbound
	}
	rows, err := s.pool.Query(ctx, `WITH`+pricedFlights+`
		SELECT `+flightColumns("o")+`
		FROM priced o
		WHERE o.departure_airport = ANY($1)
			AND o.arrival_airport = ANY($2)
			AND (($5::boolean AND o.departure_date = $3)
				OR (NOT $5 AND o.departure_date >= $3 AND o.arrival_date <= $4))
		ORDER BY o.price_pln, o.departure_date, o.departure_time, o.departure_airport, o.arrival_airport`,
		q.HomeAirports, destination, from, to, q.FixedDates != nil)
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

// roundTrip pairs an outbound flight from a home airport to a destination airport with an inbound flight
// from the same destination airport back to any home airport. The pair fits within the travel window
// (outbound departure on its first day at the earliest, inbound arrival on its last day at the latest)
// and its nights within the stay length; fixed dates match departures instead, without a nights limit.
// Equally priced offers go by outbound departure,
// then inbound departure, then airports.
func (s *Searcher) roundTrip(ctx context.Context, q Query, destination []string) ([]Offer, error) {
	from, to := q.TravelWindow.From, q.TravelWindow.To
	var stay StayLength
	if q.FixedDates != nil {
		from, to = q.FixedDates.Outbound, q.FixedDates.Inbound
	} else {
		stay = *q.StayLength
	}
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
			AND (($7::boolean AND o.departure_date = $3 AND i.departure_date = $4)
				OR (NOT $7 AND o.departure_date >= $3 AND i.arrival_date <= $4
					AND n.nights BETWEEN $5 AND $6))
			-- Both times are local at the destination airport.
			AND i.departure_date + i.departure_time > o.arrival_date + o.arrival_time
		ORDER BY o.price_pln + i.price_pln,
			o.departure_date, o.departure_time, i.departure_date, i.departure_time,
			o.departure_airport, o.arrival_airport, i.arrival_airport`,
		q.HomeAirports, destination, from, to, stay.Min, stay.Max, q.FixedDates != nil)
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
		// The outbound flight departs from a home airport and the inbound flight lands at one,
		// so both times are in a home airport's local time.
		leaveDays := leave.Days(out.Departure.DateTime, in.Arrival.DateTime, *q.WorkStart, *q.WorkEnd)
		return Offer{
			Kind:           RoundTrip,
			Outbound:       Leg{Flights: []Flight{out.Flight}},
			Inbound:        &Leg{Flights: []Flight{in.Flight}},
			Nights:         nights,
			Price:          price,
			PriceFetchedAt: fetchedAt,
			LeaveDays:      leaveDays,
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
