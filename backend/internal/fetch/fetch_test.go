package fetch_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hasia17/gocitybreak/backend/internal/fetch"
)

func TestGetJSONKeepsToTheRateLimit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	client := fetch.NewClient(fetch.Options{RequestsPerSecond: 20})

	start := time.Now()
	for range 5 {
		var out struct{}
		if err := client.GetJSON(t.Context(), srv.URL, &out); err != nil {
			t.Fatalf("GetJSON: %v", err)
		}
	}

	// The first request goes at once, each of the other four waits 1/20 s.
	if took := time.Since(start); took < 190*time.Millisecond {
		t.Errorf("5 requests at 20/s took %v, want at least 200ms", took)
	}
}

func TestGetJSONDoesNotRetryClientErrors(t *testing.T) {
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		http.Error(w, "declined", http.StatusConflict)
	}))
	defer srv.Close()
	client := fetch.NewClient(fetch.Options{InitialBackoff: time.Millisecond})

	var out struct{}
	err := client.GetJSON(t.Context(), srv.URL, &out)

	var status *fetch.StatusError
	if !errors.As(err, &status) || status.Code != http.StatusConflict {
		t.Errorf("err = %v, want HTTP 409", err)
	}
	if n := requests.Load(); n != 1 {
		t.Errorf("made %d requests, want 1", n)
	}
}

func TestGetJSONGivesUpAfterMaxAttempts(t *testing.T) {
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	client := fetch.NewClient(fetch.Options{MaxAttempts: 3, InitialBackoff: time.Millisecond})

	var out struct{}
	if err := client.GetJSON(t.Context(), srv.URL, &out); err == nil {
		t.Errorf("GetJSON succeeded, want an error")
	}
	if n := requests.Load(); n != 3 {
		t.Errorf("made %d requests, want 3", n)
	}
}
