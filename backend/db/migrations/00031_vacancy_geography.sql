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

-- PostgreSQL can normalize arbitrary object order/whitespace/string escapes,
-- but cannot decode escaped NUL. Mask only real NUL escapes (not literal
-- backslash-u text), then prove the candidate marker has no decoded collision.
-- Markers have no proper prefix/suffix overlap and no JSON/HTML escapes, so
-- every inserted marker contributes exactly one serialized occurrence. Retry
-- when additional occurrences came from original text, including Unicode escapes.
-- Restore NUL only AFTER canonical encoding; never parse that result again.
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
CREATE OR REPLACE FUNCTION pg_temp.geo_rewrite(document BYTEA, upgrade BOOLEAN) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
 source BYTEA := substring(document FROM 1);
 cursor_pos INTEGER;
 segment_start INTEGER;
 quoted BOOLEAN;
 marker TEXT;
 attempt INTEGER := 0;
 nul_count INTEGER;
 seen_count INTEGER;
 parts BYTEA[];
 masked BYTEA;
 parsed JSONB;
 draft_fields JSONB;
 serialized TEXT;
BEGIN
 LOOP
  marker := '~geo_nul_' || attempt::text || '!';
  parts := ARRAY[]::BYTEA[];
  cursor_pos := 0;
  segment_start := 0;
  quoted := FALSE;
  nul_count := 0;
  WHILE cursor_pos < octet_length(source) LOOP
   IF get_byte(source,cursor_pos)=34 THEN
    quoted := NOT quoted;
    cursor_pos := cursor_pos+1;
   ELSIF quoted AND get_byte(source,cursor_pos)=92 THEN
    IF substring(source FROM cursor_pos+1 FOR 6)=convert_to(chr(92)||'u0000','UTF8') THEN
     parts := array_append(parts,substring(source FROM segment_start+1 FOR cursor_pos-segment_start));
     parts := array_append(parts,convert_to(marker,'UTF8'));
     nul_count := nul_count+1;
     cursor_pos := cursor_pos+6;
     segment_start := cursor_pos;
    ELSE
     -- Skip an entire escape, including escaped backslashes and quotes.
     cursor_pos := cursor_pos+2;
    END IF;
   ELSE cursor_pos := cursor_pos+1;
   END IF;
  END LOOP;
  parts := array_append(parts,substring(source FROM segment_start+1));
  SELECT string_agg(part,''::bytea ORDER BY ord) INTO masked FROM unnest(parts) WITH ORDINALITY entry(part,ord);
  parsed := convert_from(masked,'UTF8')::jsonb;
  serialized := parsed::text;
  seen_count := (length(serialized)-length(replace(serialized,marker,'')))/length(marker);
  EXIT WHEN seen_count=nul_count;
  attempt := attempt+1;
  IF attempt>octet_length(source) THEN
   RAISE EXCEPTION '00031 cannot mask invalid stored draft JSON';
  END IF;
 END LOOP;
 -- Historical migration fixtures also contain partial envelopes and bare {}.
 -- Do not invent a fields object or a schema version for these rows.
 IF jsonb_typeof(parsed->'fields')='object' THEN
  draft_fields := parsed->'fields';
  IF draft_fields ? 'location' AND (NOT upgrade OR jsonb_typeof(draft_fields->'location')='string') THEN
   draft_fields := jsonb_set(draft_fields,'{location}','null'::jsonb);
  END IF;
  IF upgrade THEN
   draft_fields := jsonb_set(draft_fields,'{remote_scope}','null'::jsonb);
  ELSE draft_fields := draft_fields-'remote_scope';
  END IF;
  parsed := jsonb_set(parsed,'{fields}',draft_fields);
 END IF;
 RETURN convert_to(replace(pg_temp.geo_canonical(parsed),marker,chr(92)||'u0000'),'UTF8');
END $$;
UPDATE job_drafts
SET fields=pg_temp.geo_rewrite(fields,TRUE), version=version+1, updated_at=now();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE vacancy_public_projections
 DROP COLUMN country_code, DROP COLUMN state_code, DROP COLUMN municipality_code,
 DROP COLUMN postal_code, DROP COLUMN remote_scope_kind, DROP COLUMN remote_countries,
 ADD COLUMN location TEXT NOT NULL DEFAULT '';
-- Goose down may use a new process/connection: install both helpers independently.
-- The old free text is intentionally unrecoverable (S8).
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
CREATE OR REPLACE FUNCTION pg_temp.geo_rewrite(document BYTEA, upgrade BOOLEAN) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
 source BYTEA := substring(document FROM 1);
 cursor_pos INTEGER;
 segment_start INTEGER;
 quoted BOOLEAN;
 marker TEXT;
 attempt INTEGER := 0;
 nul_count INTEGER;
 seen_count INTEGER;
 parts BYTEA[];
 masked BYTEA;
 parsed JSONB;
 draft_fields JSONB;
 serialized TEXT;
BEGIN
 LOOP
  marker := '~geo_nul_' || attempt::text || '!';
  parts := ARRAY[]::BYTEA[];
  cursor_pos := 0;
  segment_start := 0;
  quoted := FALSE;
  nul_count := 0;
  WHILE cursor_pos < octet_length(source) LOOP
   IF get_byte(source,cursor_pos)=34 THEN
    quoted := NOT quoted;
    cursor_pos := cursor_pos+1;
   ELSIF quoted AND get_byte(source,cursor_pos)=92 THEN
    IF substring(source FROM cursor_pos+1 FOR 6)=convert_to(chr(92)||'u0000','UTF8') THEN
     parts := array_append(parts,substring(source FROM segment_start+1 FOR cursor_pos-segment_start));
     parts := array_append(parts,convert_to(marker,'UTF8'));
     nul_count := nul_count+1;
     cursor_pos := cursor_pos+6;
     segment_start := cursor_pos;
    ELSE
     -- Skip an entire escape, including escaped backslashes and quotes.
     cursor_pos := cursor_pos+2;
    END IF;
   ELSE cursor_pos := cursor_pos+1;
   END IF;
  END LOOP;
  parts := array_append(parts,substring(source FROM segment_start+1));
  SELECT string_agg(part,''::bytea ORDER BY ord) INTO masked FROM unnest(parts) WITH ORDINALITY entry(part,ord);
  parsed := convert_from(masked,'UTF8')::jsonb;
  serialized := parsed::text;
  seen_count := (length(serialized)-length(replace(serialized,marker,'')))/length(marker);
  EXIT WHEN seen_count=nul_count;
  attempt := attempt+1;
  IF attempt>octet_length(source) THEN
   RAISE EXCEPTION '00031 cannot mask invalid stored draft JSON';
  END IF;
 END LOOP;
 -- Historical migration fixtures also contain partial envelopes and bare {}.
 -- Do not invent a fields object or a schema version for these rows.
 IF jsonb_typeof(parsed->'fields')='object' THEN
  draft_fields := parsed->'fields';
  IF draft_fields ? 'location' AND (NOT upgrade OR jsonb_typeof(draft_fields->'location')='string') THEN
   draft_fields := jsonb_set(draft_fields,'{location}','null'::jsonb);
  END IF;
  IF upgrade THEN
   draft_fields := jsonb_set(draft_fields,'{remote_scope}','null'::jsonb);
  ELSE draft_fields := draft_fields-'remote_scope';
  END IF;
  parsed := jsonb_set(parsed,'{fields}',draft_fields);
 END IF;
 RETURN convert_to(replace(pg_temp.geo_canonical(parsed),marker,chr(92)||'u0000'),'UTF8');
END $$;
UPDATE job_drafts
SET fields=pg_temp.geo_rewrite(fields,FALSE), version=version+1, updated_at=now();
-- +goose StatementEnd
