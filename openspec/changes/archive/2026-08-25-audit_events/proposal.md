# Proposal: `audit_events` — Append-Only Audit Log (applications write paths)

## Intent

Close the deferral the `applications` spec left open: its "Out of scope (deferred)" section explicitly defers *"`audit_events` integration for `ApplicationSubmitted` or `ApplicationTransitioned` (the `audit_events` table has no migration in the repo yet)"*. This cycle creates the append-only `audit_events` table — already designed in `docs/modelo-de-datos-proyecto-04.md` §3.9 — and emits the two application domain events **synchronously, in the same transaction, on the same write path**.

This is a **small, deliberately narrow cut**: only the two `applications` write paths emit events. There is no outbox, no SNS / SQS / EventBridge fan-out, no read surface, and no event emission from the jobs, companies, or identity contexts. The table is append-only: there is no update/delete path on `audit_events` in this slice.

## Scope (first slice)

- **Schema.** Migration `00011_create_audit_events.sql` materializes `docs/modelo-de-datos-proyecto-04.md` §3.9 verbatim: `audit_events` with the `audit_events_actor_type_check` CHECK (`'user' | 'system'`), the `metadata JSONB NOT NULL DEFAULT '{}'` column, and the `audit_events_entity_idx` B-tree index on `(entity_type, entity_id, occurred_at DESC)`. `event_type` is deliberately **not** CHECK-constrained (§1.3 exception — event types grow constantly). No FKs on `actor_id` by design (the audit log survives its actors). No `updated_at`, no `deleted_at`.
- **Synchronous emission, same transaction, same write path.** The `applications` adapter wraps each successful application write (`Create` on apply, `Transition` on status change) in a single `pgx.Tx` together with the audit INSERT. Either both commit or both roll back — an application write can never succeed without its audit event.
- **Event types (closed set for this cycle).** Exactly two:
  - `ApplicationSubmitted` — emitted from `applyToJob` (`POST /jobs/{jobId}/applications`) on a `201`.
  - `ApplicationTransitioned` — emitted from `transitionApplication` (`PATCH /jobs/{jobId}/applications/{id}/transition`) on a `200`.
- **Append-only.** The audit port exposes a single append operation. No UPDATE, no DELETE, no read, no backfill, no mutation path exists in this slice.

### First-slice boundaries

| Belongs in this slice (✅) | Out of scope (explicit non-goals) |
|---|---|
| Migration `00011` (`audit_events` schema, EXACTLY §3.9) | Any `audit_events` read endpoint / query surface (deferred) |
| `InsertAuditEvent` append-only query + adapter | UPDATE / DELETE / backfill / replay of `audit_events` |
| `ApplicationSubmitted` emission on the apply write path | `ApplicationSubmitted` fan-out (SNS / SQS / EventBridge) |
| `ApplicationTransitioned` emission on the transition write path | Event emission from jobs / companies / identity write paths |
| Same-transaction co-write (application + audit) | Outbox pattern / transactional-outbox table |
| New `audit_events` bounded-context domain (entity + port) | Retention / TTL / DynamoDB archival (future architecture note, §3.9) |
| Actor capture (`user` / `system`) for both events | Catalog of all event types (`UserRegistered`, `CompanyCreated`, `JobPublished`, …) — §5 open item, NOT this slice |

## Affected areas

| Path | Operation | Purpose |
|---|---|---|
| `backend/db/migrations/00011_create_audit_events.sql` | NEW | `audit_events` table + `audit_events_entity_idx`; `goose Up` mirrors §3.9 verbatim; `Down` drops the table (clean — no FK references it). |
| `backend/db/queries/audit_events.sql` | NEW | sqlc source for `InsertAuditEvent` (append-only INSERT; no SELECT/UPDATE/DELETE). |
| `backend/internal/db/audit_events.sql.go`, `models.go`, `querier.go` | REGEN | sqlc-generated `InsertAuditEvent` + `AuditEvent` model + `Querier` entry. |
| `backend/internal/features/audit_events/domain/entities/auditEvent.go` | NEW | `AuditEvent` entity + `ActorType` VO (`user`/`system`) + event-type constants (`ApplicationSubmitted`, `ApplicationTransitioned`). |
| `backend/internal/features/audit_events/domain/repositories/auditEventRepository.go` | NEW | Append-only port (`Append` / `Record`) — no read/update/delete methods by construction. |
| `backend/internal/features/audit_events/infrastructure/postgres/auditEventRepository.go` | NEW | sqlc adapter for `InsertAuditEvent` (able to run tx-scoped via `db.New(tx)`). |
| `backend/internal/features/applications/domain/repositories/applicationRepository.go` | MOD | `Create` / `Transition` carry the audit-event intent (or the adapter depends on the audit writer inside the shared tx). |
| `backend/internal/features/applications/application/usecases/applyToJob.go` | MOD | Build the `ApplicationSubmitted` event intent (actor = resolved candidate) after a successful create. |
| `backend/internal/features/applications/application/usecases/transitionApplication.go` | MOD | Build the `ApplicationTransitioned` event intent (actor + `from`/`to`) after a successful transition. |
| `backend/internal/features/applications/infrastructure/postgres/applicationRepository.go` | MOD | Switch from the `*db.Queries`-shaped `Querier` seam to a `*pgxpool.Pool`-owning adapter so `Create`/`Transition` can open a transaction wrapping (application write + audit INSERT); commit/rollback. |
| `backend/internal/features/applications/infrastructure/postgres/*_test.go` | MOD | Unit + integration tests: transaction commit/rollback, event co-emission, no-event-on-error, metadata shape. |
| `backend/cmd/api/main.go` | MOD | Wire the audit adapter + pass the pool into the applications repository (mirrors the candidates / company-bootstrap pool pattern). |
| `openspec/specs/applications/spec.md` | MOD (spec phase) | Lift the `audit_events` deferral; add requirements for event emission on the two write paths. |
| `openspec/specs/audit_events/spec.md` | NEW (spec phase) | New `audit_events` bounded-context spec (append-only invariant + event shape). |

## Rules and invariants

1. **Append-only, structurally.** `audit_events` has no `updated_at` / `deleted_at`, no FK on `actor_id`, and the port exposes only append. The enforcement is *absence of surface*: no UPDATE/DELETE/read query exists in this slice, and the spec pins that invariant.
2. **Same transaction, same write path.** The audit INSERT runs in the same `pgx.Tx` as the application INSERT/UPDATE. No outbox, no queue, no fan-out — the event is written by the same request that performs the write.
3. **Fail-closed co-write (pending Q1).** If the audit INSERT fails, the application write rolls back too. The application row and its audit event are atomic — an application write cannot succeed without its audit trail.
4. **Closed event vocabulary for this cycle.** Only `ApplicationSubmitted` and `ApplicationTransitioned`. The closure is enforced at the use-case layer (no DB CHECK on `event_type`, per §1.3).
5. **Actor identity.** `ApplicationSubmitted` → `actor_type='user'`, `actor_id = candidate users.id` (already resolved by `resolveUserID`). `ApplicationTransitioned` → the acting recruiter (see Q2 — the recruiter `users.id` is not currently threaded into the transition path).
6. **Metadata is minimal and PII-free.** `metadata` JSONB never carries `cover_letter` or any candidate PII. Proposed shape (see Q3): Submitted → `{ "job_id", "source" }`; Transitioned → `{ "job_id", "from_status", "to_status" }`.
7. **No event on a non-write.** A `400` (validation / illegal transition), `404` (gate miss / cross-company / lost race), `409` (already applied), or `401/403` (auth) produces **no** audit row — the application write never happened.
8. **Scope boundary.** The jobs, companies, and identity write paths emit **nothing** this cycle. The `jobs` port, service, handler, and public `/jobs` mount are untouched.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Adapter seam change** — the applications repo moves from a narrow `Querier` (`*db.Queries`) to a pool-owning adapter so it can open a transaction; the existing unit-test seam (no Postgres) no longer fits the tx path. | Reuse the canonical in-repo pool pattern (`candidates.ReplaceLanguagesByUserID`, `companyBootstrapRepository.CreateWithOwner`); cover the tx behavior with integration tests (`-tags=integration`). |
| R2 | **Availability coupling** — fail-closed audit means an unavailable/corrupt `audit_events` table would block application writes. | This is the compliance-correct default (no write without audit); confirm as Q1. Surface the failure as `500 internal server error` with `slog.Error` and roll back, never a silent gap. |
| R3 | **Actor gap on transitions** — `CompanyContext` carries only `company_id` + `role`; the recruiter `users.id` is not threaded to the transition use case. | Decide Q2 (add `UserID` to `CompanyContext` — an additive identity change — vs. `system` actor vs. threading `actorID`). An accurate actor is the default. |
| R4 | **PII leak into `metadata`** — a future edit could copy `cover_letter` or candidate fields into the JSONB. | Build `metadata` from a fixed, minimal field set; a unit test pins the exact metadata keys; `cover_letter` is never passed to the event builder. |
| R5 | **Append-only drift** — a later cycle adds UPDATE/DELETE or a read surface that contradicts the audit invariant. | The port exposes only append; the spec pins "no update/delete path"; no read query exists in this slice. |
| R6 | **Event duplication / spurious events** — concern that a retried or partially-failed request emits two events. | Synchronous same-tx means one event per committed application write; `400/404/409` short-circuit before any write, and a rollback leaves no event. A unit test pins "no event on non-write outcomes". |

## Rollback

- The feature is a new table + a new bounded-context folder; `00011` `Down` drops `audit_events` and its index (clean drop — nothing references `audit_events`).
- `backend/internal/features/audit_events/` deletes as a directory; `backend/db/queries/audit_events.sql` + `backend/internal/db/audit_events.sql.go` are removed and sqlc is regenerated.
- `backend/internal/features/applications/...` reverts by removing the event-intent params, the tx wrapping, and the pool dependency (back to the `Querier` seam); `go test` stays green.
- Because there is no prior `audit_events` data (green table) and the write path only *adds* a co-write, `Down` is a clean drop with no data migration in either direction.
- Defensive partial-deploy guard: if `00011` is up but the API binary is old, the table sits empty (the old binary never writes it); if the API binary is new but `00011` is down, the new co-write fails and rolls back the application write (fail-closed, no silent gap) until the migration lands.

## Success criteria

`goose up` creates `audit_events` with the `audit_events_actor_type_check` CHECK, `metadata JSONB NOT NULL DEFAULT '{}'`, and `audit_events_entity_idx`; `goose down` drops them cleanly. A successful `POST /jobs/{jobId}/applications` inserts exactly one `audit_events` row with `event_type='ApplicationSubmitted'`, `entity_type='application'`, `entity_id = <application.id>`, `actor_type='user'`, `actor_id = <candidate users.id>`, and `metadata` carrying `job_id` (and `source` when present). A successful `PATCH .../transition` inserts exactly one `ApplicationTransitioned` row carrying `from_status`/`to_status` in `metadata` and the acting recruiter as actor.

A `400`/`404`/`409`/`401`/`403` outcome inserts **no** audit row (no write happened). An audit INSERT failure rolls back the application write — the application row is absent AND no event exists (fail-closed). `cd backend && go test ./...` green; `go vet ./...` clean; `go build ./...` clean; `make db-migrate` then `make db-migrate-rollback` round-trips with no other migration affected.

## Open questions

### Proposal question round — RESOLVED (user confirmed)

1. **Fail-closed vs. best-effort audit write.** If the `audit_events` INSERT fails, should the application write roll back too (fail-closed — no write without its audit trail), or should the application write commit and the audit gap be logged (best-effort — application availability over audit completeness)? **DECIDED: fail-closed.** If the audit INSERT fails the application write rolls back too; no write without its audit trail.

2. **Actor identity for `ApplicationTransitioned`.** The transition path today carries only `company_id` + `role` in `CompanyContext`, not the recruiter's `users.id`. Options: (a) add `UserID` to `CompanyContext` (small additive identity change, reuses the already-resolved `user.ID`), (b) record `actor_type='system'` / `actor_id=NULL`, or (c) thread the recruiter `users.id` through the handler+use case. **DECIDED: (a) add `UserID` to `CompanyContext` — accurate recruiter actor, additive identity change.**

3. **What exactly `metadata` captures (business rule).** Confirm the minimal PII-free shape: `ApplicationSubmitted` → `{ job_id, source }`; `ApplicationTransitioned` → `{ job_id, from_status, to_status }`. `cover_letter` and any candidate PII are excluded. **DECIDED: minimal PII-free shape.** `ApplicationSubmitted` → `{ job_id, source }`; `ApplicationTransitioned` → `{ job_id, from_status, to_status }`; `cover_letter` and candidate PII excluded.

4. **Read surface / non-goal.** Is any read endpoint or query surface for `audit_events` in this slice, or is it write-only (read surface deferred to a later cycle)? **DECIDED: write-only, no read surface** (deferred to a later cycle).

5. **Bounded-context seam (design placement).** `audit_events` is its own bounded context (own domain entity + append-only port), but the transaction must be shared with the applications write. Confirm the applications adapter owns the `pgx.Tx` (opening it and writing both the application row and the audit INSERT) rather than introducing a new unit-of-work abstraction. **DECIDED: applications adapter owns the transaction**; no new unit-of-work abstraction.

### Proceed-to-design assumptions (locked unless corrected above)

- The `audit_events` table is `docs/modelo-de-datos-proyecto-04.md` §3.9 verbatim — the schema shape is **not** ambiguous (the user already fixed the small cut).
- Only the two applications write paths emit, synchronously, in the same transaction; no outbox / SNS / SQS / EventBridge.
- Append-only: the port exposes append only; no update/delete/read in this slice.
- No event on non-write outcomes (400/404/409/401/403).
- The jobs, companies, and identity contexts are untouched.
