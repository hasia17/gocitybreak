// Package wallclock reads wall-clock times: local times at an airport, whose time.Location is meaningless.
package wallclock

import "time"

// TimeOfDay returns t's wall-clock time of day as an offset from midnight.
func TimeOfDay(t time.Time) time.Duration {
	h, m, s := t.Clock()
	return time.Duration(h)*time.Hour + time.Duration(m)*time.Minute + time.Duration(s)*time.Second
}
