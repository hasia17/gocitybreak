package app_test

import (
	"encoding/json"
	"net/http"
	"reflect"
	"slices"
	"testing"
)

func TestCatalogueListsSupportedAirportsAndDestinationAirportsCitiesAndCountries(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, europeanAirports)

	resp, err := http.Get(srv.URL + "/api/catalogue")
	if err != nil {
		t.Fatalf("GET /api/catalogue: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status code = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var body catalogueBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}

	wantSupported := []supportedAirportBody{{Code: "KRK", Name: "Kraków"}, {Code: "KTW", Name: "Katowice"}}
	if !reflect.DeepEqual(body.SupportedAirports, wantSupported) {
		t.Errorf("supportedAirports = %+v, want %+v", body.SupportedAirports, wantSupported)
	}

	var airports []string
	for _, a := range body.Airports {
		airports = append(airports, a.Code)
	}
	wantAirports := []string{"BCN", "BGY", "BRU", "CIA", "CRL", "FCO", "GRO", "KRK", "KTW", "MXP", "OSL", "REU"}
	if !slices.Equal(airports, wantAirports) {
		t.Errorf("airports = %v, want %v", airports, wantAirports)
	}
	// Ryanair assigns BGY to Bergamo; we add it to Milan.
	wantBGY := airportBody{Code: "BGY", Name: "Milan Bergamo", Cities: []string{"BERGAMO", "MILAN"}, Country: "it"}
	if i := slices.IndexFunc(body.Airports, func(a airportBody) bool { return a.Code == "BGY" }); i < 0 ||
		!reflect.DeepEqual(body.Airports[i], wantBGY) {
		t.Errorf("airports have no %+v: %+v", wantBGY, body.Airports)
	}

	var cities []string
	for _, c := range body.Cities {
		cities = append(cities, c.Name)
	}
	wantCities := []string{"Barcelona", "Bergamo", "Brussels", "Charleroi", "Girona", "Katowice", "Kraków",
		"Milan", "Oslo", "Reus", "Rome"}
	if !slices.Equal(cities, wantCities) {
		t.Errorf("cities = %v, want %v", cities, wantCities)
	}
	wantMilan := cityBody{Code: "MILAN", Name: "Milan", Country: "it", Airports: []string{"BGY", "MXP"}}
	if i := slices.IndexFunc(body.Cities, func(c cityBody) bool { return c.Code == "MILAN" }); i < 0 ||
		!reflect.DeepEqual(body.Cities[i], wantMilan) {
		t.Errorf("cities have no %+v: %+v", wantMilan, body.Cities)
	}

	wantCountries := []countryBody{
		{Code: "be", Name: "Belgium"}, {Code: "it", Name: "Italy"}, {Code: "no", Name: "Norway"},
		{Code: "pl", Name: "Poland"}, {Code: "es", Name: "Spain"},
	}
	if !reflect.DeepEqual(body.Countries, wantCountries) {
		t.Errorf("countries = %+v, want %+v", body.Countries, wantCountries)
	}
}

type catalogueBody struct {
	SupportedAirports []supportedAirportBody `json:"supportedAirports"`
	Airports          []airportBody          `json:"airports"`
	Cities            []cityBody             `json:"cities"`
	Countries         []countryBody          `json:"countries"`
}

type supportedAirportBody struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

type airportBody struct {
	Code    string   `json:"code"`
	Name    string   `json:"name"`
	Cities  []string `json:"cities"`
	Country string   `json:"country"`
}

type cityBody struct {
	Code     string   `json:"code"`
	Name     string   `json:"name"`
	Country  string   `json:"country"`
	Airports []string `json:"airports"`
}

type countryBody struct {
	Code string `json:"code"`
	Name string `json:"name"`
}
