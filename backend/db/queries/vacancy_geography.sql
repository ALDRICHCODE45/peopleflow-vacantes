-- name: VacancyLocationRead :one
SELECT jsonb_build_object(
 'country',jsonb_build_object('id',c.code,'name',c.name_es),
 'state',CASE WHEN s.code IS NULL THEN NULL ELSE jsonb_build_object('id',s.code,'name',s.name) END,
 'municipality',CASE WHEN m.code IS NULL THEN NULL ELSE jsonb_build_object('id',m.code,'name',m.name) END,
 'postal_code',NULLIF(sqlc.arg('postal_code')::text,''),
 'label',COALESCE(m.name || ', ' || s.name,s.name,c.name_es)
)::jsonb AS body
FROM geo_countries c
LEFT JOIN geo_states s ON s.country_code=c.code AND s.code=sqlc.arg('state')::text
LEFT JOIN geo_municipalities m ON m.country_code=c.code AND m.code=sqlc.arg('municipality')::text
WHERE c.code=sqlc.arg('country')::text;

-- name: VacancyRemoteCountriesRead :one
SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.code,'name',c.name_es) ORDER BY selected.ordinality),'[]'::jsonb)::jsonb AS body
FROM unnest(sqlc.arg('countries')::text[]) WITH ORDINALITY selected(country,ordinality)
JOIN geo_countries c ON c.code=selected.country;
