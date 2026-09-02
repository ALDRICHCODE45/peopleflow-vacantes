// Package usecases (companies): the UpdateCompany orchestrator for
// PATCH /me/company (companies-write slice, design D12 PATCH flow).
//
// UpdateCompany (7 steps; D12 step 1–8 with WS2D-A re-read removed):
//
//  1. Read for update (0 rows → 404).  2. CAS compare (mismatch → 409).
//  3. VO parse → 400 sentinel.        4. Build the patch.
//  5. Update (0 rows after step 1 = CAS loss, even if DELETE tombstoned).
//  6. On 0 rows → (pre-race view, ErrConcurrencyConflict).
//  7. On success → re-read for post-write UpdatedAt, project.
//
// Return contract: success → (view, nil); ErrConcurrencyConflict →
// (pre-race view, err); ErrCompanyNotFound / VO 4xx / 500-class → (nil, err).
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
// `companyID` AND `userID` from `security.CompanyContext` (the
// middleware injects both); the body NEVER carries company_id or
// actor_id (IDOR defense + use-case single-source-of-truth for the
// event). `ifUnmodifiedSince` is the parsed RFC 3339 header value
// (zero `time.Time{}` when the header is missing or malformed — the
// CAS compare then mismatches deterministically and the use case
// returns ErrConcurrencyConflict).
//
// companies-audit WU2 (design D2/D5/D6/D7):
//   - `userID` sits immediately after `companyID` (identity-pair
//     grouping, mirror of `applications.TransitionApplication`).
//   - the FIRST-step guard (before `GetCompanyForUpdate` and before
//     the CAS compare) returns ErrMissingActorIdentity on a zero
//     actor — no DB read, no audit append, no event is ever
//     attempted for a mis-wired request (the handler classifier
//     maps the sentinel to 500 with a generic body).
//   - on the success path the use case mints `eventID` via
//     `uuid.NewV7()` and builds the event via
//     `newCompanyUpdatedEvent(...)`; the event is the LAST argument
//     to `repo.UpdateCompany` (mirror of
//     `applications.Create(..., event)`).
func (s *CompanyService) UpdateCompany(
	ctx context.Context,
	companyID, userID uuid.UUID,
	in dtos.UpdateCompanyDto,
	ifUnmodifiedSince time.Time,
) (*dtos.CompanyEditorViewDto, error) {
	// 0. FIRST-step guard (companies-audit design D6): zero actor →
	//    ErrMissingActorIdentity. Fires BEFORE any DB query and
	//    BEFORE the CAS compare; the audit append is NEVER attempted
	//    for a mis-wired request. The handler classifier maps the
	//    sentinel to 500 with a generic body (no existence leak).
	if userID == uuid.Nil {
		return nil, ErrMissingActorIdentity
	}

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

	// 5. Build the audit event the adapter will append in the same
	//    `pgx.Tx` after the SQL UPDATE and before `tx.Commit` (D7 /
	//    D9). The event ID is a fresh UUIDv7; the adapter does NOT
	//    regenerate it. The metadata is the empty object (`{}`) — the
	//    PATCH event carries no profile diff (the 200 OK body already
	//    carries the post-write state, and a diff would leak free-text
	//    PII).
	eventID, _ := uuid.NewV7()
	event := newCompanyUpdatedEvent(eventID, companyID, userID)

	// 6. Update — adapter returns ErrCompanyNotFound on 0 rows AND
	//    appends the event inside the SAME tx (fail-closed co-write).
	if err := s.repository.UpdateCompany(ctx, companyID, patch, current.UpdatedAt, event); err != nil {
		if errors.Is(err, entities.ErrCompanyNotFound) {
			// Post-WS2D-B: ANY 0-row adapter result after step-1
			// observation is a concurrent CAS loss. Re-read removed —
			// return 409 + pre-race editor view (spec R3 shape).
			return toCompanyEditorView(current), entities.ErrConcurrencyConflict
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
		ID:            c.ID.String(),
		Name:          c.Name.Value(),
		UpdatedAt:     c.UpdatedAt,
		Website:       c.Website,
		LogoURL:       c.LogoURL,
		City:          c.City,
		Country:       c.Country,
		LinkedInURL:   c.LinkedInURL,
		InstagramURL:  c.InstagramURL,
		FacebookURL:   c.FacebookURL,
		TwitterURL:    c.TwitterURL,
		CoverImageURL: c.CoverImageURL,
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
