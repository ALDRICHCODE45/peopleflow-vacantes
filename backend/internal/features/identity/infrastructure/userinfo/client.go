// Package userinfo provides the bounded, no-redirect UserInfo transport shared
// by API onboarding and local bootstrap. Provider data never enters errors/logs.
package userinfo

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
)

const MaxResponseBytes = 16 << 10

var ErrUnavailable = errors.New("identity provider unavailable")

// Read is the hardened transport extracted from localbootstrap. The caller
// supplies its fixed endpoint and no-redirect client; neither comes from HTTP input.
func Read(ctx context.Context, endpoint, accessToken string, timeout time.Duration, client *http.Client) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, ErrUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, ErrUnavailable
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, ErrUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, MaxResponseBytes+1))
	if err != nil || len(body) > MaxResponseBytes {
		return nil, ErrUnavailable
	}
	return body, nil
}

type Client struct {
	endpoint string
	timeout  time.Duration
	client   *http.Client
}

func NewClient(endpoint string, timeout time.Duration) *Client {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &Client{endpoint: endpoint, timeout: timeout, client: &http.Client{Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return ErrUnavailable }}}
}
func (c *Client) Fetch(ctx context.Context, token string) (usecases.VerifiedIdentity, error) {
	body, err := Read(ctx, c.endpoint, token, c.timeout, c.client)
	if err != nil {
		return usecases.VerifiedIdentity{}, ErrUnavailable
	}
	return parse(body)
}

// parse rejects duplicate required claims (including escaped aliases), invalid
// types, missing claims and trailing data. name is deliberately not required:
// candidate sign-up asks only for email/password; the name is API form input.
func parse(body []byte) (usecases.VerifiedIdentity, error) {
	invalid := func() (usecases.VerifiedIdentity, error) { return usecases.VerifiedIdentity{}, ErrUnavailable }
	dec := json.NewDecoder(bytes.NewReader(body))
	open, err := dec.Token()
	if err != nil || open != json.Delim('{') {
		return invalid()
	}
	claims := map[string]json.RawMessage{}
	for dec.More() {
		token, err := dec.Token()
		if err != nil {
			return invalid()
		}
		key, ok := token.(string)
		if !ok {
			return invalid()
		}
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return invalid()
		}
		switch key {
		case "sub", "email", "email_verified":
			if _, seen := claims[key]; seen {
				return invalid()
			}
			claims[key] = raw
		}
	}
	if _, err := dec.Token(); err != nil {
		return invalid()
	}
	var extra any
	if dec.Decode(&extra) != io.EOF {
		return invalid()
	}
	var subject, email string
	if json.Unmarshal(claims["sub"], &subject) != nil || strings.TrimSpace(subject) == "" || json.Unmarshal(claims["email"], &email) != nil || strings.TrimSpace(email) == "" {
		return invalid()
	}
	raw, ok := claims["email_verified"]
	if !ok || bytes.Equal(raw, []byte("null")) {
		return invalid()
	}
	var verified bool
	if err := json.Unmarshal(raw, &verified); err != nil {
		var s string
		if json.Unmarshal(raw, &s) != nil || (s != "true" && s != "false") {
			return invalid()
		}
		verified = s == "true"
	}
	return usecases.VerifiedIdentity{Subject: subject, Email: email, EmailVerified: verified}, nil
}
