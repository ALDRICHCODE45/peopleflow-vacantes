// Package usecases (jobs): the SoftDeleteJob orchestrator for
// DELETE /jobs/{id} (jobs-soft-delete slice).
//
// SoftDeleteJob implements the 4-step flow pinned by design D5:
//
//  1. Read for delete         (GetForUpdate — non-visibility-narrowed,
//     company-scoped; 0 rows → ErrJobNotFound
//     → handler 404; cross-company / non-existent
//     / already-soft-deleted are indistinguishable
//     per the same-company invariant).
//  2. CAS compare             (If-Unmodified-Since vs current.UpdatedAt;
//     stale / missing / malformed → (view, ErrConflict)).
//  3. Soft delete             (repo.SoftDelete — atomic UPDATE with the
//     active-company CTE guard; ErrCompanyNotActive
//     / ErrJobNotFound propagate untouched,
//     no re-read — D2).
//  4. (no re-read on success) — 204 has no body and the post-delete row's
//     deleted_at is not representable in the
//     editor view; the success path returns
//     (nil, nil) and the handler writes
//     StatusNoContent.
//
// Return contract:
//
//   - success                              → (nil, nil)
//   - stale / missing / malformed CAS      → (toEditorView(current), ErrConcurrencyConflict)
//   - GetForUpdate → ErrJobNotFound        → (nil, ErrJobNotFound)
//   - SoftDelete → ErrCompanyNotActive     → (nil, ErrCompanyNotActive)
//   - SoftDelete → ErrJobNotFound          → (nil, ErrJobNotFound)   (D2 residual race, no re-read)
//   - any other error                      → (nil, err)
package usecases

import (
	"context"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/google/uuid"
)

// SoftDeleteJob is the DELETE /jobs/{id} use case. The caller passes
// `companyID` from `security.CompanyContext` (the middleware injects
// it); the path carries the job id only — `company_id` is NEVER taken
// from the body (there is no body). `ifUnmodifiedSince` is the parsed
// RFC 3339 header value (zero `time.Time{}` when the header is missing
// or malformed; the CAS compare then mismatches deterministically and
// surfaces the spec scenarios "missing If-Unmodified-Since" /
// "malformed If-Unmodified-Since" → 409 + editor view).
func (s *JobService) SoftDeleteJob(
	ctx context.Context,
	companyID, jobID uuid.UUID,
	ifUnmodifiedSince time.Time,
) (*dtos.JobEditorViewDto, error) {
	// 1. Read for delete — non-visibility-narrowed, company-scoped.
	// 0 rows (non-existent / cross-company / already-soft-deleted) all
	// collapse to ErrJobNotFound at the adapter; the HTTP layer maps to
	// 404 (spec scenarios "cross-company / non-existent / second-DELETE
	// on soft-deleted → 404" are indistinguishable by design).
	current, err := s.repo.GetForUpdate(ctx, jobID, companyID)
	if err != nil {
		return nil, err
	}

	// 2. CAS compare — header vs row.UpdatedAt.
	// A zero token (missing/malformed header) never equals a real
	// timestamp, so this branch ALSO surfaces the spec scenarios
	// "missing If-Unmodified-Since returns 409 with editor view" and
	// "malformed If-Unmodified-Since returns 409 with editor view".
	if !ifUnmodifiedSince.Equal(current.UpdatedAt) {
		return toEditorView(current), entities.ErrConcurrencyConflict
	}

	// 3. Soft delete — atomic UPDATE with the active-company CTE guard
	// from D1/D2. ErrCompanyNotActive propagates untouched → handler
	// 409 "company is not active". ErrJobNotFound propagates untouched
	// (D2 residual race — the row changed between the use-case
	// GetForUpdate and the SQL UPDATE; mapped to handler 404 with NO
	// re-read — the success path has no body to render).
	if err := s.repo.SoftDelete(ctx, jobID, companyID, current.UpdatedAt); err != nil {
		return nil, err
	}

	// 4. No re-read on success. 204 has no body and the post-delete
	// row's deleted_at is not representable in the editor view DTO
	// (locked decision: the editor view has no deleted_at field —
	// design D4/D5 step 4).
	return nil, nil
}
