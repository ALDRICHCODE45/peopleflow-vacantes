-- +goose Up
-- +goose StatementBegin
CREATE TABLE psychometric_consents (
 invitation_id UUID PRIMARY KEY REFERENCES psychometric_invitations(id) ON DELETE CASCADE,
 notice_version TEXT NOT NULL,
 text_sha256 TEXT NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
 consented_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE psychometric_answers (
 invitation_id UUID NOT NULL REFERENCES psychometric_invitations(id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 63),
 value INTEGER CHECK (value BETWEEN 1 AND 5),
 client_elapsed_ms BIGINT CHECK (client_elapsed_ms BETWEEN 0 AND 3600000),
 received_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY (invitation_id,position),
 CHECK (value IS NOT NULL OR client_elapsed_ms IS NULL)
);
CREATE TABLE psychometric_answer_events (
 invitation_id UUID NOT NULL REFERENCES psychometric_invitations(id) ON DELETE CASCADE,
 event_id UUID NOT NULL,
 position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 63),
 kind TEXT NOT NULL CHECK (kind IN ('put','delete')),
 value INTEGER CHECK (value BETWEEN 1 AND 5),
 client_elapsed_ms BIGINT CHECK (client_elapsed_ms BETWEEN 0 AND 3600000),
 received_at TIMESTAMPTZ NOT NULL,
 -- Allocated under the invitation lock: contiguous per invitation, including
 -- accepted same-value PUTs and empty DELETEs; no sequence consumed by retries.
 server_sequence BIGINT NOT NULL CHECK (server_sequence > 0),
 PRIMARY KEY (invitation_id,event_id),
 UNIQUE (invitation_id,server_sequence),
 CHECK ((kind='put' AND value IS NOT NULL) OR (kind='delete' AND value IS NULL AND client_elapsed_ms IS NULL))
);
-- Immutable B2 payloads, reserved for the finish writer and B9 snapshot reads.
CREATE TABLE psychometric_results (
 invitation_id UUID PRIMARY KEY REFERENCES psychometric_invitations(id) ON DELETE CASCADE,
 content_version TEXT NOT NULL,
 scoring_version TEXT NOT NULL,
 finished_at TIMESTAMPTZ NOT NULL,
 snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot)='object')
);
CREATE TABLE psychometric_comparisons (
 id UUID PRIMARY KEY,
 invitation_id UUID NOT NULL REFERENCES psychometric_results(invitation_id) ON DELETE CASCADE,
 profile_version TEXT,
 profile_snapshot JSONB,
 content_version TEXT NOT NULL,
 scoring_version TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL,
 snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot)='object')
);
CREATE INDEX psychometric_comparisons_order ON psychometric_comparisons(invitation_id,created_at,id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
LOCK TABLE psychometric_consents,psychometric_answers,psychometric_answer_events,psychometric_results,psychometric_comparisons IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM psychometric_consents) OR EXISTS (SELECT 1 FROM psychometric_answers)
 OR EXISTS (SELECT 1 FROM psychometric_answer_events) OR EXISTS (SELECT 1 FROM psychometric_results)
 OR EXISTS (SELECT 1 FROM psychometric_comparisons) THEN
  RAISE EXCEPTION 'psychometric assessment data exist; rollback requires an explicit retention decision';
 END IF;
END $$;
DROP TABLE psychometric_comparisons;
DROP TABLE psychometric_results;
DROP TABLE psychometric_answer_events;
DROP TABLE psychometric_answers;
DROP TABLE psychometric_consents;
-- +goose StatementEnd
