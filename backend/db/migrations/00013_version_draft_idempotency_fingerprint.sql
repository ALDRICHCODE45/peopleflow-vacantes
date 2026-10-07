-- +goose Up
-- +goose StatementBegin
-- Idempotency fingerprint algorithm versioning.
--
-- Migration 00012 stored the canonical writable bytes directly in
-- job_draft_idempotency.fingerprint. That single representation cannot be
-- extended: a replay could only be decided by assuming every stored value was
-- canonical bytes, so any future digest or normalization change would silently
-- compare against the wrong representation.
--
-- This migration adds an explicit, persisted algorithm discriminator. The
-- `fingerprint` column keeps its exact meaning under each tag:
--
--   'go-json-v1+canonical-bytes' -- fingerprint holds the raw canonical
--                                   go-json-v1 writable bytes verbatim
--                                   (the pre-00013 representation).
--   'go-json-v1+sha256'          -- fingerprint holds sha256(canonical
--                                   go-json-v1 writable bytes), exactly 32
--                                   bytes (the representation new writers use).
--
-- The NOT NULL DEFAULT is the legacy tag, so ADD COLUMN tags every existing
-- row correctly and an insert from a pre-00013 binary that does not name the
-- column is also tagged legacy. Existing `fingerprint` bytes are never
-- reinterpreted, rewritten or rehashed.
--
-- The CHECK constrains only the digest representation: a row tagged with the
-- sha256 algorithm must carry exactly 32 bytes. The legacy representation has
-- an unbounded canonical length and is deliberately unconstrained.
ALTER TABLE job_draft_idempotency
    ADD COLUMN fingerprint_algorithm TEXT NOT NULL
        DEFAULT 'go-json-v1+canonical-bytes';

ALTER TABLE job_draft_idempotency
    ADD CONSTRAINT job_draft_idempotency_fingerprint_length_check
        CHECK (
            fingerprint_algorithm <> 'go-json-v1+sha256'
            OR octet_length(fingerprint) = 32
        );
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Refuse transactionally while any row uses a non-legacy representation.
-- Dropping `fingerprint_algorithm` would leave those 32-byte digests stored in
-- `fingerprint`, where the pre-00013 code would read them back as canonical
-- bytes and compare them against a payload that can never match, turning every
-- replay into a conflict. Raising here aborts the whole down transaction, so
-- the column is preserved and no digest row is silently orphaned. A table whose
-- rows are all legacy drops cleanly, because the legacy representation is
-- exactly what the pre-00013 schema expects.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM job_draft_idempotency
        WHERE fingerprint_algorithm <> 'go-json-v1+canonical-bytes'
    ) THEN
        RAISE EXCEPTION
            'refusing 00013 down: job_draft_idempotency has rows with a non-legacy fingerprint_algorithm';
    END IF;
END
$$;

ALTER TABLE job_draft_idempotency
    DROP CONSTRAINT job_draft_idempotency_fingerprint_length_check;

ALTER TABLE job_draft_idempotency
    DROP COLUMN fingerprint_algorithm;
-- +goose StatementEnd
