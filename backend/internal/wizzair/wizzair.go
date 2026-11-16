// Package wizzair talks to Wizz Air's unofficial web API: the station network and the timetable with the cheapest
// fare of each day (ADR-0008).
//
// None of these endpoints are documented; their shapes were checked by hand against API version 29.25.0 on
// 2026-11-15/16, with https://github.com/victorlane/flywizz (docs/internal-api-spec.md) as a guide.
package wizzair

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/fetch"
)

// Client is what the price worker needs from Wizz Air. HTTPClient implements it.
type Client interface {
	// Stations returns Wizz Air's airports with the airports they fly to directly.
	Stations(ctx context.Context) ([]Station, error)
	// Timetable returns each day from first to last (inclusive) on which Wizz Air flies from → to, with every
	// departure of the day and the regular fare of the day's cheapest flight.
	Timetable(ctx context.Context, from, to string, first, last time.Time) ([]Day, error)
	// CheapestFrom returns the cheapest flight from → to on the day of departure among those departing at its
	// time of day or later, with its regular fare, or nil when Wizz Air prices none of them.
	CheapestFrom(ctx context.Context, from, to string, departure time.Time) (*Fare, error)
	// Schedule returns the scheduled departure and arrival of the route's flights of the next few days.
	Schedule(ctx context.Context, from, to string) ([]ScheduledFlight, error)
}

// Station is a Wizz Air airport.
type Station struct {
	Code string
	Name string
	// CountryCode is lower-case ISO 3166-1 alpha-2, like the catalogue's.
	CountryCode string
	// Currency is what Wizz Air prices flights departing from the station in.
	Currency string
	// CityGroup is Wizz Air's grouping of airports by city ("mac"), empty when it has none.
	CityGroup           string
	Latitude, Longitude float64
	// Connections are the codes of the stations Wizz Air flies to directly from this one.
	Connections []string
}

// Money is an amount in minor units (grosze, pence) of a currency.
type Money struct {
	Amount   int64
	Currency string
}

// Fare is a priced flight; Departure is the local time at the departure airport (its time.Location is meaningless).
type Fare struct {
	Departure time.Time
	Price     Money
}

// Day is a day on which a route flies: every departure of the day in local time, earliest first, and the day's
// cheapest flight, nil when Wizz Air gives the day no price.
type Day struct {
	Date       time.Time
	Departures []time.Time
	Cheapest   *Fare
}

// Config says where the client finds Wizz Air.
type Config struct {
	// BaseURL is the API host (https://be.wizzair.com in production); the API version is appended to it.
	BaseURL string
	// HomepageURL is the page that sets the first cookies and names the current API version
	// (https://www.wizzair.com/en-gb in production).
	HomepageURL string
	// FallbackVersion is the API version used when the homepage doesn't name one, e.g. "29.25.0".
	FallbackVersion string
	// Fetch tunes the HTTP client: rate limit, retries, user agent. Its HTTPClient gets a cookie jar for the session.
	Fetch fetch.Options
}

// HTTPClient is the Client backed by Wizz Air's web API. It is safe for concurrent use.
type HTTPClient struct {
	cfg   Config
	fetch *fetch.Client
	jar   http.CookieJar

	mu  sync.Mutex
	api string // the versioned API URL, set by the handshake
}

// NewHTTPClient returns a client for the API described by cfg.
func NewHTTPClient(cfg Config) *HTTPClient {
	jar, _ := cookiejar.New(nil) // cookiejar.New never fails without options
	httpClient := &http.Client{Timeout: 30 * time.Second}
	if cfg.Fetch.HTTPClient != nil {
		copied := *cfg.Fetch.HTTPClient
		httpClient = &copied
	}
	httpClient.Jar = jar
	opts := cfg.Fetch
	opts.HTTPClient = httpClient
	return &HTTPClient{cfg: cfg, fetch: fetch.NewClient(opts), jar: jar}
}

// apiVersion finds the API URL the web app talks to, e.g. apiUrl:"https://be.wizzair.com/29.25.0/Api".
var apiVersion = regexp.MustCompile(`apiUrl:"[^"]*/(\d+(?:\.\d+)+)/Api"`)

// handshake starts a session: the homepage's cookies and API version, then a new user session that sets the
// RequestVerificationToken cookie every API call must echo in a header.
func (c *HTTPClient) handshake(ctx context.Context) (string, error) {
	version := c.cfg.FallbackVersion
	page, err := c.fetch.Do(ctx, fetch.Request{URL: c.cfg.HomepageURL, Header: http.Header{"Accept": {"text/html"}}})
	if m := apiVersion.FindSubmatch(page); err == nil && m != nil {
		version = string(m[1])
	}
	if version == "" {
		return "", fmt.Errorf("handshake: no API version on the homepage (%v) and none configured", err)
	}
	api := strings.TrimSuffix(c.cfg.BaseURL, "/") + "/" + version + "/Api"
	if _, err := c.fetch.Do(ctx, fetch.Request{URL: api + "/userSession/new"}); err != nil {
		return "", fmt.Errorf("handshake: %w", err)
	}
	return api, nil
}

// call makes an API request in a session, starting one first if needed. A 400 answer is how Wizz Air refuses a
// stale session ({"handlerError":"InvalidProtocol"}), so it starts a new session and asks once more.
func (c *HTTPClient) call(ctx context.Context, method, path string, in, out any) error {
	var body []byte
	if in != nil {
		var err error
		if body, err = json.Marshal(in); err != nil {
			return err
		}
	}
	for attempt := 1; ; attempt++ {
		api, err := c.session(ctx, attempt > 1)
		if err != nil {
			return err
		}
		resp, err := c.fetch.Do(ctx, fetch.Request{Method: method, URL: api + "/" + path, Header: c.tokenHeader(api), Body: body})
		if status, ok := errors.AsType[*fetch.StatusError](err); ok && status.Code == http.StatusBadRequest && attempt == 1 {
			continue
		}
		if err != nil {
			return err
		}
		if err := json.Unmarshal(resp, out); err != nil {
			return fmt.Errorf("%s %s: decode JSON: %w", method, path, err)
		}
		return nil
	}
}

// session returns the versioned API URL of the current session, starting a new session when there is none or
// renew is set.
func (c *HTTPClient) session(ctx context.Context, renew bool) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.api == "" || renew {
		api, err := c.handshake(ctx)
		if err != nil {
			return "", err
		}
		c.api = api
	}
	return c.api, nil
}

// tokenHeader echoes the session's current RequestVerificationToken, which Wizz Air may reissue on any answer.
func (c *HTTPClient) tokenHeader(api string) http.Header {
	u, err := url.Parse(api)
	if err != nil {
		return nil
	}
	for _, cookie := range c.jar.Cookies(u) {
		if cookie.Name == "RequestVerificationToken" {
			return http.Header{"X-RequestVerificationToken": {cookie.Value}}
		}
	}
	return nil
}

func (c *HTTPClient) Stations(ctx context.Context) ([]Station, error) {
	var body struct {
		Cities []struct {
			IATA          string  `json:"iata"`
			Mac           *string `json:"mac"`
			ShortName     string  `json:"shortName"`
			CountryCode   string  `json:"countryCode"`
			CurrencyCode  string  `json:"currencyCode"`
			Latitude      float64 `json:"latitude"`
			Longitude     float64 `json:"longitude"`
			IsFakeStation bool    `json:"isFakeStation"`
			Connections   []struct {
				IATA           string `json:"iata"`
				IsConnected    bool   `json:"isConnected"`
				IsDirectFlight bool   `json:"isDirectFlight"`
			} `json:"connections"`
		} `json:"cities"`
	}
	if err := c.call(ctx, http.MethodGet, "asset/map?languageCode=en-gb", nil, &body); err != nil {
		return nil, fmt.Errorf("stations: %w", err)
	}
	// Pseudo-stations such as LON ("London (All Airports)") group real ones; they are no airport to fly to.
	pseudo := map[string]bool{}
	for _, s := range body.Cities {
		if s.IsFakeStation {
			pseudo[s.IATA] = true
		}
	}
	var stations []Station
	for _, s := range body.Cities {
		if s.IsFakeStation {
			continue
		}
		station := Station{
			Code: s.IATA, Name: strings.TrimSpace(s.ShortName), CountryCode: strings.ToLower(s.CountryCode),
			Currency: s.CurrencyCode, Latitude: s.Latitude, Longitude: s.Longitude,
		}
		if s.Mac != nil {
			station.CityGroup = *s.Mac
		}
		for _, conn := range s.Connections {
			// isConnected marks Wizz Air's own connections with a change of plane; we want direct flights.
			if conn.IsDirectFlight && !conn.IsConnected && !pseudo[conn.IATA] {
				station.Connections = append(station.Connections, conn.IATA)
			}
		}
		slices.Sort(station.Connections)
		stations = append(stations, station)
	}
	return stations, nil
}

// window is the longest date range timetableV2 answers, in days.
const window = 42

// localLayout is how Wizz Air writes local date-times: no offset, the airport's wall clock.
const localLayout = "2006-01-02T15:04:05"

type timetableRequest struct {
	FlightList  []timetableRoute `json:"flightList"`
	PriceType   string           `json:"priceType"`
	AdultCount  int              `json:"adultCount"`
	ChildCount  int              `json:"childCount"`
	InfantCount int              `json:"infantCount"`
}

type timetableRoute struct {
	DepartureStation string `json:"departureStation"`
	ArrivalStation   string `json:"arrivalStation"`
	From             string `json:"from"`
	To               string `json:"to"`
}

type timetableDay struct {
	DepartureDate string `json:"departureDate"`
	Price         *struct {
		Amount       float64 `json:"amount"`
		CurrencyCode string  `json:"currencyCode"`
	} `json:"price"`
	PriceType      string `json:"priceType"`
	DepartureDates []struct {
		Date               string `json:"date"`
		IsCheapestOfTheDay bool   `json:"isCheapestOfTheDay"`
	} `json:"departureDates"`
}

// timetable asks timetableV2 for one route and window, at the regular fare open to everyone (not the Wizz Discount
// Club's) for one adult. from and to are dates, or date-times whose time of day cuts the first day's departures.
func (c *HTTPClient) timetable(ctx context.Context, route timetableRoute) ([]Day, error) {
	var body struct {
		OutboundFlights []timetableDay `json:"outboundFlights"`
	}
	req := timetableRequest{FlightList: []timetableRoute{route}, PriceType: "regular", AdultCount: 1}
	if err := c.call(ctx, http.MethodPost, "search/timetableV2", req, &body); err != nil {
		return nil, err
	}
	days := make([]Day, 0, len(body.OutboundFlights))
	for _, d := range body.OutboundFlights {
		day, err := parseDay(d)
		if err != nil {
			return nil, err
		}
		days = append(days, day)
	}
	return days, nil
}

func parseDay(d timetableDay) (Day, error) {
	first, err := time.Parse(localLayout, d.DepartureDate)
	if err != nil {
		return Day{}, fmt.Errorf("bad departure date %q", d.DepartureDate)
	}
	day := Day{Date: time.Date(first.Year(), first.Month(), first.Day(), 0, 0, 0, 0, time.UTC)}
	var cheapest time.Time
	for _, dep := range d.DepartureDates {
		t, err := time.Parse(localLayout, dep.Date)
		if err != nil {
			return Day{}, fmt.Errorf("bad departure %q", dep.Date)
		}
		day.Departures = append(day.Departures, t)
		if dep.IsCheapestOfTheDay {
			cheapest = t
		}
	}
	slices.SortFunc(day.Departures, time.Time.Compare)
	// checkPrice and noData days, and a price of 0, are no price we can store.
	if d.PriceType == "price" && d.Price != nil && d.Price.Amount > 0 && d.Price.CurrencyCode != "" {
		if cheapest.IsZero() {
			cheapest = first
		}
		day.Cheapest = &Fare{Departure: cheapest,
			Price: Money{Amount: int64(math.Round(d.Price.Amount * 100)), Currency: d.Price.CurrencyCode}}
	}
	return day, nil
}

func (c *HTTPClient) Timetable(ctx context.Context, from, to string, first, last time.Time) ([]Day, error) {
	var days []Day
	for start := first; !start.After(last); start = start.AddDate(0, 0, window) {
		end := start.AddDate(0, 0, window-1)
		if end.After(last) {
			end = last
		}
		got, err := c.timetable(ctx, timetableRoute{DepartureStation: from, ArrivalStation: to,
			From: start.Format(time.DateOnly), To: end.Format(time.DateOnly)})
		if err != nil {
			return nil, fmt.Errorf("timetable %s→%s %s..%s: %w", from, to, start.Format(time.DateOnly), end.Format(time.DateOnly), err)
		}
		days = append(days, got...)
	}
	return days, nil
}

func (c *HTTPClient) CheapestFrom(ctx context.Context, from, to string, departure time.Time) (*Fare, error) {
	// A time of day in to is ignored, but to must not end before from.
	at := departure.Format(localLayout)
	days, err := c.timetable(ctx, timetableRoute{DepartureStation: from, ArrivalStation: to, From: at, To: at})
	if err != nil {
		return nil, fmt.Errorf("cheapest %s→%s from %s: %w", from, to, at, err)
	}
	date := time.Date(departure.Year(), departure.Month(), departure.Day(), 0, 0, 0, 0, time.UTC)
	for _, d := range days {
		if d.Date.Equal(date) {
			return d.Cheapest, nil
		}
	}
	return nil, nil
}
