package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/catalogue"
	"github.com/hasia17/gocitybreak/backend/internal/search"
	"github.com/hasia17/gocitybreak/backend/internal/wallclock"
)

// timeLayout formats local times without seconds; dates use time.DateOnly.
const timeLayout = "15:04"

type searchRequest struct {
	Kind         string   `json:"kind"`
	HomeAirports []string `json:"homeAirports"`
	Destination  struct {
		codesJSON
		Anywhere bool `json:"anywhere"`
	} `json:"destination"`
	Exclusions   codesJSON `json:"exclusions"`
	TravelWindow *struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"travelWindow"`
	FixedDates *struct {
		Outbound string `json:"outbound"`
		Inbound  string `json:"inbound"`
	} `json:"fixedDates"`
	StayLength *stayLengthJSON `json:"stayLength"`
	WorkStart  workHourJSON    `json:"workStart"`
	WorkEnd    workHourJSON    `json:"workEnd"`
	// MaxLeaveDays is optional; 0 is a valid maximum.
	MaxLeaveDays *int        `json:"maxLeaveDays"`
	Filters      filtersJSON `json:"filters"`
	Sort         string      `json:"sort"`
}

// codesJSON names airports, cities and countries by the codes the catalogue gives them.
type codesJSON struct {
	Airports  []string `json:"airports"`
	Cities    []string `json:"cities"`
	Countries []string `json:"countries"`
}

func (c codesJSON) codes() catalogue.Codes {
	return catalogue.Codes{Airports: c.Airports, Cities: c.Cities, Countries: c.Countries}
}

type searchResponse struct {
	Offers []offerJSON `json:"offers"`
}

type offerJSON struct {
	Kind     string   `json:"kind"`
	Outbound legJSON  `json:"outbound"`
	Inbound  *legJSON `json:"inbound,omitempty"`
	// Nights is set for round-trip offers only, where 0 is a valid number of nights.
	Nights         *int      `json:"nights,omitempty"`
	Price          priceJSON `json:"price"`
	PriceFetchedAt time.Time `json:"priceFetchedAt"`
	// LeaveDays is set for round-trip offers only, where 0 is a valid number of leave days.
	LeaveDays *int `json:"leaveDays,omitempty"`
}

type legJSON struct {
	IsDirect bool         `json:"isDirect"`
	Flights  []flightJSON `json:"flights"`
}

type flightJSON struct {
	Airline          string        `json:"airline"`
	DepartureAirport string        `json:"departureAirport"`
	ArrivalAirport   string        `json:"arrivalAirport"`
	Departure        localTimeJSON `json:"departure"`
	Arrival          localTimeJSON `json:"arrival"`
	OriginalPrice    moneyJSON     `json:"originalPrice"`
	FetchedAt        time.Time     `json:"fetchedAt"`
}

type localTimeJSON struct {
	Date     string `json:"date"`
	Time     string `json:"time"`
	TimeZone string `json:"timeZone"`
}

type moneyJSON struct {
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
}

type priceJSON struct {
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
	Approximate bool    `json:"approximate"`
}

func (a *App) search(w http.ResponseWriter, r *http.Request) {
	q, err := parseSearchRequest(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	offers, err := a.searcher.Search(r.Context(), q)
	if invalid, ok := errors.AsType[*search.QueryError](err); ok {
		http.Error(w, invalid.Error(), http.StatusBadRequest)
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "search failed", "err", err)
		http.Error(w, "search failed", http.StatusInternalServerError)
		return
	}
	resp := searchResponse{Offers: make([]offerJSON, 0, len(offers))}
	for _, o := range offers {
		resp.Offers = append(resp.Offers, toOfferJSON(o))
	}
	writeJSON(w, http.StatusOK, resp)
}

// parseSearchRequest decodes a search query and parses its formats — dates, times of day and
// weekday names; its errors are meant for the API client. It checks no rule of the search and
// sets no default: the search module owns both, so they hold for every caller of the search.
func parseSearchRequest(r *http.Request) (search.Query, error) {
	var req searchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return search.Query{}, errors.New("search query is not valid JSON")
	}
	q := search.Query{
		Kind:         search.OfferKind(req.Kind),
		HomeAirports: req.HomeAirports,
		Destination: search.Destination{
			Codes:      req.Destination.codes(),
			Anywhere:   req.Destination.Anywhere,
			Exclusions: req.Exclusions.codes(),
		},
		Sort: search.SortOrder(req.Sort),
	}
	var err error
	if req.TravelWindow != nil {
		from, err := time.Parse(time.DateOnly, req.TravelWindow.From)
		if err != nil {
			return search.Query{}, errors.New("travelWindow.from must be a date in YYYY-MM-DD format")
		}
		to, err := time.Parse(time.DateOnly, req.TravelWindow.To)
		if err != nil {
			return search.Query{}, errors.New("travelWindow.to must be a date in YYYY-MM-DD format")
		}
		q.TravelWindow = search.TravelWindow{From: from, To: to}
	}
	if req.FixedDates != nil {
		outbound, err := time.Parse(time.DateOnly, req.FixedDates.Outbound)
		if err != nil {
			return search.Query{}, errors.New("fixedDates.outbound must be a date in YYYY-MM-DD format")
		}
		q.FixedDates = &search.FixedDates{Outbound: outbound}
		if q.Kind.IsRoundTrip() && req.FixedDates.Inbound != "" {
			inbound, err := time.Parse(time.DateOnly, req.FixedDates.Inbound)
			if err != nil {
				return search.Query{}, errors.New("fixedDates.inbound must be a date in YYYY-MM-DD format")
			}
			q.FixedDates.Inbound = inbound
		}
	}
	if q.Filters, err = req.Filters.parse(); err != nil {
		return search.Query{}, err
	}
	// These fields apply only to round trips; a one-way request's values are ignored, even
	// when they would be invalid for a round trip.
	if q.Kind.IsRoundTrip() {
		if req.StayLength != nil {
			q.StayLength = &search.StayLength{Min: req.StayLength.Min, Max: req.StayLength.Max}
		}
		if q.WorkStart, err = req.WorkStart.parse("workStart"); err != nil {
			return search.Query{}, err
		}
		if q.WorkEnd, err = req.WorkEnd.parse("workEnd"); err != nil {
			return search.Query{}, err
		}
		// The request's top-level maximum belongs among the query's filters.
		q.Filters.MaxLeaveDays = req.MaxLeaveDays
	}
	return q, nil
}

// stayLengthJSON is the range of nights of a round-trip offer, both ends inclusive.
type stayLengthJSON struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

// workHourJSON is an HH:MM time of day of the request, empty when the query sets none.
type workHourJSON string

// parse turns the work hour called name into an offset from midnight; an unset work hour stays nil.
func (w workHourJSON) parse(name string) (*time.Duration, error) {
	if w == "" {
		return nil, nil
	}
	d, err := timeOfDay(string(w))
	if err != nil {
		return nil, fmt.Errorf("%s must be a time in HH:MM format", name)
	}
	return new(d), nil
}

// timeOfDay parses an HH:MM time into an offset from midnight.
func timeOfDay(s string) (time.Duration, error) {
	t, err := time.Parse(timeLayout, s)
	if err != nil {
		return 0, err
	}
	return wallclock.TimeOfDay(t), nil
}

func toOfferJSON(o search.Offer) offerJSON {
	offer := offerJSON{
		Kind:           string(o.Kind),
		Outbound:       toLegJSON(o.Outbound),
		Price:          toPriceJSON(o.Price),
		PriceFetchedAt: o.PriceFetchedAt.UTC(),
	}
	if o.Inbound != nil {
		offer.Inbound = new(toLegJSON(*o.Inbound))
		offer.Nights = new(o.Nights)
		offer.LeaveDays = new(o.LeaveDays)
	}
	return offer
}

func toPriceJSON(p search.Price) priceJSON {
	return priceJSON{Amount: majorUnits(p.Amount), Currency: p.Currency, Approximate: p.Approximate}
}

func toLegJSON(l search.Leg) legJSON {
	leg := legJSON{IsDirect: l.IsDirect(), Flights: make([]flightJSON, 0, len(l.Flights))}
	for _, f := range l.Flights {
		leg.Flights = append(leg.Flights, flightJSON{
			Airline:          string(f.Airline),
			DepartureAirport: f.DepartureAirport,
			ArrivalAirport:   f.ArrivalAirport,
			Departure:        toLocalTimeJSON(f.Departure),
			Arrival:          toLocalTimeJSON(f.Arrival),
			OriginalPrice:    moneyJSON{Amount: majorUnits(f.OriginalPrice.Amount), Currency: f.OriginalPrice.Currency},
			FetchedAt:        f.FetchedAt.UTC(),
		})
	}
	return leg
}

func toLocalTimeJSON(t search.LocalTime) localTimeJSON {
	return localTimeJSON{
		Date:     t.DateTime.Format(time.DateOnly),
		Time:     t.DateTime.Format(timeLayout),
		TimeZone: t.TimeZone,
	}
}

// majorUnits turns minor units (grosze, cents) into a decimal amount for JSON.
func majorUnits(minor int64) float64 {
	return float64(minor) / 100
}
