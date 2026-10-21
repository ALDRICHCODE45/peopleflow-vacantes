package board

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var _ app.ManualCreateStore = (*Store)(nil)

const manualOperation = "manual-intake"
const manualFingerprintAlgorithm = "manual-json-cv-v1+sha256"

// Same lock as candidate CV uploads and shared storage reconciliation. No
// dependency on the candidates feature is needed at this boundary.
const manualStorageLock int64 = 75210410021

// CreateManual accepts parsed multipart bytes, but retains all business ordering
// here so HTTP and other callers cannot bypass authorization or atomicity.
func (s *Store) CreateManual(ctx context.Context, company, actor, id uuid.UUID, input app.ManualInput, inspector app.ManualCVInspector, storage app.ManualFileStorage) (app.ManualCreated, error) {
	var out app.ManualCreated
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	p, err := s.vacancy.Load(ctx, tx, company, actor, id)
	if err != nil {
		return out, err
	}
	if input.IdempotencyKey == uuid.Nil {
		return out, app.ErrInvalidRequest
	}
	// Serialize company-wide manual identities and the company/actor/key replay
	// namespace, including concurrent intake into different vacancies.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "manual-intake:"+company.String()); err != nil {
		return out, err
	}
	fingerprint, err := app.ManualFingerprint(id, input.Data, input.CV)
	if err != nil {
		return out, err
	}
	digest, err := hex.DecodeString(fingerprint)
	if err != nil {
		return out, err
	}
	var stored []byte
	var algorithm string
	err = tx.QueryRow(ctx, `SELECT fingerprint,fingerprint_algorithm,response_body,response_etag FROM job_draft_idempotency WHERE company_id=$1 AND actor_id=$2 AND operation=$3 AND idem_key=$4`, company, actor, manualOperation, input.IdempotencyKey.String()).Scan(&stored, &algorithm, &out.Body, &out.ETag)
	if err == nil {
		if algorithm != manualFingerprintAlgorithm || !bytes.Equal(stored, digest) {
			return app.ManualCreated{}, app.ErrManualIdempotencyConflict
		}
		out.Replayed = true
		return out, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	request, err := app.ParseManualRequest(input.Data)
	if err != nil {
		return out, err
	}
	validated, fields, err := request.Validate(ctx, manualGeoLookup{db.New(tx)}, len(input.CV) > 0)
	if err != nil {
		return out, err
	}
	if len(fields) > 0 {
		return out, &app.ManualValidationError{Fields: fields}
	}
	var state string
	err = tx.QueryRow(ctx, `SELECT process_status FROM vacancy_processes WHERE id=$1 AND company_id=$2 FOR UPDATE`, id, company).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, app.ErrNotPublished
	}
	if err != nil {
		return out, err
	}
	if state == "finished" {
		view, err := s.vacancy.Lifecycle(ctx, tx, id)
		if err != nil {
			return out, err
		}
		return out, &app.ProcessFinished{Lifecycle: view}
	}
	if field := app.ValidateManualStage(validated.StageID.String(), p); field != nil {
		return out, &app.ManualValidationError{Fields: []app.ManualFieldError{*field}}
	}
	identity, profile, err := manualIdentity(ctx, tx, company, id, validated)
	if err != nil {
		return out, err
	}
	if inspector == nil || storage == nil {
		return out, app.ErrStorageUnavailable
	}
	typ, err := inspector.Inspect(input.FileName, input.CV)
	if err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock_shared($1)`, manualStorageLock); err != nil {
		return out, err
	}
	return storeManualFile(storage, input.CV, func(key string) (app.ManualCreated, error) {
		if validated.Existing == nil {
			if err := insertManualCandidate(ctx, tx, company, actor, identity, validated.Candidate); err != nil {
				return app.ManualCreated{}, err
			}
		}
		var organic, manual *uuid.UUID
		if validated.Existing != nil && validated.Existing.Kind == "organic" {
			organic = &identity
		} else {
			manual = &identity
		}
		cv, pid := uuid.New(), uuid.New()
		at := time.Now().UTC().Truncate(time.Microsecond)
		if _, err := tx.Exec(ctx, `INSERT INTO company_candidate_cvs(id,company_id,company_candidate_id,storage_key,size,content_type,file_name,uploaded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, cv, company, manual, key, len(input.CV), typ, input.FileName, at); err != nil {
			return app.ManualCreated{}, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO process_participations(id,process_id,candidate_id,company_candidate_id,company_candidate_cv_id,stage_id,source,added_by,version,created_at,profile_snapshot,questions_snapshot,answers_snapshot) VALUES($1,$2,$3,$4,$5,$6,'manual',$7,1,$8,$9,'[]','[]')`, pid, id, organic, manual, cv, validated.StageID, actor, at, profile); err != nil {
			return app.ManualCreated{}, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,from_stage_id,hire,departure,actor_kind,event_kind) VALUES($1,$2,$3,$4,$5,NULL,false,false,'recruiter','intake')`, uuid.New(), pid, validated.StageID, actor, at); err != nil {
			return app.ManualCreated{}, err
		}
		if err := s.vacancy.RecordDelivery(ctx, tx, id, actor, validated.StageID, at); err != nil {
			return app.ManualCreated{}, err
		}
		event := audit.AuditEvent{ID: uuid.New(), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: "VacancyCandidateAddedManually", EntityType: "process_participation", EntityID: pid, Metadata: map[string]string{"vacancy_id": id.String(), "stage_id": validated.StageID.String(), "candidate_id": identity.String(), "cv_id": cv.String()}}
		if err := s.audit.Append(ctx, tx, event); err != nil {
			return app.ManualCreated{}, err
		}
		item, _, err := readItem(tx.QueryRow(ctx, itemSQL+`WHERE p.process_id=$1 AND p.id=$2`, id, pid))
		if err != nil {
			return app.ManualCreated{}, err
		}
		cover, err := coverage(ctx, tx, id, p)
		if err != nil {
			return app.ManualCreated{}, err
		}
		delivery, err := s.delivery(ctx, tx, id)
		if err != nil {
			return app.ManualCreated{}, err
		}
		body, err := marshalManualItem(item, cover, delivery)
		if err != nil {
			return app.ManualCreated{}, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO job_draft_idempotency(id,company_id,actor_id,operation,idem_key,fingerprint,fingerprint_algorithm,response_body,response_etag) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, uuid.New(), company, actor, manualOperation, input.IdempotencyKey.String(), digest, manualFingerprintAlgorithm, body, item.ETag); err != nil {
			return app.ManualCreated{}, err
		}
		return app.ManualCreated{Body: body, ETag: item.ETag}, nil
	}, func() error { return tx.Commit(ctx) })
}

func marshalManualItem(item app.Item, cover app.Coverage, delivery app.Delivery) ([]byte, error) {
	return json.Marshal(app.ManualCreatedBody{Item: item, Coverage: cover, Delivery: delivery})
}

// Definite write failures compensate even after cancellation (the port has no
// request context). Commit errors are uncertain: reconciliation owns cleanup.
func storeManualFile(storage app.ManualFileStorage, content []byte, write func(string) (app.ManualCreated, error), commit func() error) (out app.ManualCreated, err error) {
	key, err := storage.Put(content)
	if err != nil {
		return out, err
	}
	cleanup := true
	defer func() {
		if cleanup {
			err = errors.Join(err, storage.Delete(key))
		}
	}()
	out, err = write(key)
	if err != nil {
		return app.ManualCreated{}, err
	}
	cleanup = false
	if err = commit(); err != nil {
		return app.ManualCreated{}, err
	}
	return out, nil
}
