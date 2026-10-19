-- +goose Up
-- +goose StatementBegin
ALTER TABLE process_participations ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE participation_stage_history
 ADD COLUMN from_stage_id UUID,
 ADD COLUMN hire BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN departure BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN actor_kind TEXT NOT NULL DEFAULT 'candidate' CHECK (actor_kind IN ('candidate','recruiter')),
 ADD CONSTRAINT participation_history_movement_shape CHECK (
  (from_stage_id IS NULL AND actor_kind='candidate' AND NOT hire AND NOT departure)
  OR (from_stage_id IS NOT NULL AND actor_kind='recruiter' AND from_stage_id<>stage_id AND NOT (hire AND departure))
 );
CREATE INDEX participation_history_order_idx ON participation_stage_history (participation_id, created_at, id);
CREATE INDEX process_participations_stage_idx ON process_participations (process_id, stage_id);
CREATE TABLE process_coverage_milestones (
 id UUID PRIMARY KEY,
 process_id UUID NOT NULL REFERENCES vacancy_processes (id),
 reached_at TIMESTAMPTZ NOT NULL,
 covered INTEGER NOT NULL CHECK (covered > 0),
 required INTEGER NOT NULL CHECK (required BETWEEN 1 AND 999),
 CHECK (covered >= required)
);
CREATE INDEX process_coverage_milestones_first_idx ON process_coverage_milestones (process_id, reached_at, id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Preserve movement history and coverage evidence until retention is decided.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM process_participations WHERE version<>1)
 OR EXISTS (SELECT 1 FROM participation_stage_history WHERE from_stage_id IS NOT NULL OR hire OR departure OR actor_kind<>'candidate')
 OR EXISTS (SELECT 1 FROM process_coverage_milestones) THEN
  RAISE EXCEPTION 'movement data exists; rollback requires an explicit retention decision';
 END IF;
END $$;
DROP TABLE process_coverage_milestones;
DROP INDEX process_participations_stage_idx;
DROP INDEX participation_history_order_idx;
ALTER TABLE participation_stage_history DROP CONSTRAINT participation_history_movement_shape,
 DROP COLUMN actor_kind, DROP COLUMN departure, DROP COLUMN hire, DROP COLUMN from_stage_id;
ALTER TABLE process_participations DROP COLUMN version;
-- +goose StatementEnd
