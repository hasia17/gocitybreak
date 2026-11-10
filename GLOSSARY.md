# gocitybreak

A search engine for cheap flights for short city breaks, initially based exclusively on Ryanair flights.

Each term lists its name in code under _Code_.

## Language

**Flight**:
A single flight from one airport to another on a specific date and at a specific time, with a price.
_Code_: `Flight`
_Avoid_: connection, hop

**Leg**:
One-way travel from a start airport to a destination airport, made of one or more flights (outbound leg, inbound leg).
_Code_: `Leg` (`outbound`, `inbound`)
_Avoid_: segment, journey, direction

**Direct leg**:
A leg made of exactly one flight.
_Code_: `Leg.isDirect`
_Avoid_: non-stop

**Self-transfer**:
A leg stitched together from several separate flights bought as separate tickets; the risk of missing the next flight is on the traveller.
_Code_: `SelfTransfer`
_Avoid_: connection, layover flight

**Offer**:
A single search result with a total price: either round trip (outbound leg + inbound leg) or one way (a single leg).
_Code_: `Offer`
_Avoid_: deal, result, trip, connection

**Round-trip offer**:
An offer made of an outbound leg and an inbound leg; the primary kind of offer.
_Code_: `RoundTripOffer`
_Avoid_: return offer (confusable with the inbound leg)

**One-way offer**:
An offer made of a single leg.
_Code_: `OneWayOffer`

**Supported airport**:
An airport whose routes we fetch into our price database; for now only Ryanair's Polish airports.
_Code_: `SupportedAirport`

**Home airports**:
The set of supported airports chosen by the user, from which they can depart and to which they can return; the inbound leg may land at a different home airport than the one the outbound leg departed from.
_Code_: `homeAirports`
_Avoid_: origin airports, departure airports

**Destination**:
Where the user wants to fly: chosen airports, cities or countries (any number of each) or "anywhere", minus exclusions.
_Code_: `Destination`
_Avoid_: target, direction

**Anywhere**:
A destination covering all airports reachable from the home airports.
_Code_: `Anywhere`
_Avoid_: everywhere

**City**:
The group of airports Ryanair assigns to a city name, plus the few airports Ryanair names after a nearby city but assigns to another one (e.g. Milan includes Bergamo, Brussels includes Charleroi); an airport may belong to several cities, and an offer always shows the specific airport.
_Code_: `City`
_Avoid_: location, place

**Exclusion**:
A place the user removes from the destination so they get no offers to it.
_Code_: `Exclusion`
_Avoid_: blacklist, filter

## Dates

**Travel window**:
The date range the whole offer must fit into: outbound flight on the first day at the earliest, inbound flight on the last day at the latest (for a one-way offer: its only flight within the range).
_Code_: `TravelWindow`
_Avoid_: departure window, date range

**Local time**:
The time at an airport in that airport's own time zone, as printed on the ticket: a departure is always in the departure airport's local time, an arrival in the arrival airport's.
_Code_: `LocalTime`
_Avoid_: UTC time, Polish time

**Night**:
A hotel night of the stay, counted from the outbound arrival date (or the day before, when the outbound flight lands before 06:00 local time) up to the inbound departure date.
_Code_: `nights`
_Avoid_: calendar night, day

**Stay length**:
The range of nights between the outbound and the inbound flight of a round-trip offer.
_Code_: `StayLength` (in nights)
_Avoid_: number of days, duration

**Time range**:
An optional range of hours, in local time, within which a leg's departure or arrival must fall for the offer to be shown.
_Code_: `TimeRange`
_Avoid_: good hours, comfort

## Leave

**Working day**:
A day from Monday to Friday that is not a Polish statutory public holiday.
_Code_: `WorkingDay`
_Avoid_: business day, workday

**Work end**:
The user-set time, in the home airport's local time, after which a departure does not cost them a working day.
_Code_: `workEnd`

**Work start**:
The user-set time, in the home airport's local time, before which a return does not cost them a working day.
_Code_: `workStart`

**Leave days**:
The number of working days from the departure date to the return date inclusive, skipping the departure day when the outbound flight departs after work end, and the return day when the inbound flight lands before work start.
_Code_: `leaveDays`
_Avoid_: vacation days, days off, holiday days

## Price

**Original price**:
A flight price for one adult passenger in the cheapest fare, i.e. with only a small under-seat bag (no cabin suitcase), in the currency Ryanair charges for it (the departure airport's currency).
_Code_: `Flight.originalPrice` (amount + currency)
_Avoid_: base price, local price

**Exchange rate**:
The official daily mid-market rate used to convert original prices into PLN; not the rate Ryanair or the user's bank applies.
_Code_: `ExchangeRate`
_Avoid_: Ryanair rate, conversion rate

**Offer price**:
The sum of an offer's original prices, each converted into PLN at the exchange rate; approximate whenever any of its flights is priced in another currency.
_Code_: `Offer.price`
_Avoid_: total price, price for everyone

**Stored price**:
A flight price fetched earlier in the background and kept in our database, together with when it was fetched; search runs on it.
_Code_: `StoredPrice`
_Avoid_: cached price, old price

**Live price**:
A flight price fetched from Ryanair live at the moment the user selects an offer.
_Code_: `LivePrice`
_Avoid_: current price, real price

**Price per night**:
The offer price of a round-trip offer divided by its number of nights.
_Code_: `pricePerNight`
_Avoid_: price per day
