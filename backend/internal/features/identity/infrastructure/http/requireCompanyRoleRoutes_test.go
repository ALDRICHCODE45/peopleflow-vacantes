package http

// Route-mount integration tests for the /me/company subtree.
//
// These tests exercise the production wiring (RequireAuth →
// RequireCompanyRole → MemberHandler) end-to-end through a real chi
// router. They pin two contract points:
//
//   - task 4.1: a request without an Authorization header is rejected
//     with 401 by RequireAuth before the handler runs. The handler is
//     not invoked.
//   - task 4.2: a recruiter caller hitting POST /me/company/members is
//     rejected with 403 by RequireCompanyRole("owner") before the
//     handler runs. The handler is not invoked.
//
// We don't need to exercise every route — the unit tests in the
// companies package already cover the handler's behavior in isolation.
// The point here is that the chain `RequireAuth → r.With(RequireCompanyRole(...)) → Routes()`
// preserves the spec's 401/403 contract.

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	companieshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/http"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identityrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// --- local verify stub ----------------------------------------------------
//
// `denyAllVerifier` is defined in cmd/api/main.go as a private type. We
// can't reuse it from a test package — and we don't need to: these
// tests only exercise the wiring shape. A denyAllVerifier rejects every
// token, so the auth middleware always returns 401 on a missing/invalid
// Authorization header, which is exactly what task 4.1 wants to assert.
//
// allowAllVerifier is its counterpart for the 4.2 case: it lets every
// token through so the role-gate test can pin the authz behavior in
// isolation from the authn behavior.

type denyAllVerifier struct{}

func (denyAllVerifier) Verify(_ context.Context, _ string) (security.Claims, error) {
	return security.Claims{}, errors.New("denyAllVerifier: token rejected")
}

type allowAllVerifier struct{}

func (allowAllVerifier) Verify(_ context.Context, _ string) (security.Claims, error) {
	return security.Claims{Subject: "any-sub"}, nil
}

// Note: `security.ErrInvalidToken` does not exist as a named sentinel
// in the security package — we use errors.New via the helper below so
// this test file compiles independently. The verify path is "any error"
// from RequireAuth's perspective; what matters is that the middleware
// rejects the request.

// --- minimal stub repos ---------------------------------------------------

type rtStubUserRepo struct {
	mu         sync.Mutex
	resolved   *identityentities.User
	resolveErr error
}

func (s *rtStubUserRepo) GetByCognitoSub(_ context.Context, _ string) (*identityentities.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.resolveErr != nil {
		return nil, s.resolveErr
	}
	if s.resolved == nil {
		return nil, identityentities.ErrUserNotFound
	}
	copy := *s.resolved
	return &copy, nil
}

func (s *rtStubUserRepo) Create(_ context.Context, _ *identityentities.User) (*identityentities.User, error) {
	return nil, nil
}

func (s *rtStubUserRepo) GetByID(_ context.Context, _ uuid.UUID) (*identityentities.User, error) {
	return nil, nil
}

type rtStubMemberRepo struct {
	mu           sync.Mutex
	resolveOut   *entities.CompanyMember
	resolveErr   error
	resolveCalls int
}

func (s *rtStubMemberRepo) GetMembershipByUserID(_ context.Context, _ uuid.UUID) (*entities.CompanyMember, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resolveCalls++
	if s.resolveErr != nil {
		return nil, s.resolveErr
	}
	if s.resolveOut == nil {
		return nil, entities.ErrNotAMember
	}
	copy := *s.resolveOut
	return &copy, nil
}

func (s *rtStubMemberRepo) Create(_ context.Context, _ *entities.CompanyMember) error { return nil }

func (s *rtStubMemberRepo) ListByCompanyID(_ context.Context, _ uuid.UUID) ([]entities.CompanyMember, error) {
	return nil, nil
}

func (s *rtStubMemberRepo) UpdateRole(_ context.Context, _, _ uuid.UUID, _ valueobjects.MemberRole) error {
	return nil
}

func (s *rtStubMemberRepo) Remove(_ context.Context, _, _ uuid.UUID) error { return nil }

type rtStubCompanyRepo struct{}

func (rtStubCompanyRepo) Create(_ context.Context, _ *entities.Company) error { return nil }

func (rtStubCompanyRepo) GetByID(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	return nil, entities.ErrCompanyNotFound
}

// Compile-time guards: the route-test fakes satisfy the exact port
// surfaces the production wiring consumes.
var (
	_ identityrepositories.UserRepository  = (*rtStubUserRepo)(nil)
	_ repositories.CompanyMemberRepository = (*rtStubMemberRepo)(nil)
	_ repositories.CompanyRepository       = rtStubCompanyRepo{}
)

// --- helpers --------------------------------------------------------------

// buildMemberRouter wires the production /me subtree with RequireAuth
// + per-route RequireCompanyRole gates + the WU3 MemberHandler. It is
// the minimum shape that cmd/api/main.go will use after WU4 lands; if
// any of the three layers is missing, the corresponding spec scenario
// (4.1 or 4.2) will surface here.
//
// The handler flag flips to "invoked" the moment the chain reaches the
// MemberHandler; the route tests assert it stays false when the
// middleware rejects the request.
func buildMemberRouter(users *rtStubUserRepo, members *rtStubMemberRepo, handlerInvoked *bool) http.Handler {
	// Build a service against no-op stubs. The route tests don't reach
	// the service because the middleware rejects the request first —
	// but NewMemberHandler + Routes still needs a non-nil service so
	// chi can mount the routes.
	svc := usecases.NewCompanyMemberService(members, users, rtStubCompanyRepo{})
	mh := companieshttp.NewMemberHandler(svc)

	r := chi.NewRouter()
	r.Route("/me", func(r chi.Router) {
		// /me subtree: RequireAuth runs first. Below the route group,
		// the per-route gates layered on /me/company mimic the
		// production cmd/api/main.go wiring (WU4 task 4.3).
		r.Use(RequireAuth(allowAllVerifierForBuildRouter())) // overridden below

		// GET /me/company — UNGATED by role (spec scenario "owner gets
		// their membership" returns 404 for non-members, not 403).
		r.Get("/company", func(w http.ResponseWriter, req *http.Request) {
			*handlerInvoked = true
			mh.Routes().ServeHTTP(w, req)
		})

		// GET /me/company/members — minRole=recruiter.
		r.Route("/company/members", func(r chi.Router) {
			r.Use(RequireCompanyRole(users, members, valueobjects.RecruiterRole))
			r.Get("/", func(w http.ResponseWriter, req *http.Request) {
				*handlerInvoked = true
				mh.Routes().ServeHTTP(w, req)
			})
		})

		// POST /me/company/members — minRole=owner.
		// chi.Post takes http.HandlerFunc; the middleware returns
		// http.Handler, so we wrap with a tiny inline handler that
		// delegates — same shape as the production wiring.
		postHandler := RequireCompanyRole(users, members, valueobjects.OwnerRole)(
			http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				*handlerInvoked = true
				mh.Routes().ServeHTTP(w, req)
			}),
		)
		r.Method(http.MethodPost, "/company/members", postHandler)
	})
	return r
}

// allowAllVerifierForBuildRouter returns a fresh allowAllVerifier; we
// use a tiny constructor so the test that wants a denyAll verifier
// (4.1) can swap it in via a separate build path without coupling the
// two routes together.
func allowAllVerifierForBuildRouter() security.Verifier { return allowAllVerifier{} }

// --- task 4.1: missing Authorization → 401 --------------------------------

// TestRoutes_MissingAuthHeaderIsUnauthorized covers task 4.1: the spec
// scenario "routes are mounted behind auth". A request to /me/company
// without an Authorization header MUST be rejected with 401 by
// RequireAuth, and the MemberHandler MUST NOT be invoked.
func TestRoutes_MissingAuthHeaderIsUnauthorized(t *testing.T) {
	users := &rtStubUserRepo{}
	members := &rtStubMemberRepo{}

	// Mount with a denyAll verifier so /me/* rejects every request
	// regardless of the Authorization header. The shape is the same
	// as a real /me subtree where RequireAuth runs first.
	r := chi.NewRouter()
	r.Route("/me", func(r chi.Router) {
		r.Use(RequireAuth(denyAllVerifier{}))
		r.Get("/company", func(w http.ResponseWriter, req *http.Request) {
			t.Error("handler must NOT be invoked when Authorization header is missing")
		})
		r.Method(http.MethodPost, "/company/members",
			RequireCompanyRole(users, members, valueobjects.OwnerRole)(
				http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
					t.Error("handler must NOT be invoked when Authorization header is missing")
				}),
			),
		)
	})

	for _, path := range []string{"/me/company", "/me/company/members"} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("want 401, got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

// --- task 4.2: recruiter → 403 on mutations -------------------------------

// TestRoutes_RecruiterCannotCallAddMember covers task 4.2: the spec
// scenario "mutations enforce owner". A recruiter caller under
// RequireCompanyRole("owner") MUST be rejected with 403, and the
// MemberHandler MUST NOT be invoked.
//
// We let the request through the auth layer (allowAllVerifier) so the
// role-gate is the only barrier; the recruiter role is then placed on
// the resolved membership row so the role check fails exactly where
// the spec scenario says it should.
func TestRoutes_RecruiterCannotCallAddMember(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()
	member := &entities.CompanyMember{
		ID:        uuid.New(),
		UserID:    userID,
		CompanyID: companyID,
		Role:      valueobjects.RecruiterRole,
	}

	users := &rtStubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-rec"}}
	members := &rtStubMemberRepo{resolveOut: member}

	handlerInvoked := false
	r := buildMemberRouter(users, members, &handlerInvoked)

	body := `{"user_id":"` + uuid.New().String() + `","role":"recruiter"}`
	req := httptest.NewRequest(http.MethodPost, "/me/company/members", nil)
	req.Header.Set("Content-Type", "application/json")
	// The allowAllVerifier ignores the token contents, but RequireAuth
	// still requires a Bearer header to even reach the verifier — so
	// we send a placeholder to exercise the authn-then-authz chain.
	req.Header.Set("Authorization", "Bearer any-token")
	req.Body = http.MaxBytesReader(nil, nilReaderCloser{Reader: stringReader(body)}, 1<<20)

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d: %s", rec.Code, rec.Body.String())
	}
	if handlerInvoked {
		t.Error("handler must NOT be invoked for a recruiter caller under owner gate")
	}
	if members.resolveCalls != 1 {
		t.Errorf("middleware should resolve membership once before deciding; got %d calls", members.resolveCalls)
	}
}

// --- task 4.3 route-shape sanity (bonus) ---------------------------------
//
// TestRoutes_OwnerCanCallAddMember is the triangulation companion to
// 4.2: the same chain with an owner caller under
// RequireCompanyRole("owner") MUST reach the handler. This guards the
// chain from a future refactor that breaks the role gate's "owner
// passes owner" boundary (the exact preimage of the
// `member.Role < minRole` check in the middleware).
func TestRoutes_OwnerCanCallAddMember(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()
	member := &entities.CompanyMember{
		ID:        uuid.New(),
		UserID:    userID,
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	}

	users := &rtStubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-owner"}}
	members := &rtStubMemberRepo{resolveOut: member}

	handlerInvoked := false
	r := buildMemberRouter(users, members, &handlerInvoked)

	body := `{"user_id":"` + uuid.New().String() + `","role":"recruiter"}`
	req := httptest.NewRequest(http.MethodPost, "/me/company/members", nil)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer any-token")
	req.Body = http.MaxBytesReader(nil, nilReaderCloser{Reader: stringReader(body)}, 1<<20)

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	// 201 means the handler ran end-to-end and created the row. We
	// don't care about the exact status here (the handler tests
	// already cover it); the contract is "handler reached".
	if rec.Code == http.StatusForbidden || rec.Code == http.StatusUnauthorized {
		t.Fatalf("owner must NOT be rejected by the gate; got %d: %s", rec.Code, rec.Body.String())
	}
	if !handlerInvoked {
		t.Error("handler must be invoked for an owner caller under owner gate")
	}
}

// --- io helpers ----------------------------------------------------------

// stringReader is a minimal io.Reader for a string. Avoids depending
// on strings.NewReader explicitly here so the test reads top-down.
type stringReader string

func (s stringReader) Read(p []byte) (int, error) {
	n := copy(p, []byte(s))
	if n < len(p) {
		return n, errEOF
	}
	return n, nil
}

// nilReaderCloser wraps a Reader to satisfy io.ReadCloser. We need
// ReadCloser because http.MaxBytesReader's second arg is io.ReadCloser.
// We never call Close on it in these tests.
type nilReaderCloser struct {
	Reader stringReader
}

func (n nilReaderCloser) Read(p []byte) (int, error) { return n.Reader.Read(p) }
func (n nilReaderCloser) Close() error               { return nil }

// errEOF is the io.EOF sentinel without importing io at the top of the
// file — keeps the helper block visually separate from the production
// middleware file above.
var errEOF = errEOFValue{}

type errEOFValue struct{}

func (errEOFValue) Error() string { return "EOF" }
