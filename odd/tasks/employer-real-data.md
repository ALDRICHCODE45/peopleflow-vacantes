# Employer without prototype data, Cognito sign-up/sign-out, and every medium backlog item

Branch `feat/employer-real-data` from `main` @ 8b66a074. Large units first (dashboard, pipeline fallback, Cognito),
then every medium item of `frontend-backlog.md` without exception. Deferred by the user: Talento PeopleFlow and
member invitations.

## Specs

- **S1. Real employer dashboard.** «Dashboard de empresa con datos reales» — `/empresa/dashboard` shows no prototype
  data (`NEXO_VACANCIES`, `data.json`); every block comes from the company's real data. User decisions (L3):
  - S1a «Endpoint nuevo en el backend»: `GET /v2/me/company/dashboard`, one call, same auth/company gate and the same
    vacancy visibility as `GET /v2/me/company/job-drafts` (so a recruiter sees the vacancies the list shows them).
  - S1b cards «Vacantes publicadas · Candidatos en proceso · Nuevos en la base (últimos 7 días) · Posiciones cubiertas
    (cubiertas/requeridas). Sin flechas de tendencia hasta acordar fórmulas.»
  - S1c chart «Orgánicas vs. manuales por día»: participations that entered a visible vacancy per day, split by
    participation source organic/manual, last 7/30/90 days, days in America/Mexico_City, zero-filled.
  - S1d table «Últimas incorporaciones reales»: most recent participations in visible vacancies — Candidato, Vacante,
    Etapa, Origen (orgánico/manual), Fecha, quién lo agregó; the click opens the vacancy board.
  - S1e «Vacantes activas» panel lists the real published vacancies (existing job-drafts list).
  - Contract (S1a): `{ "published_vacancies": int, "in_process": int, "pool_added_last_7_days": int,
    "positions": {"covered": int, "required": int}, "origin_by_day": [{"date":"YYYY-MM-DD","organic":int,
    "manual":int}] (90 entries, oldest first, ending today), "recent": [{"participation_id", "candidate":{"kind","id",
    "name"}, "vacancy":{"id","title"}, "stage":{"id","name"}, "source":"organic|manual", "applied_at",
    "added_by": {"id","name"}|null}] (max 10, newest first) }`. `in_process` and `positions` use the existing
    definitions of the draft list (`candidates.in_process`) and the board coverage (`coverage.covered/required`),
    over published vacancies; `pool_added_last_7_days` equals the candidates summary `added_last_7_days`.
- **S2. Pipeline without prototype fallback.** `vacantes/[jobId]/pipeline` only serves real vacancies; a non-UUID id
  renders not-found. The prototype `PipelineWorkspace`, `NEXO_*` fixtures and `features/employer-talent` are removed
  together with code only they reach; modules shared with the real board stay.
- **S3. Cognito.** «Candidate «Crear cuenta» lands on the Cognito login» and «Cognito sign-out URLs missing».
  - S3a «Misma sesión, enviar a /signup»: «Crear cuenta» starts the normal NextAuth sign-in (state/PKCE kept) and only
    swaps the Cognito path `/oauth2/authorize` → `/signup` (AWS: «Direct link with same parameters as
    `/oauth2/authorize`»). «Ingresar» is unchanged.
  - S3b «Las configuro yo en la consola»: the guide lists the exact Allowed sign-out URLs
    (`<NEXTAUTH_URL>/candidato/login`, `<NEXTAUTH_URL>/empresa/login`) and the check afterwards; no AWS change by the
    agent.
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

- T1a S1a backend `GET /v2/me/company/dashboard` + docs — backend worker
- T1b S1b–S1e frontend dashboard on the endpoint, E2E `employer-workspace.spec.ts` rewritten
- T2 S2 pipeline prototype removal — done 2269d9ee (L4)
- T3 S3 Cognito sign-up path + sign-out URL guide
- T4 S4a–S4f medium items (split when scheduled)

## Log

- **L1.** User (2026-10-23): «Bien hermano, todos los pendientes medianos los vamos a hacer, sin excepcion. pero hay
  que iniciar con los pendientes grandes, el tema de talento peopleflow y invitacion de miembros los dejamos
  diferidos por el momento, lo demas si. Adelante por favor.»
- **L2.** Pipeline map: the route serves the real board (`DraftPipelineState`) for UUID ids and the NEXO prototype
  otherwise; `pipeline-movement/*` and `org-candidates/detail/detail-sheet.tsx` import prototype-era modules
  (`pipeline-filters`, `pipeline-move-model`, `pipeline-filter-model`, `pipeline-board`, `pipeline-move-dialog`), so
  removal must keep those shared modules.
- **L3.** User decisions (2026-10-23): dashboard data «Endpoint nuevo en el backend (recomendado)»; cards «Propuesta
  real (recomendada)»; chart «Orgánicas vs. manuales por día (recomendado)»; table «Últimas incorporaciones reales
  (recomendado)»; Crear cuenta «Misma sesión, enviar a /signup (recomendado)»; sign-out URLs «Las configuro yo en la
  consola». Exploration: no dashboard/aggregate endpoint exists (`backend/cmd/api/router.go:78–263`); draft list
  visibility is owner-or-principal (`jobs/application/draftlist/store.go:77–81`); both «Ingresar» and «Crear cuenta»
  call the same `signIn` (`CandidateAuthControls.tsx:29,40–41`); logout already hands off to Cognito `/logout`
  (`lib/auth/logout.ts:22–29`), only the AWS allowlist is missing.
- **L4.** T2: route serves `DraftPipelineState` for UUIDs and `notFound()` otherwise (RED 2 → GREEN). Removed
  `PipelineWorkspace`, `pipeline-board/-model/-filters/-filter-model/-move-dialog/-move-model`, `prototype-candidates`,
  `features/employer-talent` and the prototype-only E2E specs `employer-pipeline-moves/-filters`; the 9 real-board
  imports of `plural` now import `employer-vacancies/plural`. `prototype-vacancies` stays until T1b (dashboard).
  employer-vacancies, pipeline-movement, org-candidates, app, components: 189 files / 2349 tests; tsc, eslint clean.
  Slice note: 2269d9ee is ~11.7k deleted lines and ~74 authored lines.
