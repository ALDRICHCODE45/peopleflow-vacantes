-- +goose Up
-- +goose StatementBegin
-- Only company-owned corrections live here. Candidate accounts, profiles and
-- participation snapshots remain untouched. Empty rows serialize first edits.
CREATE TABLE company_candidate_corrections (
 company_id UUID NOT NULL REFERENCES companies(id),
 user_id UUID NOT NULL REFERENCES users(id),
 corrections JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(corrections)='object'),
 version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
 updated_at TIMESTAMPTZ,
 updated_by UUID,
 PRIMARY KEY (company_id,user_id)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
LOCK TABLE company_candidate_corrections, company_candidate_history IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM company_candidate_corrections WHERE corrections <> '{}'::jsonb OR version <> 1 OR updated_at IS NOT NULL OR updated_by IS NOT NULL)
 OR EXISTS (SELECT 1 FROM company_candidate_history WHERE candidate_kind='organic') THEN
  RAISE EXCEPTION 'organic corrections or history exist; rollback requires an explicit retention decision';
 END IF;
END $$;
DROP TABLE company_candidate_corrections;
-- +goose StatementEnd
