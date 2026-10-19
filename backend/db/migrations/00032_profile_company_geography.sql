-- +goose Up
-- S8: discard free text, with no legacy backfill.
DROP INDEX candidate_profiles_city_idx;
ALTER TABLE candidate_profiles
 DROP COLUMN city,
 DROP COLUMN country,
 ADD COLUMN country_code CHAR(2) REFERENCES geo_countries(code),
 ADD COLUMN state_code TEXT,
 ADD COLUMN municipality_code TEXT,
 ADD CONSTRAINT candidate_profiles_geo_state_fk FOREIGN KEY (country_code,state_code) REFERENCES geo_states(country_code,code),
 ADD CONSTRAINT candidate_profiles_geo_municipality_fk FOREIGN KEY (country_code,municipality_code) REFERENCES geo_municipalities(country_code,code),
 ADD CONSTRAINT candidate_profiles_location_consistency CHECK (
  (country_code IS NOT NULL OR (state_code IS NULL AND municipality_code IS NULL))
  AND (state_code IS NULL OR (country_code = 'MX' AND state_code ~ '^[0-9]{2}$'))
  AND (municipality_code IS NULL OR (state_code IS NOT NULL AND municipality_code ~ '^[0-9]{5}$' AND left(municipality_code,2) = state_code))
 );
ALTER TABLE companies
 DROP COLUMN city,
 DROP COLUMN country,
 ADD COLUMN country_code CHAR(2) REFERENCES geo_countries(code),
 ADD COLUMN state_code TEXT,
 ADD COLUMN municipality_code TEXT,
 ADD COLUMN postal_code TEXT,
 ADD CONSTRAINT companies_geo_state_fk FOREIGN KEY (country_code,state_code) REFERENCES geo_states(country_code,code),
 ADD CONSTRAINT companies_geo_municipality_fk FOREIGN KEY (country_code,municipality_code) REFERENCES geo_municipalities(country_code,code),
 ADD CONSTRAINT companies_geo_postal_fk FOREIGN KEY (country_code,postal_code,municipality_code) REFERENCES geo_postal_codes(country_code,postal_code,municipality_code),
 ADD CONSTRAINT companies_location_consistency CHECK (
  (country_code IS NOT NULL OR (state_code IS NULL AND municipality_code IS NULL AND postal_code IS NULL))
  AND (state_code IS NULL OR (country_code = 'MX' AND state_code ~ '^[0-9]{2}$'))
  AND (municipality_code IS NULL OR (state_code IS NOT NULL AND municipality_code ~ '^[0-9]{5}$' AND left(municipality_code,2) = state_code))
  AND (postal_code IS NULL OR (municipality_code IS NOT NULL AND postal_code ~ '^[0-9]{5}$'))
 );

-- +goose Down
-- Free text is intentionally unrecoverable. Restored columns are SQL NULL.
ALTER TABLE candidate_profiles
 DROP COLUMN municipality_code,
 DROP COLUMN state_code,
 DROP COLUMN country_code,
 ADD COLUMN city TEXT,
 ADD COLUMN country TEXT;
CREATE INDEX candidate_profiles_city_idx ON candidate_profiles(city);
ALTER TABLE companies
 DROP COLUMN postal_code,
 DROP COLUMN municipality_code,
 DROP COLUMN state_code,
 DROP COLUMN country_code,
 ADD COLUMN city TEXT,
 ADD COLUMN country TEXT;
