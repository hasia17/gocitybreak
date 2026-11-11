package ryanair_test

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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
