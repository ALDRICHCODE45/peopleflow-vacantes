package localbootstrap

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/userinfo"
)

// UserInfo is the strict, bounded projection of the identity provider's
// UserInfo response. Unrelated claims are ignored.
type UserInfo struct {
	Subject  string
	Email    string
	FullName string
}

// UserInfoClient fetches the required verified attributes for an access token.
type UserInfoClient interface {
	Fetch(ctx context.Context, accessToken string) (UserInfo, error)
}

// UserInfo failure sentinels. They never wrap the raw upstream body, headers,
// status text or token.
var (
	ErrUserInfoUnavailable = errors.New("local bootstrap: identity provider unavailable")
	ErrUserInfoInvalid     = errors.New("local bootstrap: identity provider returned invalid attributes")
)

// HTTPUserInfoClient is the fixed pool HTTPS UserInfo client: fixed path,
// per-request deadline, bounded response body, and no redirects.
type HTTPUserInfoClient struct {
	endpoint string
	timeout  time.Duration
	client   *http.Client
}

// NewHTTPUserInfoClient builds the client for the already-validated endpoint.
func NewHTTPUserInfoClient(endpoint string, timeout time.Duration) *HTTPUserInfoClient {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &HTTPUserInfoClient{
		endpoint: endpoint,
		timeout:  timeout,
		client: &http.Client{
			Timeout: timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return errors.New("local bootstrap: redirects are not allowed")
			},
		},
	}
}

// Fetch performs the fixed /oauth2/userInfo request and returns the strict
// required attributes. Every upstream failure collapses to a static sentinel so
// no provider body, header or token can reach the caller or a log.
func (c *HTTPUserInfoClient) Fetch(ctx context.Context, accessToken string) (UserInfo, error) {
	body, err := userinfo.Read(ctx, c.endpoint, accessToken, c.timeout, c.client)
	if err != nil {
		return UserInfo{}, ErrUserInfoUnavailable
	}
	return parseUserInfo(body)
}

// parseUserInfo enforces the typed strict required attributes: sub, email and
// name must be non-blank JSON strings and email_verified must be the boolean
// true or the exact string "true". Everything else is ignored. A required claim
// declared more than once (including an escaped alias of the same decoded key)
// is rejected rather than silently resolved by map last-wins.
func parseUserInfo(body []byte) (UserInfo, error) {
	if hasDuplicateRequiredClaim(body) {
		return UserInfo{}, ErrUserInfoInvalid
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return UserInfo{}, ErrUserInfoInvalid
	}
	subject, err := requiredString(raw, "sub")
	if err != nil {
		return UserInfo{}, err
	}
	email, err := requiredString(raw, "email")
	if err != nil {
		return UserInfo{}, err
	}
	fullName, err := requiredString(raw, "name")
	if err != nil {
		return UserInfo{}, err
	}
	if !verifiedTrue(raw["email_verified"]) {
		return UserInfo{}, ErrUserInfoInvalid
	}
	return UserInfo{Subject: subject, Email: email, FullName: fullName}, nil
}

// isRequiredClaim reports whether key is one of the closed required claims.
func isRequiredClaim(key string) bool {
	switch key {
	case "sub", "email", "name", "email_verified":
		return true
	default:
		return false
	}
}

// hasDuplicateRequiredClaim reports whether the top-level JSON object declares
// any required claim more than once. Keys are compared after decoding, so an
// escaped alias such as "\u0073ub" counts as a duplicate of "sub". Unknown
// claims (including duplicate unknowns) stay ignored. A non-object or malformed
// body reports true so the caller rejects it.
func hasDuplicateRequiredClaim(body []byte) bool {
	decoder := json.NewDecoder(bytes.NewReader(body))
	open, err := decoder.Token()
	if err != nil {
		return true
	}
	if delim, ok := open.(json.Delim); !ok || delim != '{' {
		return true
	}
	seen := make(map[string]bool)
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return true
		}
		key, ok := keyToken.(string)
		if !ok {
			return true
		}
		if isRequiredClaim(key) {
			if seen[key] {
				return true
			}
			seen[key] = true
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return true
		}
	}
	if _, err := decoder.Token(); err != nil {
		return true
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		return true
	}
	return false
}

// requiredString returns the non-blank JSON string stored at key.
func requiredString(raw map[string]json.RawMessage, key string) (string, error) {
	value, ok := raw[key]
	if !ok {
		return "", ErrUserInfoInvalid
	}
	var s string
	if err := json.Unmarshal(value, &s); err != nil {
		return "", ErrUserInfoInvalid
	}
	if strings.TrimSpace(s) == "" {
		return "", ErrUserInfoInvalid
	}
	return s, nil
}

// verifiedTrue reports whether the raw email_verified claim is the JSON boolean
// true or the exact JSON string "true". Truthiness is never used.
func verifiedTrue(value json.RawMessage) bool {
	if len(value) == 0 {
		return false
	}
	var b bool
	if err := json.Unmarshal(value, &b); err == nil {
		return b
	}
	var s string
	if err := json.Unmarshal(value, &s); err == nil {
		return s == "true"
	}
	return false
}
