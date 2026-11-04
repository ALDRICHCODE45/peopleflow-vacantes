# Frontend backlog (open follow-ups)

Non-blocking items carried between units so none is lost. Each one moves into a feature document when it is
scheduled; remove it here when it ships. Shipped in `feat/employer-real-data` (see `employer-real-data.md`): CV stream
timeout, pagination history, table pinning invariant, team company lifetime, international dial split, employer
dashboard on real data, pipeline prototype fallback, legacy application phone, candidate «Crear cuenta», toasts over
Sheet footers, skills casing, outline links, candidate-edit advisories with a defect, draft-save-flow flake, bootstrap
panel voseo. Shipped in `fix/vacantes-lost-navigation` (see `next-16-upgrade.md`): lost client navigations
between `/vacantes` search variants. Retired in `fix/legacy-application-retired` (2026-10-26): the legacy
application wizard (prototype candidate «Ximena Barrera», no submission) and with it the legacy application phone
item — legacy catalog rows now say they take no online applications. Shipped in `chore/backlog-small-fixes`
(2026-10-28): root spec allowlist for the token-free `/api/auth/session` read, sidebar inside one «Navegación
principal» landmark (axe `region`), the three full-suite flaky tests made lighter (no raised timeouts). Shipped and
pushed 2026-11-02 (`saved-vacancies.md`, `vacancy-detail-explore.md`): saved vacancies with the visitor return, the
`?postulacion=` deep link, and the region below the vacancy detail with the careers-site link (`site_slug`).

## Product gaps

- **«Ver todas sus vacantes» without a careers site** (`vacancy-detail-explore.md` L7): when a company has no published
  careers site, the «Sobre {Empresa}» block shows up to 3 other vacancies and no «see all» link, because `/vacantes` has
  no company filter. Adding `company` to the public search grammar is a separate decision.
- **Save control in the mobile sticky bar** (detail): the bar shows «Postularme» + salary; saving on mobile stays in the
  aside above. Consider a bookmark in the bar if users ask.
- **«Deshacer» after removing a saved vacancy** re-saves with a new `saved_at`, so the row moves to the top of its group
  (contract v1 behavior). Restoring the original order needs a backend change.
- **«Mi historial de vacantes»: total al pie** (2026-11-03, option A, not requested yet): show «Mostrando 20 de 34
  vacantes» next to «Cargar más», like the Base de talento table. Needs the backend to return a total.
- **Vacancy team notifications** (`docs/product/next-three-features.md`, Q12, 2026-11-02): no notice when a vacancy is
  reassigned or a member is added in v1. On the radar: in-app notices first, then email once SES exists.
- **Competitor AI opportunities** (`docs/research/competidores-ia-2026-10.md`): evidence-guided async interview,
  recruiter copilot, stage automations, WhatsApp first contact, shift/branch volume — on the radar, nothing decided.

- **Invite members by email** — no backend endpoint (AddMember takes an existing recruiter `user_id`). Deferred by the
  user (2026-10-23). Email decision recorded in `docs/decision-email-provider.md` (2026-10-24: Amazon SES, sending
  through EventBridge → SQS → Go worker, Terraform; no domain registered yet) — on the radar, not to be built yet.
- **«Invitar miembro» from Equipo** (empty states, `odd/tasks/empty-states.md` L6, 2026-10-30): the team first-run
  empty state offers only «Ver configuración» until the invite endpoint above exists; add the invite action there then.
- **Primary CV** (`odd/tasks/empty-states.md` L6): the candidate dashboard «Aún no hay un CV principal» offers only «Ver mis
  CVs» — `candidate-cvs/model.ts` has no primary field or write. Needs a backend field + endpoint, then «Marcar como
  principal».
- **More application statuses for candidates** (`odd/tasks/redesign-psychometrics-ux.md` L18): «Mis postulaciones» shows
  only the real API statuses (submitted / in process / closed). Ask the backend whether to expose «En revisión»,
  «Contratada», «Rechazada» before designing them (product decision, never infer internal stages).
- **Talento PeopleFlow** (global opt-in search, Boolean CV search) — needs privacy decisions (PRIV-2/10/12) and SRCH-9
  grammar. Deferred by the user (2026-10-23).

## Known issues

- **Full-suite timeout in `components/ui/combobox.test.tsx`** («mounts the portal popup …», 2026-11-03): times out
  under full-suite load with two vitest-worker RPC timeouts; passes 29/29 alone. Not caused by vacancy team (the file
  is untouched). Make it lighter like the 2026-10-28 flaky fixes (no raised timeouts).
- **Run frontend checks with Node 22** (2026-11-03): the shell defaults to Node 25, whose global `localStorage` breaks
  jsdom suites. Use `.nvmrc` (22) before vitest/build.
- **Vacancy team ships behind `NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE`** (`odd/tasks/vacancy-team.md` L37): production
  shows nothing new until the flag handling is removed and the backend branch is deployed together.

- **Next 16 upgrade** — blocked by hosting: Amplify Hosting supports Next 12–15 only (design D1). Next 16 also fixes
  the lost `/vacantes` navigations at the router level (`next-16-upgrade.md`); revisit when Amplify supports it. Known
  migration work: `middleware.ts` → `proxy.ts` (on 16 the old name answers a plain 500), flat `eslint-config-next`
  config, 67 errors from the React Compiler lint rules, production e2e to re-green.
- **company-careers E2E looks for a combobox «Estado»** — `tests/e2e/company-careers.spec.ts:52` times out; the public
  careers filter is labeled «Ubicación» (`features/company-site/public/company-jobs.tsx:28`). Fails identically on clean
  HEAD of `feat/vacancy-detail-explore` (`vacancy-detail-explore.md` L14): stale test, update the locator.
- **Loading feedback on other links into `/vacantes`** — the sidebar «Vacantes» link shows a spinner while pending
  (`useLinkStatus`, `next-16-upgrade.md` L9); the detail «Volver»/breadcrumb links into the list do not yet.

- **Amber/brown `review` tone across the product** — user (2026-10-29, psychometric design review): «en general, el uso
  de este color no me gusta nada». Removed from the psychometric UI only (`odd/tasks/psychometric-tests.md` L22–L23);
  `--status-review` still paints review badges, pipeline stage tints and other screens (9 source files). Changing it
  product-wide touches validated screens (§21), so it needs its own design pass and the user's review.

## Waiting on the backend

- **Assessment rate limit also blocks a valid token** (`odd/tasks/psychometric-tests.md` L44): after the unknown-token
  budget is exhausted, a validated public assessment token from the same IP also gets 429. Reported to the backend;
  re-check in the browser when their fix lands (backend tracks limiter work in `docs/ROADMAP.md` «Psicométricos —
  pendientes»).

- **Vacancy → company careers site** — SHIPPED 2026-11-02 («Sobre {Empresa}» → «Conoce la empresa» from `site_slug` on
  `GET /companies/{id}`). Kept here as a record per the user's rule (never delete pending or deferred items).

- **Legacy seed in production?** The six published legacy jobs and their companies (Acme SA, Globex Holdings,
  Initech LLC) come from `backend/db/migrations/00008_jobs_seed.sql`, described as dev-only but shipped as a goose
  migration, so it would also run in production. Backend to confirm; retiring legacy rows from the public catalog is
  their call.

## Waiting on the user

- **Local branches already merged** (2026-11-02): `feat/saved-jobs-backend`, `feat/company-site-slug`,
  `feat/vacancy-detail-explore`, `feat/saved-vacancies` remain locally (and the backend's `qa/saved-jobs-and-site-slug`
  plus worktree `.scratch/site-slug`). Delete them when the user decides.
- **Migration 00053 on every environment**: additive `saved_jobs` table; its Down refuses while rows exist. Make sure the
  deploy runs migrations before the frontend that calls `/v2/me/saved-jobs`.

- **Company profile data seen on the published careers site** (`careers-builder-polish.md` L15, parked by the user
  2026-10-28): the company `logo_url` (img.magnific.com) is stored with literal backslashes (`\?semt\=…`) and returns
  404, so the site header falls back to the initial «T»; the office item shows only «México» because its location has
  the country only. Data, not code — fix the profile values (and decide whether the profile form should reject such
  URLs).

- **End-to-end browser QA of the CV library + candidate dashboard redesign** (`candidate-cvs-dashboard-redesign.md`,
  `applications-message-read.md`; merged 2026-10-31 without it — user verbatim: «la prueba completa la hare en un
  determinado momento en el futuro cuando ciertas funcionalidades ya esten implementadas al 100»). Never exercised
  front + backend together: discard with a candidate message → «Nuevo mensaje» and «Por atender» count; open it →
  read survives a reload (PUT message-read); recover + new discard → unread again; «Actualizada hace…» moves on
  visible changes only (not on in_process→in_process moves); «¿Cuánto tardan en responder?» uses first_response_at.
  The local DB has no discarded-with-message application yet.

- **Browser checks without a recorded defect** — board Estado/Municipio filters with a new application from a located
  profile; candidate view of «Vacante cerrada» (closing the process vs closing only the publication).

## Review advisories and follow-ups (psychometrics, redesign, empty states — 2026-10-30)

Native review approved every slice; these advisories are non-blocking and were left for later. Fix one at a time with a
test, never as a reason to reopen the reviewed slice.

- **Candidate sheet focus restoration** — `features/pipeline-movement/candidate-sheet.tsx:52` (R2 review R3-001): focus
  should return to the opener after closing the expanded sheet.
- **Applications selection when an assessment expires** — `features/candidate/applications-workspace.tsx:42` (R6
  review R3-expiry-selection).
- **Checklist automatic-label heuristic readability** — `features/vacancy-checklist/editor/criterion-dialog.tsx:55-59`
  (R9 review R2-001): the rule deciding whether a label is still automatic is hard to read; extract and name it.
- **Checklist panel in the candidate sheet** — `features/vacancy-checklist/board/ui.tsx:106-107` (empty states E4-C review
  R3-001): the `!state.checklist` path still returns null silently; give it a loading/empty decision.
- **Competency help tests** — `features/pipeline-movement/candidate-sheet.psychometrics.test.tsx:153` (C3 review R2-001)
  and `features/psychometrics/profile/help.test.tsx:10-13` (C3 review R3-001): tests replace the popover shell because the
  Base UI positioner loops in jsdom on these screens; Escape/outside click/focus return are browser-verified only. Find
  a jsdom-safe way to exercise the real popup or add an e2e check.
- **Psychometrics F1 follow-ups** (`odd/tasks/psychometric-tests.md` L46): reload loses historical item timing
  (assessment flow); capture-session origin normalization; mounted workspace read retry/recovery; profile confirmation
  read-back after save (editor ~96-98); dropped board refresh and profile-read recovery in the sheet state (~32,
  ~56-57).
- **Next route types only checked after `next dev`/`next build`** (2026-11-02 merge): `tsc` missed a page whose props
  could be `undefined` until `.next/types` existed; `next build` caught it (fix 429380ae). Run `next build` before
  calling a branch with route changes merge-ready.
- **Full-suite flakes under load** — «sends +52 with ten national digits as E.164» and board «adds a manual card in place…»
  time out only under machine load (pass alone); vitest may exit 1 on `onTaskUpdate`/`snapshotSaved` worker RPC timeouts
  with zero failed tests. Lesson (2026-10-30 merge): run the FULL frontend suite before calling a branch merge-ready.
- **First-run empty states seen only in tests** (`odd/tasks/empty-states.md` L11): no vacancies / talent / team, checklist
  without criteria, empty education and CV picker, careers site without jobs. The user waived a fresh test account
  (2026-10-30); check them the next time an empty account is at hand.

## Older minor items

- **Review advisories without a defect** (candidate edits unit): `edit/edit-model.ts:35-37` transform/refine order
  (Zod skips refinements on failed input, no acceptance defect); `edit/candidate-edit-form.tsx:57-70` rebase
  readability; `cv/participation-cv.tsx:38-41` readability; extra session coverage in `detail/detail-sheet.test.tsx`,
  `detail/detail-edit-integration.test.tsx`, `detail/detail-cv.test.tsx`. Two effect-cleanup ref warnings
  (`detail-sheet.tsx:61`, `change-history.tsx:52`) are intentional sequence counters.
- **«Agregar candidato» from Base de talento** (v0 redesign, 2026-10-22): user chose «Sin botón por ahora». Options
  when revisited: open the manual intake asking for the vacancy first (no backend), or create a candidate without a
  process (needs backend).

- **Load-sensitive combobox test** (`odd/tasks/candidate-cvs-dashboard-redesign.md` L25, 2026-10-30):
  `components/ui/combobox.test.tsx` «mounts the portal popup with an accessible combobox and its empty state» takes
  ~18 s inside the full suite and exceeds the 5 s default (29/29 in isolation). Find what makes the portal mount slow
  under jsdom or give it an explicit timeout with a reason. Also: never wrap `pnpm vitest` in `timeout` — it orphans
  `node (vitest)` workers that keep the machine loaded.
- **Flaky under full-suite load** (2026-11-04, `talent-base-visibility.md` L7, L13): `delivery-config/editor.test.tsx`
  («keeps dialog data on commitment_note_required»), `combobox.test.tsx`, `manual-intake/sheet.test.tsx`,
  `draft-editor-shell.test.tsx` and `local-draft-form.test.tsx` time out only in the full run; each passes alone.
- **Configuración reads `/me/company` twice** (`talent-base-visibility.md` L5): `CompanySection` and the talent base
  card each call `loadCompanyStateAction`; fold into one read.
