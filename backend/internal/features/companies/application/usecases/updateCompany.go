// Package usecases (companies): the UpdateCompany orchestrator for
// PATCH /me/company (companies-write slice, design D12 PATCH flow).
//
// UpdateCompany runs in 8 steps (design D12 step 1–8):
//
//  1. Read for update (GetCompanyForUpdate; 0 rows → ErrCompanyNotFound →
//     handler 404; covers non-existent / cross-company / soft-deleted).
//  2. CAS compare (If-Unmodified-Since vs row.UpdatedAt; stale /
//     missing / malformed → (latest view, ErrConcurrencyConflict) →
//     handler 409 + view).
//  3. VO parse on the present fields (name, description, size,
//     founded_year) when present → 400 sentinel propagates.
//  4. Build the patch (UpdateCompanyPatch: tri-state profile columns
//     pass through unchanged; size stores the parsed String(); founded_year
//     stores the int; name / description store the trimmed raw value).
//  5. Update (adapter returns ErrCompanyNotFound on 0 rows; the use
//     case re-reads and either maps to 404 or 409-with-latest-view).
//  6. On 0 rows + re-read empty → ErrCompanyNotFound → handler 404.
//     On 0 rows + re-read returns a row → (latest view,
//     ErrConcurrencyConflict) → handler 409 + latest view.
//  7. On 1 row success → re-read for the authoritative post-write
//     UpdatedAt (the SQL UPDATE used clock_timestamp()).
//  8. Project the editor view and return (view, nil) → handler 200.
//
// Return contract:
//
//	success                            → (view, nil)
//	ErrConcurrencyConflict             → (view, err)            (view = latest editor view)
//	ErrCompanyNotFound                 → (nil, err)
//	any VO 4xx sentinel                → (nil, err)
//	any 500-class                      → (nil, err)
package usecases

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

// UpdateCompany is the PATCH /me/company use case. The caller passes
// `companyID` from `security.CompanyContext` (the middleware injects
// it); the body NEVER carries company_id. `ifUnmodifiedSince` is the
// parsed RFC 3339 header value (zero `time.Time{}` when the header
// is missing or malformed — the CAS compare then mismatches
// deterministically and the use case returns ErrConcurrencyConflict).
func (s *CompanyService) UpdateCompany(
	ctx context.Context,
	companyID uuid.UUID,
	in dtos.UpdateCompanyDto,
	ifUnmodifiedSince time.Time,
) (*dtos.CompanyEditorViewDto, error) {
	// 1. Read for update — non-visibility-narrowed (suspended /
	//    pending_verification are visible; tombstoned are NOT).
	//    0 rows collapse to ErrCompanyNotFound → handler 404.
	current, err := s.repository.GetCompanyForUpdate(ctx, companyID)
	if err != nil {
		return nil, err
	}

	// 2. CAS compare — header vs row.UpdatedAt.
	//    A zero token (missing/malformed header) never equals a real
	//    timestamp, so this branch ALSO surfaces the spec scenarios
	//    "missing If-Unmodified-Since returns 409" and "malformed
	//    If-Unmodified-Since returns 409". The 409 body carries the
	//    latest editor view (spec R3).
	if !ifUnmodifiedSince.Equal(current.UpdatedAt) {
		return toCompanyEditorView(current), entities.ErrConcurrencyConflict
	}

	// 3. VO parse + 4. Build the patch (canonicalize size / founded_year;
	//    trim name / description). Any VO failure surfaces the matching
	//    sentinel; the repo is NEVER reached on a VO failure.
	patch := repositories.UpdateCompanyPatch{
		Website:       in.Website,
		LogoURL:       in.LogoURL,
		Description:   in.Description,
		Size:          in.Size,
		FoundedYear:   in.FoundedYear,
		City:          in.City,
		Country:       in.Country,
		LinkedInURL:   in.LinkedInURL,
		InstagramURL:  in.InstagramURL,
		FacebookURL:   in.FacebookURL,
		TwitterURL:    in.TwitterURL,
		CoverImageURL: in.CoverImageURL,
	}

	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		// The VO rejects empty-after-trim with ErrCompanyNameTooShort
		// (the same sentinel short names produce — both are "name is
		// less than 4 non-space characters").
		name, err := valueobjects.NewCompanyName(trimmed)
		if err != nil {
			return nil, err
		}
		v := name.Value()
		patch.Name = &v
	}

	if in.Description.Set && in.Description.Valid {
		// NewCompanyDescription accepts the empty string; the VO cap
		// fires only on >3000 chars.
		desc, err := valueobjects.NewCompanyDescription(in.Description.Value)
		if err != nil {
			return nil, err
		}
		v := desc.Value()
		// Replace the Optional with a value-set tri-state: Set=true,
		// Valid=true, Value=trimmed. (Description is non-nullable
		// post-update; the VO does not produce a nil result for a
		// well-formed input.)
		patch.Description.Set = true
		patch.Description.Valid = true
		patch.Description.Value = v
	}

	if in.Size.Set && in.Size.Valid {
		parsed, err := valueobjects.ParseCompanySize(in.Size.Value)
		if err != nil {
			return nil, err
		}
		// The DB CHECK `companies_size_check` requires lowercase; the
		// VO already canonicalizes via Parse*. Mirror jobs.salary_*:
		// pass the canonical wire string through so the SQL CASE
		// branch sets the column to the canonical form.
		patch.Size.Set = true
		patch.Size.Valid = true
		patch.Size.Value = parsed.String()
	}

	if in.FoundedYear.Set && in.FoundedYear.Valid {
		// NewFoundedYear applies the dynamic [1800, currentYear+1] rule
		// (the DB CHECK is a static [1800, 2200] — see design §6.7).
		fy, err := valueobjects.NewFoundedYear(in.FoundedYear.Value)
		if err != nil {
			return nil, err
		}
		v := fy.Value()
		patch.FoundedYear.Set = true
		patch.FoundedYear.Valid = true
		patch.FoundedYear.Value = v
	}

	// 5. Update — adapter returns ErrCompanyNotFound on 0 rows.
	if err := s.repository.UpdateCompany(ctx, companyID, patch, current.UpdatedAt); err != nil {
		if errors.Is(err, entities.ErrCompanyNotFound) {
			// 6. Re-read for the latest view (or 404 if the row is
			//    gone — soft-deleted between the use-case
			//    GetCompanyForUpdate and the adapter UPDATE).
			latest, rereadErr := s.repository.GetCompanyForUpdate(ctx, companyID)
			if rereadErr != nil {
				// Row is gone → 404. Use case surfaces
				// ErrCompanyNotFound; handler maps to 404.
				return nil, entities.ErrCompanyNotFound
			}
			// Row is still there, just changed (a concurrent writer
			// bumped UpdatedAt): 409 + latest editor view.
			return toCompanyEditorView(latest), entities.ErrConcurrencyConflict
		}
		// 23514 → ErrInvalidCompanyStatusTransition (defense-in-depth;
		// unreachable via the designed flow — the use case parses
		// VOs before SQL).
		// Anything else → propagate (HTTP 500).
		return nil, err
	}

	// 7. On 1 row success → re-read for the authoritative post-write
	//    UpdatedAt (the SQL UPDATE used clock_timestamp(); the use
	//    case re-reads for the exact value the client echoes as the
	//    next CAS token).
	fresh, err := s.repository.GetCompanyForUpdate(ctx, companyID)
	if err != nil {
		return nil, err
	}

	// 8. Project the editor view and return.
	return toCompanyEditorView(fresh), nil
}

// toCompanyEditorView is the single projection from the companies
// domain entity to the PATCH wire shape (design D8). The 200 and 409
// paths both go through here so the two responses are wire-shape-
// compatible (spec requirement: "200 and 409 bodies use the same
// shape"). It is intentionally a package-private helper — no other
// layer needs it.
func toCompanyEditorView(c *entities.Company) *dtos.CompanyEditorViewDto {
	view := &dtos.CompanyEditorViewDto{
		ID:              c.ID.String(),
		Name:            c.Name.Value(),
		UpdatedAt:       c.UpdatedAt,
		Website:         c.Website,
		LogoURL:         c.LogoURL,
		City:            c.City,
		Country:         c.Country,
		LinkedInURL:     c.LinkedInURL,
		InstagramURL:    c.InstagramURL,
		FacebookURL:     c.FacebookURL,
		TwitterURL:      c.TwitterURL,
		CoverImageURL:   c.CoverImageURL,
	}
	if c.Description != nil {
		v := c.Description.Value()
		view.Description = &v
	}
	if c.Size != nil {
		v := c.Size.String()
		view.Size = &v
	}
	if c.FoundedYear != nil {
		v := c.FoundedYear.Value()
		view.FoundedYear = &v
	}
	return view
}
