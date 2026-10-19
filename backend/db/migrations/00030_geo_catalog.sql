-- +goose Up
CREATE COLLATION geo_es (provider = icu, locale = 'es', deterministic = true);

CREATE TABLE geo_countries (
    code CHAR(2) PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
    name_es TEXT NOT NULL CHECK (name_es <> ''),
    name_en TEXT NOT NULL CHECK (name_en <> '')
);
CREATE TABLE geo_states (
    country_code CHAR(2) NOT NULL REFERENCES geo_countries(code),
    code TEXT NOT NULL,
    name TEXT NOT NULL CHECK (name <> ''),
    abbreviation TEXT NOT NULL,
    PRIMARY KEY (country_code, code),
    CHECK (country_code <> 'MX' OR code ~ '^[0-9]{2}$')
);
CREATE TABLE geo_municipalities (
    country_code CHAR(2) NOT NULL,
    state_code TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL CHECK (name <> ''),
    PRIMARY KEY (country_code, code),
    FOREIGN KEY (country_code, state_code) REFERENCES geo_states(country_code, code),
    CHECK (country_code <> 'MX' OR (code ~ '^[0-9]{5}$' AND left(code, 2) = state_code))
);
CREATE INDEX geo_municipalities_state ON geo_municipalities(country_code, state_code, name COLLATE geo_es, code);
CREATE TABLE geo_postal_codes (
    country_code CHAR(2) NOT NULL,
    postal_code TEXT NOT NULL CHECK (postal_code ~ '^[0-9]{5}$'),
    municipality_code TEXT NOT NULL,
    PRIMARY KEY (country_code, postal_code, municipality_code),
    FOREIGN KEY (country_code, municipality_code) REFERENCES geo_municipalities(country_code, code)
);
CREATE TABLE geo_catalog_imports (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    source_date DATE NOT NULL,
    rows BIGINT NOT NULL CHECK (rows >= 0),
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE geo_catalog_imports;
DROP TABLE geo_postal_codes;
DROP TABLE geo_municipalities;
DROP TABLE geo_states;
DROP TABLE geo_countries;
DROP COLLATION geo_es;
