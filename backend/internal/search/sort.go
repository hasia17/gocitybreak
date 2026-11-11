package search

import (
	"cmp"
	"slices"
)

// SortOrder is the order in which offers are returned.
type SortOrder string

const (
	// ByPrice sorts by ascending offer price; the default.
	ByPrice SortOrder = "price"
	// ByPricePerNight sorts round-trip offers by ascending price per night,
	// with offers of 0 nights, which have no price per night, last.
	ByPricePerNight SortOrder = "pricePerNight"
)

// PricePerNight is the offer price divided by the number of hotel nights (GLOSSARY: Price per night),
// rounded to minor units; ok is false for an offer of 0 nights, including every one-way offer.
func (o Offer) PricePerNight() (price Price, ok bool) {
	if o.Nights <= 0 {
		return Price{}, false
	}
	price = o.Price
	price.Amount = (o.Price.Amount + int64(o.Nights)/2) / int64(o.Nights)
	return price, true
}

// apply sorts offers that come cheapest first; equal offers keep that order.
func (s SortOrder) apply(offers []Offer) {
	if s != ByPricePerNight {
		return
	}
	slices.SortStableFunc(offers, func(a, b Offer) int {
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
	})
}
