-- +goose Up
-- +goose StatementBegin
-- Preserve every existing branch verbatim; not_applicable is not an entry into
-- a stage and must never participate in delivery's intake/move/recovery queries.
ALTER TABLE participation_stage_history
 DROP CONSTRAINT participation_history_event_kind,
 DROP CONSTRAINT participation_history_event_shape,
 DROP CONSTRAINT participation_history_movement_shape,
 ADD CONSTRAINT participation_history_event_kind CHECK (event_kind IN ('intake','move','discard','recovery','substate','not_applicable')),
 ADD CONSTRAINT participation_history_movement_shape CHECK (
  (from_stage_id IS NULL AND actor_kind='candidate' AND NOT hire AND NOT departure)
  OR (from_stage_id IS NOT NULL AND actor_kind='recruiter' AND from_stage_id<>stage_id AND NOT (hire AND departure))
  OR (event_kind='substate' AND from_stage_id IS NULL AND actor_kind='recruiter' AND NOT hire AND NOT departure)
  OR (event_kind='not_applicable' AND from_stage_id IS NULL AND actor_kind='recruiter' AND NOT hire AND NOT departure)
 ),
 ADD CONSTRAINT participation_history_event_shape CHECK (
  (event_kind='intake' AND from_stage_id IS NULL AND reason_group IS NULL AND reason_code IS NULL AND comment IS NULL AND candidate_message IS NULL)
  OR (event_kind IN ('move','recovery') AND from_stage_id IS NOT NULL AND reason_group IS NULL AND reason_code IS NULL AND comment IS NULL AND candidate_message IS NULL AND (event_kind<>'recovery' OR NOT departure))
  OR (event_kind='discard' AND from_stage_id IS NOT NULL AND NOT hire AND reason_group IS NOT NULL AND reason_code IS NOT NULL AND (reason_code<>'other' OR comment IS NOT NULL))
  OR (event_kind='substate' AND from_stage_id IS NULL AND actor_kind='recruiter' AND NOT hire AND NOT departure AND reason_group IS NULL AND reason_code IS NULL AND comment IS NULL AND candidate_message IS NULL)
  OR (event_kind='not_applicable' AND from_stage_id IS NULL AND actor_kind='recruiter' AND NOT hire AND NOT departure AND reason_group IS NULL AND reason_code IS NULL AND comment IS NULL AND candidate_message IS NULL)
 );
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM participation_stage_history WHERE event_kind='not_applicable') THEN
  RAISE EXCEPTION 'not applicable history exists; rollback requires an explicit retention decision';
 END IF;
END $$;
ALTER TABLE participation_stage_history
 DROP CONSTRAINT participation_history_event_kind,
 DROP CONSTRAINT participation_history_event_shape,
 DROP CONSTRAINT participation_history_movement_shape,
 ADD CONSTRAINT participation_history_event_kind CHECK (event_kind IN ('intake','move','discard','recovery','substate')),
 ADD CONSTRAINT participation_history_movement_shape CHECK (
  (from_stage_id IS NULL AND actor_kind='candidate' AND NOT hire AND NOT departure)
  OR (from_stage_id IS NOT NULL AND actor_kind='recruiter' AND from_stage_id<>stage_id AND NOT (hire AND departure))
  OR (event_kind='substate' AND from_stage_id IS NULL AND actor_kind='recruiter' AND NOT hire AND NOT departure)
 ),
 ADD CONSTRAINT participation_history_event_shape CHECK (
  (event_kind='intake' AND from_stage_id IS NULL AND reason_group IS NULL AND reason_code IS NULL AND comment IS NULL AND candidate_message IS NULL)
  OR (event_kind IN ('move','recovery') AND from_stage_id IS NOT NULL AND reason_group IS NULL AND reason_code IS NULL AND comment IS NULL AND candidate_message IS NULL AND (event_kind<>'recovery' OR NOT departure))
  OR (event_kind='discard' AND from_stage_id IS NOT NULL AND NOT hire AND reason_group IS NOT NULL AND reason_code IS NOT NULL AND (reason_code<>'other' OR comment IS NOT NULL))
  OR (event_kind='substate' AND from_stage_id IS NULL AND actor_kind='recruiter' AND NOT hire AND NOT departure AND reason_group IS NULL AND reason_code IS NULL AND comment IS NULL AND candidate_message IS NULL)
 );
-- +goose StatementEnd
