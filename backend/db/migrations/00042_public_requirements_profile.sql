-- +goose Up
-- +goose StatementBegin
-- A projection-only shape guard; catalog membership is validated at draft ingress.
CREATE FUNCTION public_requirements_profile_valid(profile JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    language JSONB;
BEGIN
    IF jsonb_typeof(profile) IS DISTINCT FROM 'object'
       OR NOT profile ?& ARRAY['languages','min_years_of_experience','min_education_level','accepts_in_progress_education']
       OR (SELECT count(*) FROM jsonb_object_keys(profile)) <> 4
       OR jsonb_typeof(profile->'languages') IS DISTINCT FROM 'array'
       OR jsonb_typeof(profile->'accepts_in_progress_education') IS DISTINCT FROM 'boolean' THEN
        RETURN false;
    END IF;
    IF jsonb_array_length(profile->'languages') > 20 THEN RETURN false; END IF;
    FOR language IN SELECT value FROM jsonb_array_elements(profile->'languages') LOOP
        IF jsonb_typeof(language) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
        IF (SELECT count(*) FROM jsonb_object_keys(language)) <> 2
           OR jsonb_typeof(language->'code') IS DISTINCT FROM 'string'
           OR COALESCE(language->>'code','') !~ '^[a-z]{2,3}$'
           OR jsonb_typeof(language->'min_level') IS DISTINCT FROM 'string'
           OR COALESCE(language->>'min_level','') NOT IN ('A1','A2','B1','B2','C1','C2','native') THEN RETURN false; END IF;
    END LOOP;
    IF (SELECT count(*) <> count(DISTINCT value->>'code') FROM jsonb_array_elements(profile->'languages')) THEN RETURN false; END IF;
    IF profile->'min_years_of_experience' <> 'null'::jsonb AND
       (jsonb_typeof(profile->'min_years_of_experience') <> 'string'
        OR profile->>'min_years_of_experience' !~ '^(60|([0-9]|[1-5][0-9])(\.[1-9])?)$') THEN RETURN false; END IF;
    IF profile->'min_education_level' <> 'null'::jsonb AND
       (jsonb_typeof(profile->'min_education_level') <> 'string'
        OR profile->>'min_education_level' NOT IN ('secondary','high_school','technical','tsu','bachelor','specialty','master','phd')) THEN RETURN false; END IF;
    RETURN true;
END $$;

ALTER TABLE vacancy_public_projections ADD COLUMN requirements_profile JSONB;
-- PostgreSQL JSON operators cannot decode escaped NUL (\u0000), which canonical
-- drafts may contain inside strings. Mask only real NUL escapes inside strings
-- (the 00031 byte scanner: escaped backslashes and quotes are skipped), then
-- parse. The backfill only reads the four requirement keys and never writes
-- the masked document back, so the marker needs no collision proof.
CREATE OR REPLACE FUNCTION pg_temp.requirements_nul_masked(source BYTEA) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
 cursor_pos INTEGER := 0;
 segment_start INTEGER := 0;
 quoted BOOLEAN := FALSE;
 parts BYTEA[] := ARRAY[]::BYTEA[];
 masked BYTEA;
BEGIN
 WHILE cursor_pos < octet_length(source) LOOP
  IF get_byte(source,cursor_pos)=34 THEN
   quoted := NOT quoted;
   cursor_pos := cursor_pos+1;
  ELSIF quoted AND get_byte(source,cursor_pos)=92 THEN
   IF substring(source FROM cursor_pos+1 FOR 6)=convert_to(chr(92)||'u0000','UTF8') THEN
    parts := array_append(parts,substring(source FROM segment_start+1 FOR cursor_pos-segment_start));
    parts := array_append(parts,convert_to('~requirements_nul!','UTF8'));
    cursor_pos := cursor_pos+6;
    segment_start := cursor_pos;
   ELSE
    cursor_pos := cursor_pos+2;
   END IF;
  ELSE cursor_pos := cursor_pos+1;
  END IF;
 END LOOP;
 parts := array_append(parts,substring(source FROM segment_start+1));
 SELECT string_agg(part,''::bytea ORDER BY ord) INTO masked FROM unnest(parts) WITH ORDINALITY entry(part,ord);
 RETURN convert_from(masked,'UTF8');
END $$;
DO $$
DECLARE
    source RECORD;
    document JSON;
    fields JSON;
    profile JSONB;
    old_languages BOOLEAN;
BEGIN
    FOR source IN SELECT p.id,d.fields FROM vacancy_public_projections p JOIN job_drafts d ON d.id=p.id LOOP
        BEGIN
            document := pg_temp.requirements_nul_masked(source.fields)::json;
            fields := document->'fields';
            -- Keep unrelated text as JSON: canonical drafts may contain escaped NUL.
            IF json_typeof(document) IS DISTINCT FROM 'object' THEN
                RAISE EXCEPTION 'invalid source envelope';
            END IF;
            -- Reject ambiguous input before casting the selected values to JSONB.
            IF EXISTS (
                WITH RECURSIVE nodes(value) AS (
                    SELECT document
                    UNION ALL
                    SELECT child.value FROM nodes n CROSS JOIN LATERAL (
                        SELECT value FROM json_each(CASE WHEN json_typeof(n.value)='object' THEN n.value ELSE '{}'::json END)
                        UNION ALL
                        SELECT value FROM json_array_elements(CASE WHEN json_typeof(n.value)='array' THEN n.value ELSE '[]'::json END)
                    ) child
                )
                SELECT 1 FROM nodes n WHERE json_typeof(n.value)='object'
                AND (SELECT count(*) <> count(DISTINCT key) FROM json_each(CASE WHEN json_typeof(n.value)='object' THEN n.value ELSE '{}'::json END))
            ) THEN RAISE EXCEPTION 'duplicate source keys'; END IF;
            -- 00031/00041 intentionally preserve bare objects, schema markers
            -- (including schema 1), and partial historical fields. Unlike the
            -- current API validator, a backfill cannot require a full v2 draft.
            -- Missing requirements or the old language shape mean no reliable
            -- profile: use the entire empty profile, never infer partial minima.
            profile := '{"languages":[],"min_years_of_experience":null,"min_education_level":null,"accepts_in_progress_education":false}'::jsonb;
            IF json_typeof(fields)='object'
               AND fields->'languages' IS NOT NULL AND fields->'min_years_of_experience' IS NOT NULL
               AND fields->'min_education_level' IS NOT NULL AND fields->'accepts_in_progress_education' IS NOT NULL THEN
                SELECT EXISTS (
                    SELECT 1 FROM json_array_elements(CASE WHEN json_typeof(fields->'languages')='array'
                        THEN fields->'languages' ELSE '[]'::json END) entry(value)
                    WHERE value->'language' IS NOT NULL OR value->'custom_name' IS NOT NULL OR value->'level' IS NOT NULL
                ) INTO old_languages;
                IF NOT old_languages THEN
                    profile := jsonb_build_object(
                        'languages',(fields->'languages')::jsonb,
                        'min_years_of_experience',(fields->'min_years_of_experience')::jsonb,
                        'min_education_level',(fields->'min_education_level')::jsonb,
                        'accepts_in_progress_education',(fields->'accepts_in_progress_education')::jsonb
                    );
                    IF NOT public_requirements_profile_valid(profile) THEN
                        RAISE EXCEPTION 'invalid source requirements';
                    END IF;
                END IF;
            END IF;
            UPDATE vacancy_public_projections SET requirements_profile=profile WHERE id=source.id;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION '00042 cannot decode projection source for vacancy %: %',source.id,SQLERRM;
        END;
    END LOOP;
END $$;
ALTER TABLE vacancy_public_projections
    ALTER COLUMN requirements_profile SET NOT NULL,
    ADD CONSTRAINT vacancy_public_requirements_profile CHECK (public_requirements_profile_valid(requirements_profile));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Only derived data is removed; canonical draft requirements remain untouched.
ALTER TABLE vacancy_public_projections DROP COLUMN requirements_profile;
DROP FUNCTION public_requirements_profile_valid(JSONB);
-- +goose StatementEnd
