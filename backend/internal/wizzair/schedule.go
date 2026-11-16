package wizzair

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"
)

// ScheduledFlight is a flight of Wizz Air's schedule: its scheduled departure and arrival, each the local time at
// its own airport (their time.Location is meaningless).
type ScheduledFlight struct {
	Departure, Arrival time.Time
}

// Schedule reads the flight status of the route from → to (asset/flightinformation, by route as the web app's
// flight status page asks: the filter is {departureIATA, arrivalIATA}). Wizz Air answers with the flights of the
// next few days whatever the date; cancelled ones and ones lacking a scheduled time are left out. Earliest first.
func (c *HTTPClient) Schedule(ctx context.Context, from, to string) ([]ScheduledFlight, error) {
	var body struct {
		Items []struct {
			ScheduledDepartureTime string `json:"scheduledDepartureTime"`
			ScheduledArrivalTime   string `json:"scheduledArrivalTime"`
			FlightStatus           string `json:"flightStatus"`
		} `json:"flightInformationResponseItems"`
	}
	req := struct {
		DepartureIATA string `json:"departureIATA"`
		ArrivalIATA   string `json:"arrivalIATA"`
	}{from, to}
	if err := c.call(ctx, http.MethodPost, "asset/flightinformation", req, &body); err != nil {
		return nil, fmt.Errorf("flight status %s→%s: %w", from, to, err)
	}
	var flights []ScheduledFlight
	for _, item := range body.Items {
		if strings.EqualFold(item.FlightStatus, "cancelled") {
			continue
		}
		departure, depErr := time.Parse(localLayout, item.ScheduledDepartureTime)
		arrival, arrErr := time.Parse(localLayout, item.ScheduledArrivalTime)
		if depErr != nil || arrErr != nil {
			continue
		}
		flights = append(flights, ScheduledFlight{Departure: departure, Arrival: arrival})
	}
	slices.SortFunc(flights, func(a, b ScheduledFlight) int { return a.Departure.Compare(b.Departure) })
	return flights, nil
}
