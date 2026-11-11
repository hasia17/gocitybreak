package pricing_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/pricing"
	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type memoryClient struct {
	cheapest                           []ryanair.DayFare
	timetable                          []ryanair.ScheduledFlight
	fares                              map[time.Time]*ryanair.Fare
	cheapestErr, timetableErr, fareErr error
	calls                              []time.Time
}

func (*memoryClient) Airports(context.Context) ([]ryanair.Airport, error) { return nil, nil }
func (*memoryClient) Routes(context.Context, string) ([]string, error)    { return nil, nil }
func (c *memoryClient) CheapestPerDay(context.Context, string, string, time.Time) ([]ryanair.DayFare, error) {
	return c.cheapest, c.cheapestErr
}
func (c *memoryClient) Timetable(context.Context, string, string, time.Time) ([]ryanair.ScheduledFlight, error) {
	return c.timetable, c.timetableErr
}
func (c *memoryClient) FareAt(_ context.Context, _, _ string, departure time.Time) (*ryanair.Fare, error) {
	c.calls = append(c.calls, departure)
	return c.fares[departure], c.fareErr
}

func TestRouteMonth(t *testing.T) {
	month := time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)
	day := month.AddDate(0, 0, 3)
	dep := day.Add(6 * time.Hour)
	arr := day.Add(8 * time.Hour)
	other := day.Add(18 * time.Hour)
	otherArr := day.Add(20 * time.Hour)
	fare := &ryanair.Fare{Departure: dep, Arrival: arr, Price: ryanair.Money{Amount: 7000, Currency: "PLN"}}
	otherFare := &ryanair.Fare{Departure: other, Arrival: otherArr.Add(time.Minute), Price: ryanair.Money{Amount: 9000, Currency: "PLN"}}
	scheduled := ryanair.ScheduledFlight{Date: day, Departure: dep, Arrival: arr.Add(time.Minute)}
	extra := ryanair.ScheduledFlight{Date: day, Departure: other, Arrival: otherArr}
	priced := pricing.Flight{Departure: dep, Arrival: arr, Price: &fare.Price}
	unpriced := pricing.Flight{Departure: other, Arrival: otherArr}
	failure := errors.New("unavailable")
	tests := []struct {
		name        string
		client      memoryClient
		first, last time.Time
		want        []pricing.Flight
		complete    bool
		wantCalls   []time.Time
		wantErr     error
		wantLog     string
	}{
		{name: "cheapest matched in timetable", client: memoryClient{cheapest: []ryanair.DayFare{{Day: day, Fare: fare}}, timetable: []ryanair.ScheduledFlight{scheduled}}, want: []pricing.Flight{priced}, complete: true},
		{name: "another flight priced by time window", client: memoryClient{cheapest: []ryanair.DayFare{{Day: day, Fare: fare}}, timetable: []ryanair.ScheduledFlight{scheduled, extra}, fares: map[time.Time]*ryanair.Fare{other: otherFare}}, want: []pricing.Flight{priced, {Departure: other, Arrival: otherFare.Arrival, Price: &otherFare.Price}}, complete: true, wantCalls: []time.Time{other}},
		{name: "nothing on sale", client: memoryClient{cheapest: []ryanair.DayFare{{Day: day}}, timetable: []ryanair.ScheduledFlight{extra}}, want: []pricing.Flight{unpriced}, complete: true},
		{name: "time window failure", client: memoryClient{timetable: []ryanair.ScheduledFlight{extra}, fareErr: failure}, want: []pricing.Flight{unpriced}, complete: true, wantCalls: []time.Time{other}, wantLog: `level=WARN msg="time-window pricing failed, storing the flight without a price" from=KRK to=BGY departure="2026-12-04 18:00:00" err=unavailable`},
		{name: "time window has no fare", client: memoryClient{timetable: []ryanair.ScheduledFlight{extra}}, want: []pricing.Flight{unpriced}, complete: true, wantCalls: []time.Time{other}},
		{name: "cheapest missing from timetable", client: memoryClient{cheapest: []ryanair.DayFare{{Day: day, Fare: fare}}}, want: []pricing.Flight{priced}, complete: true},
		{name: "timetable failure", client: memoryClient{cheapest: []ryanair.DayFare{{Day: day, Fare: fare}}, timetable: []ryanair.ScheduledFlight{extra}, timetableErr: failure}, want: []pricing.Flight{priced}, wantLog: `level=WARN msg="timetable unavailable, storing the cheapest flights only" from=KRK to=BGY month=2026-12 err=unavailable`},
		{name: "outside range skipped", client: memoryClient{cheapest: []ryanair.DayFare{{Day: day, Fare: fare}}, timetable: []ryanair.ScheduledFlight{scheduled, extra}}, first: day.AddDate(0, 0, 1), last: day.AddDate(0, 0, 2), complete: true},
		{name: "daily fares failure", client: memoryClient{cheapestErr: failure}, wantErr: failure},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			first, last := tt.first, tt.last
			if first.IsZero() {
				first, last = month, month.AddDate(0, 1, -1)
			}
			var logs bytes.Buffer
			logger := slog.New(slog.NewTextHandler(&logs, nil))
			got, complete, err := pricing.RouteMonth(t.Context(), logger, &tt.client, "KRK", "BGY", month, first, last)
			if tt.wantLog != "" {
				assert.Contains(t, logs.String(), tt.wantLog)
			} else {
				assert.Empty(t, logs.String())
			}
			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				assert.Nil(t, got)
				assert.False(t, complete)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.complete, complete)
			assert.Equal(t, tt.want, got)
			assert.Equal(t, tt.wantCalls, tt.client.calls)
		})
	}
}
