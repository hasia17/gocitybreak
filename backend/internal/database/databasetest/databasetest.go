// Package databasetest gives every test its own PostgreSQL database: an empty
// database with all migrations applied, cloned from a template on one container
// the whole test package shares.
//
// The container starts lazily on the first Acquire and stays up until Shutdown,
// which each test package calls from its TestMain. Acquired databases are
// dropped when their test ends, so tests stay isolated and order-independent.
package databasetest

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/hasia17/gocitybreak/backend/internal/database"
)

// templateName is the database the migrations are applied to once per
// container; every acquired database is cloned from it.
const templateName = "gocitybreak_template"

// opTimeout bounds each database statement and the container shutdown.
const opTimeout = 30 * time.Second

var (
	mu       sync.Mutex // guards the shared container state below
	shared   *sharedPostgres
	startErr error
	stopped  bool
)

// sharedPostgres is the container a test package shares, with a maintenance
// connection that creates and drops test databases.
type sharedPostgres struct {
	container *postgres.PostgresContainer
	admin     *pgx.Conn
	root      *url.URL   // connection URL of the maintenance database
	mu        sync.Mutex // serializes database creation and drop, guards next
	next      int        // suffix of the next test database name
}

// Acquire returns the connection URL of an empty database with all migrations
// applied, dedicated to the test. The first call in the package starts the
// shared container and migrates the template database; each call clones it.
// The database is dropped when the test ends.
func Acquire(t *testing.T) string {
	t.Helper()
	pg, err := start()
	if err != nil {
		t.Fatalf("start shared postgres: %v", err)
	}
	name, err := pg.create(t.Context())
	if err != nil {
		t.Fatalf("create test database: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
		defer cancel()
		if err := pg.drop(ctx, name); err != nil {
			t.Errorf("drop test database: %v", err)
		}
	})
	return databaseURL(pg.root, name)
}

// Drop removes the database at url together with every connection to it, so a
// test can simulate an unavailable database without stopping the shared
// container. Dropping an already dropped database is a no-op.
func Drop(t *testing.T, url string) {
	t.Helper()
	name, err := databaseName(url)
	if err != nil {
		t.Fatalf("parse database url: %v", err)
	}
	pg, err := start()
	if err != nil {
		t.Fatalf("start shared postgres: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()
	if err := pg.drop(ctx, name); err != nil {
		t.Fatalf("drop database %s: %v", name, err)
	}
}

// Shutdown stops the shared container and its maintenance connection. Call it
// from TestMain after m.Run. It is a no-op when no test acquired a database,
// and an Acquire after it fails.
func Shutdown() {
	mu.Lock()
	defer mu.Unlock()
	stopped = true
	if shared == nil {
		return
	}
	shared.terminate()
	shared = nil
}

// start returns the package's shared container, starting it on first use.
// A failed start is remembered: every later call fails the same way.
func start() (*sharedPostgres, error) {
	mu.Lock()
	defer mu.Unlock()
	switch {
	case stopped:
		return nil, errors.New("Shutdown was already called")
	case shared != nil:
		return shared, nil
	case startErr != nil:
		return nil, startErr
	}
	pg, err := newSharedPostgres()
	if err != nil {
		startErr = err
		return nil, err
	}
	shared = pg
	return pg, nil
}

// newSharedPostgres starts the container, connects its maintenance database
// and migrates the template database every test database is cloned from.
func newSharedPostgres() (*sharedPostgres, error) {
	ctr, err := postgres.Run(context.Background(), "postgres:17-alpine",
		postgres.WithDatabase("gocitybreak"),
		postgres.WithUsername("gocitybreak"),
		postgres.WithPassword("gocitybreak"),
		postgres.BasicWaitStrategies(),
	)
	if err != nil {
		return nil, fmt.Errorf("start postgres: %w", err)
	}
	pg := &sharedPostgres{container: ctr}
	if err := pg.connect(); err != nil {
		pg.terminate()
		return nil, err
	}
	if err := pg.migrateTemplate(); err != nil {
		pg.terminate()
		return nil, err
	}
	return pg, nil
}

// connect opens the maintenance connection the container is administered over.
func (p *sharedPostgres) connect() error {
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()
	raw, err := p.container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		return fmt.Errorf("postgres connection string: %w", err)
	}
	root, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("parse postgres connection string: %w", err)
	}
	admin, err := pgx.Connect(ctx, root.String())
	if err != nil {
		return fmt.Errorf("connect maintenance database: %w", err)
	}
	p.root, p.admin = root, admin
	return nil
}

// migrateTemplate creates the template database and applies every migration
// to it once; each test database is cloned from the result.
func (p *sharedPostgres) migrateTemplate() error {
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()
	if _, err := p.admin.Exec(ctx, "CREATE DATABASE "+templateName); err != nil {
		return fmt.Errorf("create template database %s: %w", templateName, err)
	}
	db, err := database.Open(ctx, databaseURL(p.root, templateName))
	if err != nil {
		return fmt.Errorf("migrate template database: %w", err)
	}
	// A template must have no open connections when a database is cloned from it.
	db.Close()
	return nil
}

// create clones the template into a database with a name unique in this package.
func (p *sharedPostgres) create(ctx context.Context) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.next++
	name := fmt.Sprintf("test_%d", p.next)
	if _, err := p.admin.Exec(ctx, "CREATE DATABASE "+name+" TEMPLATE "+templateName); err != nil {
		return "", fmt.Errorf("create database %s: %w", name, err)
	}
	return name, nil
}

// drop removes the database, terminating any connections still open to it.
func (p *sharedPostgres) drop(ctx context.Context, name string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, err := p.admin.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)"); err != nil {
		return fmt.Errorf("drop database %s: %w", name, err)
	}
	return nil
}

// terminate closes the maintenance connection and removes the container.
func (p *sharedPostgres) terminate() {
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()
	if p.admin != nil {
		_ = p.admin.Close(ctx)
	}
	_ = p.container.Terminate(ctx)
}

// databaseURL returns root with its database replaced by name.
func databaseURL(root *url.URL, name string) string {
	u := *root
	u.Path = "/" + name
	return u.String()
}

// databaseName extracts the database name from a connection URL.
func databaseName(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	name, _ := strings.CutPrefix(u.Path, "/")
	if name == "" {
		return "", fmt.Errorf("no database in %q", raw)
	}
	return name, nil
}
