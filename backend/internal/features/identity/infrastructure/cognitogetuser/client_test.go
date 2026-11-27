package cognitogetuser_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/cognitogetuser"
	chimw "github.com/go-chi/chi/v5/middleware"
)

// A realistic-looking but fake token; it must never appear in logs or errors.
const token = "eyJraWQiOiJzZWNyZXQta2lkIn0.eyJzdWIiOiJzdWJqZWN0In0.SIGNATURE-must-not-leak"

const okBody = `{"Username":"u-1","UserAttributes":[{"Name":"sub","Value":"subject"},{"Name":"email_verified","Value":"true"},{"Name":"email","Value":"laura@empresa.mx"}]}`

type captured struct {
	method, path, contentType, target, authorization string
	body                                             []byte
}

func logger() (*slog.Logger, *bytes.Buffer) {
	var buf bytes.Buffer
	return slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})), &buf
}

func records(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("log line not JSON: %s", line)
		}
		out = append(out, m)
	}
	return out
}

// embedded-auth-v1 §GetUser provider → Request: exact unsigned awsJson1_1 call.
func TestGetUserSendsExactRequest(t *testing.T) {
	var got captured
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		got = captured{r.Method, r.URL.RequestURI(), r.Header.Get("Content-Type"), r.Header.Get("X-Amz-Target"), r.Header.Get("Authorization"), body}
		w.Header().Set("Content-Type", "application/x-amz-json-1.1")
		_, _ = w.Write([]byte(okBody))
	}))
	defer server.Close()
	log, buf := logger()
	tok := token + `"\</script>` // JSON-encoded, never concatenated
	id, err := cognitogetuser.NewClient(server.URL+"/", time.Second, log).Fetch(context.Background(), tok)
	if err != nil {
		t.Fatal(err)
	}
	if id != (usecases.VerifiedIdentity{Subject: "subject", Email: "laura@empresa.mx", EmailVerified: true}) {
		t.Fatalf("identity %+v", id)
	}
	if got.method != "POST" || got.path != "/" || got.contentType != "application/x-amz-json-1.1" || got.target != "AWSCognitoIdentityProviderService.GetUser" || got.authorization != "" {
		t.Fatalf("request %+v", got)
	}
	var body map[string]any
	if err := json.Unmarshal(got.body, &body); err != nil || len(body) != 1 || body["AccessToken"] != tok {
		t.Fatalf("body %s", got.body)
	}
	plain, _ := json.Marshal(map[string]string{"AccessToken": token})
	if _, err := cognitogetuser.NewClient(server.URL, time.Second, log).Fetch(context.Background(), token); err != nil || !bytes.Equal(got.body, plain) || got.path != "/" {
		t.Fatalf("exact body %s path %s err %v", got.body, got.path, err)
	}
	if buf.Len() != 0 {
		t.Fatalf("success logged: %s", buf.String())
	}
}

// Parse rules and D10: absent email_verified = not verified; strict otherwise.
func TestGetUserParse(t *testing.T) {
	attrs := func(items ...string) string {
		return `{"Username":"u-1","UserAttributes":[` + strings.Join(items, ",") + `]}`
	}
	sub, email := `{"Name":"sub","Value":"subject"}`, `{"Name":"email","Value":"laura@empresa.mx"}`
	verifiedTrue, verifiedFalse := `{"Name":"email_verified","Value":"true"}`, `{"Name":"email_verified","Value":"false"}`
	for _, tc := range []struct {
		name, body string
		verified   bool
		malformed  bool
	}{
		{name: "verified", body: okBody, verified: true},
		{name: "any order and extras ignored", body: `{"MFAOptions":[],"UserAttributes":[` + email + `,{"Name":"custom:x","Value":"y"},{"Name":"name"},` + verifiedTrue + `,` + sub + `],"PreferredMfaSetting":"x","Username":"ignored"}`, verified: true},
		{name: "unverified", body: attrs(sub, verifiedFalse, email)},
		{name: "missing email_verified", body: attrs(sub, email)},
		{name: "exactly 16 KiB", body: padTo(okBody, 16<<10), verified: true},
		{name: "verified uppercase", body: attrs(sub, email, `{"Name":"email_verified","Value":"TRUE"}`), malformed: true},
		{name: "verified empty", body: attrs(sub, email, `{"Name":"email_verified","Value":""}`), malformed: true},
		{name: "verified boolean", body: attrs(sub, email, `{"Name":"email_verified","Value":true}`), malformed: true},
		{name: "verified without value", body: attrs(sub, email, `{"Name":"email_verified"}`), malformed: true},
		{name: "missing sub", body: attrs(email, verifiedTrue), malformed: true},
		{name: "blank sub", body: attrs(`{"Name":"sub","Value":"  "}`, email, verifiedTrue), malformed: true},
		{name: "missing email", body: attrs(sub, verifiedTrue), malformed: true},
		{name: "invalid email", body: attrs(sub, `{"Name":"email","Value":"not-an-email"}`, verifiedTrue), malformed: true},
		{name: "duplicate sub", body: attrs(sub, `{"Name":"sub","Value":"other"}`, email, verifiedTrue), malformed: true},
		{name: "duplicate email_verified", body: attrs(sub, email, verifiedFalse, verifiedTrue), malformed: true},
		{name: "duplicate name key", body: attrs(`{"Name":"email","Name":"sub","Value":"subject"}`, email, verifiedTrue), malformed: true},
		{name: "null value", body: attrs(`{"Name":"sub","Value":null}`, email, verifiedTrue), malformed: true},
		{name: "name not string", body: attrs(`{"Name":1,"Value":"x"}`, sub, email, verifiedTrue), malformed: true},
		{name: "element not object", body: attrs(`"sub"`, sub, email, verifiedTrue), malformed: true},
		{name: "attributes missing", body: `{"Username":"u-1"}`, malformed: true},
		{name: "attributes not array", body: `{"UserAttributes":{}}`, malformed: true},
		{name: "attributes null", body: `{"UserAttributes":null}`, malformed: true},
		{name: "duplicate attributes key", body: `{"UserAttributes":[],"UserAttributes":[` + sub + `,` + email + `,` + verifiedTrue + `]}`, malformed: true},
		{name: "trailing data", body: okBody + `{}`, malformed: true},
		{name: "not an object", body: `[]`, malformed: true},
		{name: "empty", body: ``, malformed: true},
		{name: "truncated", body: `{"UserAttributes":[`, malformed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(tc.body)) }))
			defer server.Close()
			log, buf := logger()
			id, err := cognitogetuser.NewClient(server.URL, time.Second, log).Fetch(context.Background(), token)
			if tc.malformed {
				if !errors.Is(err, cognitogetuser.ErrUnavailable) || id != (usecases.VerifiedIdentity{}) {
					t.Fatalf("want unavailable, got %+v %v", id, err)
				}
				assertOneWarning(t, buf, "malformed")
				return
			}
			if err != nil || id.Subject != "subject" || id.Email != "laura@empresa.mx" || id.EmailVerified != tc.verified {
				t.Fatalf("got %+v %v", id, err)
			}
			if buf.Len() != 0 {
				t.Fatalf("a parsed answer logged: %s", buf.String())
			}
		})
	}
}

func padTo(body string, size int) string {
	// Whitespace before the closing brace keeps the JSON valid.
	return body[:len(body)-1] + strings.Repeat(" ", size-len(body)) + "}"
}

// §Failure mapping (D9, D11): every failure is ErrUnavailable with one
// value-free warning carrying a closed class.
func TestGetUserFailureClasses(t *testing.T) {
	errorBody := func(name, message string) string {
		return `{"__type":"` + name + `","message":"` + message + `"}`
	}
	for _, tc := range []struct {
		name, header, body, class string
		status                    int
	}{
		{name: "not authorized header", status: 400, header: "NotAuthorizedException", body: errorBody("NotAuthorizedException", "Invalid Access Token"), class: "not_authorized"},
		{name: "not authorized header suffix", status: 400, header: "NotAuthorizedException:http://internal.amazon.com/coral/com.amazonaws.cognito.identity.idp/", body: `{}`, class: "not_authorized"},
		{name: "not authorized body namespace only", status: 400, body: errorBody("com.amazonaws.cognito.identity.idp.model#NotAuthorizedException", "Access Token has been revoked"), class: "not_authorized"},
		{name: "user not found", status: 400, header: "UserNotFoundException", body: errorBody("UserNotFoundException", "User does not exist."), class: "user_state"},
		{name: "user not confirmed", status: 400, body: errorBody("UserNotConfirmedException", "x"), class: "user_state"},
		{name: "password reset", status: 400, header: "PasswordResetRequiredException", class: "user_state"},
		{name: "too many requests", status: 400, header: "TooManyRequestsException", body: errorBody("TooManyRequestsException", "Rate exceeded"), class: "throttled"},
		{name: "throttling", status: 400, body: errorBody("ThrottlingException", "Rate exceeded"), class: "throttled"},
		{name: "forbidden", status: 403, header: "ForbiddenException", class: "client_error"},
		{name: "invalid parameter", status: 400, header: "InvalidParameterException", class: "client_error"},
		{name: "serialization (stub)", status: 400, body: errorBody("SerializationException", "stub: unexpected request"), class: "client_error"},
		{name: "unnamed 4xx", status: 404, body: `not json`, class: "client_error"},
		{name: "internal error", status: 500, header: "InternalErrorException", body: errorBody("InternalErrorException", "Internal error"), class: "server_error"},
		{name: "service unavailable", status: 503, body: `{}`, class: "server_error"},
		{name: "unexpected 2xx", status: 204, class: "malformed"},
		{name: "oversized 200", status: 200, body: padTo(okBody, 16<<10+1), class: "too_large"},
		{name: "oversized error", status: 400, header: "NotAuthorizedException", body: strings.Repeat("x", 64<<10), class: "not_authorized"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tc.header != "" {
					w.Header().Set("x-amzn-ErrorType", tc.header)
				}
				w.Header().Set("Content-Type", "application/x-amz-json-1.1")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			log, buf := logger()
			id, err := cognitogetuser.NewClient(server.URL, time.Second, log).Fetch(context.Background(), token)
			if !errors.Is(err, cognitogetuser.ErrUnavailable) || id != (usecases.VerifiedIdentity{}) {
				t.Fatalf("got %+v %v", id, err)
			}
			if strings.Contains(err.Error(), "Invalid Access Token") || strings.Contains(err.Error(), token) {
				t.Fatal("error leaks provider data")
			}
			assertOneWarning(t, buf, tc.class)
		})
	}
}

func TestGetUserRefusesRedirects(t *testing.T) {
	var followed atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		followed.Add(1)
		_, _ = w.Write([]byte(okBody))
	}))
	defer target.Close()
	for _, status := range []int{301, 302, 307, 308} {
		redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, target.URL+"/", status)
		}))
		log, buf := logger()
		_, err := cognitogetuser.NewClient(redirect.URL, time.Second, log).Fetch(context.Background(), token)
		redirect.Close()
		if !errors.Is(err, cognitogetuser.ErrUnavailable) || followed.Load() != 0 {
			t.Fatalf("%d: err %v followed %d", status, err, followed.Load())
		}
		assertOneWarning(t, buf, "redirect")
	}
}

func TestGetUserDeadlineAndTransport(t *testing.T) {
	release := make(chan struct{})
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer slow.Close()
	defer close(release)
	log, buf := logger()
	start := time.Now()
	_, err := cognitogetuser.NewClient(slow.URL, 100*time.Millisecond, log).Fetch(context.Background(), token)
	if !errors.Is(err, cognitogetuser.ErrUnavailable) || time.Since(start) > 2*time.Second {
		t.Fatalf("deadline not enforced: %v after %s", err, time.Since(start))
	}
	assertOneWarning(t, buf, "timeout")

	// The caller's own deadline is honored too.
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	log, buf = logger()
	if _, err := cognitogetuser.NewClient(slow.URL, time.Minute, log).Fetch(ctx, token); !errors.Is(err, cognitogetuser.ErrUnavailable) {
		t.Fatalf("context deadline: %v", err)
	}
	assertOneWarning(t, buf, "timeout")

	closed := httptest.NewServer(http.NotFoundHandler())
	closed.Close()
	log, buf = logger()
	if _, err := cognitogetuser.NewClient(closed.URL, time.Second, log).Fetch(context.Background(), token); !errors.Is(err, cognitogetuser.ErrUnavailable) {
		t.Fatalf("transport: %v", err)
	}
	assertOneWarning(t, buf, "transport")
}

// D11: request_id is attached when the request middleware set one.
func TestGetUserWarningCarriesRequestID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500) }))
	defer server.Close()
	log, buf := logger()
	ctx := context.WithValue(context.Background(), chimw.RequestIDKey, "req-42")
	_, _ = cognitogetuser.NewClient(server.URL, time.Second, log).Fetch(ctx, token)
	rec := assertOneWarning(t, buf, "server_error")
	if rec["request_id"] != "req-42" {
		t.Fatalf("request_id missing: %v", rec)
	}
}

// assertOneWarning: exactly one bounded record, fixed message and keys, and no
// token, email, provider message or body anywhere in the output.
func assertOneWarning(t *testing.T, buf *bytes.Buffer, class string) map[string]any {
	t.Helper()
	raw := buf.String()
	for _, secret := range []string{token, "SIGNATURE-must-not-leak", "laura@empresa.mx", "Invalid Access Token", "Rate exceeded", "User does not exist", "revoked", "subject", "xxxxxxxx"} {
		if strings.Contains(raw, secret) {
			t.Fatalf("log leaks %q: %s", secret, raw)
		}
	}
	recs := records(t, buf)
	if len(recs) != 1 {
		t.Fatalf("want exactly one record, got %d: %s", len(recs), raw)
	}
	rec := recs[0]
	if rec["level"] != "WARN" || rec["msg"] != "identity provider failed" || rec["provider"] != "cognito_getuser" || rec["class"] != class {
		t.Fatalf("record %v, want class %s", rec, class)
	}
	for key := range rec {
		switch key {
		case "time", "level", "msg", "provider", "class", "request_id":
		default:
			t.Fatalf("unexpected log key %q in %v", key, rec)
		}
	}
	return rec
}
