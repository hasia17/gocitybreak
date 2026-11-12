package app_test

import (
	"testing"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/catalogue"
	offersearch "github.com/hasia17/gocitybreak/backend/internal/search"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFixedDatesMatchLocalDeparturesAndKeepOfferFilters(t *testing.T) {
	_, url := startAPI(t, "test")
	seed(t, url, polishAndItalianAirports, fixture{flights: []fixtureFlight{
		{"KRK", "BGY", "2026-11-13", "23:00", "2026-11-14", "02:00", 5000, "PLN", "2026-11-10T08:00:00Z"},
		{"KRK", "BGY", "2026-11-13", "04:00", "2026-11-13", "05:50", 6000, "PLN", "2026-11-10T08:00:00Z"},
		{"KRK", "BGY", "2026-11-14", "10:00", "2026-11-14", "12:00", 1000, "PLN", "2026-11-10T08:00:00Z"},
		{"BGY", "KRK", "2026-11-15", "23:00", "2026-11-16", "01:00", 4000, "PLN", "2026-11-10T08:00:00Z"},
		{"BGY", "KRK", "2026-11-16", "10:00", "2026-11-16", "12:00", 1000, "PLN", "2026-11-10T08:00:00Z"},
	}})
	pool, err := pgxpool.New(t.Context(), url)
	require.NoError(t, err)
	defer pool.Close()
	day := func(s string) time.Time {
		t.Helper()
		d, err := time.Parse(time.DateOnly, s)
		require.NoError(t, err)
		return d
	}
	q := offersearch.Query{
		Kind:         offersearch.RoundTrip,
		HomeAirports: []string{"KRK"},
		Destination:  offersearch.Destination{Codes: catalogue.Codes{Airports: []string{"BGY"}}},
		FixedDates:   &offersearch.FixedDates{Outbound: day("2026-11-13"), Inbound: day("2026-11-15")},
	}
	s := offersearch.NewSearcher(pool)
	offers, err := s.Search(t.Context(), q)
	require.NoError(t, err)
	require.Len(t, offers, 2)
	assert.Equal(t, 2, offers[0].Nights)
	assert.Equal(t, 3, offers[1].Nights, "before-06:00 arrival changes nights, never date matching")
	assert.Equal(t, "2026-11-16", offers[0].Inbound.Flights[0].Arrival.DateTime.Format(time.DateOnly))
	q.WorkStart = new(time.Duration(0))
	q.Filters = offersearch.Filters{DirectOnly: true, OutboundDeparture: &offersearch.TimeRange{From: 22 * time.Hour, To: 23 * time.Hour}, MaxLeaveDays: new(1)}
	offers, err = s.Search(t.Context(), q)
	require.NoError(t, err)
	require.Len(t, offers, 1)
	assert.Equal(t, 1, offers[0].LeaveDays)
	q.Filters.MaxLeaveDays = new(0)
	offers, err = s.Search(t.Context(), q)
	require.NoError(t, err)
	assert.Empty(t, offers)

	q.Kind = offersearch.OneWay
	q.FixedDates.Inbound = time.Time{}
	q.Filters = offersearch.Filters{}
	offers, err = s.Search(t.Context(), q)
	require.NoError(t, err)
	require.Len(t, offers, 2)
	assert.Equal(t, "2026-11-14", offers[0].Outbound.Flights[0].Arrival.DateTime.Format(time.DateOnly))
}
