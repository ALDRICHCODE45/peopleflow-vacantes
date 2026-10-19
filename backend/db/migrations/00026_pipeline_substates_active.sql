-- +goose Up
-- +goose StatementBegin
-- Stage kinds and catalog ids live in encoded per-vacancy configuration. Their
-- integrity is enforced under the shared draft lock in set/move/discard/catalog PUT.
ALTER TABLE process_participations
 ADD COLUMN substate_id UUID,
 ADD CONSTRAINT participation_substate_shape CHECK (substate_id IS NULL OR discarded_at IS NULL);
CREATE INDEX process_participations_substate_idx ON process_participations(process_id,substate_id) WHERE substate_id IS NOT NULL;
ALTER TABLE participation_stage_history
 ADD COLUMN from_substate_id UUID,
 ADD COLUMN from_substate_name TEXT,
 ADD COLUMN to_substate_id UUID,
 ADD COLUMN to_substate_name TEXT,
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
 ),
 ADD CONSTRAINT participation_history_substate_shape CHECK (
  (event_kind<>'substate' AND from_substate_id IS NULL AND from_substate_name IS NULL AND to_substate_id IS NULL AND to_substate_name IS NULL)
  OR (event_kind='substate'
   AND from_substate_id IS DISTINCT FROM to_substate_id
   AND ((from_substate_id IS NULL AND from_substate_name IS NULL) OR (from_substate_id IS NOT NULL AND from_substate_name IS NOT NULL AND char_length(from_substate_name) BETWEEN 1 AND 40))
   AND ((to_substate_id IS NULL AND to_substate_name IS NULL) OR (to_substate_id IS NOT NULL AND to_substate_name IS NOT NULL AND char_length(to_substate_name) BETWEEN 1 AND 40)))
 );
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM process_participations WHERE substate_id IS NOT NULL)
 OR EXISTS (SELECT 1 FROM participation_stage_history WHERE event_kind='substate' OR from_substate_id IS NOT NULL OR from_substate_name IS NOT NULL OR to_substate_id IS NOT NULL OR to_substate_name IS NOT NULL) THEN
  RAISE EXCEPTION 'substate data exists; rollback requires an explicit retention decision';
 END IF;
END $$;
ALTER TABLE participation_stage_history
 DROP CONSTRAINT participation_history_substate_shape,
 DROP CONSTRAINT participation_history_event_shape,
 DROP CONSTRAINT participation_history_event_kind,
 DROP CONSTRAINT participation_history_movement_shape,
 DROP COLUMN from_substate_id, DROP COLUMN from_substate_name, DROP COLUMN to_substate_id, DROP COLUMN to_substate_name,
 ADD CONSTRAINT participation_history_event_kind CHECK (event_kind IN ('intake','move','discard','recovery')),
 ADD CONSTRAINT participation_history_movement_shape CHECK (
  (from_stage_id IS NULL AND actor_kind='candidate' AND NOT hire AND NOT departure)
  OR (from_stage_id IS NOT NULL AND actor_kind='recruiter' AND from_stage_id<>stage_id AND NOT (hire AND departure))
 ),
 ADD CONSTRAINT participation_history_event_shape CHECK (
  (event_kind='intake' AND from_stage_id IS NULL AND reason_group IS NULL AND reason_code IS NULL AND comment IS NULL AND candidate_message IS NULL)
  OR (event_kind IN ('move','recovery') AND from_stage_id IS NOT NULL AND reason_group IS NULL AND reason_code IS NULL AND comment IS NULL AND candidate_message IS NULL AND (event_kind<>'recovery' OR NOT departure))
  OR (event_kind='discard' AND from_stage_id IS NOT NULL AND NOT hire AND reason_group IS NOT NULL AND reason_code IS NOT NULL AND (reason_code<>'other' OR comment IS NOT NULL))
 );
DROP INDEX process_participations_substate_idx;
ALTER TABLE process_participations DROP CONSTRAINT participation_substate_shape, DROP COLUMN substate_id;
-- +goose StatementEnd
