package http_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/userinfo"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

func employerRequest(h *identityhttp.CandidateIdentityHandler, subject, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/v2/me/employer-account", strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer caller-access")
	r = r.WithContext(security.ContextWithClaims(r.Context(), security.Claims{Subject: subject, Groups: []string{"candidates"}}))
	w := httptest.NewRecorder()
	h.CreateEmployerAccount(w, r)
	return w
}

// embedded-auth-v1 D1–D3: POST /v2/me/employer-account mirrors the candidate
// endpoint — same strict body, order of checks, error mapping and GET /v2/me
// shape; only the role (recruiter) and the "other role" side differ.
func TestEmployerIdentityOnboarding(t *testing.T) {
	const verified = `{"sub":"subject","email":"VERIFIED@example.com","email_verified":true}`
	tests := []struct {
		name, body, upstream   string
		upstreamStatus, status int
		code                   httpjson.Code
		existing               valueobjects.UserType
		storeErr               error
	}{
		{name: "create", body: `{"full_name":"  Laura Gómez  "}`, upstream: verified, status: 201},
		{name: "unicode minimum", body: `{"full_name":"界界"}`, upstream: verified, status: 201},
		{name: "unicode maximum", body: `{"full_name":"` + strings.Repeat("界", 120) + `"}`, upstream: verified, status: 201},
		{name: "recruiter retry", body: `{"full_name":"Different Name"}`, existing: valueobjects.UserRecruiter, status: 200},
		{name: "candidate exists", body: `{"full_name":"Laura"}`, existing: valueobjects.UserCandidate, status: 409, code: httpjson.CodeAccountExists},
		{name: "email collision", body: `{"full_name":"Laura"}`, upstream: verified, storeErr: entities.ErrEmailTaken, status: 409, code: httpjson.CodeEmailInUse},
		{name: "database failure", body: `{"full_name":"Laura"}`, upstream: verified, storeErr: errors.New("db down"), status: 500, code: httpjson.CodeInternalError},
		{name: "unverified", body: `{"full_name":"Laura"}`, upstream: `{"sub":"subject","email":"a@example.com","email_verified":false}`, status: 422, code: httpjson.CodeEmailNotVerified},
		{name: "subject mismatch", body: `{"full_name":"Laura"}`, upstream: `{"sub":"other","email":"a@example.com","email_verified":true}`, status: 422, code: httpjson.CodeEmailNotVerified},
		{name: "provider down", body: `{"full_name":"Laura"}`, upstreamStatus: 500, status: 503, code: httpjson.CodeIdentityUnavailable},
		{name: "malformed provider", body: `{"full_name":"Laura"}`, upstream: `{`, status: 503, code: httpjson.CodeIdentityUnavailable},
		{name: "invalid email", body: `{"full_name":"Laura"}`, upstream: `{"sub":"subject","email":"invalid","email_verified":true}`, status: 503, code: httpjson.CodeIdentityUnavailable},
		{name: "unknown key", body: `{"full_name":"Laura","role":"recruiter"}`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "injected email", body: `{"full_name":"Laura","email":"injected@example.com"}`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "duplicate", body: `{"full_name":"Laura","full_name":"Other"}`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "escaped duplicate", body: `{"full_name":"Laura","full_\u006eame":"Other"}`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "trailing json", body: `{"full_name":"Laura"}{}`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "non object", body: `[]`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "wrong type", body: `{"full_name":1}`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "missing name", body: `{}`, status: 400, code: httpjson.CodeValidationError},
		{name: "null name", body: `{"full_name":null}`, status: 400, code: httpjson.CodeValidationError},
		{name: "one code point", body: `{"full_name":" 界 "}`, status: 400, code: httpjson.CodeValidationError},
		{name: "too long", body: `{"full_name":"` + strings.Repeat("界", 121) + `"}`, status: 400, code: httpjson.CodeValidationError},
		{name: "body cap", body: `{"full_name":"` + strings.Repeat("a", 1_048_576) + `"}`, status: 413, code: httpjson.CodePayloadTooLarge},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			hits := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hits++
				if r.Header.Get("Authorization") != "Bearer caller-access" {
					t.Error("caller access token not forwarded")
				}
				status := tc.upstreamStatus
				if status == 0 {
					status = 200
				}
				w.WriteHeader(status)
				_, _ = w.Write([]byte(tc.upstream))
			}))
			defer server.Close()
			s := &accountStore{createErr: tc.storeErr}
			if tc.existing != valueobjects.UnknownUserType {
				s.user = existingAccount(t, tc.existing)
			}
			old := s.user
			h := identityhttp.NewCandidateIdentityHandler(usecases.NewCandidateIdentity(s, userinfo.NewClient(server.URL, time.Second)))
			w := employerRequest(h, "subject", tc.body)
			if tc.code != "" {
				assertEnvelope(t, w, tc.status, tc.code)
			} else {
				assertMe(t, w, tc.status, s.user)
			}
			if tc.status == 201 {
				if s.users != 1 || s.audits != 1 || s.user.UserType != valueobjects.UserRecruiter || s.user.CognitoSub != "subject" || s.user.Email.Value() != "verified@example.com" || s.user.ID == uuid.Nil {
					t.Fatal("wrong creation effects")
				}
				if tc.name == "create" && s.user.FullName.Value() != "Laura Gómez" {
					t.Fatal("name not normalized")
				}
			} else if s.users != 0 || s.audits != 0 || s.user != old {
				t.Fatal("rejection/retry wrote")
			}
			if (tc.status == 400 || tc.status == 413 || tc.existing != valueobjects.UnknownUserType) && hits != 0 {
				t.Fatal("invalid input/existing account called provider")
			}
		})
	}
}

func TestEmployerIdentityUnavailableAndUnauthenticated(t *testing.T) {
	s := &accountStore{}
	h := identityhttp.NewCandidateIdentityHandler(usecases.NewCandidateIdentity(s, nil))
	assertEnvelope(t, employerRequest(h, "subject", `{"full_name":"Laura"}`), 503, httpjson.CodeIdentityUnavailable)
	w := employerRequest(h, "", `{"full_name":"Laura"}`)
	if w.Code != 401 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("empty subject: %d %v", w.Code, w.Header())
	}
	if s.attempts != 0 {
		t.Fatal("unconfigured provider or empty subject wrote")
	}
}

// The candidate endpoint is symmetric: a live recruiter is account_exists.
func TestCandidateOnboardingRejectsRecruiterAfterGeneralization(t *testing.T) {
	s := &accountStore{user: existingAccount(t, valueobjects.UserRecruiter)}
	h := identityhttp.NewCandidateIdentityHandler(usecases.NewCandidateIdentity(s, nil))
	assertEnvelope(t, identityRequest(h, "POST", `{"full_name":"Ana"}`), 409, httpjson.CodeAccountExists)
}
