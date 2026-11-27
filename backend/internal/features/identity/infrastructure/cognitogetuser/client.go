// Package cognitogetuser implements the onboarding UserInfoProvider over the
// Cognito user pools GetUser operation (embedded-auth-v1 D6–D11). It is a
// token-authorized, unsigned awsJson1_1 call: no AWS credentials, no SigV4, no
// client secret. Provider bodies, messages and tokens never enter errors or
// logs; each failure emits one warning with a closed, value-free class.
package cognitogetuser

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/userinfo"
	chimw "github.com/go-chi/chi/v5/middleware"
)

const (
	ProviderName     = "cognito_getuser"
	Target           = "AWSCognitoIdentityProviderService.GetUser"
	ContentType      = "application/x-amz-json-1.1"
	DefaultTimeout   = 5 * time.Second
	MaxResponseBytes = userinfo.MaxResponseBytes
)

var ErrUnavailable = errors.New("identity provider unavailable")

// Failure classes (embedded-auth-v1 §Failure mapping). Closed set.
const (
	classMalformed     = "malformed"
	classTooLarge      = "too_large"
	classNotAuthorized = "not_authorized"
	classUserState     = "user_state"
	classThrottled     = "throttled"
	classClientError   = "client_error"
	classServerError   = "server_error"
	classRedirect      = "redirect"
	classTimeout       = "timeout"
	classTransport     = "transport"
	// classCanceled: the caller went away (context.Canceled), not a provider
	// timeout; kept apart so provider-latency alerts stay accurate.
	classCanceled = "canceled"
)

var errorClasses = map[string]string{
	"NotAuthorizedException":         classNotAuthorized,
	"UserNotFoundException":          classUserState,
	"UserNotConfirmedException":      classUserState,
	"PasswordResetRequiredException": classUserState,
	"TooManyRequestsException":       classThrottled,
	"ThrottlingException":            classThrottled,
}

type Client struct {
	endpoint string
	timeout  time.Duration
	client   *http.Client
	logger   *slog.Logger
}

// NewClient builds the adapter for a fixed endpoint (never from HTTP input).
// timeout <= 0 uses DefaultTimeout; a nil logger uses slog.Default().
func NewClient(endpoint string, timeout time.Duration, logger *slog.Logger) *Client {
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Client{
		endpoint: endpoint,
		timeout:  timeout,
		// Redirects are never followed: the 3xx response itself is returned
		// and classified.
		client: &http.Client{Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		logger: logger,
	}
}

// Fetch returns the verified identity of the token's user. Absent
// email_verified is "not verified" (D10); every failure is ErrUnavailable.
func (c *Client) Fetch(ctx context.Context, token string) (usecases.VerifiedIdentity, error) {
	identity, class := c.fetch(ctx, token)
	if class != "" {
		attrs := []any{"provider", ProviderName, "class", class}
		if reqID := chimw.GetReqID(ctx); reqID != "" {
			attrs = append(attrs, "request_id", reqID)
		}
		c.logger.WarnContext(ctx, "identity provider failed", attrs...)
		return usecases.VerifiedIdentity{}, ErrUnavailable
	}
	return identity, nil
}

func (c *Client) fetch(ctx context.Context, token string) (usecases.VerifiedIdentity, string) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	payload, err := json.Marshal(struct {
		AccessToken string `json:"AccessToken"`
	}{token})
	if err != nil {
		return usecases.VerifiedIdentity{}, classTransport
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(payload))
	if err != nil {
		return usecases.VerifiedIdentity{}, classTransport
	}
	req.Header.Set("Content-Type", ContentType)
	req.Header.Set("X-Amz-Target", Target)
	resp, err := c.client.Do(req)
	if err != nil {
		return usecases.VerifiedIdentity{}, transportClass(ctx, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, MaxResponseBytes+1))
	if err != nil {
		return usecases.VerifiedIdentity{}, transportClass(ctx, err)
	}
	tooLarge := len(body) > MaxResponseBytes
	switch {
	case resp.StatusCode == http.StatusOK:
		if tooLarge {
			return usecases.VerifiedIdentity{}, classTooLarge
		}
		identity, ok := parse(body)
		if !ok {
			return usecases.VerifiedIdentity{}, classMalformed
		}
		return identity, ""
	case resp.StatusCode >= 300 && resp.StatusCode < 400:
		return usecases.VerifiedIdentity{}, classRedirect
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		name := errorName(resp.Header.Get("X-Amzn-ErrorType"))
		if name == "" && !tooLarge {
			name = bodyErrorName(body)
		}
		if class, ok := errorClasses[name]; ok {
			return usecases.VerifiedIdentity{}, class
		}
		return usecases.VerifiedIdentity{}, classClientError
	case resp.StatusCode >= 500:
		return usecases.VerifiedIdentity{}, classServerError
	default:
		return usecases.VerifiedIdentity{}, classMalformed
	}
}

func transportClass(ctx context.Context, err error) string {
	if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
		return classCanceled
	}
	var netErr net.Error
	if errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil || (errors.As(err, &netErr) && netErr.Timeout()) {
		return classTimeout
	}
	return classTransport
}

// errorName sanitizes an awsJson1_1 error identifier: strips a ":"-suffix and
// a "namespace#" prefix. Only membership in the closed list is ever used.
func errorName(raw string) string {
	raw = strings.TrimSpace(raw)
	if i := strings.Index(raw, ":"); i >= 0 {
		raw = raw[:i]
	}
	if i := strings.LastIndex(raw, "#"); i >= 0 {
		raw = raw[i+1:]
	}
	return raw
}

func bodyErrorName(body []byte) string {
	var envelope struct {
		Type string `json:"__type"`
	}
	if json.Unmarshal(body, &envelope) != nil {
		return ""
	}
	return errorName(envelope.Type)
}

// parse applies the strict rules of §GetUser provider → Response: one object,
// UserAttributes exactly once and an array of {Name, Value?} objects; sub,
// email and email_verified at most once; sub/email required and non-blank;
// email_verified exactly "true"/"false" or absent; the email must be valid.
func parse(body []byte) (usecases.VerifiedIdentity, bool) {
	dec := json.NewDecoder(bytes.NewReader(body))
	if open, err := dec.Token(); err != nil || open != json.Delim('{') {
		return usecases.VerifiedIdentity{}, false
	}
	var attrs map[string]string
	seenAttributes := false
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return usecases.VerifiedIdentity{}, false
		}
		if key != "UserAttributes" {
			var skip json.RawMessage
			if dec.Decode(&skip) != nil {
				return usecases.VerifiedIdentity{}, false
			}
			continue
		}
		if seenAttributes {
			return usecases.VerifiedIdentity{}, false
		}
		seenAttributes = true
		if attrs, err = parseAttributes(dec); err != nil {
			return usecases.VerifiedIdentity{}, false
		}
	}
	if _, err := dec.Token(); err != nil || !seenAttributes {
		return usecases.VerifiedIdentity{}, false
	}
	var extra any
	if dec.Decode(&extra) != io.EOF {
		return usecases.VerifiedIdentity{}, false
	}
	subject, email := attrs["sub"], attrs["email"]
	if strings.TrimSpace(subject) == "" || strings.TrimSpace(email) == "" {
		return usecases.VerifiedIdentity{}, false
	}
	if _, err := valueobjects.NewEmail(email); err != nil {
		return usecases.VerifiedIdentity{}, false
	}
	verified := false
	if raw, ok := attrs["email_verified"]; ok {
		switch raw {
		case "true":
			verified = true
		case "false":
		default:
			return usecases.VerifiedIdentity{}, false
		}
	}
	return usecases.VerifiedIdentity{Subject: subject, Email: email, EmailVerified: verified}, true
}

var errMalformed = errors.New("malformed")

// parseAttributes reads UserAttributes. Elements must be objects with a
// string Name and, when present, a string Value; unknown names are ignored.
// A wanted attribute without a value is dropped (sub/email then fail as
// missing; email_verified is malformed: present but not "true"/"false").
func parseAttributes(dec *json.Decoder) (map[string]string, error) {
	if open, err := dec.Token(); err != nil || open != json.Delim('[') {
		return nil, errMalformed
	}
	attrs := map[string]string{}
	seen := map[string]bool{}
	for dec.More() {
		var raw json.RawMessage
		if dec.Decode(&raw) != nil {
			return nil, errMalformed
		}
		fields, err := strictObject(raw)
		if err != nil {
			return nil, err
		}
		name, ok := jsonString(fields["Name"])
		if !ok {
			return nil, errMalformed
		}
		rawValue, hasValue := fields["Value"]
		value, ok := jsonString(rawValue)
		if hasValue && !ok {
			return nil, errMalformed
		}
		switch name {
		case "sub", "email", "email_verified":
			if seen[name] {
				return nil, errMalformed
			}
			seen[name] = true
			if !hasValue {
				if name == "email_verified" {
					return nil, errMalformed
				}
				continue
			}
			attrs[name] = value
		}
	}
	if _, err := dec.Token(); err != nil {
		return nil, errMalformed
	}
	return attrs, nil
}

// jsonString accepts only a JSON string (not null, number or object).
func jsonString(raw json.RawMessage) (string, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '"' {
		return "", false
	}
	var s string
	if json.Unmarshal(trimmed, &s) != nil {
		return "", false
	}
	return s, true
}

// strictObject decodes one attribute object refusing duplicate keys
// (including escaped aliases, which the tokenizer unescapes).
func strictObject(raw json.RawMessage) (map[string]json.RawMessage, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if open, err := dec.Token(); err != nil || open != json.Delim('{') {
		return nil, errMalformed
	}
	fields := map[string]json.RawMessage{}
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, errMalformed
		}
		key, _ := tok.(string)
		if _, dup := fields[key]; dup {
			return nil, errMalformed
		}
		var v json.RawMessage
		if dec.Decode(&v) != nil {
			return nil, errMalformed
		}
		fields[key] = v
	}
	return fields, nil
}
