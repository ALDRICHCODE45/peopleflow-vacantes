// Package dtos (jobs): the editor view returned by PATCH /jobs/{id}
// and embedded as the body of every 409 response.
//
// JobEditorViewDto is the response body for the gated write path
// (design D7): every editable column the row carries, plus `status`
// and `updated_at`, plus the embedded `company{id,name}` block. The
// public-read `SearchJobsItem` is intentionally NOT modified — the
// editor view is a separate DTO (spec requirement: "the system MUST
// NOT modify SearchJobsItem to expose status or updated_at").
//
// The 409 body uses the same wire shape so a CAS-conflict response
// round-trips back to the client without a second request.
package dtos

import "time"

// JobEditorViewDto is the wire shape for the PATCH /jobs/{id} 200 +
// 409 response body. Fields mirror the public-read SearchJobsItem
// exactly, plus `status` and `updated_at`.
//
// `omitempty` on Location/SalaryMin/SalaryMax/PublishedAt keeps a
// NULL column out of the wire rather than rendering `"location": null`.
// `updated_at` carries no omitempty so the editor view ALWAYS tells the
// client when the row last changed (and so the next PATCH can echo it
// back as the CAS token).
//
// The Company field uses the existing `CompanyDto` so the editor view
// is wire-compatible with the public-read item — clients that already
// render `{company: {id, name}}` from the read endpoint can render the
// editor view without a new code path.
type JobEditorViewDto struct {
	ID             string     `json:"id"`
	Title          string     `json:"title"`
	Description    string     `json:"description"`
	WorkMode       string     `json:"work_mode"`
	EmploymentType string     `json:"employment_type"`
	Seniority      string     `json:"seniority"`
	Location       *string    `json:"location,omitempty"`
	SalaryMin      *int       `json:"salary_min,omitempty"`
	SalaryMax      *int       `json:"salary_max,omitempty"`
	SalaryCurrency string     `json:"salary_currency"`
	PublishedAt    *time.Time `json:"published_at,omitempty"`
	Status         string     `json:"status"`
	UpdatedAt      time.Time  `json:"updated_at"`
	Company        CompanyDto `json:"company"`
}
