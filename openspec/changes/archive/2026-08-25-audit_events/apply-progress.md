# Apply progress: `audit_events`

Status: complete (WU1 + WU2 + WU3 applied, all committed, all suites green, all
30 implementation tasks 1.1–4.2 checked; parent-owned post-apply items remain
unresolved at the lifecycle boundary per the `<!-- sdd-owner: parent -->`
marker convention).
Phase: `sdd-apply` (write production code) — closed. Verify-report is already
written (`pass_with_warnings`); sync/archive follow under the parent lifecycle.
Persistence: openspec file artifacts only — no Engram mirror.

## Close signal (apply -> all_done)

The native status engine moves `applyState` from `ready` to `all_done` when
every checkbox in `tasks.md` is `[x]` *or* is a parent-owned paragraph bullet
without a checkbox (matching the `jobs-soft-delete` archive convention).
With this update, all 30 implementation rows under Phases 1–4 (1.1–4.2) are
`[x]`; the two `<!-- sdd-owner: parent -->` post-apply actions are plain bullets
(no `[ ]` checkbox) so the engine does not count them, mirroring the
`openspec/changes/archive/2026-08-25-jobs-soft-delete/tasks.md` precedent.
Result: `gentle-ai sdd-status --cwd . audit_events` reports `apply: all_done`
and `next: archive` (verify already `all_done`; archive `ready`).

The runtime attempt ledger (`gentle-ai sdd-attempt status`) already carries
three `outcome: passed` rows (WU1=638, WU2=541, WU3=1723 chosen lines) with a
maintainer-authorized reset to close the apply phase. Runtime `complete` is
still `false` (`next_action: begin`, ordinal 4 unused) because that flag is
runtime-attempt scoped, not artifact scoped; the parent owns the runtime
`settle`/next-attempt for the post-apply lifecycle.

## Convention note: parent bullets vs. checkboxes

The 4.x implementation tasks (rollback drill, etc.) keep the
`<!-- sdd-owner: implementation -->` marker and a `[x]` checkbox because they
land within the apply phase. The post-apply parent items deliberately drop
the `[ ]` checkbox to keep them out of the engine's implementation count
without losing the `<!-- sdd-owner: parent -->` marker that the contract
expects; once bounded review and archive decision land, the parent converts
those bullets into archive-report entries rather than checkboxes.

Scope (user-decided, small cut): new `audit_events` append-only bounded context
emitting `ApplicationSubmitted` + `ApplicationTransitioned` synchronously
(same transaction as the application write), fail-closed (no write without its
audit trail). No outbox / SNS / SQS / EventBridge, no read surface, no jobs /
companies / identity write-path emission beyond the additive
`CompanyContext.UserID`. Chain: stacked-to-main PR 1 -> PR 2 -> PR 3.

## Work-unit commits

| WU | PR | Commit | Scope | Chosen lines (ledger) |
|----|----|--------|-------|----------------------|
| WU1 | PR 1 | `11e3c0c` | migration 00011 + InsertAuditEvent query + sqlc + Phase E migration tests | 638 |
| WU2 | PR 2 | `979cdea` | `audit_events` BC: entity + ActorType VO + constants + append-only port + postgres adapter | 541 |
| WU3 | PR 3 | `d2a6560` | atomic seam change: pool-owning adapter + co-write tx fail-closed + CompanyContext.UserID + committed-fixture integration migration | 1723 |

All three exceed the 450/420/1300 budgets; each was reset with the maintainer
actor "Aldrich Flores Vazquez" (consolidated pattern).

## Strict TDD evidence (RED first)

### WU1 (PR 1) — schema foundation

| Step | Task | RED evidence | GREEN evidence |
|------|------|--------------|----------------|
| 1.1 | migration_00011_test.go (7 Phase E tests) | `relation "audit_events" does not exist` (42P01) | after `make db-migrate` -> 7/7 PASS |
| 1.3 | auditEventRepository_test.go append-only query guard | `open .../db/queries/audit_events.sql: no such file or directory` | query file exists -> PASS |
| 1.2/1.4 | migration 00011 + query InsertAuditEvent | n/a (paired with RED) | table + query created |
| 1.5 | sqlc regen + build | n/a | sqlc idempotent; build/vet OK |

### WU2 (PR 2) — audit_events bounded context

| Step | Task | RED evidence | GREEN evidence |
|------|------|--------------|----------------|
| 2.1/2.2 | auditEvent_test.go ActorType + closed event vocabulary | `undefined: ActorTypeUser/EventApplicationSubmitted` | 2 tests PASS |
| 2.3 | domain/entities/auditEvent.go (D3) | n/a | entities package green |
| 2.4 | auditEventRepository_test.go append-only port reflect | `undefined: AuditEventRepository` | port test PASS + WU1 test |
| 2.5 | domain/repositories/auditEventRepository.go (D4) | n/a | repositories package green |
| 2.6 | auditEventRepository_test.go buildInsertAuditEventParams | `undefined: buildInsertAuditEventParams` | adapter test PASS |
| 2.7 | infrastructure/postgres/auditEventRepository.go (D4) | n/a | postgres package green |

### WU3 (PR 3) — atomic seam change + co-write

| Step | Task | RED evidence | GREEN evidence |
|------|------|--------------|----------------|
| 3.1 | eventIntent_test.go metadata builders | `undefined: buildSubmittedMetadata` | 4 builder tests PASS |
| 3.3 | use-case event-intent tests | compile: stub lacks event capture, sentinel undefined | apply/transition event tests PASS |
| 3.5 | domain port Create/Transition + event param (D6) | compile break: `*ApplicationRepository does not implement` | resolved by 3.7 |
| 3.6 | Phase D co-write integration tests | compile: NewApplicationRepository(pool, audit) missing | 6 tests PASS |
| 3.7 | rewrite applicationRepository.go (D5) + remove Querier/stubQuerier | compile break | postgres unit green; build green |
| 3.8 | handler passes cc.UserID + ErrMissingActorIdentity -> 500 | compile: TransitionApplication call args | handler tests PASS |
| 3.9 | identity CompanyContext.UserID (D8) | `unknown field UserID in struct literal` | identity tests PASS |
| 3.10 | composition root main.go (D9) | n/a | build green (atomic resolved) |
| 3.11 | committed-fixture migration (D10) + leak fix | rollback fixture cannot see pool tx | integration green, residue-free |

## Final verification

- `go build ./...` clean.
- `go vet ./...` and `go vet -tags=integration ./...` clean.
- `go test ./... -count=1` -> 35 packages ok, 0 FAIL.
- `make test-integration` (`go test -tags=integration -p 1 ./...`) -> exit 0, 37 packages ok, 0 FAIL.
- `go tool sqlc generate` idempotent (no diff in the generated tree).
- `gofmt -l` clean on the new/edited files.
- DB migrated to 00011; applications + audit_events tables residue-free (0 rows after the suite).

## Out-of-scope repaired incidentally

`migration_00010_test.go` had a pre-existing leak: `defer pool.Close()` ran
before the `t.Cleanup` row-DELETE, so each row-inserting schema test leaked one
row per run. Masked under the old rollback fixture; exposed by the D10
committed-fixture migration. Fixed by moving pool close to `t.Cleanup`.

## Non-goals pinned (unchanged)

No read surface; no UPDATE/DELETE/backfill/replay; no outbox / SNS / SQS /
EventBridge; no emission from jobs/companies/identity write paths; no
retention/TTL/DynamoDB; no event-type catalog beyond the two; no new
unit-of-work abstraction (the applications adapter owns the `pgx.Tx`).
