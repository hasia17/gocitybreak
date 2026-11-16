// Package pricing turns an airline's answers into flights to store, without accessing storage.
//
// RouteMonth merges Ryanair's daily cheapest fares, timetable and time-window fares into flights
// for a route-month. It returns whether the timetable was complete; a daily-fares failure or a
// malformed timetable aborts, while timetable and time-window failures produce partial or unpriced
// results respectively. WizzairRange prices Wizz Air's flights step by step (ADR-0008).
package pricing

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
)

// Flight is a flight to store, with local wall-clock times and an optional original price.
type Flight struct {
	Departure, Arrival time.Time
	Price              *ryanair.Money
	// EstimatedArrival says Arrival is our estimate, the airline publishing none (GLOSSARY: Estimated arrival).
	EstimatedArrival bool
}

// RouteMonth prices flights departing from first through last inclusive on the route
// in month. An incomplete timetable means callers must retain previously stored flights.
func RouteMonth(ctx context.Context, logger *slog.Logger, client ryanair.Client, fromAirport, toAirport string, month, first, last time.Time) ([]Flight, bool, error) {
	cheapest, err := client.CheapestPerDay(ctx, fromAirport, toAirport, month)
	if err != nil {
		return nil, false, err
	}
	cheapestByDay := map[time.Time]*ryanair.Fare{}
	for _, d := range cheapest {
		cheapestByDay[d.Day] = d.Fare
	}
	timetable, err := client.Timetable(ctx, fromAirport, toAirport, month)
	if errors.Is(err, ryanair.ErrMalformedTimetable) {
		// Store nothing, so the route-month stays due and the next refresh tries again.
		return nil, false, err
	}
	complete := err == nil
	if err != nil {
		logger.WarnContext(ctx, "timetable unavailable, storing the cheapest flights only", "from", fromAirport, "to", toAirport, "month", month.Format("2006-01"), "err", err)
		timetable = nil
	}
	var flights []Flight
	for _, s := range timetable {
		if s.Date.Before(first) || s.Date.After(last) {
			continue
		}
		f := Flight{Departure: s.Departure, Arrival: s.Arrival}
		switch c, ok := cheapestByDay[s.Date]; {
		case ok && c == nil:
		case ok && c.Departure.Equal(s.Departure):
			f.Arrival, f.Price = c.Arrival, &c.Price
		default:
			fare, err := client.FareAt(ctx, fromAirport, toAirport, s.Departure)
			if err != nil {
				logger.WarnContext(ctx, "time-window pricing failed, storing the flight without a price", "from", fromAirport, "to", toAirport, "departure", s.Departure.Format(time.DateTime), "err", err)
			} else if fare != nil {
				f.Arrival, f.Price = fare.Arrival, &fare.Price
			}
		}
		flights = append(flights, f)
	}
	for _, c := range cheapest {
		if c.Fare != nil && !c.Day.Before(first) && !c.Day.After(last) && !slices.ContainsFunc(flights, func(f Flight) bool { return f.Departure.Equal(c.Fare.Departure) }) {
			flights = append(flights, Flight{Departure: c.Fare.Departure, Arrival: c.Fare.Arrival, Price: &c.Fare.Price})
		}
	}
	return flights, complete, nil
}
