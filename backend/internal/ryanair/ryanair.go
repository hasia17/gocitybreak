// Package ryanair talks to Ryanair's unofficial public API: the airport catalogue, routes, timetables and fares.
//
// None of these endpoints are documented; their shapes were checked by hand on 2026-11-10/11 (see ADR-0005).
package ryanair

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/fetch"
)

// Client is what the price worker needs from Ryanair. HTTPClient implements it.
type Client interface {
	// Airports returns Ryanair's catalogue of active airports.
	Airports(ctx context.Context) ([]Airport, error)
	// Routes returns the codes of airports Ryanair flies to directly from airport.
	Routes(ctx context.Context, airport string) ([]string, error)
	// CheapestPerDay returns the cheapest fare of each day of month on the route from → to.
	CheapestPerDay(ctx context.Context, from, to string, month time.Time) ([]DayFare, error)
	// Timetable returns every scheduled flight of month on the route from → to.
	Timetable(ctx context.Context, from, to string, month time.Time) ([]ScheduledFlight, error)
	// FareAt returns the fare of the flight from → to departing at the given local time,
	// or nil when Ryanair offers no fare for it (e.g. sold out).
	FareAt(ctx context.Context, from, to string, departure time.Time) (*Fare, error)
}

// Airport is an airport from Ryanair's catalogue, with the city and country Ryanair assigns it to.
type Airport struct {
	Code        string
	Name        string
	TimeZone    string
	CityCode    string
	CityName    string
	CountryCode string // lower-case ISO 3166-1 alpha-2, e.g. "pl"
	CountryName string
}

// Money is an amount in minor units (grosze, cents) of a currency.
type Money struct {
	Amount   int64
	Currency string
}

// Fare is a priced flight. Departure and arrival are local times at the respective airport;
// their time.Location is meaningless.
type Fare struct {
	Departure time.Time
	Arrival   time.Time
	Price     Money
}

// DayFare is the cheapest fare of a day; Fare is nil when the day has no flight on sale.
type DayFare struct {
	Day  time.Time
	Fare *Fare
}

// ScheduledFlight is a flight from the timetable: no price, local departure and arrival times of day.
type ScheduledFlight struct {
	Date          time.Time
	DepartureTime string // "15:04", departure airport's local time
	ArrivalTime   string // "15:04", arrival airport's local time
}

// HTTPClient is the Client backed by Ryanair's web API.
type HTTPClient struct {
	baseURL string
	fetch   *fetch.Client
}

// NewHTTPClient returns a client for the API at baseURL (https://www.ryanair.com in production).
func NewHTTPClient(baseURL string, f *fetch.Client) *HTTPClient {
	return &HTTPClient{baseURL: baseURL, fetch: f}
}

// localLayout is how Ryanair writes local date-times: no offset, the airport's wall clock.
const localLayout = "2006-01-02T15:04:05"

type airportJSON struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	TimeZone string `json:"timeZone"`
	City     struct {
		Code string `json:"code"`
		Name string `json:"name"`
	} `json:"city"`
	Country struct {
		Code string `json:"code"`
		Name string `json:"name"`
	} `json:"country"`
}

func (c *HTTPClient) Airports(ctx context.Context) ([]Airport, error) {
	var body []airportJSON
	if err := c.fetch.GetJSON(ctx, c.baseURL+"/api/views/locate/5/airports/en/active", &body); err != nil {
		return nil, fmt.Errorf("airports: %w", err)
	}
	airports := make([]Airport, 0, len(body))
	for _, a := range body {
		airports = append(airports, Airport{
			Code: a.Code, Name: a.Name, TimeZone: a.TimeZone,
			CityCode: a.City.Code, CityName: a.City.Name,
			CountryCode: a.Country.Code, CountryName: a.Country.Name,
		})
	}
	return airports, nil
}

func (c *HTTPClient) Routes(ctx context.Context, airport string) ([]string, error) {
	var body []struct {
		ArrivalAirport struct {
			Code string `json:"code"`
		} `json:"arrivalAirport"`
		// Set for routes with a change of plane; we only want direct ones.
		ConnectingAirport *struct{} `json:"connectingAirport"`
	}
	u := c.baseURL + "/api/views/locate/searchWidget/routes/en/airport/" + url.PathEscape(airport)
	if err := c.fetch.GetJSON(ctx, u, &body); err != nil {
		return nil, fmt.Errorf("routes from %s: %w", airport, err)
	}
	var codes []string
	for _, r := range body {
		if r.ConnectingAirport == nil && r.ArrivalAirport.Code != "" {
			codes = append(codes, r.ArrivalAirport.Code)
		}
	}
	return codes, nil
}

type priceJSON struct {
	Value        float64 `json:"value"`
	CurrencyCode string  `json:"currencyCode"`
}

func (p priceJSON) money() Money {
	return Money{Amount: int64(math.Round(p.Value * 100)), Currency: p.CurrencyCode}
}

func (c *HTTPClient) CheapestPerDay(ctx context.Context, from, to string, month time.Time) ([]DayFare, error) {
	var body struct {
		Outbound struct {
			Fares []struct {
				Day           string     `json:"day"`
				DepartureDate *string    `json:"departureDate"`
				ArrivalDate   *string    `json:"arrivalDate"`
				Price         *priceJSON `json:"price"`
				SoldOut       bool       `json:"soldOut"`
				Unavailable   bool       `json:"unavailable"`
			} `json:"fares"`
		} `json:"outbound"`
	}
	u := fmt.Sprintf("%s/api/farfnd/v4/oneWayFares/%s/%s/cheapestPerDay?outboundMonthOfDate=%s",
		c.baseURL, url.PathEscape(from), url.PathEscape(to), firstOfMonth(month).Format(time.DateOnly))
	if err := c.fetch.GetJSON(ctx, u, &body); err != nil {
		return nil, fmt.Errorf("cheapest per day %s→%s %s: %w", from, to, month.Format("2006-01"), err)
	}
	days := make([]DayFare, 0, len(body.Outbound.Fares))
	for _, f := range body.Outbound.Fares {
		day, err := time.Parse(time.DateOnly, f.Day)
		if err != nil {
			return nil, fmt.Errorf("cheapest per day %s→%s: bad day %q", from, to, f.Day)
		}
		df := DayFare{Day: day}
		if !f.SoldOut && !f.Unavailable && f.Price != nil && f.DepartureDate != nil && f.ArrivalDate != nil {
			fare, err := parseFare(*f.DepartureDate, *f.ArrivalDate, *f.Price)
			if err != nil {
				return nil, fmt.Errorf("cheapest per day %s→%s %s: %w", from, to, f.Day, err)
			}
			df.Fare = &fare
		}
		days = append(days, df)
	}
	return days, nil
}

func (c *HTTPClient) Timetable(ctx context.Context, from, to string, month time.Time) ([]ScheduledFlight, error) {
	var body struct {
		Days []struct {
			Day     int `json:"day"`
			Flights []struct {
				DepartureTime string `json:"departureTime"`
				ArrivalTime   string `json:"arrivalTime"`
			} `json:"flights"`
		} `json:"days"`
	}
	u := fmt.Sprintf("%s/api/timtbl/3/schedules/%s/%s/years/%d/months/%d",
		c.baseURL, url.PathEscape(from), url.PathEscape(to), month.Year(), int(month.Month()))
	err := c.fetch.GetJSON(ctx, u, &body)
	var status *fetch.StatusError
	if errors.As(err, &status) && status.Code == http.StatusNotFound {
		return nil, nil // no timetable published for the month: nothing flies
	}
	if err != nil {
		return nil, fmt.Errorf("timetable %s→%s %s: %w", from, to, month.Format("2006-01"), err)
	}
	var flights []ScheduledFlight
	for _, d := range body.Days {
		date := time.Date(month.Year(), month.Month(), d.Day, 0, 0, 0, 0, time.UTC)
		for _, f := range d.Flights {
			flights = append(flights, ScheduledFlight{Date: date, DepartureTime: f.DepartureTime, ArrivalTime: f.ArrivalTime})
		}
	}
	return flights, nil
}

func (c *HTTPClient) FareAt(ctx context.Context, from, to string, departure time.Time) (*Fare, error) {
	var body struct {
		Fares []struct {
			Outbound struct {
				DepartureDate string    `json:"departureDate"`
				ArrivalDate   string    `json:"arrivalDate"`
				Price         priceJSON `json:"price"`
			} `json:"outbound"`
		} `json:"fares"`
	}
	day, clock := departure.Format(time.DateOnly), departure.Format("15:04")
	q := url.Values{
		"departureAirportIataCode":  {from},
		"arrivalAirportIataCode":    {to},
		"outboundDepartureDateFrom": {day},
		"outboundDepartureDateTo":   {day},
		"outboundDepartureTimeFrom": {clock},
		"outboundDepartureTimeTo":   {clock},
		"language":                  {"en"},
		"market":                    {"en-gb"},
	}
	if err := c.fetch.GetJSON(ctx, c.baseURL+"/api/farfnd/v4/oneWayFares?"+q.Encode(), &body); err != nil {
		return nil, fmt.Errorf("fare %s→%s %s %s: %w", from, to, day, clock, err)
	}
	for _, f := range body.Fares {
		fare, err := parseFare(f.Outbound.DepartureDate, f.Outbound.ArrivalDate, f.Outbound.Price)
		if err != nil {
			return nil, fmt.Errorf("fare %s→%s %s %s: %w", from, to, day, clock, err)
		}
		// The time window is the only thing tying the answer to our flight; make sure it held.
		if fare.Departure.Equal(departure) {
			return &fare, nil
		}
	}
	return nil, nil
}

func parseFare(departure, arrival string, price priceJSON) (Fare, error) {
	dep, err := time.Parse(localLayout, departure)
	if err != nil {
		return Fare{}, fmt.Errorf("bad departure %q", departure)
	}
	arr, err := time.Parse(localLayout, arrival)
	if err != nil {
		return Fare{}, fmt.Errorf("bad arrival %q", arrival)
	}
	if price.CurrencyCode == "" {
		return Fare{}, errors.New("price without currency")
	}
	return Fare{Departure: dep, Arrival: arr, Price: price.money()}, nil
}

func firstOfMonth(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}
