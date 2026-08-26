// Package usecases (companies): the SoftDeleteCompany orchestrator for
// DELETE /me/company (companies-write slice, design D12 DELETE flow).
//
// SoftDeleteCompany runs in 4 steps (design D12 step 1–4):
//
//  1. Read for delete (GetCompanyForUpdate; 0 rows → ErrCompanyNotFound
//     → handler 404; cross-company / non-existent / already-soft-deleted
//     are indistinguishable per the same-company invariant).
//  2. CAS compare (If-Unmodified-Since vs row.UpdatedAt; stale /
//     missing / malformed → ErrConcurrencyConflict → handler 409 +
//     EMPTY body — the spec R4 / D12 asymmetry vs PATCH).
//  3. SoftDelete (adapter owns the pgx.Tx; soft-delete + inline close
//     commit atomically; 0 rows → ErrCompanyNotFound → handler 404).
//  4. (no re-read on success; 204 has no body — design D12 step 4).
//
// Return contract:
//
//	success                            → nil
//	stale / missing / malformed CAS    → ErrConcurrencyConflict (no view)
//	GetCompanyForUpdate → ErrCompanyNotFound → ErrCompanyNotFound
//	SoftDeleteCompany   → ErrCompanyNotFound → ErrCompanyNotFound
//	any 500-class                      → err (propagated unchanged)
package usecases

import (
	"context"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/google/uuid"
)

// SoftDeleteCompany is the DELETE /me/company use case. The caller
// passes `companyID` AND `userID` from `security.CompanyContext`
// (the middleware injects both); the path carries no company_id (and
// the request has no body). `ifUnmodifiedSince` is the parsed RFC 3339
// header value (zero `time.Time{}` when the header is missing or
// malformed — the CAS compare then mismatches deterministically and
// the use case returns ErrConcurrencyConflict, matching the spec
// scenarios "missing If-Unmodified-Since returns 409" / "malformed
// If-Unmodified-Since returns 409").
//
// companies-audit WU2 (design D2/D5/D6/D7):
//   - `userID` sits immediately after `companyID` (identity-pair
//     grouping, mirror of `applications.TransitionApplication`).
//   - the FIRST-step guard (before `GetCompanyForUpdate` and before
//     the CAS compare) returns ErrMissingActorIdentity on a zero
//     actor — no DB read, no audit append.
//   - on the success path the use case mints `eventID` via
//     `uuid.NewV7()` and builds the event via
//     `newCompanyDeletedEvent(...)`. The event's `Metadata` is
//     `nil` at build time — the adapter finalizes the
//     `jobs_closed` scalar via `auditentities.CompanyDeletedMetadata`
//     after the inline `CloseCompanyJobs` returns its rowcount
//     (D1, D9). The event is the LAST argument to
//     `repo.SoftDeleteCompany`.
func (s *CompanyService) SoftDeleteCompany(
	ctx context.Context,
	companyID, userID uuid.UUID,
	ifUnmodifiedSince time.Time,
) error {
	// 0. FIRST-step guard (companies-audit design D6): zero actor →
	//    ErrMissingActorIdentity. Fires BEFORE any DB query and
	//    BEFORE the CAS compare; the audit append is NEVER attempted
	//    for a mis-wired request. The handler classifier maps the
	//    sentinel to 500 with a generic body (no existence leak).
	if userID == uuid.Nil {
		return ErrMissingActorIdentity
	}

	// 1. Read for delete — non-visibility-narrowed (suspended /
	//    pending_verification are visible; tombstoned are NOT —
	//    same-company invariant collapses them at the SQL `deleted_at
	//    IS NULL` predicate).
	current, err := s.repository.GetCompanyForUpdate(ctx, companyID)
	if err != nil {
		return err
	}

	// 2. CAS compare — header vs row.UpdatedAt. A zero token never
	//    equals a real timestamp, so this branch ALSO surfaces the
	//    "missing / malformed If-Unmodified-Since" scenarios.
	if !ifUnmodifiedSince.Equal(current.UpdatedAt) {
		return entities.ErrConcurrencyConflict
	}

	// 3. Build the audit event the adapter will append in the same
	//    `pgx.Tx` after the soft-delete write + the inline
	//    `CloseCompanyJobs` rowcount, and before `tx.Commit` (D7 /
	//    D9). The event ID is a fresh UUIDv7; the adapter does NOT
	//    regenerate it. The metadata is `nil` at build time — the
	//    adapter finalizes via `auditentities.CompanyDeletedMetadata(
	//    int(closedCount))` strictly between `deleted == 1` (and
	//    the successful inline close) and `tx.Commit`. The nil
	//    sentinel at build time is the explicit "finalize me"
	//    handshake between the use case and the adapter.
	eventID, _ := uuid.NewV7()
	event := newCompanyDeletedEvent(eventID, companyID, userID)

	// 4. Soft delete — adapter owns the pgx.Tx; the soft-delete
	//    UPDATE + the inline `jobs.status='closed'` UPDATE commit
	//    atomically (defer tx.Rollback covers every error path).
	//    `ErrCompanyNotFound` propagates untouched (D12 residual
	//    race — the row changed between the use-case GetCompanyForUpdate
	//    and the SQL UPDATE; mapped to handler 404 with NO re-read —
	//    the success path has no body to render).
	if err := s.repository.SoftDeleteCompany(ctx, companyID, current.UpdatedAt, event); err != nil {
		return err
	}

	// 5. No re-read on success. 204 has no body and the post-delete
	//    row's `deleted_at` is not representable in the editor view
	//    DTO (the editor view has no `deleted_at` field — design D8).
	return nil
}
