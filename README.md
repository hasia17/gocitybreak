# gocitybreak

A search engine for cheap Ryanair flights for short city breaks. Domain vocabulary is in [`GLOSSARY.md`](GLOSSARY.md), architectural decisions in [`docs/adr/`](docs/adr/).

## Layout

| Path | What |
|---|---|
| `backend/` | Go JSON API (`cmd/api`), database access and migrations (`internal/database/migrations`) |
| `frontend/` | Angular app; in Docker it is served by nginx, which also proxies `/api` to the backend |
| `docker-compose.yml` | PostgreSQL + backend + frontend |
| `.github/workflows/ci.yml` | Tests and image builds on every push and pull request |

## Run locally

Requires Docker.

```bash
docker compose up --build
```

Open http://localhost:8080. The API is under http://localhost:8080/api (e.g. `/api/status`).

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

Migrations run automatically when the API starts. Add a new one as the next numbered file in `backend/internal/database/migrations/` ([goose](https://github.com/pressly/goose) SQL format).

## Tests

```bash
cd backend && go test ./...                    # needs Docker: tests run against a real PostgreSQL (testcontainers)
cd frontend && npx ng test --watch=false
```
