package worker

import (
	"math"
	"time"
)

// place is where an airport is: its coordinates and its time zone.
type place struct {
	latitude, longitude float64
	zone                *time.Location
}

// Calibration of estimatedBlockTime: a least-squares line through the median scheduled block time of 522 Ryanair
// routes stored by the worker on 2026-11-16 (every stored route both of whose airports Wizz Air also flies to, for
// their coordinates) against the great-circle distance. It misses those block times by 4.3 minutes on average and
// by under 9 minutes on nine routes in ten.
const (
	blockTimeBase  = 38 * time.Minute                             // taxiing, climb and descent
	blockTimePerKm = time.Duration(0.0761 * float64(time.Minute)) // about 790 km/h
)

// estimatedBlockTime is how long a flight between two airports km apart takes from gate to gate, rounded to five
// minutes like airline schedules.
func estimatedBlockTime(km float64) time.Duration {
	return (blockTimeBase + time.Duration(km*float64(blockTimePerKm))).Round(5 * time.Minute)
}

// estimatedArrival is the local time at to of a flight departing from at departure (a local time at from, its
// time.Location meaningless), worked out from the distance (GLOSSARY: Estimated arrival).
func estimatedArrival(departure time.Time, from, to place) time.Time {
	return arrivalAfter(departure, estimatedBlockTime(distanceKm(from, to)), from, to)
}

// arrivalAfter is the local time at to of a flight departing from at departure (a local time at from) that takes
// block from gate to gate. Both are wall clocks with a meaningless time.Location.
func arrivalAfter(departure time.Time, block time.Duration, from, to place) time.Time {
	arrival := wallClockIn(departure, from.zone).Add(block).In(to.zone)
	return wallClockIn(arrival, time.UTC)
}

// blockTime is how long a flight takes that departs from at departure and arrives at to at arrival, both local
// wall clocks with a meaningless time.Location.
func blockTime(departure, arrival time.Time, from, to place) time.Duration {
	return wallClockIn(arrival, to.zone).Sub(wallClockIn(departure, from.zone))
}

// wallClockIn is the minute of t's wall clock (whatever its time.Location) read in zone.
func wallClockIn(t time.Time, zone *time.Location) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), 0, 0, zone)
}

// earthRadiusKm is the Earth's mean radius.
const earthRadiusKm = 6371.0088

// distanceKm is the great-circle distance between two places (the haversine formula).
func distanceKm(a, b place) float64 {
	lat1, lat2 := a.latitude*math.Pi/180, b.latitude*math.Pi/180
	dLat, dLon := lat2-lat1, (b.longitude-a.longitude)*math.Pi/180
	h := math.Pow(math.Sin(dLat/2), 2) + math.Cos(lat1)*math.Cos(lat2)*math.Pow(math.Sin(dLon/2), 2)
	return 2 * earthRadiusKm * math.Asin(math.Sqrt(h))
}
