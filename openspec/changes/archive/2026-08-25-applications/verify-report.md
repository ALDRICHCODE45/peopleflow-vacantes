```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:b6c837e098461afce364c75864b2c0e592f133e1180852cd83311f903707b901
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 26/26
scenarios: 107/107
test_command: cd backend && go test -count=1 ./...
test_exit_code: 0
test_output_hash: sha256:56b1dba4a77bb2be2a5bebc86f2955d0fd8e9a262c9ec623750bd446894f2d42
build_command: cd backend && go build ./...
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

# Verify Report: `applications` (SECOND run — post-remediation)

Verdict: **pass_with_warnings**

The single CRITICAL from the first run is **RESOLVED**. The missing Phase 5.2 adapter SQL
integration suite now exists as
`backend/internal/features/applications/infrastructure/postgres/applicationRepository_integration_test.go`
(commit `154e9cd`, 1284 lines, **29 test functions**). It exercises the adapter against a live
PostgreSQL (transaction-rollback isolation, self-contained fixtures, UUID namespace `01900000-…`
isolated from the jobs/membership `018f0000-…` suite), and covers **all 23 previously-uncovered
scenarios** plus the previously DB-unpinned "partially covered" scenarios. Every one of the 107
spec scenarios now has at least one test at the correct layer. D1–D13 remain honored in code
(production files are byte-for-byte untouched by the remediation — the commit adds only the test
file). All verification commands are green and the integration suite compiles+links under
`-tags=integration`. No new CRITICAL was introduced. The non-blocking warnings carried from the
first run (AST guard naming/strength drift, TDD-table incompleteness, test scaffolding in
production files) remain, plus a few trivial documentation-level observations; none blocks
archive/sync.

---

## 1. Measured totals (my own counts)

| Artifact | Requirements | Scenarios | ADRs |
|---|---|---|---|
| `specs/applications/spec.md` | **26** (`grep -c "^### Requirement:"`) | **107** (`grep -c "^#### Scenario:"`) | — |
| `design.md` | — | — | **13** (`grep -cE "^### D[0-9]+ "`) |
| `tasks.md` declared | 26 | 107 | — |

Authoritative: **26 requirements / 107 scenarios / 13 ADRs (D1–D13).** 21 task checkboxes, all
`[x]`; zero unchecked implementation-task markers (`^\s*- \[ \]` → none).

---

## 2. Remediation verification — the CRITICAL is resolved

| Check | Result |
|---|---|
| `applicationRepository_integration_test.go` exists | ✅ committed `154e9cd` (`git show --name-status` → `A …/applicationRepository_integration_test.go`, +1284 lines) |
| Test function count | ✅ **29** `func Test…` (grep-verified) |
| Follows `migration_00010_test.go` conventions | ✅ `//go:build integration`, `package postgres`, reuses `skipIfNoDatabaseForApplications`, `t.Cleanup(tx.Rollback)`, `requireApplicationsSchema` fails loud on missing tables |
| Fixture UUID namespace isolated | ✅ `01900000-0000-7000-8000-…` (distinct from jobs/membership `018f0000-…`; comment documents this) |
| Compiles under tag | ✅ `go vet -tags=integration ./internal/features/applications/...` exit 0; `go test -tags=integration -run '^$' ./…/postgres/` exit 0 (binary links) |
| Does not shadow/break existing tests | ✅ zero duplicate `func Test…` names across the three postgres test files; `go test -count=1 ./...` → 32 `ok`, 0 FAIL |

The remediation is **test-only** (no production code touched — confirmed by `git show --stat
154e9cd` listing a single file). This is the accepted deferred-RED SQL pattern (design §7 intro /
tasks.md Commit E): RED and GREEN coincide because the SQL under test was authored in Commit D.

---

## 3. Coverage — the previously-uncovered 23 scenarios are now covered at the I layer

First-run uncovered scenarios → now pinned by:

| # | Scenario | New I-layer test |
|---|---|---|
| S30 | published+active applicable | `TestCreate_PublishedActiveJobSuccess` |
| S31 | draft not applicable | `TestCreate_NotApplicable` (draft) |
| S32 | closed not applicable | `TestCreate_NotApplicable` (closed) |
| S33 | soft-deleted not applicable | `TestCreate_NotApplicable` (soft-deleted) |
| S34 | suspended company not applicable | `TestCreate_NotApplicable` (suspended) |
| S35 | pending_verification company not applicable | `TestCreate_NotApplicable` (pending_verification) |
| S36 | non-existent job not applicable | `TestCreate_NotApplicable` (non-existent) |
| S37 | eligibility atomic with INSERT | `TestCreate_GateIsAtomicWithInsert` |
| S39 | cross-job re-apply permitted | `TestCreate_CrossJobAllowed` |
| S53 | only caller's rows | `TestListByCandidate_OwnRowsDesc` |
| S54 | soft-deleted job history preserved | `TestListByCandidate_SoftDeletedJobHistoryPreserved` |
| S56 | candidate hard-cap 100 | `TestListByCandidate_Cap100` |
| S61 | own-company list DESC | `TestListByJob_WithRowsDescOrder` |
| S68 | non-existent job → 404 | `TestListByJob_NonExistent404` |
| S69 | recruiter hard-cap 100 | `TestListByJob_Cap100` |
| S70 | soft-deleted job apps visible | `TestListByJob_SoftDeletedVisible` + `TestGetByID_SoftDeletedJobStillVisible` |
| S71 | apply to soft-deleted rejected | `TestCreate_NotApplicable` (soft-deleted) |
| S72 | transition on soft-deleted allowed | `TestTransition_SoftDeletedJobStillTransitionable` |
| S79 | mismatched job id → 404 | `TestGetByID_MismatchedJobID404` |
| S84 | in_review → rejected | `TestTransition_InReviewToRejected` |
| S85 | in_review → hired | `TestTransition_InReviewToHired` |
| S98 | concurrent transition one 200 one 404 | `TestTransition_LostRaceNotFound` |
| S99 | lost race allows re-fetch | `TestTransition_LostRaceNotFound` (re-read via `GetByID`) |

Previously "partially covered" scenarios now also DB-pinned: S7, S20, S24, S25, S26, S38, S49,
S52, S66, S67, S73, S78, S80, S82, S83, S100, S101, S104 (see matrix below).

**Coverage: 107/107 scenarios have at least one test.** The central SQL behaviors are now
verified against Postgres: D1 atomic gate (incl. the `23503`/`23514` defense-in-depth branches via
`TestCreate_InvalidCandidateReference` / `TestCreate_InvalidSourceCheckViolation`), D3 lost-race
`WHERE status = from` guard, D5 two-step scope check, soft-delete visibility asymmetry, and the
`LIMIT 100` caps.

### Full scenario → test matrix (S1–S107)

- **S1–S9** (schema) → `migration_00010_test.go` (8 integration tests) + `TestApplications_CvS3KeyAnonymizedAtNullable`; S7 also `TestCreate_DuplicateReturnsAlreadyApplied` (I). ✅
- **S10–S11** (status domain) → `TestParseApplicationStatus` + `TestApplicationStatus_String` (V) + migration status tests (M). ✅
- **S12–S19** (transition matrix) → `TestApplicationStatus_CanTransitionTo` (V) + `TestTransitionApplication_IllegalMatrix` / `_LegalMatrix` (U). ✅
- **S20–S26** (apply endpoint) → `TestApplyJob_*` (U) + handler `_Success201BodyShape` / `_ServerManagedFieldsIgnored` / `_InvalidJobID400` / `_InvalidJSON400` (H) + `TestCreate_PublishedActiveJobSuccess` (I, raw-SQL NULL for S24/S26) + `TestBuildCreateApplicationParams` (A, S25). ✅
- **S27–S29** (identity/no-IDOR) → `TestApplyJob_Success` (U) + `TestApplyJob_UnknownSubReturnsUnknownSubject` + handler `_UnknownSub401` / `_ServerManagedFieldsIgnored`. ✅
- **S30–S37** (atomic gate) → `TestCreate_PublishedActiveJobSuccess` / `_NotApplicable` (table) / `_GateIsAtomicWithInsert` (I). ✅
- **S38–S39** (no double-apply) → `TestCreate_DuplicateReturnsAlreadyApplied` / `_CrossJobAllowed` (I) + `TestMapCreateError` (A) + handler `_AlreadyApplied409` (H). ✅
- **S40–S43** (apply validation) → `TestApplyJob_CoverLetterEmpty/TooLong/Exactly2000` + `TestApplyJob_UnknownSource` (U) + handler `_CoverLetterEmpty400` / `_UnknownSource400`. ✅
- **S44–S45** (apply response) → handler `_Success201BodyShape` (asserts `cv_s3_key`/`anonymized_at` absent). ✅
- **S46–S49** (apply error taxonomy) → handler `_InvalidJSON400` / `_MissingClaims401` / `_NotApplicable404` / `_AlreadyApplied409` + `TestMapCreateError` (A) + `TestCreate_DuplicateReturnsAlreadyApplied` (I). ✅
- **S50–S51** (apply security boundary) → AST guard `TestApplicationsApplyRoute_MountedBehindAuth` + handler `_MissingClaims401` + jobs `TestJobsMount_PublicReadRoutes` (R). ✅
- **S52–S58** (candidate /me list) → `TestListByCandidate_*` (I: S52/S53/S54/S55/S56) + handler `_ItemShapeHasJobSummary` / `_EmptyList200` (H) + `TestListMyApplications_*` (U) + `TestRequireAuth_MountedOnMeRoutes` (R, S57). ✅
- **S59–S60** (candidate DTO shape) → handler `_ItemShapeHasJobSummary`. ✅
- **S61–S66** (recruiter list) → `TestListByJob_*` (I: S61/S66) + handler `_InvalidJobID400` / `_Empty200` / `_ItemShapeHasCandidateSnippet` + `RequireCompanyRole` 401/403 (R). ✅
- **S67–S68** (list same-company invariant) → `TestListByJob_CrossCompany404` / `_NonExistent404` (I) + handler `_CrossCompany404` (H). ✅
- **S69** (list cap) → `TestListByJob_Cap100` (I). ✅
- **S70–S72** (soft-delete asymmetry) → `TestListByJob_SoftDeletedVisible` + `TestGetByID_SoftDeletedJobStillVisible` + `TestCreate_NotApplicable`(soft-deleted) + `TestTransition_SoftDeletedJobStillTransitionable` (I). ✅
- **S73–S77** (recruiter detail) → `TestGetByID_OwnCompany` (I) + handler `_Success200` / `_InvalidJobID400` / `_InvalidAppID400` + `RequireCompanyRole` (R). ✅
- **S78–S80** (detail same-company) → `TestGetByID_CrossCompany404` / `_MismatchedJobID404` / `_NonExistent404` (I) + handler `_CrossCompany404` / `_NonExistent404` (H). ✅
- **S81–S82** (PII minimization) → handler `_CandidateSnippetPII` (H) + `TestToApplicationWithCandidate` (A) + `TestGetByID_OwnCompany` (I, non-vacuous: fixture stores salary=120000 + birth_date, DB probed) + `TestGetByID_CandidateWithoutProfile` (I). ✅
- **S83–S89** (transition endpoint) → `TestTransition_SubmittedToInReview` / `_InReviewToRejected` / `_InReviewToHired` (I) + `TestTransitionApplication_LegalMatrix` (U) + handler `_InvalidJobID400` / `_InvalidAppID400` + `RequireCompanyRole` (R). ✅
- **S90–S97** (transition matrix enforcement) → `TestTransitionApplication_IllegalMatrix` / `_MissingStatus` / `_UnknownStatus` (U) + handler `_IllegalTransition400` / `_MissingStatus400` / `_UnknownStatus400` (H). ✅
- **S98–S99** (lost race) → `TestTransition_LostRaceNotFound` (I: first wins, second 404, re-fetch shows winner). ✅
- **S100–S101** (transition same-company) → `TestTransition_CrossCompany404` (I) + handler `_CrossCompany404`; S101 (non-existent) → `TestGetByID_NonExistent404` (I) + `TestTransitionApplication_GetByIDNotFoundPropagates` (U) + handler `_CrossCompany404` (getByIDErr path — indistinguishable from cross-company by design). ✅
- **S102–S104** (transition error taxonomy) → handler `_InvalidJSON400` / `_LostRace404` / `_CrossCompany404` + `TestMapTransitionError` (A) + `TestTransition_*` (I). ✅
- **S105–S107** (recruiter security boundary) → AST guard `TestApplicationsRecruiterRoute_MountedBehindGates` + `RequireCompanyRole` 401/403 (R) + jobs public-mount regression (R). ✅

---

## 4. D1–D13 compliance (unchanged; re-verified against code)

Production code is untouched by the remediation (`154e9cd` adds only the test file); the
first-run D1–D13 table holds. Spot re-verified:

| Decision | Status | Evidence |
|---|---|---|
| D1 atomic `INSERT … WHERE EXISTS` | ✅ | `queries/applications.sql:29–38` — `INSERT … SELECT … WHERE EXISTS (jobs j JOIN companies c … j.status='published' AND j.deleted_at IS NULL AND c.status='active') RETURNING …`; `status`/`cv_s3_key`/`anonymized_at` not in INSERT. |
| D2 `mapCreateError` ordering | ✅ | `applicationRepository.go` `mapCreateError` — `errors.Is(pgx.ErrNoRows)` BEFORE `errors.As(*pgconn.PgError)`; `23505→ErrAlreadyApplied`, `23503→ErrInvalidApplicationReference`, `23514→ErrInvalidStatusTransition`. |
| D3 `TransitionStatus` guard | ✅ | `queries/applications.sql:114–125` — `UPDATE … SET status=to WHERE a.id AND a.job_id AND a.status=from AND EXISTS(jobs.company_id=company_id) RETURNING …`; no `deleted_at`/`status` filter. |
| D4 `mapTransitionError` | ✅ | `pgx.ErrNoRows→ErrApplicationNotFound`; `23514→ErrInvalidStatusTransition`; no `23503`/`23505`. |
| D5 two-step `ListByJob` | ✅ | `GetJobForApplicationsScope :one` then `ListApplicationsByJob :many`; scope miss → `ErrApplicationNotFound`; empty → non-nil slice. |
| D6 single sentinel + matrix | ✅ | `applicationStatus.go` `CanTransitionTo` 3-edge switch; single `ErrInvalidStatusTransition`. |
| D7 port surface | ✅ | `repositories.ApplicationRepository` — `Create`/`GetByID`/`ListByJob`/`ListByCandidate`/`Transition`. |
| D8 use cases + request-first | ✅ | `transitionApplication.go` required→parse→`GetByID`→matrix→`Transition`; `resolveUserID` single seam. |
| D9 handlers + routes | ✅ | per-method accessor; `With(requireAuth).Post` + `With(requireAuth, requireRecruiter).Route` on ROOT; `/me/applications` inside `/me`. |
| D10 sqlc regen | ✅ | `go tool sqlc generate` idempotent (empty `git diff`). |
| D11 migration §3.8 verbatim | ✅ | `00010_create_applications.sql` matches §3.8 (columns, named CHECKs, plain UNIQUE, both B-tree indexes); `Down = DROP TABLE`. |
| D12 PII-minimized snippet | ✅ | SQL selects only `u.full_name` + `cp.professional_title` + `cp.years_of_experience`; `CandidateSnippetDto` has only 4 fields. |
| D13 narrow `Querier` seam | ✅ | `Querier` (6 methods) + `var _ Querier = (*db.Queries)(nil)` + `var _ repositories.ApplicationRepository = (*ApplicationRepository)(nil)`. |

---

## 5. Commands run (this verification) + output hashes

All from `backend/`.

| Command | Result |
|---|---|
| `go test -count=1 ./...` | ✅ exit 0 — **32** packages `ok`, 0 FAIL (10 `[no test files]`) |
| `go vet ./...` | ✅ exit 0 (empty) |
| `go vet -tags=integration ./internal/features/applications/...` | ✅ exit 0 (integration suite + migration suite compile) |
| `go test -tags=integration -run '^$' ./internal/features/applications/infrastructure/postgres/` | ✅ exit 0 — `ok … [no tests to run]` (binary compiles + links) |
| `go build ./...` | ✅ exit 0 (empty) |
| `gofmt -l internal/features/applications/ cmd/ internal/db/applications.sql.go internal/db/querier.go` | ✅ empty (exit 0) |
| `go tool sqlc generate` | ✅ exit 0, empty `git diff` (idempotent) |

Hashes (computed from captured output):

- `test_output_hash` = `sha256:56b1dba4a77bb2be2a5bebc86f2955d0fd8e9a262c9ec623750bd446894f2d42` (exit 0)
- `build_output_hash` = `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty, exit 0)
- `go vet ./...` / `go vet -tags=integration` output hash = `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty)

Live `make test-integration` remains **parent-owned** (per task instructions); the integration
suite is authored to skip cleanly when `DATABASE_URL` is unset and to fail loudly when the
migrations are not applied (`requireApplicationsSchema`).

---

## 6. Strict TDD compliance

- **Evidence present.** `apply-progress.md` carries the "TDD Cycle Evidence" table. As in the first
  run, it details only Commit A in tabular form; B–G have prose/per-task RED/GREEN markers. The
  remediation commit (`154e9cd`) is test-only for already-authored SQL (Commit D) — the accepted
  deferred-RED pattern where RED and GREEN coincide for SQL integration (tasks.md Commit E note).
  **WARNING (carried over):** the table remains Commit-A-only.
- **Test files cross-referenced.** All reported unit/handler/AST/migration/adapter test files now
  exist; `applicationRepository_integration_test.go` is present with 29 `func Test…` symbols.
  Total postgres-package test functions = 49 (8 migration + 12 adapter-unit incl. 4 `TestListByJob_Scope*`/
  `TestMap*` + 29 adapter-integration). No duplicate symbols.
- **RED-first ordering.** Verified for what exists (commits A–G); remediation is deferred-RED SQL
  (consistent with precedent). No fabricated evidence remains: the 5.2 checkbox now has a real file.

### Assertion quality (new integration suite)

No tautologies, no ghost loops, no smoke/type-only assertions, no implementation-detail coupling:

- `TestGetByID_OwnCompany` **probes the DB that salary=120000 + birth_date are actually stored**
  before asserting the snippet carries only 4 fields — the PII-absence assertion is non-vacuous.
- `TestCreate_GateIsAtomicWithInsert` asserts a precondition (company `active`) before suspending
  in-transaction and asserting `ErrJobNotApplicable` + no row.
- `TestTransition_*` seed an OLD `updated_at` and assert `After(seedTime)` to prove the write
  advances the timestamp (not just that the status changed).
- `TestListByJob_Cap100` / `TestListByCandidate_Cap100` assert exactly 100 rows, the exact newest
  and oldest in-window IDs, and that the 5 oldest are omitted.
- `TestTransition_LostRaceNotFound` asserts the loser gets `ErrApplicationNotFound` AND the row
  re-reads as the winner's state (S99).

---

## 7. Review workload / PR boundary

- Forecast (tasks.md): Chained PRs recommended = Yes; Chain strategy = `size-exception`;
  Delivery = `single-pr`. The size-exception is explicitly recorded and authorized (status
  `last_reset.reason` cites "size-exception aceptada por maintainer").
- Ledger: apply attempt (ordinal 1) `passed`, `changed_lines: 6362`, `changed_line_budget_exceeded: true`;
  remediation attempt (ordinal 3) `passed`, `changed_lines: 1284`, bound to the FAIL's evidence
  revision `sha256:acff2580…` via `remediates_evidence_revision`. Current re-verify is attempt
  ordinal 4 (`outcome: running`), `next_action: finish`, `decision_required: false`.
- Scope boundary held: `git diff --stat 66175ea~1..HEAD` (33 files, +7095) touches only the
  applications feature, `db/queries/applications.sql`, sqlc regen, migration `00010`, and
  `cmd/api/`. Jobs/candidates/company-membership/identity ports untouched. Remediation commit adds
  exactly one file (the integration test). No scope creep.

---

## 8. Structured status / actionContext findings

- Store `openspec`; change `applications`; `changeRoot: openspec/changes/applications`; next action
  was `verify` (performed).
- Attempt token confirmed `sha256:a36d4eb50e1425bbf8e84f0eeeff8c6292be885f64a3ba53470693d329388058`.
- Remediation settled complete: ordinal 3 `passed`, `remediates_evidence_revision:
  sha256:acff25807f8d451411591e12c4616016517fcd3b244a8d0436c8fcecc9e98839` (the first-run FAIL's
  evidence revision) — the remediation-evidence-revision binding is satisfied.
- `actionContext.mode` is not `workspace-planning`; the repo is the authoritative workspace; no
  `allowedEditRoots` ambiguity for a verify phase.
- `design.md`, `proposal.md`, `specs/`, `verify-report.md` remain untracked in git (same as prior
  changes); `tasks.md` + `apply-progress.md` are tracked. Not a verify blocker.

---

## 9. Deviations / warnings / observations

**CRITICAL (blocker):** none.

**Warnings (non-blocking, carried over from the first run unless noted):**

1. **AST guard naming drift.** tasks/design §7 name `TestApplicationApply_BehindRequireAuth` /
   `TestApplicationRoutes_AllRecruiterGated`; actual guards are `TestApplicationsApplyRoute_MountedBehindAuth`
   / `TestApplicationsRecruiterRoute_MountedBehindGates`.
2. **AST guards weaker than specified.** Apply guard asserts `requireAuth` present but does **not**
   assert `requireRecruiter` absent; recruiter guard does **not** inspect the `Route` callback
   FuncLit for `Get`/`Patch` declarations (design §7 items 51–52 require both).
3. **TDD evidence table incomplete.** "TDD Cycle Evidence" table covers only Commit A; B–G +
   remediation are prose/per-task.
4. **Test scaffolding in production files.** `applyToJob.go` / `applicationService.go` carry
   test-only sentinel aliases/wrappers (`sentinel*`, `transitionRequestDtoFromStatus`,
   `entities_ErrApplicationNotFound`, …) that belong in `_test.go`.
5. **Minor mapper/comment drift.** `toApplicationFromFields` maps `source` via a switch (not
   `ParseApplicationSource`) while its comment says "reconstructed via Parse*"; `Querier` declares
   `GetJobForApplicationsScope … (uuid.UUID, error)` (scalar) vs design §5.7's `Row` sketch —
   functionally fine.
6. **Cover-letter error bodies.** Classifier emits `"cover_letter must not be empty"` /
   `"cover_letter must be at most 2000 characters"` — the design-pinned resolution of the spec's
   `<cover_letter_empty or cover_letter_too_long>` placeholder; not a defect.
7. **(New, doc-level)** `apply-progress.md` "Commits landed" Commit E still reads
   "(Phase 5: tasks 5.1–5.2)" and the commit message says "migration + adapter", but the adapter
   suite landed in the remediation commit `154e9cd`, not `71a0f1d`. The 5.2 checkbox is now
   truthful (real file), but the historical commit-grouping prose is not retroactively corrected.
8. **(New, trivial)** `TestListByJob_WithRowsDescOrder` comment says "The newest row belongs to
   userC1 (has a profile)" but the code correctly checks `got[2]` (the *oldest* row, which is
   userC1). Assertion is correct; only the comment is off by ordering.

---

## 10. Exact blockers

None. The first-run CRITICAL (missing adapter SQL integration suite, 23/107 uncovered) is resolved
by `applicationRepository_integration_test.go` (`154e9cd`), verified green (unit), compiled under
`-tags=integration`, with no shadowing of existing tests. All 107 scenarios now have coverage;
D1–D13 honored; archive/sync is no longer blocked by a completeness or fabrication defect.
