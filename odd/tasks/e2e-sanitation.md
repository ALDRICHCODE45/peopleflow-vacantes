# E2E sanitation: vacancy and candidate specs green against a production build

Branch `fix/e2e-sanitation` from `main` @ 99b6fa7e. Goal: the e2e specs protect again — a new failure must not hide
among old ones. Run against `next build` + `next start` with the jobs fixture, not `next dev`.

## Specs

- **S1. Production build locally.** User decision (L2): «Extender PEOPLEFLOW_LOCAL_PREVIEW a auth» — `NEXTAUTH_URL`
  accepts `http` in production only with `PEOPLEFLOW_LOCAL_PREVIEW=true` and a loopback origin, like the rest of the
  environment already does. Without the flag, production still requires `https`. The Cognito domain stays https-only.
- **S2. Honest baseline.** The five specs (`vacantes`, `vacantes-a11y`, `vacante-detalle`, `vacante-postular`,
  `candidate-workspace`) run against the production build with the fixtures they need (`:4010` jobs fixture, the
  `:4011` apply fixture) and every test runs — none hidden behind a serial failure.
- **S3. Each remaining failure gets a cause.** Stale assertion → update the spec to the approved current UI; real
  defect (e.g. axe violations) → fix the product; environment-only → document how to run it. No test is deleted or
  skipped to go green without the user's decision.
- **S4. Repeatable.** One documented command sequence (docs) starts fixtures, builds, starts and runs the specs.
- **S5. Public-focused suite.** User decision (L5): «Suite enfocada en lo público» — the jobs fixture speaks the
  current `/v2/jobs` contract the product reads; the vacancy specs (list, detail, apply as a visitor, a11y) are
  rewritten against the current UI with assertions of the same strength. `candidate-workspace` and tests of flows
  that no longer exist are listed for deletion and deleted only with the user's OK.
- **S6. Correct HTTP status.** User decision (L5): «Sí, investigar y corregir» — `/vacantes/<malformed>` must
  answer 404 and non-canonical listing URLs (`/vacantes?q=`, unknown params) must answer 307 to the canonical URL,
  without losing the loading skeleton; if that is not possible, bring the alternatives before touching it.

## Tasks

- [x] T1. S1 — auth env honours `PEOPLEFLOW_LOCAL_PREVIEW` for loopback `NEXTAUTH_URL` · inline · high risk (auth config) ·
  own commit (`fix(auth)` after this line) · independent verify (L4).
- T2. S2 — production build + both fixtures + full run of the five specs; classify every failure · inline.
- T3. S3 — fix per class (stale specs, product a11y defects, environment) · routed after T2.
- [x] T4. S4 — document the e2e run in `docs/local-production-preview.md` · inline.
- [x] T5. S6 — find why `notFound()`/`redirect()` answer 200 (suspected: `loading.tsx` streaming) and fix · worker ·
  product (L6).
- [x] T6. S5 — jobs fixture on the `/v2/jobs` contract (list, detail, control endpoints) · worker · 67e99b3a (L7).
- **Slice boundary:** commits through 67e99b3a (auth preview, serial removal + docs, 404/307, v2 fixture) are
  slice 1, ~500 lines; the spec rewrites T7–T8 start slice 2.
- [x] T7. S5 — rewrite `vacantes.spec.ts` + `vacantes-a11y.spec.ts` against the current UI · after T6 · de5891c4,
  5b154644 (fixture), 7590a64c (product), 9fcc5e3b (L8).
- **Slice boundary:** de5891c4..9fcc5e3b are slice 2 (list specs, fixture pagination, two product fixes); T8 starts
  slice 3.
- **Known issue / follow-ups (not in this feature):** (1) quick filter «Todas» after «Remoto» sometimes loses its
  navigation (`vacantes.spec.ts` «renders the approved hero…», ~2 of 5 runs, also without prefetch blocking);
  hypothesis: `JobsNavigationIsland` lives inside `page.tsx` under `loading.tsx`, so each navigation unmounts it while
  its own `useTransition` wraps `router.push`. (2) `vacantes/error.tsx` and `[jobId]/error.tsx` retry with `reset()`
  only; check whether they share the recovery race the list error had.
- [x] T8. S5 — rewrite `vacante-detalle.spec.ts` + `vacante-postular.spec.ts` · after T6 · 9c281dee.
- [x] T10. S6 (L9) — detail without `loading.tsx` (real API-driven 404/500), `noindex` on the detail error page · inline
  · 5379d9ab (L10).
- [x] T11. S3 (L9) — allow exactly `nextauth.message` in the zero-storage check (no session data); delete the obsolete
  tests and `candidate-workspace.spec.ts` · worker for the spec edits, parent deletes the file · b8442a6e (L10).
- [x] T9. S5 — obsolete tests listed and decided by the user (L9).
- **Slice boundary:** 9c281dee..b8442a6e are slice 3 (detail/apply specs, real 404/500, obsolete-test removal).
- T9. S5 — list obsolete tests (candidate-workspace, removed flows) for the user's deletion OK.

## Log

- **L1 (2026-10-25, user):** «no hermano, lo dejamos asi, sin revision. Adelante con los siguientes pasos recomendados
  por favor.» (step 4 of the recommendation: sanitize e2e — stale `vacantes.spec.ts`, `:4011` fixture for
  postular, `NEXTAUTH_URL` blocking the production build).
- **L2 (user choice):** «Extender PEOPLEFLOW_LOCAL_PREVIEW a auth».
- **L3 (evidence, dev mode):** last run of the five specs on `next dev`: 22 failed / 72 did not run / 7 passed, titles
  identical to the abe6a9f9 baseline. Classes seen: env (postular ECONNREFUSED :4011; canonical 307 got 200;
  malformed UUID 404 got 200), stale/fixture (rich detail `article`, detail error boundary, list «Listado de
  vacantes», mobile filters Sheet name, `[data-pf-candidate-overview]`), axe list matrix (4). `src/lib/env/validate.ts`
  already allows loopback http in production with the flag; `src/lib/auth/env.ts:97-103` does not.
- **L4 (T1 evidence):** RED 1 → GREEN; `vitest src/lib/auth src/lib/env src/app/api/auth` 361/361, tsc clean.
  Independent verify: parity with `validate.ts` (224 combinations, zero divergences), zero non-loopback http accepted,
  Cognito domain/issuer https-only (16 combinations), NextAuth Secure cookies follow the URL scheme (non-Secure only
  for the opt-in loopback preview), redirects stay same-origin. NEEDS DECISION item, decided by parent: both
  validators check the normalized URL, so `http://localhost/foo/..` or `http://@localhost` normalize to
  `http://localhost`; accepted as intended (operator-written config, only the normalized origin is used, no
  external redirect shown); hardening both validators is out of scope. Error message updated to mention the flag.
- **L5 (T3 evidence + user decisions):** worker removed `mode: "serial"` from 4 specs so nothing hides: 101 tests
  run, 13 pass / 88 fail. Causes: the product reads `/v2/jobs` (`getJob.ts:64`, `listJobs.ts:62`) but the fixture
  only serves the old `/jobs` contract; `candidate-workspace` predates login (`/candidato/*` now requires a session);
  stale selectors (Sheet is «Filtrar vacantes», salary currency `desktop-salary_currency`, quick filters, sidebar
  lists, visitor card replaced the dual-login menu); product defects: `/vacantes/not-a-uuid` 200 instead of 404,
  canonical listing redirects 200 instead of 307. Prod build made the 4 list axe failures disappear (dev-only).
  User: «Suite enfocada en lo público» and «Sí, investigar y corregir».
- **L6 (T5 evidence):** root cause confirmed: the 200 documents carried `NEXT_HTTP_ERROR_FALLBACK;404` and
  `NEXT_REDIRECT` markers — `loading.tsx` had flushed the shell before the page decided. Fix: `src/middleware.ts`
  (matcher `/vacantes`, `/vacantes/:jobId`, `/vacantes/:jobId/postular`; reuses `isValidJobId`,
  `isCanonicalJobsQuery`, `buildJobsUrl`; no API call) 307-redirects non-canonical listings and rewrites malformed ids
  to `/vacante-no-encontrada`, a route outside the vacancy loading ancestry whose page calls `notFound()` (branded
  not-found reused, header breadcrumb «Vacantes», framework noindex). Loading skeletons and in-page checks kept.
  Tried and dropped: rewrite target inside the loading tree (still 200), relative `Location` (Next 15 adapter → 500),
  host/forwarded-header authority (host-header injection surface, overwritten by Next anyway). Accepted: Next
  normalizes a loopback `127.0.0.1` redirect origin to `localhost` (production uses the real https origin).
  Evidence: production curl malformed detail/apply/direct 404 with breadcrumb and one noindex; non-canonical 307;
  canonical/valid 200; hostile `X-Forwarded-Host` does not redirect away. 21 middleware tests; vitest 7104/7104,
  tsc, eslint clean. e2e: «malformed UUID never reaches the API» passes; «canonicalizes before API access» now
  passes the 307 and fails only at the fixture request count (old fixture contract, T6).
- **L7 (T6 evidence):** fixture serves `/v2/jobs`, `/v2/jobs/{id}`, languages, countries, states, municipalities
  and postal-code lookups; seven control endpoints kept, `/__requests` records v2 queries; ids …d8e, …7d90,
  …7d92, …7d94, …7d96 kept with realistic data; old `/jobs` kept because a spec calls it directly. Proof:
  `vitest --config tests/fixtures/vitest.config.ts` 3/3 with the product validators; production smoke renders
  list rows, the detail article and the visitor apply gate. «canonicalizes before API access» now passes the redirect
  and the request count and fails at a stale currency assertion (expects «Todas», UI shows «MXN») → T7.
- **L8 (T7 evidence):** worker aligned 34 stale tests (assertions 372 → 383, none weakened). Fixture: honest
  pagination per R3 (next_cursor only when more pages; a cursor request answers the nonempty final page, the rule
  the spec documents), pending-search and two-page React data, USD decoy `part_time`. Product defects found by the
  run, fixed test-first: search field stale after Back (uncontrolled `defaultValue`, now keyed by `q`); list retry
  did not always recover — probe: the refresh RSC payload contained the list yet the error stayed in ~15% of runs,
  same with a same-URL link or `router.refresh()` → retry reloads the document (`reload-page.ts`). Harness: aborting
  every Next prefetch dropped later navigations (hero 2/5 failed with it, 8/8 isolated without it); without any
  blocking 6 request-count tests fail, so only `/vacantes/<id>` prefetches are aborted. Results: vitest 7105/7105,
  tsc clean, fixture vitest 7/7; list specs on the production build 58/61, the 3 failures being the obsolete-flow
  tests for T9; recovery tests 15/15 repeated.
- **L9 (T8 evidence + user decisions):** T8 aligned 16 detail/apply tests (assertions 262 → 301): detalle 17/27,
  postular 0/5, failures consistent over 3 repeats. Remaining: API-driven 404 (unknown/hidden vacancy) and 500 (API
  failure) answered 200 under the detail `loading.tsx`; the visitor apply gate writes `nextauth.message` to
  localStorage (NextAuth cross-tab broadcast, no session data); 7 obsolete-flow tests (detail placeholder controls x2,
  canonical company links, zero-share audit; apply demo draft, Unicode cover letter, local CV filename). User:
  «Código real, sin skeleton al entrar», «Permitir solo esa clave», «Borrar todos» (10 obsolete tests +
  `candidate-workspace.spec.ts`, which predates login; the private candidate area has no e2e until a test session
  exists). Cleanup left: `PublicJobDetailSkeleton` is now used only by tests.
- **L10 (T10–T11 evidence, close):** removing the detail `loading.tsx` was not enough — a loading boundary wraps every
  nested segment, so the list's `vacantes/loading.tsx` still covered the detail. The list page and its loading moved
  into the `vacantes/(listado)` route group (same URLs). Production curl: list 200 with skeleton; valid detail and
  apply 200; unknown vacancy 404 (noindex); hidden 404; API failure 500 (noindex); malformed 404; non-canonical 307.
  Unit 3348/3348 on touched areas, tsc clean. T11 removed exactly the 10 decided tests (37→34, 24→20, 5→2) and
  their exclusive helpers; the storage allowlist accepts only `nextauth.message` with JSON `{event: "session",
  data: {trigger}, timestamp}`. Final production-build e2e: vacantes 34/34, vacantes-a11y 24/24, vacante-detalle
  23/23, vacante-postular 2/2 → **83/83, zero not-run** (from 13/101 with 72 hidden at the start). Known flake:
  hero quick-filter «Todas» navigation 1 of 5 repeats (follow-up). The storage audit never covered cookies or
  IndexedDB (unchanged).
