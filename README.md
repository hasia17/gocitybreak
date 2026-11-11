# gocitybreak

A search engine for cheap Ryanair flights for short city breaks. Domain vocabulary is in [`GLOSSARY.md`](GLOSSARY.md), architectural decisions in [`docs/adr/`](docs/adr/).

## Layout

| Path | What |
|---|---|
| `backend/` | Go JSON API (`cmd/api`), price worker (`cmd/worker`, `internal/worker`, Ryanair and NBP clients in `internal/ryanair`, `internal/nbp`), search (`internal/search`), database access and migrations (`internal/database/migrations`), sample data (`seed/`) |
| `frontend/` | Angular app; in Docker it is served by nginx, which also proxies `/api` to the backend |
| `docker-compose.yml` | PostgreSQL + backend + price worker + frontend |
| `deploy/compose.yml` | The same stack on the server, from published images ([`docs/deploy.md`](docs/deploy.md)) |
| `.github/workflows/ci.yml` | Tests and image builds on every push and pull request; on `main` also publishes the images and deploys ([`docs/deploy.md`](docs/deploy.md)) |

## Run locally

Requires Docker and [Task](https://taskfile.dev/) (macOS: `brew install go-task`; Windows: `winget install Task.Task`; other options at https://taskfile.dev/installation/).

```bash
task run    # build and start everything
task logs   # follow logs (`task logs -- worker` for the price worker only)
task stop   # stop (data is kept; `task stop -- -v` also deletes the database)
```

Open http://localhost:8080. The API is under http://localhost:8080/api (e.g. `/api/status`).

The price worker starts filling the database with real Ryanair prices right away: first the airport catalogue and NBP exchange rates, then route after route, nearest months first. The first fill of every route from the Polish airports takes more than a day at the default rate limit of 1 request per second (`RYANAIR_REQUESTS_PER_SECOND` in `docker-compose.yml`); search answers from whatever is stored so far. After that, the next four weeks are refetched twice a day, the next three months every other day and the rest weekly (`worker.DefaultFreshness`).

To work offline or without waiting, `task seed` loads hand-made sample flights (KRK⇄BGY, KTW⇄CIA, WRO⇄STN for the next 60 days; safe to re-run). The worker replaces them on routes it has fetched, so don't mix the two if you need clean data.

Without Task: `docker compose up -d --build`, and for sample flights, once the API has started, `docker compose exec -T postgres psql -U gocitybreak -d gocitybreak < backend/seed/dev.sql`.

Search is `POST /api/search`, e.g. `{"kind": "roundTrip", "homeAirports": ["KRK", "KTW"], "destination": {"airports": ["BGY"]}, "travelWindow": {"from": "2026-12-01", "to": "2026-12-10"}, "stayLength": {"min": 2, "max": 3}}`. `kind` defaults to `roundTrip`; `"kind": "oneWay"` takes no `stayLength`.

Optional `filters`: `directOnly`, time ranges `outboundDeparture`, `outboundArrival`, `inboundDeparture`, `inboundArrival` (each `{"from": "06:00", "to": "12:00"}` in the local time of the airport concerned; `to` before `from` wraps past midnight), and `departureWeekdays`, `returnWeekdays` (`["thu", "fri"]`; return is the inbound departure date). Optional `sort`: `price` (default) or `pricePerNight` (round trips; 0-night offers last).

## Develop without Docker for the app

Requires Go 1.26+ and Node.js 26 (`nvm use` in `frontend/`).

```bash
# A standalone database on localhost:5432 (Compose's database is not published on the host)
docker run -d --name gocitybreak-db -e POSTGRES_USER=gocitybreak -e POSTGRES_PASSWORD=gocitybreak -p 5432:5432 postgres:17-alpine

# API on :8080 (set ADDR to change)
cd backend && DATABASE_URL='postgres://gocitybreak:gocitybreak@localhost:5432/gocitybreak?sslmode=disable' go run ./cmd/api

# Frontend on http://localhost:4200, proxies /api to :8080
cd frontend && npm ci && npm start
```

The price worker runs the same way: `cd backend && DATABASE_URL='...' go run ./cmd/worker` (see `cmd/worker/main.go` for its settings).

Migrations run automatically when the API or the worker starts. Add a new one as the next numbered file in `backend/internal/database/migrations/` ([goose](https://github.com/pressly/goose) SQL format).

## Tests

```bash
cd backend && go test ./...                    # needs Docker: tests run against a real PostgreSQL (testcontainers)
cd frontend && npx ng test --watch=false
```
