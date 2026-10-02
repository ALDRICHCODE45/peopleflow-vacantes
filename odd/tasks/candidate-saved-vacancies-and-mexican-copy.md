# Candidate saved vacancies and Mexican Spanish UI

## Scope
- Add `/candidato/guardadas` using canonical prototype jobs and existing dashboard layout.
- Keep public Save buttons enabled and inert; audit found they already meet this requirement.
- Normalize product-owned visible UI copy to neutral Mexican Spanish; preserve user-authored data, identifiers and unrelated changes.
- Preserve running development server on 3000 and fixture on 4110. No installations, service restarts, commits or publication.

## Tasks
- [x] Map routes, canonical fixtures, Save behavior and regional copy.
- [x] SAVED-01: Implement saved vacancies route, navigation, workspace and regression tests.
- [x] COPY-01: Normalize the audited 13 product files and corresponding assertions.
- [x] VERIFY-01: Check focused tests, types, lint and browser rendering/interaction.

## Evidence
Exploration found enabled inert Save controls already present in VacancyCard, JobDetailView and prototype-feedback-island. No public-job behavior rewrite is needed.
Use DashboardPageContent width="screen-2xl" with a single padding owner. Reuse ACME_PROTOTYPE_JOBS; no saved-state storage or API.
SAVED-01 writer observed RED then GREEN: 66 tests across four files, non-incremental TypeScript and focused ESLint passed. Existing public Save regression suites passed 57 tests. Candidate E2E now covers six destinations but browser execution and independent verification remain pending. COPY-01 completed: 13 product files normalized (including the additionally found Pega instruction), with exact assertion updates across 28 files. Writer reports 360 tests across 25 files, non-incremental TypeScript and ESLint passing. Test-authored narrative data is intentionally unchanged. VERIFY-01 completed against the existing dev server without service lifecycle changes. Independent evidence: 432 tests across 30 files (142.61s), TypeScript, ESLint and diff check passed; candidate Chromium E2E 9/9 (40.1s). Saved route checked at 375/1440 in light/dark: two canonical cards, six destinations/one active, 16/24px padding, zero overflow, no serious-or-higher findings in the 15-rule axe check, no console/request failures or mutations. Public Save remained enabled and inert with no URL/storage/toast effects. Broad production voseo scan found no matches excluding tests/fixtures. Screenshots: `/tmp/peopleflow-saved-mexican-verification/saved-{375,1440}-{light,dark}.png`; mobile captures include the Next dev indicator overlay. Browser test output was redirected to `/tmp` to preserve repository artifacts. Ports 3000/4110 remain listening. Full repository suite and production build were not run. No commits were made.
