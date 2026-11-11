// Package worker is the price worker (ADR-0002): it fills our database with Ryanair's airport catalogue,
// the stored prices of every flight to and from the supported airports (ADR-0005), and NBP exchange rates (ADR-0006).
//
// It runs as its own process, so whatever goes wrong here, search keeps answering from the last stored prices.
package worker

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hasia17/gocitybreak/backend/internal/nbp"
	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
)

// supportedCountry is the country whose Ryanair airports are supported airports.
const supportedCountry = "pl"

// Config is what the worker works with.
type Config struct {
	Pool    *pgxpool.Pool
	Ryanair ryanair.Client
	NBP     *nbp.Client
	// Horizon is how far ahead prices are fetched (default 6 months).
	Horizon time.Duration
	// Freshness says how often prices are refetched, by how soon the flights depart (default DefaultFreshness).
	Freshness Freshness
	// Now tells the time (default time.Now); tests pin it.
	Now func() time.Time
}

// Worker fetches prices and rates into the database.
type Worker struct {
	pool      *pgxpool.Pool
	ryanair   ryanair.Client
	nbp       *nbp.Client
	horizon   time.Duration
	freshness Freshness
	now       func() time.Time
}

// Freshness is a list of tiers, nearest first: route-months whose flights start departing sooner than a tier's
// DepartsWithin get refetched once their stored prices are older than its MaxAge. The last tier covers the rest.
type Freshness []Tier

// Tier is one step of Freshness.
type Tier struct {
	DepartsWithin time.Duration
	MaxAge        time.Duration
}

const day = 24 * time.Hour

// DefaultFreshness refetches the next four weeks twice a day, the next three months every other day,
// and the rest of the horizon weekly: roughly 0.7 full refreshes' worth of requests a day.
var DefaultFreshness = Freshness{
	{DepartsWithin: 28 * day, MaxAge: 12 * time.Hour},
	{DepartsWithin: 91 * day, MaxAge: 2 * day},
	{MaxAge: 7 * day},
}

// maxAge is how old the stored prices of flights that start departing in untilDeparture may get.
func (f Freshness) maxAge(untilDeparture time.Duration) time.Duration {
	for _, t := range f[:len(f)-1] {
		if untilDeparture < t.DepartsWithin {
			return t.MaxAge
		}
	}
	return f[len(f)-1].MaxAge
}

// New returns a Worker for cfg.
func New(cfg Config) *Worker {
	w := &Worker{pool: cfg.Pool, ryanair: cfg.Ryanair, nbp: cfg.NBP,
		horizon: cfg.Horizon, freshness: cfg.Freshness, now: cfg.Now}
	if w.horizon <= 0 {
		w.horizon = 183 * day
	}
	if len(w.freshness) == 0 {
		w.freshness = DefaultFreshness
	}
	if w.now == nil {
		w.now = time.Now
	}
	return w
}

// Schedule says how often the worker refreshes.
type Schedule struct {
	// PricePause is the pause between the end of one price refresh and the start of the next, which picks up
	// whatever has become due in the meantime (see Freshness).
	PricePause time.Duration
	// RatesInterval is how often exchange rates are fetched; RatesRetry is how soon a failed fetch is retried.
	RatesInterval, RatesRetry time.Duration
}

// Run refreshes exchange rates and prices on schedule until ctx is cancelled.
// Failures are logged and retried on the next round; they never stop the worker.
func (w *Worker) Run(ctx context.Context, s Schedule) {
	go func() {
		for {
			wait := s.RatesInterval
			if err := w.RefreshExchangeRates(ctx); err != nil {
				slog.ErrorContext(ctx, "exchange rate refresh failed", "err", err)
				wait = s.RatesRetry
			}
			if !sleep(ctx, wait) {
				return
			}
		}
	}()
	for {
		start := time.Now()
		if err := w.RefreshCatalogue(ctx); err != nil {
			slog.ErrorContext(ctx, "catalogue refresh failed", "err", err)
		}
		if err := w.RefreshPrices(ctx); err != nil {
			slog.ErrorContext(ctx, "price refresh incomplete", "err", err)
		}
		slog.InfoContext(ctx, "price refresh finished", "took", time.Since(start).Round(time.Second))
		if !sleep(ctx, s.PricePause) {
			return
		}
	}
}

// sleep waits for d and reports whether ctx is still alive.
func sleep(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}

// RefreshCatalogue stores Ryanair's airports with their city and country; the Polish ones become supported airports.
func (w *Worker) RefreshCatalogue(ctx context.Context) error {
	airports, err := w.ryanair.Airports(ctx)
	if err != nil {
		return err
	}
	batch := &pgx.Batch{}
	for _, a := range airports {
		batch.Queue(`
			INSERT INTO airports (code, name, time_zone, supported, city_code, city_name, country_code, country_name)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (code) DO UPDATE SET
				name = EXCLUDED.name, time_zone = EXCLUDED.time_zone, supported = EXCLUDED.supported,
				city_code = EXCLUDED.city_code, city_name = EXCLUDED.city_name,
				country_code = EXCLUDED.country_code, country_name = EXCLUDED.country_name`,
			a.Code, a.Name, a.TimeZone, a.CountryCode == supportedCountry,
			a.CityCode, a.CityName, a.CountryCode, a.CountryName)
	}
	if err := w.pool.SendBatch(ctx, batch).Close(); err != nil {
		return fmt.Errorf("store airports: %w", err)
	}
	slog.InfoContext(ctx, "catalogue stored", "airports", len(airports))
	return nil
}

// RefreshExchangeRates stores the latest NBP tables A and B; a table that fails doesn't stop the other.
func (w *Worker) RefreshExchangeRates(ctx context.Context) error {
	var failures []error
	for _, table := range nbp.Tables {
		if err := w.refreshExchangeRateTable(ctx, table); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func (w *Worker) refreshExchangeRateTable(ctx context.Context, table string) error {
	rates, err := w.nbp.LatestTable(ctx, table)
	if err != nil {
		return err
	}
	batch := &pgx.Batch{}
	for _, r := range rates {
		batch.Queue(`
			INSERT INTO exchange_rates (currency, rate_date, rate) VALUES ($1, $2, $3)
			ON CONFLICT (currency, rate_date) DO UPDATE SET rate = EXCLUDED.rate`,
			r.Currency, r.Date, r.PLN)
	}
	if err := w.pool.SendBatch(ctx, batch).Close(); err != nil {
		return fmt.Errorf("store NBP table %s: %w", table, err)
	}
	slog.InfoContext(ctx, "exchange rates stored", "table", table, "rates", len(rates))
	return nil
}

// route is one direction between two airports.
type route struct{ from, to string }

// routeMonth is the part of a route's month inside the horizon: flights departing from first to last.
type routeMonth struct {
	route       route
	month       time.Time // the first day of the month
	first, last time.Time
}

// RefreshPrices fetches every flight on every route from and to the supported airports whose stored prices are due
// for a refresh (see Freshness), nearest months first. A route-month that fails keeps its previously stored prices
// and stays due for the next refresh; the returned error lists the failures.
func (w *Worker) RefreshPrices(ctx context.Context) error {
	routes, err := w.routes(ctx)
	if err != nil {
		return err
	}
	due, err := w.due(ctx, routes)
	if err != nil {
		return err
	}

	var failures []error
	for _, rm := range due {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := w.refreshRouteMonth(ctx, rm); err != nil {
			slog.WarnContext(ctx, "route refresh failed", "from", rm.route.from, "to", rm.route.to,
				"month", rm.month.Format("2006-01"), "err", err)
			failures = append(failures, err)
		}
	}
	slog.InfoContext(ctx, "prices refreshed", "routes", len(routes), "routeMonths", len(due), "failures", len(failures))
	if len(failures) > 0 {
		return fmt.Errorf("%d route-months failed: %w", len(failures), errors.Join(failures...))
	}
	return nil
}

// due lists the route-months within the horizon whose stored prices are missing or too old, nearest first.
func (w *Worker) due(ctx context.Context, routes []route) ([]routeMonth, error) {
	now := w.now()
	today, last := dateOf(now), dateOf(now.Add(w.horizon))

	// Refreshes of past months only take up space.
	if _, err := w.pool.Exec(ctx, `DELETE FROM route_month_refreshes WHERE month < $1`, firstOfMonth(today)); err != nil {
		return nil, fmt.Errorf("forget past refreshes: %w", err)
	}
	type key struct {
		route route
		month time.Time
	}
	refreshed := map[key]time.Time{}
	rows, err := w.pool.Query(ctx, `SELECT departure_airport, arrival_airport, month, refreshed_at FROM route_month_refreshes`)
	if err != nil {
		return nil, fmt.Errorf("read refreshes: %w", err)
	}
	var k key
	var at time.Time
	if _, err := pgx.ForEachRow(rows, []any{&k.route.from, &k.route.to, &k.month, &at}, func() error {
		refreshed[k] = at
		return nil
	}); err != nil {
		return nil, fmt.Errorf("read refreshes: %w", err)
	}

	var due []routeMonth
	for month := firstOfMonth(today); !month.After(last); month = month.AddDate(0, 1, 0) {
		first, lastDay := maxDate(month, today), minDate(month.AddDate(0, 1, -1), last)
		maxAge := w.freshness.maxAge(first.Sub(today))
		for _, r := range routes {
			at, ok := refreshed[key{r, month}]
			if !ok || now.Sub(at) >= maxAge {
				due = append(due, routeMonth{route: r, month: month, first: first, last: lastDay})
			}
		}
	}
	return due, nil
}

// routes lists both directions of every Ryanair route touching a supported airport, sorted.
func (w *Worker) routes(ctx context.Context) ([]route, error) {
	rows, err := w.pool.Query(ctx, `SELECT code FROM airports ORDER BY code`)
	if err != nil {
		return nil, fmt.Errorf("read airports: %w", err)
	}
	known, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("read airports: %w", err)
	}
	rows, err = w.pool.Query(ctx, `SELECT code FROM airports WHERE supported ORDER BY code`)
	if err != nil {
		return nil, fmt.Errorf("read supported airports: %w", err)
	}
	supported, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("read supported airports: %w", err)
	}

	seen := map[route]bool{}
	for _, home := range supported {
		destinations, err := w.ryanair.Routes(ctx, home)
		if err != nil {
			slog.WarnContext(ctx, "routes unavailable", "airport", home, "err", err)
			continue
		}
		for _, d := range destinations {
			if !slices.Contains(known, d) {
				slog.WarnContext(ctx, "route to an airport missing from the catalogue", "from", home, "to", d)
				continue
			}
			seen[route{home, d}] = true
			seen[route{d, home}] = true
		}
	}
	routes := make([]route, 0, len(seen))
	for r := range seen {
		routes = append(routes, r)
	}
	slices.SortFunc(routes, func(a, b route) int {
		return cmp.Or(cmp.Compare(a.from, b.from), cmp.Compare(a.to, b.to))
	})
	return routes, nil
}

// flight is a flight about to be stored; Price is nil when it couldn't be priced (ADR-0005 fallback).
type flight struct {
	departure, arrival time.Time // local wall-clock times
	price              *ryanair.Money
}

// refreshRouteMonth prices every flight of rm and stores them, per ADR-0005: the cheapest flight of each day
// from cheapestPerDay, the others from a time-window fare query.
func (w *Worker) refreshRouteMonth(ctx context.Context, rm routeMonth) error {
	r, month, from, to := rm.route, rm.month, rm.first, rm.last
	cheapest, err := w.ryanair.CheapestPerDay(ctx, r.from, r.to, month)
	if err != nil {
		return err
	}
	cheapestByDay := map[time.Time]*ryanair.Fare{}
	for _, d := range cheapest {
		cheapestByDay[d.Day] = d.Fare
	}

	// Without the timetable we know only the cheapest flight of each day; store those and keep the rest as they are.
	complete := true
	timetable, err := w.ryanair.Timetable(ctx, r.from, r.to, month)
	if err != nil {
		slog.WarnContext(ctx, "timetable unavailable, storing the cheapest flights only",
			"from", r.from, "to", r.to, "month", month.Format("2006-01"), "err", err)
		complete = false
	}

	var flights []flight
	for _, s := range timetable {
		if s.Date.Before(from) || s.Date.After(to) {
			continue
		}
		departure, arrival, err := scheduledTimes(s)
		if err != nil {
			return err
		}
		f := flight{departure: departure, arrival: arrival}
		switch c, ok := cheapestByDay[s.Date]; {
		case ok && c == nil:
			// Nothing on sale that day: no point asking about the other flights.
		case ok && c.Departure.Equal(departure):
			f.arrival, f.price = c.Arrival, &c.Price
		default:
			fare, err := w.ryanair.FareAt(ctx, r.from, r.to, departure)
			if err != nil {
				slog.WarnContext(ctx, "time-window pricing failed, storing the flight without a price",
					"from", r.from, "to", r.to, "departure", departure.Format(time.DateTime), "err", err)
			} else if fare != nil {
				f.arrival, f.price = fare.Arrival, &fare.Price
			}
		}
		flights = append(flights, f)
	}
	// A cheapest flight missing from the timetable is still a flight.
	for _, c := range cheapest {
		if c.Fare != nil && !c.Day.Before(from) && !c.Day.After(to) &&
			!slices.ContainsFunc(flights, func(f flight) bool { return f.departure.Equal(c.Fare.Departure) }) {
			flights = append(flights, flight{departure: c.Fare.Departure, arrival: c.Fare.Arrival, price: &c.Fare.Price})
		}
	}
	return w.store(ctx, rm, flights, complete)
}

// scheduledTimes turns a timetable entry into local departure and arrival times;
// an arrival earlier in the day than the departure lands the next day.
func scheduledTimes(s ryanair.ScheduledFlight) (departure, arrival time.Time, err error) {
	dep, err := time.Parse("15:04", s.DepartureTime)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("timetable: bad departure time %q", s.DepartureTime)
	}
	arr, err := time.Parse("15:04", s.ArrivalTime)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("timetable: bad arrival time %q", s.ArrivalTime)
	}
	departure = s.Date.Add(time.Duration(dep.Hour())*time.Hour + time.Duration(dep.Minute())*time.Minute)
	arrival = s.Date.Add(time.Duration(arr.Hour())*time.Hour + time.Duration(arr.Minute())*time.Minute)
	if arrival.Before(departure) {
		arrival = arrival.AddDate(0, 0, 1)
	}
	return departure, arrival, nil
}

// store upserts the flights of rm with the current fetch time and records the refresh. When the timetable was
// complete, flights of rm stored by an earlier fetch but gone from it now (cancelled) are deleted.
func (w *Worker) store(ctx context.Context, rm routeMonth, flights []flight, complete bool) error {
	r, from, to := rm.route, rm.first, rm.last
	fetchedAt := w.now()
	return pgx.BeginFunc(ctx, w.pool, func(tx pgx.Tx) error {
		batch := &pgx.Batch{}
		var dates, times []string
		for _, f := range flights {
			var amount *int64
			var currency *string
			if f.price != nil {
				amount, currency = &f.price.Amount, &f.price.Currency
			}
			batch.Queue(`
				INSERT INTO flights (departure_airport, arrival_airport,
					departure_date, departure_time, arrival_date, arrival_time,
					price_amount, price_currency, fetched_at)
				VALUES ($1, $2, $3, $4::text::time, $5, $6::text::time, $7, $8, $9)
				ON CONFLICT (departure_airport, arrival_airport, departure_date, departure_time) DO UPDATE SET
					arrival_date = EXCLUDED.arrival_date, arrival_time = EXCLUDED.arrival_time,
					price_amount = EXCLUDED.price_amount, price_currency = EXCLUDED.price_currency,
					fetched_at = EXCLUDED.fetched_at`,
				r.from, r.to, dateOf(f.departure), f.departure.Format("15:04"),
				dateOf(f.arrival), f.arrival.Format("15:04"), amount, currency, fetchedAt)
			dates = append(dates, f.departure.Format(time.DateOnly))
			times = append(times, f.departure.Format("15:04"))
		}
		if complete {
			batch.Queue(`
				DELETE FROM flights
				WHERE departure_airport = $1 AND arrival_airport = $2
					AND departure_date BETWEEN $3 AND $4
					AND (departure_date, departure_time) NOT IN (
						SELECT d, t FROM unnest($5::text[]::date[], $6::text[]::time[]) AS fetched (d, t))`,
				r.from, r.to, from, to, dates, times)
		}
		batch.Queue(`
			INSERT INTO route_month_refreshes (departure_airport, arrival_airport, month, refreshed_at)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (departure_airport, arrival_airport, month) DO UPDATE SET refreshed_at = EXCLUDED.refreshed_at`,
			r.from, r.to, rm.month, fetchedAt)
		if err := tx.SendBatch(ctx, batch).Close(); err != nil {
			return fmt.Errorf("store flights %s→%s: %w", r.from, r.to, err)
		}
		return nil
	})
}

func dateOf(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func firstOfMonth(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

func maxDate(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func minDate(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
