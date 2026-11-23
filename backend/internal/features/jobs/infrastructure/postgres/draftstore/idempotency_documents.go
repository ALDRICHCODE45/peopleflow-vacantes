package draftstore

import (
	"context"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// DocumentUploadOperation is the `operation` of the document upload's rows in job_draft_idempotency
// (placement-vacancy-documents-v1 D26): no TTL, no new table, `response_etag` is empty.
const DocumentUploadOperation = "placement-document-upload:r1"

// ReplayDocumentUpload is the idempotency step of the upload transaction, with exactly the semantics of the draft,
// team and replacement writes: it serializes racing requests that share a key with the transaction-scoped advisory lock
// (the key must already be canonical) and looks the key up under (company, actor, operation, key).
//
//   - no row: found=false, the caller creates the document and calls RecordDocumentUpload in the same transaction;
//   - same fingerprint: found=true and the frozen response body (the caller answers it with Idempotency-Replayed: true);
//   - another fingerprint: drafts.ErrIdempotencyConflict.
//
// The caller must have re-authorized BEFORE calling it, so a revoked recruiter cannot replay. fingerprint is the canonical
// request; it is compared under the persisted algorithm tag like every other idempotent write.
func ReplayDocumentUpload(ctx context.Context, tx pgx.Tx, companyID, actorID uuid.UUID, key string, fingerprint []byte) ([]byte, bool, error) {
	if err := lockIdempotencyKey(ctx, tx, companyID, actorID, DocumentUploadOperation, key); err != nil {
		return nil, false, err
	}
	existing, found, err := findIdempotency(ctx, tx, companyID, actorID, DocumentUploadOperation, key)
	if err != nil || !found {
		return nil, false, err
	}
	match, err := fingerprintsMatch(existing.algorithm, existing.fingerprint, fingerprint)
	if err != nil {
		return nil, false, err
	}
	if !match {
		return nil, false, drafts.ErrIdempotencyConflict
	}
	return existing.body, true, nil
}

// RecordDocumentUpload freezes the upload's 201 body under its key, in the transaction that inserts the document rows and
// the audit event.
func RecordDocumentUpload(ctx context.Context, tx pgx.Tx, companyID, actorID uuid.UUID, key string, fingerprint, body []byte) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO job_draft_idempotency(id,company_id,actor_id,operation,idem_key,fingerprint,fingerprint_algorithm,response_body,response_etag) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'')`,
		uuid.Must(uuid.NewV7()), companyID, actorID, DocumentUploadOperation, key, fingerprintDigest(fingerprint), FingerprintAlgorithmSHA256, body)
	if err != nil {
		return fmt.Errorf("insert document idempotency record: %w", err)
	}
	return nil
}
