-- +goose Up
-- +goose StatementBegin
-- The application-time profile copy may freeze the candidate's professional
-- title. Constraint only: no stored snapshot is rewritten or backfilled.
ALTER TABLE process_participations DROP CONSTRAINT participation_profile_snapshot_shape;
ALTER TABLE process_participations ADD CONSTRAINT participation_profile_snapshot_shape CHECK (
    profile_snapshot IS NULL OR COALESCE(
        jsonb_typeof(profile_snapshot) = 'object'
        AND profile_snapshot ?& ARRAY['location','skills','years_of_experience','seniority','education','languages']
        AND profile_snapshot - ARRAY['location','skills','years_of_experience','seniority','education','languages','professional_title'] = '{}'::jsonb
        -- Optional: copies taken before 00061 have no key and read as null.
        AND (NOT profile_snapshot ? 'professional_title'
            OR profile_snapshot->'professional_title' = 'null'::jsonb
            OR (jsonb_typeof(profile_snapshot->'professional_title') = 'string'
                AND char_length(profile_snapshot->>'professional_title') <= 120))
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
-- Exclude concurrent writers BEFORE the guard so no title can be committed
-- between the check and the restored constraint.
LOCK TABLE process_participations IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM process_participations WHERE profile_snapshot ? 'professional_title') THEN
        RAISE EXCEPTION '00061 Down refuses participation profiles with a professional title';
    END IF;
END $$;
ALTER TABLE process_participations DROP CONSTRAINT participation_profile_snapshot_shape;
-- Restore the exact 00043 constraint.
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
