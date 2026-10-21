-- +goose Up
-- +goose StatementBegin
ALTER TABLE candidate_profiles
 ALTER COLUMN years_of_experience TYPE NUMERIC(3,1),
 ADD CONSTRAINT candidate_profiles_years_check CHECK (years_of_experience BETWEEN 0 AND 60),
 ADD COLUMN seniority TEXT CHECK (seniority IN ('intern','junior','semi_senior','senior','lead','manager','director'));
CREATE TABLE candidate_educations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 position SMALLINT NOT NULL CHECK (position >= 0),
 level TEXT NOT NULL CHECK (level IN ('secondary','high_school','technical','tsu','bachelor','specialty','master','phd')),
 institution TEXT CHECK (char_length(institution) BETWEEN 1 AND 120),
 field TEXT CHECK (char_length(field) BETWEEN 1 AND 120),
 status TEXT NOT NULL CHECK (status IN ('in_progress','paused','completed','incomplete')),
 start_year SMALLINT CHECK (start_year BETWEEN 1950 AND 2100),
 end_year SMALLINT CHECK (end_year BETWEEN 1950 AND 2100),
 CHECK (start_year <= end_year),
 CHECK (status <> 'in_progress' OR end_year IS NULL),
 UNIQUE(user_id,position)
);
-- Retain otherwise unrepresentable legacy field-only rows for exact clean rollback.
CREATE TABLE candidate_profile_0039_fields AS
 SELECT user_id, field_of_study FROM candidate_profiles WHERE education_level IS NULL AND field_of_study IS NOT NULL;
ALTER TABLE candidate_profile_0039_fields ADD PRIMARY KEY(user_id), ADD FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE;
INSERT INTO candidate_educations(user_id,position,level,field,status)
 SELECT user_id,0,education_level,field_of_study,'completed' FROM candidate_profiles WHERE education_level IS NOT NULL;
ALTER TABLE candidate_profiles DROP COLUMN education_level, DROP COLUMN field_of_study;

CREATE TEMP TABLE profile_language_names(code TEXT, name TEXT) ON COMMIT DROP;
-- Frozen VALUES transcription of internal/shared/languages/catalog.go All():
-- each Item{Code,Name} becomes (Code,Name), escaping SQL apostrophes.
-- TestProfileHarmonizationDefinition verifies every catalog tuple. English aliases
-- for the eleven major languages are appended separately below.
INSERT INTO profile_language_names VALUES
('aa','Afar'),('ab','Abjasio'),('af','Afrikáans'),('ak','Acano'),('am','Amárico'),('an','Aragonés'),('ar','Árabe'),('as','Asamés'),('av','Avar'),('ay','Aimara'),('az','Azerí'),('ba','Baskir'),('be','Bielorruso'),('bg','Búlgaro'),('bi','Bislama'),('bm','Bambara'),('bn','Bengalí'),('bo','Tibetano'),('br','Bretón'),('bs','Bosnio'),
('ca','Catalán'),('ce','Checheno'),('ch','Chamorro'),('co','Corso'),('cr','Cree'),('cs','Checo'),('cv','Chuvasio'),('cy','Galés'),('da','Danés'),('de','Alemán'),('dv','Divehi'),('dz','Dzongkha'),('ee','Ewé'),('el','Griego'),('en','Inglés'),('eo','Esperanto'),('es','Español'),('et','Estonio'),('eu','Euskera'),('fa','Persa'),('ff','Fula'),('fi','Finés'),('fj','Fiyiano'),('fo','Feroés'),('fr','Francés'),('fy','Frisón occidental'),('ga','Irlandés'),('gd','Gaélico escocés'),('gl','Gallego'),('gn','Guaraní'),('gu','Guyaratí'),('gv','Manés'),('ha','Hausa'),('he','Hebreo'),('hi','Hindi'),('hr','Croata'),('ht','Criollo haitiano'),('hu','Húngaro'),('hy','Armenio'),('hz','Herero'),('id','Indonesio'),('ig','Igbo'),('ii','Yi de Sichuan'),('ik','Inupiaq'),('is','Islandés'),('it','Italiano'),('iu','Inuktitut'),('ja','Japonés'),('jv','Javanés'),('ka','Georgiano'),('kg','Kongo'),('ki','Kikuyu'),('kj','Kuanyama'),('kk','Kazajo'),('kl','Groenlandés'),('km','Jemer'),('kn','Canarés'),('ko','Coreano'),('kr','Kanuri'),('ks','Cachemiro'),('ku','Kurdo'),('kv','Komi'),('kw','Córnico'),('ky','Kirguís'),('la','Latín'),('lb','Luxemburgués'),('lg','Luganda'),('li','Limburgués'),('ln','Lingala'),('lo','Lao'),('lt','Lituano'),('lv','Letón'),('mg','Malgache'),('mi','Maorí'),('mk','Macedonio'),('ml','Malayalam'),('mn','Mongol'),('mr','Maratí'),('ms','Malayo'),('mt','Maltés'),('my','Birmano'),('nb','Noruego bokmål'),('nd','Ndebele del norte'),('ne','Nepalí'),('nl','Neerlandés'),('nn','Noruego nynorsk'),('no','Noruego'),('nr','Ndebele del sur'),('nv','Navajo'),('ny','Chichewa'),('oc','Occitano'),('om','Oromo'),('or','Odia'),('os','Osetio'),('pa','Panyabí'),('pl','Polaco'),('ps','Pastún'),('pt','Portugués'),('qu','Quechua'),('rm','Romanche'),('rn','Kirundi'),('ro','Rumano'),('ru','Ruso'),('rw','Kinyarwanda'),('sa','Sánscrito'),('sc','Sardo'),('sd','Sindhi'),('se','Sami septentrional'),('sg','Sango'),('si','Cingalés'),('sk','Eslovaco'),('sl','Esloveno'),('sm','Samoano'),('sn','Shona'),('so','Somalí'),('sq','Albanés'),('sr','Serbio'),('ss','Suazi'),('st','Sesotho'),('su','Sundanés'),('sv','Sueco'),('sw','Suajili'),('ta','Tamil'),('te','Telugu'),('tg','Tayiko'),('th','Tailandés'),('ti','Tigriña'),('tk','Turcomano'),('tl','Tagalo'),('tn','Setsuana'),('to','Tongano'),('tr','Turco'),('ts','Tsonga'),('tt','Tártaro'),('ty','Tahitiano'),('ug','Uigur'),('uk','Ucraniano'),('ur','Urdu'),('uz','Uzbeko'),('ve','Venda'),('vi','Vietnamita'),('wo','Wólof'),('xh','Xhosa'),('yi','Yidis'),('yo','Yoruba'),('zh','Chino'),('zu','Zulú'),('nah','Náhuatl'),('yua','Maya yucateco'),('tzh','Tseltal'),('tzo','Tsotsil'),('qaa','Mixteco'),('zap','Zapoteco'),('qab','Otomí'),('qac','Totonaco'),('ctu','Ch''ol'),('qad','Mazateco'),('hus','Huasteco'),('qae','Mazahua'),('qaf','Tlapaneco'),('qag','Chinanteco'),('qah','Purépecha'),('qai','Mixe'),('qaj','Tarahumara'),('qak','Zoque'),('toj','Tojolabal'),('chf','Chontal de Tabasco'),('hch','Huichol'),('qal','Amuzgo'),('qam','Chatino'),('qan','Tepehuano'),('qao','Triqui'),('qap','Popoluca'),('qaq','Cora'),('yaq','Yaqui'),('mfy','Mayo'),('sei','Seri'),
('es','Spanish'),('en','English'),('fr','French'),('de','German'),('it','Italian'),('pt','Portuguese'),('zh','Chinese'),('ja','Japanese'),('ko','Korean'),('ru','Russian'),('ar','Arabic');
-- No extension dependency: normalize decomposed input, fold case and the accents
-- present in the catalog (including ñ and å), then compare exact names.
CREATE TABLE candidate_language_0039_backup AS
 SELECT l.*, n.code FROM candidate_languages l LEFT JOIN profile_language_names n
 ON translate(lower(normalize(l.language,NFC)), 'áéíóúüñå', 'aeiouuna') = translate(lower(n.name), 'áéíóúüñå', 'aeiouuna');
ALTER TABLE candidate_language_0039_backup ADD PRIMARY KEY(user_id,language), ADD FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX candidate_language_0039_code_idx ON candidate_language_0039_backup(user_id,code);
-- The legacy adapter also uses this rollback metadata to preserve name spelling
-- until H1b-2 switches the API to codes. It replaces metadata atomically on PUT.
DO $$ DECLARE unmatched BIGINT; collapsed BIGINT; BEGIN
 SELECT count(*) INTO unmatched FROM candidate_language_0039_backup WHERE code IS NULL;
 SELECT count(*) - count(DISTINCT (user_id,code)) INTO collapsed FROM candidate_language_0039_backup WHERE code IS NOT NULL;
 RAISE NOTICE 'profile harmonization: % unmatched language rows deleted', unmatched;
 RAISE NOTICE 'profile harmonization: % collapsed duplicate language rows', collapsed;
END $$;
-- Best effort for test data: aliases that collapse to one code keep the highest
-- CEFR level, the candidate's strongest statement. Count separately from misses.
DELETE FROM candidate_languages;
ALTER TABLE candidate_languages RENAME COLUMN language TO code;
ALTER TABLE candidate_languages DROP CONSTRAINT candidate_languages_level_check;
ALTER TABLE candidate_languages ADD CONSTRAINT candidate_languages_level_check CHECK (level IN ('A1','A2','B1','B2','C1','C2','native'));
INSERT INTO candidate_languages(user_id,code,level)
 SELECT user_id,code,max(level COLLATE "C") FROM candidate_language_0039_backup WHERE code IS NOT NULL GROUP BY user_id,code;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
LOCK TABLE candidate_profiles, candidate_educations, candidate_languages IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM candidate_educations e WHERE NOT EXISTS (SELECT 1 FROM candidate_profiles p WHERE p.user_id=e.user_id))
 OR EXISTS (SELECT 1 FROM candidate_educations GROUP BY user_id HAVING count(*) > 1)
 OR EXISTS (SELECT 1 FROM candidate_educations WHERE level NOT IN ('high_school','bachelor','master','phd') OR status <> 'completed' OR institution IS NOT NULL OR start_year IS NOT NULL OR end_year IS NOT NULL)
 OR EXISTS (SELECT 1 FROM candidate_profiles WHERE years_of_experience <> trunc(years_of_experience) OR seniority IS NOT NULL)
 OR EXISTS (SELECT 1 FROM candidate_languages WHERE level = 'native') THEN
  RAISE EXCEPTION 'profile harmonization cannot round-trip; remove non-legacy data before rollback';
 END IF;
END $$;
ALTER TABLE candidate_profiles
 ADD COLUMN education_level TEXT CONSTRAINT candidate_profiles_education_check CHECK (education_level IN ('high_school','bachelor','master','phd')),
 ADD COLUMN field_of_study TEXT;
UPDATE candidate_profiles p SET education_level=e.level, field_of_study=e.field FROM candidate_educations e WHERE e.user_id=p.user_id;
UPDATE candidate_profiles p SET field_of_study=b.field_of_study FROM candidate_profile_0039_fields b WHERE b.user_id=p.user_id AND p.education_level IS NULL;
DROP TABLE candidate_educations;
DROP TABLE candidate_profile_0039_fields;
ALTER TABLE candidate_profiles DROP CONSTRAINT candidate_profiles_years_check, ALTER COLUMN years_of_experience TYPE SMALLINT, DROP COLUMN seniority;
-- Restore original spelling, duplicate aliases and unmatched rows on clean Down.
-- For changed codes retain current proficiency; new codes remain valid free text.
CREATE TEMP TABLE profile_language_down ON COMMIT DROP AS
 SELECT l.user_id,coalesce(b.language,l.code) AS language,
 CASE WHEN l.level=(SELECT max(x.level COLLATE "C") FROM candidate_language_0039_backup x WHERE x.user_id=l.user_id AND x.code=l.code) THEN coalesce(b.level,l.level) ELSE l.level END AS level
 FROM candidate_languages l LEFT JOIN candidate_language_0039_backup b ON b.user_id=l.user_id AND b.code=l.code
 UNION ALL
 SELECT b.user_id,b.language,b.level FROM candidate_language_0039_backup b JOIN users u ON u.id=b.user_id WHERE b.code IS NULL;
DELETE FROM candidate_languages;
ALTER TABLE candidate_languages RENAME COLUMN code TO language;
ALTER TABLE candidate_languages DROP CONSTRAINT candidate_languages_level_check;
ALTER TABLE candidate_languages ADD CONSTRAINT candidate_languages_level_check CHECK (level IN ('A1','A2','B1','B2','C1','C2'));
INSERT INTO candidate_languages SELECT user_id,language,level FROM profile_language_down;
DROP TABLE candidate_language_0039_backup;
-- +goose StatementEnd
