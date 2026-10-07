// Package draftstore implements the private vacancy draft persistence port
// (drafts.Store) against PostgreSQL.
//
// The adapter owns the *pgxpool.Pool and opens one transaction per operation so
// authorization, the draft write, its audit event and (for create) the
// idempotency record commit together or not at all. It never begins a
// transaction inside the audit port: the audit adapter is tx-scoped and appends
// inside the caller-owned transaction.
//
// Authorization is re-evaluated transactionally. The live user, then the live
// company, then the membership are re-read with FOR SHARE in a fixed lock order
// and held through commit, so a concurrent revoke/update/delete of the same
// principal blocks rather than racing. A role supplied by request context is
// never trusted.
//
// The stored `fields` column is the canonical writable envelope produced by the
// approved serializer ({"schema_version":1,"fields":{...}}). The response
// envelope is re-derived from those bytes plus the derived description_plain
// and the immutable requester catalog name; the mutable draftinput.Fields struct
// is never the source of the persisted or returned bytes.
package draftstore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftrich"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// createOperation is the idempotency operation discriminator for POST.
const createOperation = "create"

// roleOwner is the membership role that may read and save any draft in its
// company (alongside the draft principal).
const roleOwner = "owner"

// timestampLayout renders server timestamps as UTC RFC3339 with microseconds.
const timestampLayout = "2006-01-02T15:04:05.000000Z"

// Store is the PostgreSQL adapter for drafts.Store.
type Store struct {
	pool  *pgxpool.Pool
	audit auditrepositories.AuditEventRepository
}

// NewStore wraps the connection pool and the stateless, tx-scoped audit port.
// The pool is retained so every operation can open its own transaction; the
// audit adapter appends inside that transaction.
func NewStore(pool *pgxpool.Pool, audit auditrepositories.AuditEventRepository) *Store {
	return &Store{pool: pool, audit: audit}
}

// Compile-time assertion that the adapter satisfies the port.
var _ drafts.Store = (*Store)(nil)

// draftRecord is one job_drafts row projected into Go values.
type draftRecord struct {
	id          uuid.UUID
	companyID   uuid.UUID
	createdBy   uuid.UUID
	principalID uuid.UUID
	status      string
	version     int64
	fields      []byte
	createdAt   time.Time
	updatedAt   time.Time
}

// authContext carries the live membership role read under the transaction locks.
type authContext struct {
	role string
}

// Create implements drafts.Store.Create. See the port documentation for the
// contract; the adapter validates the idempotency key, re-evaluates
// authorization, validates any referenced requester transactionally, stores the
// canonical writable bytes, persists the idempotency record and appends the
// create audit event, all in one transaction.
//
// The draft row stores the canonical writable bytes unchanged. The idempotency
// record stores the SHA-256 digest of those bytes and the explicit
// FingerprintAlgorithmSHA256 tag, so a replay is compared under the persisted
// representation and a pre-00013 row (raw canonical bytes under the legacy
// tag) still replays from its original bytes.
func (s *Store) Create(ctx context.Context, companyID, actorID uuid.UUID, key string, body []byte) (drafts.Result, error) {
	if key == "" {
		return drafts.Result{}, drafts.ErrIdempotencyKeyRequired
	}
	parsedKey, err := uuid.Parse(key)
	if err != nil {
		return drafts.Result{}, drafts.ErrInvalidIdempotencyKey
	}
	// Canonicalize once: the raw client text is never used as identity, so
	// alternative spellings of one UUID (unhyphenated, uppercase, urn/braced)
	// share one advisory lock, one idempotency row and one replay.
	canonicalKey := parsedKey.String()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin create tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	auth, err := s.lockGates(ctx, tx, companyID, actorID)
	if err != nil {
		return drafts.Result{}, err
	}

	create, err := draftinput.DecodeCreate(body)
	if err != nil {
		return drafts.Result{}, mapInputError(err)
	}
	fingerprint := create.Fingerprint()

	if err := lockIdempotencyKey(ctx, tx, companyID, actorID, createOperation, canonicalKey); err != nil {
		return drafts.Result{}, err
	}

	existing, found, err := findIdempotency(ctx, tx, companyID, actorID, createOperation, canonicalKey)
	if err != nil {
		return drafts.Result{}, err
	}
	if found {
		// Re-authorize the addressed draft (its id is derived from the stored
		// ETag, never from client input) after the general gates and before any
		// conflict or replay return.
		if err := authorizeAddressedDraft(ctx, tx, auth, actorID, companyID, existing.etag); err != nil {
			return drafts.Result{}, err
		}
		// Dispatch the comparison by the persisted algorithm. An unknown tag or
		// a malformed digest is an internal invariant failure that fails closed
		// before any write, never a silent replay or conflict. Authorization has
		// already run above, so this branch cannot leak an addressed draft.
		match, err := fingerprintsMatch(existing.algorithm, existing.fingerprint, fingerprint)
		if err != nil {
			return drafts.Result{}, err
		}
		if !match {
			return drafts.Result{}, drafts.ErrIdempotencyConflict
		}
		return drafts.Result{Body: existing.body, ETag: existing.etag, Replayed: true}, nil
	}

	name, err := requesterNameForWrite(ctx, tx, companyID, fingerprint)
	if err != nil {
		return drafts.Result{}, err
	}

	draftID := uuid.Must(uuid.NewV7())
	record := draftRecord{
		id:          draftID,
		companyID:   companyID,
		createdBy:   actorID,
		principalID: actorID,
		status:      "draft",
		version:     1,
		fields:      fingerprint,
	}
	if err := tx.QueryRow(ctx,
		`INSERT INTO job_drafts (id, company_id, created_by, principal_recruiter_id, status, version, fields)
		 VALUES ($1, $2, $3, $4, 'draft', 1, $5)
		 RETURNING created_at, updated_at`,
		draftID, companyID, actorID, actorID, fingerprint,
	).Scan(&record.createdAt, &record.updatedAt); err != nil {
		return drafts.Result{}, fmt.Errorf("insert draft: %w", err)
	}

	responseBody, err := renderEnvelope(record, name)
	if err != nil {
		return drafts.Result{}, err
	}
	etag, err := draftversion.FormatETag(draftID.String(), record.version)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("format create etag: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO job_draft_idempotency
		     (id, company_id, actor_id, operation, idem_key, fingerprint, fingerprint_algorithm, response_body, response_etag)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		uuid.Must(uuid.NewV7()), companyID, actorID, createOperation, canonicalKey,
		fingerprintDigest(fingerprint), FingerprintAlgorithmSHA256, responseBody, etag,
	); err != nil {
		return drafts.Result{}, fmt.Errorf("insert idempotency record: %w", err)
	}

	if err := s.audit.Append(ctx, tx, newDraftEvent(actorID, entities.EventJobDraftCreated, draftID, record.version)); err != nil {
		return drafts.Result{}, fmt.Errorf("co-write draft create audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return drafts.Result{}, fmt.Errorf("commit create tx: %w", err)
	}
	return drafts.Result{Body: responseBody, ETag: etag, Replayed: false}, nil
}

// Get implements drafts.Store.Get. It re-evaluates the general gates, reads the
// addressed draft scoped to the session company, enforces owner-or-principal
// and renders the current read envelope.
func (s *Store) Get(ctx context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin get tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	auth, err := s.lockGates(ctx, tx, companyID, actorID)
	if err != nil {
		return drafts.Result{}, err
	}

	record, found, err := readDraft(ctx, tx, companyID, id, false)
	if err != nil {
		return drafts.Result{}, err
	}
	if !found || !authorized(auth, actorID, record) {
		return drafts.Result{}, drafts.ErrNotFound
	}

	name, err := requesterNameForRead(ctx, tx, companyID, record.fields)
	if err != nil {
		return drafts.Result{}, err
	}
	responseBody, err := renderEnvelope(record, name)
	if err != nil {
		return drafts.Result{}, err
	}
	etag, err := draftversion.FormatETag(record.id.String(), record.version)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("format get etag: %w", err)
	}
	return drafts.Result{Body: responseBody, ETag: etag, Replayed: false}, nil
}

// Save implements drafts.Store.Save. The precondition is evaluated strictly
// after resource authorization, the patch is merged over the canonical bytes,
// and a real change increments the version and appends a save audit event in
// the same transaction. A byte-identical save is a no-op with no version bump,
// no timestamp change and no audit.
func (s *Store) Save(ctx context.Context, companyID, actorID, id uuid.UUID, ifMatch string, present bool, body []byte) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin save tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	auth, err := s.lockGates(ctx, tx, companyID, actorID)
	if err != nil {
		return drafts.Result{}, err
	}

	record, found, err := readDraft(ctx, tx, companyID, id, true)
	if err != nil {
		return drafts.Result{}, err
	}
	if !found || !authorized(auth, actorID, record) {
		return drafts.Result{}, drafts.ErrNotFound
	}

	tag, err := draftversion.ParseIfMatch(ifMatch, present)
	if err != nil {
		return drafts.Result{}, mapPreconditionError(err)
	}
	if err := draftversion.Compare(draftversion.Tag{ID: id.String(), Version: record.version}, tag); err != nil {
		return drafts.Result{}, drafts.ErrVersionConflict
	}

	patch, err := draftinput.DecodePatch(body)
	if err != nil {
		return drafts.Result{}, mapInputError(err)
	}

	merged, err := mergeWritable(record.fields, patch.Fingerprint())
	if err != nil {
		return drafts.Result{}, err
	}

	if bytes.Equal(merged, record.fields) {
		name, err := requesterNameForRead(ctx, tx, companyID, record.fields)
		if err != nil {
			return drafts.Result{}, err
		}
		responseBody, err := renderEnvelope(record, name)
		if err != nil {
			return drafts.Result{}, err
		}
		etag, err := draftversion.FormatETag(record.id.String(), record.version)
		if err != nil {
			return drafts.Result{}, fmt.Errorf("format no-op etag: %w", err)
		}
		return drafts.Result{Body: responseBody, ETag: etag, Replayed: false}, nil
	}

	if record.version == math.MaxInt64 {
		return drafts.Result{}, drafts.ErrVersionOverflow
	}
	newVersion := record.version + 1

	name, err := requesterNameForWrite(ctx, tx, companyID, merged)
	if err != nil {
		return drafts.Result{}, err
	}

	var updatedAt time.Time
	if err := tx.QueryRow(ctx,
		`UPDATE job_drafts
		    SET fields = $1, version = $2, updated_at = now()
		  WHERE id = $3 AND company_id = $4 AND version = $5
		  RETURNING updated_at`,
		merged, newVersion, id, companyID, record.version,
	).Scan(&updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Defense-in-depth: the row is locked FOR UPDATE, so a lost CAS is
			// unreachable via the designed flow.
			return drafts.Result{}, drafts.ErrVersionConflict
		}
		return drafts.Result{}, fmt.Errorf("update draft: %w", err)
	}

	record.fields = merged
	record.version = newVersion
	record.updatedAt = updatedAt

	responseBody, err := renderEnvelope(record, name)
	if err != nil {
		return drafts.Result{}, err
	}
	etag, err := draftversion.FormatETag(record.id.String(), record.version)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("format save etag: %w", err)
	}

	if err := s.audit.Append(ctx, tx, newDraftEvent(actorID, entities.EventJobDraftSaved, id, record.version)); err != nil {
		return drafts.Result{}, fmt.Errorf("co-write draft save audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return drafts.Result{}, fmt.Errorf("commit save tx: %w", err)
	}
	return drafts.Result{Body: responseBody, ETag: etag, Replayed: false}, nil
}

// lockGates re-reads the live user, company and membership with FOR SHARE in a
// fixed user-then-company-then-member order and holds the locks through the
// caller's commit. It classifies each gate failure with its own sentinel so the
// HTTP layer can project the exact contract code.
func (s *Store) lockGates(ctx context.Context, tx pgx.Tx, companyID, actorID uuid.UUID) (authContext, error) {
	var liveUserID uuid.UUID
	if err := tx.QueryRow(ctx,
		`SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR SHARE`, actorID,
	).Scan(&liveUserID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return authContext{}, drafts.ErrUnauthenticated
		}
		return authContext{}, fmt.Errorf("lock live user: %w", err)
	}

	var status string
	var deletedAt pgtype.Timestamptz
	if err := tx.QueryRow(ctx,
		`SELECT status, deleted_at FROM companies WHERE id = $1 FOR SHARE`, companyID,
	).Scan(&status, &deletedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return authContext{}, drafts.ErrCompanyInactive
		}
		return authContext{}, fmt.Errorf("lock live company: %w", err)
	}
	if deletedAt.Valid {
		return authContext{}, drafts.ErrCompanyInactive
	}
	if status != "active" {
		return authContext{}, drafts.ErrCompanyNotActive
	}

	var role string
	if err := tx.QueryRow(ctx,
		`SELECT role FROM company_members WHERE user_id = $1 AND company_id = $2 FOR SHARE`, actorID, companyID,
	).Scan(&role); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return authContext{}, drafts.ErrForbidden
		}
		return authContext{}, fmt.Errorf("lock membership: %w", err)
	}
	return authContext{role: role}, nil
}

// authorized reports whether auth may read or save record: the company owner or
// the draft principal. The creator (createdBy) alone is intentionally NOT
// sufficient; principal reassignment is a future concern.
func authorized(auth authContext, actorID uuid.UUID, record draftRecord) bool {
	return auth.role == roleOwner || actorID == record.principalID
}

// authorizeAddressedDraft re-checks owner/principal on the draft addressed by an
// idempotency record's stored ETag. The draft id comes from the server-issued
// ETag, never from client input, and the lookup is scoped to the session company
// so a cross-company draft is indistinguishable from a missing one.
func authorizeAddressedDraft(ctx context.Context, tx pgx.Tx, auth authContext, actorID, companyID uuid.UUID, etag string) error {
	tag, err := draftversion.ParseIfMatch(etag, true)
	if err != nil {
		return fmt.Errorf("parse stored idempotency etag: %w", err)
	}
	draftID, err := uuid.Parse(tag.ID)
	if err != nil {
		return fmt.Errorf("parse stored idempotency draft id: %w", err)
	}
	record, found, err := readDraft(ctx, tx, companyID, draftID, false)
	if err != nil {
		return err
	}
	if !found || !authorized(auth, actorID, record) {
		return drafts.ErrNotFound
	}
	return nil
}

// readDraft loads one draft scoped to the session company. When lock is true the
// row is taken FOR UPDATE for the save path.
func readDraft(ctx context.Context, tx pgx.Tx, companyID, id uuid.UUID, lock bool) (draftRecord, bool, error) {
	query := `SELECT id, company_id, created_by, principal_recruiter_id, status, version, fields, created_at, updated_at
	            FROM job_drafts WHERE id = $1 AND company_id = $2`
	if lock {
		query += " FOR UPDATE"
	}

	var record draftRecord
	err := tx.QueryRow(ctx, query, id, companyID).Scan(
		&record.id, &record.companyID, &record.createdBy, &record.principalID,
		&record.status, &record.version, &record.fields, &record.createdAt, &record.updatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return draftRecord{}, false, nil
	}
	if err != nil {
		return draftRecord{}, false, fmt.Errorf("read draft: %w", err)
	}
	return record, true, nil
}

// idempotencyRecord is one stored idempotency row. fingerprint is interpreted
// through algorithm: the raw canonical writable bytes under the legacy tag and
// a 32-byte SHA-256 digest under the sha256 tag.
type idempotencyRecord struct {
	fingerprint []byte
	algorithm   string
	body        []byte
	etag        string
}

// lockIdempotencyKey serializes concurrent requests that share one idempotency
// key with a transaction-scoped advisory lock on a bounded, stable key. The
// UNIQUE constraint remains the database authority; the advisory lock only
// makes the read-then-insert race-free.
func lockIdempotencyKey(ctx context.Context, tx pgx.Tx, companyID, actorID uuid.UUID, operation, key string) error {
	payload := companyID.String() + ":" + actorID.String() + ":" + operation + ":" + key
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, payload); err != nil {
		return fmt.Errorf("lock idempotency key: %w", err)
	}
	return nil
}

// findIdempotency reads the existing idempotency record for the key, if any,
// including the persisted fingerprint algorithm so the caller can dispatch the
// comparison by representation instead of guessing it.
func findIdempotency(ctx context.Context, tx pgx.Tx, companyID, actorID uuid.UUID, operation, key string) (idempotencyRecord, bool, error) {
	var record idempotencyRecord
	err := tx.QueryRow(ctx,
		`SELECT fingerprint, fingerprint_algorithm, response_body, response_etag
		   FROM job_draft_idempotency
		  WHERE company_id = $1 AND actor_id = $2 AND operation = $3 AND idem_key = $4`,
		companyID, actorID, operation, key,
	).Scan(&record.fingerprint, &record.algorithm, &record.body, &record.etag)
	if errors.Is(err, pgx.ErrNoRows) {
		return idempotencyRecord{}, false, nil
	}
	if err != nil {
		return idempotencyRecord{}, false, fmt.Errorf("read idempotency record: %w", err)
	}
	return record, true, nil
}

// newDraftEvent builds a PII-free draft audit event. The metadata carries only
// the version string.
func newDraftEvent(actorID uuid.UUID, eventType string, draftID uuid.UUID, version int64) entities.AuditEvent {
	actor := actorID
	return entities.AuditEvent{
		ID:         uuid.Must(uuid.NewV7()),
		ActorType:  entities.ActorTypeUser,
		ActorID:    &actor,
		EventType:  eventType,
		EntityType: entities.EntityJobDraft,
		EntityID:   draftID,
		Metadata:   map[string]string{"version": strconv.FormatInt(version, 10)},
	}
}

// mapInputError projects a draftinput composition failure onto the port errors.
func mapInputError(err error) error {
	switch {
	case errors.Is(err, draftinput.ErrPayloadTooLarge):
		return drafts.ErrPayloadTooLarge
	case errors.Is(err, draftinput.ErrEmptyPatch):
		return drafts.ErrEmptyPatch
	case errors.Is(err, draftinput.ErrValidation):
		return drafts.ErrValidation
	case errors.Is(err, draftinput.ErrInvalidRequest):
		return drafts.ErrInvalidRequest
	default:
		return fmt.Errorf("decode draft body: %w", err)
	}
}

// mapPreconditionError projects a draftversion precondition failure onto the
// port errors.
func mapPreconditionError(err error) error {
	switch {
	case errors.Is(err, draftversion.ErrPreconditionRequired):
		return drafts.ErrPreconditionRequired
	case errors.Is(err, draftversion.ErrInvalidRequest):
		return drafts.ErrInvalidRequest
	default:
		return fmt.Errorf("parse if-match: %w", err)
	}
}

// mergeWritable replaces every key present in the delta's fields object over the
// current canonical fields and re-encodes the canonical envelope. Present keys
// replace fully (no nested merge); absent keys and array order are preserved.
func mergeWritable(current, delta []byte) ([]byte, error) {
	currentFields, err := envelopeFieldsOf(current)
	if err != nil {
		return nil, err
	}
	deltaFields, err := envelopeFieldsOf(delta)
	if err != nil {
		return nil, err
	}

	merged := make(map[string]any, len(currentFields)+len(deltaFields))
	for key, value := range currentFields {
		merged[key] = value
	}
	for key, value := range deltaFields {
		merged[key] = value
	}

	encoded, err := draftjson.EncodeValidatedValue(map[string]any{
		"schema_version": int64(1),
		"fields":         merged,
	})
	if err != nil {
		return nil, fmt.Errorf("encode merged fields: %w", err)
	}
	return encoded, nil
}

// envelopeFieldsOf decodes a canonical writable envelope and returns its fields
// object.
func envelopeFieldsOf(canonical []byte) (map[string]any, error) {
	value, err := draftjson.Decode(canonical)
	if err != nil {
		return nil, fmt.Errorf("decode canonical envelope: %w", err)
	}
	object, ok := value.(map[string]any)
	if !ok || object == nil {
		return nil, errors.New("draftstore: canonical envelope is not an object")
	}
	fields, ok := object["fields"].(map[string]any)
	if !ok || fields == nil {
		return nil, errors.New("draftstore: canonical envelope has no fields object")
	}
	return fields, nil
}

// renderEnvelope builds the complete read envelope from a draft record and the
// derived requester catalog name. The derived description_plain is always
// present (null when the description is null) and the requester name is added to
// a present requester object.
func renderEnvelope(record draftRecord, requesterName *string) ([]byte, error) {
	fields, err := envelopeFieldsOf(record.fields)
	if err != nil {
		return nil, err
	}

	plain, err := deriveDescriptionPlain(fields["description"])
	if err != nil {
		return nil, err
	}
	fields["description_plain"] = plain

	if requester, ok := fields["requester"].(map[string]any); ok && requester != nil {
		var name any
		if requesterName != nil {
			name = *requesterName
		}
		requester["name"] = name
	}

	envelope := map[string]any{
		"schema_version":         int64(1),
		"id":                     record.id.String(),
		"status":                 record.status,
		"principal_recruiter_id": record.principalID.String(),
		"version":                strconv.FormatInt(record.version, 10),
		"created_at":             record.createdAt.UTC().Format(timestampLayout),
		"updated_at":             record.updatedAt.UTC().Format(timestampLayout),
		"fields":                 fields,
	}
	encoded, err := draftjson.EncodeValidatedValue(envelope)
	if err != nil {
		return nil, fmt.Errorf("encode read envelope: %w", err)
	}
	return encoded, nil
}

// deriveDescriptionPlain validates the stored description with the approved
// rich validator and returns its derived plain text, or null when the
// description is null.
func deriveDescriptionPlain(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	document, err := draftrich.ValidateDocument(value)
	if err != nil {
		return nil, fmt.Errorf("derive description_plain: %w", err)
	}
	if document == nil {
		return nil, nil
	}
	return document.Plain, nil
}

// requesterRef reads the authoritative requester kind and id from the canonical
// writable bytes. present is false when the requester is null or absent; id is
// nil when it is null.
func requesterRef(canonical []byte) (kind string, id *string, present bool, err error) {
	fields, err := envelopeFieldsOf(canonical)
	if err != nil {
		return "", nil, false, err
	}
	raw, ok := fields["requester"]
	if !ok || raw == nil {
		return "", nil, false, nil
	}
	object, ok := raw.(map[string]any)
	if !ok || object == nil {
		return "", nil, false, errors.New("draftstore: requester is not an object")
	}
	if value, ok := object["kind"].(string); ok {
		kind = value
	}
	if value, ok := object["id"].(string); ok {
		copied := value
		id = &copied
	}
	return kind, id, true, nil
}

// requesterNameForWrite resolves the immutable catalog name for a referenced
// requester, rejecting an id that does not belong to the same company and kind.
// It returns nil when the requester is null or its id is null.
func requesterNameForWrite(ctx context.Context, tx pgx.Tx, companyID uuid.UUID, canonical []byte) (*string, error) {
	kind, id, present, err := requesterRef(canonical)
	if err != nil {
		return nil, err
	}
	if !present || id == nil {
		return nil, nil
	}
	name, found, err := lookupRequesterName(ctx, tx, companyID, kind, *id)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, drafts.ErrValidation
	}
	return &name, nil
}

// requesterNameForRead resolves the catalog name for a stored requester. A
// missing catalog row is a server-side invariant failure, never a client error.
func requesterNameForRead(ctx context.Context, tx pgx.Tx, companyID uuid.UUID, canonical []byte) (*string, error) {
	kind, id, present, err := requesterRef(canonical)
	if err != nil {
		return nil, err
	}
	if !present || id == nil {
		return nil, nil
	}
	name, found, err := lookupRequesterName(ctx, tx, companyID, kind, *id)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("draftstore: requester catalog entry %s (%s) missing for company %s", *id, kind, companyID)
	}
	return &name, nil
}

// lookupRequesterName reads the immutable catalog name for an exact
// (company, kind, id) triple.
func lookupRequesterName(ctx context.Context, tx pgx.Tx, companyID uuid.UUID, kind, id string) (string, bool, error) {
	requesterID, err := uuid.Parse(id)
	if err != nil {
		return "", false, nil
	}
	var name string
	err = tx.QueryRow(ctx,
		`SELECT name FROM job_draft_requesters WHERE id = $1 AND company_id = $2 AND kind = $3`,
		requesterID, companyID, kind,
	).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("read requester name: %w", err)
	}
	return name, true, nil
}
