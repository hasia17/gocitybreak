package app_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// describeOffer sums an offer up as its flights (airline, route, arrival, "~" when estimated) and price.
func describeOffer(o offerBody) string {
	var parts []string
	legs := []legBody{o.Outbound}
	if o.Inbound != nil {
		legs = append(legs, *o.Inbound)
	}
	for _, leg := range legs {
		for _, f := range leg.Flights {
			estimated := ""
			if f.EstimatedArrival {
				estimated = "~"
			}
			parts = append(parts, fmt.Sprintf("%s %s→%s %s%s", f.Airline, f.DepartureAirport, f.ArrivalAirport, estimated, f.Arrival.Time))
		}
	}
	return strings.Join(parts, " + ") + fmt.Sprintf(" = %.2f", o.Price.Amount)
}

func TestSearchMixesAirlinesBetweenLegs(t *testing.T) {
	srv, url := startAPI(t, "test")
	seed(t, url, polishAndItalianAirports, fixture{
		flights: []fixtureFlight{
			{"KRK", "BGY", "2026-12-04", "18:00", "2026-12-04", "19:55", 8900, "PLN", "2026-11-10T08:00:00Z"},
			{"BGY", "KRK", "2026-12-06", "20:00", "2026-12-06", "21:50", 9000, "PLN", "2026-11-10T08:00:00Z"},
		},
		wizzair: []fixtureFlight{
			{"KRK", "BGY", "2026-12-04", "19:00", "2026-12-04", "20:45", 9500, "PLN", "2026-11-10T08:00:00Z"},
			{"BGY", "KRK", "2026-12-06", "21:00", "2026-12-06", "22:45", 5000, "PLN", "2026-11-10T08:00:00Z"},
		},
	})

	code, body := search(t, srv, `{
		"kind": "roundTrip",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"stayLength": {"min": 2, "max": 2}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	var got []string
	for _, o := range body.Offers {
		got = append(got, describeOffer(o))
	}
	assertStrings(t, "offers, cheapest first", got, []string{
		"ryanair KRK→BGY 19:55 + wizzair BGY→KRK ~22:45 = 139.00",
		"wizzair KRK→BGY ~20:45 + wizzair BGY→KRK ~22:45 = 145.00",
		"ryanair KRK→BGY 19:55 + ryanair BGY→KRK 21:50 = 179.00",
		"wizzair KRK→BGY ~20:45 + ryanair BGY→KRK 21:50 = 185.00",
	})
}

func TestSearchCountsNightsLeaveDaysAndTimeRangesFromAnEstimatedArrival(t *testing.T) {
	srv, url := startAPI(t, "test")
	seed(t, url, polishAndItalianAirports, fixture{
		// Thursday 23:00 out, landing (by our estimate) after midnight: Thursday is the first night, and Thursday
		// costs no leave day.
		wizzair: []fixtureFlight{{"KRK", "BGY", "2026-12-03", "23:00", "2026-12-04", "00:45", 5000, "PLN", "2026-11-10T08:00:00Z"}},
		flights: []fixtureFlight{{"BGY", "KRK", "2026-12-06", "20:00", "2026-12-06", "21:50", 4000, "PLN", "2026-11-10T08:00:00Z"}},
	})
	query := func(arrival string) string {
		return `{
			"kind": "roundTrip",
			"homeAirports": ["KRK"],
			"destination": {"airports": ["BGY"]},
			"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
			"stayLength": {"min": 3, "max": 3},
			"filters": {"outboundArrival": ` + arrival + `}
		}`
	}

	code, body := search(t, srv, query(`{"from": "00:00", "to": "01:00"}`))

	if code != http.StatusOK || len(body.Offers) != 1 {
		t.Fatalf("status %d, offers %+v; want one offer", code, body.Offers)
	}
	o := body.Offers[0]
	if o.Nights == nil || *o.Nights != 3 || o.LeaveDays == nil || *o.LeaveDays != 1 || !o.Outbound.Flights[0].EstimatedArrival {
		t.Errorf("offer %+v, want 3 nights and 1 leave day from the estimated arrival", o)
	}
	if code, body := search(t, srv, query(`{"from": "01:00", "to": "02:00"}`)); code != http.StatusOK || len(body.Offers) != 0 {
		t.Errorf("status %d, offers %+v; want none landing between 01:00 and 02:00", code, body.Offers)
	}
}

func assertStrings(t *testing.T, what string, got, want []string) {
	t.Helper()
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("%s:\n got: %s\nwant: %s", what, strings.Join(got, "\n      "), strings.Join(want, "\n      "))
	}
}
