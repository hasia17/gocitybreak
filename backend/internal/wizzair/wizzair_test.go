package wizzair_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/fetch"
	"github.com/hasia17/gocitybreak/backend/internal/wizzair"
)

// These tests drive the HTTP adapter against recorded responses of Wizz Air's undocumented API (version
// 29.25.0, recorded on 2026-11-16 unless a test says otherwise), served by a local imitation of
// www.wizzair.com and be.wizzair.com that insists on the session handshake like the real one.

const token = "8d05a60d3c66437f9deea94cc31c19a3"

// fakeWizzair answers the homepage and the API under one version, and records every request.
type fakeWizzair struct {
	*httptest.Server
	version    string
	homepage   int // the homepage's HTTP status
	timetables func(window flightList) string
	// statuses answers asset/flightinformation; the bodies it was asked with are kept in statusBodies.
	statuses     func() string
	statusBodies []map[string]any

	mu       sync.Mutex
	requests []string
	bodies   []flightList
	// sessions counts userSession/new calls; expired makes the next API call fail like a stale session.
	sessions int
	expired  bool
}

// flightList is the one-route request body of timetableV2.
type flightList struct {
	DepartureStation, ArrivalStation, From, To, PriceType string
}

func newFake(t *testing.T) *fakeWizzair {
	t.Helper()
	f := &fakeWizzair{version: "29.25.0", homepage: http.StatusOK}
	f.Server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeWizzair) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var cookies strings.Builder
	for _, c := range r.Cookies() {
		cookies.WriteString(" " + c.Name)
	}
	f.requests = append(f.requests, r.Method+" "+r.URL.RequestURI()+" cookies:"+cookies.String())

	if r.URL.Path == "/en-gb" {
		if f.homepage != http.StatusOK {
			http.Error(w, "unavailable", f.homepage)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "ak_bmsc", Value: "warm", Path: "/"})
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, payload("homepage.html"))
		return
	}
	api, ok := strings.CutPrefix(r.URL.Path, "/"+f.version+"/Api/")
	if !ok {
		http.NotFound(w, r)
		return
	}
	if api == "userSession/new" {
		f.sessions++
		f.expired = false
		http.SetCookie(w, &http.Cookie{Name: "ASP.NET_SessionId", Value: "session", Path: "/"})
		http.SetCookie(w, &http.Cookie{Name: "RequestVerificationToken", Value: token, Path: "/"})
		_, _ = io.WriteString(w, `{}`)
		return
	}
	if r.Header.Get("X-RequestVerificationToken") != token || f.expired {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"handlerError":"InvalidProtocol"}`)
		return
	}
	switch api {
	case "asset/map":
		if r.URL.Query().Get("languageCode") == "pl-pl" {
			_, _ = io.WriteString(w, payload("map_pl.json"))
			return
		}
		_, _ = io.WriteString(w, payload("map.json"))
	case "search/timetableV2":
		var body struct {
			FlightList                          []flightList
			PriceType                           string
			AdultCount, ChildCount, InfantCount int
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.FlightList) != 1 ||
			body.AdultCount != 1 || body.ChildCount != 0 || body.InfantCount != 0 {
			http.Error(w, fmt.Sprintf("unexpected body %+v (%v)", body, err), http.StatusBadRequest)
			return
		}
		window := body.FlightList[0]
		window.PriceType = body.PriceType
		f.bodies = append(f.bodies, window)
		_, _ = io.WriteString(w, f.timetables(window))
	case "asset/flightinformation":
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		f.statusBodies = append(f.statusBodies, body)
		_, _ = io.WriteString(w, f.statuses())
	default:
		http.NotFound(w, r)
	}
}

// client returns a Wizz Air client talking to the fake, with fallback as its configured API version.
func (f *fakeWizzair) client(fallback string) *wizzair.HTTPClient {
	return wizzair.NewHTTPClient(wizzair.Config{
		BaseURL:         f.URL,
		HomepageURL:     f.URL + "/en-gb",
		FallbackVersion: fallback,
		Fetch:           fetch.Options{InitialBackoff: time.Millisecond},
	})
}

func (f *fakeWizzair) takeRequests() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	got := f.requests
	f.requests = nil
	return got
}

func (f *fakeWizzair) takeBodies() []flightList {
	f.mu.Lock()
	defer f.mu.Unlock()
	got := f.bodies
	f.bodies = nil
	return got
}

// payload returns the recorded response body saved under testdata.
func payload(name string) string {
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		panic(err)
	}
	return string(b)
}

func TestClientShakesHandsBeforeItsFirstRequest(t *testing.T) {
	fake := newFake(t)
	client := fake.client("29.20.0")

	if _, err := client.Stations(t.Context()); err != nil {
		t.Fatalf("Stations: %v", err)
	}
	if _, err := client.Stations(t.Context()); err != nil {
		t.Fatalf("Stations again: %v", err)
	}

	// Homepage cookies first, then a session under the version the homepage names, then the token on every call.
	want := []string{
		"GET /en-gb cookies:",
		"GET /29.25.0/Api/userSession/new cookies: ak_bmsc",
		"GET /29.25.0/Api/asset/map?languageCode=en-gb cookies: ak_bmsc ASP.NET_SessionId RequestVerificationToken",
		"GET /29.25.0/Api/asset/map?languageCode=pl-pl cookies: ak_bmsc ASP.NET_SessionId RequestVerificationToken",
		"GET /29.25.0/Api/asset/map?languageCode=en-gb cookies: ak_bmsc ASP.NET_SessionId RequestVerificationToken",
		"GET /29.25.0/Api/asset/map?languageCode=pl-pl cookies: ak_bmsc ASP.NET_SessionId RequestVerificationToken",
	}
	if got := fake.takeRequests(); !reflect.DeepEqual(got, want) {
		t.Errorf("requests:\n got %q\nwant %q", got, want)
	}
}

func TestClientFallsBackToTheConfiguredVersionWhenTheHomepageFails(t *testing.T) {
	fake := newFake(t)
	fake.version = "29.20.0"
	fake.homepage = http.StatusForbidden

	if _, err := fake.client("29.20.0").Stations(t.Context()); err != nil {
		t.Fatalf("Stations: %v", err)
	}
}

func TestClientStartsANewSessionWhenTheOldOneIsRefused(t *testing.T) {
	fake := newFake(t)
	client := fake.client("29.20.0")
	if _, err := client.Stations(t.Context()); err != nil {
		t.Fatalf("Stations: %v", err)
	}
	fake.mu.Lock()
	fake.expired = true
	fake.mu.Unlock()

	if _, err := client.Stations(t.Context()); err != nil {
		t.Fatalf("Stations with an expired session: %v", err)
	}
	if fake.sessions != 2 {
		t.Errorf("sessions started = %d, want 2", fake.sessions)
	}
}

func TestStationsHaveTheirDirectConnectionsOnly(t *testing.T) {
	fake := newFake(t)

	got, err := fake.client("29.20.0").Stations(t.Context())

	if err != nil {
		t.Fatalf("Stations: %v", err)
	}
	// LON and MIL are Wizz Air's "all airports" pseudo-stations; LUZ → KUT is a Wizz-operated connection
	// (hand-added to the recording, which had none).
	// Names come in both of the catalogue's languages, from the station network in each.
	want := []wizzair.Station{
		{Code: "WAW", Names: names("Warsaw Chopin", "Warszawa Chopin"), CountryNames: names("Poland", "Polska"),
			CountryCode: "pl", Currency: "PLN", CityGroup: "WSW",
			Latitude: 52.16583333333333, Longitude: 20.96722222222222, Connections: []string{"BGY", "KUT", "LTN"}},
		{Code: "KTW", Names: names("Katowice", "Katowice"), CountryNames: names("Poland", "Polska"),
			CountryCode: "pl", Currency: "PLN", CityGroup: "SPQ",
			Latitude: 50.483333333333334, Longitude: 19.083333333333332, Connections: []string{"KUT", "LTN"}},
		{Code: "LUZ", Names: names("Lublin", "Lublin"), CountryNames: names("Poland", "Polska"),
			CountryCode: "pl", Currency: "PLN",
			Latitude: 51.231388888888894, Longitude: 22.690555555555555, Connections: []string{"LTN"}},
		{Code: "LTN", Names: names("London Luton", "Londyn-Luton"), CountryNames: names("United Kingdom", "Wielka Brytania"),
			CountryCode: "gb", Currency: "GBP", CityGroup: "LON",
			Latitude: 51.874722222222225, Longitude: -0.3683333333333333, Connections: []string{"KTW", "LUZ", "WAW"}},
		{Code: "BGY", Names: names("Milan Bergamo", "Mediolan-Bergamo"), CountryNames: names("Italy", "Włochy"),
			CountryCode: "it", Currency: "EUR", CityGroup: "MIL",
			Latitude: 45.66833333333333, Longitude: 9.700277777777776, Connections: []string{"WAW"}},
		{Code: "KUT", Names: names("Kutaisi", "Kutaisi"), CountryNames: names("Georgia", "Gruzja"),
			CountryCode: "ge", Currency: "GEL", CityGroup: "GEL",
			Latitude: 42.17666666666666, Longitude: 42.4825, Connections: []string{"KTW", "WAW"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("stations:\n got %+v\nwant %+v", got, want)
	}
}

func names(en, pl string) map[string]string { return map[string]string{"en": en, "pl": pl} }

func day(s string) time.Time {
	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return d
}

func at(s string) time.Time {
	d, err := time.Parse("2006-01-02T15:04", s)
	if err != nil {
		panic(err)
	}
	return d
}

func describe(days []wizzair.Day) []string {
	var got []string
	for _, d := range days {
		var line strings.Builder
		line.WriteString(d.Date.Format(time.DateOnly) + ":")
		for _, dep := range d.Departures {
			line.WriteString(" " + dep.Format("15:04"))
		}
		if d.Cheapest == nil {
			line.WriteString(", no price")
		} else {
			line.WriteString(fmt.Sprintf(", cheapest %s %d %s", d.Cheapest.Departure.Format("2006-01-02 15:04"),
				d.Cheapest.Price.Amount, d.Cheapest.Price.Currency))
		}
		got = append(got, line.String())
	}
	return got
}

func TestTimetableHasEveryDepartureAndTheCheapestFlightOfEachDay(t *testing.T) {
	fake := newFake(t)
	fake.timetables = func(flightList) string { return payload("timetable_waw_ltn.json") }

	days, err := fake.client("29.20.0").Timetable(t.Context(), "WAW", "LTN", day("2026-12-10"), day("2026-12-14"))

	if err != nil {
		t.Fatalf("Timetable: %v", err)
	}
	want := []string{
		"2026-12-10: 06:00 11:40 14:05 16:35, cheapest 2026-12-10 06:00 20900 PLN",
		"2026-12-11: 06:00 11:40 16:05, cheapest 2026-12-11 06:00 22900 PLN",
		"2026-12-12: 06:00 11:40 14:05 16:35, cheapest 2026-12-12 11:40 20900 PLN",
		"2026-12-13: 06:00 11:40 16:35, cheapest 2026-12-13 06:00 17900 PLN",
		"2026-12-14: 06:00 16:35, cheapest 2026-12-14 06:00 20900 PLN",
	}
	if got := describe(days); !reflect.DeepEqual(got, want) {
		t.Errorf("days:\n got %q\nwant %q", got, want)
	}
	if got, want := fake.takeBodies(), []flightList{{"WAW", "LTN", "2026-12-10", "2026-12-14", "regular"}}; !reflect.DeepEqual(got, want) {
		t.Errorf("requests %+v, want %+v", got, want)
	}
}

func TestTimetablePricesInTheDepartureStationsCurrency(t *testing.T) {
	fake := newFake(t)
	fake.timetables = func(flightList) string { return payload("timetable_ltn_waw.json") }

	days, err := fake.client("29.20.0").Timetable(t.Context(), "LTN", "WAW", day("2027-04-20"), day("2027-04-21"))

	if err != nil {
		t.Fatalf("Timetable: %v", err)
	}
	want := []string{
		"2027-04-20: 08:25 15:25 19:45, cheapest 2027-04-20 08:25 3499 GBP",
		"2027-04-21: 08:25 15:35 19:45, cheapest 2027-04-21 19:45 3499 GBP",
	}
	if got := describe(days); !reflect.DeepEqual(got, want) {
		t.Errorf("days:\n got %q\nwant %q", got, want)
	}
}

func TestTimetableLeavesDaysWithoutARealPriceUnpriced(t *testing.T) {
	fake := newFake(t)
	// Hand-built from the WAW → LTN recording in the documented shapes: a checkPrice day, a noData day
	// and a price of 0; none of these was seen live on 2026-11-16.
	fake.timetables = func(flightList) string { return payload("timetable_unpriced.json") }

	days, err := fake.client("29.20.0").Timetable(t.Context(), "WAW", "LTN", day("2026-12-10"), day("2026-12-13"))

	if err != nil {
		t.Fatalf("Timetable: %v", err)
	}
	want := []string{
		"2026-12-10: 06:00 11:40, no price",
		"2026-12-11: 06:00, no price",
		"2026-12-12: 06:00 11:40, no price",
		"2026-12-13: 06:00 11:40 16:35, cheapest 2026-12-13 06:00 17900 PLN",
	}
	if got := describe(days); !reflect.DeepEqual(got, want) {
		t.Errorf("days:\n got %q\nwant %q", got, want)
	}
}

func TestTimetableAsksForAtMost42DaysAtATime(t *testing.T) {
	fake := newFake(t)
	fake.timetables = func(flightList) string { return `{"outboundFlights":[],"returnFlights":null}` }

	if _, err := fake.client("29.20.0").Timetable(t.Context(), "WAW", "LTN", day("2026-12-01"), day("2027-02-28")); err != nil {
		t.Fatalf("Timetable: %v", err)
	}

	want := []flightList{
		{"WAW", "LTN", "2026-12-01", "2027-01-11", "regular"},
		{"WAW", "LTN", "2027-01-12", "2027-02-22", "regular"},
		{"WAW", "LTN", "2027-02-23", "2027-02-28", "regular"},
	}
	if got := fake.takeBodies(); !reflect.DeepEqual(got, want) {
		t.Errorf("requests:\n got %+v\nwant %+v", got, want)
	}
}

func TestCheapestFromAsksFromATimeOfDay(t *testing.T) {
	fake := newFake(t)
	fake.timetables = func(flightList) string { return payload("timetable_waw_ltn_from_1405.json") }

	got, err := fake.client("29.20.0").CheapestFrom(t.Context(), "WAW", "LTN", at("2026-12-12T14:05"))

	if err != nil {
		t.Fatalf("CheapestFrom: %v", err)
	}
	if got == nil || !got.Departure.Equal(at("2026-12-12T14:05")) || got.Price != (wizzair.Money{Amount: 20900, Currency: "PLN"}) {
		t.Errorf("CheapestFrom = %+v, want the 14:05 flight at 209 PLN", got)
	}
	if got, want := fake.takeBodies(), []flightList{{"WAW", "LTN", "2026-12-12T14:05:00", "2026-12-12T14:05:00", "regular"}}; !reflect.DeepEqual(got, want) {
		t.Errorf("requests %+v, want %+v", got, want)
	}
}

func TestCheapestFromIsNilWhenTheDayHasNoPrice(t *testing.T) {
	fake := newFake(t)
	fake.timetables = func(flightList) string { return payload("timetable_unpriced.json") }

	got, err := fake.client("29.20.0").CheapestFrom(t.Context(), "WAW", "LTN", at("2026-12-10T11:40"))

	if err != nil || got != nil {
		t.Errorf("CheapestFrom = %+v, %v; want no fare", got, err)
	}
}

func TestScheduleReadsTheScheduledTimesOfARoutesNearFlights(t *testing.T) {
	fake := newFake(t)
	// Recorded live on 2026-11-16 with the route filter the web app's flight status page sends.
	fake.statuses = func() string { return payload("flightinformation_waw_ltn.json") }

	flights, err := fake.client("29.20.0").Schedule(t.Context(), "WAW", "LTN")

	if err != nil {
		t.Fatalf("Schedule: %v", err)
	}
	var lines []string
	for _, f := range flights {
		lines = append(lines, f.Departure.Format("2006-01-02 15:04")+" → "+f.Arrival.Format("2006-01-02 15:04"))
	}
	// Local times at each airport, earliest first: Luton is an hour behind Warsaw, so 06:00 → 07:40 is 2 h 40.
	want := []string{
		"2026-11-16 11:40 → 2026-11-16 13:25",
		"2026-11-16 16:35 → 2026-11-16 18:20",
		"2026-11-17 06:00 → 2026-11-17 07:40",
		"2026-11-18 06:00 → 2026-11-18 07:40",
		"2026-11-19 06:00 → 2026-11-19 07:40",
		"2026-11-19 16:35 → 2026-11-19 18:20",
	}
	if !reflect.DeepEqual(lines, want) {
		t.Errorf("schedule:\n got %q\nwant %q", lines, want)
	}
	if want := []map[string]any{{"departureIATA": "WAW", "arrivalIATA": "LTN"}}; !reflect.DeepEqual(fake.statusBodies, want) {
		t.Errorf("request bodies %v, want %v", fake.statusBodies, want)
	}
}

func TestScheduleLeavesOutCancelledFlightsAndOnesWithoutTimes(t *testing.T) {
	fake := newFake(t)
	// Hand-built in the recorded shape: a cancelled flight and one without a scheduled arrival.
	fake.statuses = func() string {
		return `{"flightInformationResponseItems":[
{"scheduledDepartureTime":"2026-11-17T06:00:00","scheduledArrivalTime":"2026-11-17T07:40:00","flightStatus":"OnTime"},
{"scheduledDepartureTime":"2026-11-18T06:00:00","scheduledArrivalTime":"2026-11-18T07:40:00","flightStatus":"Cancelled"},
{"scheduledDepartureTime":"2026-11-19T06:00:00","scheduledArrivalTime":null,"flightStatus":"OnTime"}]}`
	}

	flights, err := fake.client("29.20.0").Schedule(t.Context(), "WAW", "LTN")

	if err != nil || len(flights) != 1 || !flights[0].Departure.Equal(at("2026-11-17T06:00")) {
		t.Errorf("Schedule = %+v, %v; want only the 2026-11-17 flight", flights, err)
	}
}
