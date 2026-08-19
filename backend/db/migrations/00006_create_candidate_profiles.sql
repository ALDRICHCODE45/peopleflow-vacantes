-- +goose Up
-- +goose StatementBegin
-- candidate_profiles (§3.3): 1:1 with users; PK is the user_id.
CREATE TABLE candidate_profiles (
    user_id                 UUID PRIMARY KEY REFERENCES users (id),
    phone                   TEXT,
    linkedin_url            TEXT,
    portfolio_url           TEXT,
    professional_title      TEXT,
    current_company         TEXT,
    years_of_experience     SMALLINT,
    profile_summary         TEXT,
    birth_date              DATE,
    city                    TEXT,
    country                 TEXT,
    education_level         TEXT
        CONSTRAINT candidate_profiles_education_check
        CHECK (education_level IN ('high_school', 'bachelor', 'master', 'phd')),
    field_of_study          TEXT,
    skills                  TEXT[] NOT NULL DEFAULT '{}',
    current_salary_gross    INTEGER,
    current_salary_net      INTEGER,
    expected_salary         INTEGER,
    salary_currency         TEXT NOT NULL DEFAULT 'MXN',
    expected_salary_period  TEXT
        CONSTRAINT candidate_profiles_salary_period_check
        CHECK (expected_salary_period IN ('monthly', 'annual')),
    cv_s3_key               TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- STORED generated column maintained by Postgres (§1.8/§3.3). App code
    -- MUST NOT maintain search_vector — see design decision #9.
    search_vector           tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('spanish', coalesce(professional_title, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(profile_summary, '')), 'B')
    ) STORED
);

CREATE INDEX candidate_profiles_skills_idx
    ON candidate_profiles USING GIN (skills);
CREATE INDEX candidate_profiles_search_idx
    ON candidate_profiles USING GIN (search_vector);
CREATE INDEX candidate_profiles_city_idx
    ON candidate_profiles (city);

-- candidate_languages (§3.4): composite PK forbids two levels per language.
CREATE TABLE candidate_languages (
    user_id     UUID NOT NULL REFERENCES users (id),
    language    TEXT NOT NULL,
    level       TEXT NOT NULL
        CONSTRAINT candidate_languages_level_check
        CHECK (level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),

    PRIMARY KEY (user_id, language)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS candidate_languages;
DROP TABLE IF EXISTS candidate_profiles;
-- +goose StatementEnd
