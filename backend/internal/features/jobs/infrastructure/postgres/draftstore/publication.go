package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publication"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancygeo"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancymanagement"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	publishOperation = "publish:v2"
)

var _ publication.Store = (*Store)(nil)

type publicationView struct {
	Status      string   `json:"status"`
	PublishedAt *string  `json:"publishedAt"`
	Missing     []string `json:"missing"`
}

// GetPublication holds a shared draft lock to read content/configuration from
// one coherent state. It never writes, including on never-configured drafts.
// A draft is published when its public projection exists (readPublicationAt): a
// private replacement has a process row and still reads as a draft.
func (s *Store) GetPublication(ctx context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin publication read: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	record, err := s.publicationDraft(ctx, tx, companyID, actorID, id, false)
	if err != nil {
		return drafts.Result{}, err
	}
	at, err := readPublicationAt(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	view := publicationView{Status: "draft", Missing: []string{}}
	if at != nil {
		view.Status = "published"
		v := at.UTC().Format(timestampLayout)
		view.PublishedAt = &v
	} else {
		missing, _, err := publicationRequirements(ctx, tx, record, s.clock())
		if err != nil {
			return drafts.Result{}, err
		}
		view.Missing = missing
	}
	body, err := json.Marshal(view)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("render publication: %w", err)
	}
	return drafts.Result{Body: body}, nil
}

// Publish follows §9.4: live gates and draft authorization, key shape, replay,
// draft precondition, already-published, then locked readiness and atomic write.
// Neither content nor configuration versions/timestamps are updated. It inserts the
// process row only for a draft that has none; a private replacement already has
// one, gets just its projection, and its clock (vacancy_processes.published_at)
// stays where the start put it.
func (s *Store) Publish(ctx context.Context, companyID, actorID, id uuid.UUID, key string, keyPresent bool, ifMatch string, present bool, body []byte) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin publication: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	record, err := s.publicationDraft(ctx, tx, companyID, actorID, id, true)
	if err != nil {
		return drafts.Result{}, err
	}
	if !keyPresent {
		return drafts.Result{}, drafts.ErrIdempotencyKeyRequired
	}
	parsedKey, err := uuid.Parse(key)
	if err != nil {
		return drafts.Result{}, drafts.ErrInvalidIdempotencyKey
	}
	key = parsedKey.String()
	if err := lockIdempotencyKey(ctx, tx, companyID, actorID, publishOperation, key); err != nil {
		return drafts.Result{}, err
	}
	existing, found, err := findIdempotency(ctx, tx, companyID, actorID, publishOperation, key)
	if err != nil {
		return drafts.Result{}, err
	}
	if found {
		// Include the addressed id so one key cannot replay a different draft.
		fingerprint, _, err := publicationPayload(id, body)
		if err != nil {
			return drafts.Result{}, err
		}
		match, err := fingerprintsMatch(existing.algorithm, existing.fingerprint, fingerprint)
		if err != nil {
			return drafts.Result{}, err
		}
		if !match {
			return drafts.Result{}, drafts.ErrIdempotencyConflict
		}
		return drafts.Result{Body: existing.body, ETag: existing.etag, Replayed: true}, nil
	}
	tag, err := draftversion.ParseIfMatchV2(ifMatch, present)
	if err != nil {
		return drafts.Result{}, mapPreconditionError(err)
	}
	if err := draftversion.Compare(draftversion.Tag{ID: id.String(), Version: record.version}, tag); err != nil {
		return drafts.Result{}, drafts.ErrVersionConflict
	}
	at, err := readPublicationAt(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if at != nil {
		return drafts.Result{}, publication.ErrAlreadyPublished
	}
	// A process without a public ad can only be a private replacement (or a draft
	// that never published). Publishing later is a live-process action: a closed
	// one answers like any invalid lifecycle transition, before the body and the
	// readiness, as the already-published check does.
	hasProcess, err := s.requirePublishableProcess(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	// For a fresh key, body validation cannot overtake the specified draft
	// precondition/already-published order. Replay compares its payload above.
	fingerprint, emptyObject, err := publicationPayload(id, body)
	if err != nil {
		return drafts.Result{}, err
	}
	if !emptyObject {
		return drafts.Result{}, drafts.ErrInvalidRequest
	}
	now := s.clock().UTC().Truncate(time.Microsecond)
	missing, snapshot, err := publicationRequirements(ctx, tx, record, now)
	if err != nil {
		return drafts.Result{}, err
	}
	if len(missing) > 0 {
		return drafts.Result{}, &publication.Incomplete{Missing: missing}
	}
	if !hasProcess {
		if _, err := tx.Exec(ctx, `INSERT INTO vacancy_processes (id,company_id,status,published_at,published_by) VALUES ($1,$2,'published',$3,$4)`, id, companyID, now, actorID); err != nil {
			return drafts.Result{}, fmt.Errorf("insert vacancy process: %w", err)
		}
	}
	if err := writePublicProjection(ctx, tx, record, now); err != nil {
		return drafts.Result{}, err
	}
	publishedAt := now.Format(timestampLayout)
	responseBody, err := json.Marshal(struct {
		ID          string `json:"id"`
		Status      string `json:"status"`
		PublishedAt string `json:"publishedAt"`
	}{id.String(), "published", publishedAt})
	if err != nil {
		return drafts.Result{}, fmt.Errorf("render published vacancy: %w", err)
	}
	etag, err := draftversion.FormatETagV2(id.String(), record.version)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("format publication etag: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO job_draft_idempotency (id,company_id,actor_id,operation,idem_key,fingerprint,fingerprint_algorithm,response_body,response_etag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, uuid.Must(uuid.NewV7()), companyID, actorID, publishOperation, key, fingerprintDigest(fingerprint), FingerprintAlgorithmSHA256, responseBody, etag); err != nil {
		return drafts.Result{}, fmt.Errorf("write publication idempotency: %w", err)
	}
	snapshotJSON, err := json.Marshal(snapshot)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("encode publication snapshot: %w", err)
	}
	if err := s.appendPublished(ctx, tx, actorID, companyID, id, record.version, publishedAt, snapshotJSON); err != nil {
		return drafts.Result{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return drafts.Result{}, fmt.Errorf("commit publication: %w", err)
	}
	return drafts.Result{Body: responseBody, ETag: etag}, nil
}

// appendPublished writes the VacancyPublished audit event of a publication, from
// Publish and from a replacement started with publish: true.
func (s *Store) appendPublished(ctx context.Context, tx pgx.Tx, actorID, companyID, id uuid.UUID, version int64, publishedAt string, snapshot []byte) error {
	event := newDraftEvent(actorID, companyID, audit.EventVacancyPublished, id, version)
	event.Metadata["publishedAt"] = publishedAt
	event.Metadata["snapshot"] = string(snapshot)
	if err := s.audit.Append(ctx, tx, event); err != nil {
		return fmt.Errorf("co-write publication audit: %w", err)
	}
	return nil
}

// requirePublishableProcess reports whether the draft already has a process row
// and refuses to publish a process that is neither published nor paused.
func (s *Store) requirePublishableProcess(ctx context.Context, tx pgx.Tx, id uuid.UUID) (bool, error) {
	var status string
	err := tx.QueryRow(ctx, `SELECT status FROM vacancy_processes WHERE id=$1`, id).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read publication process: %w", err)
	}
	if status == "published" || status == "paused" {
		return true, nil
	}
	current, _, err := readLifecycle(ctx, tx, id)
	if err != nil {
		return false, err
	}
	return false, &lifecycle.InvalidTransition{Action: "publish", Lifecycle: current}
}

func (s *Store) publicationDraft(ctx context.Context, tx pgx.Tx, companyID, actorID, id uuid.UUID, write bool) (draftRecord, error) {
	record, _, err := s.publicationDraftAs(ctx, tx, companyID, actorID, id, write)
	return record, err
}

// publicationDraftAs is publicationDraft that also returns the caller's live
// membership role, for writers whose rules depend on it (replacement Start).
func (s *Store) publicationDraftAs(ctx context.Context, tx pgx.Tx, companyID, actorID, id uuid.UUID, write bool) (draftRecord, authContext, error) {
	auth, err := s.lockGates(ctx, tx, companyID, actorID)
	if err != nil {
		return draftRecord{}, auth, err
	}
	if !write {
		var locked uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id FROM job_drafts WHERE id=$1 AND company_id=$2 FOR SHARE`, id, companyID).Scan(&locked); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return draftRecord{}, auth, drafts.ErrNotFound
			}
			return draftRecord{}, auth, fmt.Errorf("lock publication read: %w", err)
		}
	}
	record, found, err := readDraft(ctx, tx, companyID, id, write, actorID)
	if err != nil {
		return draftRecord{}, auth, err
	}
	if !found || !authorized(auth, actorID, record) {
		return draftRecord{}, auth, draftAccessError(ctx, tx, actorID, record, found)
	}
	if err := requireV2ReadDocument(record.fields); err != nil {
		return draftRecord{}, auth, err
	}
	return record, auth, nil
}

// readPublicationAt is when the draft's public ad went up, nil while it is not
// published. Only a replacement can be private (replacement-processes-v1 «Private
// by default»): a replacement is published when its projection exists, so a private
// one (a process row, no projection) reads as unpublished, with the projection's
// published_at. Every other process reads as it did before replacements: a process
// row is a published process, at the process clock (for an original the projection
// and the process are written with the same instant; a row without a projection is
// a legacy or seeded one that a save materializes).
func readPublicationAt(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*time.Time, error) {
	var at pgtype.Timestamptz
	err := tx.QueryRow(ctx, `SELECT CASE WHEN r.process_id IS NULL THEN p.published_at ELSE pp.published_at END
FROM vacancy_processes p
LEFT JOIN vacancy_replacements r ON r.process_id = p.id
LEFT JOIN vacancy_public_projections pp ON pp.id = p.id
WHERE p.id=$1`, id).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read publication: %w", err)
	}
	if !at.Valid {
		// A replacement without a projection: private.
		return nil, nil
	}
	if at.InfinityModifier != pgtype.Finite {
		return nil, errors.New("draftstore: invalid publication timestamp")
	}
	return &at.Time, nil
}

// readPublishedAt is the process clock (vacancy_processes.published_at): when
// the process started, which publishing a replacement later never moves. It is
// not a publication read.
func readPublishedAt(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*time.Time, error) {
	var at pgtype.Timestamptz
	err := tx.QueryRow(ctx, `SELECT published_at FROM vacancy_processes WHERE id=$1`, id).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read publication: %w", err)
	}
	if !at.Valid || at.InfinityModifier != pgtype.Finite {
		return nil, errors.New("draftstore: invalid publication timestamp")
	}
	return &at.Time, nil
}
func publicationPayload(id uuid.UUID, body []byte) ([]byte, bool, error) {
	if len(body) > pipelineconfig.MaxBodyBytes {
		return nil, false, drafts.ErrPayloadTooLarge
	}
	value, err := draftjson.Decode(body)
	if err != nil {
		return nil, false, drafts.ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	encoded, err := draftjson.EncodeValidatedValue(map[string]any{"id": id.String(), "body": value})
	if err != nil {
		return nil, false, fmt.Errorf("encode publication payload: %w", err)
	}
	return encoded, ok && len(root) == 0, nil
}

type publicationSnapshotValues struct {
	TargetQuantity  *int64  `json:"targetQuantity"`
	CutoffStageID   *string `json:"cutoffStageId"`
	CutoffStageName string  `json:"cutoffStageName"`
	CommitmentDate  *string `json:"commitmentDate"`
	HiringHeadcount *int64  `json:"hiringHeadcount"`
	RequestDate     *string `json:"requestDate"`
}

func publicationRequirements(ctx context.Context, tx pgx.Tx, record draftRecord, now time.Time) ([]string, publicationSnapshotValues, error) {
	var snapshot publicationSnapshotValues
	fields, err := envelopeFieldsOf(record.fields)
	if err != nil {
		return nil, snapshot, err
	}
	plain, err := deriveDescriptionPlain(fields["description"])
	if err != nil {
		return nil, snapshot, err
	}
	str := func(key string) string { v, _ := fields[key].(string); return v }
	offer := publication.Offer{
		Title: str("title"),

		WorkMode:         str("work_mode"),
		WorkSchedule:     str("work_schedule"),
		ContractType:     str("contract_type"),
		ProfessionalArea: str("professional_area"),
	}
	offer.Location, err = vacancygeo.ParseLocation(fields["location"])
	if err != nil {
		return nil, snapshot, err
	}
	offer.RemoteScope, err = vacancygeo.ParseRemoteScope(fields["remote_scope"])
	if err != nil {
		return nil, snapshot, err
	}
	if err := validateGeography(ctx, tx, record.fields); err != nil {
		return nil, snapshot, err
	}
	offer.DescriptionPlain, _ = plain.(string)
	_, requesterID, _, err := requesterRef(record.fields)
	if err != nil {
		return nil, snapshot, err
	}
	if requesterID != nil {
		if _, err := requesterNameForRead(ctx, tx, record.companyID, record.fields); err != nil {
			return nil, snapshot, err
		}
		offer.RequesterID = *requesterID
	}
	management, _, err := readManagement(ctx, tx, record.id)
	if err != nil {
		return nil, snapshot, err
	}
	delivery, _, err := readDelivery(ctx, tx, record.id)
	if err != nil {
		return nil, snapshot, err
	}
	pipeline, _, err := readPipeline(ctx, tx, record.id)
	if err != nil {
		return nil, snapshot, err
	}
	if delivery.CutoffStageID != nil {
		for _, stage := range pipeline.Stages {
			if stage.ID == *delivery.CutoffStageID {
				snapshot.CutoffStageName = stage.Name
				break
			}
		}
		if snapshot.CutoffStageName == "" {
			return nil, snapshot, errors.New("draftstore: dangling delivery cutoff")
		}
	}
	zone, err := time.LoadLocation(vacancymanagement.TimeZone)
	if err != nil {
		return nil, snapshot, fmt.Errorf("load publication timezone: %w", err)
	}
	snapshot.TargetQuantity = delivery.TargetQuantity
	snapshot.CutoffStageID = delivery.CutoffStageID
	snapshot.CommitmentDate = delivery.CommitmentDate
	snapshot.HiringHeadcount = management.HiringHeadcount
	snapshot.RequestDate = management.RequestDate
	return publication.Evaluate(offer, management, delivery, now, zone), snapshot, nil
}
