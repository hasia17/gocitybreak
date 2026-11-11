// Package databasetest starts throwaway PostgreSQL databases for tests.
package databasetest

import (
	"context"
	"testing"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

// StartPostgres runs a fresh, empty PostgreSQL container for the test and returns it with its connection string.
// The container is removed when the test ends.
func StartPostgres(t *testing.T) (*postgres.PostgresContainer, string) {
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
