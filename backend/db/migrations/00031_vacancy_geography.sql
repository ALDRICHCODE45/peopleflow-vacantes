-- +goose Up
-- +goose StatementBegin
ALTER TABLE vacancy_public_projections
 ADD COLUMN country_code CHAR(2) REFERENCES geo_countries(code),
 ADD COLUMN state_code CHAR(2),
 ADD COLUMN municipality_code CHAR(5),
 ADD COLUMN postal_code CHAR(5),
 ADD COLUMN remote_scope_kind TEXT CHECK (remote_scope_kind IN ('anywhere','countries')),
 ADD COLUMN remote_countries CHAR(2)[],
 ADD CONSTRAINT vacancy_geo_state_fk FOREIGN KEY(country_code,state_code) REFERENCES geo_states(country_code,code),
 ADD CONSTRAINT vacancy_geo_municipality_fk FOREIGN KEY(country_code,municipality_code) REFERENCES geo_municipalities(country_code,code),
 ADD CONSTRAINT vacancy_geo_remote_mode CHECK (remote_scope_kind IS NULL OR work_mode='remote'),
 DROP COLUMN location;
CREATE INDEX vacancy_public_state_idx ON vacancy_public_projections(state_code);
CREATE INDEX vacancy_public_municipality_idx ON vacancy_public_projections(municipality_code);
CREATE INDEX vacancy_public_remote_countries_idx ON vacancy_public_projections USING GIN(remote_countries);

-- BYTEA documents are go-json-v1, NOT jsonb text (which inserts whitespace).
-- Recursive sorted compact encoding preserves arrays, integer values, and Go's
-- HTML/JS string escaping. The helper lives only in this database session.
CREATE OR REPLACE FUNCTION pg_temp.geo_canonical(value JSONB) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result TEXT;
BEGIN
 CASE jsonb_typeof(value)
 WHEN 'object' THEN
  SELECT '{' || COALESCE(string_agg(pg_temp.geo_canonical(to_jsonb(key)) || ':' || pg_temp.geo_canonical(val), ',' ORDER BY key COLLATE "C"),'') || '}' INTO result FROM jsonb_each(value) entry(key,val);
 WHEN 'array' THEN
  SELECT '[' || COALESCE(string_agg(pg_temp.geo_canonical(val), ',' ORDER BY ord),'') || ']' INTO result FROM jsonb_array_elements(value) WITH ORDINALITY entry(val,ord);
 WHEN 'string' THEN
  result := replace(replace(replace(replace(replace(value::text,'&','\u0026'),'<','\u003c'),'>','\u003e'),chr(8232),'\u2028'),chr(8233),'\u2029');
 ELSE result := value::text;
 END CASE;
 RETURN result;
END $$;
UPDATE job_drafts
SET fields=convert_to(pg_temp.geo_canonical(
 jsonb_set(
  CASE WHEN jsonb_typeof(convert_from(fields,'UTF8')::jsonb #> '{fields,location}')='string'
   THEN jsonb_set(convert_from(fields,'UTF8')::jsonb,'{fields,location}','null'::jsonb)
   ELSE convert_from(fields,'UTF8')::jsonb END,
  '{fields,remote_scope}','null'::jsonb)), 'UTF8'),
 version=version+1, updated_at=now();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE vacancy_public_projections
 DROP COLUMN country_code, DROP COLUMN state_code, DROP COLUMN municipality_code,
 DROP COLUMN postal_code, DROP COLUMN remote_scope_kind, DROP COLUMN remote_countries,
 ADD COLUMN location TEXT NOT NULL DEFAULT '';
-- The old free text is intentionally unrecoverable (S8). Use an empty nullable
-- location and remove the new field. jsonb text is accepted by the old codec.
UPDATE job_drafts
SET fields=convert_to(jsonb_set(convert_from(fields,'UTF8')::jsonb #- '{fields,remote_scope}', '{fields,location}', 'null'::jsonb)::text,'UTF8'),
 version=version+1, updated_at=now();
-- +goose StatementEnd
