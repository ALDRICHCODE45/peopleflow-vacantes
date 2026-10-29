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
principal» landmark (axe `region`), the three full-suite flaky tests made lighter (no raised timeouts).

## Product gaps

- **Invite members by email** — no backend endpoint (AddMember takes an existing recruiter `user_id`). Deferred by the
  user (2026-10-23). Email decision recorded in `docs/decision-email-provider.md` (2026-10-24: Amazon SES, sending
  through EventBridge → SQS → Go worker, Terraform; no domain registered yet) — on the radar, not to be built yet.
- **Talento PeopleFlow** (global opt-in search, Boolean CV search) — needs privacy decisions (PRIV-2/10/12) and SRCH-9
  grammar. Deferred by the user (2026-10-23).

## Known issues

- **Next 16 upgrade** — blocked by hosting: Amplify Hosting supports Next 12–15 only (design D1). Next 16 also fixes
  the lost `/vacantes` navigations at the router level (`next-16-upgrade.md`); revisit when Amplify supports it. Known
  migration work: `middleware.ts` → `proxy.ts` (on 16 the old name answers a plain 500), flat `eslint-config-next`
  config, 67 errors from the React Compiler lint rules, production e2e to re-green.
- **Loading feedback on other links into `/vacantes`** — the sidebar «Vacantes» link shows a spinner while pending
  (`useLinkStatus`, `next-16-upgrade.md` L9); the detail «Volver»/breadcrumb links into the list do not yet.

## Waiting on the backend

- **Vacancy → company careers site** — link vacancy → company careers site once the jobs API exposes the published site slug.
  Company UUIDs are not public-site addresses; until then, render company names without a careers link.

- **Legacy seed in production?** The six published legacy jobs and their companies (Acme SA, Globex Holdings,
  Initech LLC) come from `backend/db/migrations/00008_jobs_seed.sql`, described as dev-only but shipped as a goose
  migration, so it would also run in production. Backend to confirm; retiring legacy rows from the public catalog is
  their call.

## Waiting on the user

- **Company profile data seen on the published careers site** (`careers-builder-polish.md` L15, parked by the user
  2026-10-28): the company `logo_url` (img.magnific.com) is stored with literal backslashes (`\?semt\=…`) and returns
  404, so the site header falls back to the initial «T»; the office item shows only «México» because its location has
  the country only. Data, not code — fix the profile values (and decide whether the profile form should reject such
  URLs).

- **Browser checks without a recorded defect** — board Estado/Municipio filters with a new application from a located
  profile; candidate view of «Vacante cerrada» (closing the process vs closing only the publication).

## Older minor items

- **Review advisories without a defect** (candidate edits unit): `edit/edit-model.ts:35-37` transform/refine order
  (Zod skips refinements on failed input, no acceptance defect); `edit/candidate-edit-form.tsx:57-70` rebase
  readability; `cv/participation-cv.tsx:38-41` readability; extra session coverage in `detail/detail-sheet.test.tsx`,
  `detail/detail-edit-integration.test.tsx`, `detail/detail-cv.test.tsx`. Two effect-cleanup ref warnings
  (`detail-sheet.tsx:61`, `change-history.tsx:52`) are intentional sequence counters.
- **«Agregar candidato» from Base de talento** (v0 redesign, 2026-10-22): user chose «Sin botón por ahora». Options
  when revisited: open the manual intake asking for the vacancy first (no backend), or create a candidate without a
  process (needs backend).
