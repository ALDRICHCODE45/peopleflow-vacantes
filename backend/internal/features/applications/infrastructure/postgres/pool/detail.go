package pool

import (
	"context"
	"encoding/json"
	"errors"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// All detail reads share a snapshot, including the latest frozen profile and
// current contact. Reuse the list projection, not its separate transaction.
func (s *Store) Detail(ctx context.Context, company uuid.UUID, kind string, id uuid.UUID) (app.Detail, error) {
	var out app.Detail
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	out, err = s.detail(ctx, tx, company, kind, id)
	if err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}

// detail also runs inside Edit's write transaction: response and ETag describe
// exactly that edit, not a racing read after commit.
func (s *Store) detail(ctx context.Context, tx pgx.Tx, company uuid.UUID, kind string, id uuid.UUID) (app.Detail, error) {
	var out app.Detail
	var raw []byte
	query := poolSQL + ` AND kind=$2 AND id=$3), page AS (SELECT * FROM filtered) SELECT to_jsonb(r) FROM (` + projectionSQL + `) r`
	err := tx.QueryRow(ctx, query, company, kind, id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, board.ErrNotFound
	}
	if err != nil {
		return out, err
	}
	var item app.Item
	if err = json.Unmarshal(raw, &item); err != nil {
		return out, err
	}
	if loc := item.Profile.Location; loc != nil && (loc.Country.Name == "" || (loc.State != nil && loc.State.Name == "") || (loc.Municipality != nil && loc.Municipality.Name == "")) {
		return out, errors.New("pool location catalog reference missing")
	}
	out = app.Detail{Kind: item.Kind, ID: item.ID, FullName: item.FullName, ProfessionalTitle: item.ProfessionalTitle, CurrentCompany: item.CurrentCompany, Profile: item.Profile, Participations: []app.DetailParticipation{}}
	if kind == "manual" {
		out.CreatedBy = &app.Creator{}
		err = tx.QueryRow(ctx, `SELECT cc.email,cc.phone,cc.created_by,u.full_name,cc.created_at FROM company_candidates cc LEFT JOIN users u ON u.id=cc.created_by AND u.deleted_at IS NULL WHERE cc.company_id=$1 AND cc.id=$2`, company, id).Scan(&out.Contact.Email, &out.Contact.Phone, &out.CreatedBy.ID, &out.CreatedBy.Name, &out.CreatedAt)
	} else {
		err = tx.QueryRow(ctx, `SELECT u.email,NULLIF(btrim(cp.phone),'') FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id=u.id WHERE u.id=$1`, id).Scan(&out.Contact.Email, &out.Contact.Phone)
	}
	if err != nil {
		return out, err
	}
	rows, err := tx.Query(ctx, detailParticipationsSQL, company, kind, id)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw, config []byte
		if err = rows.Scan(&raw, &config); err != nil {
			return out, err
		}
		var p app.DetailParticipation
		if err = json.Unmarshal(raw, &p); err != nil {
			return out, err
		}
		names, err := s.stageNames(p.Vacancy.ID, config)
		if err != nil {
			return out, err
		}
		name, ok := names[p.Stage.ID]
		if !ok {
			return out, errors.New("pool stage reference missing")
		}
		p.Stage.Name = name
		if p.Substate != nil && p.Substate.Name == "" {
			return out, errors.New("pool substate reference missing")
		}
		if p.Source == "manual" && p.AddedBy == nil {
			return out, errors.New("manual participation missing actor")
		}
		if p.Discard != nil && !board.ValidReason(p.Discard.Reason) {
			return out, errors.New("invalid stored discard")
		}
		p.AppliedAt = p.AppliedAt.UTC()
		if p.CV != nil {
			p.CV.UploadedAt = p.CV.UploadedAt.UTC()
		}
		if p.Discard != nil {
			p.Discard.DiscardedAt = p.Discard.DiscardedAt.UTC()
		}
		out.Participations = append(out.Participations, p)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	rows.Close()
	if kind == "organic" {
		out.CreatedAt = out.Participations[len(out.Participations)-1].AppliedAt
	}
	out.CreatedAt = out.CreatedAt.UTC()
	out.CorrectedFields = []string{}
	out.Skills = out.Profile.Skills
	if out.Skills == nil {
		out.Skills = []string{}
	}
	out.ETag = app.ETag(kind, id, 1)
	if kind == "manual" {
		var version int64
		var updatedID *uuid.UUID
		var updatedName *string
		err = tx.QueryRow(ctx, `SELECT cc.version,COALESCE(cc.updated_at,cc.created_at),COALESCE(cc.updated_by,cc.created_by),u.full_name,cc.linkedin_url,cc.portfolio_url,COALESCE((SELECT jsonb_agg(jsonb_build_object('level',e.level,'institution',e.institution,'field',e.field,'status',e.status,'start_year',e.start_year,'end_year',e.end_year) ORDER BY e.position,e.id) FROM company_candidate_educations e WHERE e.company_candidate_id=cc.id),'[]'::jsonb) FROM company_candidates cc LEFT JOIN users u ON u.id=COALESCE(cc.updated_by,cc.created_by) AND u.deleted_at IS NULL WHERE cc.company_id=$1 AND cc.id=$2`, company, id).Scan(&version, &out.UpdatedAt, &updatedID, &updatedName, &out.LinkedInURL, &out.PortfolioURL, &raw)
		if err != nil {
			return out, err
		}
		if updatedID != nil {
			out.UpdatedBy = &app.Creator{ID: *updatedID, Name: updatedName}
		}
		if err = json.Unmarshal(raw, &out.Education); err != nil {
			return out, err
		}
		out.ETag = app.ETag(kind, id, version)
	} else {
		if err = organicDetail(ctx, tx, company, id, &out); err != nil {
			return out, err
		}
	}
	return out, nil
}

const detailParticipationsSQL = `SELECT jsonb_build_object(
 'id',p.id,'vacancy',jsonb_build_object('id',p.process_id,'title',COALESCE(convert_from(d.fields,'UTF8')::jsonb->'fields'->>'title',''),
 'lifecycle',jsonb_build_object('publication',CASE WHEN vp.status='draft' THEN NULL ELSE vp.status END,'process',vp.process_status)),
 'stage',jsonb_build_object('id',p.stage_id,'name',''),
 'state',CASE WHEN p.discarded_at IS NULL THEN 'active' ELSE 'discarded' END,
 'substate',CASE WHEN p.substate_id IS NULL THEN NULL ELSE jsonb_build_object('id',p.substate_id,'name',sub.value->>'name') END,
 'discard',CASE WHEN p.discarded_at IS NULL THEN NULL ELSE jsonb_build_object('reason',jsonb_build_object('group',p.reason_group,'key',p.reason_code),'comment',p.comment,'discarded_at',p.discarded_at) END,
 'source',p.source,'applied_at',p.created_at,
 'added_by',CASE WHEN p.source='manual' AND ad.id IS NOT NULL THEN jsonb_build_object('id',ad.id,'name',ad.full_name) ELSE NULL END,
 'cv',CASE WHEN COALESCE(mc.file_name,l.name) IS NULL THEN NULL ELSE jsonb_build_object('file_name',COALESCE(mc.file_name,l.name),'uploaded_at',COALESCE(mc.uploaded_at,v.uploaded_at)) END),
 CASE WHEN c.configuration IS NULL THEN NULL ELSE convert_from(c.configuration,'UTF8')::jsonb END
 FROM process_participations p
 JOIN vacancy_processes vp ON vp.id=p.process_id AND vp.company_id=$1
 JOIN job_drafts d ON d.id=p.process_id AND d.company_id=$1
 LEFT JOIN job_draft_pipeline_configs c ON c.draft_id=p.process_id
 LEFT JOIN job_draft_substate_catalogs sc ON sc.draft_id=p.process_id
 LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(convert_from(sc.catalog,'UTF8')::jsonb->'substates') WHERE value->>'id'=p.substate_id::text) sub ON true
 LEFT JOIN users ad ON ad.id=p.added_by AND p.source='manual'
 LEFT JOIN company_candidate_cvs mc ON mc.id=p.company_candidate_cv_id AND mc.company_id=$1
 LEFT JOIN candidate_cv_versions v ON v.id=p.cv_version_id
 LEFT JOIN candidate_cv_library l ON l.version_id=v.id
 WHERE (($2='manual' AND p.company_candidate_id=$3) OR ($2='organic' AND p.company_candidate_id IS NULL AND p.candidate_id=$3))
 ORDER BY p.created_at DESC,p.id DESC`

// Scope the exact participation before opening private storage. No board Load:
// every recruiter in the company can download these referenced versions.
func (s *Store) File(ctx context.Context, company uuid.UUID, kind string, id, pid uuid.UUID) (board.File, error) {
	var out board.File
	var key *string
	var name, contentType *string
	var size *int64
	err := s.pool.QueryRow(ctx, `SELECT COALESCE(mc.file_name,l.name),COALESCE(mc.content_type,v.content_type),COALESCE(mc.size,v.size),COALESCE(mc.storage_key,v.storage_key)
 FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id AND vp.company_id=$1
 LEFT JOIN company_candidates cc ON cc.id=p.company_candidate_id AND cc.company_id=$1
 LEFT JOIN company_candidate_cvs mc ON mc.id=p.company_candidate_cv_id AND mc.company_id=$1
 LEFT JOIN candidate_cv_versions v ON v.id=p.cv_version_id
 LEFT JOIN candidate_cv_library l ON l.version_id=v.id
 WHERE p.id=$4 AND (($2='manual' AND cc.id=$3) OR ($2='organic' AND p.company_candidate_id IS NULL AND p.candidate_id=$3))`, company, kind, id, pid).Scan(&name, &contentType, &size, &key)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, board.ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if key == nil || name == nil || size == nil || contentType == nil {
		return out, board.ErrNotFound
	}
	if s.storage == nil {
		return out, board.ErrStorageUnavailable
	}
	out.Name, out.ContentType, out.Size = *name, *contentType, *size
	out.Reader, err = s.storage.Open(ctx, *key)
	return out, err
}
