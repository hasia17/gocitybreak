package search

import (
	"cmp"
	"slices"
)

// apply sorts offers that come cheapest first. The sort is stable, so offers equal in s stay in price order.
func (s SortOrder) apply(offers []Offer) {
	switch s {
	case ByLeaveDays:
		slices.SortStableFunc(offers, func(a, b Offer) int { return cmp.Compare(a.LeaveDays, b.LeaveDays) })
	case ByPricePerNight:
		slices.SortStableFunc(offers, comparePricePerNight)
	}
}

// comparePricePerNight orders offers by price per night, offers of 0 nights last.
func comparePricePerNight(a, b Offer) int {
	switch {
	case a.Nights > 0 && b.Nights > 0:
		// Compares a.Price/a.Nights with b.Price/b.Nights exactly, before rounding.
		return cmp.Compare(a.Price.Amount*int64(b.Nights), b.Price.Amount*int64(a.Nights))
	case a.Nights > 0:
		return -1
	case b.Nights > 0:
		return 1
	default:
		return 0
	}
}
