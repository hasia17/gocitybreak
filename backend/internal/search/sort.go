package search

import (
	"cmp"
	"slices"
)

// apply sorts offers that come cheapest first. The sort is stable, so offers equal in s stay in price order.
func (s SortOrder) apply(offers []Offer) {
	if s == ByLeaveDays {
		slices.SortStableFunc(offers, func(a, b Offer) int { return cmp.Compare(a.LeaveDays, b.LeaveDays) })
	}
}
