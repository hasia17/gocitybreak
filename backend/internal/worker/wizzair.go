package worker

import (
	"context"
	"log/slog"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/airline"
	"github.com/hasia17/gocitybreak/backend/internal/pricestore"
	"github.com/hasia17/gocitybreak/backend/internal/pricing"
)

// The Wizz Air pass (ADR-0008).

// refreshWizzairPrices prices every due Wizz Air route-month (ADR-0008). Wizz Air's timetable gives no arrival, so each
// flight arrives after its route's scheduled block time at its departure time, learnt from flight status, or, where
// none is known yet, after a block time estimated from the distance, and is then marked as estimated.
func (w *Worker) refreshWizzairPrices(ctx context.Context) error {
	logger := w.logger.With("airline", airline.Wizzair)
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
		flights, complete, err := pricing.WizzairRange(ctx, logger, w.wizzair, rm.route.From, rm.route.To, rm.first, rm.last)
		if err != nil {
			return err
		}
		from, to := places[rm.route.From], places[rm.route.To]
		for i, f := range flights {
			// The route's scheduled block time at this departure time, else the distance's estimate.
			key := pricestore.BlockKey{Airline: airline.Wizzair, From: rm.route.From, To: rm.route.To, Time: f.Departure.Format(pricestore.TimeOfDay)}
			if block, ok := blocks[key]; ok {
				flights[i].Arrival = arrivalAfter(f.Departure, block, from, to)
				flights[i].EstimatedArrival = false
				continue
			}
			flights[i].Arrival = estimatedArrival(f.Departure, from, to)
			flights[i].EstimatedArrival = true
		}
		return w.store.ReplaceRouteMonth(ctx, rm.airline, rm.route.From, rm.route.To, rm.month, rm.first, rm.last, w.now(), flights, complete)
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
		if at, ok := refreshed[r]; ok && w.now().Sub(at) < blockTimeMaxAge {
			continue
		}
		schedule, err := w.wizzair.Schedule(ctx, r.From, r.To)
		if err != nil {
			logger.WarnContext(ctx, "flight status failed", "from", r.From, "to", r.To, "err", err)
			continue
		}
		blocks := map[string]time.Duration{}
		for _, f := range schedule { // earliest first, so the latest flight's block time wins
			block := blockTime(f.Departure, f.Arrival, places[r.From], places[r.To])
			if block <= 0 || block > maxBlockTime {
				logger.WarnContext(ctx, "flight status with an impossible block time", "from", r.From, "to", r.To,
					"departure", f.Departure.Format("2006-01-02 15:04"), "block", block)
				continue
			}
			blocks[f.Departure.Format(pricestore.TimeOfDay)] = block
		}
		if err := w.store.ReplaceBlockTimes(ctx, airline.Wizzair, r.From, r.To, blocks, w.now()); err != nil {
			return nil, err
		}
	}
	return w.store.BlockTimes(ctx, airline.Wizzair)
}
