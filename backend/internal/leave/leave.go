// Package leave counts the leave days a trip costs a working traveller (GLOSSARY: Leave days).
package leave

import "time"

// WorkHours are the traveller's work start and work end, as offsets from midnight
// in the home airport's local time.
type WorkHours struct {
	Start, End time.Duration
}

// Days returns the leave days of a trip that departs from and arrives back at a home airport
// at the given wall-clock local times there: the working days from the departure date
// to the arrival date inclusive, skipping the departure day when the departure is after work end
// and the arrival day when the arrival is before work start.
func Days(departure, arrival time.Time, work WorkHours) int {
	first, last := date(departure), date(arrival)
	if sinceMidnight(departure) > work.End {
		first = first.AddDate(0, 0, 1)
	}
	if sinceMidnight(arrival) < work.Start {
		last = last.AddDate(0, 0, -1)
	}
	days := 0
	for d := first; !d.After(last); d = d.AddDate(0, 0, 1) {
		if IsWorkingDay(d) {
			days++
		}
	}
	return days
}

// IsWorkingDay reports whether the date is a working day: Monday to Friday
// and not a Polish statutory public holiday.
func IsWorkingDay(date time.Time) bool {
	switch date.Weekday() {
	case time.Saturday, time.Sunday:
		return false
	}
	return !isPublicHoliday(date)
}

// date returns t's calendar date at midnight UTC.
func date(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// sinceMidnight returns t's wall-clock time of day.
func sinceMidnight(t time.Time) time.Duration {
	return time.Duration(t.Hour())*time.Hour + time.Duration(t.Minute())*time.Minute +
		time.Duration(t.Second())*time.Second
}
