package search

import (
	"slices"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/wallclock"
)

// Filters narrow the offers down; the zero value restricts nothing.
type Filters struct {
	// DirectOnly keeps the offers whose every leg is direct.
	DirectOnly bool
	// Time ranges of a leg's departure and arrival, each in local time at the airport concerned;
	// nil leaves the moment unrestricted. Inbound ranges apply to round-trip offers only.
	OutboundDeparture, OutboundArrival *TimeRange
	InboundDeparture, InboundArrival   *TimeRange
	// Weekdays of the outbound and of the inbound departure (round-trip offers only), both by local date
	// at the departure airport; an empty list allows every day. They go by departure, unlike leave days,
	// which go by the inbound arrival.
	OutboundDepartureWeekdays, InboundDepartureWeekdays []time.Weekday
	// MaxLeaveDays, when set, leaves out round-trip offers that cost more leave days.
	MaxLeaveDays *int
}

// TimeRange is a range of times of day, both ends inclusive, each measured from midnight.
// A range whose To is before its From wraps past midnight: 22:00–01:00 is late evening or early night.
type TimeRange struct {
	From, To time.Duration
}

// contains reports whether the time of day of t falls within the range.
func (r TimeRange) contains(t LocalTime) bool {
	clock := wallclock.TimeOfDay(t.DateTime)
	if r.To < r.From {
		return clock >= r.From || clock <= r.To
	}
	return clock >= r.From && clock <= r.To
}

// apply removes the offers that do not pass every filter.
func (f Filters) apply(offers []Offer) []Offer {
	return slices.DeleteFunc(offers, func(o Offer) bool { return !f.keep(o) })
}

// keep reports whether the offer passes every filter.
func (f Filters) keep(o Offer) bool {
	out := o.Outbound
	if f.DirectOnly && !out.IsDirect() ||
		!within(f.OutboundDeparture, out.departure()) || !within(f.OutboundArrival, out.arrival()) ||
		!onDay(f.OutboundDepartureWeekdays, out.departure()) {
		return false
	}
	if in := o.Inbound; in != nil {
		return (!f.DirectOnly || in.IsDirect()) &&
			within(f.InboundDeparture, in.departure()) && within(f.InboundArrival, in.arrival()) &&
			onDay(f.InboundDepartureWeekdays, in.departure()) &&
			(f.MaxLeaveDays == nil || o.LeaveDays <= *f.MaxLeaveDays)
	}
	return true
}

// within reports whether t falls within r; a nil range contains every time.
func within(r *TimeRange, t LocalTime) bool {
	return r == nil || r.contains(t)
}

// onDay reports whether t falls on one of days; an empty list allows every day.
func onDay(days []time.Weekday, t LocalTime) bool {
	return len(days) == 0 || slices.Contains(days, t.DateTime.Weekday())
}

// departure is the departure of the leg's first flight.
func (l Leg) departure() LocalTime { return l.Flights[0].Departure }

// arrival is the arrival of the leg's last flight.
func (l Leg) arrival() LocalTime { return l.Flights[len(l.Flights)-1].Arrival }
