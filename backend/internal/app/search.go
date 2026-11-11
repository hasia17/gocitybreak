package app

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/catalogue"
	"github.com/hasia17/gocitybreak/backend/internal/search"
)

// timeLayout formats local times without seconds; dates use time.DateOnly.
const timeLayout = "15:04"

type searchRequest struct {
	Kind         string   `json:"kind"`
	HomeAirports []string `json:"homeAirports"`
	Destination  struct {
		placesJSON
		Anywhere bool `json:"anywhere"`
	} `json:"destination"`
	Exclusions   placesJSON `json:"exclusions"`
	TravelWindow struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"travelWindow"`
	StayLength *struct {
		Min int `json:"min"`
		Max int `json:"max"`
	} `json:"stayLength"`
	WorkStart string `json:"workStart"`
	WorkEnd   string `json:"workEnd"`
	// MaxLeaveDays is optional; 0 is a valid maximum.
	MaxLeaveDays *int        `json:"maxLeaveDays"`
	Filters      filtersJSON `json:"filters"`
	Sort         string      `json:"sort"`
}

// placesJSON names airports, cities and countries by the codes the catalogue gives them.
type placesJSON struct {
	Airports  []string `json:"airports"`
	Cities    []string `json:"cities"`
	Countries []string `json:"countries"`
}

func (p placesJSON) places() catalogue.Places {
	return catalogue.Places{Airports: p.Airports, Cities: p.Cities, Countries: p.Countries}
}

type searchResponse struct {
	Offers []offerJSON `json:"offers"`
}

type offerJSON struct {
	Kind     string   `json:"kind"`
	Outbound legJSON  `json:"outbound"`
	Inbound  *legJSON `json:"inbound,omitempty"`
	// Nights is set for round-trip offers only, where 0 is a valid number of nights.
	Nights *int      `json:"nights,omitempty"`
	Price  priceJSON `json:"price"`
	// PricePerNight is set for round-trip offers of at least one night.
	PricePerNight  *priceJSON `json:"pricePerNight,omitempty"`
	PriceFetchedAt time.Time  `json:"priceFetchedAt"`
	// LeaveDays is set for round-trip offers only, where 0 is a valid number of leave days.
	LeaveDays *int `json:"leaveDays,omitempty"`
}

type legJSON struct {
	IsDirect bool         `json:"isDirect"`
	Flights  []flightJSON `json:"flights"`
}

type flightJSON struct {
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

// parseSearchRequest decodes and validates a search query; its errors are meant for the API client.
func parseSearchRequest(r *http.Request) (search.Query, error) {
	var req searchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return search.Query{}, errors.New("search query is not valid JSON")
	}
	// Round trip is the default kind of offer.
	kind := cmp.Or(search.OfferKind(req.Kind), search.RoundTrip)
	if kind != search.RoundTrip && kind != search.OneWay {
		return search.Query{}, fmt.Errorf("kind must be %q or %q", search.RoundTrip, search.OneWay)
	}
	if len(req.HomeAirports) == 0 {
		return search.Query{}, errors.New("homeAirports must not be empty")
	}
	destination := search.Destination{
		Places:     req.Destination.places(),
		Anywhere:   req.Destination.Anywhere,
		Exclusions: req.Exclusions.places(),
	}
	if !destination.Anywhere && destination.IsEmpty() {
		return search.Query{}, errors.New("destination must name airports, cities or countries, or be anywhere")
	}
	from, err := time.Parse(time.DateOnly, req.TravelWindow.From)
	if err != nil {
		return search.Query{}, errors.New("travelWindow.from must be a date in YYYY-MM-DD format")
	}
	to, err := time.Parse(time.DateOnly, req.TravelWindow.To)
	if err != nil {
		return search.Query{}, errors.New("travelWindow.to must be a date in YYYY-MM-DD format")
	}
	if to.Before(from) {
		return search.Query{}, errors.New("travelWindow.to must not be before travelWindow.from")
	}
	q := search.Query{
		Kind:         kind,
		HomeAirports: req.HomeAirports,
		Destination:  destination,
		TravelWindow: search.TravelWindow{From: from, To: to},
	}
	if kind == search.RoundTrip {
		if req.StayLength == nil {
			return search.Query{}, errors.New("stayLength is required for a round trip")
		}
		if req.StayLength.Min < 0 {
			return search.Query{}, errors.New("stayLength.min must not be negative")
		}
		if req.StayLength.Max < req.StayLength.Min {
			return search.Query{}, errors.New("stayLength.max must not be less than stayLength.min")
		}
		q.StayLength = search.StayLength{Min: req.StayLength.Min, Max: req.StayLength.Max}
		if q.WorkHours.Start, err = timeOfDay(cmp.Or(req.WorkStart, defaultWorkStart)); err != nil {
			return search.Query{}, errors.New("workStart must be a time in HH:MM format")
		}
		if q.WorkHours.End, err = timeOfDay(cmp.Or(req.WorkEnd, defaultWorkEnd)); err != nil {
			return search.Query{}, errors.New("workEnd must be a time in HH:MM format")
		}
		if req.MaxLeaveDays != nil && *req.MaxLeaveDays < 0 {
			return search.Query{}, errors.New("maxLeaveDays must not be negative")
		}
		q.MaxLeaveDays = req.MaxLeaveDays
	}
	if q.Filters, err = req.Filters.parse(); err != nil {
		return search.Query{}, err
	}
	if q.Sort, err = parseSort(req.Sort, kind); err != nil {
		return search.Query{}, err
	}
	return q, nil
}

// Work hours assumed when the query sets none.
const (
	defaultWorkStart = "09:00"
	defaultWorkEnd   = "17:00"
)

// timeOfDay parses an HH:MM time into an offset from midnight.
func timeOfDay(s string) (time.Duration, error) {
	t, err := time.Parse(timeLayout, s)
	if err != nil {
		return 0, err
	}
	return time.Duration(t.Hour())*time.Hour + time.Duration(t.Minute())*time.Minute, nil
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
	if p, ok := o.PricePerNight(); ok {
		offer.PricePerNight = new(toPriceJSON(p))
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
