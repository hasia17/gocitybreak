package app_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/hasia17/gocitybreak/backend/internal/app"
)

func TestStatusReportsVersionAndMigratedDatabase(t *testing.T) {
	srv, _ := startAPI(t, "1.2.3-test")

	code, body := getStatus(t, srv)

	if code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", code, http.StatusOK)
	}
	if body.Status != "ok" {
		t.Errorf("status = %q, want ok", body.Status)
	}
	if body.Version != "1.2.3-test" {
		t.Errorf("version = %q, want 1.2.3-test", body.Version)
	}
	if body.Database.Status != "ok" {
		t.Errorf("database.status = %q, want ok", body.Database.Status)
	}
	if body.Database.SchemaVersion < 1 {
		t.Errorf("database.schemaVersion = %d, want migrations applied (>= 1)", body.Database.SchemaVersion)
	}
}

func TestStatusReportsUnavailableDatabase(t *testing.T) {
	srv, pg := startAPI(t, "1.2.3-test")
	if err := pg.Terminate(context.Background()); err != nil {
		t.Fatalf("stop postgres: %v", err)
	}

	code, body := getStatus(t, srv)

	if code != http.StatusServiceUnavailable {
		t.Fatalf("status code = %d, want %d", code, http.StatusServiceUnavailable)
	}
	if body.Status != "degraded" {
		t.Errorf("status = %q, want degraded", body.Status)
	}
	if body.Version != "1.2.3-test" {
		t.Errorf("version = %q, want 1.2.3-test", body.Version)
	}
	if body.Database.Status != "unavailable" {
		t.Errorf("database.status = %q, want unavailable", body.Database.Status)
	}
}

type statusBody struct {
	Status   string `json:"status"`
	Version  string `json:"version"`
	Database struct {
		Status        string `json:"status"`
		SchemaVersion int64  `json:"schemaVersion"`
	} `json:"database"`
}

// startAPI starts the API with the given version on a fresh PostgreSQL container.
func startAPI(t *testing.T, version string) (*httptest.Server, *postgres.PostgresContainer) {
	t.Helper()
	pg, url := startPostgres(t)
	a, err := app.New(context.Background(), app.Config{DatabaseURL: url, Version: version})
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	t.Cleanup(a.Close)
	srv := httptest.NewServer(a.Handler())
	t.Cleanup(srv.Close)
	return srv, pg
}

func getStatus(t *testing.T, srv *httptest.Server) (int, statusBody) {
	t.Helper()
	resp, err := http.Get(srv.URL + "/api/status")
	if err != nil {
		t.Fatalf("GET /api/status: %v", err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	var body statusBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	return resp.StatusCode, body
}

// startPostgres runs a throwaway PostgreSQL container for the test and returns its connection string.
func startPostgres(t *testing.T) (*postgres.PostgresContainer, string) {
	t.Helper()
	ctx := context.Background()
	ctr, err := postgres.Run(ctx, "postgres:17-alpine",
		postgres.WithDatabase("gocitybreak"),
		postgres.WithUsername("gocitybreak"),
		postgres.WithPassword("gocitybreak"),
		postgres.BasicWaitStrategies(),
	)
	testcontainers.CleanupContainer(t, ctr)
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	url, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("postgres connection string: %v", err)
	}
	return ctr, url
}
