package usecases

import (
	"context"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/cursor"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
)

// DefaultPageLimit is the page size used when SearchJobsDto.Limit is
// zero. The constant lives here (not in the DTO) so callers cannot
// silently bypass it by setting Limit to 0 — the use case always
// applies a sane default before inflating to +1.
const DefaultPageLimit = 20

// SearchJobs implements the GET /jobs contract.
//
// Pipeline:
//  1. Normalize filters: nil or whitespace-only strings collapse to
//     nil pointers so the SQL `@seniority::text = ” OR …` predicate
//     in the postgres adapter degenerates to TRUE (no filter).
//  2. Decode the opaque cursor tolerantly — malformed cursors become
//     nil, so the client lands on the first page instead of a 400
//     (Decision 8).
//  3. Request limit+1 rows from the repo. The +1 row is the keyset
//     trick: if it's there, there's another page; if not, this is the
//     last page.
//  4. If len(rows) > pageLimit, trim the visible page and encode the
//     dropped row into NextCursor (Decision 3).
//  5. Project entities → DTOs (wire strings for enums, pointers for
//     nullable DB columns).
//
// SearchJobs never returns an error on a malformed cursor — the
// design decision is "tolerant first page, never error". Other errors
// from the repo propagate unchanged so the HTTP layer can map them.
func (s *JobService) SearchJobs(ctx context.Context, in dtos.SearchJobsDto) (dtos.SearchJobsResult, error) {
	pageLimit := in.Limit
	if pageLimit <= 0 {
		pageLimit = DefaultPageLimit
	}

	params := repositories.SearchParams{
		Q:              optString(in.Q),
		Seniority:      optString(in.Seniority),
		WorkMode:       optString(in.WorkMode),
		EmploymentType: optString(in.EmploymentType),
		Location:       optString(in.Location),
		SalaryCurrency: optString(in.SalaryCurrency),
		Cursor:         cursor.Decode(derefString(in.Cursor)),
		Limit:          pageLimit + 1, // +1 row drives the NextCursor decision
	}

	rows, err := s.repo.Search(ctx, params)
	if err != nil {
		return dtos.SearchJobsResult{}, err
	}

	items := make([]dtos.SearchJobsItem, 0, pageLimit)
	var nextCursor *string
	if len(rows) > pageLimit {
		// len(rows) == pageLimit+1 → there is a next page. The visible
		// page is rows[:pageLimit]; the cursor anchors on the LAST
		// visible row (rows[pageLimit-1]) so the SQL `< cursor` keyset
		// returns everything strictly after it — the +1 sentinel row
		// becomes the first row of the next page (never skipped).
		visible := rows[:pageLimit]
		for _, j := range visible {
			items = append(items, toItem(j))
		}
		anchor := rows[pageLimit-1]
		encoded := cursor.Encode(&repositories.Cursor{
			Rank:        anchor.Rank,
			PublishedAt: publishedAt(anchor),
			ID:          anchor.ID,
		})
		nextCursor = &encoded
	} else {
		for _, j := range rows {
			items = append(items, toItem(j))
		}
	}

	return dtos.SearchJobsResult{Items: items, NextCursor: nextCursor}, nil
}

// optString returns nil for empty/whitespace-only strings so the
// adapter treats them as "no filter" (DB sentinel ""). It returns a
// pointer to the original (not a copy) because the adapter doesn't
// mutate it; this keeps the function allocation-free on the hot path.
func optString(p *string) *string {
	if p == nil {
		return nil
	}
	if strings.TrimSpace(*p) == "" {
		return nil
	}
	return p
}

// derefString returns "" for a nil *string so cursor.Decode can stay
// nil-aware without special-casing nil vs empty at the call site.
func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// publishedAt extracts the row's PublishedAt timestamp. The entity
// stores it as *time.Time (NULL on draft/closed rows); the read path
// never returns non-published rows so this is always non-nil in
// practice, but we fall back to the zero value defensively so a
// future bug in the adapter doesn't panic the use case. The codec
// will encode that zero value into a cursor and the SQL keyset will
// still behave correctly.
func publishedAt(j entities.Job) time.Time {
	if j.PublishedAt != nil {
		return *j.PublishedAt
	}
	return time.Time{}
}

// toItem projects an entity into the wire DTO. Enum VOs become their
// String() form (wire format); nullable DB columns stay pointers so
// JSON `omitempty` drops them on the wire; the embedded CompanyRef
// flattens into CompanyDto.
func toItem(j entities.Job) dtos.SearchJobsItem {
	return dtos.SearchJobsItem{
		ID:             j.ID.String(),
		Title:          j.Title,
		Description:    j.Description,
		WorkMode:       j.WorkMode.String(),
		EmploymentType: j.EmploymentType.String(),
		Seniority:      j.Seniority.String(),
		Location:       j.Location,
		SalaryMin:      j.SalaryMin,
		SalaryMax:      j.SalaryMax,
		SalaryCurrency: j.SalaryCurrency.String(),
		PublishedAt:    j.PublishedAt,
		Company: dtos.CompanyDto{
			ID:   j.Company.ID.String(),
			Name: j.Company.Name,
		},
	}
}
