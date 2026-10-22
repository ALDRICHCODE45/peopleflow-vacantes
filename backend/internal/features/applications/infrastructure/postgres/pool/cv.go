package pool

import (
	"context"
	"errors"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/google/uuid"
)

// Matches intake and candidate uploads: reconciliation takes this exclusively.
const cvStorageLock int64 = 75210410021

var _ app.CVWriter = (*Store)(nil)

func (s *Store) CorrectCV(ctx context.Context, company, actor uuid.UUID, kind string, id, pid uuid.UUID, etag string, input board.ManualInput, inspector board.ManualCVInspector, storage board.ManualFileStorage) (out app.Detail, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	// Membership is checked before creating an organic lock row or storing a file.
	var visible bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id AND vp.company_id=$1 WHERE p.id=$4 AND (($2='manual' AND p.company_candidate_id=$3 AND EXISTS(SELECT 1 FROM company_candidates cc WHERE cc.id=$3 AND cc.company_id=$1)) OR ($2='organic' AND p.company_candidate_id IS NULL AND p.candidate_id=$3)))`, company, kind, id, pid).Scan(&visible)
	if err != nil {
		return out, err
	}
	if !visible {
		return out, board.ErrNotFound
	}
	var version int64
	if kind == "manual" {
		err = tx.QueryRow(ctx, `SELECT version FROM company_candidates WHERE company_id=$1 AND id=$2 FOR UPDATE`, company, id).Scan(&version)
	} else {
		if _, err = tx.Exec(ctx, `INSERT INTO company_candidate_corrections(company_id,user_id) VALUES($1,$2) ON CONFLICT(company_id,user_id) DO NOTHING`, company, id); err != nil {
			return out, err
		}
		err = tx.QueryRow(ctx, `SELECT version FROM company_candidate_corrections WHERE company_id=$1 AND user_id=$2 FOR UPDATE`, company, id).Scan(&version)
	}
	if err != nil {
		return out, err
	}
	current := app.ETag(kind, id, version)
	if kind == "organic" {
		current = app.OrganicETag(company, id, version)
	}
	if current != etag {
		return out, app.ErrPreconditionFailed
	}
	if inspector == nil || storage == nil {
		return out, board.ErrStorageUnavailable
	}
	typ, err := inspector.Inspect(input.FileName, input.CV)
	if err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock_shared($1)`, cvStorageLock); err != nil {
		return out, err
	}
	key, err := storage.Put(input.CV)
	if err != nil {
		return out, err
	}
	// Definite pre-commit failures compensate; uncertain Commit outcomes retain
	// the object for reconciliation, exactly like manual intake.
	cleanup := true
	defer func() {
		if cleanup {
			err = errors.Join(err, storage.Delete(key))
		}
	}()
	cvID := uuid.New()
	var manual *uuid.UUID
	if kind == "manual" {
		manual = &id
	}
	if _, err = tx.Exec(ctx, `INSERT INTO company_candidate_cvs(id,company_id,company_candidate_id,storage_key,size,content_type,file_name) VALUES($1,$2,$3,$4,$5,$6,$7)`, cvID, company, manual, key, len(input.CV), typ, input.FileName); err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `UPDATE process_participations SET corrected_company_cv_id=$2 WHERE id=$1`, pid, cvID); err != nil {
		return out, err
	}
	if kind == "manual" {
		_, err = tx.Exec(ctx, `UPDATE company_candidates SET version=version+1,updated_at=clock_timestamp(),updated_by=$3 WHERE company_id=$1 AND id=$2`, company, id, actor)
	} else {
		_, err = tx.Exec(ctx, `UPDATE company_candidate_corrections SET version=version+1,updated_at=clock_timestamp(),updated_by=$3 WHERE company_id=$1 AND user_id=$2`, company, id, actor)
	}
	if err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO company_candidate_history(id,company_id,candidate_kind,candidate_id,actor_id,changes,kind,participation_id,file_name) VALUES($1,$2,$3,$4,$5,'[]','cv_corrected',$6,$7)`, uuid.New(), company, kind, id, actor, pid, input.FileName); err != nil {
		return out, err
	}
	// Filenames are private history only; shared audit metadata contains IDs only.
	if _, err = tx.Exec(ctx, `INSERT INTO audit_events(id,actor_id,actor_type,event_type,entity_type,entity_id,metadata) VALUES($1,$2,'user','CompanyCandidateCVCorrected','company_candidate',$3,jsonb_build_object('participation_id',$4::text))`, uuid.New(), actor, id, pid.String()); err != nil {
		return out, err
	}
	out, err = s.detail(ctx, tx, company, kind, id)
	if err != nil {
		return out, err
	}
	cleanup = false
	err = tx.Commit(ctx)
	return out, err
}
