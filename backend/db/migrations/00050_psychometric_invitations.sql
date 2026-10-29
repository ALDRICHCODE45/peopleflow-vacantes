-- +goose Up
-- +goose StatementBegin
CREATE TABLE psychometric_invitations (
 id UUID PRIMARY KEY,
 participation_id UUID NOT NULL REFERENCES process_participations(id) ON DELETE CASCADE,
 test TEXT NOT NULL,
 content_version TEXT NOT NULL,
 scoring_version TEXT NOT NULL,
 total_count INTEGER NOT NULL CHECK (total_count > 0),
 answered_count INTEGER NOT NULL DEFAULT 0 CHECK (answered_count BETWEEN 0 AND total_count),
 origin TEXT NOT NULL CHECK (origin IN ('manual','auto')),
 created_by UUID REFERENCES users(id),
 trigger_stage_id UUID,
 created_at TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 consented_at TIMESTAMPTZ,
 finished_at TIMESTAMPTZ,
 revoked_at TIMESTAMPTZ,
 last_reminded_at TIMESTAMPTZ,
 reminder_count INTEGER NOT NULL DEFAULT 0 CHECK (reminder_count >= 0),
 purge_after TIMESTAMPTZ NOT NULL,
 token_hash BYTEA CHECK (token_hash IS NULL OR octet_length(token_hash) = 32),
 -- Expiry cannot appear in an immutable index predicate. A replacement releases
 -- an expired row's slot under the participation lock, without revoking it or
 -- moving its retention anchor. All writers must follow that protocol.
 superseded_at TIMESTAMPTZ,
 CHECK (superseded_at IS NULL OR superseded_at >= expires_at)
);
CREATE UNIQUE INDEX psychometric_invitations_active_unique
 ON psychometric_invitations(participation_id,test)
 WHERE finished_at IS NULL AND revoked_at IS NULL AND superseded_at IS NULL;
CREATE UNIQUE INDEX psychometric_invitations_finished_unique
 ON psychometric_invitations(participation_id,test)
 WHERE finished_at IS NOT NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX psychometric_invitations_token_unique
 ON psychometric_invitations(token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX psychometric_invitations_latest
 ON psychometric_invitations(participation_id,created_at DESC,id DESC);
CREATE INDEX psychometric_invitations_purge ON psychometric_invitations(purge_after);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
LOCK TABLE psychometric_invitations IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM psychometric_invitations) THEN
  RAISE EXCEPTION 'psychometric invitation data exist; rollback requires an explicit retention decision';
 END IF;
END $$;
DROP TABLE psychometric_invitations;
-- +goose StatementEnd
