# Employer without prototype data, Cognito sign-up/sign-out, and every medium backlog item

Branch `feat/employer-real-data` from `main` @ 8b66a074. Large units first (dashboard, pipeline fallback, Cognito),
then every medium item of `frontend-backlog.md` without exception. Deferred by the user: Talento PeopleFlow and
member invitations.

## Specs

- **S1. Real employer dashboard.** «Dashboard de empresa con datos reales» — `/empresa/dashboard` shows no prototype
  data (`NEXO_VACANCIES`, `data.json`); every block comes from the company's real data. Metric definitions: pending
  the user's decision (MET-1..MET-6).
- **S2. Pipeline without prototype fallback.** `vacantes/[jobId]/pipeline` only serves real vacancies; a non-UUID id
  renders not-found. The prototype `PipelineWorkspace`, `NEXO_*` fixtures and `features/employer-talent` are removed
  together with code only they reach; modules shared with the real board stay.
- **S3. Cognito.** «Candidate «Crear cuenta» lands on the Cognito login» and «Cognito sign-out URLs missing» — scope
  pending exploration.
- **S4. Medium items** (user: «todos los pendientes medianos los vamos a hacer, sin excepcion»), from
  `frontend-backlog.md`:
  - S4a legacy application form phone gets the dial + number control.
  - S4b outline links without border (`applications-workspace.tsx:54`, `saved-vacancies-workspace.tsx:44`,
    `draft-requester-field.tsx:159`, `empresa/vacantes/page.tsx:49`).
  - S4c toasts cover Sheet footer actions (design decision).
  - S4d skills casing (product decision + backend).
  - S4e review advisories: CV stream timeout, pagination history, table preferences pinning/fixed actions, company
    lifetime in the team page, candidate-edits advisories.
  - S4f older minor items: board state/municipality filters with a new application, candidate view of «Vacante
    cerrada», flaky `draft-save-flow` test, local bootstrap panel copy in voseo.

## Tasks

- T1 S1 dashboard real data — pending decisions
- T2 S2 pipeline prototype removal
- T3 S3 Cognito sign-up and sign-out
- T4 S4a–S4f medium items (split when scheduled)

## Log

- **L1.** User (2026-10-23): «Bien hermano, todos los pendientes medianos los vamos a hacer, sin excepcion. pero hay
  que iniciar con los pendientes grandes, el tema de talento peopleflow y invitacion de miembros los dejamos
  diferidos por el momento, lo demas si. Adelante por favor.»
- **L2.** Pipeline map: the route serves the real board (`DraftPipelineState`) for UUID ids and the NEXO prototype
  otherwise; `pipeline-movement/*` and `org-candidates/detail/detail-sheet.tsx` import prototype-era modules
  (`pipeline-filters`, `pipeline-move-model`, `pipeline-filter-model`, `pipeline-board`, `pipeline-move-dialog`), so
  removal must keep those shared modules.
