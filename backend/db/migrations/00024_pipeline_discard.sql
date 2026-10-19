-- +goose Up
-- +goose StatementBegin
ALTER TABLE process_participations
 ADD COLUMN previous_stage_id UUID,
 ADD COLUMN reason_group TEXT,
 ADD COLUMN reason_code TEXT,
 ADD COLUMN comment TEXT,
 ADD COLUMN candidate_message TEXT,
 ADD COLUMN discarded_at TIMESTAMPTZ,
 ADD CONSTRAINT participation_discard_catalog CHECK (
  (reason_group='recruiter' AND reason_code IN ('requirements_not_met','profile_mismatch','salary_expectation','other_candidate_selected','other'))
  OR (reason_group='candidate' AND reason_code IN ('accepted_other_offer','no_longer_interested','unresponsive','other'))
 ),
 ADD CONSTRAINT participation_discard_shape CHECK (
  (previous_stage_id IS NULL AND reason_group IS NULL AND reason_code IS NULL AND comment IS NULL AND candidate_message IS NULL AND discarded_at IS NULL)
  OR (previous_stage_id IS NOT NULL AND previous_stage_id<>stage_id AND reason_group IS NOT NULL AND reason_code IS NOT NULL AND discarded_at IS NOT NULL
   AND (reason_code<>'other' OR comment IS NOT NULL))
 ),
 ADD CONSTRAINT participation_discard_text CHECK (
  (comment IS NULL OR char_length(comment) BETWEEN 1 AND 1000)
  AND (candidate_message IS NULL OR char_length(candidate_message) BETWEEN 1 AND 500)
 );
ALTER TABLE participation_stage_history
 ADD COLUMN event_kind TEXT,
 ADD COLUMN reason_group TEXT,
 ADD COLUMN reason_code TEXT,
 ADD COLUMN comment TEXT,
 ADD COLUMN candidate_message TEXT;
-- Existing cut-4 intakes and moves retain their identities, actor, flags and time.
UPDATE participation_stage_history SET event_kind=CASE WHEN from_stage_id IS NULL THEN 'intake' ELSE 'move' END;
ALTER TABLE participation_stage_history
 ALTER COLUMN event_kind SET NOT NULL,
 ALTER COLUMN event_kind SET DEFAULT 'intake',
 ADD CONSTRAINT participation_history_event_kind CHECK (event_kind IN ('intake','move','discard','recovery')),
 ADD CONSTRAINT participation_history_discard_catalog CHECK (
  (reason_group='recruiter' AND reason_code IN ('requirements_not_met','profile_mismatch','salary_expectation','other_candidate_selected','other'))
  OR (reason_group='candidate' AND reason_code IN ('accepted_other_offer','no_longer_interested','unresponsive','other'))
 ),
 ADD CONSTRAINT participation_history_event_shape CHECK (
  (event_kind='intake' AND from_stage_id IS NULL AND reason_group IS NULL AND reason_code IS NULL AND comment IS NULL AND candidate_message IS NULL)
  OR (event_kind IN ('move','recovery') AND from_stage_id IS NOT NULL AND reason_group IS NULL AND reason_code IS NULL AND comment IS NULL AND candidate_message IS NULL AND (event_kind<>'recovery' OR NOT departure))
  OR (event_kind='discard' AND from_stage_id IS NOT NULL AND NOT hire AND reason_group IS NOT NULL AND reason_code IS NOT NULL AND (reason_code<>'other' OR comment IS NOT NULL))
 ),
 ADD CONSTRAINT participation_history_discard_text CHECK (
  (comment IS NULL OR char_length(comment) BETWEEN 1 AND 1000)
  AND (candidate_message IS NULL OR char_length(candidate_message) BETWEEN 1 AND 500)
 );
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Never erase retained personal data/history as a side effect of a rollback.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM process_participations WHERE previous_stage_id IS NOT NULL OR reason_group IS NOT NULL OR reason_code IS NOT NULL OR comment IS NOT NULL OR candidate_message IS NOT NULL OR discarded_at IS NOT NULL)
 OR EXISTS (SELECT 1 FROM participation_stage_history WHERE event_kind IN ('discard','recovery') OR reason_group IS NOT NULL OR reason_code IS NOT NULL OR comment IS NOT NULL OR candidate_message IS NOT NULL) THEN
  RAISE EXCEPTION 'discard data exists; rollback requires an explicit retention decision';
 END IF;
END $$;
ALTER TABLE participation_stage_history
 DROP CONSTRAINT participation_history_discard_text,
 DROP CONSTRAINT participation_history_event_shape,
 DROP CONSTRAINT participation_history_discard_catalog,
 DROP CONSTRAINT participation_history_event_kind,
 DROP COLUMN event_kind, DROP COLUMN reason_group, DROP COLUMN reason_code, DROP COLUMN comment, DROP COLUMN candidate_message;
ALTER TABLE process_participations
 DROP CONSTRAINT participation_discard_text,
 DROP CONSTRAINT participation_discard_shape,
 DROP CONSTRAINT participation_discard_catalog,
 DROP COLUMN previous_stage_id, DROP COLUMN reason_group, DROP COLUMN reason_code, DROP COLUMN comment, DROP COLUMN candidate_message, DROP COLUMN discarded_at;
-- +goose StatementEnd
