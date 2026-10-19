-- +goose Up
-- +goose StatementBegin
ALTER TABLE process_participations
    ADD COLUMN profile_snapshot JSONB,
    ADD CONSTRAINT participation_profile_snapshot_shape CHECK (
        profile_snapshot IS NULL OR COALESCE(
            jsonb_typeof(profile_snapshot) = 'object'
            AND profile_snapshot ?& ARRAY['city','skills','years_of_experience','education_level']
            AND profile_snapshot - ARRAY['city','skills','years_of_experience','education_level'] = '{}'::jsonb
            AND jsonb_typeof(profile_snapshot->'city') IN ('string','null')
            AND jsonb_typeof(profile_snapshot->'skills') = 'array'
            AND NOT jsonb_path_exists(profile_snapshot, 'strict $.skills[*] ? (@.type() != "string")')
            AND CASE jsonb_typeof(profile_snapshot->'years_of_experience')
                WHEN 'null' THEN true
                WHEN 'number' THEN
                    (profile_snapshot->>'years_of_experience')::numeric >= 0
                    AND trunc((profile_snapshot->>'years_of_experience')::numeric) = (profile_snapshot->>'years_of_experience')::numeric
                ELSE false
            END
            AND (profile_snapshot->'education_level' = 'null'::jsonb
                OR (jsonb_typeof(profile_snapshot->'education_level') = 'string'
                    AND profile_snapshot->>'education_level' IN ('high_school','bachelor','master','phd'))),
            false
        )
    );
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM process_participations WHERE profile_snapshot IS NOT NULL) THEN
        RAISE EXCEPTION 'profile snapshots exist; retention requires an explicit decision';
    END IF;
END $$;
ALTER TABLE process_participations
    DROP CONSTRAINT participation_profile_snapshot_shape,
    DROP COLUMN profile_snapshot;
-- +goose StatementEnd
