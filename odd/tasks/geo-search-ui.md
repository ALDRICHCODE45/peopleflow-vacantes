# Public vacancy search by geography (G5) — frontend

Frontend of backend G5 (`backend/docs/geo-search.md`, `public-jobs-v2.md#browsesearch` on `feat/geo-search` in
`/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes`). Branch `feat/geo-search-ui`, stacked on
`feat/geo-apply-ui`.

## Specs

- S1. User answer (verbatim): «Estado, municipio, modalidad (Recomendado)» — description shown: «Más «acepta postulantes desde mi país» para remotas.»
- S2. Contract: GET /v2/jobs removes `location`; repeated `state` (2-digit MX), `municipality` (5-digit), `work_mode` (single value still valid); `applicant_country` exactly once (ISO) matches non-remote, remote anywhere and remote whose countries include it (legacy remote / remote without scope excluded). OR within a dimension, AND across. Duplicates, `none`, blank, unknown/malformed codes → 400 `invalid_filter`. Cursor v2 binds the filters; old cursors → 400 `invalid_request`; changing filters restarts without cursor.
- S3. UI rules: docs/frontend-ui-design-rules.md (all; «Ubicaciones», §13.12 filters, §16–§19). URL state as today; never send empty/none values.

## Tasks

- T1 [done] S1-S3 | writer | URL model + list client params, public filter UI (Estado, Municipio, Modalidad multi; «Postulo desde» country), chips, cursor reset, invalid_filter handling. | commit: 3b7a102, 8fac6b2
- T2 [done] | parent | Full suite (5,794 passed, 0 failed; tsc 0), guide step 79, queue item 4 paired with backend row 16. | commit: docs commit

## Log

- L1. Backend G5: 236c95e (no migration). Backend G4 race fix f4e5cef (no API change).
