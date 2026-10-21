-- +goose Up
-- +goose StatementBegin
LOCK TABLE job_drafts, vacancy_public_projections IN ACCESS EXCLUSIVE MODE;
-- Frozen catalog names; no runtime catalog or extension dependency. The definition
-- test pins all Spanish catalog tuples. English aliases are frozen below too.
CREATE TEMP TABLE vacancy_language_names(code TEXT, name TEXT) ON COMMIT DROP;
INSERT INTO vacancy_language_names VALUES
('aa','Afar'),('ab','Abjasio'),('af','Afrikáans'),('ak','Acano'),('am','Amárico'),('an','Aragonés'),('ar','Árabe'),('as','Asamés'),('av','Avar'),('ay','Aimara'),('az','Azerí'),('ba','Baskir'),('be','Bielorruso'),('bg','Búlgaro'),('bi','Bislama'),('bm','Bambara'),('bn','Bengalí'),('bo','Tibetano'),('br','Bretón'),('bs','Bosnio'),
('ca','Catalán'),('ce','Checheno'),('ch','Chamorro'),('co','Corso'),('cr','Cree'),('cs','Checo'),('cv','Chuvasio'),('cy','Galés'),('da','Danés'),('de','Alemán'),('dv','Divehi'),('dz','Dzongkha'),('ee','Ewé'),('el','Griego'),('en','Inglés'),('eo','Esperanto'),('es','Español'),('et','Estonio'),('eu','Euskera'),('fa','Persa'),('ff','Fula'),('fi','Finés'),('fj','Fiyiano'),('fo','Feroés'),('fr','Francés'),('fy','Frisón occidental'),('ga','Irlandés'),('gd','Gaélico escocés'),('gl','Gallego'),('gn','Guaraní'),('gu','Guyaratí'),('gv','Manés'),('ha','Hausa'),('he','Hebreo'),('hi','Hindi'),('hr','Croata'),('ht','Criollo haitiano'),('hu','Húngaro'),('hy','Armenio'),('hz','Herero'),('id','Indonesio'),('ig','Igbo'),('ii','Yi de Sichuan'),('ik','Inupiaq'),('is','Islandés'),('it','Italiano'),('iu','Inuktitut'),('ja','Japonés'),('jv','Javanés'),('ka','Georgiano'),('kg','Kongo'),('ki','Kikuyu'),('kj','Kuanyama'),('kk','Kazajo'),('kl','Groenlandés'),('km','Jemer'),('kn','Canarés'),('ko','Coreano'),('kr','Kanuri'),('ks','Cachemiro'),('ku','Kurdo'),('kv','Komi'),('kw','Córnico'),('ky','Kirguís'),('la','Latín'),('lb','Luxemburgués'),('lg','Luganda'),('li','Limburgués'),('ln','Lingala'),('lo','Lao'),('lt','Lituano'),('lv','Letón'),('mg','Malgache'),('mi','Maorí'),('mk','Macedonio'),('ml','Malayalam'),('mn','Mongol'),('mr','Maratí'),('ms','Malayo'),('mt','Maltés'),('my','Birmano'),('nb','Noruego bokmål'),('nd','Ndebele del norte'),('ne','Nepalí'),('nl','Neerlandés'),('nn','Noruego nynorsk'),('no','Noruego'),('nr','Ndebele del sur'),('nv','Navajo'),('ny','Chichewa'),('oc','Occitano'),('om','Oromo'),('or','Odia'),('os','Osetio'),('pa','Panyabí'),('pl','Polaco'),('ps','Pastún'),('pt','Portugués'),('qu','Quechua'),('rm','Romanche'),('rn','Kirundi'),('ro','Rumano'),('ru','Ruso'),('rw','Kinyarwanda'),('sa','Sánscrito'),('sc','Sardo'),('sd','Sindhi'),('se','Sami septentrional'),('sg','Sango'),('si','Cingalés'),('sk','Eslovaco'),('sl','Esloveno'),('sm','Samoano'),('sn','Shona'),('so','Somalí'),('sq','Albanés'),('sr','Serbio'),('ss','Suazi'),('st','Sesotho'),('su','Sundanés'),('sv','Sueco'),('sw','Suajili'),('ta','Tamil'),('te','Telugu'),('tg','Tayiko'),('th','Tailandés'),('ti','Tigriña'),('tk','Turcomano'),('tl','Tagalo'),('tn','Setsuana'),('to','Tongano'),('tr','Turco'),('ts','Tsonga'),('tt','Tártaro'),('ty','Tahitiano'),('ug','Uigur'),('uk','Ucraniano'),('ur','Urdu'),('uz','Uzbeko'),('ve','Venda'),('vi','Vietnamita'),('wo','Wólof'),('xh','Xhosa'),('yi','Yidis'),('yo','Yoruba'),('zh','Chino'),('zu','Zulú'),('nah','Náhuatl'),('yua','Maya yucateco'),('tzh','Tseltal'),('tzo','Tsotsil'),('qaa','Mixteco'),('zap','Zapoteco'),('qab','Otomí'),('qac','Totonaco'),('ctu','Ch''ol'),('qad','Mazateco'),('hus','Huasteco'),('qae','Mazahua'),('qaf','Tlapaneco'),('qag','Chinanteco'),('qah','Purépecha'),('qai','Mixe'),('qaj','Tarahumara'),('qak','Zoque'),('toj','Tojolabal'),('chf','Chontal de Tabasco'),('hch','Huichol'),('qal','Amuzgo'),('qam','Chatino'),('qan','Tepehuano'),('qao','Triqui'),('qap','Popoluca'),('qaq','Cora'),('yaq','Yaqui'),('mfy','Mayo'),('sei','Seri');
-- Freeze Spanish display names for reverse-mapping new/edited drafts on Down.
CREATE TABLE vacancy_language_0041_catalog AS SELECT code,name FROM vacancy_language_names;
ALTER TABLE vacancy_language_0041_catalog ADD PRIMARY KEY(code);
INSERT INTO vacancy_language_names VALUES
('ab','Abkhazian'),('af','Afrikaans'),('ak','Akan'),('am','Amharic'),('an','Aragonese'),('ar','Arabic'),('as','Assamese'),('ay','Aymara'),('az','Azerbaijani'),('ba','Bashkir'),('be','Belarusian'),('bg','Bulgarian'),('bn','Bengali'),('bo','Tibetan'),('br','Breton'),('bs','Bosnian'),('ca','Catalan'),('ce','Chechen'),('co','Corsican'),('cs','Czech'),('cv','Chuvash'),('cy','Welsh'),('da','Danish'),('de','German'),('ee','Ewe'),('el','Greek'),('en','English'),('es','Spanish'),('et','Estonian'),('eu','Basque'),('fa','Persian'),('fi','Finnish'),('fj','Fijian'),('fo','Faroese'),('fr','French'),('fy','Western Frisian'),('ga','Irish'),('gd','Scottish Gaelic'),('gl','Galician'),('gn','Guarani'),('gu','Gujarati'),('gv','Manx'),('he','Hebrew'),('hr','Croatian'),('ht','Haitian Creole'),('hu','Hungarian'),('hy','Armenian'),('id','Indonesian'),('ii','Sichuan Yi'),('is','Icelandic'),('it','Italian'),('ja','Japanese'),('jv','Javanese'),('ka','Georgian'),('kk','Kazakh'),('kl','Greenlandic'),('km','Khmer'),('kn','Kannada'),('ko','Korean'),('ks','Kashmiri'),('ku','Kurdish'),('kw','Cornish'),('ky','Kyrgyz'),('la','Latin'),('lb','Luxembourgish'),('li','Limburgish'),('lt','Lithuanian'),('lv','Latvian'),('mg','Malagasy'),('mi','Maori'),('mk','Macedonian'),('mn','Mongolian'),('mr','Marathi'),('ms','Malay'),('mt','Maltese'),('my','Burmese'),('nb','Norwegian Bokmål'),('nd','North Ndebele'),('nl','Dutch'),('nn','Norwegian Nynorsk'),('no','Norwegian'),('nr','South Ndebele'),('oc','Occitan'),('os','Ossetian'),('pa','Punjabi'),('pl','Polish'),('ps','Pashto'),('pt','Portuguese'),('qu','Quechua'),('rm','Romansh'),('rn','Rundi'),('ro','Romanian'),('ru','Russian'),('sa','Sanskrit'),('sc','Sardinian'),('se','Northern Sami'),('si','Sinhala'),('sk','Slovak'),('sl','Slovenian'),('sm','Samoan'),('so','Somali'),('sq','Albanian'),('sr','Serbian'),('ss','Swati'),('su','Sundanese'),('sv','Swedish'),('sw','Swahili'),('tg','Tajik'),('th','Thai'),('ti','Tigrinya'),('tk','Turkmen'),('tl','Tagalog'),('tn','Tswana'),('to','Tongan'),('tr','Turkish'),('tt','Tatar'),('ty','Tahitian'),('ug','Uighur'),('uk','Ukrainian'),('uz','Uzbek'),('vi','Vietnamese'),('wo','Wolof'),('yi','Yiddish'),('zh','Chinese'),('zu','Zulu'),('nah','Nahuatl'),('yua','Yucatec Maya'),('qaa','Mixtec'),('zap','Zapotec'),('qab','Otomi'),('qac','Totonac'),('hus','Huastec'),('qaf','Tlapanec'),('qag','Chinantec'),('qah','Purepecha'),('chf','Chontal Maya'),('av','Avaric'),('qad','Mazatec'),('qan','Tepehuan'),('qao','Trique');

-- Exactly the 00031 canonical encoder and collision-safe escaped-NUL scanner.
CREATE OR REPLACE FUNCTION pg_temp.vacancy_canonical(value JSONB) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result TEXT;
BEGIN
 CASE jsonb_typeof(value)
 WHEN 'object' THEN
  SELECT '{' || COALESCE(string_agg(pg_temp.vacancy_canonical(to_jsonb(key)) || ':' || pg_temp.vacancy_canonical(val), ',' ORDER BY key COLLATE "C"),'') || '}' INTO result FROM jsonb_each(value) entry(key,val);
 WHEN 'array' THEN
  SELECT '[' || COALESCE(string_agg(pg_temp.vacancy_canonical(val), ',' ORDER BY ord),'') || ']' INTO result FROM jsonb_array_elements(value) WITH ORDINALITY entry(val,ord);
 WHEN 'string' THEN
  result := replace(replace(replace(replace(replace(value::text,'&','\u0026'),'<','\u003c'),'>','\u003e'),chr(8232),'\u2028'),chr(8233),'\u2029');
 ELSE result := value::text;
 END CASE;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.vacancy_rewrite(document BYTEA, upgrade BOOLEAN) RETURNS BYTEA
LANGUAGE plpgsql STRICT AS $$
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
 item JSONB;
 code TEXT;
 rank INTEGER;
 mapped JSONB := '[]'::jsonb;
 result JSONB;
 distinct_count INTEGER;
 dropped INTEGER := 0;
 collapsed INTEGER;
 overflow INTEGER;
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
   RAISE EXCEPTION '00041 cannot mask invalid stored draft JSON';
  END IF;
 END LOOP;
 -- As in 00031, preserve historical partial envelopes, bare {}, and schema
 -- markers; do not invent unrelated fields or turn schema 1 into schema 2.
 IF upgrade AND jsonb_typeof(parsed->'fields')='object' THEN
  draft_fields := parsed->'fields';
  IF draft_fields->>'seniority'='mid' THEN
   draft_fields := jsonb_set(draft_fields,'{seniority}','"semi_senior"'::jsonb);
  END IF;
  IF draft_fields ? 'languages' THEN
   FOR item IN SELECT value FROM jsonb_array_elements(draft_fields->'languages') LOOP
    rank := CASE item->>'level' WHEN 'basic' THEN 2 WHEN 'intermediate' THEN 3 WHEN 'advanced' THEN 5 WHEN 'native' THEN 7 END;
    code := NULL;
    IF item->>'language' IN ('es','en') THEN code := item->>'language';
    ELSIF item->>'language'='other' THEN
     SELECT n.code INTO code FROM vacancy_language_names n
     WHERE translate(lower(normalize(item->>'custom_name',NFC)), 'áéíóúüñå', 'aeiouuna') = translate(lower(n.name), 'áéíóúüñå', 'aeiouuna')
     ORDER BY n.code COLLATE "C" LIMIT 1;
    END IF;
    IF rank IS NULL OR code IS NULL THEN dropped := dropped+1;
    ELSE mapped := mapped || jsonb_build_array(jsonb_build_object('code',code,'rank',rank));
    END IF;
   END LOOP;
   SELECT count(DISTINCT value->>'code') INTO distinct_count FROM jsonb_array_elements(mapped);
   collapsed := jsonb_array_length(mapped)-distinct_count;
   overflow := greatest(distinct_count-20,0);
   -- First occurrence determines ordering; all occurrences (even those after
   -- the twentieth code) participate in the maximum level for retained codes.
   SELECT coalesce(jsonb_agg(jsonb_build_object('code',c,'min_level',
     CASE r WHEN 2 THEN 'A2' WHEN 3 THEN 'B1' WHEN 5 THEN 'C1' WHEN 7 THEN 'native' END) ORDER BY first_ord),'[]'::jsonb)
   INTO result FROM (
    SELECT value->>'code' c, max((value->>'rank')::integer) r, min(ord) first_ord
    FROM jsonb_array_elements(mapped) WITH ORDINALITY entry(value,ord)
    GROUP BY value->>'code' ORDER BY min(ord) LIMIT 20
   ) kept;
   draft_fields := jsonb_set(draft_fields,'{languages}',result);
   RAISE NOTICE 'vacancy harmonization: % unmatched/null-level entries dropped, % duplicates collapsed, % distinct overflow codes dropped', dropped, collapsed, overflow;
  END IF;
  draft_fields := draft_fields || jsonb_build_object('min_years_of_experience',NULL,'min_education_level',NULL,'accepts_in_progress_education',FALSE);
  parsed := jsonb_set(parsed,'{fields}',draft_fields);
 END IF;
 RETURN convert_to(replace(pg_temp.vacancy_canonical(parsed),marker,chr(92)||'u0000'),'UTF8');
END $$;

-- Lossy best-effort mapping needs rollback metadata, as in 00039. Both copies
-- use 00031 canonical bytes. Unchanged rows restore the exact original; new or
-- edited rows use the guarded reverse mapping installed independently on Down.
CREATE TABLE vacancy_draft_0041_backup (
 id UUID PRIMARY KEY REFERENCES job_drafts(id) ON DELETE CASCADE,
 original_fields BYTEA NOT NULL,
 migrated_fields BYTEA NOT NULL
);
INSERT INTO vacancy_draft_0041_backup
 SELECT id,pg_temp.vacancy_rewrite(fields,FALSE),pg_temp.vacancy_rewrite(fields,TRUE) FROM job_drafts;
UPDATE job_drafts d
SET fields=b.migrated_fields, version=version+1, updated_at=now()
FROM vacancy_draft_0041_backup b WHERE d.id=b.id;
-- Like 00031, every stored draft advances once, invalidating prior r1/r2 ETags.
-- Frozen idempotency/replay snapshots and their original ETags are NOT rewritten.
ALTER TABLE vacancy_public_projections DROP CONSTRAINT vacancy_public_projections_seniority_check;
UPDATE vacancy_public_projections SET seniority='semi_senior' WHERE seniority='mid';
ALTER TABLE vacancy_public_projections ADD CONSTRAINT vacancy_public_projections_seniority_check
 CHECK (seniority IN ('intern','junior','semi_senior','senior','lead','manager','director'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
LOCK TABLE job_drafts, vacancy_public_projections IN ACCESS EXCLUSIVE MODE;
-- Goose Down may run on a different connection. Install the identical 00031
-- encoder and scanner here too; never parse a document after restoring NUL.
CREATE OR REPLACE FUNCTION pg_temp.vacancy_canonical(value JSONB) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result TEXT;
BEGIN
 CASE jsonb_typeof(value)
 WHEN 'object' THEN
  SELECT '{' || COALESCE(string_agg(pg_temp.vacancy_canonical(to_jsonb(key)) || ':' || pg_temp.vacancy_canonical(val), ',' ORDER BY key COLLATE "C"),'') || '}' INTO result FROM jsonb_each(value) entry(key,val);
 WHEN 'array' THEN
  SELECT '[' || COALESCE(string_agg(pg_temp.vacancy_canonical(val), ',' ORDER BY ord),'') || ']' INTO result FROM jsonb_array_elements(value) WITH ORDINALITY entry(val,ord);
 WHEN 'string' THEN
  result := replace(replace(replace(replace(replace(value::text,'&','\u0026'),'<','\u003c'),'>','\u003e'),chr(8232),'\u2028'),chr(8233),'\u2029');
 ELSE result := value::text;
 END CASE;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.vacancy_reverse(document BYTEA) RETURNS BYTEA
LANGUAGE plpgsql STRICT AS $$
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
 item JSONB;
 language_code TEXT;
 language_name TEXT;
 old_level TEXT;
 old_languages JSONB := '[]'::jsonb;
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
   RAISE EXCEPTION '00041 cannot mask invalid stored draft JSON';
  END IF;
 END LOOP;
 IF jsonb_typeof(parsed->'fields')='object' THEN
  draft_fields := parsed->'fields';
  IF coalesce(draft_fields->'min_years_of_experience','null'::jsonb)<>'null'::jsonb
     OR coalesce(draft_fields->'min_education_level','null'::jsonb)<>'null'::jsonb
     OR coalesce(draft_fields->'accepts_in_progress_education','false'::jsonb)<>'false'::jsonb THEN
   RAISE EXCEPTION '00041 rollback refused: non-default profile requirements';
  END IF;
  IF draft_fields->>'seniority'='semi_senior' THEN
   draft_fields := jsonb_set(draft_fields,'{seniority}','"mid"'::jsonb);
  ELSIF draft_fields->>'seniority' NOT IN ('intern','junior','mid','senior','lead') THEN
   RAISE EXCEPTION '00041 rollback refused: draft seniority cannot round-trip';
  END IF;
  IF draft_fields ? 'languages' THEN
   FOR item IN SELECT value FROM jsonb_array_elements(draft_fields->'languages') LOOP
    language_code := item->>'code';
    old_level := CASE item->>'min_level' WHEN 'A2' THEN 'basic' WHEN 'B1' THEN 'intermediate' WHEN 'C1' THEN 'advanced' WHEN 'native' THEN 'native' END;
    language_name := NULL;
    IF language_code IN ('es','en') THEN
     IF old_level IS NULL THEN
      RAISE EXCEPTION '00041 rollback refused: es/en level cannot round-trip';
     END IF;
    ELSE
     SELECT name INTO language_name FROM vacancy_language_0041_catalog WHERE code=language_code;
     IF language_name IS NULL THEN
      RAISE EXCEPTION '00041 rollback refused: unknown language code';
     END IF;
     language_code := 'other';
    END IF;
    old_languages := old_languages || jsonb_build_array(jsonb_build_object('language',language_code,'custom_name',language_name,'level',old_level));
   END LOOP;
   draft_fields := jsonb_set(draft_fields,'{languages}',old_languages);
  END IF;
  draft_fields := draft_fields-'min_years_of_experience'-'min_education_level'-'accepts_in_progress_education';
  parsed := jsonb_set(parsed,'{fields}',draft_fields);
 END IF;
 RETURN convert_to(replace(pg_temp.vacancy_canonical(parsed),marker,chr(92)||'u0000'),'UTF8');
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM vacancy_public_projections WHERE seniority IN ('manager','director')) THEN
  RAISE EXCEPTION '00041 rollback refused: projection seniority cannot round-trip';
 END IF;
END $$;
-- Unchanged rows retain their exact pre-Up data (including dropped entries).
-- New and edited rows preserve unrelated edits and reverse-map requirements.
WITH restored AS (
 SELECT d.id, CASE WHEN d.fields=b.migrated_fields THEN b.original_fields
                  ELSE pg_temp.vacancy_reverse(d.fields) END AS fields
 FROM job_drafts d LEFT JOIN vacancy_draft_0041_backup b USING(id)
)
UPDATE job_drafts d
SET fields=r.fields, version=version+1, updated_at=now()
FROM restored r WHERE d.id=r.id;
ALTER TABLE vacancy_public_projections DROP CONSTRAINT vacancy_public_projections_seniority_check;
UPDATE vacancy_public_projections SET seniority='mid' WHERE seniority='semi_senior';
ALTER TABLE vacancy_public_projections ADD CONSTRAINT vacancy_public_projections_seniority_check
 CHECK (seniority IN ('intern','junior','mid','senior','lead'));
DROP TABLE vacancy_draft_0041_backup;
DROP TABLE vacancy_language_0041_catalog;
-- +goose StatementEnd
