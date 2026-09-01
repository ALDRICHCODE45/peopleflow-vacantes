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
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
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

func (s *stubMemberRepo) ListByCompanyID(_ context.Context, _ uuid.UUID) ([]entities.MemberListRow, error) {
	return nil, errors.New("stubMemberRepo.ListByCompanyID: not used by middleware tests")
}

func (s *stubMemberRepo) UpdateRole(_ context.Context, _, _ uuid.UUID, _ valueobjects.MemberRole) error {
	return errors.New("stubMemberRepo.UpdateRole: not used by middleware tests")
}

func (s *stubMemberRepo) Remove(_ context.Context, _, _ uuid.UUID) error {
	return errors.New("stubMemberRepo.Remove: not used by middleware tests")
}

// stubLivenessRepo is the in-memory companies CompanyLivenessRepository
// for the middleware tests. It is intentionally a SEPARATE stub (not a
// method on stubMemberRepo) so the tests can independently drive
// "live", "tombstoned", "missing", and "repo failure" without dragging
// the membership stub through four scenarios. Only IsCompanyLive is
// used; the surface is the full interface so the compile-time guard
// catches future port drift.
type stubLivenessRepo struct {
	mu sync.Mutex

	live      bool
	liveErr   error
	liveCalls int
}

func (s *stubLivenessRepo) IsCompanyLive(_ context.Context, _ uuid.UUID) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.liveCalls++
	return s.live, s.liveErr
}

// Compile-time guards: the fakes satisfy the exact port surfaces the
// middleware depends on. Future renames break the build at the fake,
// not at the production site.
var (
	_ identityrepositories.UserRepository    = (*stubUserRepo)(nil)
	_ repositories.CompanyMemberRepository   = (*stubMemberRepo)(nil)
_ repositories.CompanyLivenessRepository = (*stubLivenessRepo)(nil)
)

// --- helpers --------------------------------------------------------------

// buildMiddleware wires RequireCompanyRole around a recorder so we can
// prove the middleware either invokes the downstream handler or rejects
// the request before it reaches one. The recorder function returns
// whatever the handler wants the test to observe.
//
// The liveness port is a required argument (RequireCompanyRole runs the
// liveness gate after membership resolution). Default scenarios use a
// `{live: true}` stub so the gate is a no-op; the new tombstone /
// missing / repo-failure tests drive the stub directly.
func buildMiddleware(
	users *stubUserRepo,
	members *stubMemberRepo,
	liveness *stubLivenessRepo,
	minRole valueobjects.MemberRole,
	recorder func(w http.ResponseWriter, r *http.Request, seenCompanyID uuid.UUID, seenRole valueobjects.MemberRole),
) http.Handler {
	return RequireCompanyRole(users, members, liveness, minRole)(
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
	liveness := &stubLivenessRepo{live: true} // default: live company; liveness tests override below

	invoked := false
	h := buildMiddleware(users, members, liveness, valueobjects.RecruiterRole,
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
	liveness := &stubLivenessRepo{live: true}

	invoked := false
	h := RequireCompanyRole(users, members, liveness, valueobjects.OwnerRole)(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
	)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodPost, "/me/company/members", "sub-recruiter"))

	assertCatalogEnvelope(t, rec, httpjson.CodeForbidden, http.StatusForbidden)
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	// Insufficient role: exact safe distinct message.
	if env.Error != "insufficient role" {
		t.Errorf("error field: want %q, got %q", "insufficient role", env.Error)
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
// The safe message MUST be distinct from "insufficient role" (both 403).
func TestRequireCompanyRole_NonMemberIsForbidden(t *testing.T) {
	userID := uuid.New()

	users := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-stranger"}}
	members := &stubMemberRepo{resolveErr: entities.ErrNotAMember}
	liveness := &stubLivenessRepo{live: true}

	invoked := false
	h := RequireCompanyRole(users, members, liveness, valueobjects.OwnerRole)(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
	)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodGet, "/me/company/members", "sub-stranger"))

	assertCatalogEnvelope(t, rec, httpjson.CodeForbidden, http.StatusForbidden)
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	// Non-member: exact safe distinct message, different from "insufficient role".
	if env.Error != "not a member of any company" {
		t.Errorf("error field: want %q, got %q", "not a member of any company", env.Error)
	}
	// Explicitly prove the two 403 messages differ.
	safeMsgInsufficient := "insufficient role"
	safeMsgNonMember := "not a member of any company"
	if safeMsgInsufficient == safeMsgNonMember {
		t.Errorf("distinctness: forbidden safe messages must differ; got same value %q", safeMsgInsufficient)
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
	liveness := &stubLivenessRepo{live: true}

	invoked := false
	h := RequireCompanyRole(users, members, liveness, valueobjects.OwnerRole)(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
	)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodGet, "/me/company/members", "sub-missing"))

	assertCatalogEnvelope(t, rec, httpjson.CodeUnauthenticated, http.StatusUnauthorized)
	if invoked {
		t.Error("handler invoked despite unknown sub")
	}
	if members.resolveCalls != 0 {
		t.Errorf("middleware should NOT touch the membership table for an unknown sub; got %d calls", members.resolveCalls)
	}
}

// --- triangulation companions --------------------------------------------

// TestRequireCompanyRole_InjectsUserID pins D8: RequireCompanyRole carries
// the resolved users.id into CompanyContext.UserID so the transition use
// case can record the acting recruiter as the audit event actor. The
// injection must happen on the same success path that injects CompanyID/Role.
func TestRequireCompanyRole_InjectsUserID(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()
	member := &entities.CompanyMember{
		ID:        uuid.New(),
		UserID:    userID,
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	}
	users := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-recruiter"}}
	members := &stubMemberRepo{resolvedMember: member}
	liveness := &stubLivenessRepo{live: true}

	var gotUserID uuid.UUID
	invoked := false
	h := RequireCompanyRole(users, members, liveness, valueobjects.RecruiterRole)(
		http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			invoked = true
			cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
			if !ok {
				t.Fatal("CompanyContext not injected")
			}
			gotUserID = cc.UserID
		}),
	)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodGet, "/jobs/x/applications/y/transition", "sub-recruiter"))

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !invoked {
		t.Fatal("handler not invoked")
	}
	if gotUserID != userID {
		t.Errorf("CompanyContext.UserID: want %v (the resolved users.id), got %v", userID, gotUserID)
	}
}

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
	liveness := &stubLivenessRepo{live: true}

	invoked := false
	h := RequireCompanyRole(users, members, liveness, valueobjects.OwnerRole)(
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
	liveness := &stubLivenessRepo{live: true}

	invoked := false
	h := RequireCompanyRole(users, members, liveness, valueobjects.RecruiterRole)(
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
	liveness := &stubLivenessRepo{live: true}

	invoked := false
	h := RequireCompanyRole(users, members, liveness, valueobjects.OwnerRole)(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
	)

	// Note: no Claims injected — simulates a misconfigured middleware
	// chain where RequireAuth was skipped.
	req := httptest.NewRequest(http.MethodGet, "/me/company/members", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assertCatalogEnvelope(t, rec, httpjson.CodeUnauthenticated, http.StatusUnauthorized)
	if invoked {
		t.Error("handler invoked despite missing claims")
	}
	if users.getCalls != 0 {
		t.Errorf("middleware must NOT call UserRepo with no Claims; got %d calls", users.getCalls)
	}
}

// --- 5. RequireCompanyRole liveness gate (require-company-role-tombstone-gate slice) ---
//
// The four scenarios below pin the dispatch contract of the liveness
// gate added in this slice:
//
//   - A soft-deleted company (deleted_at IS NOT NULL) MUST fail with
//     403 reason "company is inactive" and MUST NOT invoke the handler.
//   - A missing company (no such id; ErrCompanyNotFound) MUST fail with
//     the SAME 403 + reason — the gate MUST NOT leak which one it saw.
//   - An unexpected liveness error MUST fail with 500 (logged internally)
//     and MUST NOT invoke the handler.
//   - The happy path (live company, role >= minRole) MUST still pass
//     AND MUST hit the liveness probe exactly once — a guard against a
//     future refactor that doubles the probe or accidentally drops it.

// TestRequireCompanyRole_TombstonedCompanyIsForbidden covers the
// liveness gate failing closed on a soft-deleted company: the stub
// reports (false, nil) (the postgres IsCompanyLive signature for a row
// where deleted_at IS NOT NULL). The middleware MUST short-circuit to
// 403 with reason "company is inactive" and MUST NOT invoke the
// handler. The liveness probe MUST be called exactly once (no second
// probe after a future refactor accidentally doubles the call).
func TestRequireCompanyRole_TombstonedCompanyIsForbidden(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()
	member := &entities.CompanyMember{
		ID:        uuid.New(),
		UserID:    userID,
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole, // would otherwise pass
	}
	users := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-tombstoned"}}
	members := &stubMemberRepo{resolvedMember: member}
	liveness := &stubLivenessRepo{live: false} // soft-deleted company

	invoked := false
	h := RequireCompanyRole(users, members, liveness, valueobjects.OwnerRole)(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
	)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodPost, "/me/company/members", "sub-tombstoned"))

	assertCatalogEnvelope(t, rec, httpjson.CodeCompanyInactive, http.StatusForbidden)
	if invoked {
		t.Error("handler invoked despite tombstoned company")
	}
	if liveness.liveCalls != 1 {
		t.Errorf("liveness probe calls: want 1, got %d", liveness.liveCalls)
	}
}

// TestRequireCompanyRole_MissingCompanyIsForbidden covers the liveness
// gate failing closed on a company that has no row at all: the stub
// reports (false, entities.ErrCompanyNotFound) — the postgres adapter's
// pgx.ErrNoRows mapping. The middleware MUST collapse this to the SAME
// 403 + reason as the tombstone case (the gate cannot reveal which one
// it saw), and MUST NOT invoke the handler.
func TestRequireCompanyRole_MissingCompanyIsForbidden(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()
	member := &entities.CompanyMember{
		ID:        uuid.New(),
		UserID:    userID,
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole, // would otherwise pass
	}
	users := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-missing-co"}}
	members := &stubMemberRepo{resolvedMember: member}
	liveness := &stubLivenessRepo{live: false, liveErr: entities.ErrCompanyNotFound}

	invoked := false
	h := RequireCompanyRole(users, members, liveness, valueobjects.OwnerRole)(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
	)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodPost, "/me/company/members", "sub-missing-co"))

	// Tombstone vs missing MUST be indistinguishable.
	assertCatalogEnvelope(t, rec, httpjson.CodeCompanyInactive, http.StatusForbidden)
	if invoked {
		t.Error("handler invoked despite missing company")
	}
	if liveness.liveCalls != 1 {
		t.Errorf("liveness probe calls: want 1, got %d", liveness.liveCalls)
	}
}

// TestRequireCompanyRole_LivenessLookupErrorIsInternalError covers the
// unexpected-error branch: any error that is NOT entities.ErrCompanyNotFound
// is treated as a 500 (logged via slog, generic body to the client).
// The handler MUST NOT be invoked.
func TestRequireCompanyRole_LivenessLookupErrorIsInternalError(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()
	member := &entities.CompanyMember{
		ID:        uuid.New(),
		UserID:    userID,
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	}
	users := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-live-err"}}
	members := &stubMemberRepo{resolvedMember: member}
	liveness := &stubLivenessRepo{live: false, liveErr: errors.New("boom: connection reset")}

	invoked := false
	h := RequireCompanyRole(users, members, liveness, valueobjects.OwnerRole)(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
	)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodGet, "/me/company/members", "sub-live-err"))

	assertCatalogEnvelope(t, rec, httpjson.CodeInternalError, http.StatusInternalServerError)
	if invoked {
		t.Error("handler invoked despite liveness lookup error")
	}
	if liveness.liveCalls != 1 {
		t.Errorf("liveness probe calls: want 1, got %d", liveness.liveCalls)
	}
}

// TestRequireCompanyRole_LivenessProbeCalledOnce is the call-assertion
// companion to the live happy path: a live company under a passing role
// gate MUST hit the liveness probe exactly once. The trip-assertion (no
// double probe, no missed probe) guards a future refactor that
// accidentally drops the call or duplicates it (e.g. once at the
// middleware top and once inside the role gate).
func TestRequireCompanyRole_LivenessProbeCalledOnce(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()
	member := &entities.CompanyMember{
		ID:        uuid.New(),
		UserID:    userID,
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	}
	users := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-live-once"}}
	members := &stubMemberRepo{resolvedMember: member}
	liveness := &stubLivenessRepo{live: true} // live company

	invoked := false
	h := RequireCompanyRole(users, members, liveness, valueobjects.OwnerRole)(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
	)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodGet, "/me/company/members", "sub-live-once"))

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !invoked {
		t.Fatal("handler must be invoked for live company + passing role")
	}
	if liveness.liveCalls != 1 {
		t.Errorf("liveness probe calls: want 1, got %d (must be hit exactly once)", liveness.liveCalls)
	}
}

// --- 6. unexpected-error branch (require-company-role-internal-error slice) ---
//
// The three scenarios below pin the contract of the unexpected-error branch
// for ALL THREE repository calls in RequireCompanyRole:
//
//   - User lookup unexpected error  → 500 + code:internal_error + canonical message
//   - Membership lookup unexpected error → 500 + code:internal_error + canonical message
//   - Liveness lookup unexpected error → 500 + code:internal_error + canonical message
//
// Each case asserts:
//   1. HTTP 500 and catalog code "internal_error".
//   2. Canonical message "an internal error occurred" is in the response body.
//   3. The injected detail is ABSENT from the response body (non-leak).
//   4. The injected detail IS PRESENT in the captured slog output (observability).
//   5. The downstream handler is NOT invoked.
//
// A compact table-driven structure reuses the same helper per branch.

// TestRequireCompanyRole_InternalErrors proves all three unexpected-error
// branches share the same 500 contract. Each row uses a private buffer-backed
// slog logger to capture the injected detail in the server log.
func TestRequireCompanyRole_InternalErrors(t *testing.T) {
	const canonicalMsg = "an internal error occurred"

	tests := []struct {
		name           string
		userResolveErr error // nil → user lookup succeeds; non-nil → returned
		memberErr      error // nil → membership succeeds; non-nil → returned
		live           bool
		liveErr        error
		injected       string // token that should appear in the log but NOT in the wire
	}{
		{name: "user lookup unexpected error", userResolveErr: errors.New("boom: user repo failed"), injected: "boom: user repo failed"},
		{name: "membership lookup unexpected error", userResolveErr: nil, memberErr: errors.New("boom: membership lookup failed"), injected: "boom: membership lookup failed"},
		{name: "liveness lookup unexpected error", userResolveErr: nil, memberErr: nil, live: true, liveErr: errors.New("boom: liveness check failed"), injected: "boom: liveness check failed"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userID := uuid.New()
			companyID := uuid.New()

			users := &stubUserRepo{
				resolved:   &identityentities.User{ID: userID, CognitoSub: "sub-internal-err"},
				resolveErr: tt.userResolveErr,
		}

			var resolvedMember *entities.CompanyMember
			if tt.memberErr == nil {
				resolvedMember = &entities.CompanyMember{ID: uuid.New(), UserID: userID, CompanyID: companyID, Role: valueobjects.OwnerRole}
			}
			members := &stubMemberRepo{resolvedMember: resolvedMember, resolveErr: tt.memberErr}
			liveness := &stubLivenessRepo{live: tt.live, liveErr: tt.liveErr}

			// Capture slog output: redirect the global logger to a private buffer.
			var logBuf bytes.Buffer
			prev := slog.Default().Handler()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&logBuf, nil)))
			t.Cleanup(func() { slog.SetDefault(slog.New(prev)) })

			invoked := false
			h := RequireCompanyRole(users, members, liveness, valueobjects.OwnerRole)(
				http.HandlerFunc(func(http.ResponseWriter, *http.Request) { invoked = true }),
			)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, reqWithSub(http.MethodGet, "/me/company/members", "sub-internal-err"))

			// 1. HTTP 500 + catalog code "internal_error".
			assertCatalogEnvelope(t, rec, httpjson.CodeInternalError, http.StatusInternalServerError)

			// 2. Exact canonical message "an internal error occurred" in body.
			body := rec.Body.String()
			var env httpjson.ErrorEnvelope
			if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
				t.Fatalf("decode catalog envelope: %v", err)
			}
			if env.Error != canonicalMsg {
				t.Errorf("error: want %q, got %q", canonicalMsg, env.Error)
			}

			// 3. Injected detail ABSENT from wire.
			if strings.Contains(body, tt.injected) {
				t.Errorf("body must NOT contain injected detail %q; got: %s", tt.injected, body)
			}

			// 4. Injected detail PRESENT in captured server log.
			// t.Logf exposes slog output in test results without a custom handler.
			logOutput := logBuf.String()
			t.Logf("server log capture: %s", logOutput)
			if !strings.Contains(logOutput, tt.injected) {
				t.Errorf("injected detail %q must appear in server log; got: %s", tt.injected, logOutput)
			}

			// 5. Downstream handler NOT invoked.
			if invoked {
				t.Error("handler invoked despite internal error")
			}
		})
	}
}
