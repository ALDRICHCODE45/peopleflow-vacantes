package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// --- fakes -----------------------------------------------------------------
//
// The handler tests stand up the SAME shape of fakes as the company
// service tests (stubMemberRepository / stubUserRepository /
// stubMemberCompanyRepository) so the only thing under test here is the
// HTTP transport — the service composition is already covered in
// companyMemberService_test.go.

// stubMemberRepositoryForHandler is the in-memory CompanyMemberRepository
// the handler tests program with the desired response.
type stubMemberRepositoryForHandler struct {
	mu sync.Mutex

	getByUserOut   *entities.CompanyMember
	getByUserErr   error
	getByUserCalls int

	listOut           []entities.CompanyMember
	listErr           error
	listCalls         int
	lastListCompanyID uuid.UUID

	createErr   error
	createCalls int
	created     *entities.CompanyMember

	updateErr error
	removeErr error

	updateCalls         int
	lastUpdateCompanyID uuid.UUID

	removeCalls         int
	lastRemoveCompanyID uuid.UUID
}

func (s *stubMemberRepositoryForHandler) Create(_ context.Context, m *entities.CompanyMember) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.createCalls++
	if s.createErr != nil {
		return s.createErr
	}
	s.created = m
	return nil
}

func (s *stubMemberRepositoryForHandler) GetMembershipByUserID(_ context.Context, _ uuid.UUID) (*entities.CompanyMember, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getByUserCalls++
	if s.getByUserErr != nil {
		return nil, s.getByUserErr
	}
	if s.getByUserOut != nil {
		copy := *s.getByUserOut
		return &copy, nil
	}
	return nil, entities.ErrNotAMember
}

func (s *stubMemberRepositoryForHandler) ListByCompanyID(_ context.Context, companyID uuid.UUID) ([]entities.CompanyMember, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listCalls++
	s.lastListCompanyID = companyID
	if s.listErr != nil {
		return nil, s.listErr
	}
	if s.listOut == nil {
		return []entities.CompanyMember{}, nil
	}
	out := make([]entities.CompanyMember, len(s.listOut))
	copy(out, s.listOut)
	return out, nil
}

func (s *stubMemberRepositoryForHandler) UpdateRole(_ context.Context, _, companyID uuid.UUID, _ valueobjects.MemberRole) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.updateCalls++
	s.lastUpdateCompanyID = companyID
	return s.updateErr
}

func (s *stubMemberRepositoryForHandler) Remove(_ context.Context, _, companyID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.removeCalls++
	s.lastRemoveCompanyID = companyID
	return s.removeErr
}

type stubUserRepositoryForHandler struct {
	mu         sync.Mutex
	resolved   *identityentities.User
	resolveErr error
	getCalls   int
}

func (s *stubUserRepositoryForHandler) GetByCognitoSub(_ context.Context, _ string) (*identityentities.User, error) {
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

func (s *stubUserRepositoryForHandler) Create(_ context.Context, _ *identityentities.User) (*identityentities.User, error) {
	return nil, errors.New("not used by handler tests")
}

func (s *stubUserRepositoryForHandler) GetByID(_ context.Context, _ uuid.UUID) (*identityentities.User, error) {
	return nil, errors.New("not used by handler tests")
}

type stubMemberCompanyRepositoryForHandler struct {
	mu      sync.Mutex
	getByID *entities.Company
	getErr  error
}

func (s *stubMemberCompanyRepositoryForHandler) Create(_ context.Context, _ *entities.Company) error {
	return errors.New("not used by handler tests")
}

func (s *stubMemberCompanyRepositoryForHandler) GetByID(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.getErr != nil {
		return nil, s.getErr
	}
	if s.getByID != nil {
		copy := *s.getByID
		return &copy, nil
	}
	return nil, entities.ErrCompanyNotFound
}

// --- helpers ---------------------------------------------------------------

// newMemberHandlerService builds a CompanyMemberService wired against
// the three stubs the handler tests program.
func newMemberHandlerService(
	mRepo *stubMemberRepositoryForHandler,
	uRepo *stubUserRepositoryForHandler,
	cRepo *stubMemberCompanyRepositoryForHandler,
) *usecases.CompanyMemberService {
	return usecases.NewCompanyMemberService(mRepo, uRepo, cRepo)
}

// newMemberRouter mounts MemberHandler.Routes() at /me/company with a
// middleware that injects the supplied subject (Claims) AND/OR the
// supplied CompanyContext into the request context, so the handler reads
// whichever it needs via security.* helpers. The production wiring injects
// both (RequireAuth injects Claims, then RequireCompanyRole injects
// CompanyContext on the gated routes); this helper simulates both with
// one call.
//
// sub == "" and cc == identitysecurity.CompanyContext{} both skip their
// injection so each test can drive the exact combination it needs (the
// ungated getMyMembership path needs Claims; the gated path needs
// CompanyContext; the "missing CompanyContext is server error" path
// needs neither).
func newMemberRouter(t *testing.T, service *usecases.CompanyMemberService, sub string, cc identitysecurity.CompanyContext) http.Handler {
	t.Helper()
	h := NewMemberHandler(service)

	r := chi.NewRouter()
	if sub != "" || cc.CompanyID != uuid.Nil || cc.Role != valueobjects.UnknownMemberRole {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				ctx := req.Context()
				if sub != "" {
					ctx = identitysecurity.ContextWithClaims(ctx, identitysecurity.Claims{Subject: sub})
				}
				if cc.CompanyID != uuid.Nil {
					ctx = identitysecurity.ContextWithCompanyContext(ctx, cc)
				}
				next.ServeHTTP(w, req.WithContext(ctx))
			})
		})
	}
	r.Mount("/me/company", h.Routes())
	return r
}

// makeMemberAndCompany returns a fully-populated (member, company) pair
// the handler can shape into a 200 response.
func makeMemberAndCompany(userID, companyID uuid.UUID, role valueobjects.MemberRole) (*entities.CompanyMember, *entities.Company) {
	now := time.Now().UTC()
	member := &entities.CompanyMember{
		ID:        uuid.New(),
		UserID:    userID,
		CompanyID: companyID,
		Role:      role,
		CreatedAt: now,
		UpdatedAt: now,
	}
	company := &entities.Company{
		ID:         companyID,
		Name:       valueobjects.CompanyName{},
		Rfc:        valueobjects.CompanyRfc{},
		Status:     valueobjects.Active,
		IndustryID: "tech",
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	// Force-initialize VOs so JSON encoding produces the canonical
	// strings (not "unknown"). The factory below validates, but we
	// already know valid values for these seeded IDs.
	n, _ := valueobjects.NewCompanyName("Acme SA de CV")
	r, _ := valueobjects.NewCompanyRfc("AAA010101AAA")
	company.Name = n
	company.Rfc = r
	return member, company
}

// doReq builds and dispatches a request through the router. Body may be nil.
func doReq(t *testing.T, router http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequest(method, path, nil)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, r)
	return rec
}

// --- GET /me/company (task 3.5) --------------------------------------------

// TestGetMyCompany_OwnerReturns200 covers the spec scenario "owner gets
// their membership": a caller who is owner of company X must get a 200
// response with their (company_id, role) and the company record. This is
// the UNGATED endpoint — it reads the JWT subject (Claims) and calls the
// service with sub; CompanyContext is NOT present (the route has no role
// gate).
func TestGetMyCompany_OwnerReturns200(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()
	member, company := makeMemberAndCompany(userID, companyID, valueobjects.OwnerRole)

	mRepo := &stubMemberRepositoryForHandler{getByUserOut: member}
	uRepo := &stubUserRepositoryForHandler{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-owner"}}
	cRepo := &stubMemberCompanyRepositoryForHandler{getByID: company}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "sub-owner", identitysecurity.CompanyContext{})

	rec := doReq(t, router, http.MethodGet, "/me/company", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp myMembershipResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.CompanyID != companyID.String() {
		t.Errorf("company_id: want %v, got %v", companyID, resp.CompanyID)
	}
	if resp.Role != "owner" {
		t.Errorf("role: want owner, got %q", resp.Role)
	}
	if resp.Company.ID != companyID.String() {
		t.Errorf("company.id: want %v, got %v", companyID, resp.Company.ID)
	}
}

// TestGetMyCompany_NonMemberReturns404 covers the spec scenario
// "non-member gets 404": the caller has no membership row, so the
// service propagates ErrNotAMember and the handler returns 404.
func TestGetMyCompany_NonMemberReturns404(t *testing.T) {
	userID := uuid.New()

	mRepo := &stubMemberRepositoryForHandler{getByUserErr: entities.ErrNotAMember}
	uRepo := &stubUserRepositoryForHandler{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-stranger"}}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "sub-stranger", identitysecurity.CompanyContext{})

	rec := doReq(t, router, http.MethodGet, "/me/company", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestGetMyCompany_UnknownSubReturns401 covers the spec scenario
// "unknown sub returns 401": the JWT subject doesn't match any live
// users row. The service returns ErrUnknownSubject, the handler maps
// to 401.
func TestGetMyCompany_UnknownSubReturns401(t *testing.T) {
	mRepo := &stubMemberRepositoryForHandler{}
	uRepo := &stubUserRepositoryForHandler{resolveErr: identityentities.ErrUserNotFound}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "sub-missing", identitysecurity.CompanyContext{})

	rec := doReq(t, router, http.MethodGet, "/me/company", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

// --- GET /me/company/members (task 3.5) -----------------------------------

// TestListMembers_OwnerReturns200 covers the spec scenario "members are
// listed": an owner of a company with N members must get a 200 response
// listing exactly N members with roles. The handler reads the caller's
// company_id from the injected CompanyContext (design D6 — "resolves
// once") and MUST NOT re-resolve the JWT sub → users.id → company_members
// chain (the user repo is never invoked).
func TestListMembers_OwnerReturns200(t *testing.T) {
	companyID := uuid.New()

	rows := []entities.CompanyMember{
		*mustMember(uuid.New(), companyID, valueobjects.OwnerRole),
		*mustMember(uuid.New(), companyID, valueobjects.RecruiterRole),
		*mustMember(uuid.New(), companyID, valueobjects.RecruiterRole),
	}

	mRepo := &stubMemberRepositoryForHandler{listOut: rows}
	uRepo := &stubUserRepositoryForHandler{}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	})

	rec := doReq(t, router, http.MethodGet, "/me/company/members", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp listMembersResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Members) != 3 {
		t.Errorf("members count: want 3, got %d", len(resp.Members))
	}
	wantRoles := []string{"owner", "recruiter", "recruiter"}
	for i, m := range resp.Members {
		if m.Role != wantRoles[i] {
			t.Errorf("members[%d].role: want %q, got %q", i, wantRoles[i], m.Role)
		}
		if m.CompanyID != companyID.String() {
			t.Errorf("members[%d].company_id: want %v, got %v", i, companyID, m.CompanyID)
		}
	}
	if mRepo.lastListCompanyID != companyID {
		t.Errorf("ListByCompanyID: want companyID %v, got %v (must be the injected CompanyContext ID, not a re-resolved sub)", companyID, mRepo.lastListCompanyID)
	}
	if uRepo.getCalls != 0 {
		t.Errorf("userRepo.GetByCognitoSub must NOT be called by gated handlers (D6 — resolves once), got %d calls", uRepo.getCalls)
	}
}

// TestListMembers_NoReResolveWithCompanyContext is the D6 conformance
// proof: when CompanyContext is in the context, the handler MUST NOT
// consult the user repo at all. A future refactor that re-introduced
// sub-based resolution would trip this assertion.
//
// This replaces the pre-refactor `TestListMembers_NonMemberReturns403`
// test, which exercised the in-handler ErrNotAMember → 403 remap. After
// the refactor, the service no longer returns ErrNotAMember for the
// gated use cases (no resolver path), so that remap is dead code and
// the "non-member is rejected" scenario is now exclusively covered by
// the middleware tests (`identity/http/requireCompanyRole_test.go`).
func TestListMembers_NoReResolveWithCompanyContext(t *testing.T) {
	companyID := uuid.New()

	mRepo := &stubMemberRepositoryForHandler{listOut: nil}
	uRepo := &stubUserRepositoryForHandler{}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "sub-owner", identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	})

	rec := doReq(t, router, http.MethodGet, "/me/company/members", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if uRepo.getCalls != 0 {
		t.Errorf("userRepo.GetByCognitoSub MUST NOT be called when CompanyContext is injected (D6 — resolves once), got %d calls", uRepo.getCalls)
	}
	if mRepo.getByUserCalls != 0 {
		t.Errorf("memberRepo.GetMembershipByUserID MUST NOT be called when CompanyContext is injected (D6 — resolves once), got %d calls", mRepo.getByUserCalls)
	}
}

// TestListMembers_MissingCompanyContextIsServerError is the fail-closed
// invariant: if a gated handler is reached without CompanyContext in the
// request (routing misconfiguration), the handler MUST short-circuit
// with 500 and NEVER invoke the service. A bare 401 here would mislead
// clients into re-authenticating; the real failure is internal.
func TestListMembers_MissingCompanyContextIsServerError(t *testing.T) {
	mRepo := &stubMemberRepositoryForHandler{}
	uRepo := &stubUserRepositoryForHandler{}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	// Inject NO Claims and NO CompanyContext — simulates a misconfigured
	// route that bypassed the RequireCompanyRole gate.
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{})

	rec := doReq(t, router, http.MethodGet, "/me/company/members", "")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500 (fail-closed), got %d: %s", rec.Code, rec.Body.String())
	}
	if mRepo.listCalls != 0 {
		t.Errorf("service.ListMembers must NOT be invoked when CompanyContext is missing, got %d calls", mRepo.listCalls)
	}
}

// TestListMembers_EmptyListIsEmptyJSONArray guards the "non-nil empty
// slice" invariant at the wire level: a JSON `[]`, not `null`.
func TestListMembers_EmptyListIsEmptyJSONArray(t *testing.T) {
	companyID := uuid.New()

	mRepo := &stubMemberRepositoryForHandler{listOut: nil}
	uRepo := &stubUserRepositoryForHandler{}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	})

	rec := doReq(t, router, http.MethodGet, "/me/company/members", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := strings.TrimSpace(rec.Body.String())
	if body != `{"members":[]}` {
		t.Errorf("want {\"members\":[]}, got %q", body)
	}
}

// --- POST /me/company/members (task 3.5) ----------------------------------

// TestAddMember_OwnerReturns201 covers the spec scenario "owner adds a
// recruiter": a 201 with the new row. The handler reads the caller's
// company_id from the injected CompanyContext; the user repo is never
// invoked (D6 — resolves once).
func TestAddMember_OwnerReturns201(t *testing.T) {
	companyID := uuid.New()

	mRepo := &stubMemberRepositoryForHandler{}
	uRepo := &stubUserRepositoryForHandler{}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	})

	targetID := uuid.New()
	body := `{"user_id":"` + targetID.String() + `","role":"recruiter"}`
	rec := doReq(t, router, http.MethodPost, "/me/company/members", body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp memberResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.UserID != targetID.String() {
		t.Errorf("user_id: want %v, got %v", targetID, resp.UserID)
	}
	if resp.Role != "recruiter" {
		t.Errorf("role: want recruiter, got %q", resp.Role)
	}
	if resp.CompanyID != companyID.String() {
		t.Errorf("created row company_id: want %v (injected), got %v", companyID, resp.CompanyID)
	}
	if mRepo.created == nil {
		t.Fatal("expected repository.Create to be called")
	}
	if mRepo.created.CompanyID != companyID {
		t.Errorf("created row CompanyID: want %v (injected), got %v (must come from CompanyContext, not body or sub)", companyID, mRepo.created.CompanyID)
	}
	if uRepo.getCalls != 0 {
		t.Errorf("userRepo.GetByCognitoSub must NOT be called by gated handlers (D6 — resolves once), got %d calls", uRepo.getCalls)
	}
}

// TestAddMember_DuplicateReturns409 covers the spec scenario "duplicate
// user is rejected": the repo returns 23505 → ErrMemberExists → 409.
func TestAddMember_DuplicateReturns409(t *testing.T) {
	companyID := uuid.New()

	mRepo := &stubMemberRepositoryForHandler{
		createErr: entities.ErrMemberExists,
	}
	uRepo := &stubUserRepositoryForHandler{}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	})

	targetID := uuid.New()
	body := `{"user_id":"` + targetID.String() + `","role":"recruiter"}`
	rec := doReq(t, router, http.MethodPost, "/me/company/members", body)
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestAddMember_InvalidRoleReturns400 — validation surfaces as
// ErrInvalidMemberRole → 400.
func TestAddMember_InvalidRoleReturns400(t *testing.T) {
	companyID := uuid.New()

	mRepo := &stubMemberRepositoryForHandler{}
	uRepo := &stubUserRepositoryForHandler{}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	})

	targetID := uuid.New()
	body := `{"user_id":"` + targetID.String() + `","role":"admin"}`
	rec := doReq(t, router, http.MethodPost, "/me/company/members", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestAddMember_InvalidJSONReturns400 covers the malformed-body branch.
func TestAddMember_InvalidJSONReturns400(t *testing.T) {
	companyID := uuid.New()

	mRepo := &stubMemberRepositoryForHandler{}
	uRepo := &stubUserRepositoryForHandler{}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	})

	rec := doReq(t, router, http.MethodPost, "/me/company/members", "{not json")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// --- PATCH /me/company/members/{id} (task 3.5) ----------------------------

// TestUpdateMemberRole_PromotesRecruiterToOwner covers the spec scenario
// "owner promotes a recruiter": 200 with the updated row. The handler
// passes the injected CompanyContext.CompanyID to the service; the user
// repo is never invoked (D6 — resolves once).
func TestUpdateMemberRole_PromotesRecruiterToOwner(t *testing.T) {
	companyID := uuid.New()

	mRepo := &stubMemberRepositoryForHandler{}
	uRepo := &stubUserRepositoryForHandler{}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	})

	targetID := uuid.New()
	body := `{"role":"owner"}`
	rec := doReq(t, router, http.MethodPatch, "/me/company/members/"+targetID.String(), body)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if mRepo.lastUpdateCompanyID != companyID {
		t.Errorf("UpdateRole company_id: want %v (injected), got %v", companyID, mRepo.lastUpdateCompanyID)
	}
	if uRepo.getCalls != 0 {
		t.Errorf("userRepo.GetByCognitoSub must NOT be called by gated handlers (D6 — resolves once), got %d calls", uRepo.getCalls)
	}
}

// TestUpdateMemberRole_CrossCompanyReturns404 covers the spec scenario
// "cross-company target is rejected": the service propagates
// ErrMemberNotFound → 404.
func TestUpdateMemberRole_CrossCompanyReturns404(t *testing.T) {
	companyID := uuid.New()

	mRepo := &stubMemberRepositoryForHandler{updateErr: entities.ErrMemberNotFound}
	uRepo := &stubUserRepositoryForHandler{}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	})

	targetID := uuid.New()
	body := `{"role":"owner"}`
	rec := doReq(t, router, http.MethodPatch, "/me/company/members/"+targetID.String(), body)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

// --- DELETE /me/company/members/{id} (task 3.5) ---------------------------

// TestRemoveMember_OwnerReturns204 covers the spec scenario "owner
// removes a member": 204 with no body. The handler passes the injected
// CompanyContext.CompanyID to the service; the user repo is never
// invoked (D6 — resolves once).
func TestRemoveMember_OwnerReturns204(t *testing.T) {
	companyID := uuid.New()

	mRepo := &stubMemberRepositoryForHandler{}
	uRepo := &stubUserRepositoryForHandler{}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	})

	targetID := uuid.New()
	rec := doReq(t, router, http.MethodDelete, "/me/company/members/"+targetID.String(), "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() != 0 {
		t.Errorf("204 body should be empty, got %q", rec.Body.String())
	}
	if mRepo.lastRemoveCompanyID != companyID {
		t.Errorf("Remove company_id: want %v (injected), got %v", companyID, mRepo.lastRemoveCompanyID)
	}
	if uRepo.getCalls != 0 {
		t.Errorf("userRepo.GetByCognitoSub must NOT be called by gated handlers (D6 — resolves once), got %d calls", uRepo.getCalls)
	}
}

// TestRemoveMember_InvalidUUIDReturns400 covers the path-uuid branch.
func TestRemoveMember_InvalidUUIDReturns400(t *testing.T) {
	companyID := uuid.New()

	mRepo := &stubMemberRepositoryForHandler{}
	uRepo := &stubUserRepositoryForHandler{}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	})

	rec := doReq(t, router, http.MethodDelete, "/me/company/members/not-a-uuid", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// --- helpers ---------------------------------------------------------------

func mustMember(userID, companyID uuid.UUID, role valueobjects.MemberRole) *entities.CompanyMember {
	now := time.Now().UTC()
	return &entities.CompanyMember{
		ID:        uuid.New(),
		UserID:    userID,
		CompanyID: companyID,
		Role:      role,
		CreatedAt: now,
		UpdatedAt: now,
	}
}

// Ensure dtos.AddMemberDto and dtos.UpdateMemberRoleDto stay referenced.
var (
	_ = dtos.AddMemberDto{}
	_ = dtos.UpdateMemberRoleDto{}
)
