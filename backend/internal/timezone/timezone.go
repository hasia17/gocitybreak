// Package timezone looks up the IANA time zone of a place from its coordinates, offline, from the boundary data
// embedded in the binary (github.com/ringsaturn/tzf, whose data is built from timezone-boundary-builder).
package timezone

import (
	"errors"
	"fmt"
	"sync"

	"github.com/ringsaturn/tzf"
)

// finder loads the boundary data on first use; it takes about a second and tens of megabytes while loading.
var finder = sync.OnceValues(tzf.NewDefaultFinder)

// At returns the name of the IANA time zone (e.g. "Asia/Tbilisi") covering latitude and longitude in degrees.
func At(latitude, longitude float64) (string, error) {
	f, err := finder()
	if err != nil {
		return "", fmt.Errorf("load time zone data: %w", err)
	}
	name := f.GetTimezoneName(longitude, latitude)
	if name == "" {
		return "", errors.New("no time zone at these coordinates")
	}
	return name, nil
}
