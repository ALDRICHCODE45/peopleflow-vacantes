package localbootstrap

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

func newUserInfoServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return srv
}

func TestHTTPUserInfoClient_Fetch(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		body       string
		wantErrIs  error
		wantEmail  string
		wantName   string
		wantSub    string
		wantCallID bool
	}{
		{
			name:      "boolean true verified",
			status:    http.StatusOK,
			body:      `{"sub":"sub-1","email":"user@example.com","email_verified":true,"name":"Ada Lovelace"}`,
			wantEmail: "user@example.com",
			wantName:  "Ada Lovelace",
			wantSub:   "sub-1",
		},
		{
			name:      "exact string true verified with unrelated claims",
			status:    http.StatusOK,
			body:      `{"sub":"sub-1","email":"user@example.com","email_verified":"true","name":"Ada","custom:role":"x","username":"u"}`,
			wantEmail: "user@example.com",
			wantName:  "Ada",
			wantSub:   "sub-1",
		},
		{name: "boolean false rejected", status: http.StatusOK, body: `{"sub":"s","email":"user@example.com","email_verified":false,"name":"Ada"}`, wantErrIs: ErrUserInfoInvalid},
		{name: "string TRUE rejected", status: http.StatusOK, body: `{"sub":"s","email":"user@example.com","email_verified":"TRUE","name":"Ada"}`, wantErrIs: ErrUserInfoInvalid},
		{name: "string one rejected", status: http.StatusOK, body: `{"sub":"s","email":"user@example.com","email_verified":"1","name":"Ada"}`, wantErrIs: ErrUserInfoInvalid},
		{name: "numeric one rejected", status: http.StatusOK, body: `{"sub":"s","email":"user@example.com","email_verified":1,"name":"Ada"}`, wantErrIs: ErrUserInfoInvalid},
		{name: "email_verified absent rejected", status: http.StatusOK, body: `{"sub":"s","email":"user@example.com","name":"Ada"}`, wantErrIs: ErrUserInfoInvalid},
		{name: "sub absent rejected", status: http.StatusOK, body: `{"email":"user@example.com","email_verified":true,"name":"Ada"}`, wantErrIs: ErrUserInfoInvalid},
		{name: "sub non string rejected", status: http.StatusOK, body: `{"sub":42,"email":"user@example.com","email_verified":true,"name":"Ada"}`, wantErrIs: ErrUserInfoInvalid},
		{name: "empty sub rejected", status: http.StatusOK, body: `{"sub":"","email":"user@example.com","email_verified":true,"name":"Ada"}`, wantErrIs: ErrUserInfoInvalid},
		{name: "email absent rejected", status: http.StatusOK, body: `{"sub":"s","email_verified":true,"name":"Ada"}`, wantErrIs: ErrUserInfoInvalid},
		{name: "name absent rejected", status: http.StatusOK, body: `{"sub":"s","email":"user@example.com","email_verified":true}`, wantErrIs: ErrUserInfoInvalid},
		{name: "malformed json rejected", status: http.StatusOK, body: `{"sub":`, wantErrIs: ErrUserInfoInvalid},
		{name: "unauthorized status unavailable", status: http.StatusUnauthorized, body: `{"error":"invalid_token"}`, wantErrIs: ErrUserInfoUnavailable},
		{name: "server error unavailable", status: http.StatusInternalServerError, body: `upstream exploded`, wantErrIs: ErrUserInfoUnavailable},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := newUserInfoServer(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != UserInfoPath {
					t.Errorf("path = %q, want %q", r.URL.Path, UserInfoPath)
				}
				if got := r.Header.Get("Authorization"); got != "Bearer test-access" {
					t.Errorf("Authorization = %q, want the bearer token", got)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			})

			client := NewHTTPUserInfoClient(srv.URL+UserInfoPath, 2*time.Second)
			info, err := client.Fetch(context.Background(), "test-access")

			if tt.wantErrIs == nil {
				if err != nil {
					t.Fatalf("Fetch returned error: %v", err)
				}
				if info.Subject != tt.wantSub || info.Email != tt.wantEmail || info.FullName != tt.wantName {
					t.Errorf("info = %+v, want sub=%q email=%q name=%q", info, tt.wantSub, tt.wantEmail, tt.wantName)
				}
				return
			}
			if !errors.Is(err, tt.wantErrIs) {
				t.Fatalf("Fetch error = %v, want %v", err, tt.wantErrIs)
			}
			if strings.Contains(err.Error(), tt.body) && tt.body != "" {
				t.Errorf("error leaks the upstream body: %q", err.Error())
			}
		})
	}
}

func TestHTTPUserInfoClient_NoRedirect(t *testing.T) {
	var targetHits atomic.Int32
	target := newUserInfoServer(t, func(w http.ResponseWriter, r *http.Request) {
		targetHits.Add(1)
		_, _ = w.Write([]byte(`{"sub":"s","email":"user@example.com","email_verified":true,"name":"Ada"}`))
	})
	redirector := newUserInfoServer(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+UserInfoPath, http.StatusFound)
	})

	client := NewHTTPUserInfoClient(redirector.URL+UserInfoPath, 2*time.Second)
	_, err := client.Fetch(context.Background(), "test-access")

	if !errors.Is(err, ErrUserInfoUnavailable) {
		t.Fatalf("Fetch error = %v, want ErrUserInfoUnavailable", err)
	}
	if targetHits.Load() != 0 {
		t.Errorf("redirect target was contacted %d times; redirects must not be followed", targetHits.Load())
	}
}

func TestHTTPUserInfoClient_ResponseCap(t *testing.T) {
	oversized := `{"sub":"s","email":"user@example.com","email_verified":true,"name":"` +
		strings.Repeat("a", MaxUserInfoBytes) + `"}`
	srv := newUserInfoServer(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(oversized))
	})

	client := NewHTTPUserInfoClient(srv.URL+UserInfoPath, 2*time.Second)
	_, err := client.Fetch(context.Background(), "test-access")

	if !errors.Is(err, ErrUserInfoUnavailable) {
		t.Fatalf("Fetch error = %v, want ErrUserInfoUnavailable on an oversized body", err)
	}
}

func TestHTTPUserInfoClient_Deadline(t *testing.T) {
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	srv := newUserInfoServer(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	})

	client := NewHTTPUserInfoClient(srv.URL+UserInfoPath, 50*time.Millisecond)
	_, err := client.Fetch(context.Background(), "test-access")

	if !errors.Is(err, ErrUserInfoUnavailable) {
		t.Fatalf("Fetch error = %v, want ErrUserInfoUnavailable on a deadline", err)
	}
}
