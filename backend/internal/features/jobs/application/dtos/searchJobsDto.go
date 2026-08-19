// Package dtos holds the input/output shapes the jobs HTTP boundary
// passes across the application layer. Values stay raw (strings,
// *string, *int) so the use case owns parsing via the domain VOs and
// the search-keyset cursor is opaque to the wire.
package dtos

import "time"

// SearchJobsDto is the GET /jobs input. Every filter is a *string so
// the caller can pass nil for "no filter" — the use case turns nil
// into the DB sentinel "" (matches the SQL
//
//	(@seniority::text = '' OR j.seniority = @seniority::text)
//
// predicate in the design). An empty/whitespace string is treated the
// same as nil for the same reason.
//
// Cursor is the opaque base64url(JSON) blob from a previous response's
// next_cursor; nil on the first page. Limit is the page size; the use
// case handles the limit+1 internal semantics and never reads Limit
// directly.
type SearchJobsDto struct {
	// Q is the full-text search term (browser-passed via `q`). Nil or
	// empty → no search predicate, browse mode.
	Q *string

	// Closed-set filters. Each maps to a domain VO; invalid values
	// are ignored (spec scenario "invalid filter value is ignored"),
	// which the use case handles by skipping them.
	Seniority      *string
	WorkMode       *string
	EmploymentType *string
	Location       *string
	SalaryCurrency *string

	// Cursor is the keyset anchor; nil on the first page.
	Cursor *string

	// Limit is the requested page size. The use case inflates to
	// limit+1 internally so the +1 row can drive NextCursor without
	// a second round-trip.
	Limit int
}

// CompanyDto is the embedded company identity carried in every job
// response: {id, name}. The use case fills it from Job.Company.
type CompanyDto struct {
	ID   string
	Name string
}

// SearchJobsItem is one row in the GET /jobs items[] payload. Enum
// fields are wire strings (domain VO `.String()`); nullable DB columns
// stay as pointers with `omitempty` so a NULL location/salary renders
// as an absent JSON field, not `"location": null`. PublishedAt is a
// *time.Time so a missing publish timestamp renders as omitted — the
// read path never returns a non-published row, but the shape matches
// the column.
type SearchJobsItem struct {
	ID             string
	Title          string
	Description    string
	WorkMode       string
	EmploymentType string
	Seniority      string
	Location       *string
	SalaryMin      *int
	SalaryMax      *int
	SalaryCurrency string
	PublishedAt    *time.Time
	Company        CompanyDto
}

// SearchJobsResult is the GET /jobs envelope. Items is always a
// non-nil slice so JSON encoding produces `[]` rather than `null` on
// an empty page. NextCursor is nil on the last page; otherwise it
// holds the opaque base64url(JSON) cursor for the next page.
type SearchJobsResult struct {
	Items      []SearchJobsItem
	NextCursor *string
}
