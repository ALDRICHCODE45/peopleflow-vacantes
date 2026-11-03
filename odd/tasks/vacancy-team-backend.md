# Vacancy team backend («Asignación de la vacante»)

Backend half of the frontend `feat/vacancy-team` over the agreed contract `docs/contracts/vacancy-team-v1.md`
(commit 56d7dacb). Branch `feat/vacancy-team-backend` from `docs/vacancy-team-contract` 2956603d; no merge to main
(user). High risk: destructive migration (item 1), access guard (item 2), breaking API contract (item 3), concurrency (item 4).

## Specs

- S1 — Data model and migration 00054: contract §«Data model (migration 00054)» verbatim, including «Migration steps:
  create the tables; backfill one `vacancy_teams` row per draft (`mode = 'with_responsible'`) and one tramo (with an open
  `responsible` function period) for its `principal_recruiter_id` (…); drop `job_drafts.principal_recruiter_id`. Down is
  not supported (disposable data): it fails with a clear message.»
- S2 — Access, contract §«Access (replaces owner-OR-principal)»: «the company owner, or an active tramo on this vacancy's
  team», same two choke points (`authorized`, `visibleV2Drafts`), same 404 collapse; «Lost access (v1): … the 404 carries
  code `team_access_ended`». Draft creation: «a new vacancy is created with `mode = with_responsible` and its creator as
  the `responsible`, in the same transaction as the draft creation.»
- S3 — Reads: contract §«`GET V/team`» (body with `viewer.can`, `ETag` header) and §«`GET V/team/history?cursor=`»
  («All tramos (continuous stays …), each with its `functions[]` …, plus reassignments … and mode changes, newest first,
  cursor-paginated»). Member picker uses the existing `GET /v2/me/company/members` (no change).
- S4 — Team writes: contract §«Team and modes», §«Team actions» table, and endpoints `POST V/team/members`,
  `…/remove`, `POST V/team/leave`, `PATCH V/team/members/{user_id}`, `POST V/team/reassign-responsible`, `PUT V/team/mode`,
  with their exact error codes; «A tramo is a continuous stay»; If-Match + Idempotency-Key rules of §«Endpoints».
- S5 — Breaking changes: contract §«Breaking changes to existing responses» (draft list/read `team`), §«Deadlines»
  (commitment 409 `commitment_change_requires_renegotiation` after publication), §«`POST V/commitment`», §«Delivery
  config ETag», §«Placement exit» (`placement_exit_reason` replaces `confirm_placement_exit` on moves and discard).
- S6 — Placement credit: contract §«Placement credit (Q4, Q6)», §«Reading placement credits», §«void and /restore».
- S7 — Offboarding: contract §«Company member removal (Q5)», §«offboard-preview», §«offboard».
- S8 — Own history: contract §«`GET /v2/me/vacancy-assignments/history?cursor=`» and §«Delivered in a tramo (Q9)».
- S9 — Audit: contract §«Audit events» table, same transaction, IDs and codes only, `company_id` in metadata.
- S10 — Frontend asks (L1): branch name, a ping with the commit SHA per slice, slices in order 1) reads 2) writes
  3) breaking changes 4) credits + offboard + own history; send any contract diff before committing it; confirm local
  PEM auth mode for QA.

## Tasks

- [x] T1 — S1, S2, S3, S9 (team created): migration 00054 + store + access predicate + `team_access_ended` + GET team
  and history. Route: worker. Commit: efa6c361 (docs 55d4fc9a). Verify: PARTIAL→gaps closed (L6–L7).
- [ ] T2 — S4, S9: team writes, reassign, mode. Route: worker. Commit: —
- [ ] T3 — S5, S9: draft list/read `team`, `placement_exit_reason`, commitment 409 + `POST commitment`. Route: worker.
  Commit: —
- [ ] T4 — S6, S9: placement credits (write on hire/exit, reads, void/restore). Route: worker. Commit: —
- [ ] T5 — S7, S9: offboard-preview, offboard, DELETE member 409. Route: worker. Commit: —
- [ ] T6 — S8: own tramo history. Route: worker. Commit: —
- [ ] T7 — S10: QA environment (API + PEM) and final ping. Route: inline. Commit: —

## Log

- L1 — User via the frontend session (2026-11-02, verbatim): «el backend no esta haciendo nada, coordinate con el para
  comenzar a implementar los dos en cuanto sea posible.» Frontend request: «Please start the backend implementation
  (migration 00054 + endpoints) on your own feat branch. Useful to me, in this order: 1) GET V/team + GET V/team/history
  + the members list, so I can integrate early. 2) Team writes + reassign + mode. 3) The breaking changes (draft
  list/read team, move/discard placement_exit_reason, delivery commitment 409 + POST commitment). 4) Placement credits +
  offboard + own history. Tell me your branch name and ping me when each slice is on it (commit SHA), and whether the
  local PEM auth mode from saved vacancies still applies for QA. If the contract changes while you implement, send me
  the diff before you commit it.»
- L2 — T1 worker stopped: «The contract specifies "All tramos … plus reassignments … and mode changes, newest first,
  cursor-paginated" but defines no response envelope, mixed-item shape, or mode-change fields.» Parent amended the
  contract (uncommitted): table `vacancy_team_mode_changes` + the history timeline shape; diff sent to the frontend for OK
  before commit; worker resumed on the full T1 scope (task mvzsjxj6-3-hlqk).
- L3 — T1 worker asked to edit the shared migration harness (`migrations_test.go`) because 00054's Down was unsupported.
  Parent declined and chose a guarded, reversible Down instead (pattern 00053/00034); contract sentence amended
  (backend-internal), frontend informed. Approved `backend/internal/shared/httpjson/**` for the error catalog
  (`team_access_ended`). Worker task mvzsu4iz-5-n50c.
- L4 — Frontend asked for a QA API for the fixture-backed «Configuración › Equipo» prototype. Started from MAIN cf688633
  (detached worktree `.scratch/api-main`, binary `.scratch/qa-api-bin`) on 127.0.0.1:8080 with the usual .env (Cognito
  mode); dev DB stays at version 53. PID `.scratch/qa-api/api.pid` (61360), log `.scratch/qa-api/api.log`. To clean up
  when the user is done: kill the PID, `git worktree remove .scratch/api-main`, delete the binary.
- L5 — Docker Desktop hung (CLI unresponsive), which stalled the T1 worker twice; the user restarted it. Disposable test DB:
  container `pf-draft-test` (127.0.0.1:55432, password in `.scratch/draft_test.pw`). T1 checks (17 min): gofmt/vet/build
  clean; unit green except the pre-existing `scripts/closure/gate` line 44 failure (ROADMAP). Integration: 00031 test
  runs current store code against schema 30 (real T1 defect), draftstore 10-min timeout, two cmd/api tests order-dependent
  (pass alone). A main-vs-branch comparison on the same DB was invalid (shared draft_test already at 54). Fix delegated
  (task mw01vavk-7-7f25).
- L6 — Integration fixed (00031 fixture writes before downgrade; blockingAudit released only one of the two creation
  audit events). Full integration green; unit green except pre-existing scripts/closure. Independent verify
  (mw02hhjs-9-naf2): PARTIAL, no product defect; S3 PASS; S1/S2/S9 coverage gaps (Down refusal branches, write surfaces,
  replay cardinality, audit-failure rollback, stale comments/models.go). Gap closure delegated (worker) before commit.
- L7 — Gaps closed (worker mw039pm9-a-52xl): access on write surfaces, 00054 Down refusal branches, creation replay
  cardinality and audit-failure rollback; models.go regenerated with sqlc; no product defect. Only full-run failure:
  `TestPublicGeoSearchIndexCapability` state/municipality (planner picks `vacancy_public_company_idx`). Isolation proof:
  fails on the branch against the accumulated shared draft_test DB, PASSES on a fresh schema on BOTH main and the branch
  → pre-existing data-dependent planner assertion, not T1. Recorded in docs/ROADMAP.md.
- L8 — Frontend (2026-11-03): user approved the «Configuración › Equipo» prototype (frontend fc24f4ae). Frontend T3/T5/T6
  wait on slices 1 and 3 → backend does T3 next, then T2, T4, T5, T6. Frontend asked for `kind` in snapshot
  `stage_counts`; contract diff proposed (uncommitted until their OK).
