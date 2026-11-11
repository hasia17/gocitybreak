package app_test

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
)

func TestSearchKeepsOutboundDepartureWithinTimeRange(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			-- before the range
			('KRK', 'BGY', '2026-12-04', '05:59', '2026-12-04', '07:55', 1000, 'PLN', '2026-11-10T08:00:00Z'),
			-- at its start
			('KRK', 'BGY', '2026-12-05', '06:00', '2026-12-05', '07:55', 2000, 'PLN', '2026-11-10T08:00:00Z'),
			-- at its end
			('KRK', 'BGY', '2026-12-06', '12:00', '2026-12-06', '13:55', 3000, 'PLN', '2026-11-10T08:00:00Z'),
			-- after the range
			('KRK', 'BGY', '2026-12-07', '12:01', '2026-12-07', '13:55', 1000, 'PLN', '2026-11-10T08:00:00Z');
	`)

	code, body := search(t, srv, `{
		"kind": "oneWay",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"filters": {"outboundDeparture": {"from": "06:00", "to": "12:00"}}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	want := []string{"Sat 06:00 → 07:55 BGY", "Sun 12:00 → 13:55 BGY"}
	if got := oneWays(t, body.Offers); !slices.Equal(got, want) {
		t.Errorf("offers =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestSearchKeepsOutboundArrivalWithinTimeRangeInLocalTimeOfArrivalAirport(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO airports (code, name, time_zone, supported) VALUES ('LIS', 'Lisbon', 'Europe/Lisbon', false);
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			-- lands 07:30 in Lisbon (08:30 in Kraków): before the range in Lisbon time
			('KRK', 'LIS', '2026-12-04', '05:00', '2026-12-04', '07:30', 1000, 'PLN', '2026-11-10T08:00:00Z'),
			-- lands 08:30 in Lisbon (09:30 in Kraków): within the range in Lisbon time
			('KRK', 'LIS', '2026-12-05', '06:00', '2026-12-05', '08:30', 2000, 'PLN', '2026-11-10T08:00:00Z'),
			-- lands 09:30 in Lisbon: after the range
			('KRK', 'LIS', '2026-12-06', '07:00', '2026-12-06', '09:30', 1000, 'PLN', '2026-11-10T08:00:00Z');
	`)

	code, body := search(t, srv, `{
		"kind": "oneWay",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["LIS"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"filters": {"outboundArrival": {"from": "08:00", "to": "09:00"}}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	want := []string{"Sat 06:00 → 08:30 LIS"}
	if got := oneWays(t, body.Offers); !slices.Equal(got, want) {
		t.Errorf("offers =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestSearchKeepsInboundDepartureAndArrivalWithinTheirTimeRanges(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			('KRK', 'BGY', '2026-12-04', '18:00', '2026-12-04', '19:55', 5000, 'PLN', '2026-11-10T08:00:00Z'),
			-- departs before the inbound departure range
			('BGY', 'KRK', '2026-12-06', '13:59', '2026-12-06', '15:50', 1000, 'PLN', '2026-11-10T08:00:00Z'),
			-- within both ranges
			('BGY', 'KRK', '2026-12-06', '14:00', '2026-12-06', '15:50', 2000, 'PLN', '2026-11-10T08:00:00Z'),
			('BGY', 'KRK', '2026-12-06', '19:00', '2026-12-06', '21:00', 3000, 'PLN', '2026-11-10T08:00:00Z'),
			-- lands after the inbound arrival range
			('BGY', 'KRK', '2026-12-06', '20:00', '2026-12-06', '22:01', 1000, 'PLN', '2026-11-10T08:00:00Z');
	`)

	code, body := search(t, srv, `{
		"kind": "roundTrip",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"stayLength": {"min": 0, "max": 10},
		"filters": {
			"inboundDeparture": {"from": "14:00", "to": "23:59"},
			"inboundArrival": {"from": "00:00", "to": "22:00"}
		}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	want := []string{
		"Fri 18:00 → Sun 14:00, 2 nights, 70.00 PLN",
		"Fri 18:00 → Sun 19:00, 2 nights, 80.00 PLN",
	}
	if got := roundTrips(t, body.Offers); !slices.Equal(got, want) {
		t.Errorf("offers =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestSearchTimeRangeWrapsPastMidnightWhenItEndsBeforeItStarts(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			('KRK', 'BGY', '2026-12-04', '20:00', '2026-12-04', '21:59', 1000, 'PLN', '2026-11-10T08:00:00Z'),
			('KRK', 'BGY', '2026-12-05', '21:35', '2026-12-05', '23:30', 2000, 'PLN', '2026-11-10T08:00:00Z'),
			('KRK', 'BGY', '2026-12-06', '22:35', '2026-12-07', '00:30', 3000, 'PLN', '2026-11-10T08:00:00Z'),
			('KRK', 'BGY', '2026-12-07', '23:06', '2026-12-08', '01:01', 1000, 'PLN', '2026-11-10T08:00:00Z');
	`)

	code, body := search(t, srv, `{
		"kind": "oneWay",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"filters": {"outboundArrival": {"from": "22:00", "to": "01:00"}}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	want := []string{"Sat 21:35 → 23:30 BGY", "Sun 22:35 → 00:30 BGY"}
	if got := oneWays(t, body.Offers); !slices.Equal(got, want) {
		t.Errorf("offers =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestSearchKeepsOutboundAndInboundDeparturesOnChosenWeekdays(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			('KRK', 'BGY', '2026-12-03', '18:00', '2026-12-03', '19:55', 1000, 'PLN', '2026-11-10T08:00:00Z'),
			('KRK', 'BGY', '2026-12-04', '18:00', '2026-12-04', '19:55', 2000, 'PLN', '2026-11-10T08:00:00Z'),
			-- departs on Saturday
			('KRK', 'BGY', '2026-12-05', '08:00', '2026-12-05', '09:55', 100, 'PLN', '2026-11-10T08:00:00Z'),
			('BGY', 'KRK', '2026-12-06', '20:00', '2026-12-06', '21:50', 100, 'PLN', '2026-11-10T08:00:00Z'),
			-- the inbound flight departs on Monday although it lands on Tuesday
			('BGY', 'KRK', '2026-12-07', '23:30', '2026-12-08', '01:20', 300, 'PLN', '2026-11-10T08:00:00Z'),
			-- the inbound flight departs on Tuesday
			('BGY', 'KRK', '2026-12-08', '07:00', '2026-12-08', '08:50', 50, 'PLN', '2026-11-10T08:00:00Z');
	`)

	code, body := search(t, srv, `{
		"kind": "roundTrip",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"stayLength": {"min": 0, "max": 10},
		"filters": {"outboundDepartureWeekdays": ["thu", "fri"], "inboundDepartureWeekdays": ["sun", "mon"]}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	want := []string{
		"Thu 18:00 → Sun 20:00, 3 nights, 11.00 PLN",
		"Thu 18:00 → Mon 23:30, 4 nights, 13.00 PLN",
		"Fri 18:00 → Sun 20:00, 2 nights, 21.00 PLN",
		"Fri 18:00 → Mon 23:30, 3 nights, 23.00 PLN",
	}
	if got := roundTrips(t, body.Offers); !slices.Equal(got, want) {
		t.Errorf("offers =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestSearchDirectOnlyKeepsDirectOffers(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			('KRK', 'BGY', '2026-12-04', '18:00', '2026-12-04', '19:55', 5000, 'PLN', '2026-11-10T08:00:00Z'),
			('BGY', 'KRK', '2026-12-06', '20:00', '2026-12-06', '21:50', 4000, 'PLN', '2026-11-10T08:00:00Z');
	`)

	// Every stored leg is direct until self-transfers arrive, so all offers pass;
	// the search package's tests cover a leg of several flights.
	code, body := search(t, srv, `{
		"kind": "roundTrip",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"stayLength": {"min": 0, "max": 10},
		"filters": {"directOnly": true}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	want := []string{"Fri 18:00 → Sun 20:00, 2 nights, 90.00 PLN"}
	if got := roundTrips(t, body.Offers); !slices.Equal(got, want) {
		t.Errorf("offers =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestSearchSortsRoundTripOffersByPricePerNight(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO exchange_rates (currency, rate_date, rate) VALUES ('EUR', '2026-11-10', 4.2512);
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			('KRK', 'BGY', '2026-12-04', '18:00', '2026-12-04', '19:55', 6000, 'PLN', '2026-11-10T08:00:00Z'),
			-- back the same evening: no hotel night, so no price per night
			('BGY', 'KRK', '2026-12-04', '22:00', '2026-12-04', '23:50', 500, 'PLN', '2026-11-10T08:00:00Z'),
			('BGY', 'KRK', '2026-12-05', '20:00', '2026-12-05', '21:50', 1000, 'PLN', '2026-11-10T08:00:00Z'),
			('BGY', 'KRK', '2026-12-06', '20:00', '2026-12-06', '21:50', 2000, 'PLN', '2026-11-10T08:00:00Z'),
			-- 7.29 EUR ≈ 30.99 PLN
			('BGY', 'KRK', '2026-12-07', '20:00', '2026-12-07', '21:50', 729, 'EUR', '2026-11-10T08:00:00Z');
	`)

	code, body := search(t, srv, `{
		"kind": "roundTrip",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"stayLength": {"min": 0, "max": 10},
		"sort": "pricePerNight"
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	var got []string
	for _, o := range body.Offers {
		line := fmt.Sprintf("%d nights, %.2f PLN", *o.Nights, o.Price.Amount)
		if p := o.PricePerNight; p != nil {
			approx := ""
			if p.Approximate {
				approx = "≈ "
			}
			line += fmt.Sprintf(", %s%.2f %s per night", approx, p.Amount, p.Currency)
		}
		got = append(got, line)
	}
	want := []string{
		// 90.99 PLN / 3 = 30.33 PLN
		"3 nights, 90.99 PLN, ≈ 30.33 PLN per night",
		"2 nights, 80.00 PLN, 40.00 PLN per night",
		"1 nights, 70.00 PLN, 70.00 PLN per night",
		// the cheapest offer, but with no night it goes last
		"0 nights, 65.00 PLN",
	}
	if !slices.Equal(got, want) {
		t.Errorf("offers =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestSearchRejectsInvalidFilters(t *testing.T) {
	srv, _ := startAPI(t, "test")

	// Formats only: the rules of the query are the search module's, tested in internal/search.
	const roundTrip = `"kind": "roundTrip", "homeAirports": ["KRK"], "destination": {"airports": ["BGY"]}, "travelWindow": {"from": "2026-12-01", "to": "2026-12-10"}, "stayLength": {"min": 1, "max": 3}`
	for name, query := range map[string]string{
		"hour out of range":         `{` + roundTrip + `, "filters": {"outboundDeparture": {"from": "06:00", "to": "25:00"}}}`,
		"time not in HH:MM":         `{` + roundTrip + `, "filters": {"inboundArrival": {"from": "noon", "to": "18:00"}}}`,
		"time range without an end": `{` + roundTrip + `, "filters": {"inboundDeparture": {"from": "06:00"}}}`,
		"unknown weekday":           `{` + roundTrip + `, "filters": {"outboundDepartureWeekdays": ["friday"]}}`,
	} {
		t.Run(name, func(t *testing.T) {
			if code, _ := search(t, srv, query); code != http.StatusBadRequest {
				t.Errorf("status code = %d, want %d", code, http.StatusBadRequest)
			}
		})
	}
}

// oneWays describes one-way offers as "Sat 06:00 → 07:55 BGY":
// the departure, the arrival time and the arrival airport.
func oneWays(t *testing.T, offers []offerBody) []string {
	t.Helper()
	var got []string
	for _, o := range offers {
		if o.Kind != "oneWay" {
			t.Fatalf("offer is not one way: %+v", o)
		}
		f := o.Outbound.Flights[0]
		got = append(got, weekdayTime(t, f.Departure)+" → "+f.Arrival.Time+" "+f.ArrivalAirport)
	}
	return got
}
