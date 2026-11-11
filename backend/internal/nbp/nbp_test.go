package nbp_test

import (
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
	"github.com/hasia17/gocitybreak/backend/internal/nbp"
)

// These tests drive the client against recorded responses of NBP's API, as observed on 2026-11-11
// (ADR-0006), served by a local test server, and assert on the Go values returned.

// recording answers one recorded response for table (anything else is a 404) and records the
// request it answered. Like the real NBP, it turns away Go's default User-Agent.
type recording struct {
	*httptest.Server
	mu       sync.Mutex
	requests []string
}

func newRecording(t *testing.T, table, body string) *recording {
	t.Helper()
	rec := &recording{}
	rec.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.mu.Lock()
		rec.requests = append(rec.requests, r.Method+" "+r.URL.RequestURI())
		rec.mu.Unlock()
		if r.URL.Path != "/api/exchangerates/tables/"+table+"/" || r.URL.Query().Get("format") != "json" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("User-Agent") != "gocitybreak" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(rec.Close)
	return rec
}

// request returns the request line of the recording's first answer.
func (rec *recording) request() string {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.requests) == 0 {
		return ""
	}
	return rec.requests[0]
}

// client returns the NBP client talking to the recording.
func (rec *recording) client() *nbp.Client {
	return nbp.NewClient(rec.URL, fetch.NewClient(fetch.Options{InitialBackoff: time.Millisecond}))
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

// date is the local date d ("2006-01-02").
func date(d string) time.Time {
	t, err := time.Parse(time.DateOnly, d)
	if err != nil {
		panic(err)
	}
	return t
}

func TestLatestTableParsesTableA(t *testing.T) {
	rec := newRecording(t, "A", payload(t, "table_a.json"))

	rates, err := rec.client().LatestTable(t.Context(), "A")

	if err != nil {
		t.Fatalf("LatestTable: %v", err)
	}
	assertEqual(t, "rates", rates, []nbp.Rate{
		{Currency: "USD", Date: date("2026-11-10"), PLN: 3.7603},
		{Currency: "EUR", Date: date("2026-11-10"), PLN: 4.2512},
		{Currency: "GBP", Date: date("2026-11-10"), PLN: 4.9873},
	})
	if got := rec.request(); got != "GET /api/exchangerates/tables/A/?format=json" {
		t.Errorf("asked for %q", got)
	}
}

func TestLatestTableParsesTableB(t *testing.T) {
	rec := newRecording(t, "B", payload(t, "table_b.json"))

	rates, err := rec.client().LatestTable(t.Context(), "B")

	if err != nil {
		t.Fatalf("LatestTable: %v", err)
	}
	// Table B is the weekly table of the currencies table A lacks, e.g. Ryanair's fares from Morocco.
	assertEqual(t, "rates", rates, []nbp.Rate{
		{Currency: "MAD", Date: date("2026-11-04"), PLN: 0.4012},
		{Currency: "KWD", Date: date("2026-11-04"), PLN: 12.4871},
	})
}

func TestLatestTableFailsOnABadEffectiveDate(t *testing.T) {
	rec := newRecording(t, "A", payload(t, "table_a_bad_date.json"))

	rates, err := rec.client().LatestTable(t.Context(), "A")

	if err == nil || !strings.Contains(err.Error(), `NBP table A: bad effective date "10.11.2026"`) {
		t.Fatalf("LatestTable error = %v, want a bad effective date", err)
	}
	if rates != nil {
		t.Errorf("rates = %v, want none", rates)
	}
}

// assertEqual fails the test when got and want differ.
func assertEqual[T any](t *testing.T, what string, got, want T) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n got: %#v\nwant: %#v", what, got, want)
	}
}
