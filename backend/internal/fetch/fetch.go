// Package fetch makes HTTP requests politely: it rate-limits requests and retries failures with backoff.
package fetch

import (
	"bytes"
	"cmp"
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
	Method string
	URL    string
	Code   int
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("%s %s: HTTP %d", cmp.Or(e.Method, http.MethodGet), e.URL, e.Code)
}

// Request is an HTTP request to make with Do.
type Request struct {
	// Method is the HTTP method (default GET).
	Method string
	URL    string
	// Header is sent with the request; Accept defaults to application/json.
	Header http.Header
	// Body, when set, is sent as JSON.
	Body []byte
}

// GetJSON fetches url and decodes its JSON body into out. Failures are retried as by Do.
func (c *Client) GetJSON(ctx context.Context, url string, out any) error {
	body, err := c.Do(ctx, Request{URL: url})
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("GET %s: decode JSON: %w", url, err)
	}
	return nil
}

// Do makes the request and returns the body of its 200 response. Network errors, HTTP 429 and 5xx responses
// are retried with exponential backoff, sending the same headers and body; other non-200 responses fail at once
// with a *StatusError.
func (c *Client) Do(ctx context.Context, r Request) ([]byte, error) {
	backoff := c.initialBackoff
	for attempt := 1; ; attempt++ {
		body, err := c.doOnce(ctx, r)
		if err == nil || !retryable(err) || attempt == c.maxAttempts || ctx.Err() != nil {
			return body, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(backoff):
		}
		backoff *= 2
	}
}

func (c *Client) doOnce(ctx context.Context, r Request) ([]byte, error) {
	if err := c.limiter.Wait(ctx); err != nil {
		return nil, err
	}
	method := cmp.Or(r.Method, http.MethodGet)
	var body io.Reader
	if r.Body != nil {
		body = bytes.NewReader(r.Body)
	}
	req, err := http.NewRequestWithContext(ctx, method, r.URL, body)
	if err != nil {
		return nil, err
	}
	req.Header = r.Header.Clone()
	if req.Header == nil {
		req.Header = http.Header{}
	}
	if req.Header.Get("Accept") == "" {
		req.Header.Set("Accept", "application/json")
	}
	if r.Body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("User-Agent", c.userAgent)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil, &StatusError{Method: method, URL: r.URL, Code: resp.StatusCode}
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%s %s: read body: %w", method, r.URL, err)
	}
	return b, nil
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
