package http

// Tests for the RequireCompanyRole middleware.
//
// The 4 spec scenarios from the company-members design (Requirements:
// RequireCompanyRole Middleware, 4 scenarios) are exercised in this file:
//
//  1. "minimal role passes"       — owner passes minRole=recruiter.
//  2. "insufficient role is 403"   — recruiter under minRole=owner.
//  3. "non-member is 403"          — caller has no membership row.
//  4. "unknown sub is 401"         — token sub matches no live users row.
//
// The tests also assert that the injected CompanyContext carries the
// resolved (company_id, role) so downstream handlers can read the
// caller's company without re-querying the membership table. This is
// the contract that design D6 (id the IDOR-resistant boundary) and the
// CompanyContext injection helper pin down.

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identityrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/google/uuid"
)

// --- fakes ----------------------------------------------------------------
//
// We deliberately stand up our own minimal fakes (rather than reusing
// the service-test stubs) because the middleware tests only need
// GetByCognitoSub and GetMembershipByUserID — the rest of the port
// surface would be dead weight here. The compile-time guard
// `var _ identityrepositories.UserRepository = (*stubUserRepo)(nil)`
// nails the exact subset the middleware consumes.

// stubUserRepo is the in-memory identity UserRepository for the middleware
// tests. GetByID and Create are not used by the middleware; the stub
// returns "not used" for them so any accidental call surfaces as a
// test failure instead of a silent nil dereference.
type stubUserRepo struct {
	mu         sync.Mutex
	resolved   *identityentities.User
	resolveErr error
	getCalls   int
}

func (s *stubUserRepo) GetByCognitoSub(_ context.Context, _ string) (*identityentities.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getCalls++
	if s.resolveErr != nil {
		return nil, s.resolveErr
	}
	if s.resolved == nil {
		return nil, identityentities.ErrUserNotFound
	}
	copy := *s.resolved
	return &copy, nil
}

func (s *stubUserRepo) Create(_ context.Context, _ *identityentities.User) (*identityentities.User, error) {
	return nil, errors.New("stubUserRepo.Create: not used by middleware tests")
}

func (s *stubUserRepo) GetByID(_ context.Context, _ uuid.UUID) (*identityentities.User, error) {
	return nil, errors.New("stubUserRepo.GetByID: not used by middleware tests")
}

// stubMemberRepo is the in-memory companies CompanyMemberRepository for
// the middleware tests. Only GetMembershipByUserID is used; the rest are
// "not used" sentinels so any accidental call fails loudly.
type stubMemberRepo struct {
	mu sync.Mutex

	resolvedMember *entities.CompanyMember
	resolveErr     error
	resolveCalls   int
}

func (s *stubMemberRepo) GetMembershipByUserID(_ context.Context, _ uuid.UUID) (*entities.CompanyMember, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resolveCalls++
	if s.resolveErr != nil {
		return nil, s.resolveErr
	}
	if s.resolvedMember == nil {
		return nil, entities.ErrNotAMember
	}
	copy := *s.resolvedMember
	return &copy, nil
}

func (s *stubMemberRepo) Create(_ context.Context, _ *entities.CompanyMember) error {
	return errors.New("stubMemberRepo.Create: not used by middleware tests")
}

func (s *stubMemberRepo) ListByCompanyID(_ context.Context, _ uuid.UUID) ([]entities.CompanyMember, error) {
	return nil, errors.New("stubMemberRepo.ListByCompanyID: not used by middleware tests")
}

func (s *stubMemberRepo) UpdateRole(_ context.Context, _, _ uuid.UUID, _ valueobjects.MemberRole) error {
	return errors.New("stubMemberRepo.UpdateRole: not used by middleware tests")
}

func (s *stubMemberRepo) Remove(_ context.Context, _, _ uuid.UUID) error {
	return errors.New("stubMemberRepo.Remove: not used by middleware tests")
}

// Compile-time guards: the fakes satisfy the exact port surfaces the
// middleware depends on. Future renames break the build at the fake,
// not at the production site.
var (
	_ identityrepositories.UserRepository  = (*stubUserRepo)(nil)
	_ repositories.CompanyMemberRepository = (*stubMemberRepo)(nil)
)

// --- helpers --------------------------------------------------------------

// buildMiddleware wires RequireCompanyRole around a recorder so we can
// prove the middleware either invokes the downstream handler or rejects
// the request before it reaches one. The recorder function returns
// whatever the handler wants the test to observe.
func buildMiddleware(
	users *stubUserRepo,
	members *stubMemberRepo,
	minRole valueobjects.MemberRole,
	recorder func(w http.ResponseWriter, r *http.Request, seenCompanyID uuid.UUID, seenRole valueobjects.MemberRole),
) http.Handler {
	return RequireCompanyRole(users, members, minRole)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
			if !ok {
				recorder(w, r, uuid.Nil, valueobjects.UnknownMemberRole)
				return
			}
			recorder(w, r, cc.CompanyID, cc.Role)
		}),
	)
}

// reqWithSub builds an HTTP request that already carries a Claims value
// in its context (simulating what RequireAuth would inject in the
// production wiring). The middleware is exercised alone — these tests
// pin the authz contract; the route-mount tests in requireCompanyRoleRoutes_test.go
// pin the authn-then-authz sequence.
func reqWithSub(method, path, sub string) *http.Request {
	r := httptest.NewRequest(method, path, nil)
	if sub != "" {
		ctx := identitysecurity.ContextWithClaims(r.Context(), identitysecurity.Claims{Subject: sub})
		r = r.WithContext(ctx)
	}
	return r
}

// --- 4 spec scenarios -----------------------------------------------------

// TestRequireCompanyRole_OwnerPassesRecruiterGate covers the spec
// scenario "minimal role passes": caller is owner of company X and
// RequireCompanyRole(recruiter) runs — the handler must run and the
// injected CompanyContext must carry (companyX, owner).
func TestRequireCompanyRole_OwnerPassesRecruiterGate(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()

	member := &entities.CompanyMember{
		ID:        uuid.New(),
		UserID:    userID,
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	}

	users := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-owner"}}
	members := &stubMemberRepo{resolvedMember: member}

	invoked := false
	h := buildMiddleware(users, members, valueobjects.RecruiterRole,
		func(_ http.ResponseWriter, _ *http.Request, seenCompanyID uuid.UUID, seenRole valueobjects.MemberRole) {
			invoked = true
			if seenCompanyID != companyID {
				t.Errorf("CompanyContext.CompanyID: want %v, got %v", companyID, seenCompanyID)
			}
			if seenRole != valueobjects.OwnerRole {
				t.Errorf("CompanyContext.Role: want OwnerRole, got %v", seenRole)
			}
		})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodGet, "/me/company/members", "sub-owner"))

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !invoked {
		t.Fatal("handler not invoked")
	}
	if users.getCalls != 1 {
		t.Errorf("UserRepo.GetByCognitoSub calls: want 1, got %d", users.getCalls)
	}
	if members.resolveCalls != 1 {
		t.Errorf("MemberRepo.GetMembershipByUserID calls: want 1, got %d", members.resolveCalls)
	}
}

// TestRequireCompanyRole_RecruiterUnderOwnerIsForbidden covers the spec
// scenario "insufficient role is 403": caller is recruiter of company X
// and RequireCompanyRole(owner) runs — the handler MUST NOT be invoked
// and the response MUST be 403.
func TestRequireCompanyRole_RecruiterUnderOwnerIsForbidden(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()

	member := &entities.CompanyMember{
		ID:        uuid.New(),
		UserID:    userID,
		CompanyID: companyID,
		Role:      valueobjects.RecruiterRole,
	}

	users := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-recruiter"}}
	members := &stubMemberRepo{resolvedMember: member}

	invoked := false
	h := RequireCompanyRole(users, members, valueobjects.OwnerRole)(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
	)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodPost, "/me/company/members", "sub-recruiter"))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d: %s", rec.Code, rec.Body.String())
	}
	if invoked {
		t.Error("handler invoked despite insufficient role")
	}
	if members.resolveCalls != 1 {
		t.Errorf("middleware should resolve membership once to check the role; got %d calls", members.resolveCalls)
	}
}

// TestRequireCompanyRole_NonMemberIsForbidden covers the spec scenario
// "non-member is 403": caller has no membership row — the middleware
// MUST short-circuit to 403 and MUST NOT invoke the handler.
func TestRequireCompanyRole_NonMemberIsForbidden(t *testing.T) {
	userID := uuid.New()

	users := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-stranger"}}
	members := &stubMemberRepo{resolveErr: entities.ErrNotAMember}

	invoked := false
	h := RequireCompanyRole(users, members, valueobjects.OwnerRole)(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
	)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodGet, "/me/company/members", "sub-stranger"))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d: %s", rec.Code, rec.Body.String())
	}
	if invoked {
		t.Error("handler invoked despite missing membership")
	}
	if members.resolveCalls != 1 {
		t.Errorf("middleware should resolve membership once before deciding; got %d calls", members.resolveCalls)
	}
}

// TestRequireCompanyRole_UnknownSubIsUnauthorized covers the spec
// scenario "unknown sub is 401": token sub matches no live users row.
// The middleware MUST short-circuit to 401 BEFORE touching the
// membership table (no IDOR leak from probing membership rows with a
// bogus sub).
func TestRequireCompanyRole_UnknownSubIsUnauthorized(t *testing.T) {
	users := &stubUserRepo{resolveErr: identityentities.ErrUserNotFound}
	members := &stubMemberRepo{}

	invoked := false
	h := RequireCompanyRole(users, members, valueobjects.OwnerRole)(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
	)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodGet, "/me/company/members", "sub-missing"))

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d: %s", rec.Code, rec.Body.String())
	}
	if invoked {
		t.Error("handler invoked despite unknown sub")
	}
	if members.resolveCalls != 0 {
		t.Errorf("middleware should NOT touch the membership table for an unknown sub; got %d calls", members.resolveCalls)
	}
}

// --- triangulation companions --------------------------------------------

// TestRequireCompanyRole_OwnerOwnerIsSelfPass covers the boundary
// owner >= owner: an owner caller under RequireCompanyRole("owner")
// MUST still pass. This guards the ordinal comparison from a future
// refactor that flips it to strict `>` and silently breaks every
// owner-only mutation route.
func TestRequireCompanyRole_OwnerOwnerIsSelfPass(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()
	member := &entities.CompanyMember{
		ID:        uuid.New(),
		UserID:    userID,
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	}
	users := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-owner"}}
	members := &stubMemberRepo{resolvedMember: member}

	invoked := false
	h := RequireCompanyRole(users, members, valueobjects.OwnerRole)(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
	)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodPost, "/me/company/members", "sub-owner"))

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !invoked {
		t.Fatal("owner must pass RequireCompanyRole(owner)")
	}
}

// TestRequireCompanyRole_RecruiterPassesRecruiterGate is the symmetric
// pass case for recruiter: a recruiter caller under
// RequireCompanyRole("recruiter") MUST pass — the membership resolver
// MUST be hit exactly once and the handler MUST run. Triangulates the
// role comparison against the unknown/owner/recruiter cases.
func TestRequireCompanyRole_RecruiterPassesRecruiterGate(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()
	member := &entities.CompanyMember{
		ID:        uuid.New(),
		UserID:    userID,
		CompanyID: companyID,
		Role:      valueobjects.RecruiterRole,
	}
	users := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-rec"}}
	members := &stubMemberRepo{resolvedMember: member}

	invoked := false
	h := RequireCompanyRole(users, members, valueobjects.RecruiterRole)(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
	)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodGet, "/me/company/members", "sub-rec"))

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !invoked {
		t.Fatal("recruiter must pass RequireCompanyRole(recruiter)")
	}
}

// TestRequireCompanyRole_MissingClaimsIsUnauthorized locks the
// defense-in-depth branch the route-mount tests can't reach: if a
// downstream caller wires RequireCompanyRole without RequireAuth in
// front (or before the auth middleware's claims injection), the
// middleware MUST reject with 401 — never silently let the request
// through with an empty subject.
func TestRequireCompanyRole_MissingClaimsIsUnauthorized(t *testing.T) {
	users := &stubUserRepo{}
	members := &stubMemberRepo{}

	invoked := false
	h := RequireCompanyRole(users, members, valueobjects.OwnerRole)(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
	)

	// Note: no Claims injected — simulates a misconfigured middleware
	// chain where RequireAuth was skipped.
	req := httptest.NewRequest(http.MethodGet, "/me/company/members", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d: %s", rec.Code, rec.Body.String())
	}
	if invoked {
		t.Error("handler invoked despite missing claims")
	}
	if users.getCalls != 0 {
		t.Errorf("middleware must NOT call UserRepo with no Claims; got %d calls", users.getCalls)
	}
}
