# Wizz Air: the cheapest flight of each day and the later flights a time-of-day query prices, arrivals from scheduled block times

Like Ryanair, Wizz Air has no public API, and the one endpoint that returns every flight with its price and arrival time (`search/search`) sits behind Kasada bot protection: a plain HTTP client gets `429` with a JavaScript challenge (verified on 2026-11-15, API version 29.25.0). What answers plain HTTP is `search/timetableV2`, which gives each day's departure times but a price only for the cheapest flight of the day and no arrival times at all. Its `from` field, though, accepts a time of day as well as a date (`2026-12-12T14:05:00`): the first day of the range then leaves out the departures before that time, and the answer prices and flags the cheapest of the departures that are left. So the worker (ADR-0002) prices a day in steps: the plain query gives the cheapest flight of the day, a query starting at the next departure after it gives the cheapest of the later flights, and so on until the last departure. Every flight a step flags is stored with its price; the last flight of the day always is. A flight that costs more than some later flight of its day is never flagged, so it has no price and is not stored.

Each stored flight gets its arrival time from the route's scheduled block time: the gap between scheduled departure and scheduled arrival that `asset/flightinformation` (live flight status, also open to plain HTTP) reports for the route's flights of the next few days, kept per route and departure time. Where no block time is known yet (a new route, or a seasonal one that hasn't started), the arrival is estimated from the distance, calibrated on Ryanair's real block times, and the offer marks it as estimated.

## Considered Options

- **A headless browser for `search/search`**: complete and exact data, but it means defeating a bot gate on every request: heavy, fragile, and against the spirit of ADR-0002.
- **The cheapest flight of each day only**: one request per 42-day window and nothing more, but Wizz Air's evening departures, often the ones that save a leave day, are missing whenever they aren't the cheapest.
- **Every departure from `timetableV2`, unpriced ones stored and excluded from search**: the same offers as the chosen option, with more rows and no benefit.
- **Distance-based arrival estimates only**: simple, but off by 10–20 minutes, which matters right at the rules that use arrival times (nights before 06:00, leave days before work start, arrival time ranges).

## Consequences

The time of day in `from` is undocumented, like everything else here (verified on 2026-11-16 on WAW↔LTN for 12 December 2026: five flights priced this way matched the regular price on wizzair.com exactly, and the three left unpriced were each dearer than a later flight). A time of day in `to` is ignored, so a query can't be narrowed to one flight, and the time in `from` cuts only the first day of the range, so every flight priced beyond the cheapest of its day costs one more request. Where two flights cost the same, the earlier one is flagged, and the next step prices the later one. If the time of day stops being honoured, the worker is left with the cheapest flight of each day only.

A Wizz Air flight dearer than a later flight of the same day never shows up. That is a morning or midday departure with a cheaper way to fly later that day; it matters when the earlier arrival is what the traveller wanted.

`asset/flightinformation` only knows flights a few days ahead and ignores the requested date, so block times are learnt from near flights and applied to far ones; a schedule change shows up only once the changed flights come within reach. Its route filter takes the body `{"departureIATA": "WAW", "arrivalIATA": "LTN"}`, the shape Wizz Air's own flight-status page sends (read from the web app and verified on 2026-11-16 on WAW↔LTN); the requested date isn't needed.
