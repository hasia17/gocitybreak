# Search HTTP contract fixtures

Each `<scenario>.request.json` is the JSON body of a `POST /api/search` request.
The corresponding `.response.json` is the complete HTTP 200 JSON response body;
`query-error.response.txt` is the actual HTTP 400 `text/plain` body, including
its final newline, not a JSON error object. Scenarios are `round-trip` (PLN),
`one-way`, `fixed-dates` (overnight outbound and inbound flights),
`fixed-one-way` (overnight departure), `foreign-currency` (EUR inbound, converted to PLN), `mixed-airlines`
(out with Ryanair, back with Wizz Air on a flight whose arrival is estimated, so it carries
`"estimatedArrival": true`; the field is absent otherwise), and `query-error` (an invalid stay-length range). The backend test seeds deterministic flights,
airports and exchange rates in `backend/internal/app/contract_test.go`. Both
stacks should use these exact files; requests are inputs, not generated output.

## Work hours

For round trips the frontend sends `workStart` and `workEnd`; its defaults and
the backend's defaults for omitted values are **09:00** and **17:00** in the
home airports' local wall-clock time. One-way searches omit these fields because
leave days do not apply. Omitted backend values default independently; explicit
`00:00` is not omitted. For leave calculations, a working departure day is
skipped only when departure is strictly after work end, and a working arrival
day only when arrival is strictly before work start. Working days exclude
weekends and Polish public holidays. `TestContractDefaultWorkHours` checks the
backend default against the explicit shared values.

## Regeneration

With Docker running, from the repository root:

```sh
cd backend
go test ./internal/app -run '^TestSearchContract$' -count=1 -update-contract
```

This rewrites only response fixtures from actual HTTP responses. Review the diff
and update frontend expectations deliberately; never use the flag in CI. Run
`go test ./internal/app -run '^(TestSearchContract|TestContractDefaultWorkHours)$' -count=1`
without the flag to check the contract. JSON responses are indented using Go's
`encoding/json` formatter and compared as complete bytes; text is compared
exactly. Status and content type are checked in the backend test.

## Fixed dates

A query names exactly one of `travelWindow` and `fixedDates`. Fixed dates use
`{"outbound":"2026-12-04","inbound":"2026-12-06"}` for round trips and only
`outbound` for one-way offers. These are each leg's local departure dates, so
an arrival on the following day still matches. A fixed round trip has no
`stayLength`; nights and leave days are still calculated from the flights.
The inbound date must be on or after the outbound date.
