// Package pricestore stores airport catalogues, exchange rates, flights, and
// route-month refresh records in PostgreSQL.
package pricestore

import (
	"context"
	"fmt"
	"maps"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/airline"
	"github.com/hasia17/gocitybreak/backend/internal/nbp"
	"github.com/hasia17/gocitybreak/backend/internal/pricing"
	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store manages prices, catalogue and refreshes in Postgres.
type Store struct{ pool *pgxpool.Pool }

// New returns a price store using pool.
func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Flight is a flight with local wall-clock times and an optional price.
type Flight struct {
	Airline                          airline.Airline
	DepartureAirport, ArrivalAirport string
	Departure, Arrival               time.Time
	Price                            *ryanair.Money
	FetchedAt                        time.Time
}

// UpsertAirports stores the catalogue, marking Polish airports supported.
func (s *Store) UpsertAirports(ctx context.Context, airports []ryanair.Airport) error {
	b := &pgx.Batch{}
	for _, a := range airports {
		b.Queue(`INSERT INTO airports
    (code, name, time_zone, supported, city_code, city_name, country_code, country_name, names, city_names, country_names)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    time_zone = EXCLUDED.time_zone,
    supported = EXCLUDED.supported,
    city_code = EXCLUDED.city_code,
    city_name = EXCLUDED.city_name,
    country_code = EXCLUDED.country_code,
    country_name = EXCLUDED.country_name,
    names = EXCLUDED.names, city_names = EXCLUDED.city_names, country_names = EXCLUDED.country_names`, a.Code, a.Name, a.TimeZone, a.CountryCode == "pl", a.CityCode, a.CityName, a.CountryCode, a.CountryName,
			englishNames(a.Names, a.Name), englishNames(a.CityNames, a.CityName), englishNames(a.CountryNames, a.CountryName))
	}
	if err := s.pool.SendBatch(ctx, b).Close(); err != nil {
		return fmt.Errorf("store airports: %w", err)
	}
	return nil
}

// UpsertExchangeRates stores NBP rates by currency and date.
func (s *Store) UpsertExchangeRates(ctx context.Context, rates []nbp.Rate) error {
	b := &pgx.Batch{}
	for _, r := range rates {
		b.Queue(`INSERT INTO exchange_rates (currency, rate_date, rate)
VALUES ($1, $2, $3)
ON CONFLICT (currency, rate_date) DO UPDATE SET
    rate = EXCLUDED.rate`, r.Currency, r.Date, r.PLN)
	}
	if err := s.pool.SendBatch(ctx, b).Close(); err != nil {
		return fmt.Errorf("store exchange rates: %w", err)
	}
	return nil
}

func queueFlight(b *pgx.Batch, f Flight) {
	var amount *int64
	var currency *string
	if f.Price != nil {
		amount, currency = &f.Price.Amount, &f.Price.Currency
	}
	b.Queue(`INSERT INTO flights
    (airline, departure_airport, arrival_airport, departure_date, departure_time,
     arrival_date, arrival_time, price_amount, price_currency, fetched_at)
VALUES ($1, $2, $3, $4, $5::text::time, $6, $7::text::time, $8, $9, $10)
ON CONFLICT (airline, departure_airport, arrival_airport, departure_date, departure_time) DO UPDATE SET
    arrival_date = EXCLUDED.arrival_date,
    arrival_time = EXCLUDED.arrival_time,
    price_amount = EXCLUDED.price_amount,
    price_currency = EXCLUDED.price_currency,
    fetched_at = EXCLUDED.fetched_at`, string(f.Airline), f.DepartureAirport, f.ArrivalAirport, dateOf(f.Departure), f.Departure.Format("15:04"), dateOf(f.Arrival), f.Arrival.Format("15:04"), amount, currency, f.FetchedAt)
}

// UpsertFlights stores flights without removing other flights or recording refreshes.
func (s *Store) UpsertFlights(ctx context.Context, flights []Flight) error {
	b := &pgx.Batch{}
	for _, f := range flights {
		queueFlight(b, f)
	}
	if err := s.pool.SendBatch(ctx, b).Close(); err != nil {
		return fmt.Errorf("store flights: %w", err)
	}
	return nil
}

// Flights reads all stored flights in route and departure order. Departure and
// arrival are local wall-clock times represented in UTC, not absolute instants.
func (s *Store) Flights(ctx context.Context) ([]Flight, error) {
	rows, err := s.pool.Query(ctx, `SELECT airline, departure_airport, arrival_airport,
    departure_date + departure_time, arrival_date + arrival_time,
    price_amount, price_currency, fetched_at
FROM flights
ORDER BY departure_airport, arrival_airport, departure_date, departure_time, airline`)
	if err != nil {
		return nil, fmt.Errorf("read flights: %w", err)
	}
	defer rows.Close()

	var flights []Flight
	for rows.Next() {
		var f Flight
		var amount *int64
		var currency *string
		if err := rows.Scan(&f.Airline, &f.DepartureAirport, &f.ArrivalAirport, &f.Departure, &f.Arrival, &amount, &currency, &f.FetchedAt); err != nil {
			return nil, fmt.Errorf("read flights: %w", err)
		}
		if amount != nil && currency != nil {
			f.Price = &ryanair.Money{Amount: *amount, Currency: *currency}
		}
		f.FetchedAt = f.FetchedAt.UTC()
		flights = append(flights, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read flights: %w", err)
	}
	return flights, nil
}

// ReplaceRouteMonth upserts airline a's flights for the route from → to and records fetchedAt
// as a's refresh time for month, in one transaction. from and to are airport
// codes; month is the first day of the month, and first and last are the
// inclusive departure-date bounds of the fetched timetable. The caller must
// supply consistent route, month, bounds, and flights; these are not validated.
//
// Flight departure and arrival values are local wall-clock times at their
// respective airports, not instants to convert between time zones. Their date
// and hour/minute fields are stored; seconds and smaller units are discarded.
// fetchedAt is an instant. Date arguments are passed to PostgreSQL as dates.
//
// When complete is true, stored flights on this route within first and last
// whose departure date and minute are absent from flights are deleted; an empty
// complete timetable deletes all flights in that range. When false, no flights
// are deleted. Flights outside the bounds are still upserted if supplied.
// The refresh is recorded even for an incomplete or empty timetable. Database
// and context errors are returned; batch errors are wrapped with route context.
// A transaction or commit error is returned by pgx; a commit error can leave
// the outcome unknown.
func (s *Store) ReplaceRouteMonth(ctx context.Context, a airline.Airline, from, to string, month, first, last, fetchedAt time.Time, flights []pricing.Flight, complete bool) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		b := &pgx.Batch{}
		var dates, times []string
		for _, f := range flights {
			queueFlight(b, Flight{Airline: a, DepartureAirport: from, ArrivalAirport: to, Departure: f.Departure, Arrival: f.Arrival, Price: f.Price, FetchedAt: fetchedAt})
			dates = append(dates, f.Departure.Format(time.DateOnly))
			times = append(times, f.Departure.Format("15:04"))
		}
		if complete {
			b.Queue(`DELETE FROM flights
WHERE airline = $1
  AND departure_airport = $2
  AND arrival_airport = $3
  AND departure_date BETWEEN $4 AND $5
  AND (departure_date, departure_time) NOT IN (
      SELECT d, t
      FROM unnest($6::text[]::date[], $7::text[]::time[]) AS fetched (d, t)
  )`, string(a), from, to, first, last, dates, times)
		}
		b.Queue(`INSERT INTO route_month_refreshes
    (airline, departure_airport, arrival_airport, month, refreshed_at)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (airline, departure_airport, arrival_airport, month) DO UPDATE SET
    refreshed_at = EXCLUDED.refreshed_at`, string(a), from, to, month, fetchedAt)
		if err := tx.SendBatch(ctx, b).Close(); err != nil {
			return fmt.Errorf("store flights %s→%s: %w", from, to, err)
		}
		return nil
	})
}

// ForgetRefreshesBefore removes refresh records for past months.
func (s *Store) ForgetRefreshesBefore(ctx context.Context, month time.Time) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM route_month_refreshes
WHERE month < $1`, month); err != nil {
		return fmt.Errorf("forget past refreshes: %w", err)
	}
	return nil
}
func dateOf(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// englishNames preserves the original English name for callers supplying the older catalogue shape.
func englishNames(names map[string]string, name string) map[string]string {
	result := maps.Clone(names)
	if result == nil {
		result = map[string]string{}
	}
	if name != "" && result["en"] == "" {
		result["en"] = name
	}
	return result
}
