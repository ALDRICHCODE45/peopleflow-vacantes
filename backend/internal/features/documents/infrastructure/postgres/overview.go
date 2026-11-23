package postgres

import (
	"context"
	"errors"
	"fmt"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// GET V/document-overview (docs/contracts/placement-vacancy-documents-v1.md, «GET V/document-overview», L20): the documents and
// links of the vacancy and of every participation of it as one table, plus the vacancy header and the participations. It reuses
// the read path of GET P/documents (the read gate, the item and link projections and their allowed actions, the link states, the
// vacancy scope builder and the participation scope builder), so the overview can never disagree with the lists.

// WithStages sets how stage ids become {kind, name} for `participations[].stage`. Without it an overview of a vacancy that has
// participations fails closed (500) instead of inventing a name.
func (s *Store) WithStages(resolve documents.StageResolver) *Store {
	s.stages = resolve
	return s
}

// WithOverviewCap sets the cap of items plus links of an overview (default documents.MaxOverviewRows). Tests use a small one.
func (s *Store) WithOverviewCap(rows int) *Store {
	if rows > 0 {
		s.overviewCap = rows
	}
	return s
}

func (s *Store) rowCap() int {
	if s.overviewCap > 0 {
		return s.overviewCap
	}
	return documents.MaxOverviewRows
}

// vacancyRow is the draft's header columns. status and process are nil while the draft has no process row (never published).
type vacancyRow struct {
	title   *string
	status  *string
	process *string
	// sequence is the replacement's position in the chain (nil for an original, which has no vacancy_replacements row).
	sequence      *int32
	hasProjection bool
}

// newOverviewVacancy renders the header with the vocabulary of GET V/lifecycle (lifecycle.View.ApplyReplacement): publication and
// process are the stored axes; kind is replacement exactly when the chain has a row at sequence ≥ 1; visibility is null for a
// draft that never published, otherwise public, except that a replacement without a public projection is private.
func newOverviewVacancy(id string, r vacancyRow) documents.OverviewVacancy {
	out := documents.OverviewVacancy{ID: id, Title: r.title, Publication: r.status, Process: r.process, Kind: "original"}
	replacement := r.sequence != nil && *r.sequence >= 1
	if replacement {
		out.Kind = "replacement"
	}
	if r.status != nil {
		visibility := "public"
		if replacement && !r.hasProjection {
			visibility = "private"
		}
		out.Visibility = &visibility
	}
	return out
}

// participationRow is one participation with the company's view of its candidate and the size of its scope.
type participationRow struct {
	id            string
	candidateKind string
	candidateID   string
	fullName      string
	discarded     bool
	// stageID is the stage the participation sits in, or, for a discarded one, the stage it was discarded from (as
	// carry_candidates shows it).
	stageID string
	// carried: it comes from an earlier process (D17), so its scope can receive links.
	carried bool
	files   int
	links   int
}

// newOverviewParticipation renders a participations[] entry. The flags are the participation scope's (BuildScope with the
// participation limit over files plus links), computed for the caller; an unknown stage fails the read, as carry_candidates does.
func newOverviewParticipation(r participationRow, stages map[string]documents.Stage, canManage bool) (documents.OverviewParticipation, error) {
	stage, ok := stages[r.stageID]
	if !ok {
		return documents.OverviewParticipation{}, fmt.Errorf("participation %s: stage %s is not in the pipeline", r.id, r.stageID)
	}
	scope := documents.BuildScope(documents.ScopeInput{
		Kind: documents.ScopeParticipation, CanManage: canManage, CanReceiveLinks: r.carried, Documents: r.files, Links: r.links,
	})
	return documents.OverviewParticipation{
		ParticipationID:     r.id,
		Candidate:           documents.NamedCandidate{Kind: r.candidateKind, ID: r.candidateID, FullName: r.fullName},
		Discarded:           r.discarded,
		Stage:               stage,
		ScopeAllowedActions: scope.AllowedActions,
		UploadBlockedReason: scope.UploadBlockedReason,
	}, nil
}

// Overview implements documents.Reader. Everything comes from ONE REPEATABLE READ snapshot taken after the read gate (owner,
// active team member, stakeholder; a never-published draft reads too), in a fixed number of statements whatever the number of
// participations: header, vacancy counts, participations, pipeline, items, links. It takes no draft lock and writes nothing.
func (s *Store) Overview(ctx context.Context, companyID, actorID, draftID uuid.UUID, participationID *uuid.UUID) (documents.Overview, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return documents.Overview{}, fmt.Errorf("begin documents overview tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	access, err := s.access.AuthorizeDocuments(ctx, tx, companyID, actorID, draftID)
	if err != nil {
		return documents.Overview{}, err
	}
	vacancy, err := readOverviewVacancy(ctx, tx, companyID, draftID)
	if err != nil {
		return documents.Overview{}, err
	}
	// The vacancy scope exactly as GET V/documents builds it: the real counts of the scope, never the capped or filtered rows.
	target := documents.VacancyTarget(draftID)
	canLink, err := scopeCanReceiveLinks(ctx, tx, companyID, target)
	if err != nil {
		return documents.Overview{}, err
	}
	var files, links int
	if err := tx.QueryRow(ctx, `
SELECT (SELECT count(*) FROM placement_documents WHERE company_id = $1 AND draft_id = $2 AND participation_id IS NULL),
       (SELECT count(*) FROM placement_document_links WHERE company_id = $1 AND draft_id = $2 AND participation_id IS NULL)`,
		companyID, draftID).Scan(&files, &links); err != nil {
		return documents.Overview{}, fmt.Errorf("count vacancy documents: %w", err)
	}
	participations, byID, err := s.readOverviewParticipations(ctx, tx, companyID, draftID, access.CanManage)
	if err != nil {
		return documents.Overview{}, err
	}
	// A filter that is not a participation of this vacancy is 404, after the vacancy gates (no leak of foreign ids).
	if participationID != nil {
		if _, ok := byID[participationID.String()]; !ok {
			return documents.Overview{}, documents.ErrScopeNotFound
		}
	}

	rowCap := s.rowCap()
	items, err := queryOverviewItems(ctx, tx, companyID, draftID, participationID, access.CanManage, rowCap+1)
	if err != nil {
		return documents.Overview{}, err
	}
	linkRows, linkOwners, err := queryOverviewLinks(ctx, tx, companyID, actorID, draftID, participationID, access, rowCap+1)
	if err != nil {
		return documents.Overview{}, err
	}
	overviewItems := make([]documents.OverviewItem, len(items))
	for i, item := range items {
		owner, err := ownerOf(item.ParticipationID, byID)
		if err != nil {
			return documents.Overview{}, fmt.Errorf("document %s: %w", item.ID, err)
		}
		overviewItems[i] = documents.OverviewItem{Item: item, Owner: owner}
	}
	overviewLinks := make([]documents.OverviewLink, len(linkRows))
	for i, link := range linkRows {
		owner, err := ownerOf(linkOwners[i], byID)
		if err != nil {
			return documents.Overview{}, fmt.Errorf("link %s: %w", link.ID, err)
		}
		overviewLinks[i] = documents.OverviewLink{Link: link, Owner: owner}
	}
	overviewItems, overviewLinks, truncated := documents.CapNewest(overviewItems, overviewLinks, rowCap)

	return documents.Overview{
		Vacancy:        vacancy,
		Scope:          documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: access.CanManage, CanReceiveLinks: canLink, Documents: files, Links: links}),
		Items:          overviewItems,
		Links:          overviewLinks,
		Participations: participations,
		Truncated:      truncated,
	}, nil
}

// ownerOf resolves the owner of a row from its participation id (nil = the vacancy). A row of a participation that the
// snapshot does not know cannot happen (same snapshot, FK); it fails the read instead of mislabelling the row.
func ownerOf(participationID *string, byID map[string]documents.OverviewParticipation) (documents.Owner, error) {
	if participationID == nil {
		return documents.VacancyOwner(), nil
	}
	p, ok := byID[*participationID]
	if !ok {
		return documents.Owner{}, fmt.Errorf("participation %s is not one of the vacancy's", *participationID)
	}
	return documents.ParticipationOwner(p), nil
}

// readOverviewVacancy reads the header. The title lives in the draft's canonical envelope (`fields.title`, null while unset);
// the lifecycle columns come from the process row when there is one.
func readOverviewVacancy(ctx context.Context, tx pgx.Tx, companyID, draftID uuid.UUID) (documents.OverviewVacancy, error) {
	var r vacancyRow
	err := tx.QueryRow(ctx, `
SELECT convert_from(d.fields, 'UTF8')::jsonb->'fields'->>'title', p.status, p.process_status, vr.sequence, pp.id IS NOT NULL
  FROM job_drafts d
  LEFT JOIN vacancy_processes p ON p.id = d.id AND p.company_id = d.company_id
  LEFT JOIN vacancy_replacements vr ON vr.process_id = d.id AND vr.company_id = d.company_id
  LEFT JOIN vacancy_public_projections pp ON pp.id = d.id
 WHERE d.id = $1 AND d.company_id = $2`, draftID, companyID).Scan(&r.title, &r.status, &r.process, &r.sequence, &r.hasProjection)
	if errors.Is(err, pgx.ErrNoRows) {
		return documents.OverviewVacancy{}, documents.ErrScopeNotFound
	}
	if err != nil {
		return documents.OverviewVacancy{}, fmt.Errorf("read overview vacancy: %w", err)
	}
	return newOverviewVacancy(draftID.String(), r), nil
}

// readOverviewParticipations lists every participation of the vacancy (discarded included) in two statements however many there
// are: the participations with the company's view of the candidate name (the board's: a correction of an organic candidate wins
// over the account's) and the size of each scope, then the pipeline that names the stages. Ordered by candidate name, then id.
func (s *Store) readOverviewParticipations(ctx context.Context, tx pgx.Tx, companyID, draftID uuid.UUID, canManage bool) ([]documents.OverviewParticipation, map[string]documents.OverviewParticipation, error) {
	rows, err := tx.Query(ctx, `
SELECT p.id::text,
       CASE WHEN p.company_candidate_id IS NULL THEN 'organic' ELSE 'manual' END,
       COALESCE(cc.id, u.id)::text,
       COALESCE(CASE WHEN o.corrections ? 'full_name' THEN o.corrections->>'full_name' ELSE COALESCE(cc.full_name, u.full_name) END, ''),
       p.discarded_at IS NOT NULL,
       (CASE WHEN p.discarded_at IS NOT NULL THEN COALESCE(p.previous_stage_id, p.stage_id) ELSE p.stage_id END)::text,
       p.carried_from_participation_id IS NOT NULL,
       COALESCE(dc.n, 0), COALESCE(lc.n, 0)
  FROM process_participations p
  JOIN vacancy_processes vp ON vp.id = p.process_id
  LEFT JOIN users u ON u.id = p.candidate_id
  LEFT JOIN company_candidates cc ON cc.id = p.company_candidate_id AND cc.company_id = vp.company_id
  LEFT JOIN company_candidate_corrections o ON p.company_candidate_id IS NULL AND o.user_id = p.candidate_id AND o.company_id = vp.company_id
  LEFT JOIN (SELECT participation_id, count(*) AS n FROM placement_documents
              WHERE company_id = $1 AND draft_id = $2 AND participation_id IS NOT NULL GROUP BY participation_id) dc ON dc.participation_id = p.id
  LEFT JOIN (SELECT participation_id, count(*) AS n FROM placement_document_links
              WHERE company_id = $1 AND draft_id = $2 AND participation_id IS NOT NULL GROUP BY participation_id) lc ON lc.participation_id = p.id
 WHERE p.process_id = $2 AND vp.company_id = $1
 ORDER BY 4, p.id`, companyID, draftID)
	if err != nil {
		return nil, nil, fmt.Errorf("list overview participations: %w", err)
	}
	defer rows.Close()
	var raw []participationRow
	for rows.Next() {
		var r participationRow
		if err := rows.Scan(&r.id, &r.candidateKind, &r.candidateID, &r.fullName, &r.discarded, &r.stageID, &r.carried, &r.files, &r.links); err != nil {
			return nil, nil, fmt.Errorf("scan overview participation: %w", err)
		}
		raw = append(raw, r)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("list overview participations: %w", err)
	}
	rows.Close()

	out := make([]documents.OverviewParticipation, 0, len(raw))
	byID := make(map[string]documents.OverviewParticipation, len(raw))
	if len(raw) == 0 {
		return out, byID, nil
	}
	if s.stages == nil {
		return nil, nil, errors.New("documents overview: stage resolver not configured")
	}
	var configuration []byte
	if err := tx.QueryRow(ctx, `SELECT configuration FROM job_draft_pipeline_configs WHERE draft_id = $1`, draftID).Scan(&configuration); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, fmt.Errorf("read overview pipeline: %w", err)
	}
	stages, err := s.stages(draftID, configuration)
	if err != nil {
		return nil, nil, fmt.Errorf("resolve overview stages: %w", err)
	}
	for _, r := range raw {
		p, err := newOverviewParticipation(r, stages, canManage)
		if err != nil {
			return nil, nil, err
		}
		out = append(out, p)
		byID[p.ParticipationID] = p
	}
	return out, byID, nil
}

// queryOverviewItems reads the documents of the vacancy and of every participation of it (or of one participation) with the
// shared projection, newest current version first. limit bounds the read.
func queryOverviewItems(ctx context.Context, tx pgx.Tx, companyID, draftID uuid.UUID, participationID *uuid.UUID, canManage bool, limit int) ([]documents.Item, error) {
	rows, err := tx.Query(ctx, itemSelectSQL+`
 WHERE d.company_id = $1 AND d.draft_id = $2 AND ($3::uuid IS NULL OR d.participation_id = $3)
 ORDER BY v.uploaded_at DESC, d.id DESC
 LIMIT $4`, companyID, draftID, participationID, limit)
	if err != nil {
		return nil, fmt.Errorf("list overview documents: %w", err)
	}
	return scanItems(rows, canManage)
}

// queryOverviewLinks reads the links of the vacancy and of every participation of it (or of one participation) with the shared
// projection (so the link states and the source readability are the list's), newest first, plus each link's own participation id.
func queryOverviewLinks(ctx context.Context, tx pgx.Tx, companyID, actorID, draftID uuid.UUID, participationID *uuid.UUID, access Access, limit int) ([]documents.Link, []*string, error) {
	rows, err := tx.Query(ctx, linkSelectSQL+`
 WHERE l.company_id = $1 AND l.draft_id = $2 AND ($5::uuid IS NULL OR l.participation_id = $5)
 ORDER BY l.linked_at DESC, l.id DESC
 LIMIT $6`, companyID, draftID, seesEverySource(access), actorID, participationID, limit)
	if err != nil {
		return nil, nil, fmt.Errorf("list overview links: %w", err)
	}
	return scanLinks(rows, access)
}
