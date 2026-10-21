package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

var _ draftlist.Lister = (*Store)(nil)

// ListV2 lists only visible schema-2 drafts, using the session scope even when
// a cursor is supplied. A save can move a draft before the current cursor;
// restarting pagination reveals it at its new position.
func (s *Store) ListV2(ctx context.Context, companyID, actorID uuid.UUID, req draftlist.Request) (draftlist.Page, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return draftlist.Page{}, fmt.Errorf("begin list v2 tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	auth, err := s.lockGates(ctx, tx, companyID, actorID)
	if err != nil {
		return draftlist.Page{}, err
	}

	// Materialize the existing visible keyset page first. All participation
	// aggregation is restricted to those IDs, in this same SQL statement/snapshot.
	query := `WITH page AS MATERIALIZED (SELECT d.id, d.fields, d.principal_recruiter_id, u.full_name,
 d.version, d.created_at, d.updated_at, COALESCE(p.status,'draft') AS status, p.process_status, p.published_at, p.paused_at, p.closed_at, p.process_finished_at,
 c.configuration, c.version AS pipeline_version
 FROM job_drafts d
 LEFT JOIN users u ON u.id = d.principal_recruiter_id AND u.deleted_at IS NULL
 LEFT JOIN vacancy_processes p ON p.id = d.id AND p.company_id = d.company_id
 LEFT JOIN job_draft_pipeline_configs c ON c.draft_id = d.id
 WHERE d.company_id = $1 AND ($2::boolean OR d.principal_recruiter_id = $3)
 AND convert_from(d.fields,'UTF8')::jsonb->>'schema_version' = '2'`
	// Same rule as authorized(): the owner sees every draft, others only
	// their principal drafts.
	args := []any{companyID, auth.role == roleOwner, actorID}
	if req.After != nil {
		query += ` AND (d.updated_at, d.id) < ($4::timestamptz, $5::uuid)`
		args = append(args, req.After.LastUpdatedAt, req.After.LastID)
	}
	query += fmt.Sprintf(` ORDER BY d.updated_at DESC, d.id DESC LIMIT %d),
 stage_counts AS (
  SELECT pp.process_id, pp.stage_id, count(*) AS total,
   count(*) FILTER (WHERE pp.discarded_at IS NOT NULL) AS discarded,
   count(*) FILTER (WHERE pp.discarded_at IS NULL) AS active
  FROM process_participations pp JOIN page ON page.id = pp.process_id
  GROUP BY pp.process_id, pp.stage_id
 ), candidate_counts AS (
  SELECT process_id, jsonb_build_object(
   'total', sum(total), 'discarded', sum(discarded),
   'by_stage', jsonb_agg(jsonb_build_object('id', stage_id, 'count', active))) AS summary
  FROM stage_counts GROUP BY process_id
 )
 SELECT page.*, cc.summary, r.name FROM page
 LEFT JOIN candidate_counts cc ON cc.process_id = page.id
 LEFT JOIN job_draft_requesters r ON r.company_id = $1
  AND r.kind = convert_from(page.fields,'UTF8')::jsonb->'fields'->'requester'->>'kind'
  AND r.id = (convert_from(page.fields,'UTF8')::jsonb->'fields'->'requester'->>'id')::uuid
 ORDER BY page.updated_at DESC, page.id DESC`, req.Limit+1)
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return draftlist.Page{}, fmt.Errorf("list v2 drafts: %w", err)
	}
	items := make([]draftlist.Item, 0, req.Limit+1)
	type projection struct {
		document, pipeline, counts []byte
		pipelineVersion            *int64
		requesterName              *string
	}
	projections := make([]projection, 0, req.Limit+1)
	for rows.Next() {
		var item draftlist.Item
		var p projection
		if err := rows.Scan(&item.ID, &p.document, &item.Principal.ID, &item.Principal.Name, &item.Version, &item.CreatedAt, &item.UpdatedAt, &item.Status, &item.Process, &item.PublishedAt, &item.PausedAt, &item.ClosedAt, &item.ProcessFinishedAt, &p.pipeline, &p.pipelineVersion, &p.counts, &p.requesterName); err != nil {
			rows.Close()
			return draftlist.Page{}, fmt.Errorf("scan list v2 draft: %w", err)
		}
		items = append(items, item)
		projections = append(projections, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return draftlist.Page{}, fmt.Errorf("iterate list v2 drafts: %w", err)
	}

	page := draftlist.Page{Items: items}
	if len(items) > req.Limit {
		page.Items = items[:req.Limit]
		last := page.Items[req.Limit-1]
		page.NextCursor, err = draftlist.EncodeCursor(draftlist.Cursor{
			CompanyID: companyID, ActorID: actorID, LastUpdatedAt: last.UpdatedAt, LastID: last.ID,
		})
		if err != nil {
			return draftlist.Page{}, fmt.Errorf("encode list v2 cursor: %w", err)
		}
	}
	// Hydrate only returned rows; the lookahead only establishes another page.
	for i := range page.Items {
		p := projections[i]
		document := p.document
		if page.Items[i].Process != nil {
			config := pipelineconfig.Defaults(page.Items[i].ID)
			if p.pipelineVersion != nil {
				config, err = decodeStoredPipeline(page.Items[i].ID, p.pipeline, *p.pipelineVersion)
				if err != nil {
					return draftlist.Page{}, err
				}
			}
			page.Items[i].Candidates, err = listCandidates(config, p.counts)
			if err != nil {
				return draftlist.Page{}, err
			}
		}
		if err := requireV2ReadDocument(document); err != nil {
			return draftlist.Page{}, err
		}
		fields, err := envelopeFieldsOf(document)
		if err != nil {
			return draftlist.Page{}, err
		}
		if title, ok := fields["title"].(string); ok {
			page.Items[i].Title = &title
		}
		// Codes were validated by requireV2ReadDocument; copy them as stored.
		if mode, ok := fields["work_mode"].(string); ok {
			page.Items[i].WorkMode = &mode
		}
		if schedule, ok := fields["work_schedule"].(string); ok {
			page.Items[i].Schedule = &schedule
		}
		kind, id, present, err := requesterRef(document)
		if err != nil {
			return draftlist.Page{}, err
		}
		if present {
			if id != nil && p.requesterName == nil {
				return draftlist.Page{}, fmt.Errorf("draftstore: requester catalog entry %s (%s) missing for company %s", *id, kind, companyID)
			}
			page.Items[i].Requester = &draftlist.Requester{Kind: kind, ID: id, Name: p.requesterName}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return draftlist.Page{}, fmt.Errorf("commit list v2 tx: %w", err)
	}
	return page, nil
}

// listCandidates projects SQL aggregates onto the board's current progression
// order. Retired stages are history/recovery metadata, never occupied stages.
func listCandidates(c pipelineconfig.Configuration, raw []byte) (*draftlist.Candidates, error) {
	var counts struct {
		Total     int64 `json:"total"`
		Discarded int64 `json:"discarded"`
		ByStage   []struct {
			ID    string `json:"id"`
			Count int64  `json:"count"`
		} `json:"by_stage"`
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &counts); err != nil {
			return nil, fmt.Errorf("decode list candidate counts: %w", err)
		}
	}
	out := &draftlist.Candidates{Total: counts.Total, Discarded: counts.Discarded, ByStage: make([]draftlist.CandidateStage, len(c.Stages))}
	order := make(map[string]int, len(c.Stages))
	for i, stage := range c.Stages {
		order[stage.ID] = i
		out.ByStage[i] = draftlist.CandidateStage{ID: stage.ID, Kind: stage.Kind, Name: stage.Name}
	}
	for _, stage := range counts.ByStage {
		i, ok := order[stage.ID]
		if !ok {
			if stage.Count != 0 {
				return nil, errors.New("draftstore: active participation outside current pipeline")
			}
			continue
		}
		out.ByStage[i].Count = stage.Count
		if out.ByStage[i].Kind != "new" {
			out.InProcess += stage.Count
		}
	}
	return out, nil
}
