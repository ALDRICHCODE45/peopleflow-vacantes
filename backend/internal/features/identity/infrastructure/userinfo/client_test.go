package userinfo

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestClientHardenedTransport(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"oversize", strings.Repeat("x", MaxResponseBytes+1), 200},
		{"upstream error", "upstream private diagnostics", 500},
		{"trailing data", `{"sub":"s","email":"a@example.com","email_verified":true}{}`, 200},
		{"array", `[]`, 200}, {"null", `null`, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			_, err := NewClient(server.URL, time.Second).Fetch(context.Background(), "test-only-access")
			if !errors.Is(err, ErrUnavailable) || strings.Contains(err.Error(), "test-only-access") || strings.Contains(err.Error(), tc.body) {
				t.Fatal("unsafe error or success")
			}
		})
	}
	t.Run("redirect", func(t *testing.T) {
		var hits atomic.Int32
		target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
		defer target.Close()
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 302) }))
		defer server.Close()
		_, err := NewClient(server.URL, time.Second).Fetch(context.Background(), "test-only-access")
		if !errors.Is(err, ErrUnavailable) || hits.Load() != 0 {
			t.Fatal("redirect followed")
		}
	})
	t.Run("deadline", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
		defer server.Close()
		_, err := NewClient(server.URL, 20*time.Millisecond).Fetch(context.Background(), "test-only-access")
		if !errors.Is(err, ErrUnavailable) {
			t.Fatal("deadline not enforced")
		}
	})
	t.Run("unreachable", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		server.Close()
		_, err := NewClient(server.URL, time.Second).Fetch(context.Background(), "test-only-access")
		if !errors.Is(err, ErrUnavailable) {
			t.Fatal("unreachable not rejected")
		}
	})
}
