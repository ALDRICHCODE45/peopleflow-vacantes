-- +goose Up
-- +goose StatementBegin
CREATE TABLE process_participations (
    id UUID PRIMARY KEY,
    process_id UUID NOT NULL REFERENCES vacancy_processes (id),
    candidate_id UUID NOT NULL REFERENCES users (id),
    stage_id UUID NOT NULL,
    cv_version_id UUID NOT NULL REFERENCES candidate_cv_versions (id),
    questions_snapshot JSONB NOT NULL CHECK (jsonb_typeof(questions_snapshot) = 'array'),
    answers_snapshot JSONB NOT NULL CHECK (jsonb_typeof(answers_snapshot) = 'array'),
    source TEXT NOT NULL CHECK (source = 'organic'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (process_id, candidate_id),
    FOREIGN KEY (cv_version_id, candidate_id) REFERENCES candidate_cv_versions (id, candidate_id)
);
CREATE INDEX process_participations_candidate_idx ON process_participations (candidate_id, created_at DESC, id DESC);
CREATE INDEX process_participations_cv_idx ON process_participations (cv_version_id);
CREATE TABLE participation_stage_history (
    id UUID PRIMARY KEY,
    participation_id UUID NOT NULL REFERENCES process_participations (id),
    stage_id UUID NOT NULL,
    actor_id UUID NOT NULL REFERENCES users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE participation_idempotency (
    candidate_id UUID NOT NULL REFERENCES users (id),
    process_id UUID NOT NULL REFERENCES vacancy_processes (id),
    idem_key UUID NOT NULL,
    fingerprint BYTEA NOT NULL CHECK (octet_length(fingerprint) = 32),
    fingerprint_algorithm TEXT NOT NULL CHECK (fingerprint_algorithm = 'go-json-v1+sha256'),
    response_body BYTEA NOT NULL,
    PRIMARY KEY (candidate_id, process_id, idem_key)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Never silently discard candidate history or idempotency evidence.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM process_participations) OR EXISTS (SELECT 1 FROM participation_idempotency) THEN
  RAISE EXCEPTION 'participation data exists; rollback requires an explicit retention decision';
 END IF;
END $$;
DROP TABLE participation_idempotency;
DROP TABLE participation_stage_history;
DROP TABLE process_participations;
-- +goose StatementEnd
