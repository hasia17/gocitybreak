// Package airline names the airlines whose flights we fetch (GLOSSARY: Airline).
package airline

// Airline identifies an airline; its value is what the database and the search API call it.
type Airline string

// The airlines whose flights we fetch.
const (
	Ryanair Airline = "ryanair"
	Wizzair Airline = "wizzair"
)
