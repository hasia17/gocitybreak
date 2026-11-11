// Package fetch gets JSON over HTTP politely: it rate-limits requests and retries failures with backoff.
package fetch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"time"

	"golang.org/x/time/rate"
)

// Options tune a Client. Zero values pick the defaults.
type Options struct {
	// RequestsPerSecond caps the request rate, retries included (default: unlimited).
	RequestsPerSecond float64
	// MaxAttempts is how many times a request is tried before giving up (default 4).
	MaxAttempts int
	// InitialBackoff is the wait before the first retry; it doubles with every further retry (default 2s).
	InitialBackoff time.Duration
	// UserAgent is sent with every request (default "gocitybreak": some APIs, NBP's among them, reject Go's own).
	UserAgent string
	// HTTPClient performs the requests (default: a client with a 30s timeout).
	HTTPClient *http.Client
}

// Client gets JSON documents.
type Client struct {
	http           *http.Client
	limiter        *rate.Limiter
	maxAttempts    int
	initialBackoff time.Duration
	userAgent      string
}

// NewClient returns a Client configured by opts.
func NewClient(opts Options) *Client {
	c := &Client{
		http:           opts.HTTPClient,
		limiter:        rate.NewLimiter(rate.Inf, 1),
		maxAttempts:    opts.MaxAttempts,
		initialBackoff: opts.InitialBackoff,
		userAgent:      opts.UserAgent,
	}
	if c.http == nil {
		c.http = &http.Client{Timeout: 30 * time.Second}
	}
	if opts.RequestsPerSecond > 0 {
		c.limiter = rate.NewLimiter(rate.Limit(opts.RequestsPerSecond), 1)
	}
	if c.maxAttempts <= 0 {
		c.maxAttempts = 4
	}
	if c.initialBackoff <= 0 {
		c.initialBackoff = 2 * time.Second
	}
	if c.userAgent == "" {
		c.userAgent = "gocitybreak"
	}
	return c
}

// StatusError is a response with an unexpected HTTP status.
type StatusError struct {
	URL  string
	Code int
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("GET %s: HTTP %d", e.URL, e.Code)
}

// GetJSON fetches url and decodes its JSON body into out. Network errors, HTTP 429 and 5xx responses are
// retried with exponential backoff; other non-200 responses fail at once with a *StatusError.
func (c *Client) GetJSON(ctx context.Context, url string, out any) error {
	backoff := c.initialBackoff
	for attempt := 1; ; attempt++ {
		err := c.getOnce(ctx, url, out)
		if err == nil || !retryable(err) || attempt == c.maxAttempts || ctx.Err() != nil {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		backoff *= 2
	}
}

func (c *Client) getOnce(ctx context.Context, url string, out any) error {
	if err := c.limiter.Wait(ctx); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.userAgent)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		return &StatusError{URL: url, Code: resp.StatusCode}
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("GET %s: decode JSON: %w", url, err)
	}
	return nil
}

func retryable(err error) bool {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var status *StatusError
	if errors.As(err, &status) {
		return status.Code == http.StatusTooManyRequests || status.Code >= 500
	}
	// The HTTP client reports network failures (refused connection, timeout, reset) as *url.Error;
	// a body that isn't the JSON we expect won't get better by asking again.
	var network *neturl.Error
	return errors.As(err, &network)
}
