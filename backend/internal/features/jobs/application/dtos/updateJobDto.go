// Package dtos holds the input/output shapes the jobs HTTP boundary
// passes across the application layer. Values stay raw (strings,
// *string, *int) so the use case owns parsing via the domain VOs and
// the search-keyset cursor is opaque to the wire.
package dtos

import (
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
)

// UpdateJobDto is the JSON body accepted by PATCH /jobs/{id}. The
// handler decodes the request body DIRECTLY into this struct — no
// separate raw request struct (encoding/json silently drops unknown
// keys, which is exactly the "immutable/ignored fields" behavior the
// spec pins).
//
// Per design D2 + D7:
//
//   - Pointer-typed field (Title, Description, WorkMode, EmploymentType,
//     Seniority, SalaryCurrency, Status): nil = absent, non-nil = set
//     to the raw value the use case parses via the closed-set VO. The
//     spec only requires null-vs-absent discrimination for the three
//     nullable columns; null on a non-nullable field is treated as
//     "absent" (the spec does not contradict this).
//   - Optional[T] for the three nullable columns (Location, SalaryMin,
//     SalaryMax): absent = Set=false (untouched), JSON null = Set=true
//     & Valid=false (clear to SQL NULL), value = Set=true & Valid=true
//     (set to value).
//   - `company_id`, `id`, `created_at`, `updated_at`, `published_at`,
//     `search_vector`, `deleted_at` are intentionally absent from the
//     struct: `company_id` comes from `CompanyContext` (the middleware),
//     `updated_at` comes from the `If-Unmodified-Since` header, and
//     the rest are immutable.
//
// Unknown / wrong-type JSON keys surface as encoding/json errors
// which the handler maps to 400.
type UpdateJobDto struct {
	Title          *string `json:"title"`
	Description    *string `json:"description"`
	WorkMode       *string `json:"work_mode"`
	EmploymentType *string `json:"employment_type"`
	Seniority      *string `json:"seniority"`
	Location       valueobjects.Optional[string] `json:"location"`
	SalaryMin      valueobjects.Optional[int]    `json:"salary_min"`
	SalaryMax      valueobjects.Optional[int]    `json:"salary_max"`
	SalaryCurrency *string                      `json:"salary_currency"`
	Status         *string                      `json:"status"`
}