package http_test

import (
	"context"
	"encoding/json"
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

type accountStore struct {
	user                    *entities.User
	createErr               error
	users, audits, attempts int
}

func (s *accountStore) GetByCognitoSub(context.Context, string) (*entities.User, error) {
	if s.user == nil {
		return nil, entities.ErrUserNotFound
	}
	return s.user, nil
}
func (s *accountStore) CreateCandidate(_ context.Context, u *entities.User) (*entities.User, bool, error) {
	s.attempts++
	if s.createErr != nil {
		return nil, false, s.createErr
	}
	s.user = u
	s.users++
	s.audits++
	return u, true, nil
}

func existingAccount(t *testing.T, role valueobjects.UserType) *entities.User {
	t.Helper()
	email, _ := valueobjects.NewEmail("existing@example.com")
	name, _ := valueobjects.NewFullName("Original Name")
	u, err := entities.NewUser("subject", email, name, role)
	if err != nil {
		t.Fatal(err)
	}
	return u
}
func identityRequest(h *identityhttp.CandidateIdentityHandler, method, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/", strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer caller-access")
	r = r.WithContext(security.ContextWithClaims(r.Context(), security.Claims{Subject: "subject", Groups: []string{"recruiters", "company_admins"}}))
	w := httptest.NewRecorder()
	if method == "GET" {
		h.Me(w, r)
	} else {
		h.CreateCandidateAccount(w, r)
	}
	return w
}
func assertEnvelope(t *testing.T, w *httptest.ResponseRecorder, status int, code httpjson.Code) {
	t.Helper()
	want, _ := json.Marshal(httpjson.ErrorEnvelope{Error: httpjson.Resolve(code).Message, Code: code})
	if w.Code != status || strings.TrimSpace(w.Body.String()) != string(want) {
		t.Fatalf("got %d %s; want %d %s", w.Code, w.Body.String(), status, want)
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("missing no-store")
	}
}
func assertMe(t *testing.T, w *httptest.ResponseRecorder, status int, u *entities.User) {
	t.Helper()
	var want string
	if u == nil {
		want = `{"role":null,"user":null}`
	} else {
		b, _ := json.Marshal(map[string]any{"role": u.UserType.String(), "user": map[string]string{"id": u.ID.String(), "email": u.Email.Value(), "full_name": u.FullName.Value()}})
		want = string(b)
	}
	var got, expected any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal([]byte(want), &expected)
	a, _ := json.Marshal(got)
	b, _ := json.Marshal(expected)
	if w.Code != status || string(a) != string(b) {
		t.Fatalf("got %d %s want %d %s", w.Code, a, status, b)
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("missing no-store")
	}
}

// §11.2 roles come only from live DB users, regardless of groups.
func TestCandidateIdentityMe(t *testing.T) {
	for _, role := range []valueobjects.UserType{valueobjects.UnknownUserType, valueobjects.UserCandidate, valueobjects.UserRecruiter} {
		t.Run(role.String(), func(t *testing.T) {
			s := &accountStore{}
			if role != valueobjects.UnknownUserType {
				s.user = existingAccount(t, role)
			}
			h := identityhttp.NewCandidateIdentityHandler(usecases.NewCandidateIdentity(s, nil))
			assertMe(t, identityRequest(h, "GET", ""), 200, s.user)
			if s.attempts != 0 {
				t.Fatal("GET wrote")
			}
		})
	}
}

// §11.2–11.3: strict input, trusted UserInfo, exact responses and no writes on rejection/retry.
func TestCandidateIdentityOnboarding(t *testing.T) {
	const verified = `{"sub":"subject","email":"VERIFIED@example.com","email_verified":true}`
	tests := []struct {
		name, body, upstream   string
		upstreamStatus, status int
		code                   httpjson.Code
		existing               valueobjects.UserType
		storeErr               error
	}{
		{name: "create", body: `{"full_name":"  Ana Pérez  "}`, upstream: verified, status: 201},
		{name: "unicode minimum", body: `{"full_name":"界界"}`, upstream: verified, status: 201},
		{name: "verified string", body: `{"full_name":"Ana"}`, upstream: `{"sub":"subject","email":"VERIFIED@example.com","email_verified":"true"}`, status: 201},
		{name: "unicode maximum", body: `{"full_name":"` + strings.Repeat("界", 120) + `"}`, upstream: verified, status: 201},
		{name: "candidate retry", body: `{"full_name":"Different Name"}`, existing: valueobjects.UserCandidate, status: 200},
		{name: "recruiter", body: `{"full_name":"Ana"}`, existing: valueobjects.UserRecruiter, status: 409, code: httpjson.CodeAccountExists},
		{name: "email collision", body: `{"full_name":"Ana"}`, upstream: verified, storeErr: entities.ErrEmailTaken, status: 409, code: httpjson.CodeEmailInUse},
		{name: "unverified string", body: `{"full_name":"Ana"}`, upstream: `{"sub":"subject","email":"a@example.com","email_verified":"false"}`, status: 422, code: httpjson.CodeEmailNotVerified},
		{name: "unverified", body: `{"full_name":"Ana"}`, upstream: `{"sub":"subject","email":"a@example.com","email_verified":false}`, status: 422, code: httpjson.CodeEmailNotVerified},
		{name: "subject mismatch", body: `{"full_name":"Ana"}`, upstream: `{"sub":"other","email":"a@example.com","email_verified":true}`, status: 422, code: httpjson.CodeEmailNotVerified},
		{name: "provider down", body: `{"full_name":"Ana"}`, upstreamStatus: 500, status: 503, code: httpjson.CodeIdentityUnavailable},
		{name: "malformed provider", body: `{"full_name":"Ana"}`, upstream: `{`, status: 503, code: httpjson.CodeIdentityUnavailable},
		{name: "missing verification", body: `{"full_name":"Ana"}`, upstream: `{"sub":"subject","email":"a@example.com"}`, status: 503, code: httpjson.CodeIdentityUnavailable},
		{name: "invalid verification type", body: `{"full_name":"Ana"}`, upstream: `{"sub":"subject","email":"a@example.com","email_verified":1}`, status: 503, code: httpjson.CodeIdentityUnavailable},
		{name: "invalid email", body: `{"full_name":"Ana"}`, upstream: `{"sub":"subject","email":"invalid","email_verified":true}`, status: 503, code: httpjson.CodeIdentityUnavailable},
		{name: "duplicate provider claim", body: `{"full_name":"Ana"}`, upstream: `{"sub":"other","\u0073ub":"subject","email":"a@example.com","email_verified":true}`, status: 503, code: httpjson.CodeIdentityUnavailable},
		{name: "unknown", body: `{"full_name":"Ana","email":"injected@example.com"}`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "duplicate", body: `{"full_name":"Ana","full_name":"Other"}`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "escaped duplicate", body: `{"full_name":"Ana","full_\u006eame":"Other"}`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "case alias", body: `{"Full_Name":"Ana"}`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "trailing json", body: `{"full_name":"Ana"}{}`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "non object", body: `[]`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "wrong type", body: `{"full_name":1}`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "null body", body: `null`, status: 400, code: httpjson.CodeInvalidRequest},
		{name: "missing name", body: `{}`, status: 400, code: httpjson.CodeValidationError},
		{name: "blank name", body: `{"full_name":"  "}`, status: 400, code: httpjson.CodeValidationError},
		{name: "body cap", body: `{"full_name":"` + strings.Repeat("a", 1_048_576) + `"}`, status: 413, code: httpjson.CodePayloadTooLarge},
		{name: "null name", body: `{"full_name":null}`, status: 400, code: httpjson.CodeValidationError},
		{name: "one code point", body: `{"full_name":" 界 "}`, status: 400, code: httpjson.CodeValidationError},
		{name: "too long", body: `{"full_name":"` + strings.Repeat("界", 121) + `"}`, status: 400, code: httpjson.CodeValidationError},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			hits := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hits++
				if r.Header.Get("Authorization") != "Bearer caller-access" {
					t.Error("caller access token not forwarded")
				}
				if r.Method != "GET" {
					t.Error("not GET")
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
			w := identityRequest(h, "POST", tc.body)
			if tc.code != "" {
				assertEnvelope(t, w, tc.status, tc.code)
			} else {
				assertMe(t, w, tc.status, s.user)
			}
			if tc.status == 201 {
				if s.users != 1 || s.audits != 1 || s.user.UserType != valueobjects.UserCandidate || s.user.CognitoSub != "subject" || s.user.Email.Value() != "verified@example.com" || s.user.ID == uuid.Nil {
					t.Fatal("wrong creation effects")
				}
				if tc.name == "create" && s.user.FullName.Value() != "Ana Pérez" {
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

func TestCandidateIdentityUnavailableConfiguration(t *testing.T) {
	s := &accountStore{}
	h := identityhttp.NewCandidateIdentityHandler(usecases.NewCandidateIdentity(s, nil))
	assertEnvelope(t, identityRequest(h, "POST", `{"full_name":"Ana"}`), 503, httpjson.CodeIdentityUnavailable)
	if s.attempts != 0 {
		t.Fatal("unconfigured provider wrote")
	}
}

// §11.2: role gate admits only a live candidate, never token groups.
func TestRequireCandidateRole(t *testing.T) {
	for _, role := range []valueobjects.UserType{valueobjects.UnknownUserType, valueobjects.UserCandidate, valueobjects.UserRecruiter} {
		t.Run(role.String(), func(t *testing.T) {
			s := &gateUsers{accountStore: accountStore{}}
			if role != valueobjects.UnknownUserType {
				s.user = existingAccount(t, role)
			}
			called := false
			gate := identityhttp.RequireCandidateRole(s)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(204) }))
			r := httptest.NewRequest("GET", "/", nil)
			r = r.WithContext(security.ContextWithClaims(r.Context(), security.Claims{Subject: "subject", Groups: []string{"candidates", "company_admins"}}))
			w := httptest.NewRecorder()
			gate.ServeHTTP(w, r)
			if role == valueobjects.UserCandidate {
				if !called || w.Code != 204 {
					t.Fatal("candidate rejected")
				}
			} else {
				code := httpjson.CodeWrongRole
				if role == valueobjects.UnknownUserType {
					code = httpjson.CodeAccountRequired
				}
				assertEnvelope(t, w, 403, code)
				if called {
					t.Fatal("gate bypassed")
				}
			}
		})
	}
}

type gateUsers struct{ accountStore }

func (s *gateUsers) Create(context.Context, *entities.User) (*entities.User, error) {
	return nil, errors.New("unexpected write")
}
func (s *gateUsers) GetByID(context.Context, uuid.UUID) (*entities.User, error) {
	return nil, errors.New("unexpected lookup")
}
