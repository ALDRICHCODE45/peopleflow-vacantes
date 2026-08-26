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
// passes `companyID` from `security.CompanyContext` (the middleware
// injects it); the path carries no company_id (and the request has no
// body). `ifUnmodifiedSince` is the parsed RFC 3339 header value (zero
// `time.Time{}` when the header is missing or malformed — the CAS
// compare then mismatches deterministically and the use case returns
// ErrConcurrencyConflict, matching the spec scenarios "missing
// If-Unmodified-Since returns 409" / "malformed If-Unmodified-Since
// returns 409").
func (s *CompanyService) SoftDeleteCompany(
	ctx context.Context,
	companyID uuid.UUID,
	ifUnmodifiedSince time.Time,
) error {
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

	// 3. Soft delete — adapter owns the pgx.Tx; the soft-delete
	//    UPDATE + the inline `jobs.status='closed'` UPDATE commit
	//    atomically (defer tx.Rollback covers every error path).
	//    `ErrCompanyNotFound` propagates untouched (D12 residual
	//    race — the row changed between the use-case GetCompanyForUpdate
	//    and the SQL UPDATE; mapped to handler 404 with NO re-read —
	//    the success path has no body to render).
	if err := s.repository.SoftDeleteCompany(ctx, companyID, current.UpdatedAt); err != nil {
		return err
	}

	// 4. No re-read on success. 204 has no body and the post-delete
	//    row's `deleted_at` is not representable in the editor view
	//    DTO (the editor view has no `deleted_at` field — design D8).
	return nil
}
