# Wizz Air: the cheapest flight of each day, its arrival from a scheduled block time

Like Ryanair, Wizz Air has no public API, and the one endpoint that returns every flight with its price and arrival time (`search/search`) sits behind Kasada bot protection: a plain HTTP client gets `429` with a JavaScript challenge (verified on 2026-11-15, API version 29.25.0). What answers plain HTTP is `search/timetableV2`, which gives each day's departure times but a price only for the cheapest flight of the day and no arrival times at all. So the worker (ADR-0002) stores only the cheapest Wizz Air flight of each day, priced from `timetableV2`, and gives it an arrival time from the route's scheduled block time: the gap between scheduled departure and scheduled arrival that `asset/flightinformation` (live flight status, also open to plain HTTP) reports for the route's flights of the next few days, kept per route and departure time. Where no block time is known yet (a new route, or a seasonal one that hasn't started), the arrival is estimated from the distance, calibrated on Ryanair's real block times, and the offer marks it as estimated.

## Considered Options

- **A headless browser for `search/search`**: complete and exact data, but it means defeating a bot gate on every request: heavy, fragile, and against the spirit of ADR-0002.
- **Every departure from `timetableV2`, unpriced ones excluded from search**: the same offers as the chosen option, with more rows and no benefit.
- **Distance-based arrival estimates only**: simple, but off by 10–20 minutes, which matters right at the rules that use arrival times (nights before 06:00, leave days before work start, arrival time ranges).

## Consequences

Wizz Air's other flights of a day never show up, so its evening departures, often the ones that save a leave day, are missing whenever they aren't the cheapest. `asset/flightinformation` only knows flights a few days ahead and ignores the requested date, so block times are learnt from near flights and applied to far ones; a schedule change shows up only once the changed flights come within reach. Its route filter takes a body shape not yet worked out (only the flight-number filter was verified), which the implementation has to take from the Wizz Air web app.
