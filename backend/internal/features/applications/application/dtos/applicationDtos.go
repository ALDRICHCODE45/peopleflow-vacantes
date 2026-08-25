// Package dtos holds the wire shapes for the applications bounded context.
// DTOs are the only types the HTTP handler renders; the domain entities
// never reach the wire (mirrors the `jobs` and `candidates` slice boundary).
//
// PII discipline (D12): the candidate snippet surfaces ONLY
// `users.full_name` + `candidate_profiles.{professional_title,
// years_of_experience}`. `cv_s3_key` and `anonymized_at` NEVER appear in
// any DTO — the columns are reserved for the LFPDPPP flow and the slice
// never sets them.
package dtos

import "time"

// ApplyRequestDto is the body for POST /jobs/{jobId}/applications. Every
// field is optional; nil means absent on the wire. Server-managed fields
// (id, job_id, candidate_id, status, cv_s3_key, anonymized_at, created_at,
// updated_at) are intentionally absent from this struct — encoding/json
// ignores body fields that don't bind, so any client attempt to set them
// is silently dropped per spec scenario "server-managed fields ignored".
type ApplyRequestDto struct {
	Source      *string `json:"source"`
	CoverLetter *string `json:"cover_letter"`
}

// TransitionRequestDto is the body for PATCH /jobs/{jobId}/applications/{id}/transition.
type TransitionRequestDto struct {
	Status string `json:"status"`
}

// ApplicationResponse is the full row wire shape for POST /jobs/{jobId}/applications
// (201 body) and PATCH /jobs/{jobId}/applications/{id}/transition (200 body).
//
// cv_s3_key and anonymized_at are deliberately absent — the columns are
// reserved and the slice never surfaces them to clients. Source and
// CoverLetter render as `null` when the stored value is SQL NULL (no
// `omitempty` so the shape is stable).
type ApplicationResponse struct {
	ID          string    `json:"id"`
	JobID       string    `json:"job_id"`
	CandidateID string    `json:"candidate_id"`
	Status      string    `json:"status"`
	Source      *string   `json:"source"`
	CoverLetter *string   `json:"cover_letter"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// CandidateSnippetDto is the PII-minimized candidate projection embedded
// in the recruiter list + detail responses. NO salary, birth_date, phone,
// email, skills, languages, expected_salary, education_level, city,
// address, or bio (D12).
type CandidateSnippetDto struct {
	UserID            string  `json:"user_id"`
	FullName          string  `json:"full_name"`
	ProfessionalTitle *string `json:"professional_title"`
	YearsOfExperience *int    `json:"years_of_experience"`
}

// JobSummaryDto is the thin job pointer embedded in candidate's
// /me/applications list items.
type JobSummaryDto struct {
	ID      string            `json:"id"`
	Title   string            `json:"title"`
	Company CompanySummaryDto `json:"company"`
}

// CompanySummaryDto is the company pointer inside JobSummaryDto.
type CompanySummaryDto struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ApplicationListItemDto is one item in the recruiter list/detail
// responses. NO candidate_id field is rendered separately because the
// embedded `candidate.user_id` carries the same identity.
type ApplicationListItemDto struct {
	ID          string              `json:"id"`
	JobID       string              `json:"job_id"`
	CandidateID string              `json:"candidate_id"`
	Status      string              `json:"status"`
	Source      *string             `json:"source"`
	CoverLetter *string             `json:"cover_letter"`
	CreatedAt   time.Time           `json:"created_at"`
	UpdatedAt   time.Time           `json:"updated_at"`
	Candidate   CandidateSnippetDto `json:"candidate"`
}

// MyApplicationListItemDto is one item in the candidate's GET /me/applications
// response. NO candidate_id field (the caller is the candidate) — only the
// job summary carries the cross-reference.
type MyApplicationListItemDto struct {
	ID          string        `json:"id"`
	JobID       string        `json:"job_id"`
	Status      string        `json:"status"`
	Source      *string       `json:"source"`
	CoverLetter *string       `json:"cover_letter"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
	Job         JobSummaryDto `json:"job"`
}

// MyApplicationsResponse is the envelope for GET /me/applications. The slice
// is always non-nil so the JSON encoder produces `"applications": []` not
// `"applications": null`.
type MyApplicationsResponse struct {
	Applications []MyApplicationListItemDto `json:"applications"`
}

// RecruiterApplicationsResponse is the envelope for GET /jobs/{jobId}/applications.
// The slice is always non-nil so the JSON encoder produces `"applications": []`
// not `"applications": null`.
type RecruiterApplicationsResponse struct {
	Applications []ApplicationListItemDto `json:"applications"`
}
