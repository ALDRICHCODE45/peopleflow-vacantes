// Package usecases (jobs): the EditJob orchestrator for PATCH /jobs/{id}.
//
// EditJob implements the 8-step flow pinned by design D5:
//
//  1. Read for update         (GetForUpdate)
//  2. CAS compare             (If-Unmodified-Since)
//  3. VO parse                (closed-set fields, status)
//  4. Transition check        (closed-terminal rule + transition table)
//  5. Validation              (title/description non-empty,
//     salary_min <= salary_max)
//  6. Build patch             (UpdatePatch)
//  7. Update                  (adapter; 0 rows → re-read)
//  8. Re-read + project       (editor view for 200 / 409 body)
//
// Return contract:
//
//   - success                  → (view, nil)
//   - ErrConcurrencyConflict   → (view, err)            (view = latest editor view)
//   - ErrJobNotFound           → (nil, err)
//   - ErrInvalidStatusTransition → (nil, err)
//   - any 4xx validation       → (nil, err)
//   - any 500-class            → (nil, err)            (passthrough)
package usecases

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

// isTransitionAllowed encodes the D5/D9 transition table as a pure
// helper (unit-tested in updateJob_test.go). The "closed is terminal"
// rule is enforced as a separate early branch in EditJob so it
// rejects ANY body on a closed row — including field-only edits with
// no `status` field (the spec scenario "closed is terminal").
//
// Closed status also returns false here, so the closed-terminal rule
// and the transition table cover the same case from different angles
// (defense-in-depth).
func isTransitionAllowed(from, to valueobjects.JobStatus) bool {
	switch from {
	case valueobjects.Draft:
		return to == valueobjects.Draft || to == valueobjects.Published
	case valueobjects.Published:
		return to == valueobjects.Published || to == valueobjects.Closed
	default:
		return false
	}
}

// EditJob is the PATCH /jobs/{id} use case. The caller passes
// `companyID` from `security.CompanyContext` (the middleware injects
// it); the body NEVER carries company_id. `ifUnmodifiedSince` is the
// parsed RFC 3339 header value (zero `time.Time{}` when the header
// is missing or malformed).
func (s *JobService) EditJob(
	ctx context.Context,
	companyID, jobID uuid.UUID,
	in dtos.UpdateJobDto,
	ifUnmodifiedSince time.Time,
) (*dtos.JobEditorViewDto, error) {
	// 1. Read for update — non-visibility-narrowed, company-scoped.
	current, err := s.repo.GetForUpdate(ctx, jobID, companyID)
	if err != nil {
		// 0 rows (non-existent / cross-company / soft-deleted) all
		// collapse to ErrJobNotFound at the adapter; the HTTP layer
		// maps to 404.
		return nil, err
	}

	// 2. CAS compare — header vs row.UpdatedAt.
	// A zero token (missing/malformed header) never equals a real
	// timestamp, so this branch ALSO surfaces the spec scenario
	// "missing If-Unmodified-Since returns 409".
	if !ifUnmodifiedSince.Equal(current.UpdatedAt) {
		return toEditorView(current), entities.ErrConcurrencyConflict
	}

	// 3. VO parse. Any unknown value surfaces the matching VO sentinel.
	patch := repositories.UpdatePatch{
		Title:       nilIfEmpty(trimmed(in.Title)),
		Description: nilIfEmpty(trimmed(in.Description)),
		Location:    in.Location,
		SalaryMin:   in.SalaryMin,
		SalaryMax:   in.SalaryMax,
	}
	if in.Title != nil {
		t := strings.TrimSpace(*in.Title)
		if t == "" {
			return nil, entities.ErrEmptyTitle
		}
		patch.Title = &t
	}
	if in.Description != nil {
		d := strings.TrimSpace(*in.Description)
		if d == "" {
			return nil, entities.ErrEmptyDescription
		}
		patch.Description = &d
	}

	// Closed-set VOs: parse via the canonical Parse*. Failure → 400.
	if in.WorkMode != nil {
		w, err := valueobjects.ParseWorkMode(*in.WorkMode)
		if err != nil {
			return nil, err
		}
		patch.WorkMode = &w
	}
	if in.EmploymentType != nil {
		et, err := valueobjects.ParseEmploymentType(*in.EmploymentType)
		if err != nil {
			return nil, err
		}
		patch.EmploymentType = &et
	}
	if in.Seniority != nil {
		sn, err := valueobjects.ParseSeniority(*in.Seniority)
		if err != nil {
			return nil, err
		}
		patch.Seniority = &sn
	}
	if in.SalaryCurrency != nil {
		cur, err := valueobjects.ParseSalaryCurrency(*in.SalaryCurrency)
		if err != nil {
			return nil, err
		}
		patch.SalaryCurrency = &cur
	}

	// Status is special: we parse here so we can run the transition
	// check, but we ALSO need the original *string to distinguish
	// absent (nil) from null (skipped here: DTO uses *string so null
	// and absent both decode to nil — design §4.3 "absent vs null
	// per field"). The status field is non-nullable per the spec,
	// so the null-vs-absent nuance doesn't apply to it.
	var newStatus *valueobjects.JobStatus
	if in.Status != nil {
		st, err := valueobjects.ParseJobStatus(*in.Status)
		if err != nil {
			return nil, err
		}
		newStatus = &st
		patch.Status = &st
	}

	// 4. Transition check — closed-terminal rule first (the spec
	// scenario "closed is terminal" rejects ANY body, even field-only
	// edits with no status field). Then the transition table.
	if current.JobStatus == valueobjects.Closed {
		return nil, entities.ErrInvalidStatusTransition
	}
	if newStatus != nil && !isTransitionAllowed(current.JobStatus, *newStatus) {
		return nil, entities.ErrInvalidStatusTransition
	}

	// 5. Validation — salary_min <= salary_max when BOTH present and
	// non-null. The salary-min-only case is permitted (a transient
	// min > existing max state is accepted by the use case; the
	// design decision §11 explicitly excludes a final-state check).
	if patch.SalaryMin.Set && patch.SalaryMin.Valid &&
		patch.SalaryMax.Set && patch.SalaryMax.Valid {
		if patch.SalaryMin.Value > patch.SalaryMax.Value {
			return nil, entities.ErrInvalidSalaryRange
		}
	}

	// 6. (patch already built above via the VO parsing step.)
	_ = patch

	// 7. Update — adapter returns ErrJobNotFound on 0 rows (CAS lost
	// or row gone between read and write). On 0 rows the use case
	// re-reads (step 8 acts as both the conflict and the success path
	// depending on whether the row is still there).
	if err := s.repo.Update(ctx, jobID, companyID, patch, current.UpdatedAt); err != nil {
		if errors.Is(err, entities.ErrJobNotFound) {
			// Re-read for the latest view (used for the 409 body) or
			// to confirm the row is gone (then 404).
			latest, rereadErr := s.repo.GetForUpdate(ctx, jobID, companyID)
			if rereadErr != nil {
				// Row is gone → 404. The use case surfaces
				// ErrJobNotFound so the handler maps to 404 with no
				// body envelope.
				return nil, entities.ErrJobNotFound
			}
			// Row is still there, just changed: 409 + latest editor view.
			return toEditorView(latest), entities.ErrConcurrencyConflict
		}
		// SQLSTATE 23514 → ErrInvalidStatusTransition (defense-in-depth;
		// unreachable via the designed flow).
		// Anything else → propagate (HTTP 500).
		return nil, err
	}

	// 8. Re-read for the authoritative post-update view (the D3 SQL
	// sets `updated_at = now()` — the value the client needs in the
	// response body so the next PATCH can echo it as the CAS token).
	fresh, err := s.repo.GetForUpdate(ctx, jobID, companyID)
	if err != nil {
		return nil, err
	}
	return toEditorView(fresh), nil
}

// toEditorView is the single projection from JobForUpdate (domain) to
// JobEditorViewDto (wire). The 200 and 409 paths both go through here
// so the two responses are wire-shape-compatible (spec requirement:
// "The body of the 409 MUST use the same editor view DTO as a
// successful 200"). It is intentionally a package-private helper —
// no other layer needs it.
func toEditorView(j *entities.JobForUpdate) *dtos.JobEditorViewDto {
	return &dtos.JobEditorViewDto{
		ID:             j.ID.String(),
		Title:          j.Title,
		Description:    j.Description,
		WorkMode:       j.WorkMode.String(),
		EmploymentType: j.EmploymentType.String(),
		Seniority:      j.Seniority.String(),
		Location:       j.Location,
		SalaryMin:      j.SalaryMin,
		SalaryMax:      j.SalaryMax,
		SalaryCurrency: j.SalaryCurrency.String(),
		PublishedAt:    j.PublishedAt,
		Status:         j.JobStatus.String(),
		UpdatedAt:      j.UpdatedAt,
		Company: dtos.CompanyDto{
			ID:   j.Company.ID.String(),
			Name: j.Company.Name,
		},
	}
}

// nilIfEmpty is a tiny helper kept here (instead of inlined into the
// patch construction above) so the code reads top-to-bottom without
// a one-line conditional per field. Currently unused (we trim and
// re-assign in the Title/Description branches directly); reserved
// for future expansion if a field needs a "trim-or-drop" rule.
func nilIfEmpty[T ~string](s *T) *T {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(string(*s))
	if t == "" {
		return nil
	}
	out := T(t)
	return &out
}

// trimmed returns the trimmed copy of s when s is non-nil, otherwise
// nil. Used by future fields that need a "trim-or-untouched" rule
// (today title/description have stricter validation; location/salary
// preserve their values verbatim per design §4.3).
func trimmed(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	return &t
}
