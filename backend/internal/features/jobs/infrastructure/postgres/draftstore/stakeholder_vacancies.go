package draftstore

import (
	"context"
	"fmt"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/stakeholdervacancies"
	"github.com/google/uuid"
)

var _ stakeholdervacancies.Lister = (*Store)(nil)

// GET /v2/me/company/stakeholder/vacancies (docs/contracts/placement-vacancy-documents-v1.md, P7c, L20): every vacancy of the company,
// never-published drafts included, for the owner and the stakeholder. The scope is the job-drafts list's (schema-2 drafts of the
// session company, `visibleV2Drafts`) read as the owner, whose rule is «every draft of the company»; the order, the keyset and the
// cursor are the list's, and the coverage is the list's `listCoverage` over the same aggregate, so a row can never disagree with
// the job-drafts list row. The documents count is computed in the same statement, from the page's ids only.
//
// counts_by_status (audit gap D20) is read on the first page only, in the same statement (one snapshot with the rows): exact
// counts over the same scope bucketed by the publication the rows carry (no process row → draft, published → active,
// paused → paused, closed → closed whatever the process). A cursor page selects NULLs instead and the page carries none.

// stakeholderMayRead is who may read the list: the company owner and the stakeholder (the metrics viewers). A recruiter keeps to
// the job-drafts list, whose rule is owner-or-active-tramo; the route gate refuses them first and the store agrees with it.
func stakeholderMayRead(role string) bool { return role == roleOwner || role == roleStakeholder }

// stakeholderKindVisibility is the lifecycle's kind and visibility (as the job-drafts list renders them): a replacement is a row
// of vacancy_replacements; visibility is null until the first publication, public for an original, and private only for a
// replacement without a public projection.
func stakeholderKindVisibility(sequence *int32, status *string, hasProjection bool) (string, *string) {
	kind := "original"
	if sequence != nil {
		kind = "replacement"
	}
	if status == nil {
		return kind, nil
	}
	visibility := "public"
	if sequence != nil && !hasProjection {
		visibility = "private"
	}
	return kind, &visibility
}

// ListStakeholderVacancies implements stakeholdervacancies.Lister. One transaction takes the live user, company and membership
// gates (a stakeholder or the owner of the company; anything else is drafts.ErrForbidden) and then ONE statement reads the page,
// the Placement occupants of its vacancies and their documents counts. It writes nothing and takes no draft lock.
func (s *Store) ListStakeholderVacancies(ctx context.Context, companyID, actorID uuid.UUID, req stakeholdervacancies.Request) (stakeholdervacancies.Page, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return stakeholdervacancies.Page{}, fmt.Errorf("begin stakeholder vacancies tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	auth, err := s.lockGates(ctx, tx, companyID, actorID)
	if err != nil {
		return stakeholdervacancies.Page{}, err
	}
	if !stakeholderMayRead(auth.role) {
		return stakeholdervacancies.Page{}, drafts.ErrForbidden
	}

	// visibleV2Drafts takes the owner flag as $2: both readers see the whole company, so it is always true here.
	args := []any{companyID, true, actorID}
	query := `WITH page AS MATERIALIZED (SELECT d.id, d.fields, d.updated_at,
 p.status, p.process_status, c.configuration, c.version AS pipeline_version, last_close.reason,
 vr.sequence, pp.id IS NOT NULL AS has_projection, mc.hiring_headcount
 FROM job_drafts d
 LEFT JOIN vacancy_processes p ON p.id = d.id AND p.company_id = d.company_id
 LEFT JOIN vacancy_replacements vr ON vr.process_id = d.id AND vr.company_id = d.company_id
 LEFT JOIN vacancy_public_projections pp ON pp.id = d.id
 LEFT JOIN job_draft_pipeline_configs c ON c.draft_id = d.id
 LEFT JOIN job_draft_management_configs mc ON mc.draft_id = d.id
 LEFT JOIN LATERAL (
  SELECT reason FROM vacancy_lifecycle_events
  WHERE process_id = p.id AND action = 'close' AND p.status = 'closed'
  ORDER BY lifecycle_version DESC LIMIT 1
 ) last_close ON true
 WHERE ` + visibleV2Drafts
	if req.After != nil {
		args = append(args, req.After.LastUpdatedAt, req.After.LastID)
		query += fmt.Sprintf(` AND (d.updated_at, d.id) < ($%d::timestamptz, $%d::uuid)`, len(args)-1, len(args))
	}
	// The counts CTE re-reads the whole scope without the keyset; it exists on the first page only.
	countsCTE, countsCols, countsJoin := "", "NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint", ""
	if req.After == nil {
		countsCTE = `, status_counts AS (
  SELECT count(*) AS total,
   count(*) FILTER (WHERE p.status IS NULL) AS draft,
   count(*) FILTER (WHERE p.status = 'published') AS active,
   count(*) FILTER (WHERE p.status = 'paused') AS paused,
   count(*) FILTER (WHERE p.status = 'closed') AS closed
  FROM job_drafts d
  LEFT JOIN vacancy_processes p ON p.id = d.id AND p.company_id = d.company_id
  WHERE ` + visibleV2Drafts + `
 )`
		countsCols, countsJoin = "sc.total, sc.draft, sc.active, sc.paused, sc.closed", " CROSS JOIN status_counts sc"
	}
	query += fmt.Sprintf(` ORDER BY d.updated_at DESC, d.id DESC LIMIT %d),
 stage_counts AS (
  SELECT pp.process_id, pp.stage_id, count(*) AS total
  FROM process_participations pp JOIN page ON page.id = pp.process_id
  GROUP BY pp.process_id, pp.stage_id
 ), candidate_counts AS (
  SELECT process_id, jsonb_build_object('by_stage', jsonb_agg(jsonb_build_object('id', stage_id, 'occupants', total))) AS summary
  FROM stage_counts GROUP BY process_id
 ), document_counts AS (
  SELECT draft_id, count(*) AS total FROM placement_documents
  WHERE company_id = $1 AND draft_id IN (SELECT id FROM page) GROUP BY draft_id
 )%s
 SELECT page.*, cc.summary, COALESCE(dc.total, 0), %s FROM page
 LEFT JOIN candidate_counts cc ON cc.process_id = page.id
 LEFT JOIN document_counts dc ON dc.draft_id = page.id%s
 ORDER BY page.updated_at DESC, page.id DESC`, req.Limit+1, countsCTE, countsCols, countsJoin)
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return stakeholdervacancies.Page{}, fmt.Errorf("list stakeholder vacancies: %w", err)
	}
	type projection struct {
		document, pipeline, counts []byte
		pipelineVersion            *int64
		sequence                   *int32
		hasProjection              bool
		headcount                  *int32
		updatedAt                  time.Time
	}
	items := make([]stakeholdervacancies.Row, 0, req.Limit+1)
	projections := make([]projection, 0, req.Limit+1)
	// Every row repeats the same counts; an empty first page means an empty scope, hence all zero.
	var counts *stakeholdervacancies.StatusCounts
	if req.After == nil {
		counts = &stakeholdervacancies.StatusCounts{}
	}
	for rows.Next() {
		var row stakeholdervacancies.Row
		var p projection
		var total, draft, active, paused, closed *int64
		if err := rows.Scan(&row.ID, &p.document, &p.updatedAt, &row.Publication, &row.Process, &p.pipeline, &p.pipelineVersion, &row.CloseReason,
			&p.sequence, &p.hasProjection, &p.headcount, &p.counts, &row.DocumentsCount, &total, &draft, &active, &paused, &closed); err != nil {
			rows.Close()
			return stakeholdervacancies.Page{}, fmt.Errorf("scan stakeholder vacancy: %w", err)
		}
		if counts != nil && total != nil && draft != nil && active != nil && paused != nil && closed != nil {
			*counts = stakeholdervacancies.StatusCounts{All: *total, Draft: *draft, Active: *active, Paused: *paused, Closed: *closed}
		}
		items = append(items, row)
		projections = append(projections, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return stakeholdervacancies.Page{}, fmt.Errorf("iterate stakeholder vacancies: %w", err)
	}

	page := stakeholdervacancies.Page{Items: items, CountsByStatus: counts}
	if len(items) > req.Limit {
		page.Items = items[:req.Limit]
		page.NextCursor, err = draftlist.EncodeCursor(draftlist.Cursor{
			CompanyID: companyID, ActorID: actorID, LastUpdatedAt: projections[req.Limit-1].updatedAt, LastID: page.Items[req.Limit-1].ID,
		})
		if err != nil {
			return stakeholdervacancies.Page{}, fmt.Errorf("encode stakeholder vacancies cursor: %w", err)
		}
	}
	// Hydrate only returned rows; the lookahead only establishes another page.
	for i := range page.Items {
		p := projections[i]
		row := &page.Items[i]
		row.Kind, row.Visibility = stakeholderKindVisibility(p.sequence, row.Publication, p.hasProjection)
		if row.Process != nil {
			config := pipelineconfig.Defaults(row.ID)
			if p.pipelineVersion != nil {
				config, err = decodeStoredPipeline(row.ID, p.pipeline, *p.pipelineVersion)
				if err != nil {
					return stakeholdervacancies.Page{}, err
				}
			}
			row.Coverage, err = listCoverage(config, p.counts, p.headcount)
			if err != nil {
				return stakeholdervacancies.Page{}, err
			}
		}
		if err := requireV2ReadDocument(p.document); err != nil {
			return stakeholdervacancies.Page{}, err
		}
		fields, err := envelopeFieldsOf(p.document)
		if err != nil {
			return stakeholdervacancies.Page{}, err
		}
		if title, ok := fields["title"].(string); ok {
			row.Title = &title
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return stakeholdervacancies.Page{}, fmt.Errorf("commit stakeholder vacancies tx: %w", err)
	}
	return page, nil
}
