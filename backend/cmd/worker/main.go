// Command worker is the price worker (ADR-0002): it keeps the database filled with Ryanair's airport catalogue,
// the stored prices of Ryanair's and Wizz Air's flights, and NBP exchange rates.
//
// Configuration comes from the environment:
//
//	DATABASE_URL                  PostgreSQL connection string (required)
//	RYANAIR_URL                   Ryanair's API (default "https://www.ryanair.com")
//	WIZZAIR_URL                   Wizz Air's API host, the API version is appended (default "https://be.wizzair.com")
//	WIZZAIR_API_VERSION           Wizz Air's API version when its homepage names none (default "29.25.0")
//	NBP_URL                       NBP's API (default "https://api.nbp.pl")
//	RYANAIR_REQUESTS_PER_SECOND   rate limit for Ryanair, retries included (default 1)
//	WIZZAIR_REQUESTS_PER_SECOND   rate limit for Wizz Air, retries included (default 1)
//	PRICE_REFRESH_PAUSE           pause between an airline's price refreshes, each fetching only what is due (default "10m")
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
	_ "time/tzdata" // estimated arrivals need every airport's time zone, whatever the image ships

	"github.com/hasia17/gocitybreak/backend/internal/database"
	"github.com/hasia17/gocitybreak/backend/internal/fetch"
	"github.com/hasia17/gocitybreak/backend/internal/nbp"
	"github.com/hasia17/gocitybreak/backend/internal/ryanair"
	"github.com/hasia17/gocitybreak/backend/internal/wizzair"
	"github.com/hasia17/gocitybreak/backend/internal/worker"
)

// browserUserAgent is sent to the airlines, whose APIs turn away clients that don't look like a browser.
const browserUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

// wizzairHomepage sets Wizz Air's first cookies and names its current API version.
const wizzairHomepage = "https://www.wizzair.com/en-gb"

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
	ryanairRPS, err := requestsPerSecond("RYANAIR_REQUESTS_PER_SECOND")
	if err != nil {
		return err
	}
	wizzairRPS, err := requestsPerSecond("WIZZAIR_REQUESTS_PER_SECOND")
	if err != nil {
		return err
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

	ryanairFetch := fetch.NewClient(fetch.Options{RequestsPerSecond: ryanairRPS, UserAgent: browserUserAgent})
	nbpFetch := fetch.NewClient(fetch.Options{RequestsPerSecond: 1})
	w := worker.New(worker.Config{
		Pool:    db.Pool,
		Ryanair: ryanair.NewHTTPClient(env("RYANAIR_URL", "https://www.ryanair.com"), ryanairFetch),
		Wizzair: wizzair.NewHTTPClient(wizzair.Config{
			BaseURL:         env("WIZZAIR_URL", "https://be.wizzair.com"),
			HomepageURL:     wizzairHomepage,
			FallbackVersion: env("WIZZAIR_API_VERSION", "29.25.0"),
			Fetch:           fetch.Options{RequestsPerSecond: wizzairRPS, UserAgent: browserUserAgent},
		}),
		NBP:    nbp.NewClient(env("NBP_URL", "https://api.nbp.pl"), nbpFetch),
		Logger: slog.Default(),
	})

	slog.Info("worker started", "ryanairRequestsPerSecond", ryanairRPS, "wizzairRequestsPerSecond", wizzairRPS,
		"priceRefreshPause", pause)
	w.Run(ctx, worker.Schedule{PricePause: pause, RatesInterval: 24 * time.Hour, RatesRetry: time.Hour})
	slog.Info("worker stopped gracefully")
	return nil
}

// requestsPerSecond reads a rate limit from the environment variable name (default 1).
func requestsPerSecond(name string) (float64, error) {
	rps, err := strconv.ParseFloat(env(name, "1"), 64)
	if err != nil || rps <= 0 {
		return 0, fmt.Errorf("%s must be a positive number", name)
	}
	return rps, nil
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
