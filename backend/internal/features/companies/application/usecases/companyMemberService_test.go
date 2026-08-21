// Package usecases orchestrates the companies application logic. The
// CompanyMemberService is the composition target for the company_membership
// subdomain: it owns the per-request resolver chain for the UNGATED
// `GetMyMembership` endpoint (`sub → users.id → company_members`) and the
// four GATED use cases (ListMembers / AddMember / UpdateRole / RemoveMember)
// that consume the caller's company_id directly from the request context
// (design D6 — "resolves once").
//
// The four gated use cases take a `companyID uuid.UUID` as the second
// argument — the value already resolved by the `RequireCompanyRole`
// middleware (sub → users.id → company_members, design D6). The service
// no longer re-resolves that chain on the gated path: that would be a
// redundant 2-query DB round-trip per request, and the design explicitly
// forbad it. GetMyMembership is ungated (no role gate, no CompanyContext
// in the request context), so it keeps the sub-based resolver — the
// only legitimate place a gated-by-no-role endpoint can see a JWT
// subject.
package usecases

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identityrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	"github.com/google/uuid"
)

// --- fakes -----------------------------------------------------------------

// stubMemberRepository is the in-memory CompanyMemberRepository used by
// these tests. It records every call so assertions can prove the service
// reached the repository (or stopped short of it on a validation failure).
type stubMemberRepository struct {
	mu sync.Mutex

	created             *entities.CompanyMember
	createErr           error
	createCalls         int
	getByUserOut        *entities.CompanyMember
	getByUserErr        error
	getByUserCalls      int
	listOut             []entities.CompanyMember
	listErr             error
	listCalls           int
	lastListCompanyID   uuid.UUID
	lastUpdateID        uuid.UUID
	lastUpdateCompanyID uuid.UUID
	lastUpdateRole      valueobjects.MemberRole
	updateErr           error
	updateCalls         int
	lastRemoveID        uuid.UUID
	lastRemoveCompanyID uuid.UUID
	removeErr           error
	removeCalls         int
}

func (s *stubMemberRepository) Create(_ context.Context, m *entities.CompanyMember) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.createCalls++
	if s.createErr != nil {
		return s.createErr
	}
	s.created = m
	return nil
}

func (s *stubMemberRepository) GetMembershipByUserID(_ context.Context, _ uuid.UUID) (*entities.CompanyMember, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getByUserCalls++
	if s.getByUserErr != nil {
		return nil, s.getByUserErr
	}
	if s.getByUserOut != nil {
		// Defensive copy so a test-side mutation can't leak across tests.
		copy := *s.getByUserOut
		return &copy, nil
	}
	return nil, entities.ErrNotAMember
}

func (s *stubMemberRepository) ListByCompanyID(_ context.Context, companyID uuid.UUID) ([]entities.CompanyMember, error) {
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

func (s *stubMemberRepository) UpdateRole(_ context.Context, id, companyID uuid.UUID, role valueobjects.MemberRole) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.updateCalls++
	s.lastUpdateID = id
	s.lastUpdateCompanyID = companyID
	s.lastUpdateRole = role
	return s.updateErr
}

func (s *stubMemberRepository) Remove(_ context.Context, id, companyID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.removeCalls++
	s.lastRemoveID = id
	s.lastRemoveCompanyID = companyID
	return s.removeErr
}

// stubUserRepository is the in-memory identity UserRepository used by
// these tests. The companies slice's service needs it to resolve the JWT
// sub → users.id at the edge (mirrors candidateService).
type stubUserRepository struct {
	mu         sync.Mutex
	resolved   *identityentities.User
	resolveErr error
	getCalls   int
}

func (s *stubUserRepository) GetByCognitoSub(_ context.Context, _ string) (*identityentities.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getCalls++
	if s.resolveErr != nil {
		return nil, s.resolveErr
	}
	if s.resolved == nil {
		return nil, identityentities.ErrUserNotFound
	}
	return s.resolved, nil
}

// Create and GetByID are not exercised by the membership use cases; the
// stub returns "not implemented" so any accidental call surfaces as a
// test failure rather than a silent nil dereference.
func (s *stubUserRepository) Create(_ context.Context, _ *identityentities.User) (*identityentities.User, error) {
	return nil, errors.New("stubUserRepository.Create: not used by company-member tests")
}

func (s *stubUserRepository) GetByID(_ context.Context, _ uuid.UUID) (*identityentities.User, error) {
	return nil, errors.New("stubUserRepository.GetByID: not used by company-member tests")
}

// stubMemberCompanyRepository is the in-memory companies CompanyRepository
// used by GetMyMembership to fetch the company record. Not every use case
// touches it (ListMembers / AddMember / UpdateRole / RemoveMember don't
// need the company row) but the compile-time guard requires us to wire
// one in when the service composition calls for it.
type stubMemberCompanyRepository struct {
	mu      sync.Mutex
	getByID *entities.Company
	getErr  error
}

func (s *stubMemberCompanyRepository) Create(_ context.Context, _ *entities.Company) error {
	return errors.New("stubMemberCompanyRepository.Create: not used by company-member tests")
}

func (s *stubMemberCompanyRepository) GetByID(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
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

// Compile-time guards: the fakes satisfy the exact port surfaces the
// service will depend on. Future renames break the build at the fake,
// not at the production site.
var (
	_ repositories.CompanyMemberRepository = (*stubMemberRepository)(nil)
	_ identityrepositories.UserRepository  = (*stubUserRepository)(nil)
	_ repositories.CompanyRepository       = (*stubMemberCompanyRepository)(nil)
)

// --- helpers ---------------------------------------------------------------

func makeUser(id uuid.UUID, sub string) *identityentities.User {
	return &identityentities.User{ID: id, CognitoSub: sub}
}

func makeMember(userID, companyID uuid.UUID, role valueobjects.MemberRole) *entities.CompanyMember {
	m, err := entities.NewCompanyMember(userID, companyID, role)
	if err != nil {
		panic(err)
	}
	return m
}

func makeCompany(id uuid.UUID) *entities.Company {
	c, err := entities.NewCompany("Acme SA de CV", "AAA010101AAA", "tech", entities.CompanyProfile{})
	if err != nil {
		panic(err)
	}
	c.ID = id
	return c
}

// newSvc wires the service against fresh stubs. Tests mutate the stubs'
// fields after construction to drive the use case.
func newSvc(
	mRepo *stubMemberRepository,
	uRepo *stubUserRepository,
	cRepo *stubMemberCompanyRepository,
) *CompanyMemberService {
	return NewCompanyMemberService(mRepo, uRepo, cRepo)
}

// --- tests: resolveMember (task 2.6) --------------------------------------

// TestResolveMember_UnknownSubjectIsUnauthorized covers the spec scenario
// "unknown sub is 401": the JWT subject is validly formed but does not
// match any live users.cognito_sub. The service MUST surface this as
// entities.ErrUnknownSubject so the HTTP layer can map to 401, and it MUST
// NOT fall through to the membership lookup (no row read).
func TestResolveMember_UnknownSubjectIsUnauthorized(t *testing.T) {
	mRepo := &stubMemberRepository{}
	uRepo := &stubUserRepository{resolveErr: identityentities.ErrUserNotFound}
	cRepo := &stubMemberCompanyRepository{}
	svc := newSvc(mRepo, uRepo, cRepo)

	_, _, err := svc.GetMyMembership(context.Background(), "missing-sub")
	if !errors.Is(err, entities.ErrUnknownSubject) {
		t.Errorf("expected ErrUnknownSubject, got: %v", err)
	}
	if mRepo.getByUserCalls != 0 {
		t.Errorf("repository.GetMembershipByUserID must not be called when sub is unknown, got %d calls", mRepo.getByUserCalls)
	}
}

// TestResolveMember_NoMembershipIsNotAMember covers the spec scenario
// "non-member gets 404": the JWT subject resolves to a live users row
// with no row, so the membership lookup returns ErrNotAMember and the
// service MUST propagate it unchanged.
func TestResolveMember_NoMembershipIsNotAMember(t *testing.T) {
	userID := uuid.New()
	mRepo := &stubMemberRepository{getByUserErr: entities.ErrNotAMember}
	uRepo := &stubUserRepository{resolved: makeUser(userID, "sub-abc")}
	cRepo := &stubMemberCompanyRepository{}
	svc := newSvc(mRepo, uRepo, cRepo)

	_, _, err := svc.GetMyMembership(context.Background(), "sub-abc")
	if !errors.Is(err, entities.ErrNotAMember) {
		t.Errorf("expected ErrNotAMember, got: %v", err)
	}
	if mRepo.getByUserCalls != 1 {
		t.Errorf("expected exactly 1 GetMembershipByUserID call, got %d", mRepo.getByUserCalls)
	}
}

// --- tests: AddMember ignores body company_id (task 2.7) ------------------

// TestAddMember_UsesCallersCompanyIgnoresBodyCompanyID covers the spec
// scenario "body company_id is ignored": the use case MUST attach the new
// member row to the companyID passed in (the caller's, from the
// CompanyContext the middleware injected) even when the body explicitly
// carries company_id = Y. This is the IDOR-resistant boundary the design
// D6 calls out — and in the new contract the caller-supplied companyID
// comes straight from the middleware, so a body company_id can never
// redirect the row to a foreign company.
func TestAddMember_UsesCallersCompanyIgnoresBodyCompanyID(t *testing.T) {
	callerCompanyID := uuid.New()
	foreignCompanyID := uuid.New()
	targetUserID := uuid.New()

	mRepo := &stubMemberRepository{}
	uRepo := &stubUserRepository{}
	cRepo := &stubMemberCompanyRepository{}
	svc := newSvc(mRepo, uRepo, cRepo)

	dto := dtos.AddMemberDto{
		UserID:    targetUserID,
		Role:      "recruiter",
		CompanyID: &foreignCompanyID, // body carries Y; service MUST ignore it.
	}

	got, err := svc.AddMember(context.Background(), callerCompanyID, dto)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil returned member")
	}
	if mRepo.created == nil {
		t.Fatal("expected repository.Create to be called")
	}
	if mRepo.created.CompanyID != callerCompanyID {
		t.Errorf("created row CompanyID: want %v (passed-in), got %v (body's — IGNORED)", callerCompanyID, mRepo.created.CompanyID)
	}
	if mRepo.created.UserID != targetUserID {
		t.Errorf("created row UserID: want %v, got %v", targetUserID, mRepo.created.UserID)
	}
	if mRepo.created.Role != valueobjects.RecruiterRole {
		t.Errorf("created row Role: want RecruiterRole, got %v", mRepo.created.Role)
	}
	if uRepo.getCalls != 0 {
		t.Errorf("userRepo.GetByCognitoSub must NOT be called by gated use cases (D6 — resolves once), got %d calls", uRepo.getCalls)
	}
}

// TestAddMember_InvalidRoleDoesNotTouchRepository is the defense-in-depth
// companion: the use case rejects an invalid role BEFORE any DB write.
// The repository must not be invoked.
func TestAddMember_InvalidRoleDoesNotTouchRepository(t *testing.T) {
	companyID := uuid.New()

	mRepo := &stubMemberRepository{}
	uRepo := &stubUserRepository{}
	cRepo := &stubMemberCompanyRepository{}
	svc := newSvc(mRepo, uRepo, cRepo)

	_, err := svc.AddMember(context.Background(), companyID, dtos.AddMemberDto{
		UserID: uuid.New(),
		Role:   "admin",
	})
	if !errors.Is(err, valueobjects.ErrInvalidMemberRole) {
		t.Errorf("expected ErrInvalidMemberRole, got: %v", err)
	}
	if mRepo.createCalls != 0 {
		t.Errorf("repository.Create must not be invoked on invalid role, got %d calls", mRepo.createCalls)
	}
}

// --- tests: GetMyMembership / ListMembers / UpdateRole / RemoveMember ------

// TestGetMyMembership_ReturnsMemberAndCompany covers the spec scenario
// "owner gets their membership": the use case resolves the sub, fetches
// the member row, then fetches the company record so the response can
// carry both `(company_id, role)` AND the company record (spec wording).
func TestGetMyMembership_ReturnsMemberAndCompany(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()

	member, _ := entities.NewCompanyMember(userID, companyID, valueobjects.OwnerRole)
	company := makeCompany(companyID)

	mRepo := &stubMemberRepository{getByUserOut: member}
	uRepo := &stubUserRepository{resolved: makeUser(userID, "sub-owner")}
	cRepo := &stubMemberCompanyRepository{getByID: company}
	svc := newSvc(mRepo, uRepo, cRepo)

	gotMember, gotCompany, err := svc.GetMyMembership(context.Background(), "sub-owner")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if gotMember == nil {
		t.Fatal("expected non-nil member")
	}
	if gotCompany == nil {
		t.Fatal("expected non-nil company")
	}
	if gotMember.CompanyID != companyID {
		t.Errorf("member.CompanyID: want %v, got %v", companyID, gotMember.CompanyID)
	}
	if gotMember.Role != valueobjects.OwnerRole {
		t.Errorf("member.Role: want OwnerRole, got %v", gotMember.Role)
	}
	if gotCompany.ID != companyID {
		t.Errorf("company.ID: want %v, got %v", companyID, gotCompany.ID)
	}
}

// TestGetMyMembership_CompanyRepoFailurePropagates is a triangulation
// companion: if the company lookup fails for any reason, the service
// propagates the error rather than silently returning only the member.
func TestGetMyMembership_CompanyRepoFailurePropagates(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()
	member, _ := entities.NewCompanyMember(userID, companyID, valueobjects.RecruiterRole)

	mRepo := &stubMemberRepository{getByUserOut: member}
	uRepo := &stubUserRepository{resolved: makeUser(userID, "sub-recruiter")}
	cRepo := &stubMemberCompanyRepository{getErr: entities.ErrCompanyNotFound}
	svc := newSvc(mRepo, uRepo, cRepo)

	_, _, err := svc.GetMyMembership(context.Background(), "sub-recruiter")
	if !errors.Is(err, entities.ErrCompanyNotFound) {
		t.Errorf("expected ErrCompanyNotFound, got: %v", err)
	}
}

// TestListMembers_ReturnsAllMembers covers the spec scenario "members are
// listed": GET /me/company/members with N members MUST return exactly N
// rows. The repository is invoked with the callerCompanyID passed in by
// the handler (from the injected CompanyContext, design D6 — "resolves
// once"), never any path or body value. The service does NOT consult
// the user repo: the middleware already resolved the chain before this
// use case runs.
func TestListMembers_ReturnsAllMembers(t *testing.T) {
	companyID := uuid.New()

	rows := []entities.CompanyMember{
		*makeMember(uuid.New(), companyID, valueobjects.OwnerRole),
		*makeMember(uuid.New(), companyID, valueobjects.RecruiterRole),
		*makeMember(uuid.New(), companyID, valueobjects.RecruiterRole),
	}

	mRepo := &stubMemberRepository{listOut: rows}
	uRepo := &stubUserRepository{}
	cRepo := &stubMemberCompanyRepository{}
	svc := newSvc(mRepo, uRepo, cRepo)

	got, err := svc.ListMembers(context.Background(), companyID)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if len(got) != 3 {
		t.Errorf("expected 3 members, got %d", len(got))
	}
	if mRepo.listCalls != 1 {
		t.Errorf("expected exactly 1 ListByCompanyID call, got %d", mRepo.listCalls)
	}
	if mRepo.lastListCompanyID != companyID {
		t.Errorf("ListByCompanyID: want companyID %v, got %v (must forward the injected CompanyID, not re-resolve)", companyID, mRepo.lastListCompanyID)
	}
	if uRepo.getCalls != 0 {
		t.Errorf("userRepo.GetByCognitoSub must NOT be called by gated use cases (D6 — resolves once), got %d calls", uRepo.getCalls)
	}
}

// TestListMembers_EmptyIsNotNil covers the "empty list, not nil" invariant:
// JSON encoding must produce `[]`, not `null`, when there are zero members.
func TestListMembers_EmptyIsNotNil(t *testing.T) {
	companyID := uuid.New()

	mRepo := &stubMemberRepository{listOut: nil}
	uRepo := &stubUserRepository{}
	cRepo := &stubMemberCompanyRepository{}
	svc := newSvc(mRepo, uRepo, cRepo)

	got, err := svc.ListMembers(context.Background(), companyID)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil empty slice")
	}
	if len(got) != 0 {
		t.Errorf("expected 0 members, got %d", len(got))
	}
	if mRepo.lastListCompanyID != companyID {
		t.Errorf("ListByCompanyID: want companyID %v, got %v", companyID, mRepo.lastListCompanyID)
	}
}

// TestUpdateRole_CrossCompanyTargetPropagatesNotFound covers the spec
// scenario "cross-company target is rejected": the repository's same-company
// guard (design D7) affects 0 rows when the target member belongs to a
// different company, and the adapter surfaces that as
// entities.ErrMemberNotFound. The use case MUST propagate it unchanged
// so the HTTP layer can map to 404.
func TestUpdateRole_CrossCompanyTargetPropagatesNotFound(t *testing.T) {
	callerCompanyID := uuid.New()

	mRepo := &stubMemberRepository{updateErr: entities.ErrMemberNotFound}
	uRepo := &stubUserRepository{}
	cRepo := &stubMemberCompanyRepository{}
	svc := newSvc(mRepo, uRepo, cRepo)

	err := svc.UpdateRole(context.Background(), callerCompanyID, uuid.New(), dtos.UpdateMemberRoleDto{Role: "owner"})
	if !errors.Is(err, entities.ErrMemberNotFound) {
		t.Errorf("expected ErrMemberNotFound, got: %v", err)
	}
	if mRepo.updateCalls != 1 {
		t.Errorf("expected exactly 1 UpdateRole call, got %d", mRepo.updateCalls)
	}
	if mRepo.lastUpdateCompanyID != callerCompanyID {
		t.Errorf("UpdateRole must be called with passed-in company_id (%v), got %v", callerCompanyID, mRepo.lastUpdateCompanyID)
	}
	if uRepo.getCalls != 0 {
		t.Errorf("userRepo.GetByCognitoSub must NOT be called by gated use cases (D6 — resolves once), got %d calls", uRepo.getCalls)
	}
}

// TestUpdateRole_ForwardsCallersCompanyID covers the spec invariant that
// UpdateRole is the same-company guard at the use-case layer too: the
// target ID comes from the URL path, but the company_id MUST come from
// the passed-in caller company_id (the CompanyContext the middleware
// injected), never from any payload.
func TestUpdateRole_ForwardsCallersCompanyID(t *testing.T) {
	callerCompanyID := uuid.New()

	mRepo := &stubMemberRepository{}
	uRepo := &stubUserRepository{}
	cRepo := &stubMemberCompanyRepository{}
	svc := newSvc(mRepo, uRepo, cRepo)

	targetID := uuid.New()
	if err := svc.UpdateRole(context.Background(), callerCompanyID, targetID, dtos.UpdateMemberRoleDto{Role: "recruiter"}); err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if mRepo.lastUpdateID != targetID {
		t.Errorf("UpdateRole id: want %v, got %v", targetID, mRepo.lastUpdateID)
	}
	if mRepo.lastUpdateCompanyID != callerCompanyID {
		t.Errorf("UpdateRole company_id: want %v (passed-in), got %v", callerCompanyID, mRepo.lastUpdateCompanyID)
	}
	if mRepo.lastUpdateRole != valueobjects.RecruiterRole {
		t.Errorf("UpdateRole role: want RecruiterRole, got %v", mRepo.lastUpdateRole)
	}
	if uRepo.getCalls != 0 {
		t.Errorf("userRepo.GetByCognitoSub must NOT be called by gated use cases (D6 — resolves once), got %d calls", uRepo.getCalls)
	}
}

// TestUpdateRole_InvalidRoleDoesNotTouchRepository is the validation
// guard: bad input must short-circuit BEFORE the repository is invoked.
func TestUpdateRole_InvalidRoleDoesNotTouchRepository(t *testing.T) {
	companyID := uuid.New()

	mRepo := &stubMemberRepository{}
	uRepo := &stubUserRepository{}
	cRepo := &stubMemberCompanyRepository{}
	svc := newSvc(mRepo, uRepo, cRepo)

	err := svc.UpdateRole(context.Background(), companyID, uuid.New(), dtos.UpdateMemberRoleDto{Role: "admin"})
	if !errors.Is(err, valueobjects.ErrInvalidMemberRole) {
		t.Errorf("expected ErrInvalidMemberRole, got: %v", err)
	}
	if mRepo.updateCalls != 0 {
		t.Errorf("repository.UpdateRole must not be invoked on invalid role, got %d calls", mRepo.updateCalls)
	}
}

// TestRemoveMember_CrossCompanyTargetPropagatesNotFound mirrors the
// UpdateRole contract for RemoveMember: the repository's same-company
// guard affects 0 rows when the target belongs to a different company,
// and the use case propagates entities.ErrMemberNotFound unchanged.
func TestRemoveMember_CrossCompanyTargetPropagatesNotFound(t *testing.T) {
	callerCompanyID := uuid.New()

	mRepo := &stubMemberRepository{removeErr: entities.ErrMemberNotFound}
	uRepo := &stubUserRepository{}
	cRepo := &stubMemberCompanyRepository{}
	svc := newSvc(mRepo, uRepo, cRepo)

	err := svc.RemoveMember(context.Background(), callerCompanyID, uuid.New())
	if !errors.Is(err, entities.ErrMemberNotFound) {
		t.Errorf("expected ErrMemberNotFound, got: %v", err)
	}
	if mRepo.removeCalls != 1 {
		t.Errorf("expected exactly 1 Remove call, got %d", mRepo.removeCalls)
	}
	if mRepo.lastRemoveCompanyID != callerCompanyID {
		t.Errorf("Remove must be called with passed-in company_id (%v), got %v", callerCompanyID, mRepo.lastRemoveCompanyID)
	}
	if uRepo.getCalls != 0 {
		t.Errorf("userRepo.GetByCognitoSub must NOT be called by gated use cases (D6 — resolves once), got %d calls", uRepo.getCalls)
	}
}

// TestRemoveMember_ForwardsCallersCompanyID is the Remove companion to
// TestUpdateRole_ForwardsCallersCompanyID — same invariant, different verb.
func TestRemoveMember_ForwardsCallersCompanyID(t *testing.T) {
	callerCompanyID := uuid.New()

	mRepo := &stubMemberRepository{}
	uRepo := &stubUserRepository{}
	cRepo := &stubMemberCompanyRepository{}
	svc := newSvc(mRepo, uRepo, cRepo)

	targetID := uuid.New()
	if err := svc.RemoveMember(context.Background(), callerCompanyID, targetID); err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if mRepo.lastRemoveID != targetID {
		t.Errorf("Remove id: want %v, got %v", targetID, mRepo.lastRemoveID)
	}
	if mRepo.lastRemoveCompanyID != callerCompanyID {
		t.Errorf("Remove company_id: want %v (passed-in), got %v", callerCompanyID, mRepo.lastRemoveCompanyID)
	}
	if uRepo.getCalls != 0 {
		t.Errorf("userRepo.GetByCognitoSub must NOT be called by gated use cases (D6 — resolves once), got %d calls", uRepo.getCalls)
	}
}

// Sanity check: ensure the time import stays live even if a future refactor
// trims the test bodies. Cheap insurance against the unused-import linter.
var _ = time.Now
