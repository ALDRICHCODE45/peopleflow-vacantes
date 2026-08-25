// Unit tests for the SoftDeleteJob use case.
//
// SoftDeleteJob is the application-layer orchestrator for DELETE /jobs/{id}
// (jobs-soft-delete slice). It implements the 4-step flow pinned by design
// D5:
//
//  1. Read for delete          (GetForUpdate — non-visibility-narrowed,
//     company-scoped; 0 rows → ErrJobNotFound → 404).
//  2. CAS compare              (If-Unmodified-Since vs current.UpdatedAt;
//     mismatch → (view, ErrConcurrencyConflict)).
//  3. Soft delete              (repo.SoftDelete — atomic UPDATE with the
//     active-company CTE guard from D1/D2;
//     ErrCompanyNotActive / ErrJobNotFound propagate
//     untouched, no re-read — D2).
//  4. (no re-read on success)  — 204 has no body and the post-delete row's
//     deleted_at is not representable in the editor
//     view, so the success path returns (nil, nil)
//     and the handler writes StatusNoContent.
//
// Return contract:
//
//   - success                              → (nil, nil)
//   - stale / missing / malformed CAS      → (toEditorView(current), ErrConcurrencyConflict)
//   - GetForUpdate → ErrJobNotFound        → (nil, ErrJobNotFound)
//   - SoftDelete → ErrCompanyNotActive     → (nil, ErrCompanyNotActive)
//   - SoftDelete → ErrJobNotFound          → (nil, ErrJobNotFound)   (residual race, no re-read — D2)
//   - any other error                      → (nil, err)
//
// The tests pin every cell of the matrix: success, CAS-mismatch (all three
// token shapes), the ErrJobNotFound from GetForUpdate, and the two
// SoftDelete error paths (with the explicit no-re-read invariant for the
// D2 residual race). The Status-agnostic table covers draft / published /
// closed — the use case MUST never branch on current.JobStatus (any
// status is deletable in one DELETE; spec S21/S22/S23).
//
// The stub uses the shared writeStubRepo type from updateJob_test.go,
// extended in Phase 1.2 (atomic with the port extension) with a
// programmable SoftDelete surface (softDeleteErr + capture
// softDeleteCalls / lastSoftDeleteID / lastSoftDeleteCompany /
// lastSoftDeleteCas).
package usecases

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

// --- use-case tests ------------------------------------------------------

// TestSoftDeleteJob_SuccessCallsSoftDeleteWithCAS covers the happy path:
// GetForUpdate returns a row, CAS matches, and the use case forwards the
// jobID + companyID + current.UpdatedAt to the repo's SoftDelete. On
// success it returns (nil, nil) — the handler writes 204 with no body.
func TestSoftDeleteJob_SuccessCallsSoftDeleteWithCAS(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	updatedAt := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, updatedAt)},
		},
	}
	svc := NewJobService(repo)

	view, err := svc.SoftDeleteJob(context.Background(), companyID, jobID, updatedAt)
	if err != nil {
		t.Fatalf("SoftDeleteJob: want nil on success, got %v", err)
	}
	if view != nil {
		t.Errorf("view: want nil on success (204 has no body), got %+v", view)
	}
	if repo.softDeleteCalls != 1 {
		t.Errorf("SoftDelete calls: want 1, got %d", repo.softDeleteCalls)
	}
	if repo.lastSoftDeleteID != jobID {
		t.Errorf("SoftDelete id: want %v, got %v", jobID, repo.lastSoftDeleteID)
	}
	if repo.lastSoftDeleteCompany != companyID {
		t.Errorf("SoftDelete companyID: want %v, got %v", companyID, repo.lastSoftDeleteCompany)
	}
	if !repo.lastSoftDeleteCas.Equal(updatedAt) {
		t.Errorf("SoftDelete cas: want %v, got %v", updatedAt, repo.lastSoftDeleteCas)
	}
}

// TestSoftDeleteJob_StatusAgnostic pins the spec invariants S21/S22/S23:
// any current JobStatus is soft-deletable in one DELETE — the use case
// MUST NOT branch on current.JobStatus. Each row flows through
// GetForUpdate → SoftDelete → (nil, nil).
func TestSoftDeleteJob_StatusAgnostic(t *testing.T) {
	tests := []struct {
		name   string
		status valueobjects.JobStatus
	}{
		{"draft is deletable", valueobjects.Draft},
		{"published is deletable", valueobjects.Published},
		{"closed is deletable", valueobjects.Closed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jobID := uuid.New()
			companyID := uuid.New()
			updatedAt := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

			repo := &writeStubRepo{
				getForUpdateResponses: []getForUpdateResponse{
					{job: makeJobForUpdate(jobID, companyID, tt.status, updatedAt)},
				},
			}
			svc := NewJobService(repo)

			view, err := svc.SoftDeleteJob(context.Background(), companyID, jobID, updatedAt)
			if err != nil {
				t.Fatalf("SoftDeleteJob(%s): want nil, got %v", tt.name, err)
			}
			if view != nil {
				t.Errorf("view: want nil on success, got %+v", view)
			}
			if repo.softDeleteCalls != 1 {
				t.Errorf("SoftDelete calls: want 1, got %d", repo.softDeleteCalls)
			}
			if !repo.lastSoftDeleteCas.Equal(updatedAt) {
				t.Errorf("SoftDelete cas: want %v, got %v", updatedAt, repo.lastSoftDeleteCas)
			}
		})
	}
}

// TestSoftDeleteJob_CASMismatchReturnsConflictWithView covers the spec
// scenarios S11 + S14: a stale `If-Unmodified-Since` (header != row's
// UpdatedAt) returns (toEditorView(current), ErrConcurrencyConflict) and
// the repo's SoftDelete is NOT called. The view carries the same editor
// view DTO the 200/409 PATCH bodies use so the client can re-read.
func TestSoftDeleteJob_CASMismatchReturnsConflictWithView(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	updatedAt := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, updatedAt)},
		},
	}
	svc := NewJobService(repo)

	view, err := svc.SoftDeleteJob(context.Background(), companyID, jobID, updatedAt.Add(-1*time.Hour))
	if !errors.Is(err, entities.ErrConcurrencyConflict) {
		t.Fatalf("err: want ErrConcurrencyConflict, got %v", err)
	}
	if view == nil {
		t.Fatal("view: want non-nil on CAS conflict (409 body is the editor view), got nil")
	}
	if view.UpdatedAt != updatedAt {
		t.Errorf("view.UpdatedAt: want %v, got %v", updatedAt, view.UpdatedAt)
	}
	if view.Status != "draft" {
		t.Errorf("view.Status: want %q, got %q", "draft", view.Status)
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("SoftDelete must NOT be called on CAS mismatch, got %d calls", repo.softDeleteCalls)
	}
}

// TestSoftDeleteJob_ZeroTokenReturnsConflict covers the spec scenarios
// S12 + S13: a missing or malformed `If-Unmodified-Since` header parses
// to time.Time{} (handler parseIfUnmodifiedSince collapses both cases).
// The zero token never equals a real row's UpdatedAt, so the use case
// MUST treat this as a CAS mismatch and return
// (view, ErrConcurrencyConflict) — same shape as a stale token.
func TestSoftDeleteJob_ZeroTokenReturnsConflict(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	updatedAt := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Draft, updatedAt)},
		},
	}
	svc := NewJobService(repo)

	view, err := svc.SoftDeleteJob(context.Background(), companyID, jobID, time.Time{})
	if !errors.Is(err, entities.ErrConcurrencyConflict) {
		t.Fatalf("err: want ErrConcurrencyConflict on zero token, got %v", err)
	}
	if view == nil {
		t.Fatal("view: want non-nil on missing/malformed CAS, got nil")
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("SoftDelete must NOT be called on missing/malformed CAS, got %d calls", repo.softDeleteCalls)
	}
}

// TestSoftDeleteJob_GetForUpdateNotFoundPropagates covers spec scenario
// S28 + the design D5 step 1: the initial GetForUpdate returns
// ErrJobNotFound (non-existent / cross-company / soft-deleted —
// indistinguishable). The use case surfaces (nil, ErrJobNotFound) so the
// handler maps to 404. SoftDelete is NOT called.
func TestSoftDeleteJob_GetForUpdateNotFoundPropagates(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()

	// No queued responses → ErrJobNotFound.
	repo := &writeStubRepo{}
	svc := NewJobService(repo)

	view, err := svc.SoftDeleteJob(context.Background(), companyID, jobID, time.Now().UTC())
	if !errors.Is(err, entities.ErrJobNotFound) {
		t.Fatalf("err: want ErrJobNotFound, got %v", err)
	}
	if view != nil {
		t.Errorf("view: want nil on 404, got %+v", view)
	}
	if repo.softDeleteCalls != 0 {
		t.Errorf("SoftDelete must NOT be called when GetForUpdate returned 404, got %d calls", repo.softDeleteCalls)
	}
}

// TestSoftDeleteJob_SoftDeleteErrCompanyNotActivePropagates covers the
// design D5 step 3 + spec scenario S17/S18: the repo's SoftDelete
// returns ErrCompanyNotActive (the atomic active-company SQL guard
// yielded 0 rows). The use case propagates the sentinel UNTOUCHED — no
// re-read (D2: the row is unchanged, and the success path has no body to
// render). The handler maps to 409 "company is not active".
func TestSoftDeleteJob_SoftDeleteErrCompanyNotActivePropagates(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	updatedAt := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Published, updatedAt)},
		},
		softDeleteErr: entities.ErrCompanyNotActive,
	}
	svc := NewJobService(repo)

	view, err := svc.SoftDeleteJob(context.Background(), companyID, jobID, updatedAt)
	if !errors.Is(err, entities.ErrCompanyNotActive) {
		t.Fatalf("err: want ErrCompanyNotActive, got %v", err)
	}
	if view != nil {
		t.Errorf("view: want nil on ErrCompanyNotActive propagation, got %+v", view)
	}
	if repo.softDeleteCalls != 1 {
		t.Errorf("SoftDelete calls: want 1 (guard evaluated), got %d", repo.softDeleteCalls)
	}
	// D2: gate error MUST NOT trigger a re-read. The use case made ONE
	// GetForUpdate call (the initial read for delete) and exactly ONE
	// SoftDelete call; no second GetForUpdate for an updated view.
	if repo.getForUpdateCalls != 1 {
		t.Errorf("GetForUpdate calls: want 1 (no re-read on gate miss — D2), got %d", repo.getForUpdateCalls)
	}
}

// TestSoftDeleteJob_SoftDeleteErrJobNotFoundPropagatesNoReread covers the
// design D2 residual race: SoftDelete returns ErrJobNotFound (the row
// changed between the use-case GetForUpdate and the SQL UPDATE — a
// concurrent PATCH advanced updated_at, or a concurrent DELETE already
// set deleted_at). The use case propagates the sentinel UNTOUCHED and
// MUST NOT re-read (D2: 204 has no body and the post-delete row's
// deleted_at is not representable in the editor view). The handler maps
// to 404.
func TestSoftDeleteJob_SoftDeleteErrJobNotFoundPropagatesNoReread(t *testing.T) {
	jobID := uuid.New()
	companyID := uuid.New()
	updatedAt := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

	repo := &writeStubRepo{
		getForUpdateResponses: []getForUpdateResponse{
			{job: makeJobForUpdate(jobID, companyID, valueobjects.Published, updatedAt)},
		},
		softDeleteErr: entities.ErrJobNotFound,
	}
	svc := NewJobService(repo)

	view, err := svc.SoftDeleteJob(context.Background(), companyID, jobID, updatedAt)
	if !errors.Is(err, entities.ErrJobNotFound) {
		t.Fatalf("err: want ErrJobNotFound, got %v", err)
	}
	if view != nil {
		t.Errorf("view: want nil on ErrJobNotFound propagation, got %+v", view)
	}
	if repo.softDeleteCalls != 1 {
		t.Errorf("SoftDelete calls: want 1 (residual race evaluated), got %d", repo.softDeleteCalls)
	}
	// D2 pin: even on the ErrJobNotFound residual race, the use case
	// MUST NOT re-read. Exactly one GetForUpdate call (the initial
	// read for delete); exactly one SoftDelete call.
	if repo.getForUpdateCalls != 1 {
		t.Errorf("GetForUpdate calls: want 1 (no re-read on ErrJobNotFound — D2), got %d", repo.getForUpdateCalls)
	}
}
