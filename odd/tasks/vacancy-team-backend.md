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
- [x] T2 — S4, S9: team writes, reassign, mode. Route: worker. Commit: 0d0f6f55. Verify: FAIL (3) → fixed (L12–L13).
- [x] T3 — S5, S9: draft list/read `team`, `placement_exit_reason`, commitment 409 + `POST commitment`. Route: worker.
  Commit: 45135cd8.
- [x] T4 — S6, S9: placement credits (write on hire/exit, reads, void/restore). Route: worker. Commit: 744b9b7f. Verify: PASS + episode fix (L15–L16).
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
- L9 — Frontend OK to `kind` in stage_counts (committed 285395c8) and to the order T3 → T2 → T4/T5/T6. Branch QA API for
  frontend integration: :8081 from detached worktree `.scratch/api-team` @ 285395c8 (binaries `.scratch/qa-api-team-bin`,
  `.scratch/qa-migrate-team-bin`), DB `peopleflow_vacancies_team` (copy of the dev DB via in-container pg_dump, migrated to
  54; 12 drafts → 12 teams), PID `.scratch/qa-api-team/api.pid`, log `.scratch/qa-api-team/api.log`. :8080 stays on main.
  Cleanup later: kill PID, `git worktree remove .scratch/api-team`, `DROP DATABASE peopleflow_vacancies_team`.
- L10 — T3 done (45135cd8): contract corrections e665c068 (real v2 key `principal_recruiter_id`, option A: team on
  GET/create/save, frozen replays unchanged) and 9bc2a080 (members routes under `/me`, no `/v2`). Full integration green,
  unit green except the pre-existing scripts/closure. Placement exit reason validated and threaded to the store, persisted
  in T4. Advisory: v1 draft responses still expose `principal_recruiter_id` from the open responsible and emit the zero
  UUID when there is none (possible only after T2 adds shared mode).
- L11 — T2 worker found a T1 defect (lock-wait access race): `readDraft` evaluated the active-tramo EXISTS in the same
  SELECT that waited on `FOR UPDATE`; under READ COMMITTED the re-check after the wait covers only the locked row, so a
  just-removed collaborator got 403 instead of 404 `team_access_ended`. Fix: take the draft row lock in a separate
  statement, then read membership. Pinned by an HTTP access-race test. Shared helper (every vacancy surface) → focus of
  T2's independent verification.
- L12 — T2 independent verify (mw092o2c-f-1kvb): S9 PASS; S4 FAIL on 3 HTTP-reproduced points: leave replay → 404
  (guard before replay lookup); explicit `recruiter_deadline` on an existing target silently ignored; explicit
  `responsible_user_id` when switching to shared silently ignored. Decisions: leave replay looked up before the team
  guard (same caller/key/draft, still a company member); the other two → 422 `recruiter_deadline_not_applicable` /
  `responsible_not_applicable`. Contract diff sent to the frontend; fix delegated. Verifier scratch (940M) removed by the
  parent.
- L13 — T2 fixes done (0d0f6f55): leave replay before the team guard (same caller/key/draft, behind the company gates),
  422 `recruiter_deadline_not_applicable` / `responsible_not_applicable`, concurrent mode vs add/remove test; contract
  82a1cdac (frontend OK). Final full integration: 48 packages ok, 0 FAIL (log `.scratch/t2-integration.log`). Advisory:
  one intermediate full run failed draftstore with its test name lost to `tail`; it did not reproduce alone or in the
  final full run — watch for an order-dependent draftstore flake.
- L14 — Frontend QA: seeded 3 recruiter members into «Trust People Company» in `peopleflow_vacancies_team` only (Ana
  López, Diego Hernández, Mariana Ruiz; emails `*.qa@peopleflow.test`, cognito_sub `qa-seed-…`, cannot sign in). The dev
  DB of :8080 is untouched.
- L15 — T4 independent verify (mw0brsck-i-vtd3): S6 PASS on the literal contract, S9 PASS; concurrency void-vs-move
  consistent; legacy audit metadata byte-identical. Advisory reproduced via HTTP: restoring an older credit after a
  re-hire made it active (restore read the current stage) and the next exit closed only the latest active credit →
  active credit outside placement. Contract fixed with per-credit placement episodes (145f16f0, frontend OK); fix
  delegated to the T4 worker. Verifier scratch (7.5G) removed by the parent.
- L16 — T4 episode fix done (744b9b7f): departures attach to the ending episode's credit whatever its status; restore
  follows the credit's own exit; regression TestPlacementCreditHistoricalRestoreThenExit and an at-most-one-active
  invariant check in teardowns. Full integration 48 ok (log `.scratch/t4-integration.log`).
- L17 — T5 worker stopped on two conflicts. Access: A (company gates untouched; a removed member gets the existing 403;
  team_access_ended only for company members whose tramo ended — the parent's earlier instruction was wrong). Shared:
  a sole member of a shared team is handed over like a responsible (Q5: never orphaned): preview items gain
  `hand_over: responsible | last_member`; offboard response shape defined; new 422 `offboard_reassignment_not_applicable`.
  Contract diff sent to the frontend; worker resumed.
