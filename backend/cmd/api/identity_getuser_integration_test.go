//go:build integration

package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	runtimeconfig "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
	"github.com/google/uuid"
)

// getUserStub is the loopback GetUser stub of embedded-auth-v1 §e2e: it checks
// the exact request (else 400 SerializationException) and answers per subject
// scenario, reading `sub` from the unsigned token payload.
type getUserStub struct {
	mu        sync.Mutex
	scenarios map[string]string // sub → scenario
	requests  []getUserRequest
}

type getUserRequest struct {
	Method, Path, ContentType, Target, Authorization string
	Body                                             string
}

func (s *getUserStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	req := getUserRequest{r.Method, r.URL.RequestURI(), r.Header.Get("Content-Type"), r.Header.Get("X-Amz-Target"), r.Header.Get("Authorization"), string(raw)}
	s.mu.Lock()
	s.requests = append(s.requests, req)
	s.mu.Unlock()
	w.Header().Set("Content-Type", "application/x-amz-json-1.1")
	var body struct{ AccessToken *string }
	if req.Method != "POST" || req.Path != "/" || req.ContentType != "application/x-amz-json-1.1" || req.Target != "AWSCognitoIdentityProviderService.GetUser" ||
		json.Unmarshal(raw, &body) != nil || body.AccessToken == nil {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"__type":"SerializationException","message":"stub: unexpected request"}`))
		return
	}
	sub := tokenSubject(*body.AccessToken)
	s.mu.Lock()
	scenario := s.scenarios[sub]
	s.mu.Unlock()
	answer := func(subject, verified string) {
		attrs := []map[string]string{{"Name": "sub", "Value": subject}}
		if verified != "" {
			attrs = append(attrs, map[string]string{"Name": "email_verified", "Value": verified})
		}
		attrs = append(attrs, map[string]string{"Name": "email", "Value": sub + "@empresa.test"})
		_ = json.NewEncoder(w).Encode(map[string]any{"Username": sub, "UserAttributes": attrs})
	}
	fail := func(status int, name, message string) {
		w.Header().Set("x-amzn-ErrorType", name)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"__type":"` + name + `","message":"` + message + `"}`))
	}
	switch scenario {
	case "unverified":
		answer(sub, "false")
	case "no_verified_attribute":
		answer(sub, "")
	case "mismatch":
		answer("someone-else", "true")
	case "not_authorized":
		fail(400, "NotAuthorizedException", "Invalid Access Token")
	case "user_not_found":
		fail(400, "UserNotFoundException", "User does not exist.")
	case "throttled":
		fail(400, "TooManyRequestsException", "Rate exceeded")
	case "down":
		fail(500, "InternalErrorException", "Internal error")
	case "malformed":
		_, _ = w.Write([]byte(`{"Username":"x"}`))
	default:
		answer(sub, "true")
	}
}

func tokenSubject(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims struct{ Sub string }
	_ = json.Unmarshal(payload, &claims)
	return claims.Sub
}

// embedded-auth-v1 D6–D12: both onboardings through the real router with the
// provider built from configuration exactly as main.go does
// (LoadIdentityConfig → newIdentityProvider), the GetUser adapter pointed at a
// loopback stub. Database: DRAFT_TEST_DATABASE_URL only.
func TestIdentityGetUserFlowBothOnboardings(t *testing.T) {
	requireDraftFlowPool(t)
	stub := &getUserStub{scenarios: map[string]string{}}
	server := httptest.NewServer(stub)
	defer server.Close()
	cfg, err := runtimeconfig.LoadIdentityConfig(func(key string) string {
		return map[string]string{
			"APP_ENV": "test", "IDENTITY_PROVIDER": "cognito_getuser",
			"IDENTITY_COGNITO_REGION": "us-east-1", "IDENTITY_COGNITO_ENDPOINT": server.URL,
		}[key]
	})
	if err != nil {
		t.Fatal(err)
	}
	h := employerFlowHarness(t, newIdentityProvider(cfg, slog.Default()), auditpostgres.NewAuditEventRepository())
	newSub := func(prefix, scenario string) (string, string) {
		sub := prefix + "-" + uuid.NewString()
		stub.mu.Lock()
		stub.scenarios[sub] = scenario
		stub.mu.Unlock()
		return sub, h.signer.validToken(t, sub)
	}
	post := func(path, token string) draftFlowResponse {
		return h.do(t, "POST", path, `{"full_name":"Laura Gómez"}`, token, nil)
	}
	stubCalls := func() int { stub.mu.Lock(); defer stub.mu.Unlock(); return len(stub.requests) }

	employerSub, employerToken := newSub("getuser-employer", "")
	created := post("/v2/me/employer-account", employerToken)
	identityAssertResponse(t, created, 201, "")
	t.Logf("201 employer: %s", created.body)
	stub.mu.Lock()
	first := stub.requests[0]
	stub.mu.Unlock()
	wantBody, _ := json.Marshal(map[string]string{"AccessToken": employerToken})
	if first.Method != "POST" || first.Path != "/" || first.ContentType != "application/x-amz-json-1.1" || first.Target != "AWSCognitoIdentityProviderService.GetUser" || first.Authorization != "" || first.Body != string(wantBody) {
		t.Fatalf("stub request %+v", first)
	}
	t.Logf("stub request: %s %s Content-Type=%s X-Amz-Target=%s Authorization=%q body=%s", first.Method, first.Path, first.ContentType, first.Target, first.Authorization, strings.Replace(first.Body, employerToken, "<bearer token>", 1))
	var me struct {
		Role string
		User struct{ Email string }
	}
	if json.Unmarshal(created.body, &me) != nil || me.Role != "recruiter" || me.User.Email != employerSub+"@empresa.test" {
		t.Fatalf("201 body %s", created.body)
	}
	employerAssertCounts(t, h, employerSub, 1, 1)

	calls := stubCalls()
	retry := post("/v2/me/employer-account", employerToken)
	identityAssertResponse(t, retry, 200, "")
	if !identityJSONEqual(retry.body, created.body) || stubCalls() != calls {
		t.Fatal("retry changed the account or called GetUser")
	}
	t.Logf("200 employer retry: %s", retry.body)

	candidateSub, candidateToken := newSub("getuser-candidate", "")
	cand := post("/v2/me/candidate-account", candidateToken)
	identityAssertResponse(t, cand, 201, "")
	if json.Unmarshal(cand.body, &me) != nil || me.Role != "candidate" {
		t.Fatalf("candidate 201 body %s", cand.body)
	}
	employerAssertCounts(t, h, candidateSub, 1, 1)
	t.Logf("201 candidate: %s", cand.body)

	exists := post("/v2/me/employer-account", candidateToken)
	identityAssertResponse(t, exists, 409, "account_exists")
	t.Logf("409 account_exists: %s", exists.body)

	for _, tc := range []struct {
		scenario, code string
		status         int
	}{
		{"unverified", "email_not_verified", 422},
		{"no_verified_attribute", "email_not_verified", 422},
		{"mismatch", "email_not_verified", 422},
		{"not_authorized", "identity_unavailable", 503},
		{"user_not_found", "identity_unavailable", 503},
		{"throttled", "identity_unavailable", 503},
		{"down", "identity_unavailable", 503},
		{"malformed", "identity_unavailable", 503},
	} {
		for _, path := range []string{"/v2/me/employer-account", "/v2/me/candidate-account"} {
			sub, token := newSub("getuser-"+tc.scenario, tc.scenario)
			r := post(path, token)
			identityAssertResponse(t, r, tc.status, tc.code)
			employerAssertCounts(t, h, sub, 0, 0)
			if path == "/v2/me/employer-account" && (tc.scenario == "unverified" || tc.scenario == "not_authorized") {
				t.Logf("%d %s (%s): %s", tc.status, tc.code, tc.scenario, r.body)
			}
		}
	}
}
