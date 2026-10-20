-- +goose Up
-- +goose StatementBegin
ALTER TABLE process_participations DROP CONSTRAINT participation_profile_snapshot_shape;
-- This is a JSONB column, not a canonical BYTEA draft document. Preserve all
-- other snapshot data; legacy free text is deliberately not mapped to a code.
UPDATE process_participations
SET profile_snapshot = (profile_snapshot - 'city') || jsonb_build_object('location', NULL)
WHERE profile_snapshot IS NOT NULL;
ALTER TABLE process_participations ADD CONSTRAINT participation_profile_snapshot_shape CHECK (
    profile_snapshot IS NULL OR COALESCE(
        jsonb_typeof(profile_snapshot) = 'object'
        AND profile_snapshot ?& ARRAY['location','skills','years_of_experience','education_level']
        AND profile_snapshot - ARRAY['location','skills','years_of_experience','education_level'] = '{}'::jsonb
        AND (
            profile_snapshot->'location' = 'null'::jsonb OR (
                jsonb_typeof(profile_snapshot->'location') = 'object'
                AND (profile_snapshot->'location') ?& ARRAY['country','state','municipality']
                AND (profile_snapshot->'location') - ARRAY['country','state','municipality'] = '{}'::jsonb
                AND jsonb_typeof(profile_snapshot->'location'->'country') = 'string'
                AND profile_snapshot->'location'->>'country' ~ '^[A-Z]{2}$'
                AND (profile_snapshot->'location'->'state' = 'null'::jsonb OR (
                    jsonb_typeof(profile_snapshot->'location'->'state') = 'string'
                    AND profile_snapshot->'location'->>'state' ~ '^[0-9]{2}$'
                    AND profile_snapshot->'location'->>'country' = 'MX'
                ))
                AND (profile_snapshot->'location'->'municipality' = 'null'::jsonb OR (
                    jsonb_typeof(profile_snapshot->'location'->'municipality') = 'string'
                    AND profile_snapshot->'location'->>'municipality' ~ '^[0-9]{5}$'
                    AND jsonb_typeof(profile_snapshot->'location'->'state') = 'string'
                    AND left(profile_snapshot->'location'->>'municipality', 2) = profile_snapshot->'location'->>'state'
                ))
            )
        )
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
ALTER TABLE process_participations DROP CONSTRAINT participation_profile_snapshot_shape;
UPDATE process_participations
SET profile_snapshot = (profile_snapshot - 'location') || jsonb_build_object('city', NULL)
WHERE profile_snapshot IS NOT NULL;
-- Restore the exact 00029 constraint, preserving its guarded subsequent down.
ALTER TABLE process_participations ADD CONSTRAINT participation_profile_snapshot_shape CHECK (
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
