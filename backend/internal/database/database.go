// Package database opens the PostgreSQL price database and keeps its schema up to date.
package database

import (
	"context"
	"embed"
	"fmt"
	"io/fs"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrations embed.FS

// DB is a connection pool to the database with its schema migrated to the latest version.
type DB struct {
	Pool     *pgxpool.Pool
	migrator *goose.Provider
}

// Open connects to the database at url and applies any pending migrations.
func Open(ctx context.Context, url string) (*DB, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("connect to database: %w", err)
	}
	db, err := newMigratedDB(ctx, pool)
	if err != nil {
		pool.Close()
		return nil, err
	}
	return db, nil
}

// newMigratedDB applies pending migrations to the database behind pool and wraps it in a DB.
func newMigratedDB(ctx context.Context, pool *pgxpool.Pool) (*DB, error) {
	dir, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return nil, fmt.Errorf("open embedded migrations: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, stdlib.OpenDBFromPool(pool), dir)
	if err != nil {
		return nil, fmt.Errorf("load migrations: %w", err)
	}
	if _, err := provider.Up(ctx); err != nil {
		return nil, fmt.Errorf("apply migrations: %w", err)
	}
	return &DB{Pool: pool, migrator: provider}, nil
}

// SchemaVersion reports the version of the last migration applied to the database.
// It also serves as a health check: it fails when the database is unreachable.
func (db *DB) SchemaVersion(ctx context.Context) (int64, error) {
	version, err := db.migrator.GetDBVersion(ctx)
	if err != nil {
		return 0, fmt.Errorf("read schema version: %w", err)
	}
	return version, nil
}

// Close releases all database connections.
func (db *DB) Close() {
	db.Pool.Close()
}
