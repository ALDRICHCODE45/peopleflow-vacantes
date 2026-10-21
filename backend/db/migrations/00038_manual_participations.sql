-- +goose Up
-- +goose StatementBegin
ALTER TABLE process_participations
 ALTER COLUMN candidate_id DROP NOT NULL,
 ALTER COLUMN cv_version_id DROP NOT NULL,
 ADD COLUMN company_candidate_id UUID REFERENCES company_candidates(id),
 ADD COLUMN company_candidate_cv_id UUID REFERENCES company_candidate_cvs(id),
 ADD COLUMN added_by UUID REFERENCES users(id),
 DROP CONSTRAINT process_participations_source_check,
 ADD CONSTRAINT process_participations_source_check CHECK (source IN ('organic','manual')),
 ADD CONSTRAINT process_participations_identity CHECK ((candidate_id IS NULL) <> (company_candidate_id IS NULL)),
 ADD CONSTRAINT process_participations_manual_unique UNIQUE (process_id, company_candidate_id),
 ADD CONSTRAINT process_participations_origin CHECK (
  (source='organic' AND candidate_id IS NOT NULL AND cv_version_id IS NOT NULL AND company_candidate_cv_id IS NULL AND added_by IS NULL)
  OR (source='manual' AND cv_version_id IS NULL AND company_candidate_cv_id IS NOT NULL AND added_by IS NOT NULL)
 ),
 ADD CONSTRAINT process_participations_manual_cv_owner FOREIGN KEY (company_candidate_cv_id, company_candidate_id) REFERENCES company_candidate_cvs(id, company_candidate_id);
CREATE INDEX process_participations_manual_cv_idx ON process_participations(company_candidate_cv_id);
ALTER TABLE participation_stage_history
 DROP CONSTRAINT participation_history_movement_shape,
 ADD CONSTRAINT participation_history_movement_shape CHECK (
  (from_stage_id IS NULL AND actor_kind='candidate' AND NOT hire AND NOT departure)
  OR (from_stage_id IS NOT NULL AND actor_kind='recruiter' AND from_stage_id<>stage_id AND NOT (hire AND departure))
  OR (event_kind='substate' AND from_stage_id IS NULL AND actor_kind='recruiter' AND NOT hire AND NOT departure)
  OR (event_kind='not_applicable' AND from_stage_id IS NULL AND actor_kind='recruiter' AND NOT hire AND NOT departure)
  OR (event_kind='intake' AND from_stage_id IS NULL AND actor_kind='recruiter' AND NOT hire AND NOT departure)
 );
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
LOCK TABLE process_participations, participation_stage_history IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM process_participations WHERE source='manual')
 OR EXISTS (SELECT 1 FROM participation_stage_history WHERE event_kind='intake' AND actor_kind='recruiter') THEN
  RAISE EXCEPTION 'manual participation data exists; rollback requires an explicit retention decision';
 END IF;
END $$;
ALTER TABLE participation_stage_history
 DROP CONSTRAINT participation_history_movement_shape,
 ADD CONSTRAINT participation_history_movement_shape CHECK (
  (from_stage_id IS NULL AND actor_kind='candidate' AND NOT hire AND NOT departure)
  OR (from_stage_id IS NOT NULL AND actor_kind='recruiter' AND from_stage_id<>stage_id AND NOT (hire AND departure))
  OR (event_kind='substate' AND from_stage_id IS NULL AND actor_kind='recruiter' AND NOT hire AND NOT departure)
  OR (event_kind='not_applicable' AND from_stage_id IS NULL AND actor_kind='recruiter' AND NOT hire AND NOT departure)
 );
ALTER TABLE process_participations
 DROP CONSTRAINT process_participations_origin,
 DROP CONSTRAINT process_participations_identity,
 DROP CONSTRAINT process_participations_source_check,
 DROP COLUMN company_candidate_cv_id,
 DROP COLUMN company_candidate_id,
 DROP COLUMN added_by,
 ALTER COLUMN candidate_id SET NOT NULL,
 ALTER COLUMN cv_version_id SET NOT NULL,
 ADD CONSTRAINT process_participations_source_check CHECK (source = 'organic');
-- +goose StatementEnd
