package worker_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hasia17/gocitybreak/backend/internal/app"
	"github.com/hasia17/gocitybreak/backend/internal/database"
	"github.com/hasia17/gocitybreak/backend/internal/database/databasetest"
	"github.com/hasia17/gocitybreak/backend/internal/fetch"
	"github.com/hasia17/gocitybreak/backend/internal/nbp"
	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
	"github.com/hasia17/gocitybreak/backend/internal/worker"
)

// now is when the tests' worker runs; the price horizon reaches into May 2027.
var now = time.Date(2026, 11, 10, 8, 0, 0, 0, time.UTC)

func TestWorkerStoresCatalogueWithCityAndCountry(t *testing.T) {
	env := start(t)

	if err := env.worker.RefreshCatalogue(t.Context()); err != nil {
		t.Fatalf("RefreshCatalogue: %v", err)
	}

	got := queryStrings(t, env.pool, `
		SELECT code || ' ' || name || ' ' || time_zone || ' ' || city_code || '/' || city_name || ' '
			|| country_code || '/' || country_name || CASE WHEN supported THEN ' supported' ELSE '' END
		FROM airports ORDER BY code`)
	want := []string{
		"BGY Milan Bergamo Europe/Rome BERGAMO/Bergamo it/Italy",
		"KRK Krakow Europe/Warsaw KRAKOW/Krakow pl/Poland supported",
		"MXP Milan Malpensa Europe/Rome MILAN/Milan it/Italy",
	}
	assertEqual(t, "airports", got, want)
}

func TestWorkerStoresEveryFlightOfTheDayWithItsOriginalPrice(t *testing.T) {
	env := start(t)
	env.ryanair.setFlights(
		// Three flights on one day: the cheapest comes from cheapestPerDay, the others from time-window queries.
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T05:50", arrival: "2026-12-04T07:40", price: 70.27, currency: "PLN"},
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T18:15", arrival: "2026-12-04T20:05", price: 120.00, currency: "PLN"},
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T22:05", arrival: "2026-12-04T23:55", price: 98.77, currency: "PLN"},
		// Priced in the departure airport's currency.
		fakeFlight{from: "BGY", to: "KRK", departure: "2026-12-06T19:55", arrival: "2026-12-06T21:45", price: 19.99, currency: "EUR"},
		// Sold out: in the timetable, but with no fare.
		fakeFlight{from: "BGY", to: "KRK", departure: "2026-12-07T09:00", arrival: "2026-12-07T10:50", price: 15.00, currency: "EUR", soldOut: true},
		// Before today and beyond the 6-month horizon: not fetched.
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-11-09T06:00", arrival: "2026-11-09T07:50", price: 50.00, currency: "PLN"},
		fakeFlight{from: "KRK", to: "BGY", departure: "2027-06-01T06:00", arrival: "2027-06-01T07:50", price: 50.00, currency: "PLN"},
	)

	env.refresh(t)

	assertEqual(t, "flights", storedFlights(t, env.pool), []string{
		"BGY→KRK 2026-12-06 19:55 → 2026-12-06 21:45 1999 EUR @2026-11-10T08:00",
		"BGY→KRK 2026-12-07 09:00 → 2026-12-07 10:50 no price @2026-11-10T08:00",
		"KRK→BGY 2026-12-04 05:50 → 2026-12-04 07:40 7027 PLN @2026-11-10T08:00",
		"KRK→BGY 2026-12-04 18:15 → 2026-12-04 20:05 12000 PLN @2026-11-10T08:00",
		"KRK→BGY 2026-12-04 22:05 → 2026-12-04 23:55 9877 PLN @2026-11-10T08:00",
	})
}

func TestWorkerStoresExtraFlightsWithoutPriceWhenTimeWindowPricingFails(t *testing.T) {
	env := start(t)
	env.ryanair.setFlights(
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T05:50", arrival: "2026-12-04T07:40", price: 70.27, currency: "PLN"},
		// Lands after midnight: the timetable gives only times of day.
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T23:30", arrival: "2026-12-05T01:20", price: 98.77, currency: "PLN"},
	)
	env.ryanair.fail("oneWayFares", "", http.StatusInternalServerError, -1)

	env.refresh(t)

	assertEqual(t, "flights", storedFlights(t, env.pool), []string{
		"KRK→BGY 2026-12-04 05:50 → 2026-12-04 07:40 7027 PLN @2026-11-10T08:00",
		"KRK→BGY 2026-12-04 23:30 → 2026-12-05 01:20 no price @2026-11-10T08:00",
	})
}

func TestWorkerUpdatesStoredPricesAndDropsCancelledFlightsOnRefetch(t *testing.T) {
	env := start(t)
	env.ryanair.setFlights(
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T05:50", arrival: "2026-12-04T07:40", price: 70.27, currency: "PLN"},
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T22:05", arrival: "2026-12-04T23:55", price: 98.77, currency: "PLN"},
	)
	env.refresh(t)

	env.ryanair.setFlights(
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T05:50", arrival: "2026-12-04T07:40", price: 89.00, currency: "PLN"},
	)
	env.clock = now.Add(13 * time.Hour) // the December prices are due again
	env.refresh(t)

	assertEqual(t, "flights", storedFlights(t, env.pool), []string{
		"KRK→BGY 2026-12-04 05:50 → 2026-12-04 07:40 8900 PLN @2026-11-10T21:00",
	})
}

func TestWorkerRetriesRyanairErrorsWithBackoff(t *testing.T) {
	env := start(t)
	env.ryanair.setFlights(
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T05:50", arrival: "2026-12-04T07:40", price: 70.27, currency: "PLN"},
	)
	env.ryanair.fail("cheapestPerDay", "KRK-BGY", http.StatusTooManyRequests, 1)
	env.ryanair.fail("timetable", "KRK-BGY", http.StatusBadGateway, 2)

	env.refresh(t)

	assertEqual(t, "flights", storedFlights(t, env.pool), []string{
		"KRK→BGY 2026-12-04 05:50 → 2026-12-04 07:40 7027 PLN @2026-11-10T08:00",
	})
}

func TestWorkerKeepsStoredPricesOfARouteThatFailsAndRefreshesTheOthers(t *testing.T) {
	env := start(t)
	env.ryanair.setFlights(
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T05:50", arrival: "2026-12-04T07:40", price: 70.27, currency: "PLN"},
		fakeFlight{from: "BGY", to: "KRK", departure: "2026-12-06T19:55", arrival: "2026-12-06T21:45", price: 19.99, currency: "EUR"},
	)
	env.refresh(t)

	env.ryanair.setFlights(
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T05:50", arrival: "2026-12-04T07:40", price: 99.00, currency: "PLN"},
		fakeFlight{from: "BGY", to: "KRK", departure: "2026-12-06T19:55", arrival: "2026-12-06T21:45", price: 24.99, currency: "EUR"},
	)
	env.ryanair.fail("cheapestPerDay", "KRK-BGY", http.StatusInternalServerError, -1)
	env.clock = now.Add(13 * time.Hour) // the December prices are due again
	err := env.worker.RefreshPrices(t.Context())

	if err == nil {
		t.Errorf("RefreshPrices reported no error, want the failed route")
	}
	assertEqual(t, "flights", storedFlights(t, env.pool), []string{
		"BGY→KRK 2026-12-06 19:55 → 2026-12-06 21:45 2499 EUR @2026-11-10T21:00",
		"KRK→BGY 2026-12-04 05:50 → 2026-12-04 07:40 7027 PLN @2026-11-10T08:00",
	})
}

func TestWorkerStoresNBPExchangeRatesFromTablesAAndB(t *testing.T) {
	env := start(t)

	if err := env.worker.RefreshExchangeRates(t.Context()); err != nil {
		t.Fatalf("RefreshExchangeRates: %v", err)
	}

	assertEqual(t, "exchange rates", storedRates(t, env.pool), []string{
		"EUR 2026-11-10 4.251200",
		"GBP 2026-11-10 4.987300",
		// Table B: currencies outside table A, e.g. Ryanair's fares from Morocco.
		"MAD 2026-11-04 0.401200",
	})
}

func TestWorkerStoresTableAWhenTableBFails(t *testing.T) {
	env := start(t)
	env.nbp.failing["B"] = true

	if err := env.worker.RefreshExchangeRates(t.Context()); err == nil {
		t.Errorf("RefreshExchangeRates reported no error, want table B's failure")
	}

	assertEqual(t, "exchange rates", storedRates(t, env.pool), []string{
		"EUR 2026-11-10 4.251200",
		"GBP 2026-11-10 4.987300",
	})
}

func TestWorkerRefreshesNearMonthsMoreOftenThanFarOnes(t *testing.T) {
	env := start(t)
	months := func(ms ...string) []string {
		var want []string
		for _, m := range ms {
			want = append(want, "BGY-KRK "+m, "KRK-BGY "+m)
		}
		return want
	}
	all := months("2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05")

	// Today is 10 November. November and December start departing within 4 weeks (every 12 h),
	// January and February within 13 weeks (every 2 days), March to May later (weekly).
	for _, step := range []struct {
		after time.Duration
		want  []string
	}{
		{0, all},
		{11 * time.Hour, nil},
		{13 * time.Hour, months("2026-11", "2026-12")},
		{49 * time.Hour, months("2026-11", "2026-12", "2027-01", "2027-02")},
		{7*24*time.Hour + time.Hour, all},
	} {
		env.clock = now.Add(step.after)
		env.refresh(t)
		assertEqual(t, fmt.Sprintf("months fetched %v after the first refresh, nearest first", step.after),
			env.ryanair.takeCheapestPerDayRequests(), step.want)
	}
}

func TestWorkerRetriesAFailedRouteMonthOnTheNextRefresh(t *testing.T) {
	env := start(t)
	env.ryanair.fail("cheapestPerDay", "KRK-BGY", http.StatusInternalServerError, -1)
	if err := env.worker.RefreshCatalogue(t.Context()); err != nil {
		t.Fatalf("RefreshCatalogue: %v", err)
	}
	if err := env.worker.RefreshPrices(t.Context()); err == nil {
		t.Fatalf("RefreshPrices reported no error, want KRK→BGY's failures")
	}
	env.ryanair.takeCheapestPerDayRequests()

	env.ryanair.fail("cheapestPerDay", "KRK-BGY", 0, 0)
	env.clock = now.Add(time.Hour)
	env.refresh(t)

	got := env.ryanair.takeCheapestPerDayRequests()
	if !slices.Contains(got, "KRK-BGY 2027-05") || slices.Contains(got, "BGY-KRK 2027-05") {
		t.Errorf("fetched %v, want every KRK→BGY month again and none of BGY→KRK", got)
	}
}

func TestSearchFindsFlightsStoredByTheWorker(t *testing.T) {
	env := start(t)
	env.ryanair.setFlights(
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T18:15", arrival: "2026-12-04T20:05", price: 50.00, currency: "PLN"},
		fakeFlight{from: "BGY", to: "KRK", departure: "2026-12-06T19:55", arrival: "2026-12-06T21:45", price: 19.99, currency: "EUR"},
	)
	env.refresh(t)
	if err := env.worker.RefreshExchangeRates(t.Context()); err != nil {
		t.Fatalf("RefreshExchangeRates: %v", err)
	}

	a, err := app.New(t.Context(), app.Config{DatabaseURL: env.url, Version: "test"})
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	t.Cleanup(a.Close)
	srv := httptest.NewServer(a.Handler())
	t.Cleanup(srv.Close)
	resp, err := http.Post(srv.URL+"/api/search", "application/json", strings.NewReader(`{
		"kind": "roundTrip",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-31"},
		"stayLength": {"min": 2, "max": 2}
	}`))
	if err != nil {
		t.Fatalf("POST /api/search: %v", err)
	}
	defer resp.Body.Close()
	var body struct {
		Offers []struct {
			Price struct {
				Amount      float64 `json:"amount"`
				Approximate bool    `json:"approximate"`
			} `json:"price"`
		} `json:"offers"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode search response: %v", err)
	}

	// 50.00 PLN + 19.99 EUR × 4.2512 PLN/EUR (≈ 84.98 PLN).
	if len(body.Offers) != 1 || body.Offers[0].Price.Amount != 134.98 || !body.Offers[0].Price.Approximate {
		t.Errorf("offers = %+v, want one at ≈134.98 PLN", body.Offers)
	}
}

type env struct {
	url     string
	pool    *pgxpool.Pool
	ryanair *fakeRyanair
	nbp     *fakeNBP
	worker  *worker.Worker
	clock   time.Time
}

// start migrates a fresh database and points a worker at a fake Ryanair (KRK ⇄ BGY) and a fake NBP.
func start(t *testing.T) *env {
	t.Helper()
	_, url := databasetest.StartPostgres(t)
	db, err := database.Open(t.Context(), url)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(db.Close)

	fake, ryanairURL := newFakeRyanair(t)
	fake.airports = []fakeAirport{
		{"KRK", "Krakow", "Europe/Warsaw", "KRAKOW", "Krakow", "pl", "Poland"},
		{"BGY", "Milan Bergamo", "Europe/Rome", "BERGAMO", "Bergamo", "it", "Italy"},
		{"MXP", "Milan Malpensa", "Europe/Rome", "MILAN", "Milan", "it", "Italy"},
	}
	fake.routes["KRK"] = []string{"BGY"}
	nbpFake, nbpURL := newFakeNBP(t)
	nbpFake.tables["A"] = fakeNBPTable{"2026-11-10", map[string]float64{"EUR": 4.2512, "GBP": 4.9873}}
	nbpFake.tables["B"] = fakeNBPTable{"2026-11-04", map[string]float64{"MAD": 0.4012}}

	client := fetch.NewClient(fetch.Options{InitialBackoff: time.Millisecond})
	e := &env{url: url, pool: db.Pool, ryanair: fake, nbp: nbpFake, clock: now}
	e.worker = worker.New(worker.Config{
		Pool:    db.Pool,
		Ryanair: ryanair.NewHTTPClient(ryanairURL, client),
		NBP:     nbp.NewClient(nbpURL, client),
		Now:     func() time.Time { return e.clock },
	})
	return e
}

// refresh runs a full catalogue and price refresh and fails the test on any error.
func (e *env) refresh(t *testing.T) {
	t.Helper()
	if err := e.worker.RefreshCatalogue(t.Context()); err != nil {
		t.Fatalf("RefreshCatalogue: %v", err)
	}
	if err := e.worker.RefreshPrices(t.Context()); err != nil {
		t.Fatalf("RefreshPrices: %v", err)
	}
}

// storedRates describes every stored exchange rate in one line, sorted.
func storedRates(t *testing.T, pool *pgxpool.Pool) []string {
	t.Helper()
	return queryStrings(t, pool, `SELECT currency || ' ' || rate_date || ' ' || rate FROM exchange_rates ORDER BY currency`)
}

// storedFlights describes every stored flight in one line, sorted.
func storedFlights(t *testing.T, pool *pgxpool.Pool) []string {
	t.Helper()
	return queryStrings(t, pool, `
		SELECT departure_airport || '→' || arrival_airport || ' '
			|| departure_date || ' ' || to_char(departure_time, 'HH24:MI') || ' → '
			|| arrival_date || ' ' || to_char(arrival_time, 'HH24:MI') || ' '
			|| COALESCE(price_amount || ' ' || price_currency, 'no price') || ' @'
			|| to_char(fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI')
		FROM flights ORDER BY 1`)
}

func queryStrings(t *testing.T, pool *pgxpool.Pool, sql string) []string {
	t.Helper()
	ctx := context.Background()
	rows, err := pool.Query(ctx, sql)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	got, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatalf("read rows: %v", err)
	}
	return got
}

func assertEqual(t *testing.T, what string, got, want []string) {
	t.Helper()
	if !slices.Equal(got, want) {
		t.Errorf("%s:\n got: %s\nwant: %s", what, strings.Join(got, "\n      "), strings.Join(want, "\n      "))
	}
}
