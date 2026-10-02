# Sample vacancies and filter presentation

## Intent and authorization
User explicitly requests ten diverse test vacancies with matching details, Spanish selected-filter labels, and additional visual-only filter types. Configurable frontend-only sample mode explicitly approved; NEVER touch backend. No visible demo/unavailable notices. Existing functional filters preserved. User owns push and visual/smoke/a11y acceptance; only focused unit/type/lint checks. Follow frontend UI rules and installed primitives. Fast delivery, no optional polish.

## Scope and design
Server-only PEOPLEFLOW_SAMPLE_JOBS strict optional boolean default false. When enabled, list/detail readers use one typed ten-job dataset with unique IDs, diverse jobs, canonical six-filter AND semantics and deterministic pagination. Off leaves real API path unchanged; invalid IDs remain rejected and unknown sample IDs return404. Preserve existing known Frontend/Go fixture IDs. No backend/data writes, storage or dependencies. Document deployment flag and redeploy; existing API/site env validation unchanged.
Selected enums remain raw English in query/submission but Spanish in triggers. New salary min/max, language and benefits preferences hold local state only, outside functional forms without names/query/navigation; shared desktop/mobile state and distinct IDs. No extra apply claims.

## Tasks and delivery
Branch feat/sample-vacancies-filters from145bc5e. Two sequential delegated work units (multi-file trigger), coherent tests with behavior. Approx600–850 authored lines forecast, retain previously approved feature-branch-chain delivery preference; no remote PR or push. Parent owns commits and main integration.
- [x] SVF-1: Config flag, ten-job reads, list/detail switch and docs. Commit034f262; observed RED then30/30 focused tests GREEN, tsc/scoped lint pass. Independent30/30 and static boundary review PASS. Native assessment unavailable (untracked paths); required independent check complete.640 diff lines incl tests/docs, coherent scope retained.
- [x] SVF-2: Spanish triggers and local-only salary/language/benefit preferences. Commit9b6e7c2 integrated local main. Actual behavioral RED (remote instead of Remoto) then10/10 focused tests;10/10 page tests, tsc/scoped lint PASS. Independent10/10/static check PASS. Native assess unavailable; independent check fulfilled.667 diff lines including tracking; total1301 above forecast, retained coherent tests and scope.

## Checks and acceptance
Node22. Actual RED before new behavior then GREEN; focused Vitest, tsc and scoped eslint. No browser/smoke/a11y/build/full suites. Default mode makes no sample substitutions; sample mode no API requests. Ten unique jobs, valid schemas, matching detail IDs and filtering consistency. New visual controls do not modify query/results. RDD off; assess each writer diff, follow verifier plan. Rollback by work-unit commits; no external runtime harness (unit-only, user visual acceptance).

## Progress / next step
Both units committed and merged local main. User must set PEOPLEFLOW_SAMPLE_JOBS=true in frontend server runtime and redeploy to see ten jobs; default remains false. Existing API/site origins remain required. No push, hosting/env secrets changes, build/browser/a11y/smoke/full suites. Mobile Sheet composition inspected statically; shared-state harness tested, not actual browser interaction. Main's dirty backend documents and user servers preserved.
