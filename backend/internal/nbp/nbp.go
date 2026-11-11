// Package nbp fetches the National Bank of Poland's mid-market exchange rates (ADR-0006):
// table A (major currencies, every working day) and table B (other currencies, e.g. the Moroccan dirham, weekly).
package nbp

import (
	"context"
	"fmt"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/fetch"
)

// Rate says how many PLN one unit of Currency was worth on Date.
type Rate struct {
	Currency string
	Date     time.Time
	PLN      float64
}

// Client reads NBP's public API.
type Client struct {
	baseURL string
	fetch   *fetch.Client
}

// NewClient returns a client for the API at baseURL (https://api.nbp.pl in production).
func NewClient(baseURL string, f *fetch.Client) *Client {
	return &Client{baseURL: baseURL, fetch: f}
}

// Tables are the NBP tables of mid-market rates; they list disjoint sets of currencies.
var Tables = []string{"A", "B"}

// LatestTable returns every rate of the most recently published table ("A" or "B").
func (c *Client) LatestTable(ctx context.Context, table string) ([]Rate, error) {
	var body []struct {
		EffectiveDate string `json:"effectiveDate"`
		Rates         []struct {
			Code string  `json:"code"`
			Mid  float64 `json:"mid"`
		} `json:"rates"`
	}
	if err := c.fetch.GetJSON(ctx, c.baseURL+"/api/exchangerates/tables/"+table+"/?format=json", &body); err != nil {
		return nil, fmt.Errorf("NBP table %s: %w", table, err)
	}
	var rates []Rate
	for _, t := range body {
		date, err := time.Parse(time.DateOnly, t.EffectiveDate)
		if err != nil {
			return nil, fmt.Errorf("NBP table %s: bad effective date %q", table, t.EffectiveDate)
		}
		for _, r := range t.Rates {
			rates = append(rates, Rate{Currency: r.Code, Date: date, PLN: r.Mid})
		}
	}
	return rates, nil
}
