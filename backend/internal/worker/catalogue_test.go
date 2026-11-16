package worker_test

import (
	"slices"
	"strings"
	"testing"

	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
	"github.com/hasia17/gocitybreak/backend/internal/wizzair"
)

// Wizz Air stations beyond the ones in wizzair_test.go (asset/map, 2026-11-16). Their city groupings ("mac") are
// Wizz Air's own.
var (
	ory = wizzair.Station{Code: "ORY", Names: names("Paris Orly", "Paryż-Orly"), CountryNames: names("France", "Francja"),
		CountryCode: "fr", Currency: "EUR", CityGroup: "PAR", Latitude: 48.72527777777778, Longitude: 2.359444444444444}
	bva = wizzair.Station{Code: "BVA", Names: names("Paris Beauvais", "Paryż-Beauvais"), CountryNames: names("France", "Francja"),
		CountryCode: "fr", Currency: "EUR", CityGroup: "PAR", Latitude: 49.45444444444444, Longitude: 2.1127777777777776}
	rdo = wizzair.Station{Code: "RDO", Names: names("Warsaw Radom", "Warszawa Radom"), CountryNames: names("Poland", "Polska"),
		CountryCode: "pl", Currency: "PLN", CityGroup: "WSW", Latitude: 51.38916666666667, Longitude: 21.213333333333335}
	ktw = wizzair.Station{Code: "KTW", Names: names("Katowice", "Katowice"), CountryNames: names("Poland", "Polska"),
		CountryCode: "pl", Currency: "PLN", CityGroup: "SPQ", Latitude: 50.48333333333333, Longitude: 19.083333333333332}
	dxb = wizzair.Station{Code: "DXB", Names: names("Dubai", "Dubaj"), CountryNames: names("United Arab Emirates", "Zjednoczone Emiraty Arabskie"),
		CountryCode: "ae", Currency: "AED", CityGroup: "UAE", Latitude: 25.25277777777778, Longitude: 55.36444444444444}
	auh = wizzair.Station{Code: "AUH", Names: names("Abu Dhabi", "Abu Zabi"), CountryNames: names("United Arab Emirates", "Zjednoczone Emiraty Arabskie"),
		CountryCode: "ae", Currency: "AED", CityGroup: "UAE", Latitude: 24.433, Longitude: 54.651}
)

func names(en, pl string) map[string]string { return map[string]string{"en": en, "pl": pl} }

// airportsOf describes the airports of the catalogue with the given codes in one line each: code, names, time zone,
// city, country and whether it is supported.
func airportsOf(t *testing.T, e *env, codes ...string) []string {
	t.Helper()
	all := queryStrings(t, e.pool, `
		SELECT code || ' ' || (names->>'en') || '/' || coalesce((names->>'pl'), '-') || ' ' || time_zone || ' city '
			|| coalesce(city_code, '-') || ' ' || coalesce((city_names->>'en'), '-') || '/' || coalesce((city_names->>'pl'), '-')
			|| ' country ' || country_code || ' ' || (country_names->>'en') || '/' || coalesce((country_names->>'pl'), '-')
			|| CASE WHEN supported THEN ' supported' ELSE '' END
		FROM airports ORDER BY code`)
	var got []string
	for _, line := range all {
		if code, _, _ := strings.Cut(line, " "); slices.Contains(codes, code) {
			got = append(got, line)
		}
	}
	return got
}

func TestWorkerKeepsRyanairsDataForAirportsRyanairKnows(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}

	env.refresh(t)

	assertEqual(t, "airports Ryanair knows", airportsOf(t, env, "KRK", "BGY"), []string{
		"BGY Milan Bergamo/- Europe/Rome city BERGAMO Bergamo/- country it Italy/-",
		"KRK Krakow/- Europe/Warsaw city KRAKOW Krakow/- country pl Poland/- supported",
	})
}

func TestWorkerAddsAirportsOnlyWizzairFliesToWithTheirNamesCountryAndTimeZone(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(krk, "KUT"), flies(kut, "KRK")}

	env.refresh(t)

	// Kutaisi's time zone is looked up from its coordinates; no city of ours knows it, so it is a city of its own.
	assertEqual(t, "Kutaisi", airportsOf(t, env, "KUT"), []string{
		"KUT Kutaisi/Kutaisi Asia/Tbilisi city KUT Kutaisi/Kutaisi country ge Georgia/Gruzja",
	})
}

func TestWorkerGivesAnAirportOnlyWizzairFliesToTheCityOfItsGrouping(t *testing.T) {
	env := start(t)
	env.ryanair.airports = append(env.ryanair.airports,
		ryanair.Airport{Code: "BVA", Name: "Paris Beauvais", TimeZone: "Europe/Paris", CityCode: "PARIS", CityName: "Paris",
			CityNames: names("Paris", "Paryż"), CountryCode: "fr", CountryName: "France"})
	env.wizzair.stations = []wizzair.Station{flies(krk, "ORY"), flies(ory, "KRK"), bva}

	env.refresh(t)

	assertEqual(t, "Orly", airportsOf(t, env, "ORY"), []string{
		"ORY Paris Orly/Paryż-Orly Europe/Paris city PARIS Paris/Paryż country fr France/Francja",
	})
}

func TestWorkerGivesAirportsOnlyWizzairFliesToACityOfTheirOwnWhenNoCityOfOursKnowsThem(t *testing.T) {
	env := start(t)
	// Wizz Air groups both Paris airports, but neither is in the catalogue through Ryanair.
	env.wizzair.stations = []wizzair.Station{flies(krk, "ORY", "BVA"), ory, bva}

	env.refresh(t)

	assertEqual(t, "Paris airports", airportsOf(t, env, "ORY", "BVA"), []string{
		"BVA Paris Beauvais/Paryż-Beauvais Europe/Paris city BVA Paris Beauvais/Paryż-Beauvais country fr France/Francja",
		"ORY Paris Orly/Paryż-Orly Europe/Paris city ORY Paris Orly/Paryż-Orly country fr France/Francja",
	})
}

func TestWorkerNeverUsesGroupingsThatArentOneCity(t *testing.T) {
	env := start(t)
	env.ryanair.airports = append(env.ryanair.airports,
		ryanair.Airport{Code: "AUH", Name: "Abu Dhabi", TimeZone: "Asia/Dubai", CityCode: "ABU DHABI", CityName: "Abu Dhabi",
			CountryCode: "ae", CountryName: "United Arab Emirates"})
	// Wizz Air groups Katowice with Kraków (SPQ, two Ryanair cities) and Dubai with Abu Dhabi (UAE, one Ryanair
	// city and one Wizz-only airport): neither is one city.
	env.wizzair.stations = []wizzair.Station{flies(krk, "KTW", "DXB"), ktw, dxb, auh}

	env.refresh(t)

	assertEqual(t, "Katowice and Dubai", airportsOf(t, env, "KTW", "DXB"), []string{
		"DXB Dubai/Dubaj Asia/Dubai city DXB Dubai/Dubaj country ae United Arab Emirates/Zjednoczone Emiraty Arabskie",
		"KTW Katowice/Katowice Europe/Warsaw city KTW Katowice/Katowice country pl Poland/Polska supported",
	})
}

func TestWorkerSupportsPolishAirportsOnlyWizzairFliesFrom(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(rdo, "BGY"), flies(bgy, "RDO")}
	env.wizzair.setFlights(fakeFlight{from: "RDO", to: "BGY", departure: "2026-12-05T06:00", price: 99.00, currency: "PLN"})

	env.refresh(t)

	assertEqual(t, "Radom", airportsOf(t, env, "RDO"), []string{
		"RDO Warsaw Radom/Warszawa Radom Europe/Warsaw city RDO Warsaw Radom/Warszawa Radom country pl Poland/Polska supported",
	})
	// RDO–BGY is 1,058 km: two hours gate to gate.
	assertEqual(t, "Wizz Air flights", storedWizzairFlights(t, env), []string{
		"RDO→BGY 2026-12-05 06:00 → ~2026-12-05 08:00 9900 PLN @2026-11-10T08:00",
	})
}

func TestWorkerFetchesWizzairRoutesToAndFromAirportsOnlyWizzairFliesTo(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY", "KUT"), flies(bgy, "KRK"), flies(kut, "KRK")}
	env.wizzair.setFlights(
		fakeFlight{from: "KRK", to: "KUT", departure: "2026-12-05T06:00", price: 199.00, currency: "PLN"},
		fakeFlight{from: "KUT", to: "KRK", departure: "2026-12-12T20:00", price: 120.00, currency: "GEL"},
	)

	env.refresh(t)

	// KRK–KUT is 1,947 km: 3 h 05 gate to gate, with Georgia three hours ahead of Poland in winter.
	assertEqual(t, "Wizz Air flights", storedWizzairFlights(t, env), []string{
		"KRK→KUT 2026-12-05 06:00 → ~2026-12-05 12:05 19900 PLN @2026-11-10T08:00",
		"KUT→KRK 2026-12-12 20:00 → ~2026-12-12 20:05 12000 GEL @2026-11-10T08:00",
	})
}

func TestWorkerKeepsTheOwnCityOfAnAirportOnlyWizzairFliesToApartFromACityOfRyanairsWithTheSameCode(t *testing.T) {
	env := start(t)
	// A city code of Ryanair's that happens to be Kutaisi's airport code: using it would put the airport into the
	// wrong city.
	env.ryanair.airports = append(env.ryanair.airports,
		ryanair.Airport{Code: "XYZ", Name: "Somewhere", TimeZone: "Europe/Rome", CityCode: "KUT", CityName: "Kut",
			CountryCode: "it", CountryName: "Italy"})
	env.wizzair.stations = []wizzair.Station{flies(krk, "KUT"), flies(kut, "KRK")}

	env.refresh(t)

	assertEqual(t, "airports", airportsOf(t, env, "KUT", "XYZ"), []string{
		"KUT Kutaisi/Kutaisi Asia/Tbilisi city KUT-WIZZ Kutaisi/Kutaisi country ge Georgia/Gruzja",
		"XYZ Somewhere/- Europe/Rome city KUT Kut/- country it Italy/-",
	})
}
