// Command worker is the price worker (ADR-0002): it keeps the database filled with Ryanair's airport catalogue,
// stored prices and NBP exchange rates.
//
// Configuration comes from the environment:
//
//	DATABASE_URL                  PostgreSQL connection string (required)
//	RYANAIR_URL                   Ryanair's API (default "https://www.ryanair.com")
//	NBP_URL                       NBP's API (default "https://api.nbp.pl")
//	RYANAIR_REQUESTS_PER_SECOND   rate limit for Ryanair, retries included (default 1)
//	PRICE_REFRESH_PAUSE           pause between price refreshes, each fetching only what is due (default "10m")
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/database"
	"github.com/hasia17/gocitybreak/backend/internal/fetch"
	"github.com/hasia17/gocitybreak/backend/internal/nbp"
	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
	"github.com/hasia17/gocitybreak/backend/internal/worker"
)

// browserUserAgent is sent to Ryanair, whose API turns away clients that don't look like a browser.
const browserUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

func main() {
	if err := run(); err != nil {
		slog.Error("worker stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return errors.New("DATABASE_URL is not set")
	}
	rps, err := strconv.ParseFloat(env("RYANAIR_REQUESTS_PER_SECOND", "1"), 64)
	if err != nil || rps <= 0 {
		return fmt.Errorf("RYANAIR_REQUESTS_PER_SECOND must be a positive number")
	}
	pause, err := time.ParseDuration(env("PRICE_REFRESH_PAUSE", "10m"))
	if err != nil {
		return fmt.Errorf("PRICE_REFRESH_PAUSE: %w", err)
	}

	db, err := database.Open(ctx, dbURL)
	if err != nil {
		return err
	}
	defer db.Close()

	ryanairFetch := fetch.NewClient(fetch.Options{RequestsPerSecond: rps, UserAgent: browserUserAgent})
	nbpFetch := fetch.NewClient(fetch.Options{RequestsPerSecond: 1})
	w := worker.New(worker.Config{
		Pool:    db.Pool,
		Ryanair: ryanair.NewHTTPClient(env("RYANAIR_URL", "https://www.ryanair.com"), ryanairFetch),
		NBP:     nbp.NewClient(env("NBP_URL", "https://api.nbp.pl"), nbpFetch),
	})

	slog.Info("worker started", "ryanairRequestsPerSecond", rps, "priceRefreshPause", pause)
	w.Run(ctx, worker.Schedule{PricePause: pause, RatesInterval: 24 * time.Hour, RatesRetry: time.Hour})
	slog.Info("worker stopped gracefully")
	return nil
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
