package worker_test

import (
	"context"
	"testing"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/wizzair"
	"github.com/hasia17/gocitybreak/backend/internal/worker"
)

// run starts the worker's schedule on a database without a catalogue yet, waits until Wizz Air flights are stored
// or the deadline passes, and stops it.
func run(t *testing.T, e *env) {
	t.Helper()
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		defer close(done)
		e.worker.Run(ctx, worker.Schedule{PricePause: time.Hour, RatesInterval: time.Hour, RatesRetry: time.Hour})
	}()
	deadline := time.Now().Add(20 * time.Second)
	for len(storedWizzairFlights(t, e)) == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	<-done
}

func TestRunStoresTheCatalogueBeforeWizzairIsFetchedOnAColdStart(t *testing.T) {
	env := start(t)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}
	env.wizzair.setFlights(fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-05T06:00", price: 99.00, currency: "PLN"})

	run(t, env)

	assertEqual(t, "Wizz Air flights", storedWizzairFlights(t, env), []string{
		"KRK→BGY 2026-12-05 06:00 → ~2026-12-05 07:45 9900 PLN @2026-11-10T08:00",
	})
}

func TestRunKeepsFetchingWizzairWhenRyanairFails(t *testing.T) {
	env := start(t)
	env.ryanair.fail("cheapestPerDay", "", true)
	env.wizzair.stations = []wizzair.Station{flies(krk, "BGY"), flies(bgy, "KRK")}
	env.wizzair.setFlights(fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-05T06:00", price: 99.00, currency: "PLN"})

	run(t, env)

	assertEqual(t, "Wizz Air flights", storedWizzairFlights(t, env), []string{
		"KRK→BGY 2026-12-05 06:00 → ~2026-12-05 07:45 9900 PLN @2026-11-10T08:00",
	})
}

func TestRunKeepsFetchingRyanairWhenWizzairFails(t *testing.T) {
	env := start(t)
	env.wizzair.fail("stations", "", true)
	env.ryanair.setFlights(
		fakeFlight{from: "KRK", to: "BGY", departure: "2026-12-04T05:50", arrival: "2026-12-04T07:40", price: 70.27, currency: "PLN"},
	)
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		defer close(done)
		env.worker.Run(ctx, worker.Schedule{PricePause: time.Hour, RatesInterval: time.Hour, RatesRetry: time.Hour})
	}()
	deadline := time.Now().Add(20 * time.Second)
	for len(storedFlights(t, env.pool)) == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	<-done

	assertEqual(t, "Ryanair flights", storedFlights(t, env.pool), []string{
		"KRK→BGY 2026-12-04 05:50 → 2026-12-04 07:40 7027 PLN @2026-11-10T08:00",
	})
}
