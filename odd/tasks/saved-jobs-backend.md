# Saved jobs backend («Vacantes guardadas»)

Backend half of frontend `odd/tasks/saved-vacancies.md` over the agreed contract
`peopleflow-vacantes-frontend/docs/contracts/saved-vacancies-v1.md`. Branch `feat/saved-jobs-backend` from main
281aa327; no merge to main (user). High risk: migration (item 1) + limit under concurrency (item 4).

## Specs

- S1 — Contract endpoints, verbatim from the agreed contract: «`PUT /v2/me/saved-jobs/{jobId}` — save (idempotent)»,
  «`DELETE /v2/me/saved-jobs/{jobId}` — remove (idempotent)», «`DELETE /v2/me/saved-jobs?availability=closed` — remove
  the unavailable ones», «`GET /v2/me/saved-jobs` — list», «`GET /v2/me/saved-jobs/ids` — which cards to mark». «All
  under the existing candidate group (`identityhttp.NoStore`, `requireAuth`, `requireCandidate`), like `/v2/me/cvs`.»
- S2 — PUT, verbatim: «No body. `201` when created, `200` when it was already saved (unchanged `saved_at`). Body in
  both: `{ "job_id": "uuid", "saved_at": "RFC 3339" }`.» «Evaluation order (C3): an already saved row answers `200`
  regardless of availability or the limit. Otherwise a malformed or unknown id, a draft, an inactive company or a legacy
  job that is not published → `404 not_found`; a vacancy that is paused or closed (the set `GET /v2/jobs/{id}` reports
  as unavailable) → `409 job_unavailable`; at 200 saved → `409 saved_jobs_limit` with `data: { "limit": 200 }`; else
  `201`.»
- S3 — Limit, verbatim: «The limit counts every saved row, open and closed (C4). Two parallel `PUT`s at 199 end at 200
  with one `409 saved_jobs_limit`». User decision: «Sí, 200».
- S4 — DELETE one, verbatim: «`204` whether or not it was saved. A malformed id → `404 not_found`.»
- S5 — Bulk DELETE, verbatim: «Removes only rows that are `closed` under the availability rule at that instant. `200 {
  "removed": 3 }`. Exactly one key `availability` with value `closed`; anything else (missing, extra or repeated keys) →
  `400 validation_error` (C6).»
- S6 — List, verbatim: «Every saved row of the session's candidate (≤ 200, no pagination), ordered by `saved_at` desc,
  then `job_id`.» Body `{items, total, limit}`; item `{job_id, saved_at, availability, closed_at, application, job}`;
  «The `job` snapshot keys and values are identical to the `/v2/jobs` item for an open job (C1)» with keys source,
  title, company{id,name,logo_url}, location_label, work_mode, compensation, legacy_salary, published_at.
- S7 — Availability, verbatim: «a vacancy is `open` iff its process is `published` and its company is active; `paused`,
  `closed` or an inactive company → `closed`, with `closed_at` = closed_at, else paused_at, else `null` (inactive
  company → `null`). A legacy job is `open` iff `published`, not soft-deleted and its company active; else `closed`,
  with `closed_at` = deleted_at when soft-deleted, else `null`.»
- S8 — Application, verbatim: «`application` (C5) = `{ id: process_participations.id (the same id as
  /v2/me/applications items), applied_at: its created_at }`, or `null`. Legacy rows always have `null`.» «If a job is
  hard-deleted, its saved rows go with it (cascade)».
- S9 — Ids, verbatim: «`200 { "job_ids": ["uuid", …] }` (≤ 200).» Company accounts cannot save (candidate role only).
- S10 — Frontend ask: branch, commit, local port and a seed with a candidate and a saved vacancy for integration.
- S11 — Frontend ask (low priority, after saved-jobs), verbatim: «Could the public company read GET /companies/{id}
  (which the frontend already uses anonymously through getCompanyProfile) add `site_slug: string | null`, the CURRENT
  slug of the published site, null when not published? Additive field, no other change.» Backend picked
  GET /companies/{id} (company fact; avoids the catalog UNION).

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1–S3, S6–S9 | Migration 00053 + application package + postgres store, integration tests incl. concurrency | 51ff88f4 |
| T2 | S1–S6, S9 | HTTP handler, routes, error codes, handler tests, docs/saved-jobs.md | 2eed86a0 |
| T3 | all | Independent verify + native review (high risk) | verify mvxuo1bd PASS S1–S9 |
| T4 | S10 | Local run on an isolated port + seed instructions to the frontend | instructions sent |
| T5 | S11 | After saved-jobs: `site_slug` on GET /companies/{id}, separate branch feat/company-site-slug | 6ed30a4d (feat/company-site-slug) |

## Log

- L1 (frontend relay of the user, 2026-11-01): «The user approved a new feature, "Vacantes guardadas" (candidates save
  public vacancies). Frontend and backend build it in parallel. The user delegated the contract agreement to the two of
  us». User verbatim via frontend log L3: «hay que coordinarse con el agente del backend para trabajar paralelamente tu en
  el frontend y el otro agente en el backend, por favor.»
- L2 (user, relayed verbatim): «me ire a dormir hermano, los dejo implementando, por favor, si me tienen que hacer
  preguntas de producto o de otra cosa, por favor haganlas ahora, no se detengan, implementenlo todo lo que puedan, mas
  vale que cuando regrese haga correcciones a que se paren toda la noche por una pregunta que no respondi por que estaba
  dormido.» Also: do not merge to main; local services on isolated ports, shut down afterwards; open points → take the
  reasonable decision and record it here.
- L3 Contract agreed with the frontend (backend changes C1–C6, answers Q1–Q3). Decision: the limit lock uses the
  repository convention (candidate `users` row `FOR UPDATE`, as the CV library) instead of an advisory lock.
- L4 Design decisions (backend, recorded per L2):
  - Placement: jobs feature (archguard forbids cross-feature imports; the snapshot reuses `publicjobs.Company`,
    `publicjobs.Compensation`, `publicjobs.LegacySalary`). Packages `internal/features/jobs/application/savedjobs`,
    `internal/features/jobs/infrastructure/postgres/savedjobs` (raw SQL in a pgx transaction like
    `candidates/infrastructure/postgres/cvs/library.go`; no sqlc), handler
    `internal/features/jobs/infrastructure/http/savedJobsHandler.go`.
  - Migration `backend/db/migrations/00053_saved_jobs.sql` (written): `saved_jobs(candidate_id, process_id,
    legacy_job_id, job_id generated, saved_at)`, PK (candidate_id, job_id), Down refuses while rows exist.
  - Candidate: `SELECT id FROM users WHERE cognito_sub=$1 AND deleted_at IS NULL AND user_type='candidate'` (FOR UPDATE
    on Save only); missing → not_found. Subject from `security.ClaimsFromContext`.
  - Save target resolution: vacancy = `vacancy_processes` JOIN `vacancy_public_projections` JOIN active company
    (`status='active' AND deleted_at IS NULL`): published → ok, paused|closed → job_unavailable; legacy = `jobs`
    `status='published' AND deleted_at IS NULL AND published_at IS NOT NULL` with active company → ok; anything else →
    not_found.
  - Availability closed_at is status-based: vacancy `closed` → closed_at, `paused` → paused_at, inactive company →
    null; legacy → deleted_at (null when not soft-deleted). Open rows → null.
  - Snapshot expressions copy `db/queries/public_jobs.sql` (location_label, legacy_salary, legacy published_at); an
    integration test asserts the snapshot equals the `publicjobs` Store.Get item for open vacancy and legacy jobs.
  - List tie order: `saved_at DESC, job_id ASC`. Participation = any `process_participations` row of the candidate for
    that process (discarded included).
  - Bulk DELETE 400 uses the repository validation envelope `{"error":"validation failed","code":"validation_error",
    "fields":[{"field":"availability","code":"invalid"}]}` (`httpjson.WriteValidationError`).
  - New codes in `internal/shared/httpjson/saved_job_errors.go`: `job_unavailable` 409 «job unavailable»,
    `saved_jobs_limit` 409 «saved jobs limit reached» with `data:{"limit":200}` via a dedicated writer; registered in
    `Resolve`.
  - Integration DB: disposable container `pf-savedjobs-test` on 127.0.0.1:55433 (user `draft_test`, password
    `draft_test`, db `draft_test`); stop it at the end.
- L5 Implementation (T1 then T2, 2026-11-01): read the agreed contract read-only with
  `git show 6df2098f:docs/contracts/saved-vacancies-v1.md` because the frontend switched branches.
  Followed L3/L4's candidate-row lock rather than the older contract's advisory-lock wording.
  Added application types/store port, pgx store, five candidate HTTP routes, additive error resolver/writer,
  tests and `backend/docs/saved-jobs.md`. Migration 00053 was preserved unchanged; integration fixtures
  applied it successfully. No commits, dependency changes or frontend edits.
  Small transport decision: path UUIDs use the 36-character hyphenated representation, like the public
  catalog; malformed/compact/URN representations return 404 before writes. IDs use the list's deterministic
  ordering. Nil composition dependencies fail closed with the existing generic 500 envelope (production
  always supplies the store). PUT has no request body to decode and requires no file-storage configuration.
- L6 Test-first evidence: T1 initially failed because the application package did not exist; T2 initially
  failed for missing `NewSavedJobsHandler` and saved-job catalog definitions. Candidate route-gating tests
  then failed with 404 before registrations were added. A further behavior RED caught legacy soft-deletion
  time being lost when its company became inactive; fixed to retain `jobs.deleted_at` per S7/L4, with a
  passing regression. Fixture corrections: drafts have no process row, the snapshot has eight C1 keys,
  CV keys are 64 hex characters, and the existing jobs integrity constraint forbids published rows with
  null `published_at`. No migration change was necessary.
  Coverage: `TestSaveEvaluationOrderAndRejections` S2–S3; `TestConcurrentSavesAt199` S3;
  `TestSnapshotsAvailabilityOrderingIsolationAndRemoval` S4–S7/S9 (includes public-store snapshot parity
  for both sources, non-null vacancy compensation, legacy salary, ordering and two-candidate isolation);
  `TestApplicationsAndHardDeleteCascade` S8; `TestSavedJobsHTTP` and
  `TestSavedJobsRejectedTransportNeverWrites` S1–S6/S9; `TestSavedJobCatalogAndLimitData` S2;
  `TestSavedJobsStaticIDsRoute`, `TestP2bPrivateRoutesLiveCandidateGates` and the pinned topology S1/S9.
  Existing CV, application, public-catalog and baseline error tests still pass in the focused/API suites.
- L7 Verification handoff (2026-11-01):
  - `cd backend && gofmt -l .`: empty output, exit 0.
  - `cd backend && go vet ./...`: empty output, exit 0 (also resolves stale editor undefined-symbol diagnostics).
  - `cd backend && go test ./internal/features/jobs/infrastructure/http ./internal/shared/httpjson ./cmd/api -count=1`:
    all pass; final tails HTTP 0.082s, httpjson 0.597s, API 6.588s.
  - `cd backend && DRAFT_TEST_DATABASE_URL='postgres://draft_test:draft_test@127.0.0.1:55433/draft_test?sslmode=disable' go test -tags=integration -p 1 -count=1 ./internal/features/jobs/...`:
    pass; final tails draftstore 52.790s, savedjobs 5.693s. The first RED run also saw an unrelated
    `TestDashboardEntriesCoverageAndBoundary` company_candidate_cvs FK fixture failure; every later jobs run
    passed that package.
  - `cd backend && DRAFT_TEST_DATABASE_URL='postgres://draft_test:draft_test@127.0.0.1:55433/draft_test?sslmode=disable' go test -tags=integration -p 1 -count=1 ./cmd/api/...`:
    pass, API 107.447s.
  - `cd backend && go test ./... -count=1`: FAIL only in `scripts/closure` (470.209s); other packages pass,
    including API 9.088s, HTTP 0.158s, httpjson 0.674s. Closure gate tests report
    `scripts/closure/gate: line 44: syntax error near unexpected token ';;'`, followed by missing JSON
    receipt failures (including `TestGateReceipts_RealContractAndDelegation`, `TestGateReceiptParity_ValidPass`,
    `TestGate_UnitRunsClosurePackage`, `TestGate_GateArch_ValidateCurrentRepository`). The initial unit RED
    also observed this same unrelated failure. Did not modify the out-of-scope closure script.
  - `cd backend && go run ./cmd/archguard`: FAIL, one violation:
    `locked-non-goal-path docker/minio/Dockerfile: path matches locked non-goal "docker" for this closure`.
    Did not modify that out-of-scope file or guard policy.
  Required checks therefore do not all pass: handoff is partial, not verification/review approval.
  Parent retains T3, terminal git actions, container shutdown and T4. No worker-created scratch directory
  or cache remains in the worktree.
- L8 Close (2026-11-01): independent verifier mvxuo1bd-3-smz7 PASS S1–S9 (vet, unit, savedjobs and API integration;
  extra probes: rejected save leaves storage digest unchanged, constraint rejections, Down refusal P0001). Native
  assess on main..HEAD: risk medium, reviewDue false (under_budget), so no native review was started.
  T4: no seed script; the frontend runs its own disposable Postgres + `cmd/migrate up` + local identity bootstrap and
  saves through PUT (instructions sent). T5: worker implemented `site_slug` via a companies-owned query
  (`GetCompanyPublishedSiteSlug`), public shape only; unit + integration GREEN; committed 6ed30a4d on
  feat/company-site-slug. Pre-existing failures on main, not caused here: `scripts/closure` gate syntax error and
  archguard locked-non-goal `docker/minio/Dockerfile`. Not merged to main (user).
- L9 Native review (RDD on, triggered by the session reminder): lineage review-1cf17690067fcc65 over main..63f8b138,
  lenses risk/resilience/reliability, APPROVED and acknowledged (authority burned). One non-blocking advisory:
  R4-rollback-retention-race (WARNING, informational) at `backend/db/migrations/00053_saved_jobs.sql:21-26`, i.e. the
  Down data check is not under a table lock; follow-up only, no correction opened.
- L10 (user via frontend, verbatim): «dejame todo listo para que entre a revisar en el navegador el resultado». Prepared:
  local branch qa/saved-jobs-and-site-slug 4daeae2a (saved-jobs + merge of feat/company-site-slug, not main);
  migration 00053 applied to the usual dev DB (version 53; revert `go run ./cmd/migrate down` with .env loaded, which
  refuses while saved_jobs rows exist); API from that branch on 127.0.0.1:8080 with the usual .env, PID in
  .scratch/qa-api/api.pid, log .scratch/qa-api/api.log. Smoke: /v2/jobs 200, /readyz 200, saved ids without a token
  401, /companies/{id} carries site_slug.
