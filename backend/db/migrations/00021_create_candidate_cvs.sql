-- +goose Up
-- +goose StatementBegin
-- File metadata is append-only. Labels and library removal never mutate versions.
CREATE TABLE candidate_cv_versions (
    id UUID PRIMARY KEY,
    candidate_id UUID NOT NULL REFERENCES users (id),
    storage_key TEXT NOT NULL UNIQUE CHECK (storage_key ~ '^[0-9a-f]{64}$'),
    size BIGINT NOT NULL CHECK (size BETWEEN 1 AND 5242880),
    content_type TEXT NOT NULL CHECK (content_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, candidate_id)
);
CREATE TABLE candidate_cv_library (
    id UUID PRIMARY KEY,
    candidate_id UUID NOT NULL REFERENCES users (id),
    version_id UUID NOT NULL UNIQUE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    removed_at TIMESTAMPTZ,
    FOREIGN KEY (version_id, candidate_id) REFERENCES candidate_cv_versions (id, candidate_id)
);
CREATE INDEX candidate_cv_library_live_idx ON candidate_cv_library (candidate_id) WHERE removed_at IS NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Refuse a destructive rollback after personal documents have been stored.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM candidate_cv_versions) THEN
  RAISE EXCEPTION 'candidate CV data exists; rollback requires an explicit retention decision';
 END IF;
END $$;
DROP TABLE candidate_cv_library;
DROP TABLE candidate_cv_versions;
-- +goose StatementEnd
