package pricing

import (
	"context"
	"log/slog"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
	"github.com/hasia17/gocitybreak/backend/internal/wizzair"
)

// WizzairRange prices the Wizz Air flights from → to departing from first through last inclusive (ADR-0008): each
// day's cheapest flight, then the cheapest of the departures after the flight just priced, until the day's last
// departure is priced. A flight dearer than a later flight of its day is never the cheapest of a step, so it is not
// returned. The flights have no arrival: Wizz Air's timetable gives none.
//
// The result is complete unless a step failed, in which case callers must keep the stored later flights of that
// day. A timetable failure aborts. If a step prices a flight departing before the time it asked from, Wizz Air no
// longer honours the time of day, so only the cheapest flight of that day is returned.
func WizzairRange(ctx context.Context, logger *slog.Logger, client wizzair.Client, from, to string, first, last time.Time) ([]Flight, bool, error) {
	days, err := client.Timetable(ctx, from, to, first, last)
	if err != nil {
		return nil, false, err
	}
	var flights []Flight
	complete := true
	for _, day := range days {
		if day.Cheapest == nil || day.Date.Before(first) || day.Date.After(last) {
			continue
		}
		priced, ok := laterFlights(ctx, logger, client, from, to, day)
		complete = complete && ok
		for _, fare := range priced {
			flights = append(flights, Flight{Departure: fare.Departure, Price: new(ryanair.Money(fare.Price))})
		}
	}
	return flights, complete, nil
}

// laterFlights returns the day's cheapest flight and every later flight a step prices, and false when a step
// failed.
func laterFlights(ctx context.Context, logger *slog.Logger, client wizzair.Client, from, to string, day wizzair.Day) ([]wizzair.Fare, bool) {
	priced := []wizzair.Fare{*day.Cheapest}
	for {
		next, ok := departureAfter(day.Departures, priced[len(priced)-1].Departure)
		if !ok {
			return priced, true
		}
		fare, err := client.CheapestFrom(ctx, from, to, next)
		if err != nil {
			logger.WarnContext(ctx, "time-of-day pricing failed, keeping the day's stored later flights", "from", from, "to", to,
				"departure", next.Format(time.DateTime), "err", err)
			return priced, false
		}
		if fare == nil {
			return priced, true // none of the later flights is on sale
		}
		if fare.Departure.Before(next) {
			logger.WarnContext(ctx, "time of day ignored, storing the cheapest flight of the day only", "from", from, "to", to,
				"asked", next.Format(time.DateTime), "got", fare.Departure.Format(time.DateTime))
			return priced[:1], true
		}
		priced = append(priced, *fare)
	}
}

// departureAfter returns the first of departures (earliest first) after t.
func departureAfter(departures []time.Time, t time.Time) (time.Time, bool) {
	for _, d := range departures {
		if d.After(t) {
			return d, true
		}
	}
	return time.Time{}, false
}
