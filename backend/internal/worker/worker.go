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
	"github.com/hasia17/gocitybreak/backend/internal/pricestore"
	"github.com/hasia17/gocitybreak/backend/internal/pricing"
	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
)

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
	store     *pricestore.Store
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
	w := &Worker{pool: cfg.Pool, store: pricestore.New(cfg.Pool), ryanair: cfg.Ryanair, nbp: cfg.NBP,
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
	if err := w.store.UpsertAirports(ctx, airports); err != nil {
		return err
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
	if err := w.store.UpsertExchangeRates(ctx, rates); err != nil {
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
	if err := w.store.ForgetRefreshesBefore(ctx, firstOfMonth(today)); err != nil {
		return nil, err
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

// refreshRouteMonth prices and stores a route-month.
func (w *Worker) refreshRouteMonth(ctx context.Context, rm routeMonth) error {
	flights, complete, err := pricing.RouteMonth(ctx, w.ryanair, rm.route.from, rm.route.to, rm.month, rm.first, rm.last)
	if err != nil {
		return err
	}
	return w.store.ReplaceRouteMonth(ctx, rm.route.from, rm.route.to, rm.month, rm.first, rm.last, w.now(), flights, complete)
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
