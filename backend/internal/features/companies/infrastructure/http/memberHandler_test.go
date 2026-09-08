package http

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
	"time"

	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	identityvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	rtmiddleware "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/middleware"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
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

	listOut           []entities.MemberListRow
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

func (s *stubMemberRepositoryForHandler) ListByCompanyID(_ context.Context, companyID uuid.UUID) ([]entities.MemberListRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listCalls++
	s.lastListCompanyID = companyID
	if s.listErr != nil {
		return nil, s.listErr
	}
	if s.listOut == nil {
		return []entities.MemberListRow{}, nil
	}
	out := make([]entities.MemberListRow, len(s.listOut))
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
	getCalls   int // GetByCognitoSub reads (D6: must stay 0 on gated paths)
	byIDCalls  int // GetByID reads (addMember target validation)

	// byID / byIDErr drive GetByID, which AddMember now calls to validate
	// the target's user_type. Default (both nil) returns a recruiter so the
	// existing AddMember handler tests keep passing.
	byID    *identityentities.User
	byIDErr error
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
	s.mu.Lock()
	defer s.mu.Unlock()
	s.byIDCalls++
	if s.byIDErr != nil {
		return nil, s.byIDErr
	}
	if s.byID != nil {
		return s.byID, nil
	}
	return &identityentities.User{UserType: identityvalueobjects.UserRecruiter}, nil
}

type stubMemberCompanyRepositoryForHandler struct {
	mu      sync.Mutex
	getByID *entities.Company
	getErr  error

	getForUpdateOut *entities.Company
	getForUpdateErr error

	updateCalls int
	updateErr   error

	softDeleteCalls int
	softDeleteErr   error
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

// GetCompanyForUpdate mirrors GetByID's default return shape so legacy
// member-handler tests stay green (they do not exercise the new method).
func (s *stubMemberCompanyRepositoryForHandler) GetCompanyForUpdate(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.getForUpdateErr != nil {
		return nil, s.getForUpdateErr
	}
	if s.getForUpdateOut != nil {
		return s.getForUpdateOut, nil
	}
	return nil, entities.ErrCompanyNotFound
}

func (s *stubMemberCompanyRepositoryForHandler) UpdateCompany(_ context.Context, _ uuid.UUID, _ repositories.UpdateCompanyPatch, _ time.Time, _ auditentities.AuditEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.updateCalls++
	return s.updateErr
}

func (s *stubMemberCompanyRepositoryForHandler) SoftDeleteCompany(_ context.Context, _ uuid.UUID, _ time.Time, _ auditentities.AuditEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.softDeleteCalls++
	return s.softDeleteErr
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

// memberAssertCatalogEnvelope asserts the response is a catalog envelope with
// the expected HTTP status and catalog code. For internal_error it also
// asserts the canonical generic message (non-leak proof).
func memberAssertCatalogEnvelope(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantCode httpjson.Code) {
	t.Helper()
	if rec.Code != wantStatus {
		t.Fatalf("want %d, got %d: %s", wantStatus, rec.Code, rec.Body.String())
	}
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
	}
	if env.Code == "" {
		t.Fatalf("code: want non-empty, got empty; body=%s", rec.Body.String())
	}
	if env.Code != wantCode {
		t.Errorf("code: want %q, got %q", wantCode, env.Code)
	}
	if wantCode == httpjson.CodeInternalError {
		if env.Error != "an internal error occurred" {
			t.Errorf("internal_error must use canonical generic message, got %q", env.Error)
		}
	}
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
	memberAssertCatalogEnvelope(t, rec, http.StatusNotFound, httpjson.CodeNotFound)
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
	memberAssertCatalogEnvelope(t, rec, http.StatusUnauthorized, httpjson.CodeUnauthenticated)
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

	rows := []entities.MemberListRow{
		{ID: uuid.New(), CompanyID: companyID, Role: "owner", User: &entities.MemberUser{ID: uuid.New(), FullName: "Alice", Email: "alice@x.com"}},
		{ID: uuid.New(), CompanyID: companyID, Role: "recruiter", User: &entities.MemberUser{ID: uuid.New(), FullName: "Bob", Email: "bob@x.com"}},
		{ID: uuid.New(), CompanyID: companyID, Role: "recruiter", User: &entities.MemberUser{ID: uuid.New(), FullName: "Carla", Email: "carla@x.com"}},
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
		if m.User == nil {
			t.Errorf("members[%d].user: want non-nil, got nil", i)
			continue
		}
		if m.User.FullName == "" || m.User.Email == "" {
			t.Errorf("members[%d].user: expected full_name+email, got %+v", i, m.User)
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
	memberAssertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
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
	memberAssertCatalogEnvelope(t, rec, http.StatusConflict, httpjson.CodeAlreadyExists)
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
	memberAssertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
}

// TestAddMember_CandidateReturns400 covers business rule 3a at the transport:
// a target with user_type=candidate surfaces 400 (not a silent 201).
func TestAddMember_CandidateReturns400(t *testing.T) {
	companyID := uuid.New()

	mRepo := &stubMemberRepositoryForHandler{}
	uRepo := &stubUserRepositoryForHandler{
		byID: &identityentities.User{UserType: identityvalueobjects.UserCandidate},
	}
	cRepo := &stubMemberCompanyRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{
		CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
	})

	targetID := uuid.New()
	body := `{"user_id":"` + targetID.String() + `","role":"recruiter"}`
	rec := doReq(t, router, http.MethodPost, "/me/company/members", body)
	memberAssertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
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
	memberAssertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
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
	memberAssertCatalogEnvelope(t, rec, http.StatusNotFound, httpjson.CodeNotFound)
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
	memberAssertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
}

var (
	_ = dtos.AddMemberDto{}
	_ = dtos.UpdateMemberRoleDto{}
)

func captureSlog(t *testing.T, buf *bytes.Buffer) {
	prev := slog.Default().Handler()
	slog.SetDefault(slog.New(slog.NewJSONHandler(buf, nil)))
	t.Cleanup(func() { slog.SetDefault(slog.New(prev)) })
}

func assertErrorMessage(t *testing.T, rec *httptest.ResponseRecorder, want string) {
	t.Helper()
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
	}
	if env.Error != want {
		t.Errorf("error message: want %q, got %q", want, env.Error)
	}
}

func assertNoMemberWrites(t *testing.T, members *stubMemberRepositoryForHandler, users *stubUserRepositoryForHandler) {
	t.Helper()
	if members.createCalls != 0 || members.updateCalls != 0 || members.removeCalls != 0 || users.getCalls != 0 || users.byIDCalls != 0 {
		t.Fatalf("unexpected calls: create=%d update=%d remove=%d user_get=%d user_by_id=%d", members.createCalls, members.updateCalls, members.removeCalls, users.getCalls, users.byIDCalls)
	}
}

func TestGetMyCompany_NoSubjectReturns401(t *testing.T) {
	svc := newMemberHandlerService(&stubMemberRepositoryForHandler{}, &stubUserRepositoryForHandler{}, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{})
	rec := doReq(t, router, http.MethodGet, "/me/company", "")
	memberAssertCatalogEnvelope(t, rec, http.StatusUnauthorized, httpjson.CodeUnauthenticated)
	assertErrorMessage(t, rec, "unauthenticated")
}

func TestGetMyCompany_MemberButCompanyNotFound(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()
	member := &entities.CompanyMember{
		ID: uuid.New(), UserID: userID, CompanyID: companyID,
		Role:      valueobjects.OwnerRole,
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	mRepo := &stubMemberRepositoryForHandler{getByUserOut: member}
	uRepo := &stubUserRepositoryForHandler{resolved: &identityentities.User{ID: userID, CognitoSub: "sub"}}
	cRepo := &stubMemberCompanyRepositoryForHandler{getErr: entities.ErrCompanyNotFound}
	svc := newMemberHandlerService(mRepo, uRepo, cRepo)
	router := newMemberRouter(t, svc, "sub", identitysecurity.CompanyContext{})
	rec := doReq(t, router, http.MethodGet, "/me/company", "")
	memberAssertCatalogEnvelope(t, rec, http.StatusNotFound, httpjson.CodeNotFound)
	assertErrorMessage(t, rec, "company not found")
}

// --- Unexpected-error READ logging: bounded + request-correlated ------------

// TestMemberTransport_ReadUnexpectedErrors_CorrelatedAndRedacted drives the
// two reachable unexpected-error READ sites (GET /me/company →
// getMyMembership, GET /me/company/members → listMembers) through the
// production-faithful chain chi RequestID → runtime RequestObservability →
// handler, with a fixed X-Request-Id. Behavior under test: the response stays
// exactly 500 + catalog internal_error with the canonical generic message (no
// injected detail), the handler emits exactly ONE auxiliary record whose
// fields are bounded and request-correlated (request_id shared with the
// completion record, HTTP method, matched chi route pattern,
// code_class=internal_error), and the raw error text / DSN / token / concrete
// company UUID never reach any captured log byte. The write routes keep their
// own dedicated tests; this table owns only the two read routes.
//
// Guard assertions preserved from the retired raw-detail tests
// (TestGetMyCompany_UnexpectedCompanyError, TestListMembers_UnexpectedServiceError):
// no membership writes on either failure path, and the gated list route never
// re-resolves the user repository (design D6 — "resolves once").
//
// No t.Parallel(): slog capture is process-global. The slog capture, record
// decoding, and the closed auxiliary key allowlist are reused from
// handler_test.go (same package — single source of truth, no fixture
// duplication).
func TestMemberTransport_ReadUnexpectedErrors_CorrelatedAndRedacted(t *testing.T) {
	const fixedRequestID = "members-fixed-request-id"
	const completionMsg = "http request completed"

	// get case fixtures: a resolved member whose company lookup fails with a
	// DSN-and-token-laden unexpected error.
	getUserID := uuid.New()
	getCompanyID := uuid.New()
	getMember := &entities.CompanyMember{
		ID: uuid.New(), UserID: getUserID, CompanyID: getCompanyID,
		Role:      valueobjects.OwnerRole,
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	getBoom := errors.New("db: read timeout while scanning company row dsn=postgres://svc:hunter2@db.internal:5432/peopleflow token=abc123")

	// list case fixtures: the gated list route fails inside the service.
	listCompanyID := uuid.New()
	listBoom := errors.New("pg: pool exhausted while listing members token=def456")

	cases := []struct {
		name      string
		path      string
		sub       string
		cc        identitysecurity.CompanyContext
		mRepo     *stubMemberRepositoryForHandler
		uRepo     *stubUserRepositoryForHandler
		cRepo     *stubMemberCompanyRepositoryForHandler
		auxMsg    string
		wantRoute string
		// forbidden substrings that must not appear in any captured log byte
		forbidden []string
	}{
		{
			name:      "get my membership: unexpected company repository error",
			path:      "/me/company",
			sub:       "sub-owner",
			mRepo:     &stubMemberRepositoryForHandler{getByUserOut: getMember},
			uRepo:     &stubUserRepositoryForHandler{resolved: &identityentities.User{ID: getUserID, CognitoSub: "sub-owner"}},
			cRepo:     &stubMemberCompanyRepositoryForHandler{getErr: getBoom},
			auxMsg:    "get my membership failed",
			wantRoute: "/me/company",
			forbidden: []string{
				"db: read timeout while scanning company row dsn=postgres://svc:hunter2@db.internal:5432/peopleflow token=abc123",
				"postgres://svc:hunter2@db.internal:5432/peopleflow",
				"token=abc123",
				getCompanyID.String(),
				getUserID.String(),
			},
		},
		{
			name:      "list members: unexpected service error",
			path:      "/me/company/members",
			sub:       "sub-recruiter",
			cc:        identitysecurity.CompanyContext{CompanyID: listCompanyID, Role: valueobjects.OwnerRole},
			mRepo:     &stubMemberRepositoryForHandler{listErr: listBoom},
			uRepo:     &stubUserRepositoryForHandler{},
			cRepo:     &stubMemberCompanyRepositoryForHandler{},
			auxMsg:    "list members failed",
			wantRoute: "/me/company/members",
			forbidden: []string{
				"pg: pool exhausted while listing members token=def456",
				"token=def456",
				listCompanyID.String(),
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logBuf := captureCompanySlog(t)
			svc := newMemberHandlerService(tc.mRepo, tc.uRepo, tc.cRepo)
			h := NewMemberHandler(svc)

			// Production-faithful chain: chi RequestID → runtime
			// RequestObservability → handler, mounted exactly like
			// cmd/api/router.go (GET /company and GET /company/members under
			// the /me slice; RequireAuth's Claims and RequireCompanyRole's
			// CompanyContext are injected by the context middleware below).
			r := chi.NewRouter()
			r.Use(chimw.RequestID)
			r.Use(rtmiddleware.RequestObservability(
				slog.New(slog.NewJSONHandler(logBuf, nil)),
				nil,
			))
			r.Use(func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
					ctx := identitysecurity.ContextWithClaims(req.Context(), identitysecurity.Claims{Subject: tc.sub})
					if tc.cc.CompanyID != uuid.Nil {
						ctx = identitysecurity.ContextWithCompanyContext(ctx, tc.cc)
					}
					next.ServeHTTP(w, req.WithContext(ctx))
				})
			})
			hh := h.MemberHandlers()
			r.Get("/me/company", hh.GetMyMembership)
			r.Get("/me/company/members", hh.ListMembers)

			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			req.Header.Set("X-Request-Id", fixedRequestID)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)

			// The wire contract is unchanged: generic 500 + catalog
			// internal_error with the canonical generic message (no injected detail).
			memberAssertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)

			// Exactly one auxiliary record + exactly one completion record.
			records := decodeCompanySlogRecords(t, logBuf)
			if len(records) != 2 {
				t.Fatalf("slog records = %d (%s), want exactly 2 (auxiliary + completion)",
					len(records), companyMsgList(records))
			}

			// The auxiliary record: closed bounded key set, request-correlated.
			aux := companyRecordByMsg(t, records, tc.auxMsg)
			for k := range aux {
				if !companyAuxAllowedKeys[k] {
					t.Errorf("auxiliary record has unbounded key %q (record %v)", k, aux)
				}
			}
			for k := range companyAuxAllowedKeys {
				if _, ok := aux[k]; !ok {
					t.Errorf("auxiliary record missing bounded key %q (record %v)", k, aux)
				}
			}
			if got, _ := aux["request_id"].(string); got != fixedRequestID {
				t.Errorf("auxiliary request_id = %q, want the fixed chi request ID %q", got, fixedRequestID)
			}
			if got, _ := aux["method"].(string); got != http.MethodGet {
				t.Errorf("auxiliary method = %q, want %q", got, http.MethodGet)
			}
			if got, _ := aux["path"].(string); got != tc.wantRoute {
				t.Errorf("auxiliary path = %q, want the matched chi route pattern %q (raw URL MUST NOT be logged)", got, tc.wantRoute)
			}
			if got, _ := aux["code_class"].(string); got != string(httpjson.CodeInternalError) {
				t.Errorf("auxiliary code_class = %q, want %q", got, httpjson.CodeInternalError)
			}

			// The runtime completion record: same fixed request ID, matched
			// route pattern, status 500, internal_error class.
			comp := companyRecordByMsg(t, records, completionMsg)
			if got, _ := comp["request_id"].(string); got != fixedRequestID {
				t.Errorf("completion request_id = %q, want the same fixed ID %q shared with the auxiliary record", got, fixedRequestID)
			}
			if got, _ := comp["path"].(string); got != tc.wantRoute {
				t.Errorf("completion path = %q, want the matched chi route pattern %q", got, tc.wantRoute)
			}
			if s, ok := comp["status"].(float64); !ok || int(s) != http.StatusInternalServerError {
				t.Errorf("completion status = %v (%T), want %d", comp["status"], comp["status"], http.StatusInternalServerError)
			}
			if got, _ := comp["code_class"].(string); got != string(httpjson.CodeInternalError) {
				t.Errorf("completion code_class = %q, want %q", got, httpjson.CodeInternalError)
			}

			// Redaction across every captured log byte: the raw error text and
			// every concrete identifier paired with it never reach the logs.
			for _, forbidden := range tc.forbidden {
				if strings.Contains(logBuf.String(), forbidden) {
					t.Errorf("captured logs MUST NOT contain %q; logs=%s", forbidden, logBuf.String())
				}
			}

			// Preserved guard: no membership writes on either read failure path.
			if tc.mRepo.createCalls != 0 || tc.mRepo.updateCalls != 0 || tc.mRepo.removeCalls != 0 {
				t.Errorf("no membership writes expected: create=%d update=%d remove=%d",
					tc.mRepo.createCalls, tc.mRepo.updateCalls, tc.mRepo.removeCalls)
			}
			// Preserved guard (gated list route only): the D6 resolver chain is
			// never re-run — the user repository stays untouched.
			if tc.cc.CompanyID != uuid.Nil && tc.uRepo.getCalls != 0 {
				t.Errorf("userRepo.GetByCognitoSub must NOT be called on the gated list path: got %d", tc.uRepo.getCalls)
			}
		})
	}
}

func TestAddMember_MissingCompanyContextIsServerError(t *testing.T) {
	members := &stubMemberRepositoryForHandler{}
	users := &stubUserRepositoryForHandler{}
	svc := newMemberHandlerService(members, users, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{})
	rec := doReq(t, router, http.MethodPost, "/me/company/members",
		`{"user_id":"`+uuid.New().String()+`","role":"recruiter"}`)
	memberAssertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
	assertNoMemberWrites(t, members, users)
}

// * Invalid user_id → 400 invalid_request, "invalid user_id".
func TestAddMember_InvalidUserIDReturns400(t *testing.T) {
	companyID := uuid.New()
	svc := newMemberHandlerService(&stubMemberRepositoryForHandler{}, &stubUserRepositoryForHandler{}, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{CompanyID: companyID, Role: valueobjects.OwnerRole})
	rec := doReq(t, router, http.MethodPost, "/me/company/members", `{"user_id":"bad","role":"recruiter"}`)
	memberAssertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
	assertErrorMessage(t, rec, "invalid user_id")
}

// * User not found → 404 "user not found".
func TestAddMember_UserNotFound(t *testing.T) {
	companyID := uuid.New()
	uRepo := &stubUserRepositoryForHandler{byIDErr: identityentities.ErrUserNotFound}
	svc := newMemberHandlerService(&stubMemberRepositoryForHandler{}, uRepo, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{CompanyID: companyID, Role: valueobjects.OwnerRole})
	rec := doReq(t, router, http.MethodPost, "/me/company/members",
		`{"user_id":"`+uuid.New().String()+`","role":"recruiter"}`)
	memberAssertCatalogEnvelope(t, rec, http.StatusNotFound, httpjson.CodeNotFound)
	assertErrorMessage(t, rec, "user not found")
}

// * Unexpected user repo error → 500; member writes untouched.
func TestAddMember_UserLookupUnexpectedError(t *testing.T) {
	var logBuf bytes.Buffer
	captureSlog(t, &logBuf)
	companyID := uuid.New()
	uRepo := &stubUserRepositoryForHandler{byIDErr: errors.New("user repo: timeout")}
	mRepo := &stubMemberRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{CompanyID: companyID, Role: valueobjects.OwnerRole})
	rec := doReq(t, router, http.MethodPost, "/me/company/members",
		`{"user_id":"`+uuid.New().String()+`","role":"recruiter"}`)
	memberAssertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
	body := rec.Body.String()
	if strings.Contains(body, "timeout") || strings.Contains(body, "user repo") {
		t.Errorf("injected detail must not appear in wire: %s", body)
	}
	logOut := logBuf.String()
	if !strings.Contains(logOut, "timeout") {
		t.Errorf("injected detail must appear in slog; got: %s", logOut)
	}
	if mRepo.createCalls > 0 || mRepo.updateCalls > 0 || mRepo.removeCalls > 0 {
		t.Errorf("member writes must not be called: create=%d update=%d remove=%d",
			mRepo.createCalls, mRepo.updateCalls, mRepo.removeCalls)
	}
}

// * Unexpected Create error → 500; Update/Remove untouched.
func TestAddMember_CreateUnexpectedError(t *testing.T) {
	var logBuf bytes.Buffer
	captureSlog(t, &logBuf)
	companyID := uuid.New()
	mRepo := &stubMemberRepositoryForHandler{createErr: errors.New("pg: serializable conflict")}
	svc := newMemberHandlerService(mRepo, &stubUserRepositoryForHandler{}, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{CompanyID: companyID, Role: valueobjects.OwnerRole})
	rec := doReq(t, router, http.MethodPost, "/me/company/members",
		`{"user_id":"`+uuid.New().String()+`","role":"recruiter"}`)
	memberAssertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
	body := rec.Body.String()
	if strings.Contains(body, "serializable") || strings.Contains(body, "pg:") {
		t.Errorf("injected detail must not appear in wire: %s", body)
	}
	logOut := logBuf.String()
	if !strings.Contains(logOut, "serializable conflict") {
		t.Errorf("injected detail must appear in slog; got: %s", logOut)
	}
	if mRepo.createCalls == 0 {
		t.Errorf("Create must be called")
	}
	if mRepo.updateCalls > 0 || mRepo.removeCalls > 0 {
		t.Errorf("no unintended writes: update=%d remove=%d", mRepo.updateCalls, mRepo.removeCalls)
	}
}

// --- PATCH /me/company/members/{id} (gated) ---

// * Missing CompanyContext → 500.
func TestUpdateMemberRole_MissingCompanyContextIsServerError(t *testing.T) {
	members := &stubMemberRepositoryForHandler{}
	users := &stubUserRepositoryForHandler{}
	svc := newMemberHandlerService(members, users, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{})
	rec := doReq(t, router, http.MethodPatch, "/me/company/members/"+uuid.New().String(), `{"role":"owner"}`)
	memberAssertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
	assertNoMemberWrites(t, members, users)
}

// * Invalid member UUID → 400 invalid_request, "invalid member id".
func TestUpdateMemberRole_InvalidMemberIDReturns400(t *testing.T) {
	companyID := uuid.New()
	svc := newMemberHandlerService(&stubMemberRepositoryForHandler{}, &stubUserRepositoryForHandler{}, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{CompanyID: companyID, Role: valueobjects.OwnerRole})
	rec := doReq(t, router, http.MethodPatch, "/me/company/members/not-a-uuid", `{"role":"owner"}`)
	memberAssertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
	assertErrorMessage(t, rec, "invalid member id")
}

// * ErrInvalidMemberRole → 400 invalid_request, "invalid member role".
func TestUpdateMemberRole_InvalidRoleReturns400(t *testing.T) {
	companyID := uuid.New()
	mRepo := &stubMemberRepositoryForHandler{updateErr: valueobjects.ErrInvalidMemberRole}
	svc := newMemberHandlerService(mRepo, &stubUserRepositoryForHandler{}, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{CompanyID: companyID, Role: valueobjects.OwnerRole})
	rec := doReq(t, router, http.MethodPatch, "/me/company/members/"+uuid.New().String(), `{"role":"admin"}`)
	memberAssertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
	assertErrorMessage(t, rec, "invalid member role")
}

// * Malformed JSON body → 400 invalid_request, "invalid JSON body".
func TestUpdateMemberRole_MalformedJSONBody(t *testing.T) {
	companyID := uuid.New()
	svc := newMemberHandlerService(&stubMemberRepositoryForHandler{}, &stubUserRepositoryForHandler{}, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{CompanyID: companyID, Role: valueobjects.OwnerRole})
	rec := doReq(t, router, http.MethodPatch, "/me/company/members/"+uuid.New().String(), `{bad json}`)
	memberAssertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
	assertErrorMessage(t, rec, "invalid JSON body")
}

// * Unexpected UpdateRole error → 500; user repo not called.
func TestUpdateMemberRole_UnexpectedServiceError(t *testing.T) {
	var logBuf bytes.Buffer
	captureSlog(t, &logBuf)
	companyID := uuid.New()
	mRepo := &stubMemberRepositoryForHandler{updateErr: errors.New("tx: rollback failed")}
	uRepo := &stubUserRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{CompanyID: companyID, Role: valueobjects.OwnerRole})
	rec := doReq(t, router, http.MethodPatch, "/me/company/members/"+uuid.New().String(), `{"role":"owner"}`)
	memberAssertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
	body := rec.Body.String()
	if strings.Contains(body, "rollback") || strings.Contains(body, "tx:") {
		t.Errorf("injected detail must not appear in wire: %s", body)
	}
	logOut := logBuf.String()
	if !strings.Contains(logOut, "rollback failed") {
		t.Errorf("injected detail must appear in slog; got: %s", logOut)
	}
	if mRepo.updateCalls == 0 {
		t.Errorf("UpdateRole must be called")
	}
	if uRepo.getCalls > 0 {
		t.Errorf("userRepo.GetByCognitoSub must NOT be called on gated path: got %d", uRepo.getCalls)
	}
	if mRepo.createCalls != 0 || mRepo.removeCalls != 0 {
		t.Errorf("unrelated writes: create=%d remove=%d", mRepo.createCalls, mRepo.removeCalls)
	}
}

// --- DELETE /me/company/members/{id} (gated) ---

// * Missing CompanyContext → 500.
func TestRemoveMember_MissingCompanyContextIsServerError(t *testing.T) {
	members := &stubMemberRepositoryForHandler{}
	users := &stubUserRepositoryForHandler{}
	svc := newMemberHandlerService(members, users, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{})
	rec := doReq(t, router, http.MethodDelete, "/me/company/members/"+uuid.New().String(), "")
	memberAssertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
	assertNoMemberWrites(t, members, users)
}

// * Invalid member UUID → 400 invalid_request, "invalid member id".
func TestRemoveMember_InvalidMemberIDReturns400(t *testing.T) {
	companyID := uuid.New()
	svc := newMemberHandlerService(&stubMemberRepositoryForHandler{}, &stubUserRepositoryForHandler{}, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{CompanyID: companyID, Role: valueobjects.OwnerRole})
	rec := doReq(t, router, http.MethodDelete, "/me/company/members/not-a-uuid", "")
	memberAssertCatalogEnvelope(t, rec, http.StatusBadRequest, httpjson.CodeInvalidRequest)
	assertErrorMessage(t, rec, "invalid member id")
}

// * Member not found → 404 "company member not found".
func TestRemoveMember_MemberNotFound(t *testing.T) {
	companyID := uuid.New()
	mRepo := &stubMemberRepositoryForHandler{removeErr: entities.ErrMemberNotFound}
	svc := newMemberHandlerService(mRepo, &stubUserRepositoryForHandler{}, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{CompanyID: companyID, Role: valueobjects.OwnerRole})
	rec := doReq(t, router, http.MethodDelete, "/me/company/members/"+uuid.New().String(), "")
	memberAssertCatalogEnvelope(t, rec, http.StatusNotFound, httpjson.CodeNotFound)
	assertErrorMessage(t, rec, "company member not found")
}

// * Unexpected Remove error → 500; user repo not called; Create/Update untouched.
func TestRemoveMember_UnexpectedRemoveError(t *testing.T) {
	var logBuf bytes.Buffer
	captureSlog(t, &logBuf)
	companyID := uuid.New()
	mRepo := &stubMemberRepositoryForHandler{removeErr: errors.New("db: lock not acquired")}
	uRepo := &stubUserRepositoryForHandler{}
	svc := newMemberHandlerService(mRepo, uRepo, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{CompanyID: companyID, Role: valueobjects.OwnerRole})
	rec := doReq(t, router, http.MethodDelete, "/me/company/members/"+uuid.New().String(), "")
	memberAssertCatalogEnvelope(t, rec, http.StatusInternalServerError, httpjson.CodeInternalError)
	body := rec.Body.String()
	if strings.Contains(body, "lock") || strings.Contains(body, "db:") {
		t.Errorf("injected detail must not appear in wire: %s", body)
	}
	logOut := logBuf.String()
	if !strings.Contains(logOut, "lock not acquired") {
		t.Errorf("injected detail must appear in slog; got: %s", logOut)
	}
	if mRepo.removeCalls == 0 {
		t.Errorf("Remove must be called")
	}
	if mRepo.createCalls > 0 || mRepo.updateCalls > 0 {
		t.Errorf("no unintended writes: create=%d update=%d", mRepo.createCalls, mRepo.updateCalls)
	}
	if uRepo.getCalls > 0 {
		t.Errorf("userRepo.GetByCognitoSub must NOT be called on gated path: got %d", uRepo.getCalls)
	}
}

// --- Wire triangulation: same code, different safe messages ---

// * invalid user_id vs malformed JSON body → both invalid_request, messages differ.
func TestTriangulation_InvalidRequestMessagesDiffer(t *testing.T) {
	companyID := uuid.New()
	svc := newMemberHandlerService(&stubMemberRepositoryForHandler{}, &stubUserRepositoryForHandler{}, &stubMemberCompanyRepositoryForHandler{})
	router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{CompanyID: companyID, Role: valueobjects.OwnerRole})

	recA := doReq(t, router, http.MethodPost, "/me/company/members", `{"user_id":"bad","role":"recruiter"}`)
	memberAssertCatalogEnvelope(t, recA, http.StatusBadRequest, httpjson.CodeInvalidRequest)
	assertErrorMessage(t, recA, "invalid user_id")

	recB := doReq(t, router, http.MethodPatch, "/me/company/members/"+uuid.New().String(), `{bad`)
	memberAssertCatalogEnvelope(t, recB, http.StatusBadRequest, httpjson.CodeInvalidRequest)
	assertErrorMessage(t, recB, "invalid JSON body")

	var envA, envB httpjson.ErrorEnvelope
	json.Unmarshal(recA.Body.Bytes(), &envA)
	json.Unmarshal(recB.Body.Bytes(), &envB)
	if envA.Error == envB.Error {
		t.Errorf("invalid_request messages must differ: got same %q twice", envA.Error)
	}
}

// * company-not-found vs user-not-found → both not_found, messages differ.
func TestTriangulation_NotFoundMessagesDiffer(t *testing.T) {
	companyID := uuid.New()
	userID := uuid.New()
	member := &entities.CompanyMember{
		ID: uuid.New(), UserID: userID, CompanyID: companyID, Role: valueobjects.OwnerRole,
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	mRepoA := &stubMemberRepositoryForHandler{getByUserOut: member}
	uRepoA := &stubUserRepositoryForHandler{resolved: &identityentities.User{ID: userID, CognitoSub: "sub"}}
	cRepoA := &stubMemberCompanyRepositoryForHandler{getErr: entities.ErrCompanyNotFound}
	svcA := newMemberHandlerService(mRepoA, uRepoA, cRepoA)
	routerA := newMemberRouter(t, svcA, "sub", identitysecurity.CompanyContext{})
	recA := doReq(t, routerA, http.MethodGet, "/me/company", "")
	memberAssertCatalogEnvelope(t, recA, http.StatusNotFound, httpjson.CodeNotFound)
	assertErrorMessage(t, recA, "company not found")

	uRepoB := &stubUserRepositoryForHandler{byIDErr: identityentities.ErrUserNotFound}
	svcB := newMemberHandlerService(&stubMemberRepositoryForHandler{}, uRepoB, &stubMemberCompanyRepositoryForHandler{})
	routerB := newMemberRouter(t, svcB, "", identitysecurity.CompanyContext{CompanyID: companyID, Role: valueobjects.OwnerRole})
	recB := doReq(t, routerB, http.MethodPost, "/me/company/members",
		`{"user_id":"`+uuid.New().String()+`","role":"recruiter"}`)
	memberAssertCatalogEnvelope(t, recB, http.StatusNotFound, httpjson.CodeNotFound)
	assertErrorMessage(t, recB, "user not found")

	var envA, envB httpjson.ErrorEnvelope
	json.Unmarshal(recA.Body.Bytes(), &envA)
	json.Unmarshal(recB.Body.Bytes(), &envB)
	if envA.Error == envB.Error {
		t.Errorf("not_found messages must differ: got same %q twice", envA.Error)
	}
}

// TestMemberHandlers_DecodeBoundary (WS6B-2 Wave A): both membership write
// handlers must accept exactly one JSON value within the 1,048,576-byte cap —
// a trailing second value yields invalid_request ("invalid JSON body"),
// ignored padding past the cap yields payload_too_large (HTTP 413); neither
// may reach the repositories (assertNoMemberWrites).
func TestMemberHandlers_DecodeBoundary(t *testing.T) {
	newDeps := func() (http.Handler, *stubMemberRepositoryForHandler, *stubUserRepositoryForHandler) {
		mRepo := &stubMemberRepositoryForHandler{}
		uRepo := &stubUserRepositoryForHandler{}
		svc := newMemberHandlerService(mRepo, uRepo, &stubMemberCompanyRepositoryForHandler{})
		router := newMemberRouter(t, svc, "", identitysecurity.CompanyContext{CompanyID: uuid.New(), Role: valueobjects.OwnerRole})
		return router, mRepo, uRepo
	}
	for _, tc := range []struct {
		name   string
		method string
		path   string
		body   string
		status int
		code   httpjson.Code
	}{
		{"addMember trailing second value", http.MethodPost, "/me/company/members", `{"user_id":"` + uuid.New().String() + `","role":"recruiter"} {"extra":1}`, http.StatusBadRequest, httpjson.CodeInvalidRequest},
		{"addMember oversized padding", http.MethodPost, "/me/company/members", waveAOversizedBody(t, `{"user_id":"`+uuid.New().String()+`","role":"recruiter"}`), http.StatusRequestEntityTooLarge, httpjson.CodePayloadTooLarge},
		{"updateMemberRole trailing second value", http.MethodPatch, "/me/company/members/" + uuid.New().String(), `{"role":"owner"} {"extra":1}`, http.StatusBadRequest, httpjson.CodeInvalidRequest},
		{"updateMemberRole oversized padding", http.MethodPatch, "/me/company/members/" + uuid.New().String(), waveAOversizedBody(t, `{"role":"owner"}`), http.StatusRequestEntityTooLarge, httpjson.CodePayloadTooLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			router, mRepo, uRepo := newDeps()
			rec := doReq(t, router, tc.method, tc.path, tc.body)
			assertNoMemberWrites(t, mRepo, uRepo)
			assertWaveADecodeEnvelope(t, rec, tc.status, tc.code)
		})
	}
}
