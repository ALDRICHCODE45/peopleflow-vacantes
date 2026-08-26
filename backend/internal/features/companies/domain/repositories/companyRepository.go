// Package repositories defines the persistence ports for the companies context.
package repositories

import (
	"context"
	"time"

	sharedvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
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
// slice, design D2/D12):
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
//     On 1 row affected → nil.
//
//   - SoftDeleteCompany tombstones the row atomically (`deleted_at =
//     now()`, `updated_at = clock_timestamp()`) and inline-closes every
//     non-closed, non-tombstoned job of the company in the SAME
//     `pgx.Tx` (design D5). On 0 rows → `ErrCompanyNotFound`. On
//     1 row → nil. The inline close's rowcount is captured as
//     telemetry but NEVER branched on (`0 rows closed` is a
//     legitimate success path).
type CompanyRepository interface {
	Create(ctx context.Context, company *entities.Company) error
	GetByID(ctx context.Context, id uuid.UUID) (*entities.Company, error)

	GetCompanyForUpdate(ctx context.Context, companyID uuid.UUID) (*entities.Company, error)
	UpdateCompany(ctx context.Context, companyID uuid.UUID, patch UpdateCompanyPatch, casUpdatedAt time.Time) error
	SoftDeleteCompany(ctx context.Context, companyID uuid.UUID, casUpdatedAt time.Time) error
}
