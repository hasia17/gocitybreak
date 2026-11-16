// Package worker is the price worker (ADR-0002): it fills our database with Ryanair's airport catalogue, the stored
// prices of Ryanair's (ADR-0005) and Wizz Air's (ADR-0008) flights to and from the supported airports, and NBP
// exchange rates (ADR-0006). Each airline is fetched by its own pass at its own rate, and one failing doesn't stop
// the other.
//
// It runs as its own process, so whatever goes wrong here, search keeps answering from the last stored prices.
package worker

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hasia17/gocitybreak/backend/internal/airline"
	"github.com/hasia17/gocitybreak/backend/internal/nbp"
	"github.com/hasia17/gocitybreak/backend/internal/pricestore"
	"github.com/hasia17/gocitybreak/backend/internal/pricing"
	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
	"github.com/hasia17/gocitybreak/backend/internal/wizzair"
)

// Config is what the worker works with.
type Config struct {
	Pool    *pgxpool.Pool
	Ryanair ryanair.Client
	// Wizzair is optional: without it, the worker fetches Ryanair's flights only.
	Wizzair wizzair.Client
	NBP     *nbp.Client
	// Horizon is how far ahead prices are fetched (default 6 months).
	Horizon time.Duration
	// Freshness says how often prices are refetched, by how soon the flights depart (default DefaultFreshness).
	Freshness Freshness
	// Now tells the time (default time.Now); tests pin it.
	Now func() time.Time
	// Logger receives the worker's progress and failures (default slog.Default()).
	Logger *slog.Logger
}

// Worker fetches prices and rates into the database.
type Worker struct {
	pool      *pgxpool.Pool
	store     *pricestore.Store
	ryanair   ryanair.Client
	wizzair   wizzair.Client
	nbp       *nbp.Client
	horizon   time.Duration
	freshness Freshness
	now       func() time.Time
	logger    *slog.Logger
}

// Freshness is a list of tiers, nearest first: route-months whose flights start departing sooner than a tier's
// DepartsWithin get refetched once their stored prices are older than its MaxAge. The last tier covers the rest.
// Each airline's refreshes are tracked on their own.
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
	w := &Worker{pool: cfg.Pool, store: pricestore.New(cfg.Pool), ryanair: cfg.Ryanair, wizzair: cfg.Wizzair, nbp: cfg.NBP,
		horizon: cfg.Horizon, freshness: cfg.Freshness, now: cfg.Now, logger: cmp.Or(cfg.Logger, slog.Default())}
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
	// PricePause is the pause between the end of one airline's price refresh and the start of its next, which picks
	// up whatever has become due in the meantime (see Freshness).
	PricePause time.Duration
	// RatesInterval is how often exchange rates are fetched; RatesRetry is how soon a failed fetch is retried.
	RatesInterval, RatesRetry time.Duration
}

// Run refreshes exchange rates and each airline's prices on schedule until ctx is cancelled. The airlines are
// refreshed side by side, each pausing after its own refresh, so a long refresh of one doesn't hold up the other.
// Failures are logged and retried on the next round; they never stop the worker.
func (w *Worker) Run(ctx context.Context, s Schedule) {
	go func() {
		for {
			wait := s.RatesInterval
			if err := w.RefreshExchangeRates(ctx); err != nil {
				w.logger.ErrorContext(ctx, "exchange rate refresh failed", "err", err)
				wait = s.RatesRetry
			}
			if !sleep(ctx, wait) {
				return
			}
		}
	}()
	var wg sync.WaitGroup
	for _, p := range w.passes() {
		wg.Go(func() {
			for {
				start := time.Now()
				if p.airline == airline.Ryanair {
					// The catalogue is Ryanair's, so it is refreshed along with Ryanair's prices.
					if err := w.RefreshCatalogue(ctx); err != nil {
						w.logger.ErrorContext(ctx, "catalogue refresh failed", "err", err)
					}
				}
				_ = p.refresh(ctx) // the pass logs its failures
				w.logger.InfoContext(ctx, "price refresh finished", "airline", p.airline, "took", time.Since(start).Round(time.Second))
				if !sleep(ctx, s.PricePause) {
					return
				}
			}
		})
	}
	wg.Wait()
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
	w.logger.InfoContext(ctx, "catalogue stored", "airports", len(airports))
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
	w.logger.InfoContext(ctx, "exchange rates stored", "table", table, "rates", len(rates))
	return nil
}

// route is one direction between two airports.
type route struct{ from, to string }

// routeMonth is the part of a route's month inside the horizon: flights departing from first to last.
type routeMonth struct {
	airline     airline.Airline
	route       route
	month       time.Time // the first day of the month
	first, last time.Time
}

// pass refreshes one airline's prices; it logs its failures, naming the airline, and returns them.
type pass struct {
	airline airline.Airline
	refresh func(context.Context) error
}

// passes lists a pass for every airline the worker fetches.
func (w *Worker) passes() []pass {
	passes := []pass{{airline.Ryanair, w.refreshRyanairPrices}}
	if w.wizzair != nil {
		passes = append(passes, pass{airline.Wizzair, w.refreshWizzairPrices})
	}
	return passes
}

// RefreshPrices fetches every airline's flights on every route from and to the supported airports whose stored
// prices are due for a refresh (see Freshness), nearest months first, the airlines side by side. A route-month that
// fails keeps its previously stored prices and stays due for the next refresh, and an airline that fails doesn't
// stop the other; the returned error lists the failures.
func (w *Worker) RefreshPrices(ctx context.Context) error {
	passes := w.passes()
	failures := make([]error, len(passes))
	var wg sync.WaitGroup
	for i, p := range passes {
		wg.Go(func() { failures[i] = p.refresh(ctx) })
	}
	wg.Wait()
	return errors.Join(failures...)
}

// refreshRyanairPrices prices every due Ryanair route-month (ADR-0005).
func (w *Worker) refreshRyanairPrices(ctx context.Context) error {
	logger := w.logger.With("airline", airline.Ryanair)
	return logFailure(ctx, logger, airline.Ryanair, func() error {
		catalogue, err := w.catalogue(ctx)
		if err != nil {
			return err
		}
		routes := bothWays(ctx, logger, catalogue.supported, w.ryanair.Routes, catalogue.has)
		return w.refreshRouteMonths(ctx, logger, airline.Ryanair, routes, func(ctx context.Context, rm routeMonth) error {
			flights, complete, err := pricing.RouteMonth(ctx, logger, w.ryanair, rm.route.from, rm.route.to, rm.month, rm.first, rm.last)
			if err != nil {
				return err
			}
			return w.store.ReplaceRouteMonth(ctx, rm.airline, rm.route.from, rm.route.to, rm.month, rm.first, rm.last, w.now(), flights, complete)
		})
	})
}

// refreshWizzairPrices prices every due Wizz Air route-month (ADR-0008). Wizz Air's timetable gives no arrival, so each
// flight arrives after its route's scheduled block time at its departure time, learnt from flight status, or, where
// none is known yet, after a block time estimated from the distance, and is then marked as estimated.
func (w *Worker) refreshWizzairPrices(ctx context.Context) error {
	logger := w.logger.With("airline", airline.Wizzair)
	return logFailure(ctx, logger, airline.Wizzair, func() error {
		stations, err := w.wizzair.Stations(ctx)
		if err != nil {
			return err
		}
		catalogue, err := w.catalogue(ctx)
		if err != nil {
			return err
		}
		// Only airports in the catalogue: search knows no other, and an arrival needs the airport's time zone.
		places := map[string]place{}
		connections := map[string][]string{}
		for _, s := range stations {
			zone, ok := catalogue.zones[s.Code]
			if !ok {
				continue
			}
			location, err := time.LoadLocation(zone)
			if err != nil {
				logger.WarnContext(ctx, "airport with an unknown time zone", "airport", s.Code, "zone", zone, "err", err)
				continue
			}
			places[s.Code] = place{latitude: s.Latitude, longitude: s.Longitude, zone: location}
			connections[s.Code] = s.Connections
		}
		destinations := func(_ context.Context, home string) ([]string, error) { return connections[home], nil }
		routes := bothWays(ctx, logger, catalogue.supported, destinations, func(code string) bool {
			_, ok := places[code]
			return ok
		})
		blocks, err := w.refreshBlockTimes(ctx, logger, routes, places)
		if err != nil {
			return err
		}
		return w.refreshRouteMonths(ctx, logger, airline.Wizzair, routes, func(ctx context.Context, rm routeMonth) error {
			flights, complete, err := pricing.WizzairRange(ctx, logger, w.wizzair, rm.route.from, rm.route.to, rm.first, rm.last)
			if err != nil {
				return err
			}
			from, to := places[rm.route.from], places[rm.route.to]
			for i, f := range flights {
				// The route's scheduled block time at this departure time, else the distance's estimate.
				key := pricestore.BlockKey{Airline: airline.Wizzair, From: rm.route.from, To: rm.route.to, Time: f.Departure.Format("15:04")}
				if block, ok := blocks[key]; ok {
					flights[i].Arrival = arrivalAfter(f.Departure, block, from, to)
					flights[i].EstimatedArrival = false
					continue
				}
				flights[i].Arrival = estimatedArrival(f.Departure, from, to)
				flights[i].EstimatedArrival = true
			}
			return w.store.ReplaceRouteMonth(ctx, rm.airline, rm.route.from, rm.route.to, rm.month, rm.first, rm.last, w.now(), flights, complete)
		})
	})
}

// blockTimeMaxAge is how long a route's flight status is trusted before it is read again: it only covers the next
// few days, and a changed schedule shows up once the changed flights come within reach.
const blockTimeMaxAge = day

// maxBlockTime is the longest flight we believe: anything longer in flight status is a misread.
const maxBlockTime = 12 * time.Hour

// refreshBlockTimes reads the flight status of every route whose last read is too old and stores the scheduled
// block times it shows (ADR-0008), then returns all of Wizz Air's stored block times. A route whose flight status
// can't be read is logged, stays due for the next pass and keeps what we knew: its flights are priced either way.
func (w *Worker) refreshBlockTimes(ctx context.Context, logger *slog.Logger, routes []route, places map[string]place) (map[pricestore.BlockKey]time.Duration, error) {
	refreshed, err := w.store.ScheduleRefreshes(ctx, airline.Wizzair)
	if err != nil {
		return nil, err
	}
	for _, r := range routes {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if at, ok := refreshed[r.from+"-"+r.to]; ok && w.now().Sub(at) < blockTimeMaxAge {
			continue
		}
		schedule, err := w.wizzair.Schedule(ctx, r.from, r.to)
		if err != nil {
			logger.WarnContext(ctx, "flight status failed", "from", r.from, "to", r.to, "err", err)
			continue
		}
		blocks := map[string]time.Duration{}
		for _, f := range schedule { // earliest first, so the latest flight's block time wins
			block := blockTime(f.Departure, f.Arrival, places[r.from], places[r.to])
			if block <= 0 || block > maxBlockTime {
				logger.WarnContext(ctx, "flight status with an impossible block time", "from", r.from, "to", r.to,
					"departure", f.Departure.Format("2006-01-02 15:04"), "block", block)
				continue
			}
			blocks[f.Departure.Format("15:04")] = block
		}
		if err := w.store.ReplaceBlockTimes(ctx, airline.Wizzair, r.from, r.to, blocks, w.now()); err != nil {
			return nil, err
		}
	}
	return w.store.BlockTimes(ctx, airline.Wizzair)
}

// logFailure runs an airline's pass, logging and returning its failure.
func logFailure(ctx context.Context, logger *slog.Logger, a airline.Airline, pass func() error) error {
	if err := pass(); err != nil {
		logger.ErrorContext(ctx, "price refresh incomplete", "err", err)
		return fmt.Errorf("%s: %w", a, err)
	}
	return nil
}

// refreshRouteMonths prices and stores, with refresh, every route-month of airline a's routes that is due.
func (w *Worker) refreshRouteMonths(ctx context.Context, logger *slog.Logger, a airline.Airline, routes []route,
	refresh func(context.Context, routeMonth) error) error {
	due, err := w.due(ctx, a, routes)
	if err != nil {
		return err
	}
	var failures []error
	for _, rm := range due {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := refresh(ctx, rm); err != nil {
			logger.WarnContext(ctx, "route refresh failed", "from", rm.route.from, "to", rm.route.to,
				"month", rm.month.Format("2006-01"), "err", err)
			failures = append(failures, err)
		}
	}
	logger.InfoContext(ctx, "prices refreshed", "routes", len(routes), "routeMonths", len(due), "failures", len(failures))
	if len(failures) > 0 {
		return fmt.Errorf("%d route-months failed: %w", len(failures), errors.Join(failures...))
	}
	return nil
}

// due lists the route-months of airline a's routes within the horizon whose stored prices are missing or too old,
// nearest first.
func (w *Worker) due(ctx context.Context, a airline.Airline, routes []route) ([]routeMonth, error) {
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
	rows, err := w.pool.Query(ctx, `SELECT departure_airport, arrival_airport, month, refreshed_at
FROM route_month_refreshes WHERE airline = $1`, string(a))
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
				due = append(due, routeMonth{airline: a, route: r, month: month, first: first, last: lastDay})
			}
		}
	}
	return due, nil
}

// catalogueAirports is what the passes need from the stored catalogue.
type catalogueAirports struct {
	zones     map[string]string // every airport's time zone, by code
	supported []string          // the supported airports' codes, sorted
}

func (c catalogueAirports) has(code string) bool {
	_, ok := c.zones[code]
	return ok
}

func (w *Worker) catalogue(ctx context.Context) (catalogueAirports, error) {
	c := catalogueAirports{zones: map[string]string{}}
	rows, err := w.pool.Query(ctx, `SELECT code, time_zone, supported FROM airports ORDER BY code`)
	if err != nil {
		return c, fmt.Errorf("read airports: %w", err)
	}
	var code, zone string
	var supported bool
	if _, err := pgx.ForEachRow(rows, []any{&code, &zone, &supported}, func() error {
		c.zones[code] = zone
		if supported {
			c.supported = append(c.supported, code)
		}
		return nil
	}); err != nil {
		return c, fmt.Errorf("read airports: %w", err)
	}
	return c, nil
}

// bothWays lists both directions of every route from a home airport to the airports destinations names, sorted.
// Airports that aren't usable (missing from the catalogue) are skipped.
func bothWays(ctx context.Context, logger *slog.Logger, homes []string,
	destinations func(context.Context, string) ([]string, error), usable func(string) bool) []route {
	seen := map[route]bool{}
	for _, home := range homes {
		codes, err := destinations(ctx, home)
		if err != nil {
			logger.WarnContext(ctx, "routes unavailable", "airport", home, "err", err)
			continue
		}
		for _, d := range codes {
			if !usable(d) {
				logger.WarnContext(ctx, "route to an airport missing from the catalogue", "from", home, "to", d)
				continue
			}
			seen[route{home, d}] = true
			seen[route{d, home}] = true
		}
	}
	routes := slices.Collect(maps.Keys(seen))
	slices.SortFunc(routes, func(a, b route) int {
		return cmp.Or(cmp.Compare(a.from, b.from), cmp.Compare(a.to, b.to))
	})
	return routes
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
