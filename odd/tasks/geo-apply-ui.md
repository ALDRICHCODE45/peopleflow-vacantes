# Applicant country gate and §19 location filters (G4) — frontend

Frontend of backend G4 (`backend/docs/geo-apply.md`, `vacancy-applications.md`, `board-filter-data.md`,
`pipeline-movement.md` on `feat/geo-apply` in `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes`).
Branch `feat/geo-apply-ui`, stacked on `feat/geo-profiles-ui`.

## Specs

- S1. User answers (verbatim): «Bloquea la postulación (Recomendado)» — «Se compara el país del perfil; si no coincide no puede postular; si no tiene país, se le pide completarlo antes.»; «Solo cuando hace falta (Recomendado)» — candidate country required only to apply to a country-restricted vacancy.
- S2. Contract: POST apply on a remote vacancy with `remote_scope.kind = "countries"` compares the candidate's CURRENT profile country: none → 422 `applicant_country_required`; not listed → 422 `applicant_country_not_allowed`; both carry `data: {"allowed":["MX","CO",…]}` in scope order. Checked after idempotency replay and before screening/CV/duplicate checks.
- S3. Board items and participation detail: `profile.city` removed, `profile.location` = five-key read (postal_code always null) | null; mutations still never carry profile. Board filters: city → «Estado» and «Municipio», client-side multi-select (§18), options derived from items, «Sin dato» = none; old applications have location null.
- S4. UI rules: docs/frontend-ui-design-rules.md (all; «Ubicaciones», §13.12, §16–§19). Never invent data; no automatic retries.

## Tasks

- T1 [pending] S1-S4 | writer A | Apply flow: early honest notice from vacancy scope + profile country, 422 mapping with «Completar perfil» path, allowed country names. | commit: -
- T2 [pending] S1-S4 | writer B | Board: decoders profile.location, Estado/Municipio filter dimensions replace Ciudad, candidate sheet profile block shows the label. | commit: -
- T3 [pending] | parent | Full suite, guide step, queue paired with backend row 15. | commit: -

## Log

- L1. Backend G4: bdffc03 (migration 00033), 01f9e68 (feature). `make db-migrate` applies 00033.
