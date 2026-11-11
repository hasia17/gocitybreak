package search_test

import (
	"errors"
	"testing"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/catalogue"
	"github.com/hasia17/gocitybreak/backend/internal/search"
)

// The rules of a query are checked before any stored data is read, so this table needs no
// database: a Searcher with no pool reports each broken rule as a query error, and a query
// that breaks no rule proceeds to the search proper — the nil pool, which panics; the panic
// is recovered here as proof that the query passed validation.
func TestSearchChecksQueryRules(t *testing.T) {
	s := search.NewSearcher(nil)
	tests := []struct {
		name       string
		query      search.Query
		wantReason string // empty: the query breaks no rule
	}{
		{"unsupported kind", changed(oneWay(), func(q *search.Query) { q.Kind = "multiCity" }),
			`kind must be "roundTrip" or "oneWay"`},
		{"unsupported sort", changed(roundTrip(), func(q *search.Query) { q.Sort = "airline" }),
			`sort must be "price", "leaveDays" or "pricePerNight"`},
		{"round-trip sort on a one-way query", changed(oneWay(), func(q *search.Query) { q.Sort = search.ByLeaveDays }),
			`sort "leaveDays" applies to round trips only`},
		{"no home airports", changed(oneWay(), func(q *search.Query) { q.HomeAirports = nil }),
			"homeAirports must not be empty"},
		{"no destination", changed(oneWay(), func(q *search.Query) { q.Destination = search.Destination{} }),
			"destination must name airports, cities or countries, or be anywhere"},
		{"travel window ends before it starts", changed(oneWay(), func(q *search.Query) {
			q.TravelWindow = search.TravelWindow{From: day("2026-12-10"), To: day("2026-12-01")}
		}), "travelWindow.to must not be before travelWindow.from"},
		{"round trip without a stay length", changed(roundTrip(), func(q *search.Query) { q.StayLength = nil }),
			"stayLength is required for a round trip"},
		{"negative stay length", changed(roundTrip(), func(q *search.Query) {
			q.StayLength = &search.StayLength{Min: -1, Max: 2}
		}), "stayLength.min must not be negative"},
		{"stay length ends before it starts", changed(roundTrip(), func(q *search.Query) {
			q.StayLength = &search.StayLength{Min: 3, Max: 2}
		}), "stayLength.max must not be less than stayLength.min"},
		{"negative maximum leave days", changed(roundTrip(), func(q *search.Query) { q.Filters.MaxLeaveDays = new(-1) }),
			"maxLeaveDays must not be negative"},
		// Defaults: an empty kind is a round trip — it requires a stay length — and work hours
		// left unset become 09:00–17:00, while an explicit 00:00 is a set work start.
		{"empty kind is a round trip", changed(roundTrip(), func(q *search.Query) { q.Kind = ""; q.StayLength = nil }),
			"stayLength is required for a round trip"},
		{"work hours left unset default to 09:00–17:00", roundTrip(), ""},
		{"explicit midnight work start", changed(roundTrip(), func(q *search.Query) { q.WorkStart = new(0 * time.Hour) }), ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := queryError(t, s, tt.query); got != tt.wantReason {
				t.Errorf("query error = %q, want %q", got, tt.wantReason)
			}
		})
	}
}

// oneWay and roundTrip are queries that break no rule; each row of the table changes one field.
func oneWay() search.Query {
	return search.Query{
		Kind:         search.OneWay,
		HomeAirports: []string{"KRK"},
		Destination:  search.Destination{Codes: catalogue.Codes{Airports: []string{"BGY"}}},
		TravelWindow: search.TravelWindow{From: day("2026-12-01"), To: day("2026-12-10")},
	}
}

func roundTrip() search.Query {
	q := oneWay()
	q.Kind = search.RoundTrip
	q.StayLength = &search.StayLength{Min: 0, Max: 5}
	return q
}

// day parses a YYYY-MM-DD date; a travel window holds plain dates.
func day(s string) time.Time {
	t, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return t
}

// changed returns base with change applied, so a row tweaks one field of a valid query.
func changed(base search.Query, change func(*search.Query)) search.Query {
	change(&base)
	return base
}

// queryError returns the reason of the query error Search reports for q, or "" when q breaks no
// rule — the search proper then reaches the nil pool and panics, recovered here.
func queryError(t *testing.T, s *search.Searcher, q search.Query) string {
	t.Helper()
	defer func() { _ = recover() }()
	if _, err := s.Search(t.Context(), q); err != nil {
		if qe, ok := errors.AsType[*search.QueryError](err); ok {
			return qe.Reason
		}
		t.Fatalf("search error = %v, want a query error or a query that breaks no rule", err)
	}
	return ""
}
