package app

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/search"
)

// timeLayout formats local times without seconds; dates use time.DateOnly.
const timeLayout = "15:04"

type searchRequest struct {
	Kind         string   `json:"kind"`
	HomeAirports []string `json:"homeAirports"`
	Destination  struct {
		Airports []string `json:"airports"`
	} `json:"destination"`
	TravelWindow struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"travelWindow"`
	StayLength *struct {
		Min int `json:"min"`
		Max int `json:"max"`
	} `json:"stayLength"`
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
	if len(req.Destination.Airports) == 0 {
		return search.Query{}, errors.New("destination.airports must not be empty")
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
		Destination:  search.Destination{Airports: req.Destination.Airports},
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
	}
	return q, nil
}

func toOfferJSON(o search.Offer) offerJSON {
	offer := offerJSON{
		Kind:     string(o.Kind),
		Outbound: toLegJSON(o.Outbound),
		Price: priceJSON{
			Amount:      majorUnits(o.Price.Amount),
			Currency:    o.Price.Currency,
			Approximate: o.Price.Approximate,
		},
		PriceFetchedAt: o.PriceFetchedAt.UTC(),
	}
	if o.Inbound != nil {
		offer.Inbound = new(toLegJSON(*o.Inbound))
		offer.Nights = new(o.Nights)
	}
	return offer
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
