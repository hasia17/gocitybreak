package databasetest_test

import (
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hasia17/gocitybreak/backend/internal/database"
	"github.com/hasia17/gocitybreak/backend/internal/database/databasetest"
)

func TestMain(m *testing.M) {
	code := m.Run()
	databasetest.Shutdown()
	os.Exit(code)
}

// TestAcquireGivesMigratedDatabase checks that the acquired URL opens through
// the real database package with every migration applied.
func TestAcquireGivesMigratedDatabase(t *testing.T) {
	url := databasetest.Acquire(t)

	db, err := database.Open(t.Context(), url)
	if err != nil {
		t.Fatalf("open acquired database: %v", err)
	}
	t.Cleanup(db.Close)
	version, err := db.SchemaVersion(t.Context())
	if err != nil {
		t.Fatalf("read schema version: %v", err)
	}
	if version < 1 {
		t.Errorf("schema version = %d, want migrations applied (>= 1)", version)
	}
}

// TestAcquireGivesIsolatedDatabases checks that data written through one
// acquired URL is invisible through another: each test owns its own database.
func TestAcquireGivesIsolatedDatabases(t *testing.T) {
	first, second := databasetest.Acquire(t), databasetest.Acquire(t)
	if first == second {
		t.Fatalf("two acquisitions returned the same URL %q", first)
	}
	one, two := open(t, first), open(t, second)

	if _, err := one.Exec(t.Context(), "INSERT INTO airports (code, name, time_zone) VALUES ('ONE', 'One', 'UTC')"); err != nil {
		t.Fatalf("seed first database: %v", err)
	}
	if _, err := two.Exec(t.Context(), "INSERT INTO airports (code, name, time_zone) VALUES ('TWO', 'Two', 'UTC')"); err != nil {
		t.Fatalf("seed second database: %v", err)
	}

	var n int
	if err := one.QueryRow(t.Context(), "SELECT count(*) FROM airports WHERE code = 'TWO'").Scan(&n); err != nil {
		t.Fatalf("read first database: %v", err)
	}
	if n != 0 {
		t.Errorf("first database sees the second test's airport; databases not isolated")
	}
	if err := two.QueryRow(t.Context(), "SELECT count(*) FROM airports WHERE code = 'ONE'").Scan(&n); err != nil {
		t.Fatalf("read second database: %v", err)
	}
	if n != 0 {
		t.Errorf("second database sees the first test's airport; databases not isolated")
	}
}

// TestDropRemovesDatabase drops an acquired database while a connection pool
// is still open to it, then checks that new connections fail — how a test
// simulates an unavailable database without stopping the shared container.
func TestDropRemovesDatabase(t *testing.T) {
	url := databasetest.Acquire(t)
	pool := open(t, url)
	if _, err := pool.Exec(t.Context(), "SELECT 1"); err != nil {
		t.Fatalf("use database before drop: %v", err)
	}

	databasetest.Drop(t, url)

	if err := pool.Ping(t.Context()); err == nil {
		t.Error("ping on the open pool = nil error, want the database gone")
	}
	reopened, err := pgxpool.New(t.Context(), url)
	if err == nil {
		defer reopened.Close()
		err = reopened.Ping(t.Context())
	}
	if err == nil {
		t.Error("connect after drop = nil error, want the database gone")
	}
}

// open connects a pool to url and closes it when the test ends.
func open(t *testing.T, url string) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(t.Context(), url)
	if err != nil {
		t.Fatalf("connect to %s: %v", url, err)
	}
	t.Cleanup(pool.Close)
	return pool
}
