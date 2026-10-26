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

The URL keys come from `src/features/jobs/url.ts`: repeated work modes, seniorities, states, municipalities and languages; single q, applicant_country, work_schedule, contract_type, professional_area, salary_min/max/currency/period/basis, years_of_experience, education_level and cursor. Repeated dimensions are OR, distinct dimensions AND. Cursor is opaque, never a filter. The final page has `next_cursor: null`.

Public company profiles (`src/app/(public)/empresas/[companyId]/page.tsx`) use local data, not an API call. Visitor application identity is handled locally by the product's session boundary; screening and CV reads are candidate-only. No authenticated submission API is simulated here.

## Compatibility and controls

`/jobs` and `/jobs/{id}` remain because the current e2e suite still directly exercises the old fixture route (`vacantes.spec.ts`, fixture-health test). Employer dashboard routes continue to be delegated to `employer-dashboard.mjs`.

All controls remain: `/__health`, `/__reset`, `/__requests`, `/__failure?kind=5xx|schema|timeout`, `/__recover`, `/__visibility?id=...&visible=true|false`, `/__visibility?hidden=0|1`, `/__delay?ms=0..5000`. Failures remain armed until recovery/reset; recovery retains history; reset clears history, visibility, failure and delay. Controls/catalogs do not enter the jobs request log or inherit jobs failure/delay. List logs remain query-only (`""` on the canonical unfiltered v2 list), detail logs record the exact pathname including `/v2`.

Existing detail IDs retained (prefix `0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c`): `7d8e`, `7d90`, `7d92`, `7d94`, `7d96`. No new IDs. Existing sentinel pools and company IDs are retained. The default v2 list includes the main, rich-detail and USD vacancies.

## Validation

From `frontend/`:

```sh
pnpm exec vitest run --config tests/fixtures/vitest.config.ts
node tests/fixtures/public-pages-smoke.mjs
PLAYWRIGHT_FIXTURE_ORIGIN=http://127.0.0.1:4010 pnpm exec playwright test tests/e2e/vacantes.spec.ts -g "canonicalizes before API access" --output tests/fixtures/playwright-results
```

The isolated Vitest fixture binds an ephemeral port and uses the product's own strict list, detail, language and geography validators on HTTP responses. It also covers logging, filtering, hidden vacancies, persistent failure/recovery, timeout, delay and reset. The browser smoke needs the production app on `:3100` and fixture on `:4010`; it verifies real list content, the rich detail article/benefits and the visitor gate. Playwright output is confined to this fixture directory.

Observed: 3/3 contract tests pass; browser smoke passes. The existing canonicalization e2e passes redirect and canonical API request-count checks, then fails at `vacantes.spec.ts:151`: stale expected currency `Todas`, actual `MXN`. Updating that spec belongs to T7, outside the fixture-only edit scope. No product call observed on the public list/detail/visitor application pages remains unsatisfied.
