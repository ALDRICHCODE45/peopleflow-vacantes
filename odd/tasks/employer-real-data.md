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
  - S1f user (L13): «el diseno de la ui que existe AUNQUE NO FUNCIONE AUN, esta aprovado, no hay que cambiarlo en medida
    de lo posible, hay que dejarlo como esta y solamente adaptarlo con la funcionalidad existente» and «no es un diseno
    aceptable, es demasiado gris, es plano, sin chiste, nada de color, revisa tu system design, revisa tus reglas de
    diseno, shadcn». The approved dashboard is `main` @ 8b66a074 (`components/company-dashboard/{section-cards,
    chart-area-interactive,active-vacancies,data-table}.tsx`, screenshot `.playwright-mcp/qa/dashboard-approved-main-1440.png`):
    its markup is restored and only fed real data; color follows docs/frontend-ui-design-rules.md §10 (metric
    medallions, proportion as a bar, semantic badges, page intro) with the Base de talento accent.
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
  - S4c toasts cover Sheet footer actions — user (L5): «Abajo, corridos cuando hay un sheet abierto»: toasts stay
    bottom-right; while a right-side Sheet is open they move to its left, so they cover neither «Cancelar»/«Guardar
    cambios» nor the theme toggle. When there is no room to its left (mobile, full-width sheet) they rise above the
    sheet footer instead. The draft editor save-bar lift keeps working.
  - S4d skills casing — user (L5): «Guardar como se escribió»: skills are stored and shown as typed («React,
    TypeScript»); duplicates and search stay case-insensitive. Backend change; already stored skills stay lowercase.
  - S4e review advisories (triage L7, units W1–W7):
    - W1 CV download keeps its deadline until the stream ends (org-candidates and board `file-client.ts`).
    - W2 user (L7): ««Cargar más» no crea historial» — loading more only appends rows (replace, no history entry);
      filters stay in the history; Back leaves the list.
    - W3 live pinning updates keep the reconciliation invariant (fixed actions rightmost, no duplicates).
    - W4 the team page lifetime is keyed by user and company; no stale company A data after a switch to B.
    - W5 user (L7): «Cerrar y pedir revisar de nuevo» — fresh candidate data while the save confirmation is open
      closes it, keeps the form draft, tells the user the candidate was updated, and requires a new confirmation;
      plus direct `prepareCandidateEdit` tests and an optional pure rebase helper (no behavior change).
    - W6 the CV upload keeps the real HTTP status when the error body is not JSON.
    - W7 CV route failure coverage (session/identity/transport/abort → sanitized no-store responses).
  - S4f older minor items: W8 board Estado/Municipio with a new application and W9 candidate «Vacante cerrada» are
    pending browser verification (no recorded defect); W10 harden the flaky `draft-save-flow` test (no fixed sleep,
    per-test history baseline); W11 bootstrap panel copy from voseo to tuteo (every string in L7).

## Tasks

- T1a S1a backend `GET /v2/me/company/dashboard` + docs — done (feat(dashboard) commit, L9)
- T1b S1b–S1e frontend dashboard on the endpoint, E2E `employer-workspace.spec.ts` rewritten — done (L11)
- T1c S1f restore the approved dashboard components with real data + §10 color — reopened (L13)
- T2 S2 pipeline prototype removal — done 2269d9ee (L4)
- T3 S3 Cognito sign-up path + sign-out URL guide — done cc282a24 (L6); AWS sign-out URLs: user action, guide step 89
- T4 S4a–S4f medium items (L9): S4a aa62982e; S4b cd52bd27 + b063267c; S4c 1beb826e; S4d in progress; S4e W1
  c9197931, W2 08d94ad2, W3 6b18bca1, W4 bee0ce58, W5 9d7ff1ed, W6 3c9d33f5, W7 33a51ff7; S4f W10 c5efe1a3, W11
  09c2558f; W8/W9 browser checks pending

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
- **L5.** User decisions (2026-10-23): toasts first «Toasts arriba a la derecha (recomendado)»; the parent then found
  `app-toaster.test.tsx:43` recording an earlier user request (toasts at the top right covered the theme toggle, so they
  were moved to the bottom), reverted the change and asked again → «Abajo, corridos cuando hay un sheet abierto
  (recomendado)». Skills: «Guardar como se escribió (recomendado)». T3 worker found that NextAuth 4.24.15 ignores
  `redirect:false` for OAuth providers (`next-auth/react` navigates anyway); parent authorized the standard NextAuth
  POST `/api/auth/signin/cognito` with CSRF token and `json=true` to obtain the authorize URL.
- **L6.** T3 (worker mvlnuzxe-5-9bjj): `lib/auth/signup-url.ts` (https + exact `/oauth2/authorize` → `/signup`, raw query
  untouched, else unchanged) and «Crear cuenta» via CSRF + POST; «Ingresar» unchanged. RED 7 failed (+ missing helper
  suite) → GREEN 22/22; auth folders 22 files / 343, tsc and eslint clean. Docs: guide step 89 (Allowed sign-out URLs
  `/candidato/login`, `/empresa/login`, self sign-up, verification) and step 37 corrected; pending-user-review updated.
  Parent live check against the dev server: the POST returns `https://us-east-1dmb1xsiw9.auth.us-east-1.amazoncognito.com/oauth2/authorize`
  with client_id, code_challenge(+method), redirect_uri, response_type, scope, state and sets the
  `next-auth.state`/`pkce.code_verifier` cookies; the same query on `/signup` returns 200 «Sign up — Create an
  account». Risk: item 2 (authentication flow) → own commit for native review.
- **L7.** Triage (explore mvlo0ktw-8-76rz) of S4e/S4f: defects present — `org-candidates/detail/file-client.ts:33–35`
  clears the timeout when returning the body (same in `pipeline-movement/file-client.ts:35–37`); `use-candidates.ts:63–69`
  keeps one accumulated page set, so Back loses pages; `use-table-preferences.ts:63–65` live setters bypass
  reconciliation; `team-page.tsx:42` keyed only by user; `cv/upload.ts:12–14` turns a non-JSON error into 502;
  `candidate-edit-form.tsx:64–78,110–114` keeps `confirmationBody` across a rebase and sends it with the new ETag.
  Not defects: `edit-model.ts` transform/refine order (Zod skips refinements on failed input), readability items;
  W8/W9 are deferred browser checks (the candidate «Vacante cerrada» badge exists and follows process finished,
  `applications-workspace.tsx:32–49`). Bootstrap voseo strings: `bootstrap-local-panel.tsx:23,27,31,32,34,40,42,
  209–211,239`. User decisions: ««Cargar más» no crea historial (recomendado)»; «Cerrar y pedir revisar de nuevo
  (recomendado)».
- **L8.** S4c (worker mvlnyt14-6-agmr): `components/feedback/use-toast-placement.ts` (pure `getToastOffsets` + body
  MutationObserver/ResizeObserver on the last open right sheet and its footer) sets `--pf-toast-right/-bottom` on the
  toaster wrapper; globals.css falls back to the safe-area and save-bar values. RED 6 → GREEN, feedback + ui 20 files /
  162; tsc, eslint clean. Commit 1beb826e; browser check pending (T1b QA pass). W11 (parent): copy test RED 10 → GREEN,
  bootstrap-local 3 files / 20; commit 09c2558f.
- **L9.** Evidence by unit. S4a (worker mvlnzuwx-7-pvdr): legacy wizard uses the shared dial field and `lib/phone`;
  E.164 or null snapshot; note the legacy wizard submits nothing (it ends at a login link) and the legacy `POST
  /jobs/{jobId}/applications` DTO has no phone (source, cover_letter only), so phone persistence there is out of scope.
  S4b: RED 5 failed → GREEN 128 (worker, 3 components); parent sweep found 5 more outline sites without merging
  (`draft-save-feedback.tsx:61–62`, `company-careers-view.tsx:127`, `company-section.tsx:52`,
  `company-location-dialog.tsx:84`, plus constants in `candidate-dashboard-overview.tsx:97`,
  `active-vacancies.tsx:64,107`, `saved-vacancies-workspace.tsx:45`, `country-gate.tsx:42`, `wizard.tsx:245`) →
  structural test `components/ui/button-variants-merge.test.ts` RED (11 sites) → GREEN; the npm `cn` package used in
  some files is a tailwind-merge drop-in (verified `cn("border-transparent","border-border")` → `border-border`).
  W1 RED 2 → GREEN 10, W2 RED 1 → GREEN 31, W5 RED 1 → GREEN 27 (+17 direct `prepareCandidateEdit` tests), W6 RED 4 →
  GREEN 6; org-candidates + pipeline-movement 66 files / 850. W3 RED 3 → GREEN (two legacy rich-data-table assertions
  encoded the old actions-not-rightmost bug and were updated), W4 RED 2 → GREEN, W7 coverage only (49 pass), W10 no
  fixed sleep + per-case URL baseline + awaited modal close: 5 consecutive runs 39/39 (15–18 s), drafts 69 files /
  2579. T1a (worker mvlnrc4s-3-j5nu): the first report had only skipped DB tests; the parent ran them against
  `draft_test` and both failed («number of field descriptions must equal number of destinations, got 7 and 6»); fixed
  (missing scan destination). Parent rerun with the DB: draftstore, applications/postgres/v2, cmd/api integration ok;
  `TestDashboard*` 2 PASS; worker `go test ./...` 91 packages, `go vet` clean. Shared SQL touched: board coverage
  (`internal/db/coverage.go`), pool summary, draft list visibility — covered by those integration packages.
- **L10.** Regression found by the T1b worker: 6 root-layout tests crashed with «ResizeObserver is not defined» since
  1beb826e (the toaster is mounted in the root layout); the worker had called them unrelated — parent reproduced and
  fixed it (guarded observer, window resize still applies) → layout + feedback 8 files / 75; commit 4765d3c5. S4d
  (worker mvlp2ycm-d-5sgz + parent): backend `normalize_skills.go` and manual validation keep typed casing, collapse
  whitespace, dedupe case-insensitively (first wins), limits unchanged, no migration; four write paths (profile PUT,
  manual intake, manual edits, organic corrections) with DB tests. There is no backend skill search (talent Q is
  name/email; board filters client-side). Frontend lowercased too (`candidate/model.ts:107`, `manual-intake/draft.ts:40`,
  `org-candidates/edit/edit-draft.ts:57`) → shared `lib/skills.ts` (RED → GREEN; three tests that pinned lowercase or
  the import list updated); board filter test «react» ↔ «React» both orders (passes: the filter already folded keys).
  Parent runs: backend `go vet` clean; `go test ./...` all functional packages ok, only `scripts/closure`
  (`TestGate_StaleReceiptIsRejected`) failed while another worker was writing — passes when rerun alone; integration
  with `draft_test`: candidates/postgres, applications/postgres/v2, draftstore, cmd/api ok. Commit 73a4883f.
- **L11.** T1b (worker mvlp2o3t-c-eflm): `features/employer-dashboard/` (client, action, strict schema, workspace with
  loading/empty/error/access states), company-dashboard components on real props, draft-list based «Vacantes
  activas», E2E `employer-workspace.spec.ts` (7 fixture-backed tests, collected with `--list`, not executed: needs the
  fixture server + authenticated state), fixture `tests/fixtures/employer-dashboard.mjs`, guide step 90. Parent removed
  `prototype-vacancies.ts` and `dashboard/data.json` and replaced the last prototype import in
  `vacantes/page.test.tsx`. app + company-dashboard + employer-dashboard + employer-vacancies 86 files / 1000, tsc,
  eslint clean. User authorized reading the main checkout `backend/.env` only to run this branch's API on :8080.
  Browser QA with real data (`.playwright-mcp/qa/dashboard-*.png`): cards 2 · 3 · 4 · 0/2, chart through 23 oct,
  real latest entries, no horizontal overflow at 390. Defects found and fixed test-first: both chart series were violet
  and the legend had no swatches (RED 1 → GREEN; organic `--brand-decorative-strong`, manual `--status-info`; the
  legend sits outside ChartContainer so swatches use the colors directly), 7d58c24f; the compact period select showed
  «90» (RED 1 → GREEN, `items`), 1f837644. S4c in a real browser: Sileo's `[data-sileo-viewport][data-position$=right]
  { right: 0 }` (same specificity, loaded later) cancelled the offsets, so toasts never moved — the jsdom tests could not
  see it; offsets moved to `[data-pf-toaster] [data-sileo-viewport][data-position]` (RED 2 → GREEN), 7fdc4b03. Measured
  after the fix: desktop sheet left 839 → right 613 px; closed → 0; mobile edit sheet footer top 779 → bottom 77 px.
  W8/W9: not completed in the browser (filter popover unreliable under automation; a new application or closing a
  vacancy would mutate the user's dev data) → left to the user, no recorded defect.
- **L12.** Full frontend suite: tsc and eslint clean; vitest 408 files, 2 failures in `requestPath.test.ts` (closed
  allowlists missing the «Crear cuenta» fetch and the dashboard server client) → both declared with their own guards
  (fixed same-origin `/api/auth/signin/cognito`; server-only shared transport), 19/19, 8868fa41. Independent verify
  (mvlq44lm-f-nviu, 7 commands all pass): 8560b569 pass (no tenant leak, shared SQL behavior kept); cc282a24 fail — a
  non-empty malformed `url` was assigned as a relative navigation → fixed test-first (RED 2 incl. `javascript:` →
  GREEN, only absolute http(s) navigates), bb0b3e39; 73a4883f core pass with two parent decisions: blank/duplicate
  skill entries are now dropped instead of rejected in intake/edits/corrections (contract change, consistent with the
  profile and S4d; the frontend never sends blanks), and the JS/Go Unicode normalization differs for rare characters
  (U+0085, final sigma) — low, the backend is authoritative. Native review in pieces (detached HEAD, parent as base):
  cc282a24 approved and acknowledged (review-a7f3c6c0ca649205, risk + reliability); bb0b3e39 approved and acknowledged
  (review-b07ab424438724c9, risk); 8560b569 and 73a4883f no verdict — the reliability reviewer (deepseek-v4-flash via
  the Pi relay) returned no text (`stopReason: length` after 32k reasoning tokens; the one allowed relaunch on 8560b569
  returned an empty `stop`), lineages review-f6b4c4284d939d27 and review-12dee1b88cb1d347 stay open. Same failure mode
  as qa-details L6 and talent-filters-export L9.
- **L13.** User (2026-10-23), screenshot `Screenshot_2026-10-23-20-36-58`: «Pero a nivel de diseno: [...] no es lo mismo
  hermano, para nada, y me sorprende tener que decirte esto otra vez, recuerda dos cosas 1. el diseno de la ui que
  existe AUNQUE NO FUNCIONE AUN, esta aprovado, no hay que cambiarlo en medida de lo posible, hay que dejarlo como esta
  y solamente adaptarlo con la funcionalidad existente, lo que hiciste aqui fue cambiarlo todo, de nuevo, aunque ya te
  habia dicho que no lo hicieras, y 2. ya tienes ojos, no se por que no revisas el diseno y te das cuenta que no es un
  diseno aceptable, es demasiado gris, es plano, sin chiste, nada de color, revisa tu system design, revisa tus reglas
  de diseno, shadcn, etc.. no te lo tendria que estar diciendo otra vez.» Cause: the T1b worker replaced the approved
  components (data-table 634 → 23 lines, chart 360 → 41, cards 80 → 19) and the parent QA checked data and defects but
  never compared against the approved design. T1c reopens S1b–S1e under S1f.
