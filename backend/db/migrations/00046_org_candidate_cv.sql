-- +goose Up
-- +goose StatementBegin
-- Additive overlay only: original participation references are never replaced.
ALTER TABLE process_participations ADD COLUMN corrected_company_cv_id UUID REFERENCES company_candidate_cvs(id);
CREATE INDEX process_participations_corrected_cv_idx ON process_participations(corrected_company_cv_id) WHERE corrected_company_cv_id IS NOT NULL;
ALTER TABLE company_candidate_history
 ADD COLUMN kind TEXT NOT NULL DEFAULT 'edit',
 ADD COLUMN participation_id UUID REFERENCES process_participations(id),
 ADD COLUMN file_name TEXT,
 DROP CONSTRAINT company_candidate_history_changes_check,
 ADD CONSTRAINT company_candidate_history_shape CHECK (
  (kind='edit' AND jsonb_typeof(changes)='array' AND jsonb_array_length(changes)>0 AND participation_id IS NULL AND file_name IS NULL)
  OR (kind='cv_corrected' AND changes='[]'::jsonb AND participation_id IS NOT NULL AND file_name IS NOT NULL)
 );
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
LOCK TABLE process_participations, company_candidate_history IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM process_participations WHERE corrected_company_cv_id IS NOT NULL)
 OR EXISTS (SELECT 1 FROM company_candidate_history WHERE kind='cv_corrected') THEN
  RAISE EXCEPTION 'corrected CV or history exists; rollback requires an explicit retention decision';
 END IF;
END $$;
ALTER TABLE company_candidate_history
 DROP CONSTRAINT company_candidate_history_shape,
 DROP COLUMN kind, DROP COLUMN participation_id, DROP COLUMN file_name,
 ADD CONSTRAINT company_candidate_history_changes_check CHECK (jsonb_typeof(changes)='array' AND jsonb_array_length(changes)>0);
ALTER TABLE process_participations DROP COLUMN corrected_company_cv_id;
-- +goose StatementEnd
