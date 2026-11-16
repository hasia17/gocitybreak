package app_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

func TestSearchReturnsOneWayOfferForDirectFlightInTravelWindow(t *testing.T) {
	srv, url := startAPI(t, "test")
	seed(t, url, polishAndItalianAirports, fixture{
		flights: []fixtureFlight{
			{"KRK", "BGY", "2026-12-05", "06:15", "2026-12-05", "08:10", 8900, "PLN", "2026-11-10T08:00:00Z"},
		},
	})

	code, body := search(t, srv, `{
		"kind": "oneWay",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	if len(body.Offers) != 1 || body.Offers[0].Kind != "oneWay" {
		t.Fatalf("offers = %+v, want one one-way offer", body.Offers)
	}
}

func TestOneWaySearchIgnoresRoundTripOnlyFields(t *testing.T) {
	srv, url := startAPI(t, "test")
	seed(t, url, polishAndItalianAirports, fixture{
		flights: []fixtureFlight{
			{"KRK", "BGY", "2026-12-05", "06:15", "2026-12-05", "08:10", 8900, "PLN", "2026-11-10T08:00:00Z"},
		},
	})

	code, body := search(t, srv, `{
		"kind": "oneWay",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"stayLength": {"min": -1, "max": -2},
		"workStart": "invalid", "workEnd": "invalid", "maxLeaveDays": -1
	}`)
	if code != http.StatusOK || len(body.Offers) != 1 {
		t.Fatalf("status = %d, offers = %+v; want 200 and one offer", code, body.Offers)
	}
}

func TestSearchSkipsFlightsOutsideQuery(t *testing.T) {
	srv, url := startAPI(t, "test")
	seed(t, url, polishAndItalianAirports, fixture{
		flights: []fixtureFlight{
			// matches
			{"KRK", "BGY", "2026-12-01", "06:15", "2026-12-01", "08:10", 8900, "PLN", "2026-11-10T08:00:00Z"},
			// the day before the travel window
			{"KRK", "BGY", "2026-11-30", "06:15", "2026-11-30", "08:10", 5000, "PLN", "2026-11-10T08:00:00Z"},
			// departs on the last day but lands after the travel window
			{"KRK", "BGY", "2026-12-10", "23:30", "2026-12-11", "01:20", 5000, "PLN", "2026-11-10T08:00:00Z"},
			// from an airport that is not a home airport
			{"KTW", "BGY", "2026-12-05", "06:15", "2026-12-05", "08:10", 5000, "PLN", "2026-11-10T08:00:00Z"},
			// to another destination
			{"KRK", "CIA", "2026-12-05", "06:15", "2026-12-05", "08:30", 5000, "PLN", "2026-11-10T08:00:00Z"},
			// the opposite direction
			{"BGY", "KRK", "2026-12-05", "09:00", "2026-12-05", "10:50", 5000, "EUR", "2026-11-10T08:00:00Z"},
			// no price (ADR-0005 fallback)
			{"KRK", "BGY", "2026-12-05", "18:00", "2026-12-05", "19:55", -1, "", "2026-11-10T08:00:00Z"},
		},
	})

	code, body := search(t, srv, `{
		"kind": "oneWay",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	if len(body.Offers) != 1 {
		t.Fatalf("got %d offers, want 1: %+v", len(body.Offers), body.Offers)
	}
	if got := body.Offers[0].Outbound.Flights[0].Departure; got.Date != "2026-12-01" || got.Time != "06:15" {
		t.Errorf("offer departs %s %s, want the KRK→BGY flight on 2026-12-01 06:15", got.Date, got.Time)
	}
}

func TestSearchConvertsForeignCurrencyIntoApproximatePLNAtLatestRate(t *testing.T) {
	srv, url := startAPI(t, "test")
	// Ryanair prices a flight in its departure airport's currency, so the inbound flight is in EUR.
	seed(t, url, polishAndItalianAirports, fixture{
		rates: []fixtureRate{
			{"EUR", "2026-11-09", 4.3000},
			{"EUR", "2026-11-10", 4.2512},
		},
		flights: []fixtureFlight{
			{"KRK", "BGY", "2026-12-03", "06:15", "2026-12-03", "08:10", 5000, "PLN", "2026-11-10T08:00:00Z"},
			{"BGY", "KRK", "2026-12-05", "09:00", "2026-12-05", "10:50", 1999, "EUR", "2026-11-10T08:00:00Z"},
		},
	})

	code, body := search(t, srv, `{
		"kind": "roundTrip",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"stayLength": {"min": 0, "max": 10}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	if len(body.Offers) != 1 {
		t.Fatalf("got %d offers, want 1: %+v", len(body.Offers), body.Offers)
	}
	offer := body.Offers[0]
	// 50.00 PLN + 19.99 EUR × 4.2512 PLN/EUR (84.981488 PLN, rounded to 84.98).
	if want := (priceBody{Amount: 134.98, Currency: "PLN", Approximate: true}); offer.Price != want {
		t.Errorf("price = %+v, want %+v", offer.Price, want)
	}
	if want := (moneyBody{Amount: 19.99, Currency: "EUR"}); offer.Inbound.Flights[0].OriginalPrice != want {
		t.Errorf("original price = %+v, want %+v", offer.Inbound.Flights[0].OriginalPrice, want)
	}
}

func TestSearchSortsOffersByAscendingPriceInPLN(t *testing.T) {
	srv, url := startAPI(t, "test")
	seed(t, url, polishAndItalianAirports, fixture{
		rates: []fixtureRate{
			{"EUR", "2026-11-10", 4.2512},
		},
		flights: []fixtureFlight{
			{"KRK", "BGY", "2026-12-02", "06:15", "2026-12-02", "08:10", 5000, "PLN", "2026-11-10T08:00:00Z"},
			{"BGY", "KRK", "2026-12-03", "09:00", "2026-12-03", "10:50", 12000, "PLN", "2026-11-10T08:00:00Z"},
			// 20.00 EUR ≈ 85.02 PLN: cheaper than 120 PLN, dearer than 70 PLN despite the smaller number
			{"BGY", "KRK", "2026-12-04", "09:00", "2026-12-04", "10:50", 2000, "EUR", "2026-11-10T08:00:00Z"},
			{"BGY", "KRK", "2026-12-05", "09:00", "2026-12-05", "10:50", 7000, "PLN", "2026-11-10T08:00:00Z"},
		},
	})

	code, body := search(t, srv, `{
		"kind": "roundTrip",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"stayLength": {"min": 0, "max": 10}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	var got []float64
	for _, o := range body.Offers {
		got = append(got, o.Price.Amount)
	}
	// The same 50 PLN outbound flight with each inbound flight.
	if want := []float64{120.00, 135.02, 170.00}; !slices.Equal(got, want) {
		t.Errorf("offer prices = %v, want %v", got, want)
	}
}

func TestSearchOrdersEquallyPricedOffersByDepartureThenAirports(t *testing.T) {
	srv, url := startAPI(t, "test")
	seed(t, url, polishAndItalianAirports, fixture{
		flights: []fixtureFlight{
			{"KTW", "CIA", "2026-12-05", "06:15", "2026-12-05", "08:30", 8900, "PLN", "2026-11-10T08:00:00Z"},
			{"KTW", "BGY", "2026-12-05", "06:15", "2026-12-05", "08:10", 8900, "PLN", "2026-11-10T08:00:00Z"},
			{"KRK", "BGY", "2026-12-05", "06:15", "2026-12-05", "08:10", 8900, "PLN", "2026-11-10T08:00:00Z"},
			{"KTW", "BGY", "2026-12-04", "20:00", "2026-12-04", "21:55", 8900, "PLN", "2026-11-10T08:00:00Z"},
		},
	})

	code, body := search(t, srv, `{
		"kind": "oneWay",
		"homeAirports": ["KRK", "KTW"],
		"destination": {"airports": ["BGY", "CIA"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	var got []string
	for _, o := range body.Offers {
		f := o.Outbound.Flights[0]
		got = append(got, f.Departure.Date+" "+f.DepartureAirport+"→"+f.ArrivalAirport)
	}
	want := []string{"2026-12-04 KTW→BGY", "2026-12-05 KRK→BGY", "2026-12-05 KTW→BGY", "2026-12-05 KTW→CIA"}
	if !slices.Equal(got, want) {
		t.Errorf("offers = %v, want %v", got, want)
	}
}

func TestSearchRejectsInvalidQuery(t *testing.T) {
	srv, _ := startAPI(t, "test")

	// Formats only: the rules of the query are the search module's, tested in internal/search.
	for name, query := range map[string]string{
		"malformed JSON":     `{"kind": "oneWay",`,
		"invalid date":       `{"kind": "oneWay", "homeAirports": ["KRK"], "destination": {"airports": ["BGY"]}, "travelWindow": {"from": "2026-12-01", "to": "10.12.2026"}}`,
		"invalid work start": `{"kind": "roundTrip", "homeAirports": ["KRK"], "destination": {"airports": ["BGY"]}, "travelWindow": {"from": "2026-12-01", "to": "2026-12-10"}, "stayLength": {"min": 2, "max": 3}, "workStart": "9 a.m."}`,
		"invalid work end":   `{"kind": "roundTrip", "homeAirports": ["KRK"], "destination": {"airports": ["BGY"]}, "travelWindow": {"from": "2026-12-01", "to": "2026-12-10"}, "stayLength": {"min": 2, "max": 3}, "workEnd": "25:00"}`,
	} {
		t.Run(name, func(t *testing.T) {
			if code, _ := search(t, srv, query); code != http.StatusBadRequest {
				t.Errorf("status code = %d, want %d", code, http.StatusBadRequest)
			}
		})
	}
}

func TestSearchRejectsHomeAirportsThatAreNotSupported(t *testing.T) {
	srv, url := startAPI(t, "test")
	seed(t, url, polishAndItalianAirports)

	for name, homeAirports := range map[string]string{
		"airport we fetch no routes from": `["KRK", "BGY"]`,
		"airport we do not know":          `["XXX"]`,
	} {
		t.Run(name, func(t *testing.T) {
			code, _ := search(t, srv, `{
				"kind": "oneWay",
				"homeAirports": `+homeAirports+`,
				"destination": {"airports": ["CIA"]},
				"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"}
			}`)
			if code != http.StatusBadRequest {
				t.Errorf("status code = %d, want %d", code, http.StatusBadRequest)
			}
		})
	}
}

// polishAndItalianAirports is a fixture of supported Polish airports and Italian destinations.
var polishAndItalianAirports = fixture{
	airports: []fixtureAirport{
		{"KRK", "Kraków", "Europe/Warsaw", true, "", "", "", ""},
		{"KTW", "Katowice", "Europe/Warsaw", true, "", "", "", ""},
		{"BGY", "Milan Bergamo", "Europe/Rome", false, "", "", "", ""},
		{"CIA", "Rome Ciampino", "Europe/Rome", false, "", "", "", ""},
	},
}

type searchResponseBody struct {
	Offers []offerBody `json:"offers"`
}

type offerBody struct {
	Kind           string    `json:"kind"`
	Outbound       legBody   `json:"outbound"`
	Inbound        *legBody  `json:"inbound,omitempty"`
	Nights         *int      `json:"nights,omitempty"`
	LeaveDays      *int      `json:"leaveDays,omitempty"`
	Price          priceBody `json:"price"`
	PriceFetchedAt string    `json:"priceFetchedAt"`
}

type legBody struct {
	IsDirect bool         `json:"isDirect"`
	Flights  []flightBody `json:"flights"`
}

type flightBody struct {
	Airline          string        `json:"airline"`
	DepartureAirport string        `json:"departureAirport"`
	ArrivalAirport   string        `json:"arrivalAirport"`
	Departure        localTimeBody `json:"departure"`
	Arrival          localTimeBody `json:"arrival"`
	OriginalPrice    moneyBody     `json:"originalPrice"`
	FetchedAt        string        `json:"fetchedAt"`
}

type localTimeBody struct {
	Date     string `json:"date"`
	Time     string `json:"time"`
	TimeZone string `json:"timeZone"`
}

type moneyBody struct {
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
}

type priceBody struct {
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
	Approximate bool    `json:"approximate"`
}

func search(t *testing.T, srv *httptest.Server, query string) (int, searchResponseBody) {
	t.Helper()
	resp, err := http.Post(srv.URL+"/api/search", "application/json", bytes.NewBufferString(query))
	if err != nil {
		t.Fatalf("POST /api/search: %v", err)
	}
	defer resp.Body.Close()
	var body searchResponseBody
	if resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
	}
	return resp.StatusCode, body
}
