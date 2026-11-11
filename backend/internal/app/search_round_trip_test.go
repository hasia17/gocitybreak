package app_test

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestSearchPairsOutboundAndInboundFlightsIntoRoundTripOffer(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO exchange_rates (currency, rate_date, rate) VALUES ('EUR', '2026-11-10', 4.2512);
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			-- Friday evening out
			('KRK', 'BGY', '2026-12-04', '18:00', '2026-12-04', '19:55', 8900, 'PLN', '2026-11-10T08:00:00Z'),
			-- Sunday evening back
			('BGY', 'KRK', '2026-12-06', '20:00', '2026-12-06', '21:50', 1999, 'EUR', '2026-11-09T07:00:00Z');
	`)

	code, body := search(t, srv, `{
		"kind": "roundTrip",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"stayLength": {"min": 2, "max": 3}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	want := []offerBody{{
		Kind: "roundTrip",
		Outbound: legBody{
			IsDirect: true,
			Flights: []flightBody{{
				DepartureAirport: "KRK",
				ArrivalAirport:   "BGY",
				Departure:        localTimeBody{Date: "2026-12-04", Time: "18:00", TimeZone: "Europe/Warsaw"},
				Arrival:          localTimeBody{Date: "2026-12-04", Time: "19:55", TimeZone: "Europe/Rome"},
				OriginalPrice:    moneyBody{Amount: 89.00, Currency: "PLN"},
				FetchedAt:        "2026-11-10T08:00:00Z",
			}},
		},
		Inbound: &legBody{
			IsDirect: true,
			Flights: []flightBody{{
				DepartureAirport: "BGY",
				ArrivalAirport:   "KRK",
				Departure:        localTimeBody{Date: "2026-12-06", Time: "20:00", TimeZone: "Europe/Rome"},
				Arrival:          localTimeBody{Date: "2026-12-06", Time: "21:50", TimeZone: "Europe/Warsaw"},
				OriginalPrice:    moneyBody{Amount: 19.99, Currency: "EUR"},
				FetchedAt:        "2026-11-09T07:00:00Z",
			}},
		},
		Nights: new(2),
		// Friday after the default work end of 17:00, back on Sunday.
		LeaveDays: new(0),
		// 89.00 PLN + 19.99 EUR × 4.2512 PLN/EUR (84.98 PLN) = 173.98 PLN, approximate.
		Price: priceBody{Amount: 173.98, Currency: "PLN", Approximate: true},
		// 173.98 PLN / 2 nights.
		PricePerNight: &priceBody{Amount: 86.99, Currency: "PLN", Approximate: true},
		// The older of the two stored prices.
		PriceFetchedAt: "2026-11-09T07:00:00Z",
	}}
	assertOffers(t, body.Offers, want)
}

func TestSearchRespectsStayLengthInHotelNights(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			-- Friday 23:00 → Saturday 01:00: lands before 06:00, so Friday is the first night
			('KRK', 'BGY', '2026-12-04', '23:00', '2026-12-05', '01:00', 5000, 'PLN', '2026-11-10T08:00:00Z'),
			-- lands at 06:00 sharp: Saturday is the first night
			('KRK', 'BGY', '2026-12-05', '04:05', '2026-12-05', '06:00', 6000, 'PLN', '2026-11-10T08:00:00Z'),
			-- Saturday morning: Saturday is the first night
			('KRK', 'BGY', '2026-12-05', '08:00', '2026-12-05', '09:55', 7000, 'PLN', '2026-11-10T08:00:00Z'),
			-- Sunday evening back
			('BGY', 'KRK', '2026-12-06', '20:00', '2026-12-06', '21:50', 1000, 'PLN', '2026-11-10T08:00:00Z'),
			-- Monday morning back
			('BGY', 'KRK', '2026-12-07', '07:00', '2026-12-07', '08:50', 2000, 'PLN', '2026-11-10T08:00:00Z');
	`)

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
	want := []string{
		"Fri 23:00 → Sun 20:00, 2 nights, 60.00 PLN",
		"Sat 04:05 → Mon 07:00, 2 nights, 80.00 PLN",
		"Sat 08:00 → Mon 07:00, 2 nights, 90.00 PLN",
	}
	if got := roundTrips(t, body.Offers); !slices.Equal(got, want) {
		t.Errorf("offers =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestSearchFitsRoundTripWithinTravelWindow(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			-- departs the day before the window, lands on its first day
			('KRK', 'BGY', '2026-12-03', '23:30', '2026-12-04', '01:20', 1000, 'PLN', '2026-11-10T08:00:00Z'),
			-- departs on the first day of the window
			('KRK', 'BGY', '2026-12-04', '06:15', '2026-12-04', '08:10', 5000, 'PLN', '2026-11-10T08:00:00Z'),
			-- lands on the last day of the window
			('BGY', 'KRK', '2026-12-06', '20:00', '2026-12-06', '21:50', 5000, 'PLN', '2026-11-10T08:00:00Z'),
			-- departs on the last day of the window, lands the day after
			('BGY', 'KRK', '2026-12-06', '23:30', '2026-12-07', '01:20', 1000, 'PLN', '2026-11-10T08:00:00Z');
	`)

	code, body := search(t, srv, `{
		"kind": "roundTrip",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-04", "to": "2026-12-06"},
		"stayLength": {"min": 0, "max": 10}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	want := []string{"Fri 06:15 → Sun 20:00, 2 nights, 100.00 PLN"}
	if got := roundTrips(t, body.Offers); !slices.Equal(got, want) {
		t.Errorf("offers =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestSearchReturnsToAnyHomeAirportFromTheSameDestinationAirport(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO airports (code, name, time_zone, supported) VALUES ('WAW', 'Warsaw Modlin', 'Europe/Warsaw', true);
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			('KRK', 'BGY', '2026-12-04', '18:00', '2026-12-04', '19:55', 5000, 'PLN', '2026-11-10T08:00:00Z'),
			-- back to another home airport
			('BGY', 'KTW', '2026-12-06', '20:00', '2026-12-06', '21:50', 4000, 'PLN', '2026-11-10T08:00:00Z'),
			-- back to an airport that is not a home airport
			('BGY', 'WAW', '2026-12-06', '19:00', '2026-12-06', '20:50', 1000, 'PLN', '2026-11-10T08:00:00Z'),
			-- back from another destination airport (not paired in the first version)
			('CIA', 'KRK', '2026-12-06', '18:00', '2026-12-06', '20:20', 1000, 'PLN', '2026-11-10T08:00:00Z'),
			-- departs before the outbound flight lands
			('BGY', 'KRK', '2026-12-04', '19:00', '2026-12-04', '20:50', 1000, 'PLN', '2026-11-10T08:00:00Z');
	`)

	code, body := search(t, srv, `{
		"kind": "roundTrip",
		"homeAirports": ["KRK", "KTW"],
		"destination": {"airports": ["BGY", "CIA"]},
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
	if in := offer.Inbound.Flights[0]; in.DepartureAirport != "BGY" || in.ArrivalAirport != "KTW" {
		t.Errorf("inbound = %s→%s, want BGY→KTW", in.DepartureAirport, in.ArrivalAirport)
	}
	if want := (priceBody{Amount: 90.00, Currency: "PLN", Approximate: false}); offer.Price != want {
		t.Errorf("price = %+v, want %+v", offer.Price, want)
	}
}

func TestSearchDefaultsToRoundTripOffers(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			('KRK', 'BGY', '2026-12-04', '18:00', '2026-12-04', '19:55', 5000, 'PLN', '2026-11-10T08:00:00Z'),
			('BGY', 'KRK', '2026-12-06', '20:00', '2026-12-06', '21:50', 4000, 'PLN', '2026-11-10T08:00:00Z');
	`)

	code, body := search(t, srv, `{
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"stayLength": {"min": 1, "max": 3}
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	want := []string{"Fri 18:00 → Sun 20:00, 2 nights, 90.00 PLN"}
	if got := roundTrips(t, body.Offers); !slices.Equal(got, want) {
		t.Errorf("offers =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

// roundTrips describes round-trip offers as "Fri 23:00 → Sun 20:00, 2 nights, 60.00 PLN":
// the outbound and inbound departures, the nights and the offer price.
func roundTrips(t *testing.T, offers []offerBody) []string {
	t.Helper()
	var got []string
	for _, o := range offers {
		if o.Kind != "roundTrip" || o.Inbound == nil || o.Nights == nil {
			t.Fatalf("offer is not a round trip: %+v", o)
		}
		got = append(got, fmt.Sprintf("%s → %s, %d nights, %.2f %s",
			weekdayTime(t, o.Outbound.Flights[0].Departure), weekdayTime(t, o.Inbound.Flights[0].Departure),
			*o.Nights, o.Price.Amount, o.Price.Currency))
	}
	return got
}

// weekdayTime formats a local time as "Fri 23:00".
func weekdayTime(t *testing.T, lt localTimeBody) string {
	t.Helper()
	d, err := time.Parse(time.DateOnly, lt.Date)
	if err != nil {
		t.Fatalf("parse date %q: %v", lt.Date, err)
	}
	return d.Format("Mon") + " " + lt.Time
}
