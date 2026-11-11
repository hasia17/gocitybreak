package leave

import "time"

// isPublicHoliday reports whether the date is a Polish statutory public holiday
// (as set by the Polish Public Holidays Act).
func isPublicHoliday(date time.Time) bool {
	switch m, d := date.Month(), date.Day(); {
	case m == time.January && (d == 1 || d == 6),
		m == time.May && (d == 1 || d == 3),
		m == time.August && d == 15,
		m == time.November && (d == 1 || d == 11),
		m == time.December && (d == 25 || d == 26),
		// Christmas Eve is a public holiday from 2025 on.
		m == time.December && d == 24 && date.Year() >= 2025:
		return true
	}
	switch daysAfterEaster(date) {
	case 0, // Easter Sunday
		1,  // Easter Monday
		49, // Pentecost Sunday
		60: // Corpus Christi
		return true
	}
	return false
}

// daysAfterEaster returns how many days the date is after Easter Sunday of its year (negative before it).
func daysAfterEaster(day time.Time) int {
	return int(date(day).Sub(easterSunday(day.Year())).Hours() / 24)
}

// easterSunday returns the date of Western (Gregorian) Easter Sunday in year y,
// computed with the anonymous Gregorian algorithm (Meeus/Jones/Butcher).
func easterSunday(y int) time.Time {
	a := y % 19
	b, c := y/100, y%100
	d, e := b/4, b%4
	f := (b + 8) / 25
	g := (b - f + 1) / 3
	h := (19*a + b - d - g + 15) % 30
	i, k := c/4, c%4
	l := (32 + 2*e + 2*i - h - k) % 7
	m := (a + 11*h + 22*l) / 451
	month := (h + l - 7*m + 114) / 31
	day := (h+l-7*m+114)%31 + 1
	return time.Date(y, time.Month(month), day, 0, 0, 0, 0, time.UTC)
}
