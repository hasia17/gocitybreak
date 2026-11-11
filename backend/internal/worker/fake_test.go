package worker_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeRyanair imitates Ryanair's unofficial API, as observed on 2026-11-10/11, over a set of flights:
// the timetable lists them all, cheapestPerDay returns the cheapest of each day, and oneWayFares
// honours the date and departure-time window.
type fakeRyanair struct {
	mu       sync.Mutex
	airports []fakeAirport
	routes   map[string][]string
	flights  []fakeFlight
	// failures makes an endpoint ("cheapestPerDay", "timetable", "oneWayFares") answer with an HTTP status
	// instead: the next n requests (n > 0), or every request (n < 0). A route (e.g. "KRK-BGY") narrows it down.
	failures map[string]*failure
	// cheapestPerDayRequests logs every cheapestPerDay request as "FROM-TO YYYY-MM", in order.
	cheapestPerDayRequests []string
}

type fakeAirport struct {
	code, name, timeZone, city, cityName, country, countryName string
}

type fakeFlight struct {
	from, to           string
	departure, arrival string // "2006-01-02T15:04", local
	price              float64
	currency           string
	soldOut            bool
}

type failure struct {
	status, remaining int
}

func newFakeRyanair(t *testing.T) (*fakeRyanair, string) {
	t.Helper()
	f := &fakeRyanair{routes: map[string][]string{}, failures: map[string]*failure{}}
	srv := httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(srv.Close)
	return f, srv.URL
}

// fail makes the next n requests to endpoint (optionally only for route "FROM-TO") answer with status; n < 0 means always.
func (f *fakeRyanair) fail(endpoint, route string, status, n int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.failures[endpoint+" "+route] = &failure{status: status, remaining: n}
}

func (f *fakeRyanair) setFlights(flights ...fakeFlight) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.flights = flights
}

func (f *fakeRyanair) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	switch {
	case r.URL.Path == "/api/views/locate/5/airports/en/active":
		f.serveAirports(w)
	case strings.HasPrefix(r.URL.Path, "/api/views/locate/searchWidget/routes/en/airport/"):
		f.serveRoutes(w, parts[len(parts)-1])
	case len(parts) == 7 && parts[3] == "oneWayFares" && parts[6] == "cheapestPerDay":
		f.cheapestPerDayRequests = append(f.cheapestPerDayRequests,
			parts[4]+"-"+parts[5]+" "+strings.TrimSuffix(r.URL.Query().Get("outboundMonthOfDate"), "-01"))
		if f.failed(w, "cheapestPerDay", parts[4]+"-"+parts[5]) {
			return
		}
		f.serveCheapestPerDay(w, parts[4], parts[5], r.URL.Query().Get("outboundMonthOfDate"))
	case len(parts) == 10 && parts[1] == "timtbl":
		if f.failed(w, "timetable", parts[4]+"-"+parts[5]) {
			return
		}
		year, _ := strconv.Atoi(parts[7])
		month, _ := strconv.Atoi(parts[9])
		f.serveTimetable(w, parts[4], parts[5], year, month)
	case r.URL.Path == "/api/farfnd/v4/oneWayFares":
		q := r.URL.Query()
		if f.failed(w, "oneWayFares", q.Get("departureAirportIataCode")+"-"+q.Get("arrivalAirportIataCode")) {
			return
		}
		f.serveOneWayFares(w, q.Get("departureAirportIataCode"), q.Get("arrivalAirportIataCode"),
			q.Get("outboundDepartureDateFrom"), q.Get("outboundDepartureDateTo"),
			q.Get("outboundDepartureTimeFrom"), q.Get("outboundDepartureTimeTo"))
	default:
		http.NotFound(w, r)
	}
}

func (f *fakeRyanair) failed(w http.ResponseWriter, endpoint, route string) bool {
	for _, key := range []string{endpoint + " " + route, endpoint + " "} {
		if fl, ok := f.failures[key]; ok && fl.remaining != 0 {
			if fl.remaining > 0 {
				fl.remaining--
			}
			http.Error(w, "fake failure", fl.status)
			return true
		}
	}
	return false
}

func (f *fakeRyanair) serveAirports(w http.ResponseWriter) {
	var body []map[string]any
	for _, a := range f.airports {
		body = append(body, map[string]any{
			"code": a.code, "name": a.name, "timeZone": a.timeZone, "base": false,
			"city":    map[string]any{"code": a.city, "name": a.cityName},
			"country": map[string]any{"code": a.country, "name": a.countryName, "currency": "XXX"},
		})
	}
	writeJSON(w, body)
}

func (f *fakeRyanair) serveRoutes(w http.ResponseWriter, from string) {
	body := []map[string]any{}
	for _, to := range f.routes[from] {
		body = append(body, map[string]any{
			"arrivalAirport":    map[string]any{"code": to},
			"connectingAirport": nil, "operator": "FR", "seasonal": false,
		})
	}
	writeJSON(w, body)
}

func (f *fakeRyanair) serveCheapestPerDay(w http.ResponseWriter, from, to, monthOf string) {
	month, _ := time.Parse(time.DateOnly, monthOf)
	fares := []map[string]any{}
	for day := month; day.Month() == month.Month(); day = day.AddDate(0, 0, 1) {
		date := day.Format(time.DateOnly)
		var cheapest *fakeFlight
		for _, fl := range f.flightsOn(from, to, date) {
			if !fl.soldOut && (cheapest == nil || fl.price < cheapest.price) {
				cheapest = &fl
			}
		}
		if cheapest == nil {
			fares = append(fares, map[string]any{"day": date, "departureDate": nil, "arrivalDate": nil,
				"price": nil, "soldOut": false, "unavailable": true})
			continue
		}
		fares = append(fares, map[string]any{"day": date,
			"departureDate": cheapest.departure + ":00", "arrivalDate": cheapest.arrival + ":00",
			"price": price(*cheapest), "soldOut": false, "unavailable": false})
	}
	writeJSON(w, map[string]any{"outbound": map[string]any{"fares": fares, "minFare": nil, "maxFare": nil}})
}

func (f *fakeRyanair) serveTimetable(w http.ResponseWriter, from, to string, year, month int) {
	days := []map[string]any{}
	start := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
	for day := start; day.Month() == start.Month(); day = day.AddDate(0, 0, 1) {
		var flights []map[string]any
		for _, fl := range f.flightsOn(from, to, day.Format(time.DateOnly)) {
			flights = append(flights, map[string]any{"carrierCode": "FR", "number": "1234",
				"departureTime": fl.departure[11:], "arrivalTime": fl.arrival[11:]})
		}
		if flights != nil {
			days = append(days, map[string]any{"day": day.Day(), "flights": flights})
		}
	}
	writeJSON(w, map[string]any{"month": month, "days": days})
}

func (f *fakeRyanair) serveOneWayFares(w http.ResponseWriter, from, to, dateFrom, dateTo, timeFrom, timeTo string) {
	if dateFrom != dateTo {
		http.Error(w, "fake only supports one-day queries", http.StatusBadRequest)
		return
	}
	var cheapest *fakeFlight
	for _, fl := range f.flightsOn(from, to, dateFrom) {
		clock := fl.departure[11:]
		if !fl.soldOut && clock >= timeFrom && clock <= timeTo && (cheapest == nil || fl.price < cheapest.price) {
			cheapest = &fl
		}
	}
	fares := []map[string]any{}
	if cheapest != nil {
		fares = append(fares, map[string]any{"outbound": map[string]any{
			"departureAirport": map[string]any{"iataCode": from},
			"arrivalAirport":   map[string]any{"iataCode": to},
			"departureDate":    cheapest.departure + ":00", "arrivalDate": cheapest.arrival + ":00",
			"price": price(*cheapest), "flightNumber": "FR1234",
		}})
	}
	writeJSON(w, map[string]any{"arrivalAirportCategories": nil, "fares": fares, "nextPage": nil, "size": len(fares)})
}

func (f *fakeRyanair) flightsOn(from, to, date string) []fakeFlight {
	var out []fakeFlight
	for _, fl := range f.flights {
		if fl.from == from && fl.to == to && fl.departure[:10] == date {
			out = append(out, fl)
		}
	}
	slices.SortFunc(out, func(a, b fakeFlight) int { return strings.Compare(a.departure, b.departure) })
	return out
}

func price(fl fakeFlight) map[string]any {
	return map[string]any{"value": json.Number(fmt.Sprintf("%.2f", fl.price)), "currencyCode": fl.currency}
}

// fakeNBP imitates NBP's API: the latest table A and table B of mid-market rates.
type fakeNBP struct {
	mu     sync.Mutex
	tables map[string]fakeNBPTable
	// failing tables answer with HTTP 500.
	failing map[string]bool
}

type fakeNBPTable struct {
	effectiveDate string
	rates         map[string]float64 // currency code → PLN
}

func newFakeNBP(t *testing.T) (*fakeNBP, string) {
	t.Helper()
	f := &fakeNBP{tables: map[string]fakeNBPTable{}, failing: map[string]bool{}}
	srv := httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(srv.Close)
	return f, srv.URL
}

func (f *fakeNBP) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	name, ok := strings.CutPrefix(r.URL.Path, "/api/exchangerates/tables/")
	name = strings.TrimSuffix(name, "/")
	table, known := f.tables[name]
	if !ok || !known || r.URL.Query().Get("format") != "json" {
		http.NotFound(w, r)
		return
	}
	// Like the real one (checked 2026-11-11), NBP turns away Go's default User-Agent.
	if strings.HasPrefix(r.UserAgent(), "Go-http-client") {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if f.failing[name] {
		http.Error(w, "fake failure", http.StatusInternalServerError)
		return
	}
	var list []map[string]any
	for code, mid := range table.rates {
		list = append(list, map[string]any{"currency": code, "code": code, "mid": mid})
	}
	writeJSON(w, []map[string]any{{"table": name, "no": "1/" + name + "/NBP/2026",
		"effectiveDate": table.effectiveDate, "rates": list}})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// takeCheapestPerDayRequests returns the cheapestPerDay requests logged so far and clears the log.
func (f *fakeRyanair) takeCheapestPerDayRequests() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	got := f.cheapestPerDayRequests
	f.cheapestPerDayRequests = nil
	return got
}
