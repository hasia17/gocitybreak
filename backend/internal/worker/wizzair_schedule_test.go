package worker_test

import (
	"strings"
	"testing"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
	"github.com/hasia17/gocitybreak/backend/internal/wizzair"
)

func TestWorkerStoresScheduledAndEstimatedWizzairArrivals(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}
	env.wizzair.setFlights(
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-05T06:00", price: 99.00, currency: "PLN"},
		// No flight of the schedule departs at 14:05, so this one's arrival stays estimated.
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-06T14:05", price: 89.00, currency: "PLN"},
		fakeFlight{from: "BGY", to: "KRK", departure: "2026-12-06T23:10", price: 25.99, currency: "EUR"},
	)
	// Flight status of the next days: the 06:00 takes 1 h 55 and the 23:10 takes 1 h 50, whatever the distance says.
	env.wizzair.schedule = []fakeFlight{
		{from: "KRK", to: "BGY", departure: "2026-11-17T06:00", arrival: "2026-11-17T07:55"},
		{from: "BGY", to: "KRK", departure: "2026-11-17T23:10", arrival: "2026-11-18T01:00"},
	}

	env.refresh(t)

	assertEqual(t, "Wizz Air flights", storedWizzairFlights(t, env), []string{
		"BGY→KRK 2026-12-06 23:10 → 2026-12-07 01:00 2599 EUR @2026-11-10T08:00",
		"KRK→BGY 2026-12-05 06:00 → 2026-12-05 07:55 9900 PLN @2026-11-10T08:00",
		"KRK→BGY 2026-12-06 14:05 → ~2026-12-06 15:50 8900 PLN @2026-11-10T08:00",
	})
}

func TestWorkerConvertsScheduledBlockTimesBetweenTimeZones(t *testing.T) {
	env := start(t)
	env.ryanair.airports = append(env.ryanair.airports,
		ryanair.Airport{Code: "LTN", Name: "London Luton", TimeZone: "Europe/London", CityCode: "LONDON", CityName: "London", CountryCode: "gb", CountryName: "United Kingdom"})
	env.wizzair.stations = []wizzair.Station{flies(krk, "LTN"), flies(ltn, "KRK")}
	env.wizzair.setFlights(
		fakeFlight{from: "KRK", to: "LTN", departure: "2026-12-05T06:00", price: 149.00, currency: "PLN"},
		fakeFlight{from: "LTN", to: "KRK", departure: "2026-12-07T08:30", price: 30.99, currency: "GBP"},
	)
	// Flight status gives local times: Luton is an hour behind Kraków, so 06:00 → 07:40 is 2 h 40 in the air and
	// 08:30 → 11:55 is 2 h 25.
	env.wizzair.schedule = []fakeFlight{
		{from: "KRK", to: "LTN", departure: "2026-11-17T06:00", arrival: "2026-11-17T07:40"},
		{from: "LTN", to: "KRK", departure: "2026-11-17T08:30", arrival: "2026-11-17T11:55"},
	}

	env.refresh(t)

	assertEqual(t, "Wizz Air flights", storedWizzairFlights(t, env), []string{
		"KRK→LTN 2026-12-05 06:00 → 2026-12-05 07:40 14900 PLN @2026-11-10T08:00",
		"LTN→KRK 2026-12-07 08:30 → 2026-12-07 11:55 3099 GBP @2026-11-10T08:00",
	})
}

func TestWorkerAppliesALearntBlockTimeToFlightsAlreadyStored(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}
	// April is refreshed only weekly, so a day later it is not refetched.
	env.wizzair.setFlights(fakeFlight{from: "KRK", to: "BGY", departure: "2027-04-10T06:00", price: 99.00, currency: "PLN"})
	env.refresh(t)
	assertEqual(t, "before the schedule is known", storedWizzairFlights(t, env), []string{
		"KRK→BGY 2027-04-10 06:00 → ~2027-04-10 07:45 9900 PLN @2026-11-10T08:00",
	})

	env.wizzair.schedule = []fakeFlight{{from: "KRK", to: "BGY", departure: "2026-11-17T06:00", arrival: "2026-11-17T07:55"}}
	env.clock = now.Add(25 * time.Hour)
	env.refresh(t)

	assertEqual(t, "after", storedWizzairFlights(t, env), []string{
		"KRK→BGY 2027-04-10 06:00 → 2027-04-10 07:55 9900 PLN @2026-11-10T08:00",
	})
}

func TestWorkerFollowsAChangedBlockTime(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}
	env.wizzair.setFlights(fakeFlight{from: "KRK", to: "BGY", departure: "2027-04-10T06:00", price: 99.00, currency: "PLN"})
	env.wizzair.schedule = []fakeFlight{{from: "KRK", to: "BGY", departure: "2026-11-17T06:00", arrival: "2026-11-17T07:55"}}
	env.refresh(t)

	env.wizzair.schedule = []fakeFlight{{from: "KRK", to: "BGY", departure: "2026-11-18T06:00", arrival: "2026-11-18T08:05"}}
	env.clock = now.Add(25 * time.Hour)
	env.refresh(t)

	assertEqual(t, "flights", storedWizzairFlights(t, env), []string{
		"KRK→BGY 2027-04-10 06:00 → 2027-04-10 08:05 9900 PLN @2026-11-10T08:00",
	})
}

func TestWorkerReadsEachRoutesFlightStatusOnceADay(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}

	var got []string
	for _, after := range []time.Duration{0, 12 * time.Hour, 23 * time.Hour, 25 * time.Hour} {
		env.clock = now.Add(after)
		env.refresh(t)
		got = append(got, strings.Join(env.wizzair.takeScheduleRequests(), " "))
	}

	assertEqual(t, "flight status requests at 0, 12, 23 and 25 hours", got,
		[]string{"BGY-KRK KRK-BGY", "", "", "BGY-KRK KRK-BGY"})
}

func TestWorkerPricesWizzairFlightsEstimatedWhenFlightStatusFails(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}
	env.wizzair.setFlights(fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-05T06:00", price: 99.00, currency: "PLN"})
	env.wizzair.fail("schedule", "", true)

	env.refresh(t)

	assertEqual(t, "Wizz Air flights", storedWizzairFlights(t, env), []string{
		"KRK→BGY 2026-12-05 06:00 → ~2026-12-05 07:45 9900 PLN @2026-11-10T08:00",
	})
	if !strings.Contains(env.logs.String(), "flight status") {
		t.Errorf("logs don't report the failed flight status:\n%s", env.logs)
	}

	// The failure doesn't count as a refresh: the next pass asks again.
	env.wizzair.fail("schedule", "", false)
	env.wizzair.takeScheduleRequests()
	env.refresh(t)
	assertEqual(t, "flight status requests after the failure", env.wizzair.takeScheduleRequests(), []string{"BGY-KRK", "KRK-BGY"})
}
