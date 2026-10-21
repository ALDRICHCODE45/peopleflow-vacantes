-- +goose Up
-- +goose StatementBegin
-- Company-private identity, deliberately independent of global user accounts.
CREATE TABLE company_candidates (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    full_name TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
    email TEXT,
    email_normalized TEXT,
    phone TEXT CHECK (phone ~ '^\+[1-9][0-9]{7,14}$' AND (left(phone,3) <> '+52' OR char_length(phone) = 13)),
    education_level TEXT NOT NULL CHECK (education_level IN ('high_school','bachelor','master','phd')),
    country_code CHAR(2) NOT NULL REFERENCES geo_countries(code),
    state_code TEXT,
    municipality_code TEXT,
    postal_code TEXT,
    professional_title TEXT,
    current_company TEXT,
    field_of_study TEXT,
    experience_years INTEGER CHECK (experience_years BETWEEN 0 AND 60),
    summary TEXT,
    skills TEXT[] NOT NULL DEFAULT '{}',
    linkedin_url TEXT,
    portfolio_url TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT company_candidates_contact CHECK (email IS NOT NULL OR phone IS NOT NULL),
    CONSTRAINT company_candidates_email_normalized CHECK (
        (email IS NULL AND email_normalized IS NULL) OR
        (email IS NOT NULL AND email_normalized IS NOT NULL AND email_normalized = lower(btrim(email)) AND email_normalized <> '')
    ),
    CONSTRAINT company_candidates_geo_state_fk FOREIGN KEY (country_code,state_code) REFERENCES geo_states(country_code,code),
    CONSTRAINT company_candidates_geo_municipality_fk FOREIGN KEY (country_code,municipality_code) REFERENCES geo_municipalities(country_code,code),
    CONSTRAINT company_candidates_geo_postal_fk FOREIGN KEY (country_code,postal_code,municipality_code) REFERENCES geo_postal_codes(country_code,postal_code,municipality_code),
    CONSTRAINT company_candidates_location_consistency CHECK (
        (country_code <> 'MX' AND state_code IS NULL AND municipality_code IS NULL AND postal_code IS NULL)
        OR (country_code = 'MX' AND state_code IS NOT NULL AND municipality_code IS NOT NULL
            AND state_code ~ '^[0-9]{2}$' AND municipality_code ~ '^[0-9]{5}$'
            AND left(municipality_code,2) = state_code
            AND (postal_code IS NULL OR postal_code ~ '^[0-9]{5}$'))
    )
);
CREATE INDEX company_candidates_email_idx ON company_candidates (company_id, email_normalized);
CREATE INDEX company_candidates_phone_idx ON company_candidates (company_id, phone);
CREATE TABLE company_candidate_languages (
    company_candidate_id UUID NOT NULL REFERENCES company_candidates(id),
    language TEXT NOT NULL CHECK (btrim(language) <> ''),
    level TEXT NOT NULL CHECK (level IN ('A1','A2','B1','B2','C1','C2')),
    PRIMARY KEY (company_candidate_id, language)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
LOCK TABLE company_candidates, company_candidate_languages IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM company_candidates) THEN
  RAISE EXCEPTION 'manual candidate data exists; rollback requires an explicit retention decision';
 END IF;
END $$;
DROP TABLE company_candidate_languages;
DROP TABLE company_candidates;
-- +goose StatementEnd
