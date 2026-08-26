// Package dtos: PATCH /me/company input shape (companies-write slice,
// design D7).
//
// `UpdateCompanyDto` is the JSON body the handler decodes directly.
// Three field-shape rules (D7, locked override of proposal §6.2):
//
//   - Name is `*string`: the column is NOT NULL with no clear-to-NULL
//     semantics on PATCH, so absent vs null vs value is not meaningful
//     for it (a present empty string after trim is the VO rejection
//     signal `ErrCompanyNameTooShort`). nil → absent; non-nil → value.
//
//   - The twelve profile columns (`Website`, `LogoURL`, `Description`,
//     `Size`, `FoundedYear`, `City`, `Country`, `LinkedInURL`,
//     `InstagramURL`, `FacebookURL`, `TwitterURL`, `CoverImageURL`)
//     use the tri-state `Optional[T]` codec (shared D6). The
//     spec is authoritative: "MUST distinguish null from absent for
//     every profile column". A plain `*string` cannot express that
//     (both absent and null decode to nil); only `Optional[T]` can.
//
//   - `Rfc`, `IndustryID`, `Status`, `CompanyID`, `ID`, `CreatedAt`,
//     `UpdatedAt`, `DeletedAt` are intentionally ABSENT from the
//     struct: those are immutable on PATCH (locked §6.2). `encoding/json`
//     silently drops unknown keys, so a client that sends
//     `{"rfc":"NEW","industry_id":"x","status":"suspended"}` gets
//     the same outcome as if they did not send them — the row's
//     `rfc`, `industry_id`, `status` are unchanged.
//
// `CompanyID` is sourced exclusively from `security.CompanyContext` at
// the handler (IDOR defense per spec R1); no `company_id` field here.
package dtos

import (
	sharedvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
)

// UpdateCompanyDto is the input body for PATCH /me/company (design
// D7). All 12 profile fields are `Optional[T]` so the wire format
// distinguishes JSON absent (`Set=false`) from JSON `null`
// (`Set=true, Valid=false`) from a real value (`Set=true, Valid=true`).
type UpdateCompanyDto struct {
	Name *string `json:"name"`

	Website     sharedvalueobjects.Optional[string] `json:"website"`
	LogoURL     sharedvalueobjects.Optional[string] `json:"logo_url"`
	Description sharedvalueobjects.Optional[string] `json:"description"`
	Size        sharedvalueobjects.Optional[string] `json:"size"`
	FoundedYear sharedvalueobjects.Optional[int]    `json:"founded_year"`

	City    sharedvalueobjects.Optional[string] `json:"city"`
	Country sharedvalueobjects.Optional[string] `json:"country"`

	LinkedInURL  sharedvalueobjects.Optional[string] `json:"linkedin_url"`
	InstagramURL sharedvalueobjects.Optional[string] `json:"instagram_url"`
	FacebookURL  sharedvalueobjects.Optional[string] `json:"facebook_url"`
	TwitterURL   sharedvalueobjects.Optional[string] `json:"twitter_url"`

	CoverImageURL sharedvalueobjects.Optional[string] `json:"cover_image_url"`
}
