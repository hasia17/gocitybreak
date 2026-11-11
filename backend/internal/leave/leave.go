// Package leave counts the leave days a trip costs a working traveller (GLOSSARY: Leave days).
package leave

import (
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/wallclock"
)

// Days returns the leave days of a trip that departs from and arrives back at a home airport
// at the given wall-clock local times there: the working days from the departure date
// to the arrival date inclusive, skipping the departure day when the departure is after workEnd
// and the arrival day when the arrival is before workStart. Work start and work end are offsets
// from midnight in the home airport's local time.
func Days(departure, arrival time.Time, workStart, workEnd time.Duration) int {
	first, last := date(departure), date(arrival)
	if wallclock.TimeOfDay(departure) > workEnd {
		first = first.AddDate(0, 0, 1)
	}
	if wallclock.TimeOfDay(arrival) < workStart {
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
