# Public jobs fixture

Start from `frontend/`: `node tests/fixtures/jobs-server.mjs` (default `127.0.0.1:4010`).

## Current public API

- `GET /v2/jobs`: strict public list items; `next_cursor` is always a string or null.
- `GET /v2/jobs/{id}`: strict vacancy detail with rich description, requirements profile, compensation, benefits, skills, applicant bucket and screening count.
- `GET /v2/catalogs/languages`
- `GET /v2/geo/countries`
- `GET /v2/geo/countries/MX/states`
- `GET /v2/geo/countries/MX/states/{state}/municipalities` (`19`, `14`)
- `GET /v2/geo/countries/MX/postal-codes/{cp}` (`64000`; other codes return `postal_code_not_found`)

Catalogs are deliberately small, deterministic test data, not a complete Mexican geography database. Unknown states return `state_not_found`.

The URL keys come from `src/features/jobs/url.ts`: repeated work modes, seniorities, states, municipalities and languages; single q, applicant_country, work_schedule, contract_type, professional_area, salary_min/max/currency/period/basis, years_of_experience, education_level and cursor. Repeated dimensions are OR, distinct dimensions AND. Search matches title/description tokens; title matches rank before description-only matches, retaining fixture order on ties.

### Pagination contract (approved fixture semantics)

The first page contains at most **2** filtered rows. It includes `next_cursor: "opaque a+b/c="` **only** if more filtered rows remain; empty and one-page results decode with `next_cursor: null`.

A cursor request models the **final page**, always without another cursor. When further rows exist, it returns all rows remaining after the first page, distinct from the first-page rows. When a cursor is supplied directly on a pool that fits in one page, it returns that single page (or an empty page for an empty pool). This direct-cursor behavior is intentional: the six-filter e2e starts at a nonempty final page without first visiting page one. Do not replace it with unconditional offset slicing, which would empty that direct singleton link. The final page decodes with `next_cursor: null`.

`pending-search` matches a dedicated vacancy and retains the legacy 300 ms response delay. The main vacancy now mentions React in its description; two React-titled vacancies rank ahead of it, so the six-filter React search has two distinct first-page rows and the main vacancy on the final page. All rows still pass the real AND predicates; no search term bypasses matching. The USD contract decoy has an explicit v2 `part_time` schedule, so it fails the active `full_time` predicate rather than leaking through the v1 contract-to-schedule mapping.

Public company profiles (`src/app/(public)/empresas/[companyId]/page.tsx`) use local data, not an API call. Visitor application identity is handled locally by the product's session boundary; screening and CV reads are candidate-only. No authenticated submission API is simulated here.

## Compatibility and controls

`/jobs` and `/jobs/{id}` remain because the current e2e suite still directly exercises the old fixture route (`vacantes.spec.ts`, fixture-health test). Employer dashboard routes continue to be delegated to `employer-dashboard.mjs`.

All controls remain: `/__health`, `/__reset`, `/__requests`, `/__failure?kind=5xx|schema|timeout`, `/__recover`, `/__visibility?id=...&visible=true|false`, `/__visibility?hidden=0|1`, `/__delay?ms=0..5000`. Failures remain armed until recovery/reset; recovery retains history; reset clears history, visibility, failure and delay. Controls/catalogs do not enter the jobs request log or inherit jobs failure/delay. List logs remain query-only (`""` on the canonical unfiltered v2 list), detail logs record the exact pathname including `/v2`.

Existing detail IDs retained (prefix `0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c`): `7d8e`, `7d90`, `7d92`, `7d94`, `7d96`. Added `7db0` (Pending Search), `7db1` and `7db2` (React roles), with matching detail endpoints. Existing sentinel pools and company IDs are retained. The default v2 pool includes the main, rich-detail, USD, React and Pending Search vacancies; the first page contains the main and rich-detail vacancies.

## Validation

From `frontend/`:

```sh
pnpm exec vitest run --config tests/fixtures/vitest.config.ts
node tests/fixtures/public-pages-smoke.mjs
PLAYWRIGHT_FIXTURE_ORIGIN=http://127.0.0.1:4010 pnpm exec playwright test tests/e2e/vacantes.spec.ts tests/e2e/vacantes-a11y.spec.ts --reporter=line --output tests/fixtures/playwright-results
PLAYWRIGHT_FIXTURE_ORIGIN=http://127.0.0.1:4010 pnpm exec playwright test tests/e2e/vacantes.spec.ts -g "recovers after timeout" --repeat-each=3 --reporter=line --output tests/fixtures/playwright-timeout-results
```

The isolated Vitest fixture binds an ephemeral port and uses the product's own strict list, detail, language and geography validators on HTTP responses. It also covers logging, filtering, hidden vacancies, persistent failure/recovery, timeout, delay and reset. The browser smoke needs the production app on `:3100` and fixture on `:4010`; it verifies real list content, the rich detail article/benefits and the visitor gate. Playwright output is confined to this fixture directory.

Observed after the pagination/sentinel corrections: **7/7 fixture tests pass (exit 0)**. Both unchanged list specs: **54 passed / 7 failed (exit 1)**; the requested pending-search, six-filter React pagination and USD conjunction cases pass, as does canonicalization. Timeout recovery separately: **3/3 repetitions pass (exit 0)**, also passing in the full run.

Remaining full-run failures:

- `vacantes-a11y.spec.ts:140`: keyboard-focus coverage expects a next-page link for singleton `q=frontend` results. With honest pagination no such link exists.
- `vacantes.spec.ts:219`: hero/layout test expects no desktop header login link, but one renders.
- `vacantes.spec.ts:422`: obsolete featured prototype status bubble.
- `vacantes.spec.ts:492`: obsolete disclosed prototype card (also expects only one default row).
- `vacantes.spec.ts:841`: pending-next test expects a next link for singleton `q=frontend` results. As above, advertising it would violate the approved no-phantom-pagination rule.
- `vacantes.spec.ts:968`: browser Back reaches `/vacantes` but the search control still contains `frontend`.
- `vacantes.spec.ts:1389`: obsolete dual-login menu.

Do not grow the `frontend` result pool merely to force the two next-link assertions green: unchanged visibility tests deliberately require that query to contain only the mutable main vacancy. These remaining assertions/product behaviors are outside fixture-only ownership.
