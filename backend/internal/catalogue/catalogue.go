// Package catalogue is the airport catalogue: the supported airports, and Ryanair's airports grouped into
// cities and countries, with our own additions to Ryanair's cities (GLOSSARY: City).
package catalogue

import (
	"cmp"
	"context"
	"fmt"
	"maps"
	"slices"

	"github.com/jackc/pgx/v5"
)

// cityAdditions are airports Ryanair names after a nearby city but assigns to another one;
// each also belongs to the city it is named after (airport code → city code).
var cityAdditions = map[string]string{
	"BGY": "MILAN",
	"CRL": "BRUSSELS",
	"REU": "BARCELONA",
	"GRO": "BARCELONA",
}

// Catalogue is every airport we know, with the cities and countries they are grouped into.
type Catalogue struct {
	// Airports are sorted by code.
	Airports []Airport
	// Cities are sorted by name.
	Cities []City
	// Countries are sorted by name.
	Countries []Country
}

// Airport is an airport with the cities and the country it belongs to.
type Airport struct {
	Code string
	Name string
	// Supported is true for a supported airport: one whose routes we fetch into the price database.
	Supported bool
	// Cities are the codes of the cities the airport belongs to: Ryanair's city first, then our additions.
	Cities []string
	// Country is a lower-case ISO 3166-1 alpha-2 code, e.g. "it"; empty when unknown.
	Country string
}

// City is a group of airports under one city name; an airport may belong to several cities.
type City struct {
	// Code is Ryanair's city code, e.g. "MILAN".
	Code    string
	Name    string
	Country string
	// Airports are the codes of the city's airports, sorted.
	Airports []string
}

// Country is a country with at least one airport.
type Country struct {
	// Code is a lower-case ISO 3166-1 alpha-2 code, e.g. "it".
	Code string
	Name string
}

// Places are airports, cities and countries, each named by its code.
type Places struct {
	Airports  []string
	Cities    []string
	Countries []string
}

// IsEmpty reports whether p names no place at all.
func (p Places) IsEmpty() bool {
	return len(p.Airports) == 0 && len(p.Cities) == 0 && len(p.Countries) == 0
}

// AirportsIn returns the codes of the catalogue's airports that are in any of places, sorted:
// the airports themselves, the airports of the cities and the airports of the countries.
func (c *Catalogue) AirportsIn(places Places) []string {
	var codes []string
	for _, a := range c.Airports {
		if slices.Contains(places.Airports, a.Code) ||
			slices.ContainsFunc(a.Cities, func(city string) bool { return slices.Contains(places.Cities, city) }) ||
			a.Country != "" && slices.Contains(places.Countries, a.Country) {
			codes = append(codes, a.Code)
		}
	}
	return codes
}

// IsSupported reports whether code names a supported airport of the catalogue.
func (c *Catalogue) IsSupported(code string) bool {
	return slices.ContainsFunc(c.Airports, func(a Airport) bool { return a.Code == code && a.Supported })
}

// AirportCodes returns the codes of every airport in the catalogue, sorted.
func (c *Catalogue) AirportCodes() []string {
	codes := make([]string, 0, len(c.Airports))
	for _, a := range c.Airports {
		codes = append(codes, a.Code)
	}
	return codes
}

// querier runs a query; *pgxpool.Pool satisfies it.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Load reads the catalogue from the airports the price worker stored, adding our additions to Ryanair's cities.
func Load(ctx context.Context, db querier) (*Catalogue, error) {
	type row struct {
		Code, Name                                   string
		Supported                                    bool
		CityCode, CityName, CountryCode, CountryName string
	}
	rows, err := db.Query(ctx, `
		SELECT code, name, supported,
			coalesce(city_code, ''), coalesce(city_name, ''), coalesce(country_code, ''), coalesce(country_name, '')
		FROM airports
		ORDER BY code`)
	if err != nil {
		return nil, fmt.Errorf("query airports: %w", err)
	}
	airportRows, err := pgx.CollectRows(rows, pgx.RowToStructByPos[row])
	if err != nil {
		return nil, fmt.Errorf("read airports: %w", err)
	}

	cities := map[string]*City{}
	countries := map[string]Country{}
	for _, r := range airportRows {
		if r.CityCode != "" {
			if _, ok := cities[r.CityCode]; !ok {
				cities[r.CityCode] = &City{Code: r.CityCode, Name: r.CityName, Country: r.CountryCode}
			}
		}
		if r.CountryCode != "" {
			countries[r.CountryCode] = Country{Code: r.CountryCode, Name: r.CountryName}
		}
	}

	c := &Catalogue{Airports: make([]Airport, 0, len(airportRows))}
	for _, r := range airportRows {
		a := Airport{Code: r.Code, Name: r.Name, Supported: r.Supported, Country: r.CountryCode}
		if r.CityCode != "" {
			a.Cities = append(a.Cities, r.CityCode)
		}
		// An addition to a city with no airport of Ryanair's own is left out: we would not know its name.
		if city, ok := cityAdditions[r.Code]; ok && city != r.CityCode && cities[city] != nil {
			a.Cities = append(a.Cities, city)
		}
		for _, city := range a.Cities {
			cities[city].Airports = append(cities[city].Airports, a.Code)
		}
		c.Airports = append(c.Airports, a)
	}

	for _, city := range cities {
		c.Cities = append(c.Cities, *city)
	}
	slices.SortFunc(c.Cities, func(a, b City) int { return cmp.Or(cmp.Compare(a.Name, b.Name), cmp.Compare(a.Code, b.Code)) })
	c.Countries = slices.SortedFunc(maps.Values(countries), func(a, b Country) int {
		return cmp.Or(cmp.Compare(a.Name, b.Name), cmp.Compare(a.Code, b.Code))
	})
	return c, nil
}
