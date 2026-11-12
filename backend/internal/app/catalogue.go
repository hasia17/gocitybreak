package app

import (
	"log/slog"
	"net/http"

	"github.com/hasia17/gocitybreak/backend/internal/catalogue"
)

// catalogueResponse is what the search form chooses from: home airports among the supported airports,
// and destinations among airports, cities and countries.
type catalogueResponse struct {
	SupportedAirports []supportedAirportJSON `json:"supportedAirports"`
	Airports          []airportJSON          `json:"airports"`
	Cities            []cityJSON             `json:"cities"`
	Countries         []countryJSON          `json:"countries"`
}

type supportedAirportJSON struct {
	Names map[string]string `json:"names"`
	Code  string            `json:"code"`
	Name  string            `json:"name"`
}

type airportJSON struct {
	Names   map[string]string `json:"names"`
	Code    string            `json:"code"`
	Name    string            `json:"name"`
	Cities  []string          `json:"cities"`
	Country string            `json:"country,omitempty"`
}

type cityJSON struct {
	Names    map[string]string `json:"names"`
	Code     string            `json:"code"`
	Name     string            `json:"name"`
	Country  string            `json:"country,omitempty"`
	Airports []string          `json:"airports"`
}

type countryJSON struct {
	Names map[string]string `json:"names"`
	Code  string            `json:"code"`
	Name  string            `json:"name"`
}

func (a *App) catalogue(w http.ResponseWriter, r *http.Request) {
	c, err := catalogue.Load(r.Context(), a.db.Pool)
	if err != nil {
		slog.ErrorContext(r.Context(), "catalogue failed", "err", err)
		http.Error(w, "catalogue failed", http.StatusInternalServerError)
		return
	}
	resp := catalogueResponse{
		SupportedAirports: []supportedAirportJSON{},
		Airports:          make([]airportJSON, 0, len(c.Airports)),
		Cities:            make([]cityJSON, 0, len(c.Cities)),
		Countries:         make([]countryJSON, 0, len(c.Countries)),
	}
	for _, airport := range c.Airports {
		if airport.Supported {
			resp.SupportedAirports = append(resp.SupportedAirports,
				supportedAirportJSON{Code: airport.Code, Name: airport.Name, Names: airport.Names})
		}
		resp.Airports = append(resp.Airports, airportJSON{
			Code:    airport.Code,
			Name:    airport.Name,
			Names:   airport.Names,
			Cities:  nonNil(airport.Cities),
			Country: airport.Country,
		})
	}
	for _, city := range c.Cities {
		resp.Cities = append(resp.Cities, cityJSON{
			Code: city.Code, Name: city.Name, Names: city.Names, Country: city.Country, Airports: city.Airports,
		})
	}
	for _, country := range c.Countries {
		resp.Countries = append(resp.Countries, countryJSON{Code: country.Code, Name: country.Name, Names: country.Names})
	}
	writeJSON(w, http.StatusOK, resp)
}

// nonNil returns s, or an empty slice for nil, so that JSON gets [] rather than null.
func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
