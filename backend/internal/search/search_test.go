package search_test

import (
	"errors"
	"testing"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/catalogue"
	"github.com/hasia17/gocitybreak/backend/internal/search"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Invalid queries are rejected before any stored data is read, so this table needs no database.
func TestSearchChecksQueryRules(t *testing.T) {
	s := search.NewSearcher(nil)
	tests := []struct {
		name       string
		query      search.Query
		wantReason string
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
		{"negative maximum leave days on one-way search", changed(oneWay(), func(q *search.Query) { q.Filters.MaxLeaveDays = new(-1) }),
			"maxLeaveDays must not be negative"},
		{"empty kind is a round trip", changed(roundTrip(), func(q *search.Query) { q.Kind = ""; q.StayLength = nil }),
			"stayLength is required for a round trip"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := s.Search(t.Context(), tt.query)
			queryErr, ok := errors.AsType[*search.QueryError](err)
			require.True(t, ok, "expected a query error, got %v", err)
			assert.Equal(t, tt.wantReason, queryErr.Reason)
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
