// Package repositories defines the persistence ports for the companies context.
package repositories

import (
	"context"
	"time"

	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	sharedvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
	"github.com/google/uuid"
)

// UpdateCompanyPatch is the 13-field PATCH body the PATCH /me/company
// use case translates the wire DTO into (companies-write slice, design
// D7). Field-by-field semantics:
//
//   - Name is a plain `*string`: the column is NOT NULL with no
//     clear-to-NULL semantics on PATCH, so absent vs null vs value is
//     not meaningful for it (a present empty string after trim is the
//     VO rejection signal).
//
//   - The twelve profile columns (`Website`, `LogoURL`, `Description`,
//     `Size`, `FoundedYear`, `City`, `Country`, `LinkedInURL`,
//     `InstagramURL`, `FacebookURL`, `TwitterURL`, `CoverImageURL`)
//     use the tri-state `Optional[T]` codec (shared D6 / companies-
//     write D7): absent → column untouched; JSON `null` → clear to SQL
//     NULL; value → set to the value. The 11 string columns use
//     `Optional[string]`; `FoundedYear` uses `Optional[int]` (matches
//     `jobs.SalaryMin` / `jobs.SalaryMax`).
//
// The patch deliberately omits `rfc`, `industry_id`, `status`, `id`,
// `created_at`, `updated_at`, `deleted_at` — those are immutable on
// PATCH (locked §6.2). `company_id` comes from the caller's
// `CompanyContext` (the middleware injects it), not from any patch
// field (IDOR defense).
type UpdateCompanyPatch struct {
	Name        *string
	Website     sharedvalueobjects.Optional[string]
	LogoURL     sharedvalueobjects.Optional[string]
	Description sharedvalueobjects.Optional[string]
	Size        sharedvalueobjects.Optional[string]
	FoundedYear sharedvalueobjects.Optional[int]
	City        sharedvalueobjects.Optional[string]
	Country     sharedvalueobjects.Optional[string]
	LinkedInURL sharedvalueobjects.Optional[string]

	InstagramURL  sharedvalueobjects.Optional[string]
	FacebookURL   sharedvalueobjects.Optional[string]
	TwitterURL    sharedvalueobjects.Optional[string]
	CoverImageURL sharedvalueobjects.Optional[string]
}

// CompanyRepository is the persistence port for the companies aggregate.
// Three methods cover the owner-only write surface (companies-write
// slice, design D2/D12 + companies-audit WU2 D3):
//
//   - GetCompanyForUpdate is the read-for-update / read-for-delete seam
//     for the gated write paths. It reuses `GetCompanyByID`'s visibility
//     rule (active / suspended / pending_verification are visible;
//     tombstoned companies are NOT visible — `deleted_at IS NULL`).
//     `pgx.ErrNoRows → ErrCompanyNotFound`. Today the SQL is
//     byte-for-byte identical to `GetCompanyByID`; the dedicated port
//     method gives a future drift point (e.g. `FOR UPDATE` locking,
//     distinct columns) without overloading the public read.
//
//   - UpdateCompany applies the patch atomically, guarded by CAS
//     `updated_at = casUpdatedAt` and the row predicates
//     (id, deleted_at IS NULL). On 0 rows affected → `ErrCompanyNotFound`
//     (the use case re-reads and either maps to 404 or 409-with-view).
//     On 1 row affected → the adapter appends the supplied audit
//     event IN THE SAME `pgx.Tx` (design D9 — fail-closed co-write,
//     mirror of the applications slice). The `event` parameter is the
//     LAST position on the port signature (D3 — mirror of
//     `applications.Transition(..., event)`); value-not-pointer.
//
//   - SoftDeleteCompany tombstones the row atomically (`deleted_at =
//     now()`, `updated_at = clock_timestamp()`) and inline-closes every
//     non-closed, non-tombstoned job of the company in the SAME
//     `pgx.Tx` (design D5). The inline close's rowcount is finalized
//     into the event's `jobs_closed` metadata via
//     `auditentities.CompanyDeletedMetadata(int)` (D1 — the use case
//     cannot observe the count at build time), then the audit append
//     runs strictly AFTER `deleted == 1` + the successful inline
//     close and strictly BEFORE `tx.Commit`. On 0 rows →
//     `ErrCompanyNotFound` (no append). On 1 row → nil.
type CompanyRepository interface {
	Create(ctx context.Context, company *entities.Company) error
	GetByID(ctx context.Context, id uuid.UUID) (*entities.Company, error)

	GetCompanyForUpdate(ctx context.Context, companyID uuid.UUID) (*entities.Company, error)
	UpdateCompany(ctx context.Context, companyID uuid.UUID, patch UpdateCompanyPatch, casUpdatedAt time.Time, event auditentities.AuditEvent) error
	SoftDeleteCompany(ctx context.Context, companyID uuid.UUID, casUpdatedAt time.Time, event auditentities.AuditEvent) error
}

// CompanyLivenessRepository is the NARROW persistence port for liveness
// probes against the `companies` aggregate
// (require-company-role-tombstone-gate slice). It is intentionally
// segregated from the broader `CompanyRepository`:
//
//   - Interface segregation: the only consumer (the RequireCompanyRole
//     middleware) only needs a boolean to gate on. The broader port's
//     entity hydration, CAS write paths, audit-co-write, and inline
//     job close are dead weight at this call site — extending the
//     broader port would push the middleware's needs onto every other
//     implementer (and onto every test stub).
//
//   - Single-purpose semantics: a row that is present returns
//     `(deleted_at IS NULL)` AS `is_live`; a row that is absent surfaces
//     as pgx.ErrNoRows at the adapter, which is mapped to
//     `entities.ErrCompanyNotFound`. The middleware collapses both
//     `ErrCompanyNotFound` and `false` to the same 403 with reason
//     `"company is inactive"` — the gate MUST NOT reveal which one it
//     saw, because that would leak the existence of soft-deleted
//     companies to a probing caller.
//
//   - No tombstone filter: the SQL carries no `deleted_at IS NULL`
//     predicate. A filtered-out tombstone would defeat the gate (the
//     middleware would treat a soft-deleted company as "missing"
//     instead of "inactive"). The query is byte-for-byte the dedicated
//     read for this port; do NOT reuse GetCompanyByID's tombstone
//     filter, do NOT reuse GetCompanyForUpdate's same SQL.
type CompanyLivenessRepository interface {
	IsCompanyLive(ctx context.Context, companyID uuid.UUID) (bool, error)
}
