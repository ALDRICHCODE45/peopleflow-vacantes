-- +goose Up
-- +goose StatementBegin
ALTER TABLE process_participations DROP CONSTRAINT participation_profile_snapshot_shape;
-- Snapshots are JSONB (not draft BYTEA). PostgreSQL already rejects actual
-- escaped NUL characters at insertion; literal backslash-u0000 text is safe.
-- Preserve historical values, including all nonnegative integer years accepted
-- by 00033, rather than imposing the current profile-write upper bound here.
UPDATE process_participations SET profile_snapshot =
    (profile_snapshot - ARRAY['years_of_experience','education_level']) ||
    jsonb_build_object('years_of_experience',trim_scale((profile_snapshot->>'years_of_experience')::numeric)::text,
        'seniority',NULL,'languages','[]'::jsonb,
        'education',jsonb_build_object('highest_completed',profile_snapshot->'education_level','in_progress',NULL))
WHERE profile_snapshot IS NOT NULL;
ALTER TABLE process_participations ADD CONSTRAINT participation_profile_snapshot_shape CHECK (
    profile_snapshot IS NULL OR COALESCE(
        jsonb_typeof(profile_snapshot) = 'object'
        AND profile_snapshot ?& ARRAY['location','skills','years_of_experience','seniority','education','languages']
        AND profile_snapshot - ARRAY['location','skills','years_of_experience','seniority','education','languages'] = '{}'::jsonb
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
        AND (profile_snapshot->'years_of_experience' = 'null'::jsonb OR (
            jsonb_typeof(profile_snapshot->'years_of_experience') = 'string'
            AND profile_snapshot->>'years_of_experience' ~ '^(0|[1-9][0-9]*)(\.[0-9])?$'))
        AND (profile_snapshot->'seniority' = 'null'::jsonb OR (
            jsonb_typeof(profile_snapshot->'seniority') = 'string'
            AND profile_snapshot->>'seniority' IN ('intern','junior','semi_senior','senior','lead','manager','director')))
        AND jsonb_typeof(profile_snapshot->'education') = 'object'
        AND (profile_snapshot->'education') ?& ARRAY['highest_completed','in_progress']
        AND (profile_snapshot->'education') - ARRAY['highest_completed','in_progress'] = '{}'::jsonb
        AND (profile_snapshot->'education'->'in_progress' = 'null'::jsonb OR (
            jsonb_typeof(profile_snapshot->'education'->'in_progress') = 'string'
            AND profile_snapshot->'education'->>'in_progress' IN ('secondary','high_school','technical','tsu','bachelor','specialty','master','phd')))
        AND (profile_snapshot->'education'->'highest_completed' = 'null'::jsonb OR (
            jsonb_typeof(profile_snapshot->'education'->'highest_completed') = 'string'
            AND profile_snapshot->'education'->>'highest_completed' IN ('secondary','high_school','technical','tsu','bachelor','specialty','master','phd')))
        AND jsonb_typeof(profile_snapshot->'languages') = 'array'
        -- Count positively validated elements: strict-path missing members yield
        -- unknown, which a negated invalid-element search can silently miss.
        AND jsonb_array_length(jsonb_path_query_array(profile_snapshot,
            'strict $.languages[*] ? (@.type() == "object" && exists(@.code) && exists(@.level) && @.code.type() == "string" && @.level.type() == "string" && @.code like_regex "^[a-z]{2,3}$" && (@.level == "A1" || @.level == "A2" || @.level == "B1" || @.level == "B2" || @.level == "C1" || @.level == "C2" || @.level == "native"))'))
            = jsonb_array_length(profile_snapshot->'languages')
        AND NOT jsonb_path_exists(profile_snapshot, 'strict $.languages[*].keyvalue() ? (@.key != "code" && @.key != "level")'),
        false
    )
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM process_participations WHERE profile_snapshot IS NOT NULL AND (
        CASE WHEN profile_snapshot->>'years_of_experience' IS NULL THEN false
            ELSE (profile_snapshot->>'years_of_experience')::numeric <> trunc((profile_snapshot->>'years_of_experience')::numeric) END
        OR profile_snapshot->'seniority' <> 'null'::jsonb
        OR profile_snapshot->'languages' <> '[]'::jsonb
        OR profile_snapshot->'education'->'in_progress' <> 'null'::jsonb
        OR (profile_snapshot->'education'->>'highest_completed' IS NOT NULL AND
            profile_snapshot->'education'->>'highest_completed' NOT IN ('high_school','bachelor','master','phd'))
    )) THEN
        RAISE EXCEPTION '00043 Down refuses non-representable participation profiles';
    END IF;
END $$;
ALTER TABLE process_participations DROP CONSTRAINT participation_profile_snapshot_shape;
UPDATE process_participations SET profile_snapshot =
    (profile_snapshot - ARRAY['years_of_experience','seniority','education','languages']) ||
    jsonb_build_object('years_of_experience',trunc((profile_snapshot->>'years_of_experience')::numeric),
        'education_level',profile_snapshot->'education'->'highest_completed')
WHERE profile_snapshot IS NOT NULL;
-- Restore the exact 00033 constraint.
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
