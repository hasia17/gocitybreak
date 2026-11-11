// Package app wires the gocitybreak JSON API: it opens the database and serves the HTTP endpoints.
package app

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/hasia17/gocitybreak/backend/internal/database"
	"github.com/hasia17/gocitybreak/backend/internal/search"
)

// Config is everything the API needs to start.
type Config struct {
	DatabaseURL string
	Version     string
}

// App is a running API backed by a migrated database.
type App struct {
	db       *database.DB
	searcher *search.Searcher
	version  string
}

// New connects to the database, applies pending migrations and returns a ready API.
func New(ctx context.Context, cfg Config) (*App, error) {
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	return &App{db: db, searcher: search.NewSearcher(db.Pool), version: cfg.Version}, nil
}

// Handler returns the HTTP handler serving the API under /api.
func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/status", a.status)
	mux.HandleFunc("POST /api/search", a.search)
	return mux
}

// Close releases the database connections.
func (a *App) Close() {
	a.db.Close()
}

type statusResponse struct {
	Status   string         `json:"status"`
	Version  string         `json:"version"`
	Database databaseStatus `json:"database"`
}

type databaseStatus struct {
	Status        string `json:"status"`
	SchemaVersion int64  `json:"schemaVersion,omitempty"`
}

func (a *App) status(w http.ResponseWriter, r *http.Request) {
	resp := statusResponse{Status: "ok", Version: a.version, Database: databaseStatus{Status: "ok"}}
	code := http.StatusOK

	schemaVersion, err := a.db.SchemaVersion(r.Context())
	if err != nil {
		slog.ErrorContext(r.Context(), "status: database check failed", "err", err)
		resp.Status = "degraded"
		resp.Database.Status = "unavailable"
		code = http.StatusServiceUnavailable
	} else {
		resp.Database.SchemaVersion = schemaVersion
	}
	writeJSON(w, code, resp)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("write JSON response", "err", err)
	}
}
