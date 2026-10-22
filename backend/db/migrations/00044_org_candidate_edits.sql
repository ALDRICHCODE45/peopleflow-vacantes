-- +goose Up
-- +goose StatementBegin
ALTER TABLE company_candidates
 ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
 ADD COLUMN updated_at TIMESTAMPTZ,
 ADD COLUMN updated_by UUID;
-- Deterministic provenance for pre-existing records. No new edit is invented.
UPDATE company_candidates SET updated_at=created_at, updated_by=created_by;

-- Company-private history, never shared audit metadata. Actor IDs survive account
-- deletion. Candidate identity is composite so future organic corrections fit.
CREATE TABLE company_candidate_history (
 id UUID PRIMARY KEY,
 company_id UUID NOT NULL REFERENCES companies(id),
 candidate_kind TEXT NOT NULL CHECK (candidate_kind IN ('manual','organic')),
 candidate_id UUID NOT NULL,
 actor_id UUID NOT NULL,
 at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 changes JSONB NOT NULL CHECK (jsonb_typeof(changes)='array' AND jsonb_array_length(changes)>0)
);
CREATE INDEX company_candidate_history_page_idx
 ON company_candidate_history(company_id,candidate_kind,candidate_id,at DESC,id DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
LOCK TABLE company_candidates, company_candidate_history IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM company_candidate_history)
 OR EXISTS (SELECT 1 FROM company_candidates WHERE version <> 1 OR
   (updated_at IS NOT NULL AND updated_at IS DISTINCT FROM created_at) OR
   (updated_by IS NOT NULL AND updated_by IS DISTINCT FROM created_by)) THEN
  RAISE EXCEPTION 'candidate edit history exists; rollback requires an explicit retention decision';
 END IF;
END $$;
DROP TABLE company_candidate_history;
ALTER TABLE company_candidates DROP COLUMN version, DROP COLUMN updated_at, DROP COLUMN updated_by;
-- +goose StatementEnd
