package search

import (
	"slices"
	"testing"
)

// The database holds direct flights only, so the search API cannot return a leg of several flights yet;
// this test feeds one to the filters directly.
func TestDirectOnlyDropsOffersWithALegOfSeveralFlights(t *testing.T) {
	direct := Leg{Flights: []Flight{{DepartureAirport: "KRK", ArrivalAirport: "BGY"}}}
	viaStansted := Leg{Flights: []Flight{
		{DepartureAirport: "BGY", ArrivalAirport: "STN"},
		{DepartureAirport: "STN", ArrivalAirport: "KRK"},
	}}
	offers := []Offer{
		{Kind: RoundTrip, Outbound: direct, Inbound: &viaStansted},
		{Kind: RoundTrip, Outbound: direct, Inbound: &direct},
		{Kind: OneWay, Outbound: viaStansted},
		{Kind: OneWay, Outbound: direct},
	}

	var got []string
	for _, o := range (Filters{DirectOnly: true}).apply(offers) {
		got = append(got, string(o.Kind)+" "+o.Outbound.Flights[0].DepartureAirport)
	}

	if want := []string{"roundTrip KRK", "oneWay KRK"}; !slices.Equal(got, want) {
		t.Errorf("kept %v, want %v", got, want)
	}
}
