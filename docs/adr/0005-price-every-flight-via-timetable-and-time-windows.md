# The worker prices every flight: cheapest per day, timetable, and a time-window query for the rest

Ryanair's `cheapestPerDay` fare endpoint returns only the cheapest flight of each day, but most routes have several flights a day (KRK→BGY: more than one on 29 of 30 days in December 2026), and the evening departures we miss are exactly the ones leave days and time ranges depend on. So the worker (ADR-0002) fetches three things per route: `cheapestPerDay` for the cheapest flight's price, the timetable for every flight of the day, and, for every flight other than the cheapest, the plain `oneWayFares` endpoint narrowed to that one day and a departure-time window around that flight, which returns its price. Every stored flight therefore has a price, and the UI never needs a "price unknown" state. This costs roughly twice the requests of `cheapestPerDay` alone plus one per extra flight; the worker absorbs that through its rate limit and refresh interval.

## Considered Options

- **`cheapestPerDay` only**: about 4,500 requests for a full 6-month refresh, but search misses most flights, and leave days and time ranges run on incomplete data.
- **`cheapestPerDay` + timetable, no extra pricing**: every flight is visible, but most have no price, so they can't be sorted or summed into an offer price.
- **`/api/booking/v4/{market}/availability`**: every flight with its price in one call, but it answers plain HTTP clients with 409 "Availability declined" and would likely need a real browser, which is fragile and against the spirit of ADR-0002.

## Consequences

The time-window filter of `oneWayFares` is undocumented, like everything else here (verified on 2026-11-10: `cheapestPerDay` ignores it, `oneWayFares` honours it). If it stops working, the worker falls back to the timetable-without-prices option, storing the extra flights without a price and excluding them from search until they are priced.
