package app_test

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
)

func TestSearchCountsLeaveDaysFromWorkHours(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			-- three flights on the same Friday: only the one after work end saves the day
			('KRK', 'BGY', '2026-12-04', '06:15', '2026-12-04', '08:10', 1000, 'PLN', '2026-11-10T08:00:00Z'),
			('KRK', 'BGY', '2026-12-04', '17:30', '2026-12-04', '19:25', 2000, 'PLN', '2026-11-10T08:00:00Z'),
			('KRK', 'BGY', '2026-12-04', '18:15', '2026-12-04', '20:10', 3000, 'PLN', '2026-11-10T08:00:00Z'),
			-- Monday morning back, landing before work start
			('BGY', 'KRK', '2026-12-07', '07:00', '2026-12-07', '08:50', 1000, 'PLN', '2026-11-10T08:00:00Z');
	`)

	code, body := search(t, srv, `{
		"kind": "roundTrip",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"stayLength": {"min": 0, "max": 5},
		"workStart": "09:00",
		"workEnd": "18:00"
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	want := []string{
		"Fri 06:15 → Mon 07:00, 1 leave days",
		"Fri 17:30 → Mon 07:00, 1 leave days",
		"Fri 18:15 → Mon 07:00, 0 leave days",
	}
	if got := leaveDays(t, body.Offers); !slices.Equal(got, want) {
		t.Errorf("offers =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestSearchFiltersByMaximumLeaveDays(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			-- Thursday morning, Friday morning and Friday evening out
			('KRK', 'BGY', '2026-12-03', '06:15', '2026-12-03', '08:10', 1000, 'PLN', '2026-11-10T08:00:00Z'),
			('KRK', 'BGY', '2026-12-04', '06:15', '2026-12-04', '08:10', 2000, 'PLN', '2026-11-10T08:00:00Z'),
			('KRK', 'BGY', '2026-12-04', '18:15', '2026-12-04', '20:10', 3000, 'PLN', '2026-11-10T08:00:00Z'),
			-- Sunday evening back
			('BGY', 'KRK', '2026-12-06', '20:00', '2026-12-06', '21:50', 1000, 'PLN', '2026-11-10T08:00:00Z');
	`)
	query := func(maxLeaveDays int) string {
		return fmt.Sprintf(`{
			"kind": "roundTrip",
			"homeAirports": ["KRK"],
			"destination": {"airports": ["BGY"]},
			"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
			"stayLength": {"min": 0, "max": 5},
			"workStart": "09:00",
			"workEnd": "17:00",
			"maxLeaveDays": %d
		}`, maxLeaveDays)
	}

	for maxLeaveDays, want := range map[int][]string{
		0: {"Fri 18:15 → Sun 20:00, 0 leave days"},
		1: {"Fri 06:15 → Sun 20:00, 1 leave days", "Fri 18:15 → Sun 20:00, 0 leave days"},
		2: {
			"Thu 06:15 → Sun 20:00, 2 leave days",
			"Fri 06:15 → Sun 20:00, 1 leave days",
			"Fri 18:15 → Sun 20:00, 0 leave days",
		},
	} {
		t.Run(fmt.Sprint(maxLeaveDays), func(t *testing.T) {
			code, body := search(t, srv, query(maxLeaveDays))

			if code != http.StatusOK {
				t.Fatalf("status code = %d, want %d", code, http.StatusOK)
			}
			if got := leaveDays(t, body.Offers); !slices.Equal(got, want) {
				t.Errorf("offers =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
			}
		})
	}
}

func TestSearchSortsByLeaveDaysThenPrice(t *testing.T) {
	srv, pg := startAPI(t, "test")
	seed(t, pg, polishAndItalianAirports+`
		INSERT INTO flights (departure_airport, arrival_airport,
			departure_date, departure_time, arrival_date, arrival_time,
			price_amount, price_currency, fetched_at)
		VALUES
			('KRK', 'BGY', '2026-12-03', '06:15', '2026-12-03', '08:10', 1000, 'PLN', '2026-11-10T08:00:00Z'),
			('KRK', 'BGY', '2026-12-04', '06:15', '2026-12-04', '08:10', 2000, 'PLN', '2026-11-10T08:00:00Z'),
			('KRK', 'BGY', '2026-12-04', '18:15', '2026-12-04', '20:10', 3000, 'PLN', '2026-11-10T08:00:00Z'),
			('KRK', 'BGY', '2026-12-04', '18:30', '2026-12-04', '20:25', 2500, 'PLN', '2026-11-10T08:00:00Z'),
			('BGY', 'KRK', '2026-12-06', '20:00', '2026-12-06', '21:50', 1000, 'PLN', '2026-11-10T08:00:00Z');
	`)

	code, body := search(t, srv, `{
		"kind": "roundTrip",
		"homeAirports": ["KRK"],
		"destination": {"airports": ["BGY"]},
		"travelWindow": {"from": "2026-12-01", "to": "2026-12-10"},
		"stayLength": {"min": 0, "max": 5},
		"workStart": "09:00",
		"workEnd": "17:00",
		"sort": "leaveDays"
	}`)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	want := []string{
		"Fri 18:30 → Sun 20:00, 0 leave days, 35.00 PLN",
		"Fri 18:15 → Sun 20:00, 0 leave days, 40.00 PLN",
		"Fri 06:15 → Sun 20:00, 1 leave days, 30.00 PLN",
		"Thu 06:15 → Sun 20:00, 2 leave days, 20.00 PLN",
	}
	var got []string
	for i, o := range leaveDays(t, body.Offers) {
		got = append(got, fmt.Sprintf("%s, %.2f %s", o, body.Offers[i].Price.Amount, body.Offers[i].Price.Currency))
	}
	if !slices.Equal(got, want) {
		t.Errorf("offers =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

// leaveDays describes round-trip offers as "Fri 18:15 → Mon 07:00, 0 leave days":
// the outbound and inbound departures and the leave days.
func leaveDays(t *testing.T, offers []offerBody) []string {
	t.Helper()
	var got []string
	for _, o := range offers {
		if o.Inbound == nil || o.LeaveDays == nil {
			t.Fatalf("offer is not a round trip with leave days: %+v", o)
		}
		got = append(got, fmt.Sprintf("%s → %s, %d leave days",
			weekdayTime(t, o.Outbound.Flights[0].Departure), weekdayTime(t, o.Inbound.Flights[0].Departure),
			*o.LeaveDays))
	}
	return got
}
