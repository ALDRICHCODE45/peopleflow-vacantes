# Active participation substates (cut 6)

Recruiters can assign one tracking label while a participation is in semantic
`in_process`. Leaving that stage clears it, without erasing history. Authority:
`docs/pipeline-customization-design.md` §15, **including §15.6**. Extends
[movement](pipeline-movement.md), [discard/recovery](pipeline-discard.md) and the
[substate catalog](pipeline-substates.md). Candidate APIs remain unchanged.

## Quick path

1. Apply through **00027** with `make db-migrate` before starting this API. Quiesce writes
   during migration/deployment; ALTER/CHECK validation locks existing personal-data
   tables. Keep the migration, migration tests/version pin and generated sqlc model
   in their own review/commit unit. The parent owns all staging and commits.
2. GET the board. Keep each participation's opaque `etag` and use the ordered
   `substates: [{id,name}]` for badges/selectors; no second catalog read is needed.
3. POST the selected UUID (or null) with the participation's `If-Match`. After an
   uncertain result or 412, reload; never automatically retry.

## Set or clear

Base: `/v2/me/company/job-drafts/{vacancyId}/participations/{participationId}`.

`POST …/substate`, body **exactly**:

```json
{"substate_id":"<uuid>"}
```

Use `{"substate_id":null}` to clear. The member is required, nullable, and no other
members are accepted. Duplicate/unknown keys, invalid JSON/Unicode, wrong types,
malformed/nil UUIDs → `400 invalid_request`. Raw budget: 1 MiB, as moves.

200 is the flattened board item **plus `coverage` and `delivery`**, as a move.
`delivery` is exactly `{state, delivered, target}`, computed after the write (also
on a no-op). A substate event is not an entry into the cutoff and cannot trigger
fulfillment; see [delivery fulfillment](delivery-fulfillment.md) (§16). The new participation tag appears in both `etag` and the `ETag` header.
All board/mutation/detail items gain **always-present** `substate_id: UUID | null`.
Items outside `in_process`, including discarded ones, always have null.
A successful change increments the participation version exactly once, without
changing its stage, candidate, CV, source or application timestamp. `moved_at`
reflects the latest history event, as on existing board items. Coverage does not
change. Setting the current value (including null) returns the same item/tag and
writes no history or audit; it still requires a current precondition and in-process
stage. No idempotency/replay header is added.

### Gates and preconditions

`NoStore → RequireAuth → RequireCompanyRole(recruiter)` then the live transactional
owner-or-principal rule. Candidate token → existing `403 forbidden`; foreign or
nonprincipal vacancy/participation → `404 not_found`, before tag comparison. An
authorized draft → `409 vacancy_not_published`. All responses are no-store.

The participation tag uses the existing move parser: missing → 428; empty, weak,
list/repeated, wildcard or malformed → 400; well-formed stale/foreign → 412.
The tag is checked before body/state guards, so concurrent losing writes return
412 even when the winner moved/discarded the participation.

| Status | Code | Cause |
| --- | --- | --- |
| 400 | `invalid_request` | Body/path/header shape |
| 400 | `validation_error` | UUID is not in this vacancy's current catalog |
| 401/403/404 | Existing movement gate codes | Authentication, live membership/company, owner/principal scope |
| 409 | `company_not_active`, `vacancy_not_published` | Existing transactional gates |
| 409 | `substate_requires_in_process` | Any other stage, including discarded; applies to clear too |
| 412 | `version_conflict` | Stale/foreign participation tag |
| 413 | `payload_too_large` | Raw body exceeds budget |
| 428 | `precondition_required` | Missing If-Match |
| 500 | `internal_error` | Unexpected failure or version overflow |

These errors are exactly `{error,code}` without ETag. The catalog PUT's new
`409 substate_in_use` is the exception below.

## History and leaving the stage

History remains oldest-first. Its new `substate` union member is **exactly**:

```json
{"kind":"substate","from_substate_id":null,"from_substate_name":null,"to_substate_id":"<uuid>","to_substate_name":"Interview","actor":{"kind":"recruiter","id":"<uuid>","full_name":"Recruiter"},"at":"2026-10-18T12:00:00Z"}
```

IDs and names are nullable in pairs. Names are snapshots at the time of each
event, not joined from today's catalog: later rename/removal never rewrites them.
Existing intake/move/discard/recovery key sets are unchanged.

A move forward **or backward**, or discard, leaving `in_process` clears an active
substate in the same transaction. It writes a `substate` → null entry **before**
the move/discard entry. Without an active substate there is no synthetic clear
event. Move/recovery re-entry starts null, never restores the former label.
Clearing and leaving share one participation version bump. Distinct microsecond
history instants preserve order under the existing timestamp/UUID ordering,
including a stalled/backward wall clock.

All operations lock **draft → process → participation**. Catalog validation is
read inside this boundary, shared with catalog PUT's draft lock. Stage/version,
history, audit and any existing coverage effect commit together. Changing/implicit
clearing writes `ParticipationSubstateChanged` with actor, vacancy/from/to IDs
(empty string denotes null in the string-valued audit port) and new version;
no candidate data or catalog names enter audit metadata. Move/discard keep their
own existing audits. Any failure rolls back every co-write.

## Catalog occupancy

Catalog GET/PUT keeps its independent version/ETag and gains `in_use` on every
item: exactly `{id,name,in_use}`. The boolean reflects live active occupancy, not
historical use; occupancy changes do **not** bump the catalog version. GET locks
the draft while reading catalog and occupancy for a consistent response, but
never writes. Renaming/reordering stays allowed, even for occupied IDs.

Removing an occupied ID returns:

```json
{"error":"substate in use","code":"substate_in_use","details":[{"substate_id":"<uuid>"}]}
```

Details contain one entry per blocked removal, in the **previous catalog order**,
never candidate identities. Nothing (catalog/version/audit) is written. Remove an
unused ID freely; reassign/clear occupants before removing a used one.
`substate_in_use` and `substate_requires_in_process` are additive catalog codes;
the baseline error catalog and architecture guard are unchanged.

## Storage, filtering and privacy

00026 adds nullable participation `substate_id`, a partial occupancy index, history
from/to IDs/name snapshots, and extends the existing event/shape CHECKs. Existing
cut-4/5 rows remain valid without backfill or personal-data rewrites. SQL enforces
null when discarded and coherent history snapshots; stage kinds and catalog IDs
live in encoded configuration, so their cross-resource integrity is enforced under
the shared draft lock, not a fictitious FK to JSON.

Down refuses while **any** active substate or substate history/snapshots exists.
It preserves schema, data and migration version on refusal. Without cut-6 data it
restores the cut-5 CHECKs and preserves all cut-4/5 rows. This is not a retention
policy or permission to delete data.

Filtering is frontend-only over the ≤1,000-item board: OR among selected labels
and «Sin subestado»; the latter matches only `in_process` with null. All items
outside `in_process` fail a substate filter. AND with any future other filters.
No backend filter parameters or frontend changes are introduced. Candidate APIs
expose only their existing status/message, never catalog, substate ID or history.

## §15 test map

DB rows below are executable specifications, **not a claim of DB execution**.

| Tests | Rules/effects |
| --- | --- |
| `TestSubstateDecodeAndStageRules` | §15.1/15.2 strict nullable member, malformed/duplicate/escaped/unknown keys and types/UUID/Unicode; all stage kinds including custom; semantics independent of stage name |
| `TestSubstateHistoryExactUnion` | §15.6.2 exact seven history keys and nullable snapshots; existing history tests retain other kinds' exact keys |
| `TestSubstateRoutesDispatchErrorsAndPreconditions`, extended `TestMovementRoutesGatesErrorsAndSuccess` | §15.2/15.5 S4 gates (401/candidate 403/404), dispatch, session identity, repeated If-Match forwarding, 200 ETag, codes, 413, no-store |
| `TestSubstateCatalogCodesAndBoundedDetails`, `TestSubstateCatalogInUseDetailsOverRealRouter` | §15.6.3 additive 409 codes, exact details keys/order, no details for unrelated/forged definitions, normalized errors |
| `TestCheckRemovalCatalogOrderAndRename`, updated cut-2 response/flow tests | §15.1/15.6.3 catalog-order blocked IDs; occupied rename and unused removal allowed; exact `{id,name,in_use}` |
| `TestSubstateSetClearNoOpWireSnapshotsAndCatalog` (DB) | §15.1/15.2/15.6.1–5 set/clear and both no-ops, exact board/catalog/item/detail/history keys, candidate privacy, live in_use, atomic blocked removal, occupied rename/unused removal, historical names surviving rename/removal, audit |
| `TestSubstateReassignmentAnyOrderAndExactlyOneVersion` (DB) | SUB-3/4, §15.1 any-order reassignment, one version/tag, unchanged identity/stage/CV/coverage, persisted item equality, actor/times/history |
| `TestSubstateClearsBeforeLeaveAndReentryIsNull` (DB), `TestSubstateImplicitClearReservesAnOrderedInstant` | §15.1/15.5 S1/15.6.5 forward/backward/discard clear before leave, single bump, history order and null re-entry, clock regression safety |
| `TestSubstateRejectsWithoutAnyEffects` (DB) | §15.2/15.6.5 unknown ID, malformed body/tags, foreign actual participation 404, every non-in_process kind (including custom) and discarded 409, draft 409, storage/audit snapshots unchanged |
| `TestSubstateAuditFailuresRollbackSetClearAndLeave` (DB) | §15.1 transactional set/clear and second-audit failure on move/discard after implicit clear; no partial history/audit/version/stage/substate/milestone effects |
| `TestSubstateConcurrentSetMoveDiscardOneWinner` (DB) | §15.1 shared lock order, one success/two 412, exactly one version/history/audit effect, coherent occupancy and coverage |
| `TestSubstateConcurrentCatalogRemovalNeverDangles`, `TestSubstateCatalogRemovalBothLockOrderings` (DB) | §15.1/15.3 integrity; race + both forced lock orderings, set winner blocks removal / removal winner rejects assignment, no dangling ID, coherent version/history |
| `TestActiveSubstateMigrationDefinition`, `TestMigration00026ExistingRowsShapesAndGuardedDown` (latter DB) | §15.3 preserved cut-4/5 intake, hire/departure, discard/recovery rows; set/clear shapes and bad snapshots/actors/flags; current/history-only rollback refusal; successful down preserving original data |

## Validation boundary

From `backend/`: `go tool sqlc generate`, gofmt on changed Go files, focused tests,
`go test ./... -count=1` (including closure/architecture gates), `go vet ./...`, and
`go vet -tags=integration ./...`.

The implementation run deliberately removes `DRAFT_TEST_DATABASE_URL` from focused
integration invocations: DB-backed cases compile and explicitly skip; **no database
is created or modified**. The parent runs them on an existing isolated loopback
`draft_test`, preferably with `-race`. Run migration rollback tests separately from
store/API packages sharing that DB. Compilation is not concurrency/migration proof.
Browser review is queued in [pending-user-review.md](pending-user-review.md), row 8.
