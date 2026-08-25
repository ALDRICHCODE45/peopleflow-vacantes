// Package dtos (jobs): the input DTO accepted by POST /jobs (design D6).
//
// CreateJobDto is the JSON body shape the handler decodes. The handler
// reads it directly into this struct -- no separate raw request struct.
// encoding/json silently drops unknown keys, which is exactly the
// "immutable/ignored fields" behavior the spec pins: id / company_id /
// status / created_at / updated_at / published_at / deleted_at /
// search_vector MUST NOT appear on this struct, so any client-supplied
// value is dropped at decode time.
//
// Per design D6:
//
//   - Required fields are plain non-pointer strings. Absent (and JSON
//     null on a string field) both decode to "". The use case's step 1
//     (trim + non-empty) rejects empty strings as ErrEmptyTitle /
//     ErrEmptyDescription, so the DTO does not need to enforce
//     non-emptiness itself.
//   - Optional fields are plain *string / *int pointers. Absent AND JSON
//     null both decode to nil -- there is NO tri-state on create (no
//     prior value to "clear"). valueobjects.Optional[T] is intentionally
//     NOT reused here (PATCH-only codec).
//   - salary_currency is *string; nil decodes as nil and the use case
//     defaults it to MXN per design D5.
//   - company_id is intentionally absent: the middleware injects
//     CompanyContext, and any body value would be silently dropped.
package dtos

// CreateJobDto is the JSON body accepted by POST /jobs. See package
// doc for the full design rationale (D6).
type CreateJobDto struct {
	Title          string  `json:"title"`
	Description    string  `json:"description"`
	WorkMode       string  `json:"work_mode"`
	EmploymentType string  `json:"employment_type"`
	Seniority      string  `json:"seniority"`
	Location       *string `json:"location"`
	SalaryMin      *int    `json:"salary_min"`
	SalaryMax      *int    `json:"salary_max"`
	SalaryCurrency *string `json:"salary_currency"`
}

