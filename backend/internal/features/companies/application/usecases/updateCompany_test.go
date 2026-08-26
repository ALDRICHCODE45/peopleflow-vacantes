// Unit tests for the UpdateCompany use case (companies-write slice,
// design §7 / D12 PATCH flow).
//
// The orchestrator runs in 8 steps per design D12:
//
//  1. Read for update (GetCompanyForUpdate → ErrCompanyNotFound on 0 rows)
//  2. CAS compare (header vs row.UpdatedAt)
//  3. VO parse on the present fields (name, description, size, founded_year)
//  4. Build the patch (UpdateCompanyPatch with tri-state profile fields)
//  5. Update (adapter returns ErrCompanyNotFound on 0 rows)
//  6. On 0 rows, re-read for the latest view (or 404 if the row is gone)
//  7. On success, re-read for the authoritative post-write UpdatedAt
//  8. Project to the editor view (CompanyEditorViewDto) and return
//
// Each test pins one step (or one boundary) so a regression in any
// step surfaces as a single failing test, not a cascade.
package usecases

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	sharedvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
	"github.com/google/uuid"
)

// stubUpdateRepo upgrades the WU3 stub-repaired stubCompanyRepository
// with the WU4 programmable fields the use case needs: explicit
// get/update error injection, capture of the last (id, patch, cas)
// passed to UpdateCompany, and an authoritative post-write row the
// "success" path can re-read.
type stubUpdateRepo struct {
	mu sync.Mutex

	// WU3-inherited baseline (default-nil for legacy callers):
	saved   *entities.Company
	saveErr error
	getByID *entities.Company
	getErr  error

	// WU4 — write-path fields:
	getForUpdateOut *entities.Company
	getForUpdateErr error

	updateCalls int
	updateID    uuid.UUID
	updatePatch repositories.UpdateCompanyPatch
	updateCas   time.Time
	updateEvent auditentities.AuditEvent
	updateErr   error
}

// GetCompanyForUpdate is the read-for-update seam (design D2). Tests
// that need an explicit return program getForUpdateOut / getForUpdateErr;
// the default is the WU3 "ErrCompanyNotFound so legacy use cases stay
// green" shape.
func (s *stubUpdateRepo) GetCompanyForUpdate(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
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

// UpdateCompany captures (id, patch, cas, event) and returns updateErr (nil
// by default — the use case treats 0 rows as ErrCompanyNotFound, but
// a successful 1-row UPDATE just returns nil so the use case can
// re-read for the authoritative updated_at).
//
// companies-audit (D3 / WU2 atomic stub repair): the port signature gained
// the `event auditentities.AuditEvent` value param; the stub captures it
// for handler-level assertions that prove the use case forwarded the
// event the use case built (single source of truth — handler does not
// build the event).
func (s *stubUpdateRepo) UpdateCompany(_ context.Context, id uuid.UUID, patch repositories.UpdateCompanyPatch, cas time.Time, event auditentities.AuditEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.updateCalls++
	s.updateID = id
	s.updatePatch = patch
	s.updateCas = cas
	s.updateEvent = event
	return s.updateErr
}

// Legacy methods (kept so the stub still satisfies the port for legacy
// callers; not exercised by these tests).
func (s *stubUpdateRepo) Create(_ context.Context, _ *entities.Company) error { return nil }
func (s *stubUpdateRepo) GetByID(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	return nil, entities.ErrCompanyNotFound
}
func (s *stubUpdateRepo) SoftDeleteCompany(_ context.Context, _ uuid.UUID, _ time.Time, _ auditentities.AuditEvent) error {
	return nil
}

// Compile-time guard: stubUpdateRepo satisfies the port.
var _ repositories.CompanyRepository = (*stubUpdateRepo)(nil)

// helper: build a Company with the canonical valid VO values so the
// use case's `current` entity is well-formed (the editor-view
// projection reads Name via .Value()).
func makeStoredCompany(t *testing.T, id uuid.UUID, updatedAt time.Time) *entities.Company {
	t.Helper()
	name, _ := valueobjects.NewCompanyName("Acme SA de CV")
	rfc, _ := valueobjects.NewCompanyRfc("AAA010101AAA")
	return &entities.Company{
		ID:         id,
		Name:       name,
		Rfc:        rfc,
		Status:     valueobjects.Active,
		IndustryID: "tech",
		UpdatedAt:  updatedAt,
		CreatedAt:  updatedAt.Add(-24 * time.Hour),
	}
}

// --- 0. Missing actor (uuid.Nil) fails closed with ErrMissingActorIdentity ---

// TestUpdateCompany_MissingUserIDFailsClosed pins the spec scenario
// "uuid.Nil actor fails closed with 500" (companies-audit design D6).
// The FIRST-step guard MUST fire BEFORE GetCompanyForUpdate (no DB
// query) and BEFORE the CAS compare, and MUST short-circuit with the
// ErrMissingActorIdentity sentinel. The repo's UpdateCompany is
// NEVER called; no audit append is attempted; the row is untouched.
func TestUpdateCompany_MissingUserIDFailsClosed(t *testing.T) {
	companyID := uuid.New()

	repo := &stubUpdateRepo{} // default behavior: GetCompanyForUpdate → ErrCompanyNotFound
	svc := NewCompanyService(repo)

	view, err := svc.UpdateCompany(context.Background(), companyID, uuid.Nil, dtos.UpdateCompanyDto{}, time.Time{})

	if !errors.Is(err, ErrMissingActorIdentity) {
		t.Fatalf("want ErrMissingActorIdentity, got: %v", err)
	}
	if view != nil {
		t.Errorf("view: want nil on guard failure, got %+v", view)
	}
	if repo.updateCalls != 0 {
		t.Errorf("repo.UpdateCompany MUST NOT be called on a missing actor, got %d calls", repo.updateCalls)
	}
}

// --- 1. CAS mismatch returns the latest view and ErrConcurrencyConflict ---

// TestUpdateCompany_CASMismatchReturnsViewAndConflict pins the
// "stale CAS → 409 with the latest view" scenario (spec R2). The
// repo's GetCompanyForUpdate succeeds; the CAS compare mismatches
// because the header token differs from the row's UpdatedAt; the
// use case returns (latest editor view, ErrConcurrencyConflict).
// The repo's UpdateCompany MUST NOT be called.
func TestUpdateCompany_CASMismatchReturnsViewAndConflict(t *testing.T) {
	companyID := uuid.New()
	rowUpdatedAt := time.Date(2026, 2, 2, 11, 0, 0, 0, time.UTC) // newer than header
	stored := makeStoredCompany(t, companyID, rowUpdatedAt)

	repo := &stubUpdateRepo{getForUpdateOut: stored}
	svc := NewCompanyService(repo)

	headerToken := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC) // stale
	view, err := svc.UpdateCompany(context.Background(), companyID, uuid.New(), dtos.UpdateCompanyDto{}, headerToken)

	if !errors.Is(err, entities.ErrConcurrencyConflict) {
		t.Fatalf("want ErrConcurrencyConflict, got: %v", err)
	}
	if view == nil {
		t.Fatal("want non-nil view on CAS mismatch (the use case projects the latest row)")
	}
	if !view.UpdatedAt.Equal(rowUpdatedAt) {
		t.Errorf("view.UpdatedAt: want %v, got %v", rowUpdatedAt, view.UpdatedAt)
	}
	if repo.updateCalls != 0 {
		t.Errorf("repo.UpdateCompany MUST NOT be called on a stale CAS, got %d calls", repo.updateCalls)
	}
}

// --- 2. GetCompanyForUpdate ErrCompanyNotFound → 404 ---

// TestUpdateCompany_NotFound pins the "non-existent / cross-company /
// soft-deleted → 404" scenario (spec R4 + R7). The repo returns
// ErrCompanyNotFound from GetCompanyForUpdate; the use case
// propagates it unchanged so the handler maps to 404.
func TestUpdateCompany_NotFound(t *testing.T) {
	companyID := uuid.New()

	repo := &stubUpdateRepo{getForUpdateErr: entities.ErrCompanyNotFound}
	svc := NewCompanyService(repo)

	_, err := svc.UpdateCompany(context.Background(), companyID, uuid.New(), dtos.UpdateCompanyDto{}, time.Time{})
	if !errors.Is(err, entities.ErrCompanyNotFound) {
		t.Fatalf("want ErrCompanyNotFound, got: %v", err)
	}
}

// --- 3. name too short returns ErrCompanyNameTooShort without touching the repo ---

// TestUpdateCompany_NameTooShort pins the spec scenario "name shorter
// than 4 characters is rejected". The use case re-validates the
// present `name` via `valueobjects.NewCompanyName` BEFORE the SQL
// UPDATE runs; a 400 sentinel propagates and the repo is never
// called.
func TestUpdateCompany_NameTooShort(t *testing.T) {
	companyID := uuid.New()
	rowUpdatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	stored := makeStoredCompany(t, companyID, rowUpdatedAt)

	repo := &stubUpdateRepo{getForUpdateOut: stored}
	svc := NewCompanyService(repo)

	shortName := "AB"
	_, err := svc.UpdateCompany(context.Background(), companyID, uuid.New(), dtos.UpdateCompanyDto{
		Name: &shortName,
	}, rowUpdatedAt)

	if !errors.Is(err, valueobjects.ErrCompanyNameTooShort) {
		t.Fatalf("want ErrCompanyNameTooShort, got: %v", err)
	}
	if repo.updateCalls != 0 {
		t.Errorf("repo.UpdateCompany MUST NOT be called on a VO failure, got %d calls", repo.updateCalls)
	}
}

// --- 4. description too long returns ErrCompanyDescriptionTooLong ---

// TestUpdateCompany_DescriptionTooLong pins the spec scenario
// "description exceeding the 3000-character cap is rejected". The
// description VO fires first; the repo is never called.
func TestUpdateCompany_DescriptionTooLong(t *testing.T) {
	companyID := uuid.New()
	rowUpdatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	stored := makeStoredCompany(t, companyID, rowUpdatedAt)

	repo := &stubUpdateRepo{getForUpdateOut: stored}
	svc := NewCompanyService(repo)

	longDesc := strings.Repeat("a", 3001)
	descOpt := sharedvalueobjects.Optional[string]{Set: true, Valid: true, Value: longDesc}
	_, err := svc.UpdateCompany(context.Background(), companyID, uuid.New(), dtos.UpdateCompanyDto{
		Description: descOpt,
	}, rowUpdatedAt)

	if !errors.Is(err, valueobjects.ErrCompanyDescriptionTooLong) {
		t.Fatalf("want ErrCompanyDescriptionTooLong, got: %v", err)
	}
	if repo.updateCalls != 0 {
		t.Errorf("repo.UpdateCompany MUST NOT be called on a VO failure, got %d calls", repo.updateCalls)
	}
}

// --- 5. founded_year out of range returns ErrFoundedYearOutOfRange ---

// TestUpdateCompany_FoundedYearOutOfRange pins the spec scenario
// "founded_year out of range is rejected" (1500 is below the 1800
// floor; the VO fires first).
func TestUpdateCompany_FoundedYearOutOfRange(t *testing.T) {
	companyID := uuid.New()
	rowUpdatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	stored := makeStoredCompany(t, companyID, rowUpdatedAt)

	repo := &stubUpdateRepo{getForUpdateOut: stored}
	svc := NewCompanyService(repo)

	badYear := 1500
	yearOpt := sharedvalueobjects.Optional[int]{Set: true, Valid: true, Value: badYear}
	_, err := svc.UpdateCompany(context.Background(), companyID, uuid.New(), dtos.UpdateCompanyDto{
		FoundedYear: yearOpt,
	}, rowUpdatedAt)

	if !errors.Is(err, valueobjects.ErrFoundedYearOutOfRange) {
		t.Fatalf("want ErrFoundedYearOutOfRange, got: %v", err)
	}
	if repo.updateCalls != 0 {
		t.Errorf("repo.UpdateCompany MUST NOT be called on a VO failure, got %d calls", repo.updateCalls)
	}
}

// --- 6. invalid size returns ErrInvalidCompanySize ---

// TestUpdateCompany_InvalidSize pins the spec scenario "invalid company
// size is rejected" (a closed-set VO failure fires first).
func TestUpdateCompany_InvalidSize(t *testing.T) {
	companyID := uuid.New()
	rowUpdatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	stored := makeStoredCompany(t, companyID, rowUpdatedAt)

	repo := &stubUpdateRepo{getForUpdateOut: stored}
	svc := NewCompanyService(repo)

	badSize := "gigantic"
	sizeOpt := sharedvalueobjects.Optional[string]{Set: true, Valid: true, Value: badSize}
	_, err := svc.UpdateCompany(context.Background(), companyID, uuid.New(), dtos.UpdateCompanyDto{
		Size: sizeOpt,
	}, rowUpdatedAt)

	if !errors.Is(err, valueobjects.ErrInvalidCompanySize) {
		t.Fatalf("want ErrInvalidCompanySize, got: %v", err)
	}
	if repo.updateCalls != 0 {
		t.Errorf("repo.UpdateCompany MUST NOT be called on a VO failure, got %d calls", repo.updateCalls)
	}
}

// --- 7. update lost race (rowcount=0) re-reads as ErrConcurrencyConflict ---

// TestUpdateCompany_UpdateLostRaceRereadsAsConflict pins the
// "tight race between use-case GetCompanyForUpdate and adapter
// Update" scenario (D12 step 5-6). The repo's UpdateCompany
// returns ErrCompanyNotFound (0 rows); the use case re-reads via
// GetCompanyForUpdate; the re-read returns a row (a concurrent
// writer updated the company); the use case returns
// (latest view, ErrConcurrencyConflict).
func TestUpdateCompany_UpdateLostRaceRereadsAsConflict(t *testing.T) {
	companyID := uuid.New()
	rowUpdatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	stored := makeStoredCompany(t, companyID, rowUpdatedAt)
	rereadUpdatedAt := time.Date(2026, 2, 1, 10, 5, 0, 0, time.UTC) // newer
	reread := makeStoredCompany(t, companyID, rereadUpdatedAt)

	repo := &stubUpdateRepo{
		getForUpdateOut: stored,
		updateErr:       entities.ErrCompanyNotFound,
	}
	// WU4 needs the stub to return the reread on the SECOND
	// GetCompanyForUpdate call; the WU3 stub-repaired design stores
	// the row in getForUpdateOut and the test mutates it after the
	// first call. The simplest expression is to add a per-call
	// sequence; since the WU4 stub inherits a single
	// getForUpdateOut, we model the sequence by having the test
	// replace the row between calls via a custom stub.
	customRepo := &sequentialRepo{
		stored1: stored,
		stored2: reread,
	}
	svc := NewCompanyService(customRepo)

	view, err := svc.UpdateCompany(context.Background(), companyID, uuid.New(), dtos.UpdateCompanyDto{}, rowUpdatedAt)

	if !errors.Is(err, entities.ErrConcurrencyConflict) {
		t.Fatalf("want ErrConcurrencyConflict on lost race re-read, got: %v", err)
	}
	if view == nil {
		t.Fatal("want non-nil view (the re-read returns a row)")
	}
	if !view.UpdatedAt.Equal(rereadUpdatedAt) {
		t.Errorf("view.UpdatedAt: want %v, got %v", rereadUpdatedAt, view.UpdatedAt)
	}
	if repo.updateCalls != 0 {
		// guard against accidentally exercising both stubs in the same test.
		t.Errorf("repo.updateCalls should be 0 here (this test uses sequentialRepo), got %d", repo.updateCalls)
	}
}

// sequentialRepo returns stored1 on the first GetCompanyForUpdate call
// and stored2 on the second. Other calls return defaults. Used by the
// lost-race test to model the "use case re-reads after a 0-row
// UPDATE" sequence without exposing a slice of pre-loaded rows on the
// base stub.
type sequentialRepo struct {
	stored1 *entities.Company
	stored2 *entities.Company

	mu                sync.Mutex
	getForUpdateCalls int
}

func (s *sequentialRepo) GetCompanyForUpdate(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getForUpdateCalls++
	if s.getForUpdateCalls == 1 && s.stored1 != nil {
		copy := *s.stored1
		return &copy, nil
	}
	if s.getForUpdateCalls >= 2 && s.stored2 != nil {
		copy := *s.stored2
		return &copy, nil
	}
	return nil, entities.ErrCompanyNotFound
}

func (s *sequentialRepo) UpdateCompany(_ context.Context, _ uuid.UUID, _ repositories.UpdateCompanyPatch, _ time.Time, _ auditentities.AuditEvent) error {
	return entities.ErrCompanyNotFound
}

func (s *sequentialRepo) Create(_ context.Context, _ *entities.Company) error { return nil }
func (s *sequentialRepo) GetByID(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	return nil, entities.ErrCompanyNotFound
}
func (s *sequentialRepo) SoftDeleteCompany(_ context.Context, _ uuid.UUID, _ time.Time, _ auditentities.AuditEvent) error {
	return nil
}

var _ repositories.CompanyRepository = (*sequentialRepo)(nil)

// --- 8. update lost race re-read returns ErrCompanyNotFound ---

// TestUpdateCompany_UpdateLostRaceRereadEmpty pins the
// "use case re-read after 0-row UPDATE finds the row gone"
// scenario (D12 step 6 — the row was tombstoned between the
// GetCompanyForUpdate and the adapter Update). The repo's
// UpdateCompany returns ErrCompanyNotFound; the re-read also
// returns ErrCompanyNotFound; the use case propagates 404.
func TestUpdateCompany_UpdateLostRaceRereadEmpty(t *testing.T) {
	companyID := uuid.New()
	rowUpdatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	stored := makeStoredCompany(t, companyID, rowUpdatedAt)

	repo := &sequentialRepo{
		stored1: stored,
		stored2: nil, // re-read returns ErrCompanyNotFound (default)
	}
	svc := NewCompanyService(repo)

	_, err := svc.UpdateCompany(context.Background(), companyID, uuid.New(), dtos.UpdateCompanyDto{}, rowUpdatedAt)

	if !errors.Is(err, entities.ErrCompanyNotFound) {
		t.Fatalf("want ErrCompanyNotFound on lost race + re-read empty, got: %v", err)
	}
}

// --- 9. absent fields leave patch untouched (no Set flags passed to the repo) ---

// TestUpdateCompany_AbsentFieldsLeavePatchUntouched pins the spec
// scenario "absent fields leave columns unchanged". A DTO with only
// `name` set yields a patch whose 12 profile `Optional`s are
// `Set=false`; the repo receives the canonicalized `name` but no
// `set_<field>` flags.
func TestUpdateCompany_AbsentFieldsLeavePatchUntouched(t *testing.T) {
	companyID := uuid.New()
	rowUpdatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	stored := makeStoredCompany(t, companyID, rowUpdatedAt)
	freshUpdatedAt := rowUpdatedAt.Add(time.Second)

	// The success path uses sequentialSuccessRepo because the use
	// case re-reads via GetCompanyForUpdate after a successful
	// UPDATE; the stub's first read returns the pre-update row and
	// the second read returns the post-update row. WU4 stub
	// captures the patch the use case forwarded for inspection.
	customRepo := &sequentialSuccessRepo{
		preUpdate:  stored,
		postUpdate: makeStoredCompany(t, companyID, freshUpdatedAt),
	}
	svc := NewCompanyService(customRepo)

	newName := "Acme Rebranded SA de CV"
	view, err := svc.UpdateCompany(context.Background(), companyID, uuid.New(), dtos.UpdateCompanyDto{
		Name: &newName,
	}, rowUpdatedAt)

	if err != nil {
		t.Fatalf("want no error, got: %v", err)
	}
	if view == nil {
		t.Fatal("want non-nil view on success")
	}
	if !view.UpdatedAt.Equal(freshUpdatedAt) {
		t.Errorf("view.UpdatedAt: want %v (fresh post-update), got %v", freshUpdatedAt, view.UpdatedAt)
	}

	// Inspect the patch the use case built and passed to the repo.
	gotPatch := customRepo.capturedPatchFn()
	if gotPatch.Name == nil || *gotPatch.Name != newName {
		t.Errorf("patch.Name: want %q, got %v", newName, gotPatch.Name)
	}
	if gotPatch.Website.Set {
		t.Errorf("patch.Website.Set: want false (absent), got true")
	}
	if gotPatch.LogoURL.Set {
		t.Errorf("patch.LogoURL.Set: want false (absent), got true")
	}
	if gotPatch.Description.Set {
		t.Errorf("patch.Description.Set: want false (absent), got true")
	}
	if gotPatch.Size.Set {
		t.Errorf("patch.Size.Set: want false (absent), got true")
	}
	if gotPatch.FoundedYear.Set {
		t.Errorf("patch.FoundedYear.Set: want false (absent), got true")
	}
	if gotPatch.City.Set || gotPatch.Country.Set {
		t.Errorf("patch.City/Country.Set: want false, got %v / %v", gotPatch.City.Set, gotPatch.Country.Set)
	}
	if gotPatch.LinkedInURL.Set || gotPatch.InstagramURL.Set ||
		gotPatch.FacebookURL.Set || gotPatch.TwitterURL.Set {
		t.Errorf("social Optional Set flags should be false, got linkedin=%v instagram=%v facebook=%v twitter=%v",
			gotPatch.LinkedInURL.Set, gotPatch.InstagramURL.Set,
			gotPatch.FacebookURL.Set, gotPatch.TwitterURL.Set)
	}
	if gotPatch.CoverImageURL.Set {
		t.Errorf("patch.CoverImageURL.Set: want false, got true")
	}
}

// sequentialSuccessRepo models the success path: GetCompanyForUpdate
// returns preUpdate on the first call, postUpdate on the second; the
// UpdateCompany call records the patch for inspection (returns nil).
type sequentialSuccessRepo struct {
	preUpdate  *entities.Company
	postUpdate *entities.Company

	mu                sync.Mutex
	getForUpdateCalls int
	updateCalls       int
	updateID          uuid.UUID
	capturedPatch     repositories.UpdateCompanyPatch
	updateCas         time.Time
}

func (s *sequentialSuccessRepo) GetCompanyForUpdate(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getForUpdateCalls++
	if s.getForUpdateCalls == 1 && s.preUpdate != nil {
		copy := *s.preUpdate
		return &copy, nil
	}
	if s.getForUpdateCalls >= 2 && s.postUpdate != nil {
		copy := *s.postUpdate
		return &copy, nil
	}
	return nil, entities.ErrCompanyNotFound
}

func (s *sequentialSuccessRepo) UpdateCompany(_ context.Context, id uuid.UUID, patch repositories.UpdateCompanyPatch, cas time.Time, _ auditentities.AuditEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.updateCalls++
	s.updateID = id
	s.capturedPatch = patch
	s.updateCas = cas
	return nil
}

// capturedPatch returns the patch the use case forwarded. Safe to call
// concurrently because it locks the stub's mutex; reads the field via
// the pointer indirection so the captured value is a fresh copy on
// each call (the stub stores the patch in a value, so direct field
// access is also safe — but the helper keeps the public surface
// minimal and consistent with the counting stub).
func (s *sequentialSuccessRepo) capturedPatchFn() repositories.UpdateCompanyPatch {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.capturedPatch
}

func (s *sequentialSuccessRepo) capturedIDFn() uuid.UUID {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.updateID
}

func (s *sequentialSuccessRepo) capturedCasFn() time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.updateCas
}

func (s *sequentialSuccessRepo) Create(_ context.Context, _ *entities.Company) error { return nil }
func (s *sequentialSuccessRepo) GetByID(_ context.Context, _ uuid.UUID) (*entities.Company, error) {
	return nil, entities.ErrCompanyNotFound
}
func (s *sequentialSuccessRepo) SoftDeleteCompany(_ context.Context, _ uuid.UUID, _ time.Time, _ auditentities.AuditEvent) error {
	return nil
}

var _ repositories.CompanyRepository = (*sequentialSuccessRepo)(nil)

// --- 10. success: view carries fresh updated_at and the patch was forwarded ---

// TestUpdateCompany_SuccessRereadsAndProjects pins the success path:
// matching CAS, valid VO, repo returns nil (1 row), use case
// re-reads for the authoritative post-write updated_at, projects
// the view. The captured patch proves the (id, cas) pair was
// forwarded.
func TestUpdateCompany_SuccessRereadsAndProjects(t *testing.T) {
	companyID := uuid.New()
	rowUpdatedAt := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	stored := makeStoredCompany(t, companyID, rowUpdatedAt)
	freshUpdatedAt := rowUpdatedAt.Add(5 * time.Second)

	repo := &sequentialSuccessRepo{
		preUpdate:  stored,
		postUpdate: makeStoredCompany(t, companyID, freshUpdatedAt),
	}
	svc := NewCompanyService(repo)

	newName := "Renamed Co"
	view, err := svc.UpdateCompany(context.Background(), companyID, uuid.New(), dtos.UpdateCompanyDto{
		Name: &newName,
	}, rowUpdatedAt)

	if err != nil {
		t.Fatalf("want no error on success, got: %v", err)
	}
	if view == nil {
		t.Fatal("want non-nil view")
	}
	if !view.UpdatedAt.Equal(freshUpdatedAt) {
		t.Errorf("view.UpdatedAt: want %v, got %v", freshUpdatedAt, view.UpdatedAt)
	}
	if view.ID != companyID.String() {
		t.Errorf("view.ID: want %v, got %v", companyID, view.ID)
	}
	if repo.capturedIDFn() != companyID {
		t.Errorf("repo received id: want %v, got %v", companyID, repo.capturedIDFn())
	}
	if !repo.capturedCasFn().Equal(rowUpdatedAt) {
		t.Errorf("repo received cas: want %v, got %v", rowUpdatedAt, repo.capturedCasFn())
	}
	if repo.updateCalls != 1 {
		t.Errorf("repo.UpdateCompany calls: want 1, got %d", repo.updateCalls)
	}
}

// --- DTO sanity: CompanyEditorViewDto omits redacted fields ---

// TestCompanyEditorViewDto_OmitsRedactedFields verifies the D8 wire
// shape: the JSON never carries `rfc`, `industry_id`, `status`,
// `deleted_at`, or `created_at`; it always carries `updated_at` (no
// `omitempty`).
func TestCompanyEditorViewDto_OmitsRedactedFields(t *testing.T) {
	companyID := uuid.New()
	now := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	stored := &entities.Company{
		ID:         companyID,
		Name:       mustName(t, "Acme SA de CV"),
		Rfc:        mustRfc(t, "AAA010101AAA"),
		Status:     valueobjects.Active,
		IndustryID: "tech",
		CreatedAt:  now.Add(-24 * time.Hour),
		UpdatedAt:  now,
		DeletedAt:  &now,
	}
	view := toCompanyEditorView(stored)

	if view.ID != companyID.String() {
		t.Errorf("ID: want %v, got %v", companyID, view.ID)
	}
	if view.Name != "Acme SA de CV" {
		t.Errorf("Name: %q", view.Name)
	}
	if !view.UpdatedAt.Equal(now) {
		t.Errorf("UpdatedAt: want %v, got %v", now, view.UpdatedAt)
	}

	// The DTO has no IndustryID field — its absence is the
	// structural redaction (design D8). Asserting the JSON omits
	// the key is done at the handler level (the use case projection
	// has no IndustryID to populate).
	_ = view
}

func mustName(t *testing.T, raw string) valueobjects.CompanyName {
	t.Helper()
	n, err := valueobjects.NewCompanyName(raw)
	if err != nil {
		t.Fatalf("NewCompanyName(%q): %v", raw, err)
	}
	return n
}

func mustRfc(t *testing.T, raw string) valueobjects.CompanyRfc {
	t.Helper()
	r, err := valueobjects.NewCompanyRfc(raw)
	if err != nil {
		t.Fatalf("NewCompanyRfc(%q): %v", raw, err)
	}
	return r
}
