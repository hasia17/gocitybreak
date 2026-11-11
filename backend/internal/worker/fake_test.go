package worker_test

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
)

// fakeRyanair is an in-memory Ryanair client backed by scheduled flights.
type fakeRyanair struct {
	airports               []ryanair.Airport
	routes                 map[string][]string
	flights                []fakeFlight
	failures               map[string]bool
	cheapestPerDayRequests []string
}

type fakeFlight struct {
	from, to           string
	departure, arrival string // "2006-01-02T15:04", local
	price              float64
	currency           string
	soldOut            bool
}

func newFakeRyanair() *fakeRyanair {
	return &fakeRyanair{routes: map[string][]string{}, failures: map[string]bool{}}
}

func (f *fakeRyanair) setFlights(flights ...fakeFlight) { f.flights = flights }

func (f *fakeRyanair) fail(endpoint, route string, enabled bool) {
	f.failures[endpoint+" "+route] = enabled
}

func (f *fakeRyanair) failed(endpoint, route string) bool {
	return f.failures[endpoint+" "+route] || f.failures[endpoint+" "]
}

func (f *fakeRyanair) Airports(context.Context) ([]ryanair.Airport, error) {
	return f.airports, nil
}

func (f *fakeRyanair) Routes(_ context.Context, airport string) ([]string, error) {
	return f.routes[airport], nil
}

func fakeTime(s string) time.Time {
	t, err := time.Parse("2006-01-02T15:04", s)
	if err != nil {
		panic(err)
	}
	return t
}

func (fl fakeFlight) fare() *ryanair.Fare {
	return &ryanair.Fare{Departure: fakeTime(fl.departure), Arrival: fakeTime(fl.arrival),
		Price: ryanair.Money{Amount: int64(math.Round(fl.price * 100)), Currency: fl.currency}}
}

func (f *fakeRyanair) CheapestPerDay(_ context.Context, from, to string, month time.Time) ([]ryanair.DayFare, error) {
	f.cheapestPerDayRequests = append(f.cheapestPerDayRequests, from+"-"+to+" "+month.Format("2006-01"))
	if f.failed("cheapestPerDay", from+"-"+to) {
		return nil, errors.New("fake cheapest per day failure")
	}
	var days []ryanair.DayFare
	for day := month; day.Month() == month.Month(); day = day.AddDate(0, 0, 1) {
		var cheapest *ryanair.Fare
		for _, fl := range f.flights {
			if fl.from != from || fl.to != to || fl.departure[:10] != day.Format(time.DateOnly) || fl.soldOut {
				continue
			}
			fare := fl.fare()
			if cheapest == nil || fare.Price.Amount < cheapest.Price.Amount {
				cheapest = fare
			}
		}
		days = append(days, ryanair.DayFare{Day: day, Fare: cheapest})
	}
	return days, nil
}

func (f *fakeRyanair) Timetable(_ context.Context, from, to string, month time.Time) ([]ryanair.ScheduledFlight, error) {
	if f.failed("timetable", from+"-"+to) {
		return nil, errors.New("fake timetable failure")
	}
	var flights []ryanair.ScheduledFlight
	for _, fl := range f.flights {
		departure := fakeTime(fl.departure)
		if fl.from != from || fl.to != to || departure.Year() != month.Year() || departure.Month() != month.Month() {
			continue
		}
		day := time.Date(departure.Year(), departure.Month(), departure.Day(), 0, 0, 0, 0, time.UTC)
		flights = append(flights, ryanair.ScheduledFlight{Date: day, Departure: departure, Arrival: fakeTime(fl.arrival)})
	}
	return flights, nil
}

func (f *fakeRyanair) FareAt(_ context.Context, from, to string, departure time.Time) (*ryanair.Fare, error) {
	if f.failed("oneWayFares", from+"-"+to) {
		return nil, errors.New("fake fare failure")
	}
	for _, fl := range f.flights {
		if fl.from == from && fl.to == to && fakeTime(fl.departure).Equal(departure) && !fl.soldOut {
			return fl.fare(), nil
		}
	}
	return nil, nil
}

func (f *fakeRyanair) takeCheapestPerDayRequests() []string {
	got := f.cheapestPerDayRequests
	f.cheapestPerDayRequests = nil
	return got
}

// fakeNBP imitates NBP's API: the latest table A and table B of mid-market rates.
type fakeNBP struct {
	mu      sync.Mutex
	tables  map[string]fakeNBPTable
	failing map[string]bool
}

type fakeNBPTable struct {
	effectiveDate string
	rates         map[string]float64
}

func newFakeNBP(t *testing.T) (*fakeNBP, string) {
	t.Helper()
	f := &fakeNBP{tables: map[string]fakeNBPTable{}, failing: map[string]bool{}}
	srv := httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(srv.Close)
	return f, srv.URL
}

func (f *fakeNBP) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	name, ok := strings.CutPrefix(r.URL.Path, "/api/exchangerates/tables/")
	name = strings.TrimSuffix(name, "/")
	table, known := f.tables[name]
	if !ok || !known || r.URL.Query().Get("format") != "json" {
		http.NotFound(w, r)
		return
	}
	if strings.HasPrefix(r.UserAgent(), "Go-http-client") {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if f.failing[name] {
		http.Error(w, "fake failure", http.StatusInternalServerError)
		return
	}
	var list []map[string]any
	for code, mid := range table.rates {
		list = append(list, map[string]any{"currency": code, "code": code, "mid": mid})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode([]map[string]any{{"table": name, "no": "1/" + name + "/NBP/2026", "effectiveDate": table.effectiveDate, "rates": list}})
}
