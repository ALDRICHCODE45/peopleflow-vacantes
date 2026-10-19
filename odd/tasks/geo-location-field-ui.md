# Shared LocationField and geo catalog client (G1) — frontend

Frontend of backend G1 (`backend/docs/geo-catalog.md` on `feat/geo-catalog` in
`/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes`; design §20 in `docs/geo-location-design.md`).
Branch `feat/geo-location-field-ui` from `main`. No screen adopts the field until G2 (vacancy) and G3
(profile, company); this cut delivers the client, the shared field and its tests.

## Specs

- S1. User (verbatim): «creo que si valdria la pena, realmente tener un listao de paises, estados, municipios, etc.. en todos los lugares donde se pidan para poder tener un mejor tratamiento de la data, mejores filtros, mas precisos, mejor organizacion, mejores analiticas incluso, es decir, que todos los lugares en donde se pida direccion, sea un listado especifico, me explico? incluso que pueda identificarlo por el codigo postal».
- S2. User answers: «Si, solo mexico por ahora, pero realmente si conviene dejar la puerta abierta para el detalle internacional.»; depth per context accepted (vacante hasta municipio + CP opcional; empresa hasta municipio + CP; candidato hasta municipio, sin CP); «Lista mundial; detalle solo MX (Recomendado)»; SEPOMEX «Seguir igual, acepto el riesgo».
- S3. Q3 (frontend decision accepted by backend): the CP PRELOADS state + municipality (editable, never locked); several matches → the user picks one; changing state/municipality to one the CP doesn't map to clears the CP with a visible note.
- S4. Contract G1: GET `/v2/geo/countries`, `/v2/geo/countries/MX/states`, `/v2/geo/countries/MX/states/{state}/municipalities` → `{items:[{id,name}]}` (ids are catalog codes as strings, keep leading zeros); `/v2/geo/countries/MX/postal-codes/{cp}` → `{postal_code, matches:[{state:{id,name}, municipality:{id,name}}]}`; errors 404 country_not_found/state_not_found/postal_code_not_found, 400 invalid_postal_code/invalid_request; public, `Cache-Control: public, max-age=86400`, strong ETag. Write value (later cuts): `{country, state, municipality, postal_code}` codes.
- S5. UI rules: docs/frontend-ui-design-rules.md (all; §16, §17, §19 official shadcn composition). Never invent data; strict decoders; no automatic retries.

## Tasks

- T1 [pending] S1-S5 | writer | Geo client (server + same-origin route handlers with caching) and shared LocationField with depth/postal props; tests; rule section. | commit: -
- T2 [pending] | parent | Commits, queue pairing with backend row 12. | commit: -

## Log

- L1. Backend G1 committed: 579748a (migration 00030), 5a8bbce (catalog, endpoints, importer, data). Local test: `make db-migrate` then `make geo-import`.
