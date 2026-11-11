package app

import (
	"fmt"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/search"
)

// filtersJSON is the optional "filters" object of a search query; an absent filter restricts nothing.
type filtersJSON struct {
	DirectOnly        bool           `json:"directOnly"`
	OutboundDeparture *timeRangeJSON `json:"outboundDeparture"`
	OutboundArrival   *timeRangeJSON `json:"outboundArrival"`
	InboundDeparture  *timeRangeJSON `json:"inboundDeparture"`
	InboundArrival    *timeRangeJSON `json:"inboundArrival"`
	// Weekdays as "mon" … "sun".
	OutboundDepartureWeekdays []string `json:"outboundDepartureWeekdays"`
	InboundDepartureWeekdays  []string `json:"inboundDepartureWeekdays"`
}

// parse validates the filters; its errors are meant for the API client.
func (f filtersJSON) parse() (search.Filters, error) {
	filters := search.Filters{DirectOnly: f.DirectOnly}
	var err error
	for _, r := range []struct {
		name string
		in   *timeRangeJSON
		out  **search.TimeRange
	}{
		{"outboundDeparture", f.OutboundDeparture, &filters.OutboundDeparture},
		{"outboundArrival", f.OutboundArrival, &filters.OutboundArrival},
		{"inboundDeparture", f.InboundDeparture, &filters.InboundDeparture},
		{"inboundArrival", f.InboundArrival, &filters.InboundArrival},
	} {
		if *r.out, err = r.in.parse("filters." + r.name); err != nil {
			return search.Filters{}, err
		}
	}
	filters.OutboundDepartureWeekdays, err = parseWeekdays("filters.outboundDepartureWeekdays", f.OutboundDepartureWeekdays)
	if err != nil {
		return search.Filters{}, err
	}
	filters.InboundDepartureWeekdays, err = parseWeekdays("filters.inboundDepartureWeekdays", f.InboundDepartureWeekdays)
	if err != nil {
		return search.Filters{}, err
	}
	return filters, nil
}

// timeRangeJSON is a range of local times like {"from": "06:00", "to": "12:00"}, both ends inclusive;
// it wraps past midnight when "to" is before "from".
type timeRangeJSON struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// parse turns a time range called name into a search.TimeRange; nil stays nil.
func (r *timeRangeJSON) parse(name string) (*search.TimeRange, error) {
	if r == nil {
		return nil, nil
	}
	from, err := timeOfDay(r.From)
	if err != nil {
		return nil, fmt.Errorf("%s.from must be a time in HH:MM format", name)
	}
	to, err := timeOfDay(r.To)
	if err != nil {
		return nil, fmt.Errorf("%s.to must be a time in HH:MM format", name)
	}
	return &search.TimeRange{From: from, To: to}, nil
}

// weekdays maps the weekday names of the API to time.Weekday.
var weekdays = map[string]time.Weekday{
	"mon": time.Monday, "tue": time.Tuesday, "wed": time.Wednesday, "thu": time.Thursday,
	"fri": time.Friday, "sat": time.Saturday, "sun": time.Sunday,
}

// parseWeekdays turns the weekday names of a filter called name into time.Weekday values.
func parseWeekdays(name string, names []string) ([]time.Weekday, error) {
	days := make([]time.Weekday, 0, len(names))
	for _, n := range names {
		day, ok := weekdays[n]
		if !ok {
			return nil, fmt.Errorf("%s must list days as mon, tue, wed, thu, fri, sat or sun", name)
		}
		days = append(days, day)
	}
	return days, nil
}
