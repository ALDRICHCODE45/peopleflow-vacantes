# Vacancy geography (G2) — frontend

Frontend of backend G2 (`backend/docs/geo-vacancy.md` on `feat/geo-vacancy` in
`/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes`; design §20.4 in `docs/geo-location-design.md`).
Branch `feat/geo-vacancy-ui`, stacked on `feat/geo-location-field-ui` (shared `LocationField` in
`frontend/src/features/geo/`).

## Specs

- S1. User (verbatim): «que todos los lugares en donde se pida direccion, sea un listado especifico … incluso que pueda identificarlo por el codigo postal». Vacancy depth (accepted): state + municipality, optional postal code.
- S2. User (verbatim): «Creo que la ubicacion puede ser opcional para vacantes remotas, pero evidentemente en ese caso se deberia de poner explicitamente que no importa desde que ubicacion aplique el candidato, o puedes elegir, solo se puede aplicar desde estos paises, me explico?»; then «Cualquier lugar o estos países (Recomendado)» and «Sí, como presencial (Recomendado)» (hybrid requires location like onsite).
- S3. Contract (geo-vacancy.md): draft `location` null | `{country,state?,municipality?,postal_code?}` (write codes) / five-key read `{country:{id,name}, state:{id,name}|null, municipality:{id,name}|null, postal_code:string|null, label:string}` (backend confirmed: exactly these keys); `remote_scope` null | `{kind:"anywhere"}` | `{kind:"countries",countries:[codes 1–50 distinct, ordered]}` (read: countries `{id,name}`). PATCH replaces whole fields. 422 `invalid_location` details `{field:"fields.location.<level>", reason: required|unknown|mismatch|not_allowed}`; 422 `invalid_remote_scope` reasons unknown_country|duplicate|empty|too_many with zero-based index in country paths. Readiness: onsite/hybrid → `location_missing` | `location_incomplete` (MX needs state + municipality); remote → `remote_scope_missing`. Editor keeps remote scope while onsite/hybrid; public reads suppress it unless remote. Public `/v2/jobs` list/detail: `location` structured|null, `location_label` string|null (legacy free text possible), `remote_scope` (only for remote). Public query params unchanged until G5.
- S4. UI rules: docs/frontend-ui-design-rules.md (all; «Ubicaciones» section, §16, §17, §18, §19).

## Tasks

- T1 [done] S1-S4 | writer A | Draft editor write side: decoders/wire for location + remote_scope, LocationField + remote scope control in the editor, 422 mapping, readiness/missing-items copy and links, draft preview. | commit: fb3de14, f2cbb2a
- T2 [done] S1-S4 | writer B | Public read side: /v2/jobs list/detail decoders, cards/detail/facts/saved/application summary show `location_label` and remote scope honestly. | commit: 6d9cb5f (merged 3893492), c7db7f8 shared decoders
- T3 [done] | parent | Full suite, guide step 76, queue item 1 paired with backend rows 12–13. | commit: docs commit

## Log

- L1. Backend G2 committed: 1ec346f (feature + migration 00031), 6c896d3 (test). Local test: `make db-migrate` (00030, 00031), then `DATABASE_URL=… make geo-import`.
- L2. Parent: T2 ran in an isolated worktree (the parallel-writer guard treats (group) routes as overlapping); merged and switched its local decoders to the shared geo ones (identical shapes). Updated the draft route test (location is a region, not a textbox). Full suite: 5,731 passed; failures only draft-editor timeouts under full-suite load (draft-save-flow 34/34, local-draft-form 59/59, publication 28/28 alone); tsc 0. Risk: editor tests are heavier with LocationField.
