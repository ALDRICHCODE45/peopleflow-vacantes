// Package dtos: PATCH /me/company response shape (companies-write slice,
// design D8).
//
// `CompanyEditorViewDto` is the redacted public company shape that
// PATCH 200 and 409 bodies share. It is a DISTINCT DTO from
// `companyPublicResponse` (companies-write design §6.7 reconciliation):
// the existing public shape exposes `IndustryID`, contradicting the
// spec's `MUST NOT include industry_id` requirement for the PATCH
// wire surface. The new DTO is wire-compatible with `GET /companies/{id}`
// for every field the spec requires (id, name, 12 profile fields,
// updated_at) and intentionally omits `rfc`, `industry_id`, `status`,
// `deleted_at`, and `created_at`.
//
// The `200` and `409` bodies use this same DTO so the client can
// swap shapes without a second round-trip (spec R3 — "200 and 409
// bodies use the same wire shape").
//
// `UpdatedAt` has NO `omitempty` (always echoed as the next CAS
// token); the 12 profile fields use `omitempty` so absent SQL values
// stay absent on the wire.
package dtos

import "time"

// CompanyEditorViewDto is the redacted public company shape returned
// by PATCH /me/company on both `200 OK` (success) and `409 Conflict`
// (CAS mismatch). It deliberately omits `rfc`, `industry_id`,
// `status`, `deleted_at`, and `created_at` per the spec R3
// requirement (locked design D8).
type CompanyEditorViewDto struct {
	ID   string `json:"id"`
	Name string `json:"name"`

	Website     *string `json:"website,omitempty"`
	LogoURL     *string `json:"logo_url,omitempty"`
	Description *string `json:"description,omitempty"`
	Size        *string `json:"size,omitempty"`
	FoundedYear *int    `json:"founded_year,omitempty"`

	City    *string `json:"city,omitempty"`
	Country *string `json:"country,omitempty"`

	LinkedInURL *string `json:"linkedin_url,omitempty"`

	InstagramURL *string `json:"instagram_url,omitempty"`
	FacebookURL  *string `json:"facebook_url,omitempty"`
	TwitterURL   *string `json:"twitter_url,omitempty"`

	CoverImageURL *string `json:"cover_image_url,omitempty"`

	UpdatedAt time.Time `json:"updated_at"`
}
