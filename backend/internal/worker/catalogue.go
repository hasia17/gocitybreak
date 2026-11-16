package worker

import (
	"cmp"
	"context"
	"log/slog"
	"slices"

	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
	"github.com/hasia17/gocitybreak/backend/internal/timezone"
	"github.com/hasia17/gocitybreak/backend/internal/wizzair"
)

// groupingsOfSeveralCities lists Wizz Air's groupings of airports ("mac") that hold several cities, though the rule in
// wizzairOnly can't tell: they hold at most one city of Ryanair's, so it would put the rest into that city.
var groupingsOfSeveralCities = map[string]bool{
	"UAE": true, // Dubai and Abu Dhabi
	"BIH": true, // Sarajevo and Tuzla
	"NLM": true, // Eindhoven and Maastricht
	"LTE": true, // Kaunas and Vilnius
	"SPQ": true, // Katowice and Kraków
}

// wizzairOnly returns the airports of stations that Ryanair's catalogue doesn't know, as catalogue airports
// (GLOSSARY: Catalogue). Airports Ryanair knows keep Ryanair's data.
//
// Such an airport gets its names and country from Wizz Air and its time zone from its coordinates. It joins the city
// of the Ryanair airports Wizz Air groups it with when they are all of one city (e.g. Orly with Paris Beauvais),
// and is a city of its own, named like itself, otherwise: no grouping, a grouping of several Ryanair cities
// (e.g. SPQ) or one on the groupingsOfSeveralCities list. An airport whose time zone can't be found is left out.
func wizzairOnly(ctx context.Context, logger *slog.Logger, known []ryanair.Airport, stations []wizzair.Station) []ryanair.Airport {
	ryanairByCode := map[string]ryanair.Airport{}
	for _, a := range known {
		ryanairByCode[a.Code] = a
	}
	// The Ryanair airports in each grouping, by the grouping's code.
	groups := map[string][]ryanair.Airport{}
	for _, s := range stations {
		if a, ok := ryanairByCode[s.Code]; ok && s.CityGroup != "" {
			groups[s.CityGroup] = append(groups[s.CityGroup], a)
		}
	}

	cityCodes := map[string]bool{}
	for _, a := range known {
		cityCodes[a.CityCode] = true
	}

	var added []ryanair.Airport
	for _, s := range stations {
		if _, ok := ryanairByCode[s.Code]; ok {
			continue
		}
		zone, err := timezone.At(s.Latitude, s.Longitude)
		if err != nil {
			logger.WarnContext(ctx, "airport left out of the catalogue: time zone unknown", "airport", s.Code, "err", err)
			continue
		}
		a := ryanair.Airport{
			Code: s.Code, Name: s.Names["en"], Names: s.Names, TimeZone: zone,
			CountryCode: s.CountryCode, CountryName: s.CountryNames["en"], CountryNames: s.CountryNames,
			CityCode: ownCityCode(s.Code, cityCodes), CityName: s.Names["en"], CityNames: s.Names, // a city of its own
		}
		if city, ok := cityOfGroup(groups[s.CityGroup], s.CityGroup); ok {
			a.CityCode, a.CityName, a.CityNames = city.CityCode, city.CityName, city.CityNames
		}
		added = append(added, a)
	}
	slices.SortFunc(added, func(a, b ryanair.Airport) int { return cmp.Compare(a.Code, b.Code) })
	return added
}

// ownCityCode is the code of the city of its own that the airport with the given code is: the airport's code, unless
// a city of Ryanair's already has it.
func ownCityCode(airport string, taken map[string]bool) string {
	if taken[airport] {
		return airport + "-WIZZ"
	}
	return airport
}

// cityOfGroup returns an airport of the one city that group, Ryanair's airports in a Wizz Air grouping, is all in.
func cityOfGroup(group []ryanair.Airport, code string) (ryanair.Airport, bool) {
	if code == "" || groupingsOfSeveralCities[code] || len(group) == 0 {
		return ryanair.Airport{}, false
	}
	for _, a := range group {
		if a.CityCode == "" || a.CityCode != group[0].CityCode {
			return ryanair.Airport{}, false
		}
	}
	return group[0], true
}
