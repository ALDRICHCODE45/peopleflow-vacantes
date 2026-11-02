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

- [ ] T1 — S1, S2, S3, S9 (team created): migration 00054 + store + access predicate + `team_access_ended` + GET team
  and history. Route: worker. Commit: —
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
