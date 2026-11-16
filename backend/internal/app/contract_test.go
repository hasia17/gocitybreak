package app_test

import (
	"bytes"
	"encoding/json"
	"flag"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var updateContract = flag.Bool("update-contract", false, "update shared HTTP response fixtures")

func TestContractDefaultWorkHours(t *testing.T) {
	srv, url := startAPI(t, "test")
	seed(t, url, polishAndItalianAirports, fixture{flights: []fixtureFlight{
		{"KRK", "BGY", "2026-12-04", "17:30", "2026-12-04", "19:25", 5000, "PLN", "2026-11-10T08:00:00Z"},
		{"BGY", "KRK", "2026-12-07", "07:00", "2026-12-07", "08:50", 4000, "PLN", "2026-11-10T08:00:00Z"},
	}})
	for _, hours := range []string{``, `, "workStart":"09:00", "workEnd":"17:00"`} {
		code, body := search(t, srv, `{"kind":"roundTrip", "homeAirports":["KRK"], "destination":{"airports":["BGY"]}, "travelWindow":{"from":"2026-12-01", "to":"2026-12-10"}, "stayLength":{"min":2,"max":4}`+hours+`}`)
		if code != http.StatusOK || len(body.Offers) != 1 || body.Offers[0].LeaveDays == nil || *body.Offers[0].LeaveDays != 0 {
			t.Errorf("hours %q: status %d, offers %+v; want one offer with zero leave days", hours, code, body.Offers)
		}
	}
}

// TestSearchContract compares complete HTTP bodies, including fields absent from test DTOs.
func TestSearchContract(t *testing.T) {
	cases := []struct {
		name        string
		data        fixture
		status      int
		response    string
		contentType string
	}{
		{"one-way", fixture{flights: []fixtureFlight{{"KRK", "BGY", "2026-12-05", "06:15", "2026-12-05", "08:10", 8900, "PLN", "2026-11-10T08:00:00Z"}}}, http.StatusOK, "json", "application/json"},
		{"round-trip", fixture{flights: []fixtureFlight{
			{"KRK", "BGY", "2026-12-04", "18:00", "2026-12-04", "19:55", 5000, "PLN", "2026-11-10T08:00:00Z"},
			{"BGY", "KRK", "2026-12-06", "20:00", "2026-12-06", "21:50", 4000, "PLN", "2026-11-09T07:00:00Z"},
		}}, http.StatusOK, "json", "application/json"},
		{"foreign-currency", fixture{rates: []fixtureRate{{"EUR", "2026-11-10", 4.2512}}, flights: []fixtureFlight{
			{"KRK", "BGY", "2026-12-03", "06:15", "2026-12-03", "08:10", 5000, "PLN", "2026-11-10T08:00:00Z"},
			{"BGY", "KRK", "2026-12-05", "09:00", "2026-12-05", "10:50", 1999, "EUR", "2026-11-10T08:00:00Z"},
		}}, http.StatusOK, "json", "application/json"},
		{"fixed-dates", fixture{flights: []fixtureFlight{
			{"KRK", "BGY", "2026-12-04", "23:00", "2026-12-05", "02:00", 5000, "PLN", "2026-11-10T08:00:00Z"},
			{"BGY", "KRK", "2026-12-06", "23:00", "2026-12-07", "01:00", 4000, "PLN", "2026-11-09T07:00:00Z"},
		}}, http.StatusOK, "json", "application/json"},
		{"fixed-one-way", fixture{flights: []fixtureFlight{
			{"KRK", "BGY", "2026-12-05", "23:00", "2026-12-06", "02:00", 8900, "PLN", "2026-11-10T08:00:00Z"},
		}}, http.StatusOK, "json", "application/json"},
		{"mixed-airlines", fixture{
			flights: []fixtureFlight{{"KRK", "BGY", "2026-12-04", "18:00", "2026-12-04", "19:55", 5000, "PLN", "2026-11-10T08:00:00Z"}},
			wizzair: []fixtureFlight{{"BGY", "KRK", "2026-12-06", "21:00", "2026-12-06", "22:45", 4500, "PLN", "2026-11-09T07:00:00Z"}},
		}, http.StatusOK, "json", "application/json"},
		{"query-error", fixture{}, http.StatusBadRequest, "txt", "text/plain"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, url := startAPI(t, "test")
			seed(t, url, polishAndItalianAirports, tc.data)
			requestPath := filepath.Join("..", "..", "..", "contract", tc.name+".request.json")
			request, err := os.ReadFile(requestPath)
			if err != nil {
				t.Fatal(err)
			}
			resp, err := http.Post(srv.URL+"/api/search", "application/json", bytes.NewReader(request))
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				t.Fatal(err)
			}
			if resp.StatusCode != tc.status {
				t.Fatalf("status = %d, want %d; body: %s", resp.StatusCode, tc.status, body)
			}
			if got := resp.Header.Get("Content-Type"); !strings.HasPrefix(got, tc.contentType) {
				t.Errorf("content type = %q, want %s", got, tc.contentType)
			}
			if tc.response == "json" {
				var pretty bytes.Buffer
				if err := json.Indent(&pretty, body, "", "  "); err != nil {
					t.Fatalf("invalid response JSON: %v", err)
				}
				body = append(pretty.Bytes(), '\n')
			}
			path := filepath.Join("..", "..", "..", "contract", tc.name+".response."+tc.response)
			if *updateContract {
				if err := os.WriteFile(path, body, 0644); err != nil {
					t.Fatal(err)
				}
			}
			want, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(body, want) {
				t.Errorf("%s mismatch\ngot:\n%s\nwant:\n%s", path, body, want)
			}
		})
	}
}
