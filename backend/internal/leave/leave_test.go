package leave_test

import (
	"testing"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/leave"
)

// officeHours is 09:00–17:00.
var officeHours = leave.WorkHours{Start: 9 * time.Hour, End: 17 * time.Hour}

func TestDays(t *testing.T) {
	tests := []struct {
		name               string
		departure, arrival string
		want               int
	}{
		{
			name:      "Friday evening out, Monday morning back",
			departure: "2026-12-04 18:15", arrival: "2026-12-07 07:50",
			want: 0,
		},
		{
			name:      "Friday morning out, Monday morning back",
			departure: "2026-12-04 06:15", arrival: "2026-12-07 07:50",
			want: 1,
		},
		{
			name:      "departure exactly at work end costs the day",
			departure: "2026-12-04 17:00", arrival: "2026-12-06 21:50",
			want: 1,
		},
		{
			name:      "departure a minute after work end",
			departure: "2026-12-04 17:01", arrival: "2026-12-06 21:50",
			want: 0,
		},
		{
			name:      "arrival exactly at work start costs the day",
			departure: "2026-12-05 08:00", arrival: "2026-12-07 09:00",
			want: 1,
		},
		{
			name:      "Thursday morning out, Monday evening back",
			departure: "2026-12-03 07:00", arrival: "2026-12-07 21:50",
			want: 3,
		},
		{
			name:      "weekend trip",
			departure: "2026-12-05 08:00", arrival: "2026-12-06 21:50",
			want: 0,
		},
		{
			name:      "same-day trip after work",
			departure: "2026-12-03 18:00", arrival: "2026-12-03 23:30",
			want: 0,
		},
		{
			name:      "same-day trip during work",
			departure: "2026-12-03 06:00", arrival: "2026-12-03 23:30",
			want: 1,
		},
		{
			name:      "Corpus Christi long weekend costs only the Friday",
			departure: "2026-06-03 18:00", arrival: "2026-06-07 21:50",
			want: 1,
		},
		{
			name:      "Christmas Eve, Christmas and a Saturday cost nothing",
			departure: "2026-12-23 18:00", arrival: "2026-12-27 21:50",
			want: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := leave.Days(wallClock(t, tt.departure), wallClock(t, tt.arrival), officeHours)
			if got != tt.want {
				t.Errorf("Days(%s, %s) = %d, want %d", tt.departure, tt.arrival, got, tt.want)
			}
		})
	}
}

func TestIsWorkingDay(t *testing.T) {
	tests := []struct {
		date string
		want bool
	}{
		{"2026-01-01", false}, // New Year's Day, Thursday
		{"2026-01-02", true},
		{"2026-01-06", false}, // Epiphany
		{"2026-04-05", false}, // Easter Sunday
		{"2026-04-06", false}, // Easter Monday
		{"2026-04-07", true},
		{"2027-03-29", false}, // Easter Monday
		{"2027-04-05", true},  // a week after Easter Monday
		{"2026-05-01", false}, // Labour Day
		{"2026-05-03", false}, // Constitution Day, Sunday
		{"2026-05-25", true},  // the Monday after Pentecost
		{"2026-06-04", false}, // Corpus Christi
		{"2027-05-27", false}, // Corpus Christi
		{"2026-08-15", false}, // Assumption, Saturday
		{"2027-08-16", true},  // the Monday after Assumption
		{"2026-11-01", false}, // All Saints' Day, Sunday
		{"2026-11-02", true},  // All Souls' Day is not a public holiday
		{"2026-11-11", false}, // Independence Day
		{"2024-12-24", true},  // Christmas Eve before it became a public holiday in 2025
		{"2026-12-24", false}, // Christmas Eve
		{"2026-12-25", false}, // Christmas Day
		{"2027-12-27", true},  // Christmas Day and the second day of Christmas fall on a weekend
		{"2026-12-28", true},
		{"2026-12-05", false}, // Saturday
		{"2026-12-06", false}, // Sunday
	}
	for _, tt := range tests {
		date, err := time.Parse(time.DateOnly, tt.date)
		if err != nil {
			t.Fatal(err)
		}
		if got := leave.IsWorkingDay(date); got != tt.want {
			t.Errorf("IsWorkingDay(%s, %s) = %t, want %t", tt.date, date.Weekday(), got, tt.want)
		}
	}
}

// wallClock parses a local date and time like "2026-12-04 18:15".
func wallClock(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse("2006-01-02 15:04", s)
	if err != nil {
		t.Fatalf("parse %q: %v", s, err)
	}
	return v
}
