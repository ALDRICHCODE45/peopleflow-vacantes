// Unit tests for the SoftDeleteCompany use case (companies-write slice,
// design §7 / D12 DELETE flow).
//
// The orchestrator reads the current row, compares CAS, builds the audit
// event, and asks the adapter to delete atomically. An adapter no-row result
// triggers one classification re-read: present is a conflict, absent is not
// found. Success is never re-read because 204 has no body.
//
// Each test pins one step (or one boundary) so a regression in any
// step surfaces as a single failing test, not a cascade.
package usecases

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/google/uuid"
)

// stubDeleteRepo upgrades the WU3 stub-repaired stubCompanyRepository
// with the WU4 programmable fields the SoftDeleteCompany use case
// needs: explicit get/soft-delete error injection and capture of the
// last (id, cas) passed to SoftDeleteCompany.
type stubDeleteRepo struct {
	mu sync.Mutex

	// WU3-inherited baseline (default-nil for legacy callers):
	saved   *entities.Company
	saveErr error
	getByID *entities.Company
	getErr  error

	// WU4 — delete-path fields:
	getForUpdateOut *entities.Company
	getForUpdateErr error

	softDeleteCalls int
	softDeleteID    uuid.UUID
	softDeleteCas   time.Time
	softDeleteEvent auditentities.AuditEvent
	softDeleteErr   error
}

func (s *stubDeleteRepo) GetCompanyForUpdate(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.getForUpdateErr != nil {
		return nil, s.getForUpdateErr
	}
	if s.getForUpdateOut != nil {
		copy := *s.getForUpdateOut
		return &copy, nil
	}
	return nil, entities.ErrCompanyNotFound
}

func (s *stubDeleteRepo) SoftDeleteCompany(_ context.Context, id uuid.UUID, cas time.Time, event auditentities.AuditEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.softDeleteCalls++
	s.softDeleteID = id
	s.softDeleteCas = cas
	s.softDeleteEvent = event
	return s.softDeleteErr
}

// Legacy methods (kept so the stub still satisfies the port for legacy
// callers; not exercised by these tests).
func (s *stubDeleteRepo) Create(_ context.Context, _ *entities.Company) error { return nil }
func (s *stubDeleteRepo) GetByID(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	return nil, entities.ErrCompanyNotFound
}
func (s *stubDeleteRepo) UpdateCompany(_ context.Context, _ uuid.UUID, _ repositories.UpdateCompanyPatch, _ time.Time, _ auditentities.AuditEvent) error {
	return nil
}

var _ repositories.CompanyRepository = (*stubDeleteRepo)(nil)

// --- 0. Missing actor (uuid.Nil) fails closed with ErrMissingActorIdentity ---

// TestSoftDeleteCompany_MissingUserIDFailsClosed pins the spec scenario
// "uuid.Nil actor fails closed with 500" (companies-audit design D6).
// The FIRST-step guard MUST fire BEFORE GetCompanyForUpdate (no DB
// query) and BEFORE the CAS compare, and MUST short-circuit with the
// ErrMissingActorIdentity sentinel. The repo's SoftDeleteCompany is
// NEVER called; no audit append is attempted; the row is untouched.
func TestSoftDeleteCompany_MissingUserIDFailsClosed(t *testing.T) {
	companyID := uuid.New()

	repo := &stubDeleteRepo{}
	svc := NewCompanyService(repo)

	err := svc.SoftDeleteCompany(context.Background(), companyID, uuid.Nil, time.Time{})

	if !errors.Is(err, ErrMissingActorIdentity) {
		t.Fatalf("want ErrMissingActorIdentity, got: %v", err)
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("repo.SoftDeleteCompany MUST NOT be called on a missing actor, got %d calls", repo.softDeleteCalls)
	}
}

// --- 1. CAS mismatch returns ErrConcurrencyConflict without touching the repo ---

// TestSoftDeleteCompany_CASMismatchReturnsConflictNoView pins the
// "stale CAS → 409 with empty body" scenario (spec R5). The repo's
// GetCompanyForUpdate succeeds; the CAS compare mismatches because
// the header token differs from the row's UpdatedAt; the use case
// returns ErrConcurrencyConflict with NO view (the success path
// also has no view; the 409 body is intentionally empty per design
// §6.7). The repo's SoftDeleteCompany MUST NOT be called.
func TestSoftDeleteCompany_CASMismatchReturnsConflictNoView(t *testing.T) {
	companyID := uuid.New()
	rowUpdatedAt := time.Date(2026, 2, 2, 11, 0, 0, 0, time.UTC)
	stored := makeStoredCompany(t, companyID, rowUpdatedAt)

	repo := &stubDeleteRepo{getForUpdateOut: stored}
	svc := NewCompanyService(repo)

	headerToken := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC) // stale

	err := svc.SoftDeleteCompany(context.Background(), companyID, uuid.New(), headerToken)

	if !errors.Is(err, entities.ErrConcurrencyConflict) {
		t.Fatalf("want ErrConcurrencyConflict, got: %v", err)
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("repo.SoftDeleteCompany MUST NOT be called on a stale CAS, got %d calls", repo.softDeleteCalls)
	}
}

// --- 2. zero CAS token returns ErrConcurrencyConflict (missing/malformed header) ---

// TestSoftDeleteCompany_ZeroTokenReturnsConflict pins the
// "missing If-Unmodified-Since returns 409" and
// "malformed If-Unmodified-Since returns 409" scenarios (spec R5):
// the header parses to the zero `time.Time{}` on absent or malformed
// input; the CAS compare mismatches (a zero token never equals a real
// row's UpdatedAt); the use case returns ErrConcurrencyConflict. The
// repo's SoftDeleteCompany MUST NOT be called.
func TestSoftDeleteCompany_ZeroTokenReturnsConflict(t *testing.T) {
	companyID := uuid.New()
	rowUpdatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	stored := makeStoredCompany(t, companyID, rowUpdatedAt)

	repo := &stubDeleteRepo{getForUpdateOut: stored}
	svc := NewCompanyService(repo)

	err := svc.SoftDeleteCompany(context.Background(), companyID, uuid.New(), time.Time{}) // zero token

	if !errors.Is(err, entities.ErrConcurrencyConflict) {
		t.Fatalf("want ErrConcurrencyConflict on zero CAS token, got: %v", err)
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("repo.SoftDeleteCompany MUST NOT be called on a zero CAS token, got %d calls", repo.softDeleteCalls)
	}
}

// --- 3. GetCompanyForUpdate ErrCompanyNotFound → 404 ---

// TestSoftDeleteCompany_NotFound pins the
// "non-existent / cross-company / already-soft-deleted → 404"
// scenario (spec R4 + R7). The repo returns ErrCompanyNotFound
// from GetCompanyForUpdate; the use case propagates it unchanged
// so the handler maps to 404. The repo's SoftDeleteCompany MUST
// NOT be called.
func TestSoftDeleteCompany_NotFound(t *testing.T) {
	companyID := uuid.New()

	repo := &stubDeleteRepo{getForUpdateErr: entities.ErrCompanyNotFound}
	svc := NewCompanyService(repo)

	err := svc.SoftDeleteCompany(context.Background(), companyID, uuid.New(), time.Time{})

	if !errors.Is(err, entities.ErrCompanyNotFound) {
		t.Fatalf("want ErrCompanyNotFound, got: %v", err)
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("repo.SoftDeleteCompany MUST NOT be called when the read-for-delete misses, got %d calls", repo.softDeleteCalls)
	}
}

// --- 4. success: returns nil; GetCompanyForUpdate called exactly once (no re-read) ---

// TestSoftDeleteCompany_SuccessNoReread pins the success path
// (spec R4 — "owner soft-deletes their company"): matching CAS,
// the repo's SoftDeleteCompany returns nil (1 row), the use case
// returns nil. The design D12 step 4 forbids a re-read on success
// (204 has no body; there is no post-delete editor view to project).
// The test asserts GetCompanyForUpdate is called exactly ONCE.
func TestSoftDeleteCompany_SuccessNoReread(t *testing.T) {
	companyID := uuid.New()
	rowUpdatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	stored := makeStoredCompany(t, companyID, rowUpdatedAt)

	repo := &countingGetRepo{
		getForUpdateOut: stored,
	}
	svc := NewCompanyService(repo)

	err := svc.SoftDeleteCompany(context.Background(), companyID, uuid.New(), rowUpdatedAt)

	if err != nil {
		t.Fatalf("want no error on success, got: %v", err)
	}
	if repo.getForUpdateCalls != 1 {
		t.Errorf("GetCompanyForUpdate: want exactly 1 call (no re-read on success), got %d", repo.getForUpdateCalls)
	}
	if repo.softDeleteCalls != 1 {
		t.Errorf("SoftDeleteCompany: want 1 call, got %d", repo.softDeleteCalls)
	}
	if repo.softDeleteID != companyID {
		t.Errorf("repo received id: want %v, got %v", companyID, repo.softDeleteID)
	}
	if !repo.softDeleteCas.Equal(rowUpdatedAt) {
		t.Errorf("repo received cas: want %v, got %v", rowUpdatedAt, repo.softDeleteCas)
	}
}

// countingGetRepo is a stub that records how many times
// GetCompanyForUpdate is called; the SoftDeleteCompany path
// must invoke it exactly once.
type countingGetRepo struct {
	mu sync.Mutex

	getForUpdateOut   *entities.Company
	getForUpdateErr   error
	getForUpdateCalls int

	softDeleteCalls int
	softDeleteID    uuid.UUID
	softDeleteCas   time.Time
	softDeleteErr   error
}

func (s *countingGetRepo) GetCompanyForUpdate(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getForUpdateCalls++
	if s.getForUpdateErr != nil {
		return nil, s.getForUpdateErr
	}
	if s.getForUpdateOut != nil {
		copy := *s.getForUpdateOut
		return &copy, nil
	}
	return nil, entities.ErrCompanyNotFound
}

func (s *countingGetRepo) SoftDeleteCompany(_ context.Context, id uuid.UUID, cas time.Time, _ auditentities.AuditEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.softDeleteCalls++
	s.softDeleteID = id
	s.softDeleteCas = cas
	return s.softDeleteErr
}

func (s *countingGetRepo) Create(_ context.Context, _ *entities.Company) error { return nil }
func (s *countingGetRepo) GetByID(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	return nil, entities.ErrCompanyNotFound
}
func (s *countingGetRepo) UpdateCompany(_ context.Context, _ uuid.UUID, _ repositories.UpdateCompanyPatch, _ time.Time, _ auditentities.AuditEvent) error {
	return nil
}

var _ repositories.CompanyRepository = (*countingGetRepo)(nil)

// --- 5. repo err propagates unchanged ---

// TestSoftDeleteCompany_RepoErrPropagates pins the "any adapter error
// other than ErrCompanyNotFound propagates untouched so the HTTP layer
// can map to 500". The use case MUST NOT swallow the error or
// translate it into a domain sentinel.
func TestSoftDeleteCompany_RepoErrPropagates(t *testing.T) {
	companyID := uuid.New()
	rowUpdatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	stored := makeStoredCompany(t, companyID, rowUpdatedAt)
	repoErr := entities.ErrInvalidCompanyStatusTransition

	repo := &countingGetRepo{
		getForUpdateOut: stored,
		softDeleteErr:   repoErr,
	}
	svc := NewCompanyService(repo)

	err := svc.SoftDeleteCompany(context.Background(), companyID, uuid.New(), rowUpdatedAt)

	if !errors.Is(err, repoErr) {
		t.Errorf("want repoErr %v to propagate, got: %v", repoErr, err)
	}
}

// --- 6. lost CAS (race) classification (WS2D-A) ------------------------------
//
// Post-WS2D-A: 0-row adapter → re-read. Present (409) / gone (404) /
// non-domain err (propagate 500). Mirrors PATCH step 6 without editor.

type lostCASRepo struct {
	mu              sync.Mutex
	firstGet        *entities.Company
	reReadErr       error
	reReadRow       *entities.Company
	reReadCalls     int
	softDeleteCalls int
	softDeleteErr   error
}

func (s *lostCASRepo) GetCompanyForUpdate(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.reReadCalls == 0 && s.firstGet != nil {
		s.reReadCalls++
		copy := *s.firstGet
		return &copy, nil
	}
	s.reReadCalls++
	if s.reReadErr != nil {
		return nil, s.reReadErr
	}
	if s.reReadRow != nil {
		copy := *s.reReadRow
		return &copy, nil
	}
	return nil, entities.ErrCompanyNotFound
}

func (s *lostCASRepo) SoftDeleteCompany(_ context.Context, _ uuid.UUID, _ time.Time, _ auditentities.AuditEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.softDeleteCalls++
	return s.softDeleteErr
}

func (s *lostCASRepo) Create(_ context.Context, _ *entities.Company) error { return nil }
func (s *lostCASRepo) GetByID(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	return nil, entities.ErrCompanyNotFound
}
func (s *lostCASRepo) UpdateCompany(_ context.Context, _ uuid.UUID, _ repositories.UpdateCompanyPatch, _ time.Time, _ auditentities.AuditEvent) error {
	return nil
}

var _ repositories.CompanyRepository = (*lostCASRepo)(nil)

// TestSoftDeleteCompany_LostCASConflictWhenRowStillPresent: 0-row UPDATE + row still alive → 409.
func TestSoftDeleteCompany_LostCASConflictWhenRowStillPresent(t *testing.T) {
	companyID := uuid.New()
	preRaceUpdatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	postRaceUpdatedAt := preRaceUpdatedAt.Add(1 * time.Nanosecond) // concurrent writer bumped updated_at
	stored := makeStoredCompany(t, companyID, preRaceUpdatedAt)
	postRace := makeStoredCompany(t, companyID, postRaceUpdatedAt)
	repo := &lostCASRepo{
		firstGet:      stored,
		softDeleteErr: entities.ErrCompanyNotFound, // 0-row UPDATE → adapter returns ErrCompanyNotFound
		reReadRow:     postRace,
	}
	svc := NewCompanyService(repo)
	err := svc.SoftDeleteCompany(context.Background(), companyID, uuid.New(), preRaceUpdatedAt) // pre-race token + 0-row UPDATE = lost CAS

	if !errors.Is(err, entities.ErrConcurrencyConflict) {
		t.Fatalf("lost-CAS + row present: want ErrConcurrencyConflict (409), got: %v", err)
	}
	if repo.softDeleteCalls != 1 {
		t.Errorf("SoftDeleteCompany: want 1 call (no retry on lost CAS), got %d", repo.softDeleteCalls)
	}
	if repo.reReadCalls != 2 {
		t.Errorf("GetCompanyForUpdate: want 2 calls (step 1 + re-read), got %d", repo.reReadCalls)
	}
}

// TestSoftDeleteCompany_LostCASReturnsNotFoundWhenRowGone: 0-row UPDATE + row gone → 404.
func TestSoftDeleteCompany_LostCASReturnsNotFoundWhenRowGone(t *testing.T) {
	companyID := uuid.New()
	preRaceUpdatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	stored := makeStoredCompany(t, companyID, preRaceUpdatedAt)
	repo := &lostCASRepo{
		firstGet:      stored,
		softDeleteErr: entities.ErrCompanyNotFound, // 0-row UPDATE
		reReadErr:     entities.ErrCompanyNotFound,
	}
	svc := NewCompanyService(repo)

	err := svc.SoftDeleteCompany(context.Background(), companyID, uuid.New(), preRaceUpdatedAt)

	if !errors.Is(err, entities.ErrCompanyNotFound) {
		t.Fatalf("lost-CAS + row gone: want ErrCompanyNotFound (404), got: %v", err)
	}
	if repo.softDeleteCalls != 1 {
		t.Errorf("SoftDeleteCompany: want 1 call, got %d", repo.softDeleteCalls)
	}
	if repo.reReadCalls != 2 {
		t.Errorf("GetCompanyForUpdate: want 2 calls (step 1 + re-read), got %d", repo.reReadCalls)
	}
}

func TestSoftDeleteCompany_LostCASRereadErrorPropagates(t *testing.T) {
	stored := makeStoredCompany(t, uuid.New(), time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC))
	injected := errors.New("transient db blip")
	repo := &lostCASRepo{
		firstGet:      stored,
		softDeleteErr: entities.ErrCompanyNotFound,
		reReadErr:     injected,
	}
	svc := NewCompanyService(repo)
	err := svc.SoftDeleteCompany(context.Background(), stored.ID, uuid.New(), stored.UpdatedAt)
	if !errors.Is(err, injected) {
		t.Fatalf("want re-read err %v propagated unchanged, got: %v", injected, err)
	}
	if repo.softDeleteCalls != 1 || repo.reReadCalls != 2 {
		t.Errorf("calls: softDelete=%d reRead=%d, want 1+2 (step 1 + re-read)", repo.softDeleteCalls, repo.reReadCalls)
	}
}
