-- +goose Up
-- +goose StatementBegin
ALTER TABLE company_candidates RENAME COLUMN experience_years TO years_of_experience;
ALTER TABLE company_candidates
 ALTER COLUMN years_of_experience TYPE NUMERIC(3,1),
 ADD COLUMN seniority TEXT CHECK (seniority IN ('intern','junior','semi_senior','senior','lead','manager','director'));
CREATE TABLE company_candidate_educations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 company_candidate_id UUID NOT NULL REFERENCES company_candidates(id) ON DELETE CASCADE,
 position SMALLINT NOT NULL CHECK (position >= 0),
 level TEXT NOT NULL CHECK (level IN ('secondary','high_school','technical','tsu','bachelor','specialty','master','phd')),
 institution TEXT CHECK (char_length(institution) BETWEEN 1 AND 120),
 field TEXT CHECK (char_length(field) BETWEEN 1 AND 120),
 status TEXT NOT NULL CHECK (status IN ('in_progress','paused','completed','incomplete')),
 start_year SMALLINT CHECK (start_year BETWEEN 1950 AND 2100),
 end_year SMALLINT CHECK (end_year BETWEEN 1950 AND 2100),
 CHECK (start_year <= end_year),
 CHECK (status <> 'in_progress' OR end_year IS NULL),
 UNIQUE(company_candidate_id,position)
);
INSERT INTO company_candidate_educations(company_candidate_id,position,level,field,status)
 SELECT id,0,education_level,field_of_study,'completed' FROM company_candidates;
ALTER TABLE company_candidates DROP COLUMN education_level, DROP COLUMN field_of_study;

-- Frozen catalog and aliases use exactly the name matching policy of 00039.
CREATE TEMP TABLE manual_language_names(code TEXT, name TEXT) ON COMMIT DROP;
INSERT INTO manual_language_names VALUES
('aa','Afar'),('ab','Abjasio'),('af','Afrikáans'),('ak','Acano'),('am','Amárico'),('an','Aragonés'),('ar','Árabe'),('as','Asamés'),('av','Avar'),('ay','Aimara'),('az','Azerí'),('ba','Baskir'),('be','Bielorruso'),('bg','Búlgaro'),('bi','Bislama'),('bm','Bambara'),('bn','Bengalí'),('bo','Tibetano'),('br','Bretón'),('bs','Bosnio'),
('ca','Catalán'),('ce','Checheno'),('ch','Chamorro'),('co','Corso'),('cr','Cree'),('cs','Checo'),('cv','Chuvasio'),('cy','Galés'),('da','Danés'),('de','Alemán'),('dv','Divehi'),('dz','Dzongkha'),('ee','Ewé'),('el','Griego'),('en','Inglés'),('eo','Esperanto'),('es','Español'),('et','Estonio'),('eu','Euskera'),('fa','Persa'),('ff','Fula'),('fi','Finés'),('fj','Fiyiano'),('fo','Feroés'),('fr','Francés'),('fy','Frisón occidental'),('ga','Irlandés'),('gd','Gaélico escocés'),('gl','Gallego'),('gn','Guaraní'),('gu','Guyaratí'),('gv','Manés'),('ha','Hausa'),('he','Hebreo'),('hi','Hindi'),('hr','Croata'),('ht','Criollo haitiano'),('hu','Húngaro'),('hy','Armenio'),('hz','Herero'),('id','Indonesio'),('ig','Igbo'),('ii','Yi de Sichuan'),('ik','Inupiaq'),('is','Islandés'),('it','Italiano'),('iu','Inuktitut'),('ja','Japonés'),('jv','Javanés'),('ka','Georgiano'),('kg','Kongo'),('ki','Kikuyu'),('kj','Kuanyama'),('kk','Kazajo'),('kl','Groenlandés'),('km','Jemer'),('kn','Canarés'),('ko','Coreano'),('kr','Kanuri'),('ks','Cachemiro'),('ku','Kurdo'),('kv','Komi'),('kw','Córnico'),('ky','Kirguís'),('la','Latín'),('lb','Luxemburgués'),('lg','Luganda'),('li','Limburgués'),('ln','Lingala'),('lo','Lao'),('lt','Lituano'),('lv','Letón'),('mg','Malgache'),('mi','Maorí'),('mk','Macedonio'),('ml','Malayalam'),('mn','Mongol'),('mr','Maratí'),('ms','Malayo'),('mt','Maltés'),('my','Birmano'),('nb','Noruego bokmål'),('nd','Ndebele del norte'),('ne','Nepalí'),('nl','Neerlandés'),('nn','Noruego nynorsk'),('no','Noruego'),('nr','Ndebele del sur'),('nv','Navajo'),('ny','Chichewa'),('oc','Occitano'),('om','Oromo'),('or','Odia'),('os','Osetio'),('pa','Panyabí'),('pl','Polaco'),('ps','Pastún'),('pt','Portugués'),('qu','Quechua'),('rm','Romanche'),('rn','Kirundi'),('ro','Rumano'),('ru','Ruso'),('rw','Kinyarwanda'),('sa','Sánscrito'),('sc','Sardo'),('sd','Sindhi'),('se','Sami septentrional'),('sg','Sango'),('si','Cingalés'),('sk','Eslovaco'),('sl','Esloveno'),('sm','Samoano'),('sn','Shona'),('so','Somalí'),('sq','Albanés'),('sr','Serbio'),('ss','Suazi'),('st','Sesotho'),('su','Sundanés'),('sv','Sueco'),('sw','Suajili'),('ta','Tamil'),('te','Telugu'),('tg','Tayiko'),('th','Tailandés'),('ti','Tigriña'),('tk','Turcomano'),('tl','Tagalo'),('tn','Setsuana'),('to','Tongano'),('tr','Turco'),('ts','Tsonga'),('tt','Tártaro'),('ty','Tahitiano'),('ug','Uigur'),('uk','Ucraniano'),('ur','Urdu'),('uz','Uzbeko'),('ve','Venda'),('vi','Vietnamita'),('wo','Wólof'),('xh','Xhosa'),('yi','Yidis'),('yo','Yoruba'),('zh','Chino'),('zu','Zulú'),('nah','Náhuatl'),('yua','Maya yucateco'),('tzh','Tseltal'),('tzo','Tsotsil'),('qaa','Mixteco'),('zap','Zapoteco'),('qab','Otomí'),('qac','Totonaco'),('ctu','Ch''ol'),('qad','Mazateco'),('hus','Huasteco'),('qae','Mazahua'),('qaf','Tlapaneco'),('qag','Chinanteco'),('qah','Purépecha'),('qai','Mixe'),('qaj','Tarahumara'),('qak','Zoque'),('toj','Tojolabal'),('chf','Chontal de Tabasco'),('hch','Huichol'),('qal','Amuzgo'),('qam','Chatino'),('qan','Tepehuano'),('qao','Triqui'),('qap','Popoluca'),('qaq','Cora'),('yaq','Yaqui'),('mfy','Mayo'),('sei','Seri'),
('es','Spanish'),('en','English'),('fr','French'),('de','German'),('it','Italian'),('pt','Portuguese'),('zh','Chinese'),('ja','Japanese'),('ko','Korean'),('ru','Russian'),('ar','Arabic');
CREATE TABLE company_candidate_language_0040_backup AS
 SELECT l.*, n.code FROM company_candidate_languages l LEFT JOIN manual_language_names n
 ON translate(lower(normalize(l.language,NFC)), 'áéíóúüñå', 'aeiouuna') = translate(lower(n.name), 'áéíóúüñå', 'aeiouuna');
ALTER TABLE company_candidate_language_0040_backup ADD PRIMARY KEY(company_candidate_id,language), ADD FOREIGN KEY(company_candidate_id) REFERENCES company_candidates(id) ON DELETE CASCADE;
CREATE INDEX company_candidate_language_0040_code_idx ON company_candidate_language_0040_backup(company_candidate_id,code);
DO $$ DECLARE unmatched BIGINT; collapsed BIGINT; BEGIN
 SELECT count(*) INTO unmatched FROM company_candidate_language_0040_backup WHERE code IS NULL;
 SELECT count(*) - count(DISTINCT (company_candidate_id,code)) INTO collapsed FROM company_candidate_language_0040_backup WHERE code IS NOT NULL;
 RAISE NOTICE 'manual harmonization: % unmatched language rows deleted', unmatched;
 RAISE NOTICE 'manual harmonization: % collapsed duplicate language rows', collapsed;
END $$;
DELETE FROM company_candidate_languages;
ALTER TABLE company_candidate_languages RENAME COLUMN language TO code;
ALTER TABLE company_candidate_languages DROP CONSTRAINT company_candidate_languages_level_check;
ALTER TABLE company_candidate_languages ADD CONSTRAINT company_candidate_languages_level_check CHECK (level IN ('A1','A2','B1','B2','C1','C2','native'));
INSERT INTO company_candidate_languages(company_candidate_id,code,level)
 SELECT company_candidate_id,code,max(level COLLATE "C") FROM company_candidate_language_0040_backup WHERE code IS NOT NULL GROUP BY company_candidate_id,code;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
LOCK TABLE company_candidates, company_candidate_educations, company_candidate_languages IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM company_candidates c WHERE (SELECT count(*) FROM company_candidate_educations e WHERE e.company_candidate_id=c.id) <> 1)
 OR EXISTS (SELECT 1 FROM company_candidate_educations WHERE level NOT IN ('high_school','bachelor','master','phd') OR status <> 'completed' OR institution IS NOT NULL OR start_year IS NOT NULL OR end_year IS NOT NULL)
 OR EXISTS (SELECT 1 FROM company_candidates WHERE years_of_experience <> trunc(years_of_experience) OR seniority IS NOT NULL)
 OR EXISTS (SELECT 1 FROM company_candidate_languages WHERE level = 'native') THEN
  RAISE EXCEPTION 'manual harmonization cannot round-trip; remove non-legacy data before rollback';
 END IF;
END $$;
ALTER TABLE company_candidates
 ADD COLUMN education_level TEXT CHECK (education_level IN ('high_school','bachelor','master','phd')),
 ADD COLUMN field_of_study TEXT;
UPDATE company_candidates c SET education_level=e.level, field_of_study=e.field FROM company_candidate_educations e WHERE e.company_candidate_id=c.id;
ALTER TABLE company_candidates ALTER COLUMN education_level SET NOT NULL;
DROP TABLE company_candidate_educations;
ALTER TABLE company_candidates ALTER COLUMN years_of_experience TYPE INTEGER, DROP COLUMN seniority;
ALTER TABLE company_candidates RENAME COLUMN years_of_experience TO experience_years;
CREATE TEMP TABLE manual_language_down ON COMMIT DROP AS
 SELECT l.company_candidate_id,coalesce(b.language,l.code) AS language,
 CASE WHEN l.level=(SELECT max(x.level COLLATE "C") FROM company_candidate_language_0040_backup x WHERE x.company_candidate_id=l.company_candidate_id AND x.code=l.code) THEN coalesce(b.level,l.level) ELSE l.level END AS level
 FROM company_candidate_languages l LEFT JOIN company_candidate_language_0040_backup b ON b.company_candidate_id=l.company_candidate_id AND b.code=l.code
 UNION ALL
 SELECT b.company_candidate_id,b.language,b.level FROM company_candidate_language_0040_backup b JOIN company_candidates c ON c.id=b.company_candidate_id WHERE b.code IS NULL;
DELETE FROM company_candidate_languages;
ALTER TABLE company_candidate_languages RENAME COLUMN code TO language;
ALTER TABLE company_candidate_languages DROP CONSTRAINT company_candidate_languages_level_check;
ALTER TABLE company_candidate_languages ADD CONSTRAINT company_candidate_languages_level_check CHECK (level IN ('A1','A2','B1','B2','C1','C2'));
INSERT INTO company_candidate_languages SELECT company_candidate_id,language,level FROM manual_language_down;
DROP TABLE company_candidate_language_0040_backup;
-- +goose StatementEnd
