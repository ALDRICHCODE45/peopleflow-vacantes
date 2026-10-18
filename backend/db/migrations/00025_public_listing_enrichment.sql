-- +goose Up
-- +goose StatementBegin
ALTER TABLE vacancy_public_projections
    ADD COLUMN skills TEXT[],
    ADD COLUMN screening_questions INTEGER;

-- Decode BYTEA as UTF-8 JSON, never a bytea display/escape representation.
-- No defaults/coalesce: an undecodable or ambiguous source aborts the entire
-- transaction, including the new columns. Nothing private is copied.
DO $$
DECLARE
    source RECORD;
    document JSON;
    fields JSONB;
    ordered_skills TEXT[];
    whitespace TEXT := U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000';
BEGIN
    FOR source IN
        SELECT p.id, d.fields FROM vacancy_public_projections p
        JOIN job_drafts d ON d.id = p.id
    LOOP
        BEGIN
            document := convert_from(source.fields, 'UTF8')::json;
            -- JSONB also rejects invalid Unicode escapes (including lone surrogates).
            fields := document::jsonb -> 'fields';
            -- Reject duplicate keys before JSONB can silently choose the last value.
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
            ) THEN
                RAISE EXCEPTION 'duplicate source keys';
            END IF;
            IF json_typeof(document) IS DISTINCT FROM 'object'
               OR json_typeof(document -> 'schema_version') IS DISTINCT FROM 'number'
               OR document ->> 'schema_version' IS DISTINCT FROM '2'
               OR (SELECT count(*) FROM json_object_keys(document)) <> 2
               OR jsonb_typeof(fields) IS DISTINCT FROM 'object'
               OR jsonb_typeof(fields -> 'skills') IS DISTINCT FROM 'array'
               OR jsonb_typeof(fields -> 'screening_questions') IS DISTINCT FROM 'array' THEN
                RAISE EXCEPTION 'invalid source envelope or collections';
            END IF;
            IF jsonb_array_length(fields -> 'skills') > 100
               OR jsonb_array_length(fields -> 'screening_questions') > 100
               OR EXISTS (SELECT 1 FROM jsonb_array_elements(fields -> 'skills') s(value)
                          WHERE jsonb_typeof(value) <> 'string' OR char_length(value #>> '{}') NOT BETWEEN 1 AND 200
                             OR value #>> '{}' <> btrim(value #>> '{}', whitespace))
               OR (SELECT count(*) <> count(DISTINCT value) FROM jsonb_array_elements(fields -> 'skills'))
               OR EXISTS (SELECT 1 FROM jsonb_array_elements(fields -> 'screening_questions') q(value)
                          WHERE jsonb_typeof(value) <> 'object'
                             OR jsonb_typeof(value -> 'id') IS DISTINCT FROM 'string'
                             OR jsonb_typeof(value -> 'prompt') IS DISTINCT FROM 'string'
                             OR COALESCE(value ->> 'type','') NOT IN ('open','single_choice_informative','single_choice_evaluated')) THEN
                RAISE EXCEPTION 'invalid source collection entries';
            END IF;
            SELECT ARRAY(SELECT value #>> '{}' FROM jsonb_array_elements(fields -> 'skills') WITH ORDINALITY s(value, position) ORDER BY position)
                INTO ordered_skills;
            UPDATE vacancy_public_projections
            SET skills = ordered_skills,
                screening_questions = jsonb_array_length(fields -> 'screening_questions')
            WHERE id = source.id;
        EXCEPTION WHEN OTHERS THEN
            -- Do not echo private JSON or underlying parser diagnostics.
            RAISE EXCEPTION '00025 cannot decode projection source for vacancy %', source.id;
        END;
    END LOOP;
END $$;

ALTER TABLE vacancy_public_projections
    ALTER COLUMN skills SET NOT NULL,
    ALTER COLUMN screening_questions SET NOT NULL,
    ADD CONSTRAINT vacancy_public_screening_count CHECK (screening_questions BETWEEN 0 AND 100);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE vacancy_public_projections
    DROP COLUMN skills,
    DROP COLUMN screening_questions;
-- +goose StatementEnd
