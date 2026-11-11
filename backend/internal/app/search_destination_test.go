package app_test

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"
)

func TestSearchExpandsCityIntoItsAirportsIncludingOurAdditions(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, europeanAirports+oneFlightFromKrakowToEveryDestination)

	for name, tc := range map[string]struct {
		cities []string
		want   []string
	}{
		// Ryanair assigns BGY to Bergamo; we add it to Milan as well.
		"Milan":   {cities: []string{"MILAN"}, want: []string{"BGY", "MXP"}},
		"Bergamo": {cities: []string{"BERGAMO"}, want: []string{"BGY"}},
		// Ryanair assigns GRO to Girona and REU to Reus; we add both to Barcelona.
		"Barcelona":         {cities: []string{"BARCELONA"}, want: []string{"BCN", "GRO", "REU"}},
		"Rome and Brussels": {cities: []string{"ROME", "BRUSSELS"}, want: []string{"BRU", "CIA", "CRL", "FCO"}},
	} {
		t.Run(name, func(t *testing.T) {
			code, body := search(t, srv, oneWayFromKrakowTo(t, map[string]any{"cities": tc.cities}, nil))

			if code != http.StatusOK {
				t.Fatalf("status code = %d, want %d", code, http.StatusOK)
			}
			if got := arrivalAirports(body.Offers); !slices.Equal(got, tc.want) {
				t.Errorf("offers arrive at %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSearchCombinesAirportsCitiesAndCountriesOfTheDestination(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, europeanAirports+oneFlightFromKrakowToEveryDestination)

	code, body := search(t, srv, oneWayFromKrakowTo(t, map[string]any{
		"airports":  []string{"OSL"},
		"cities":    []string{"BRUSSELS"},
		"countries": []string{"it"},
	}, nil))

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	want := []string{"BGY", "BRU", "CIA", "CRL", "FCO", "MXP", "OSL"}
	if got := arrivalAirports(body.Offers); !slices.Equal(got, want) {
		t.Errorf("offers arrive at %v, want %v", got, want)
	}
}

func TestSearchAnywhereCoversEveryAirportReachableFromHomeAirports(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, europeanAirports+oneFlightFromKrakowToEveryDestination+`
		-- from Katowice, which is not a home airport of the search
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES ('KTW', 'BGY', '2026-12-05', '06:00', '2026-12-05', '08:00', 100, 'PLN', '2026-11-10T08:00:00Z');
	`)

	code, body := search(t, srv, oneWayFromKrakowTo(t, map[string]any{"anywhere": true}, nil))

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	want := []string{"BCN", "BGY", "BRU", "CIA", "CRL", "FCO", "GRO", "MXP", "OSL", "REU"}
	if got := arrivalAirports(body.Offers); !slices.Equal(got, want) {
		t.Errorf("offers arrive at %v, want %v", got, want)
	}
}

func TestSearchRemovesExclusionsFromTheDestination(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, europeanAirports+oneFlightFromKrakowToEveryDestination)

	for name, tc := range map[string]struct {
		destination, exclusions map[string]any
		want                    []string
	}{
		"countries from anywhere": {
			destination: map[string]any{"anywhere": true},
			exclusions:  map[string]any{"countries": []string{"no", "it"}},
			want:        []string{"BCN", "BRU", "CRL", "GRO", "REU"},
		},
		// Milan includes Bergamo, so excluding Milan excludes Bergamo too.
		"a city from a country": {
			destination: map[string]any{"countries": []string{"it"}},
			exclusions:  map[string]any{"cities": []string{"MILAN"}},
			want:        []string{"CIA", "FCO"},
		},
		"an airport from a city": {
			destination: map[string]any{"cities": []string{"BARCELONA", "ROME"}},
			exclusions:  map[string]any{"airports": []string{"GRO", "CIA"}},
			want:        []string{"BCN", "FCO", "REU"},
		},
		"everything": {
			destination: map[string]any{"cities": []string{"MILAN"}},
			exclusions:  map[string]any{"countries": []string{"it"}},
			want:        nil,
		},
	} {
		t.Run(name, func(t *testing.T) {
			code, body := search(t, srv, oneWayFromKrakowTo(t, tc.destination, tc.exclusions))

			if code != http.StatusOK {
				t.Fatalf("status code = %d, want %d", code, http.StatusOK)
			}
			if got := arrivalAirports(body.Offers); !slices.Equal(got, tc.want) {
				t.Errorf("offers arrive at %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSearchPairsRoundTripThroughTheSameAirportOfTheCity(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, europeanAirports+`
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			('KRK', 'BGY', '2026-12-04', '18:00', '2026-12-04', '20:00', 8000, 'PLN', '2026-11-10T08:00:00Z'),
			('KRK', 'MXP', '2026-12-04', '19:00', '2026-12-04', '21:00', 9000, 'PLN', '2026-11-10T08:00:00Z'),
			('BGY', 'KRK', '2026-12-06', '20:00', '2026-12-06', '22:00', 8000, 'PLN', '2026-11-10T08:00:00Z');
	`)

	code, body := search(t, srv, `{
		"kind": "roundTrip",
		"homeAirports": ["KRK"],
		"destination": {"cities": ["MILAN"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"stayLength": {"min": 2, "max": 2}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	var got []string
	for _, o := range body.Offers {
		if o.Inbound == nil {
			t.Fatalf("offer is not a round trip: %+v", o)
		}
		out, in := o.Outbound.Flights[0], o.Inbound.Flights[0]
		got = append(got, out.DepartureAirport+"→"+out.ArrivalAirport+", "+in.DepartureAirport+"→"+in.ArrivalAirport)
	}
	// MXP has no flight back, and the inbound leg leaves from the airport the outbound leg landed at.
	if want := []string{"KRK→BGY, BGY→KRK"}; !slices.Equal(got, want) {
		t.Errorf("offers = %v, want %v", got, want)
	}
}

func TestSearchRejectsDestinationWithNoPlaceAndNotAnywhere(t *testing.T) {
	srv, _ := startAPI(t, "test")

	for name, destination := range map[string]map[string]any{
		"no field":              {},
		"empty places":          {"airports": []string{}, "cities": []string{}, "countries": []string{}},
		"anywhere set to false": {"anywhere": false},
	} {
		t.Run(name, func(t *testing.T) {
			query := oneWayFromKrakowTo(t, destination, map[string]any{"countries": []string{"it"}})
			if code, _ := search(t, srv, query); code != http.StatusBadRequest {
				t.Errorf("status code = %d, want %d", code, http.StatusBadRequest)
			}
		})
	}
}

// europeanAirports is a fixture of Ryanair's airport catalogue: two supported Polish airports
// and destinations with the city and country Ryanair assigns them to.
const europeanAirports = `
	INSERT INTO airports (code, name, time_zone, supported, city_code, city_name, country_code, country_name) VALUES
		('KRK', 'Kraków', 'Europe/Warsaw', true, 'KRAKOW', 'Kraków', 'pl', 'Poland'),
		('KTW', 'Katowice', 'Europe/Warsaw', true, 'KATOWICE', 'Katowice', 'pl', 'Poland'),
		('BGY', 'Milan Bergamo', 'Europe/Rome', false, 'BERGAMO', 'Bergamo', 'it', 'Italy'),
		('MXP', 'Milan Malpensa', 'Europe/Rome', false, 'MILAN', 'Milan', 'it', 'Italy'),
		('CIA', 'Rome Ciampino', 'Europe/Rome', false, 'ROME', 'Rome', 'it', 'Italy'),
		('FCO', 'Rome Fiumicino', 'Europe/Rome', false, 'ROME', 'Rome', 'it', 'Italy'),
		('BCN', 'Barcelona', 'Europe/Madrid', false, 'BARCELONA', 'Barcelona', 'es', 'Spain'),
		('GRO', 'Barcelona Girona', 'Europe/Madrid', false, 'GIRONA', 'Girona', 'es', 'Spain'),
		('REU', 'Barcelona Reus', 'Europe/Madrid', false, 'REUS', 'Reus', 'es', 'Spain'),
		('BRU', 'Brussels', 'Europe/Brussels', false, 'BRUSSELS', 'Brussels', 'be', 'Belgium'),
		('CRL', 'Brussels Charleroi', 'Europe/Brussels', false, 'CHARLEROI', 'Charleroi', 'be', 'Belgium'),
		('OSL', 'Oslo', 'Europe/Oslo', false, 'OSLO', 'Oslo', 'no', 'Norway');
`

// oneFlightFromKrakowToEveryDestination gives every airport of europeanAirports but the Polish ones
// one flight from Kraków; the price follows the airports' alphabetical order, so offers come sorted by airport.
const oneFlightFromKrakowToEveryDestination = `
	INSERT INTO flights (departure_airport, arrival_airport,
		departure_date, departure_time, arrival_date, arrival_time,
		price_amount, price_currency, fetched_at)
	SELECT 'KRK', code, '2026-12-05', '06:00', '2026-12-05', '09:00',
		10000 + row_number() OVER (ORDER BY code), 'PLN', '2026-11-10T08:00:00Z'
	FROM airports WHERE country_code <> 'pl';
`

// oneWayFromKrakowTo is a one-way search from Kraków in December 2026 to the given destination and exclusions.
func oneWayFromKrakowTo(t *testing.T, destination, exclusions map[string]any) string {
	t.Helper()
	query := map[string]any{
		"kind":         "oneWay",
		"homeAirports": []string{"KRK"},
		"destination":  destination,
		"travelWindow": map[string]string{"from": "2026-12-01", "to": "2026-12-31"},
	}
	if exclusions != nil {
		query["exclusions"] = exclusions
	}
	b, err := json.Marshal(query)
	if err != nil {
		t.Fatalf("encode query: %v", err)
	}
	return string(b)
}

// arrivalAirports lists the arrival airport of each offer's outbound leg, in order.
func arrivalAirports(offers []offerBody) []string {
	var airports []string
	for _, o := range offers {
		flights := o.Outbound.Flights
		airports = append(airports, flights[len(flights)-1].ArrivalAirport)
	}
	return airports
}
