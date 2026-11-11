package ryanair_test

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/fetch"
	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
)

// These tests drive the HTTP adapter against recorded responses of Ryanair's undocumented API,
// as observed on 2026-11-10/11 (ADR-0005), served by a local test server; they assert on the
// Go values returned, so a change in Ryanair's shape breaks here and not in the worker's tests.

// recording answers one recorded response at path (anything else is a 404) and records every
// request it answers.
type recording struct {
	*httptest.Server
	mu       sync.Mutex
	requests []string
}

func newRecording(t *testing.T, path string, status int, body string) *recording {
	t.Helper()
	rec := &recording{}
	rec.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.mu.Lock()
		rec.requests = append(rec.requests, r.URL.RequestURI())
		rec.mu.Unlock()
		if r.URL.Path != path {
			http.NotFound(w, r)
			return
		}
		if status != http.StatusOK {
			http.Error(w, "recorded failure", status)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(rec.Close)
	return rec
}

// request returns the request URI of the recording's first answer.
func (rec *recording) request() string {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.requests) == 0 {
		return ""
	}
	return rec.requests[0]
}

// client returns the Ryanair client talking to the recording.
func (rec *recording) client() *ryanair.HTTPClient {
	return ryanair.NewHTTPClient(rec.URL, fetch.NewClient(fetch.Options{InitialBackoff: time.Millisecond}))
}

// payload returns the recorded response body saved under testdata.
func payload(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read testdata/%s: %v", name, err)
	}
	return string(b)
}

// assertEqual fails the test when got and want differ.
func assertEqual[T any](t *testing.T, what string, got, want T) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n got: %#v\nwant: %#v", what, got, want)
	}
}

// day is the local date d ("2006-01-02").
func day(d string) time.Time {
	t, err := time.Parse(time.DateOnly, d)
	if err != nil {
		panic(err)
	}
	return t
}

// local is the local wall-clock time date hh:mm; its location is meaningless.
func local(date string, hhmm string) time.Time {
	d := day(date)
	var hh, mm int
	if _, err := fmt.Sscanf(hhmm, "%d:%d", &hh, &mm); err != nil {
		panic(err)
	}
	return time.Date(d.Year(), d.Month(), d.Day(), hh, mm, 0, 0, time.UTC)
}

// queryOf parses a recorded request's query string.
func queryOf(t *testing.T, requestURI string) url.Values {
	t.Helper()
	u, err := url.Parse(requestURI)
	if err != nil {
		t.Fatalf("parse request %q: %v", requestURI, err)
	}
	return u.Query()
}

func TestAirportsParsesTheRecordedCatalogue(t *testing.T) {
	rec := newRecording(t, "/api/views/locate/5/airports/en/active",
		http.StatusOK, payload(t, "airports.json"))

	airports, err := rec.client().Airports(t.Context())

	if err != nil {
		t.Fatalf("Airports: %v", err)
	}
	assertEqual(t, "airports", airports, []ryanair.Airport{
		{
			Code: "BGY", Name: "Milan Bergamo", TimeZone: "Europe/Rome",
			CityCode: "MILAN", CityName: "Milan", CountryCode: "it", CountryName: "Italy",
		},
		{
			Code: "KRK", Name: "Krakow", TimeZone: "Europe/Warsaw",
			CityCode: "KRAKOW", CityName: "Krakow", CountryCode: "pl", CountryName: "Poland",
		},
		{
			Code: "RAK", Name: "Marrakesh Menara", TimeZone: "Africa/Casablanca",
			CityCode: "MARRAKESH", CityName: "Marrakesh", CountryCode: "ma", CountryName: "Morocco",
		},
	})
}

func TestRoutesListDirectDestinationsOnly(t *testing.T) {
	rec := newRecording(t, "/api/views/locate/searchWidget/routes/en/airport/KRK",
		http.StatusOK, payload(t, "routes_krk.json"))

	routes, err := rec.client().Routes(t.Context(), "KRK")

	if err != nil {
		t.Fatalf("Routes: %v", err)
	}
	// JFK is reachable only with a change of plane in Dublin, so it is not a direct route.
	assertEqual(t, "routes", routes, []string{"BGY", "RAK"})
}

func TestCheapestPerDayPricesOnlyDaysOnSale(t *testing.T) {
	rec := newRecording(t, "/api/farfnd/v4/oneWayFares/KRK/BGY/cheapestPerDay",
		http.StatusOK, payload(t, "cheapest_per_day.json"))

	days, err := rec.client().CheapestPerDay(t.Context(), "KRK", "BGY", day("2026-12-01"))

	if err != nil {
		t.Fatalf("CheapestPerDay: %v", err)
	}
	// Sold-out, unavailable and empty days come back without a fare; the rest is parsed.
	assertEqual(t, "days", days, []ryanair.DayFare{
		{Day: day("2026-12-04"), Fare: &ryanair.Fare{
			Departure: local("2026-12-04", "05:50"), Arrival: local("2026-12-04", "07:40"),
			Price: ryanair.Money{Amount: 7027, Currency: "PLN"},
		}},
		{Day: day("2026-12-05")}, // sold out
		{Day: day("2026-12-06")}, // unavailable
		{Day: day("2026-12-07")}, // no flight that day
	})
	if got := rec.request(); got != "/api/farfnd/v4/oneWayFares/KRK/BGY/cheapestPerDay?outboundMonthOfDate=2026-12-01" {
		t.Errorf("asked for %q", got)
	}
}

func TestFareAtReturnsTheFareOfTheFlightInTheTimeWindow(t *testing.T) {
	rec := newRecording(t, "/api/farfnd/v4/oneWayFares",
		http.StatusOK, payload(t, "one_way_fares.json"))

	fare, err := rec.client().FareAt(t.Context(), "KRK", "BGY", local("2026-12-04", "05:50"))

	if err != nil {
		t.Fatalf("FareAt: %v", err)
	}
	// Two flights answer, but only the one departing inside the asked-for time window counts.
	assertEqual(t, "fare", fare, &ryanair.Fare{
		Departure: local("2026-12-04", "05:50"), Arrival: local("2026-12-04", "07:40"),
		Price: ryanair.Money{Amount: 7027, Currency: "PLN"},
	})
	// The time window is what ties the answer to our flight, so pin the request.
	q := queryOf(t, rec.request())
	for _, p := range [][2]string{
		{"departureAirportIataCode", "KRK"},
		{"arrivalAirportIataCode", "BGY"},
		{"outboundDepartureDateFrom", "2026-12-04"},
		{"outboundDepartureDateTo", "2026-12-04"},
		{"outboundDepartureTimeFrom", "05:50"},
		{"outboundDepartureTimeTo", "05:50"},
	} {
		if got := q.Get(p[0]); got != p[1] {
			t.Errorf("query %s = %q, want %q", p[0], got, p[1])
		}
	}
}

func TestFareAtReturnsNilWhenNothingIsOnSale(t *testing.T) {
	rec := newRecording(t, "/api/farfnd/v4/oneWayFares",
		http.StatusOK, payload(t, "one_way_fares_empty.json"))

	fare, err := rec.client().FareAt(t.Context(), "KRK", "BGY", local("2026-12-04", "05:50"))

	if err != nil {
		t.Fatalf("FareAt: %v", err)
	}
	if fare != nil {
		t.Errorf("fare = %v, want none", fare)
	}
}

func TestTimetableReturnsLocalTimesAndAppliesTheOvernightRule(t *testing.T) {
	rec := newRecording(t, "/api/timtbl/3/schedules/KRK/BGY/years/2026/months/12",
		http.StatusOK, payload(t, "timetable.json"))

	flights, err := rec.client().Timetable(t.Context(), "KRK", "BGY", day("2026-12-01"))

	if err != nil {
		t.Fatalf("Timetable: %v", err)
	}
	assertEqual(t, "flights", flights, []ryanair.ScheduledFlight{
		{Date: day("2026-12-04"), Departure: local("2026-12-04", "05:50"), Arrival: local("2026-12-04", "07:40")},
		// Lands after midnight: the arrival is the next day even though it is earlier in the day.
		{Date: day("2026-12-04"), Departure: local("2026-12-04", "23:30"), Arrival: local("2026-12-05", "01:20")},
		{Date: day("2026-12-05"), Departure: local("2026-12-05", "06:05"), Arrival: local("2026-12-05", "07:55")},
	})
}

func TestTimetableForAMonthWithoutFlightsIsEmpty(t *testing.T) {
	rec := newRecording(t, "/api/timtbl/3/schedules/KRK/BGY/years/2027/months/3",
		http.StatusNotFound, "")

	flights, err := rec.client().Timetable(t.Context(), "KRK", "BGY", day("2027-03-01"))

	if err != nil {
		t.Fatalf("Timetable: %v", err)
	}
	if len(flights) != 0 {
		t.Errorf("flights = %v, want none", flights)
	}
}

func TestTimetableFailsOnAMalformedTime(t *testing.T) {
	rec := newRecording(t, "/api/timtbl/3/schedules/KRK/BGY/years/2026/months/12",
		http.StatusOK, payload(t, "timetable_bad_time.json"))

	flights, err := rec.client().Timetable(t.Context(), "KRK", "BGY", day("2026-12-01"))

	if err == nil || !strings.Contains(err.Error(), `bad arrival time "0740"`) {
		t.Fatalf("Timetable error = %v, want a bad arrival time", err)
	}
	if flights != nil {
		t.Errorf("flights = %v, want none", flights)
	}
}
