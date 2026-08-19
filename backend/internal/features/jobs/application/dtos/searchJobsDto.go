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
//
// Wire format is snake_case to match the rest of the public API; the
// Go field names stay in CamelCase so the `entity → dto` projection
// in `searchJobs.go` reads naturally.
type CompanyDto struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// SearchJobsItem is one row in the GET /jobs items[] payload. Enum
// fields are wire strings (domain VO `.String()`); nullable DB columns
// stay as pointers with `omitempty` so a NULL location/salary renders
// as an absent JSON field, not `"location": null`. PublishedAt is a
// *time.Time so a missing publish timestamp renders as omitted — the
// read path never returns a non-published row, but the shape matches
// the column.
//
// `Company` is reused on the detail endpoint so list items and a
// single-job response share the same wire shape (decisions 4 + 5).
type SearchJobsItem struct {
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
	Company        CompanyDto `json:"company"`
}

// SearchJobsResult is the GET /jobs envelope. Items is always a
// non-nil slice so JSON encoding produces `[]` rather than `null` on
// an empty page — the wire MUST always carry the `items` field, so
// the `Items` tag intentionally omits `omitempty`. NextCursor is nil
// on the last page; otherwise it holds the opaque base64url(JSON)
// cursor for the next page.
//
// `next_cursor` carries `omitempty` so the envelope renders as
// `{"items": [...], "next_cursor": "..."}` on a page with more rows
// and `{"items": [...]}` on the last page — the spec scenario "cursor
// past the end returns empty" treats null/missing identically.
type SearchJobsResult struct {
	Items      []SearchJobsItem `json:"items"`
	NextCursor *string          `json:"next_cursor,omitempty"`
}
