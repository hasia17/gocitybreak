package app_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/hasia17/gocitybreak/backend/internal/app"
	"github.com/hasia17/gocitybreak/backend/internal/database/databasetest"
)

func TestMain(m *testing.M) {
	code := m.Run()
	databasetest.Shutdown()
	os.Exit(code)
}

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
	srv, url := startAPI(t, "1.2.3-test")
	// Dropping the database (not the shared container) makes it unavailable.
	databasetest.Drop(t, url)

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

// startAPI starts the API with the given version on a fresh test database.
func startAPI(t *testing.T, version string) (*httptest.Server, string) {
	t.Helper()
	url := databasetest.Acquire(t)
	a, err := app.New(context.Background(), app.Config{DatabaseURL: url, Version: version})
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	t.Cleanup(a.Close)
	srv := httptest.NewServer(a.Handler())
	t.Cleanup(srv.Close)
	return srv, url
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
