# Archive Report — `jobs` (vacantes)

**Status**: DELIVERED
**Archived**: 2026-08-19
**Source**: `openspec/changes/jobs/`
**Target**: `openspec/changes/archive/2026-08-19-jobs/`
**Branch**: `feature/jobs`
**Final commit**: `ff5c04b0e57bc259a54eaae54397c6e9e7124982` (`ff5c04b`)
**Cycle**: complete — explore → propose → spec → design → tasks → apply → verify → archive

---

## Final State (per Final-State Authority hierarchy)

Highest-ranked sources for these facts: native review authority (none discovered — `reviewGate` structurally absent), the persisted tasks artifact, explicit final-state facts in the orchestrator launch prompt, and the post-apply gate context (`verify-report.md`). Independent repository evidence was gathered for every claim that the launch prompt asserted beyond the snapshots.

| Surface | Status | Evidence |
|---|---|---|
| `tasks.md` completion | 30/30 `[x]`, 0 unchecked (after reconciliation — see Task Completion Gate) | `openspec/changes/archive/2026-08-19-jobs/tasks.md` |
| `verify-report.md` verdict | PASS WITH WARNINGS | `openspec/changes/archive/2026-08-19-jobs/verify-report.md` |
| Critical issues | 0 | `verify-report.md` §Issues Found |
| Blockers | 0 | `verify-report.md` frontmatter `blockers: 0` |
| Requirements covered | 8/8 | `verify-report.md` §Spec Compliance Matrix |
| Scenarios covered | 29/29 (29 COMPLIANT · 0 PARTIAL · 0 DIVERGENT · 0 UNTESTED) | `verify-report.md` §Spec Compliance Matrix |
| Build / vet / gofmt | `go build ./...` exit 0 · `go vet ./...` exit 0 · `gofmt -l .` empty | re-confirmed at archive time |
| Unit tests | exit 0 — all 7 `features/jobs/**` packages `ok` | re-confirmed at archive time |
| Integration tests | exit 0 — 27/27 packages `ok` serial (`-p 1`); jobs postgres package 26/26 functions green, none skipped | `verify-report.md` §Build & Tests Execution |
| `reviewGate` | structurally absent (kill switch off; no review ever discovered for this candidate) | orchestrator launch prompt; no `review/` artifacts in the change |
| Active change folder | `openspec/changes/jobs/` removed | post-archive `ls openspec/changes/` |

### Evidence revision vs. final commit

The `verify-report` records `evidence_revision` at `6ca6e22` (last **code** commit — the REQ-04 status-default integration test). `ff5c04b` (HEAD, the final commit) touches **only** `openspec/changes/jobs/verify-report.md` (`1 file changed`, verified via `git show --stat`). No code landed after the verification evidence was captured, so the verify verdict describes the delivered tree exactly. The two refs are consistent, not contradictory.

### Contradictions

None unrankable. The launch prompt's final-state facts, the persisted `verify-report`, and independent repository evidence agree on every point. The one stale claim in a lower-ranked snapshot (`verify-report` WARNING-2, "`tasks.md` is stale") was **true when written** and has since been remediated during this archive phase — it is reported below as resolved, not echoed as a current defect.

---

## Delivered Scope

Public-read job board slice. Hexagonal vertical slice under `backend/internal/features/jobs/`, mirroring the `companies` reference slice.

| Layer | Delivered |
|---|---|
| Migrations | `00007_jobs.sql` (table, 4 named CHECKs, STORED generated `search_vector`, GIN + B-tree + partial indexes, reversible `down`), `00008_jobs_seed.sql` (dev seed: 3 active companies + 6 published jobs, fixed UUIDs, `ON CONFLICT DO NOTHING`, idempotent) |
| sqlc | `backend/db/queries/jobs.sql` — `SearchJobs :many` (explicit columns, JOIN `companies`, `ts_rank(...) AS search_rank`, 3-tuple keyset, `LIMIT @limit + 1`) + `GetJobByID :one` |
| Domain | 5 value objects (`workMode`, `employmentType`, `seniority`, `jobStatus`, `salaryCurrency`), `Job` entity, `CompanyRef`, `ErrJobNotFound`, `JobRepository` port (`Search`/`GetByID` + `SearchParams`) |
| Application | opaque cursor codec (`base64url(JSON)`; `{t,i}` browse / `{r,t,i}` search), `SearchJobs` + `GetJobByID` use cases, `JobService`, DTOs (`SearchJobsItem`/`SearchJobsResult`/`CompanyDto`) |
| Infrastructure | postgres adapter (`var _ repositories.JobRepository = (*JobRepository)(nil)`, `toEntity`, `mapGetError`), public HTTP handler (`GET /` + `GET /{id}`, `classifyError` → 404/500) |
| Wiring | `r.Mount("/jobs", jobHandler.Routes())` in `backend/cmd/api/main.go`, mounted **outside** the `/me` `RequireAuth` subtree (public by spec) |

Read-side visibility rule is enforced **in SQL** on both paths: `j.status='published' AND j.deleted_at IS NULL AND c.status='active'`.

---

## Corrections Applied During Apply

Three defects were caught and fixed while implementing, before verification.

| # | Defect | Fix | Evidence |
|---|---|---|---|
| 1 | **Keyset/order mismatch** — query ordered by `ts_rank DESC` first but paginated on a 2-tuple `(published_at, id)`; rows would be skipped or duplicated whenever rank changed across pages | Unified **3-tuple** keyset `(ts_rank, published_at, id)` matching the `ORDER BY` exactly; browse mode degenerates safely because `ts_rank` against an empty tsquery is `0` for every row | `backend/db/queries/jobs.sql` (`search_rank` in SELECT + 3-tuple predicate + `ORDER BY search_rank DESC, j.published_at DESC, j.id DESC`); `design.md` §Keyset Predicate (Decision 3) carries the correction note; spec REQ-07 documents the 3-tuple |
| 2 | **Cursor off-by-one** — cursor anchored on the `limit+1` sentinel row, so the first row of each next page was skipped | Anchor on the **last visible row** of the page (`anchor := rows[pageLimit-1]`) | `application/usecases/searchJobs.go:75`; proven by `TestKeysetPagination_BrowseModeVisitsEveryRowExactlyOnce` and `..._SearchModeVisitsEveryRowExactlyOnce` (every row returned exactly once, no duplicates, no gaps) |
| 3 | **DTOs missing JSON tags** — Go field names would have leaked into the wire format as PascalCase | snake_case `json:` tags on every DTO field | `application/dtos/searchJobsDto.go` — `work_mode`, `employment_type`, `seniority`, `salary_min`, `salary_max`, `salary_currency`, `published_at`, `next_cursor`, `company` |

---

## Remediations Applied During Verify

Verification opened three CRITICALs; all three were remediated and re-verified with runtime evidence before this archive.

| # | CRITICAL | Remediation | Commit |
|---|---|---|---|
| 1 | **Invalid enum filter values were not ignored**, violating REQ-06 "invalid filter value is ignored" | Every closed-set filter runs through its value-object `Parse*` via a generic `optEnum` helper; an out-of-domain value returns `nil`, so the SQL predicate degenerates to TRUE (ignored, unfiltered — never a 400) | `9711470` |
| 2 | **Read-path SQL had no runtime coverage** — visibility, keyset, FTS weighting, and filters were only plumbing-tested | `jobRepository_integration_test.go` — 13 integration test functions against live Postgres covering visibility (all 4 hidden classes), keyset walks (browse + search + rank ties + past-end), FTS ranking, filters, and company hydration; mutation-proven | `9711470` |
| 3 | **REQ-04 "default insert produces a draft" was UNTESTED** | `TestJobsMigrationStatusDefaultsToDraft` inserts a row without an explicit `status` and asserts the read-back value is `'draft'` (behavioral value assertion, not a smoke test) | `6ca6e22` |

Post-remediation: 0 CRITICAL, 0 blockers, 29/29 scenarios covered by tests that passed at runtime.

---

## Deferrals (carried forward — NOT delivered)

This slice is **read-only by design**. The following are explicitly out of scope and remain open for future changes:

1. **Write side** — `POST /jobs`, `PUT /jobs/{id}`, and the publish/close transition flow. The full status domain (`draft → published → closed`) is modeled in the schema, but no endpoint mutates it.
2. **`company_members` ownership slice** — prerequisite for any write path; without it there is no authorization model for "who may edit this job".
3. **Write-side "active company" enforcement** — the `companies.status='active'` rule is enforced on **read** only. The equivalent guard on write ships with the write side.
4. **Recruiter subtree** — recruiter-facing routes and the recruiter role surface.
5. **Frontend job board** — no UI in this slice; the API is the deliverable.
6. **Production seed strategy** — `00008_jobs_seed.sql` is a **dev-only convenience** (6 published jobs, fixed UUIDs, idempotent). It is explicitly NOT a runtime requirement and NOT a production seeding plan.
7. **Currency FX conversion** — the `currency` filter matches `salary_currency` **exactly**; both `'USD'` and `'MXN'` are first-class. Cross-currency conversion needs an external rate source and is deferred.

A defensive guard was left in place for the deferred write path: `CHECK (status <> 'published' OR published_at IS NOT NULL)` prevents a future `POST /jobs` from publishing without setting `published_at` atomically.

---

## Specs Synced

| Domain | Main spec before | Action | Main spec after |
|---|---|---|---|
| `jobs` | did not exist | **Created** (mechanical `cp` + `mv` — see Mechanical Evidence) | `openspec/specs/jobs/spec.md` |

The delta contained **8 requirements, all under `## ADDED Requirements`** — **no REMOVED and no RENAMED requirements**. Per `rules.archive` ("warn before merging destructive deltas"), **no destructive-delta warning was required**: nothing was deleted or rewritten in `openspec/specs/`, and no pre-existing main spec was touched.

Because `openspec/specs/jobs/spec.md` did not exist, the delta spec **is** the full capability spec and was copied byte-for-byte. The `## ADDED Requirements` heading is preserved verbatim, matching the existing precedent in `openspec/specs/identity/spec.md` (also a synced spec that retains that heading).

Requirements now in the source of truth: Public Read Endpoints · Read-Side Visibility Rule · Jobs Schema Migration · Status Domain · Full-Text Search · Listing Filters · Keyset Pagination · Enum Invariants.

REQ-07 (Keyset Pagination) documents the **corrected 3-tuple** `(ts_rank, published_at, id)` and its browse-mode degeneration to `(published_at, id)`, so the source of truth reflects the delivered behavior — not the superseded 2-tuple.

---

## Source of Truth Updated

- `openspec/specs/jobs/spec.md` — new `jobs` capability spec (public-read board: search, filters, keyset pagination, detail; status domain modeled with only `published` exposed).

This file is the source of truth for future verification and for the next change that amends it. `openspec/specs/candidates/spec.md` and `openspec/specs/identity/spec.md` were **not touched** by this archive.

---

## Mechanical Evidence (MANDATORY readback)

Archival is a mechanical filesystem operation. Every copy and move below was performed with a native shell command (`cp` / `mv` / `git mv`) — never Read→Write — and verified by a structural `diff -r`. Empty `diff -r` output is the only passing evidence.

### Step 1 — Create `openspec/specs/jobs/spec.md` (mechanical `cp` → temp → `diff -r` → `mv`)

```
$ cp openspec/changes/jobs/specs/jobs/spec.md <temp>
$ diff -r openspec/changes/jobs/specs/jobs/spec.md <temp>
(no output)              # diff exit=0
$ mv <temp> openspec/specs/jobs/spec.md
$ diff -r openspec/changes/jobs/specs/jobs/spec.md openspec/specs/jobs/spec.md
(no output)              # diff exit=0 — byte-identical

$ sha256sum <both>
103ec5a6a67f8cbd56059e31a2c1d613cbe7a6bab58e43efcee4af38be75edcc  openspec/changes/jobs/specs/jobs/spec.md
103ec5a6a67f8cbd56059e31a2c1d613cbe7a6bab58e43efcee4af38be75edcc  openspec/specs/jobs/spec.md
```

Verbatim `diff -r` output: **empty**. Matching sha256 on both sides independently confirms byte-identity.

### Step 2 — Move to archive (mechanical `git mv`, pre-move recursive snapshot)

```
$ cp -R openspec/changes/jobs /tmp/sdd-archive.BmvuzN/source     # pre-move snapshot
SNAP/design.md
SNAP/exploration.md
SNAP/proposal.md
SNAP/specs/jobs/spec.md
SNAP/tasks.md
SNAP/verify-report.md

$ git mv openspec/changes/jobs openspec/changes/archive/2026-08-19-jobs
=== moved via: git mv ===

$ test ! -e openspec/changes/jobs && echo SOURCE_GONE
SOURCE_GONE

$ diff -r /tmp/sdd-archive.BmvuzN/source openspec/changes/archive/2026-08-19-jobs
(no output)              # diff exit=0 — byte-identical
```

Verbatim `diff -r` output: **empty** — the archived tree is byte-identical to the pre-move recursive snapshot. `archive-report.md` (this file) was not present in the snapshot; it is additive and written post-move, so it is correctly excluded from the comparison per the Mechanical Copy Contract. The snapshot directory was removed by the shell `EXIT` trap.

Git recorded the move as renames (`R`) for all six artifacts, with `tasks.md` as `RM` (renamed + modified — the checkbox reconciliation below).

---

## Task Completion Gate — exceptional reconciliation performed

**Reason recorded per the Task Completion Gate contract.** On entry, `tasks.md` had **19 unchecked `- [ ]` task lines** (phases 4–8) for work that was already committed. This is the exact stale-checkbox condition the gate covers, and it was a known, explicitly non-blocking condition:

- The orchestrator launch prompt asserts implementation is **complete and committed** at `ff5c04b` and names `tasks.md` staleness as one of the two non-blocking warnings.
- `verify-report.md` §Completeness states it directly: *"the 19 unchecked tasks correspond to work that is actually committed (git WU3/WU4/WU5 commits + all source/test files present). The `tasks.md` checkbox state is stale, not the code."*

Because the archived audit trail MUST NOT contain stale unchecked tasks for completed work, the checkboxes were reconciled **before** the archive move — but only after independently proving each one at the repository level, not on assertion alone:

| Phase | Lines | Independent proof gathered at archive time |
|---|---|---|
| 4 — Domain VOs | 5 | All 10 files present (`workMode`, `employmentType`, `seniority`, `jobStatus`, `salaryCurrency` × impl+test); `ErrInvalidJobStatus` present; USD/MXN present in `salaryCurrency.go` |
| 5 — Entity + port | 4 | `job.go` (`CompanyRef` @27, `ErrJobNotFound` @22), `job_test.go`, `jobRepository.go` port (`Search` @71, `GetByID` @72, `SearchParams` @46), `jobRepository_test.go` |
| 6 — Application | 5 | `cursor.go` (`{t,i,r?}` tags @22-24) + test, `jobService.go`, `searchJobs.go` + test, `getJobByID.go` + test, `dtos/searchJobsDto.go` |
| 7 — Postgres adapter | 3 | `jobs.sql` carries `ts_rank(...) AS search_rank` @56-59 and the 3-tuple keyset @78-85 with `ORDER BY search_rank DESC` @87 (task 7.0 landed); adapter `jobRepository.go` with `var _ repositories.JobRepository = (*JobRepository)(nil)` @40; unit + integration tests present |
| 8 — HTTP handler | 2 | `jobHandler.go` (`Routes()` @48, `classifyError` @134), `handler_test.go` |
| **Cross-cutting** | — | `go build ./...` exit 0 · `go vet ./...` exit 0 · `go test ./... -count=1` exit 0 with all 7 `features/jobs/**` packages `ok` · `git status` clean |

The reconciliation was mechanical and auditable: a checkbox-only substitution anchored to task numbers 4–8, verified by `git diff`, which shows **only** `- [ ]` → `- [x]` on exactly those 19 lines and **no other character changed** in the file. Post-reconciliation: `grep -c '^- \[ \]'` → **0**.

`tasks.md` now reads 30/30 complete, which matches the delivered tree. `verify-report.md` WARNING-2 is therefore **resolved by this phase** and is retained in the archive as historical record of the condition at verification time.

---

## Review Receipt Gate

`reviewGate` is **structurally absent** — the receipt-driven review kill switch is off for this candidate and no review was ever discovered. Per the Native Review Receipt Gate contract this is **not a defect** and not grounds to demand a receipt: archive proceeds under ordinary repository policy. No `review/{transaction,ledger,receipt,gate-context}` artifacts exist for this change; none were read, and none needed to be.

---

## Outstanding Warnings (non-blocking; do not affect archive eligibility)

Recorded so a future reader does not mistake them for defects requiring rework on `jobs`.

1. **Integration suite is flaky — pre-existing and `jobs`-unrelated.** A full parallel `go test -tags=integration ./...` races: `identity/.../00005_integration_test.go` runs a down-migration that `DROP`s `users` / `candidate_profiles` / `candidate_languages` concurrently with `candidates` package reads. `feature/jobs` touches no `candidates` or `identity` code, and the jobs integration tests pass in every mode. Serial (`-p 1`) passes 27/27, exit 0. **Suggested follow-up**: run integration serially in CI, or isolate with per-package schemas/transactions.
2. **No `apply-progress` artifact was persisted** under `openspec/changes/jobs/`. TDD compliance scored 5/6 for this reason alone. RED-first test files exist for every layer and all GREEN results are reproducible in the present tree, so the substance is evidenced — only the intermediate snapshot is missing. Non-blocking; noted for process hygiene on the next change.
3. **Documented supersession in `proposal.md`.** §Decisions (resolved 2026-08-19) item 2 still reads *"Pagination: keyset on `(published_at, id)`"* — the pre-correction 2-tuple. That decision was **superseded** during apply by the unified 3-tuple `(ts_rank, published_at, id)` (see Corrections #1). `design.md` §Decision 3 and spec REQ-07 both carry the corrected 3-tuple, and the delivered SQL implements it. The proposal was deliberately **not rewritten**: archived artifacts are an immutable audit trail, so the supersession is recorded here instead. The synced source of truth (`openspec/specs/jobs/spec.md`) is correct.

---

## Phase Result

- Status: **success — DELIVERED**
- Specs synced: **1 created** (`jobs`); 0 updated; 0 destructive deltas (no REMOVED/RENAMED → no warning required).
- Archive folder: `openspec/changes/archive/2026-08-19-jobs/` (6 artifacts + this report).
- Source folder gone from active `openspec/changes/`.
- All mechanical copy/move operations verified by empty `diff -r` readback; spec copy additionally confirmed by matching sha256.
- Task Completion Gate: **passed after documented exceptional reconciliation** (19 stale checkboxes flipped, each independently proven; `git diff` confirms checkbox-only change). Now 30/30, 0 unchecked.
- Review Receipt Gate: not applicable (`reviewGate` structurally absent; no review discovered).
- 0 CRITICAL, 0 blockers. 8/8 requirements, 29/29 scenarios, verdict PASS WITH WARNINGS.
- Existing archive entries (`2026-08-19-candidates`, `2026-08-19-identity`) untouched, per `rules.archive`.

**SDD cycle complete** for `jobs`. Ready for the next change — the natural successor is the `company_members` ownership slice, which unblocks the deferred write side.
