package app_test

import (
	"slices"
	"testing"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/airline"
	"github.com/hasia17/gocitybreak/backend/internal/nbp"
	"github.com/hasia17/gocitybreak/backend/internal/pricestore"
	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fixture keeps test data readable while routing all database writes through the price store.
type fixture struct {
	airports []fixtureAirport
	// flights are Ryanair's; wizzair are Wizz Air's, with estimated arrivals.
	flights, wizzair []fixtureFlight
	rates            []fixtureRate
}

type fixtureAirport struct {
	code, name, zone                             string
	supported                                    bool
	cityCode, cityName, countryCode, countryName string
}

type fixtureFlight struct {
	from, to, departureDate, departureTime, arrivalDate, arrivalTime string
	amount                                                           int64 // -1 means the flight has no price
	currency, fetchedAt                                              string
}

type fixtureRate struct {
	currency, date string
	rate           float64
}

func seed(t *testing.T, url string, fixtures ...fixture) {
	t.Helper()
	ctx := t.Context()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("open price store: %v", err)
	}
	t.Cleanup(pool.Close)
	store := pricestore.New(pool)
	var airports []ryanair.Airport
	var rates []nbp.Rate
	var flights []pricestore.Flight
	for _, data := range fixtures {
		for _, a := range data.airports {
			country := a.countryCode
			if a.supported && country == "" {
				country = "pl"
			}
			airports = append(airports, ryanair.Airport{Code: a.code, Name: a.name, TimeZone: a.zone, CityCode: a.cityCode, CityName: a.cityName, CountryCode: country, CountryName: a.countryName})
		}
		for _, r := range data.rates {
			rates = append(rates, nbp.Rate{Currency: r.currency, Date: fixtureTime(t, time.DateOnly, r.date), PLN: r.rate})
		}
		for _, f := range data.flights {
			flights = append(flights, f.flight(t, airline.Ryanair, false))
		}
		for _, f := range data.wizzair {
			flights = append(flights, f.flight(t, airline.Wizzair, true))
		}
	}
	if err := store.UpsertAirports(ctx, airports); err != nil {
		t.Fatalf("seed airports: %v", err)
	}
	if err := store.UpsertExchangeRates(ctx, rates); err != nil {
		t.Fatalf("seed rates: %v", err)
	}
	if err := store.UpsertFlights(ctx, flights); err != nil {
		t.Fatalf("seed flights: %v", err)
	}
}

func (f fixtureFlight) flight(t *testing.T, a airline.Airline, estimatedArrival bool) pricestore.Flight {
	t.Helper()
	var price *ryanair.Money
	if f.amount >= 0 {
		price = &ryanair.Money{Amount: f.amount, Currency: f.currency}
	}
	return pricestore.Flight{Airline: a, DepartureAirport: f.from, ArrivalAirport: f.to,
		Departure:        fixtureTime(t, "2006-01-02 15:04", f.departureDate+" "+f.departureTime),
		Arrival:          fixtureTime(t, "2006-01-02 15:04", f.arrivalDate+" "+f.arrivalTime),
		EstimatedArrival: estimatedArrival,
		Price:            price, FetchedAt: fixtureTime(t, time.RFC3339, f.fetchedAt)}
}

func fixtureTime(t *testing.T, layout, value string) time.Time {
	t.Helper()
	v, err := time.Parse(layout, value)
	if err != nil {
		t.Fatalf("parse fixture time %q: %v", value, err)
	}
	return v
}

func destinationFlights() fixture {
	var codes []string
	for _, a := range europeanAirports.airports {
		if a.countryCode != "pl" {
			codes = append(codes, a.code)
		}
	}
	slices.Sort(codes)
	var flights []fixtureFlight
	for i, code := range codes {
		flights = append(flights, fixtureFlight{"KRK", code, "2026-12-05", "06:00", "2026-12-05", "09:00", 10001 + int64(i), "PLN", "2026-11-10T08:00:00Z"})
	}
	return fixture{flights: flights}
}
