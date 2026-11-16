package worker_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/airline"
	"github.com/hasia17/gocitybreak/backend/internal/app"
	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
	"github.com/hasia17/gocitybreak/backend/internal/wizzair"
)

// Wizz Air's stations, with the coordinates of its station network (asset/map, 2026-11-16).
var (
	krk = wizzair.Station{Code: "KRK", Names: names("Kraków", "Kraków"), CountryNames: names("Poland", "Polska"), CountryCode: "pl", Currency: "PLN", CityGroup: "SPQ",
		Latitude: 50.07777777777778, Longitude: 19.784722222222225}
	bgy = wizzair.Station{Code: "BGY", Names: names("Milan Bergamo", "Mediolan-Bergamo"), CountryNames: names("Italy", "Włochy"), CountryCode: "it", Currency: "EUR", CityGroup: "MIL",
		Latitude: 45.66833333333333, Longitude: 9.700277777777776}
	ltn = wizzair.Station{Code: "LTN", Names: names("London Luton", "Londyn-Luton"), CountryNames: names("United Kingdom", "Wielka Brytania"), CountryCode: "gb", Currency: "GBP", CityGroup: "LON",
		Latitude: 51.874722222222225, Longitude: -0.3683333333333333}
	kut = wizzair.Station{Code: "KUT", Names: names("Kutaisi", "Kutaisi"), CountryNames: names("Georgia", "Gruzja"), CountryCode: "ge", Currency: "GEL", CityGroup: "GEL",
		Latitude: 42.17666666666666, Longitude: 42.4825}
)

// flies returns s flying directly to the given stations.
func flies(s wizzair.Station, to ...string) wizzair.Station {
	s.Connections = to
	return s
}

func storedWizzairFlights(t *testing.T, e *env) []string {
	t.Helper()
	return storedFlightsOf(t, e.pool, airline.Wizzair)
}

func TestWorkerStoresWizzairFlightsWithEstimatedArrivals(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}
	env.wizzair.setFlights(
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-05T06:00", price: 99.00, currency: "PLN"},
		// Priced in the departure station's currency; lands after midnight.
		fakeFlight{from: "BGY", to: "KRK", departure: "2026-12-06T23:00", price: 25.99, currency: "EUR"},
	)

	env.refresh(t)

	// KRK–BGY is 897 km: 38 min + 0.0761 min/km ≈ 106 min, rounded to 1 h 45.
	assertEqual(t, "Wizz Air flights", storedWizzairFlights(t, env), []string{
		"BGY→KRK 2026-12-06 23:00 → ~2026-12-07 00:45 2599 EUR @2026-11-10T08:00",
		"KRK→BGY 2026-12-05 06:00 → ~2026-12-05 07:45 9900 PLN @2026-11-10T08:00",
	})
}

func TestWorkerEstimatesArrivalsInTheArrivalAirportsLocalTime(t *testing.T) {
	env := start(t)
	env.ryanair.airports = append(env.ryanair.airports,
		ryanair.Airport{Code: "LTN", Name: "London Luton", TimeZone: "Europe/London", CityCode: "LONDON", CityName: "London", CountryCode: "gb", CountryName: "United Kingdom"})
	env.wizzair.stations = []wizzair.Station{flies(krk, "LTN"), flies(ltn, "KRK")}
	env.wizzair.setFlights(
		fakeFlight{from: "KRK", to: "LTN", departure: "2026-12-05T06:00", price: 149.00, currency: "PLN"},
		fakeFlight{from: "LTN", to: "KRK", departure: "2026-12-07T08:00", price: 30.99, currency: "GBP"},
	)

	env.refresh(t)

	// KRK–LTN is 1,420 km: about 2 h 25 in the air, and London is an hour behind Kraków.
	assertEqual(t, "Wizz Air flights", storedWizzairFlights(t, env), []string{
		"KRK→LTN 2026-12-05 06:00 → ~2026-12-05 07:25 14900 PLN @2026-11-10T08:00",
		"LTN→KRK 2026-12-07 08:00 → ~2026-12-07 11:25 3099 GBP @2026-11-10T08:00",
	})
}

func TestWorkerSkipsWizzairDaysWithoutAPrice(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}
	env.wizzair.setFlights(
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-05T06:00", price: 99.00, currency: "PLN"},
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-06T06:00", price: 89.00, currency: "PLN"},
	)
	env.wizzair.unpriced["KRK-BGY 2026-12-05"] = true

	env.refresh(t)

	assertEqual(t, "Wizz Air flights", storedWizzairFlights(t, env), []string{
		"KRK→BGY 2026-12-06 06:00 → ~2026-12-06 07:45 8900 PLN @2026-11-10T08:00",
	})
}

func TestWorkerPricesTheLaterWizzairFlightsOfADayStepByStep(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}
	env.wizzair.setFlights(
		// 06:00 and 14:05 cost more than a later flight of the day: no query prices them.
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-12T06:00", price: 199.00, currency: "PLN"},
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-12T11:40", price: 149.00, currency: "PLN"},
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-12T14:05", price: 209.00, currency: "PLN"},
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-12T16:35", price: 179.00, currency: "PLN"},
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-12T21:00", price: 259.00, currency: "PLN"},
		// Equally cheap: the earlier one is the day's cheapest, the later one the next step's.
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-13T06:00", price: 99.00, currency: "PLN"},
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-13T11:40", price: 99.00, currency: "PLN"},
	)

	env.refresh(t)

	assertEqual(t, "Wizz Air flights", storedWizzairFlights(t, env), []string{
		"KRK→BGY 2026-12-12 11:40 → ~2026-12-12 13:25 14900 PLN @2026-11-10T08:00",
		"KRK→BGY 2026-12-12 16:35 → ~2026-12-12 18:20 17900 PLN @2026-11-10T08:00",
		"KRK→BGY 2026-12-12 21:00 → ~2026-12-12 22:45 25900 PLN @2026-11-10T08:00",
		"KRK→BGY 2026-12-13 06:00 → ~2026-12-13 07:45 9900 PLN @2026-11-10T08:00",
		"KRK→BGY 2026-12-13 11:40 → ~2026-12-13 13:25 9900 PLN @2026-11-10T08:00",
	})
	assertEqual(t, "time-of-day queries", timeOfDayRequests(env.wizzair.takeRequests()), []string{
		"KRK-BGY from 2026-12-12 14:05",
		"KRK-BGY from 2026-12-12 21:00",
		"KRK-BGY from 2026-12-13 11:40",
	})
}

func timeOfDayRequests(requests []string) []string {
	var got []string
	for _, r := range requests {
		if strings.Contains(r, " from ") {
			got = append(got, r)
		}
	}
	return got
}

func TestWorkerKeepsOnlyTheCheapestFlightOfADayWhenTheTimeOfDayIsIgnored(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}
	env.wizzair.setFlights(
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-12T06:00", price: 199.00, currency: "PLN"},
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-12T11:40", price: 149.00, currency: "PLN"},
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-12T16:35", price: 179.00, currency: "PLN"},
	)
	env.wizzair.ignoresTimeOfDay = true

	env.refresh(t)

	assertEqual(t, "Wizz Air flights", storedWizzairFlights(t, env), []string{
		"KRK→BGY 2026-12-12 11:40 → ~2026-12-12 13:25 14900 PLN @2026-11-10T08:00",
	})
	if !strings.Contains(env.logs.String(), "airline=wizzair") || !strings.Contains(env.logs.String(), "time of day ignored") {
		t.Errorf("logs don't report the ignored time of day:\n%s", env.logs)
	}
}

func TestWorkerRefreshesNearWizzairMonthsMoreOftenThanFarOnes(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}
	months := func(windows ...string) []string {
		var want []string
		for _, w := range windows {
			want = append(want, "BGY-KRK "+w, "KRK-BGY "+w)
		}
		return want
	}
	near := []string{"2026-11-10..2026-11-30", "2026-12-01..2026-12-31"}
	all := months(append(near, "2027-01-01..2027-01-31", "2027-02-01..2027-02-28", "2027-03-01..2027-03-31",
		"2027-04-01..2027-04-30", "2027-05-01..2027-05-12")...)

	for _, step := range []struct {
		after time.Duration
		want  []string
	}{
		{0, all},
		{11 * time.Hour, nil},
		{13 * time.Hour, months(near...)},
	} {
		env.clock = now.Add(step.after)
		env.refresh(t)
		assertEqual(t, fmt.Sprintf("Wizz Air windows fetched %v after the first refresh", step.after),
			env.wizzair.takeRequests(), step.want)
	}
}

func TestWorkerKeepsRefreshingRyanairWhenWizzairFails(t *testing.T) {
	env := start(t)
	env.ryanair.setFlights(
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T05:50", arrival: "2026-12-04T07:40", price: 70.27, currency: "PLN"},
	)
	env.wizzair.fail("stations", "", true)
	if err := env.worker.RefreshCatalogue(t.Context()); err != nil {
		t.Fatalf("RefreshCatalogue: %v", err)
	}

	err := env.worker.RefreshPrices(t.Context())

	if err == nil {
		t.Errorf("RefreshPrices reported no error, want Wizz Air's failure")
	}
	assertEqual(t, "Ryanair flights", storedFlights(t, env.pool), []string{
		"KRK→BGY 2026-12-04 05:50 → 2026-12-04 07:40 7027 PLN @2026-11-10T08:00",
	})
	if !strings.Contains(env.logs.String(), "airline=wizzair") {
		t.Errorf("logs don't name the failing airline:\n%s", env.logs)
	}
}

func TestWorkerKeepsRefreshingWizzairWhenRyanairFails(t *testing.T) {
	env := start(t)
	env.ryanair.fail("cheapestPerDay", "", true)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}
	env.wizzair.setFlights(fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-05T06:00", price: 99.00, currency: "PLN"})
	if err := env.worker.RefreshCatalogue(t.Context()); err != nil {
		t.Fatalf("RefreshCatalogue: %v", err)
	}

	err := env.worker.RefreshPrices(t.Context())

	if err == nil {
		t.Errorf("RefreshPrices reported no error, want Ryanair's failures")
	}
	assertEqual(t, "Wizz Air flights", storedWizzairFlights(t, env), []string{
		"KRK→BGY 2026-12-05 06:00 → ~2026-12-05 07:45 9900 PLN @2026-11-10T08:00",
	})
	if !strings.Contains(env.logs.String(), "airline=ryanair") {
		t.Errorf("logs don't name the failing airline:\n%s", env.logs)
	}
}

func TestSearchMixesAirlinesStoredByTheWorker(t *testing.T) {
	env := start(t)
	env.ryanair.setFlights(
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T18:15", arrival: "2026-12-04T20:05", price: 50.00, currency: "PLN"},
	)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}
	env.wizzair.setFlights(fakeFlight{from: "BGY", to: "KRK", departure: "2026-12-06T19:55", price: 19.99, currency: "EUR"})
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
	type flight struct {
		Airline          string `json:"airline"`
		EstimatedArrival bool   `json:"estimatedArrival"`
		Arrival          struct {
			Time string `json:"time"`
		} `json:"arrival"`
	}
	var body struct {
		Offers []struct {
			Outbound struct{ Flights []flight } `json:"outbound"`
			Inbound  struct{ Flights []flight } `json:"inbound"`
			Price    struct {
				Amount float64 `json:"amount"`
			} `json:"price"`
		} `json:"offers"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode search response: %v", err)
	}

	// 50.00 PLN + 19.99 EUR × 4.2512 PLN/EUR (≈ 84.98 PLN), out with Ryanair and back with Wizz Air.
	if len(body.Offers) != 1 {
		t.Fatalf("offers = %+v, want one", body.Offers)
	}
	o := body.Offers[0]
	got := []string{fmt.Sprint(o.Price.Amount)}
	for _, f := range slices.Concat(o.Outbound.Flights, o.Inbound.Flights) {
		got = append(got, fmt.Sprintf("%s %s estimated=%t", f.Airline, f.Arrival.Time, f.EstimatedArrival))
	}
	assertEqual(t, "offer", got, []string{"134.98", "ryanair 20:05 estimated=false", "wizzair 21:40 estimated=true"})
}
