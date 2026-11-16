package app_test

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hasia17/gocitybreak/backend/internal/pricestore"
	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
)

// namedBody is a catalogue entry with its names in every language.
type namedBody struct {
	Code     string
	Names    map[string]string
	Cities   []string
	Airports []string
	Country  string
}

// Airports only Wizz Air flies to are stored in the shape of Ryanair's (by the worker's catalogue merge): the
// catalogue lists them, in both languages, like any other.
func TestCatalogueListsAirportsOnlyWizzairFliesTo(t *testing.T) {
	server, url := startAPI(t, "test")
	pool, err := pgxpool.New(t.Context(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	both := func(en, pl string) map[string]string { return map[string]string{"en": en, "pl": pl} }
	err = pricestore.New(pool).UpsertAirports(t.Context(), []ryanair.Airport{
		{Code: "KRK", Name: "Krakow", TimeZone: "Europe/Warsaw", CityCode: "KRAKOW", CityName: "Krakow", CountryCode: "pl", CountryName: "Poland"},
		{Code: "RDO", Name: "Warsaw Radom", Names: both("Warsaw Radom", "Warszawa Radom"), TimeZone: "Europe/Warsaw",
			CityCode: "RDO", CityName: "Warsaw Radom", CityNames: both("Warsaw Radom", "Warszawa Radom"),
			CountryCode: "pl", CountryName: "Poland", CountryNames: both("Poland", "Polska")},
		{Code: "KUT", Name: "Kutaisi", Names: both("Kutaisi", "Kutaisi"), TimeZone: "Asia/Tbilisi",
			CityCode: "KUT", CityName: "Kutaisi", CityNames: both("Kutaisi", "Kutaisi"),
			CountryCode: "ge", CountryName: "Georgia", CountryNames: both("Georgia", "Gruzja")},
	})
	if err != nil {
		t.Fatal(err)
	}

	resp, err := http.Get(server.URL + "/api/catalogue")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var body struct {
		SupportedAirports, Airports, Cities, Countries []namedBody
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	find := func(list []namedBody, code string) (namedBody, bool) {
		i := slices.IndexFunc(list, func(e namedBody) bool { return e.Code == code })
		if i < 0 {
			return namedBody{}, false
		}
		return list[i], true
	}

	// Radom is in Poland, so a home airport.
	if radom, ok := find(body.SupportedAirports, "RDO"); !ok || radom.Names["pl"] != "Warszawa Radom" || radom.Names["en"] != "Warsaw Radom" {
		t.Errorf("supported airports have no Radom named in both languages: %+v", body.SupportedAirports)
	}
	// Kutaisi is a place to fly to: an airport, a city of its own and a country's airport.
	if kutaisi, ok := find(body.Airports, "KUT"); !ok || kutaisi.Names["pl"] != "Kutaisi" || kutaisi.Country != "ge" ||
		!slices.Equal(kutaisi.Cities, []string{"KUT"}) {
		t.Errorf("airports have no Kutaisi: %+v", body.Airports)
	}
	if city, ok := find(body.Cities, "KUT"); !ok || !slices.Equal(city.Airports, []string{"KUT"}) {
		t.Errorf("cities have no Kutaisi of its own: %+v", body.Cities)
	}
	if country, ok := find(body.Countries, "ge"); !ok || country.Names["pl"] != "Gruzja" || country.Names["en"] != "Georgia" {
		t.Errorf("countries have no Georgia in both languages: %+v", body.Countries)
	}
	if _, ok := find(body.SupportedAirports, "KUT"); ok {
		t.Errorf("Kutaisi is supported, want a destination only")
	}
}
