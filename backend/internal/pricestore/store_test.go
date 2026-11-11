package pricestore_test

import (
	"errors"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/database"
	"github.com/hasia17/gocitybreak/backend/internal/database/databasetest"
	"github.com/hasia17/gocitybreak/backend/internal/nbp"
	"github.com/hasia17/gocitybreak/backend/internal/pricestore"
	"github.com/hasia17/gocitybreak/backend/internal/pricing"
	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestMain(m *testing.M) { code := m.Run(); databasetest.Shutdown(); os.Exit(code) }

func TestReplaceRouteMonthKeepsPartialAndDeletesCancelledFlights(t *testing.T) {
	db, err := database.Open(t.Context(), databasetest.Acquire(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	s := pricestore.New(db.Pool)
	if err := s.UpsertAirports(t.Context(), []ryanair.Airport{
		{Code: "KRK", Name: "Krakow", TimeZone: "Europe/Warsaw", CityCode: "KRA", CityName: "Krakow", CountryCode: "pl", CountryName: "Poland"},
		{Code: "BGY", Name: "Bergamo", TimeZone: "Europe/Rome", CityCode: "BER", CityName: "Bergamo", CountryCode: "it", CountryName: "Italy"},
	}); err != nil {
		t.Fatal(err)
	}
	month := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	departure := month.Add(10 * time.Hour)
	flights := []pricing.Flight{{Departure: departure, Arrival: departure.Add(2 * time.Hour)}, {Departure: departure.Add(24 * time.Hour), Arrival: departure.Add(26 * time.Hour)}}
	last := month.AddDate(0, 1, -1)
	for _, step := range []struct {
		flights  []pricing.Flight
		complete bool
		want     int
	}{
		{flights, true, 2}, {flights[:1], false, 2}, {flights[:1], true, 1}, {nil, true, 0},
	} {
		if err := s.ReplaceRouteMonth(t.Context(), "KRK", "BGY", month, month, last, month, step.flights, step.complete); err != nil {
			t.Fatal(err)
		}
		got, err := s.Flights(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != step.want {
			t.Errorf("complete=%t: got %d flights, want %d", step.complete, len(got), step.want)
		}
	}
}

func TestReplaceRouteMonthRollsBackOnConstraintViolation(t *testing.T) {
	db, err := database.Open(t.Context(), databasetest.Acquire(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	s := pricestore.New(db.Pool)
	if err := s.UpsertAirports(t.Context(), []ryanair.Airport{
		{Code: "KRK", Name: "Krakow", TimeZone: "Europe/Warsaw", CityCode: "KRA", CityName: "Krakow", CountryCode: "pl", CountryName: "Poland"},
		{Code: "BGY", Name: "Bergamo", TimeZone: "Europe/Rome", CityCode: "BER", CityName: "Bergamo", CountryCode: "it", CountryName: "Italy"},
	}); err != nil {
		t.Fatal(err)
	}
	month := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	last := month.AddDate(0, 1, -1)
	depart := month.Add(10 * time.Hour)
	fetched := month.Add(-24 * time.Hour)
	original := []pricing.Flight{
		{Departure: depart, Arrival: depart.Add(2 * time.Hour), Price: &ryanair.Money{Amount: 100, Currency: "PLN"}},
		{Departure: depart.Add(24 * time.Hour), Arrival: depart.Add(26 * time.Hour)},
	}
	if err := s.ReplaceRouteMonth(t.Context(), "KRK", "BGY", month, month, last, fetched, original, true); err != nil {
		t.Fatal(err)
	}
	before, err := s.Flights(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	// The normal schema accepts any non-null price amount; add a test-only
	// constraint so the second upsert fails after the first has changed a row.
	if _, err := db.Pool.Exec(t.Context(), `ALTER TABLE flights ADD CONSTRAINT test_positive_price CHECK (price_amount IS NULL OR price_amount >= 0)`); err != nil {
		t.Fatal(err)
	}
	replacement := []pricing.Flight{
		{Departure: depart, Arrival: depart.Add(3 * time.Hour), Price: &ryanair.Money{Amount: 200, Currency: "PLN"}},
		{Departure: depart.Add(48 * time.Hour), Arrival: depart.Add(50 * time.Hour), Price: &ryanair.Money{Amount: -1, Currency: "PLN"}},
	}
	err = s.ReplaceRouteMonth(t.Context(), "KRK", "BGY", month, month, last, fetched.Add(time.Hour), replacement, true)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" || pgErr.ConstraintName != "test_positive_price" {
		t.Fatalf("ReplaceRouteMonth error = %v, want test_positive_price check violation", err)
	}
	after, err := s.Flights(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(after, before) {
		t.Errorf("flights after failed replacement = %#v, want %#v", after, before)
	}
	// This is the same refresh record read by the worker when scheduling.
	var refreshed time.Time
	if err := db.Pool.QueryRow(t.Context(), `SELECT refreshed_at FROM route_month_refreshes WHERE departure_airport = $1 AND arrival_airport = $2 AND month = $3`, "KRK", "BGY", month).Scan(&refreshed); err != nil {
		t.Fatal(err)
	}
	if !refreshed.Equal(fetched) {
		t.Errorf("refresh after failed replacement = %v, want %v", refreshed, fetched)
	}
}

func TestUpsertExchangeRatesUpdatesExistingRate(t *testing.T) {
	db, err := database.Open(t.Context(), databasetest.Acquire(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	s := pricestore.New(db.Pool)
	date := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, rate := range []float64{4.25, 4.5} {
		if err := s.UpsertExchangeRates(t.Context(), []nbp.Rate{{Currency: "EUR", Date: date, PLN: rate}}); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	var rate float64
	if err := db.Pool.QueryRow(t.Context(), `SELECT count(*), max(rate) FROM exchange_rates`).Scan(&count, &rate); err != nil {
		t.Fatal(err)
	}
	if count != 1 || rate != 4.5 {
		t.Errorf("got %d rates with value %v, want one at 4.5", count, rate)
	}
}

func TestFlightsReadsPricedAndUnpricedFlights(t *testing.T) {
	db, err := database.Open(t.Context(), databasetest.Acquire(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	s := pricestore.New(db.Pool)
	airports := []ryanair.Airport{{Code: "KRK", Name: "Krakow", TimeZone: "Europe/Warsaw", CityCode: "KRA", CityName: "Krakow", CountryCode: "pl", CountryName: "Poland"}, {Code: "BGY", Name: "Bergamo", TimeZone: "Europe/Rome", CityCode: "BER", CityName: "Bergamo", CountryCode: "it", CountryName: "Italy"}}
	if err := s.UpsertAirports(t.Context(), airports); err != nil {
		t.Fatal(err)
	}
	depart := time.Date(2027, 1, 1, 10, 0, 0, 0, time.UTC)
	fetched := time.Date(2026, 12, 12, 9, 15, 30, 123456000, time.UTC)
	want := []pricestore.Flight{
		{DepartureAirport: "KRK", ArrivalAirport: "BGY", Departure: depart, Arrival: depart.Add(2 * time.Hour), Price: &ryanair.Money{Amount: 0, Currency: "PLN"}, FetchedAt: fetched},
		{DepartureAirport: "KRK", ArrivalAirport: "BGY", Departure: depart.Add(24 * time.Hour), Arrival: depart.Add(26 * time.Hour), FetchedAt: fetched.Add(time.Hour)},
	}
	if err := s.UpsertFlights(t.Context(), want); err != nil {
		t.Fatal(err)
	}
	got, err := s.Flights(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("flights = %#v, want %#v", got, want)
	}
}
