package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/search"
)

const (
	dateLayout = "2006-01-02"
	timeLayout = "15:04"
)

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
}

type searchResponse struct {
	Offers []offerJSON `json:"offers"`
}

type offerJSON struct {
	Kind           string    `json:"kind"`
	Outbound       legJSON   `json:"outbound"`
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

	offers, err := a.searcher.OneWay(r.Context(), q)
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
	if req.Kind != string(search.OneWay) {
		return search.Query{}, fmt.Errorf("unsupported kind %q: only %q is supported", req.Kind, search.OneWay)
	}
	if len(req.HomeAirports) == 0 {
		return search.Query{}, errors.New("homeAirports must not be empty")
	}
	if len(req.Destination.Airports) == 0 {
		return search.Query{}, errors.New("destination.airports must not be empty")
	}
	from, err := time.Parse(dateLayout, req.TravelWindow.From)
	if err != nil {
		return search.Query{}, errors.New("travelWindow.from must be a date in YYYY-MM-DD format")
	}
	to, err := time.Parse(dateLayout, req.TravelWindow.To)
	if err != nil {
		return search.Query{}, errors.New("travelWindow.to must be a date in YYYY-MM-DD format")
	}
	if to.Before(from) {
		return search.Query{}, errors.New("travelWindow.to must not be before travelWindow.from")
	}
	return search.Query{
		HomeAirports: req.HomeAirports,
		Destination:  search.Destination{Airports: req.Destination.Airports},
		TravelWindow: search.TravelWindow{From: from, To: to},
	}, nil
}

func toOfferJSON(o search.Offer) offerJSON {
	leg := legJSON{IsDirect: o.Outbound.IsDirect(), Flights: make([]flightJSON, 0, len(o.Outbound.Flights))}
	for _, f := range o.Outbound.Flights {
		leg.Flights = append(leg.Flights, flightJSON{
			DepartureAirport: f.DepartureAirport,
			ArrivalAirport:   f.ArrivalAirport,
			Departure:        toLocalTimeJSON(f.Departure),
			Arrival:          toLocalTimeJSON(f.Arrival),
			OriginalPrice:    moneyJSON{Amount: majorUnits(f.OriginalPrice.Amount), Currency: f.OriginalPrice.Currency},
			FetchedAt:        f.FetchedAt.UTC(),
		})
	}
	return offerJSON{
		Kind:     string(o.Kind),
		Outbound: leg,
		Price: priceJSON{
			Amount:      majorUnits(o.Price.Amount),
			Currency:    o.Price.Currency,
			Approximate: o.Price.Approximate,
		},
		PriceFetchedAt: o.PriceFetchedAt.UTC(),
	}
}

func toLocalTimeJSON(t search.LocalTime) localTimeJSON {
	return localTimeJSON{
		Date:     t.DateTime.Format(dateLayout),
		Time:     t.DateTime.Format(timeLayout),
		TimeZone: t.TimeZone,
	}
}

// majorUnits turns minor units (grosze, cents) into a decimal amount for JSON.
func majorUnits(minor int64) float64 {
	return float64(minor) / 100
}
