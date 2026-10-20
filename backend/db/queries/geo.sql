-- name: GeoCountries :many
SELECT code, name_es FROM geo_countries ORDER BY name_es COLLATE geo_es, code;

-- name: GeoStates :many
SELECT code, name FROM geo_states WHERE country_code = $1 ORDER BY code;

-- name: GeoMunicipalities :many
SELECT code, name FROM geo_municipalities WHERE country_code = $1 AND state_code = $2 ORDER BY name COLLATE geo_es, code;

-- name: GeoPostalMatches :many
SELECT s.code AS state_code, s.name AS state_name, m.code AS municipality_code, m.name AS municipality_name
FROM geo_postal_codes p
JOIN geo_municipalities m ON m.country_code=p.country_code AND m.code=p.municipality_code
JOIN geo_states s ON s.country_code=m.country_code AND s.code=m.state_code
WHERE p.country_code=$1 AND p.postal_code=$2
ORDER BY s.code, m.name COLLATE geo_es, m.code;

-- name: GeoCountryExists :one
SELECT EXISTS(SELECT 1 FROM geo_countries WHERE code=$1);

-- name: GeoStateExists :one
SELECT EXISTS(SELECT 1 FROM geo_states WHERE country_code=$1 AND code=$2);

-- name: GeoMunicipalityState :one
SELECT state_code FROM geo_municipalities WHERE country_code=$1 AND code=$2;

-- name: GeoLatestImport :one
SELECT id FROM geo_catalog_imports ORDER BY id DESC LIMIT 1;
