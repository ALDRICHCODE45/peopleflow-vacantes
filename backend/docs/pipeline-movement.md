# Vacancy board and candidate movement (cut 4)

Recruiters can move one vacancy participation at a time, with atomic history,
audit and coverage. The authority is `docs/pipeline-customization-design.md` §12,
including the agreed clarifications in §12.7. Legacy applications are unchanged.

## Quick path

1. Apply migrations through **00038** with `make db-migrate` before running this API.
   Cut-5 discard/recovery extensions are documented in [pipeline-discard.md](pipeline-discard.md).
2. Read the board and keep each item's opaque `etag`.
3. POST a move using that item's tag as `If-Match`; reconcile with GET after an
   uncertain result or 412. Never automatically retry a move.

All routes below start with `/v2/me/company/job-drafts/{vacancyId}`. They use
`NoStore → RequireAuth → RequireCompanyRole(recruiter)` and the same live,
transactional owner-or-principal authorization as draft configuration. Missing,
foreign and non-principal resources return 404, before precondition comparison.
Candidate tokens receive the existing company-gate `403 forbidden`.
Every response, including gate failures, carries `Cache-Control: no-store`.

## Board and item shapes

`GET …/board` → 200, exactly `{stages, exit, coverage, participations, substates, delivery, retired_stages, screening_filters, lifecycle}`.
`lifecycle` is the eight-key [lifecycle view](vacancy-lifecycle.md), also embedded
in editor and pipeline GETs. Board/detail/history/CV remain readable when finished.
`screening_filters` is the current questionnaire's single-choice catalog, exactly
`[{question_id,prompt,options:[{id,label}]}]` in questionnaire order (§19).
See [board filter data](board-filter-data.md) for normalization, privacy and its test map.
`retired_stages` is always `[{id,kind,name}]`, supplying retained history labels (cut 7).
`delivery` is exactly `{state, delivered, target}`: `pending | fulfilled`, a historical
distinct-candidate count, and a non-null integer target. Fulfilled values are frozen;
see [delivery fulfillment](delivery-fulfillment.md).
`substates` is the ordered current catalog, each exactly `{id,name}` (cut 6).

- `stages`: pipeline order, each exactly `{id, kind, name, count}`. Kinds are
  `new | screening | screening_ok | in_process | placement | custom`.
- `exit`: exactly `{id, kind: "discarded", name, count}`.
- `coverage`: exactly `{covered, required, full_coverage_reached_at}`. `required`
  is current hiring headcount or null. The timestamp is the **first** full-coverage
  milestone, RFC3339 UTC or null, never reset by a departure.
- `participations`: at most 1,000 items, ordered by stage order (exit last), then
  `moved_at` descending, then ID ascending. More than 1,000 returns 422, not truncation.

An item is exactly:

```json
{
  "id": "…", "stage_id": "…", "version": "1", "etag": "\"opaque\"",
  "candidate": {"id": "…", "full_name": "Ana Pérez", "kind": "organic"},
  "added_by": null,
  "applied_at": "2026-10-16T18:00:00Z", "source": "organic",
  "cv": {"id": "…", "name": "CV"}, "moved_at": "2026-10-16T18:00:00Z",
  "discard": null, "substate_id": null,
  "profile": {"location": null, "skills": [], "years_of_experience": null, "education_level": null},
  "screening_answers": []
}
```

`source` is the closed enum `organic | manual`. `added_by` is always present:
null for organic intake, or exactly `{id,name}` for the recruiter who added a
manual participation. `candidate.kind` is always `organic | manual`: manual
company records use their own ID and full name; reused user accounts retain their
user ID/name and `kind:organic`, even with `source:manual`. `applied_at` is the
intake date (display manual intake as “Ingreso manual”, never as an application).
These origin fields are also present on detail and move/discard/recover/substate
responses. Manual participation never appears in the candidate application list.

 `version` is a decimal string for display,
not a precondition clients construct. Participation tags are strong and
domain-separated from draft/pipeline/other tags. The board itself has no ETag.
Default stage IDs remain the deterministic cut-1 UUIDv5 identities.
For organic identities, `profile` is the immutable application-time four-field
snapshot (legacy rows: nulls/empty skills). For company candidates, its location,
skills, years of experience and education level are projected from the private
company record; the geo read shape includes its stored postal code. Its `location` is null or the expanded five-key geo read shape
(country/state/municipality `{id,name}`, `postal_code:null`, server label); G4 replaces
city filtering with state/municipality. See [G4](geo-apply.md). `screening_answers` is exactly `[{question_id,option_id}]`,
only single-choice answers from the frozen snapshots in stored answer order;
open text is never returned on the board. Both keys are always present on board items
and participation detail. Mutation responses retain their existing key sets;
these private fields never appear there or in candidate/public APIs (§19).

## Move

`POST …/participations/{participationId}/moves`, body exactly:

```json
{"to_stage_id":"…","confirm_placement_exit":true}
```

The flag is optional, defaults to false, and must be boolean when present. Unknown
or duplicate keys, malformed JSON/UUIDs and invalid UTF-8 are invalid requests.
The transport enforces the existing 1 MiB JSON budget.

- Forward only to the next stage in the **current** stored/default pipeline order,
  including custom stages. Backward to any earlier stage.
- Same/unknown stage is invalid. Both moves **into and out of** the exit stage
  return `400 validation_error`; use the cut-5 discard/recover operations instead.
- Leaving `in_process` forward or backward clears an active substate in the same
  transaction, with a `substate` → null history event **before** the move. Re-entry
  starts null. Both events share one participation version bump (cut 6).
- Entering Placement records a hire. Leaving requires explicit confirmation and
  records a departure, without erasing previous history.
- 200 is the pre-§19 item shape (**without `profile` and `screening_answers`**)
  plus `coverage` and `delivery`, flattened, both computed after the write, with the new tag both
  in `etag` and the `ETag` response header. No idempotency/replay header is added.
- Missing `If-Match` → 428. Empty, malformed, weak, wildcard or list (including
  repeated header lines) → 400. Well-formed stale or foreign tag → 412.

### Transaction and coverage

The operation takes the live authorization locks, locks the parent draft, then
locks the process and participation. The parent lock also serializes questionnaire,
pipeline and headcount saves and intake; no authoring version is changed by a move.
Process serialization prevents two concurrent hires from both claiming the same
coverage crossing. Move/discard/recover/substate require process `active`, regardless
of publication (`published|paused|closed`). After acquiring the draft and process
locks, a fresh process read rejects finished with 409 `process_finished` and
`data:{lifecycle:<current view>}` before touching participation state. This matches
L1's draft-first transition lock order, including a concurrent finish-process.
All guards run before writes.

One transaction updates stage/version, appends history, appends PII-free audit
`ParticipationMoved` (actor, vacancy ID, from/to stage IDs, new version, hire and
departure flags), and inserts any coverage milestone. Audit failure rolls back all
of these, including coverage/milestone effects. An entry into the delivery cutoff
also records any newly reached fulfillment and `VacancyDeliveryFulfilled` snapshot
in this same transaction (§16); the response summary reflects it.

Coverage counts participations currently in semantic Placement, once per candidate
(the existing process/candidate uniqueness constraint). The first hire making coverage at least a non-null headcount records a milestone
with timestamp, covered and required counts (also when a headcount edit made the
process full before its first recorded hire milestone). Further hires while already
full do not create duplicates. Dropping
below and reaching full again records another milestone (DEL-9); the API still
reports the first. Headcount edits alone do not synthesize hire milestones.

## History, detail and CV

| Route | 200 response |
| --- | --- |
| `GET …/participations/{participationId}/history` | `{items:[entry]}`, oldest first, then history ID |
| `GET …/participations/{participationId}` | Item plus `screening:[{question_id,prompt,type,answer}]`, `comment`, `candidate_message` (last two null unless currently discarded) |
| `GET …/participations/{participationId}/cv` | Exact referenced CV version as an attachment with its stored content type |

History entries are exactly `{kind, from_stage_id, to_stage_id, hire, departure,
actor, at}` for `intake | move | recovery`. Discard entries additionally carry
`reason`, `comment`, `candidate_message`; see the exact discriminated union in
[pipeline-discard.md](pipeline-discard.md). `actor` is always
`{kind: "candidate" | "recruiter", id, full_name}`. Organic intake's actor is the candidate;
manual intake's actor is the recruiter. For either intake,
`from_stage_id` is null and both flags are false. Moves have recruiter actors.
Names of stages come from current or retired board stages.
Cut 6 adds a distinct `substate` history member with exactly
`{kind,from_substate_id,from_substate_name,to_substate_id,to_substate_name,actor,at}`;
nullable names are immutable snapshots. All other history key sets are unchanged.
Cut 7 adds exactly `{kind:"not_applicable",stage_id,actor,at}`. These recruiter
marks never count as reached or change a candidate's movement time/version.
See [active substates](pipeline-substates-active.md) for assignment, automatic
clearing and catalog occupancy guards.

Screening uses the participation's frozen safe questions and answers, never current
questionnaire content. Open answers are `{text}`; choice answers are
`{option_id,label}`. No score, answer key, correctness or evaluation flag is returned.
CV removal from the candidate library does not remove a participation's version.
Manual participations use the same authorized CV route and private storage adapter,
but reference `company_candidate_cvs`; their `{id,name}` uses that row's ID and
`file_name`, including when reusing an organic account. These files never enter
the candidate's CV library or public APIs.
The recruiter file route remains owner/principal scoped even when storage is
unconfigured; an authorized existing participation then receives
`503 cv_storage_unavailable`. Storage keys and paths are never returned.

## Existing resource changes

- Pipeline GET/PUT has `structure_locked: boolean` (any participation). Cut 7
  replaces its prohibition with preview/impact confirmation for reorder/add/remove,
  retaining occupied-stage/cutoff guards; see [pipeline-column-editing.md](pipeline-column-editing.md).
  Candidates stay in their columns; moves follow the resulting order. Substates
  stay editable; delivery is editable only until fulfillment (§16).
- Candidate list status is `submitted | in_process | closed` as of cut 5;
  `closed` means currently discarded and exposes only the optional candidate-facing
  `message`. Otherwise status depends on whether the semantic stage is `new`.
  Candidates receive no stage/history/substate data or internal reason/comment.
  See [vacancy-applications.md](vacancy-applications.md). Apply replays remain frozen.

## Errors

Errors remain exactly `{error,code}` without editor data or ETag, except
`process_finished` adds exactly `data:{lifecycle:<current view>}`.

| Status | Code | Cause |
| --- | --- | --- |
| 400 | `invalid_request` | Body/path/header shape |
| 400 | `validation_error` | Same/unknown stage, or exit as source or target |
| 401 / 403 / 404 | Existing draft gate codes | Authentication, membership, liveness, owner/principal scope |
| 409 | `company_not_active` | Transactional active-company gate |
| 409 | `stage_skip_not_allowed` | Non-adjacent forward target |
| 409 | `placement_exit_confirmation_required` | Unconfirmed Placement departure |
| 409 | `vacancy_not_published` | Authorized draft was never published (no process) |
| 409 | `process_finished` | Board mutation on a finished process; current lifecycle data, no writes |
| 409 | `stage_occupied`, `impact_confirmation_required` | Pipeline editor conflicts; see cut-7 contract |
| 412 | `version_conflict` | Stale or foreign participation tag |
| 413 | `payload_too_large` | Raw move body exceeds budget |
| 422 | `board_too_large` | More than 1,000 participations |
| 428 | `precondition_required` | Move without If-Match |
| 503 | `cv_storage_unavailable` | Recruiter CV storage unconfigured |
| 500 | `internal_error` | Unexpected failure or corrupt stored data |

## Migration and review units

Keep migration 00023, its migration tests/version-pinning adjustment and regenerated
`internal/db/models.go` in the migration review unit. Existing rows begin at
participation version 1; intake history keeps null from-stage and candidate actor.
Down refuses while moved versions, movement history or milestones exist. With no
new movement data it removes only the additive schema, preserving old P2b rows.
Retention/data removal is not decided by this migration.

Subsequent review units: board/move/history/detail/CV and composition; pipeline lock;
candidate status; additive catalog and documentation. The parent owns every commit.

## §12 test map

| Tests | Rules protected |
| --- | --- |
| `TestMovementRules` | §12.1 forward-one/backward-any, custom order, same/unknown/discarded rejection, hire/departure/confirmation |
| `TestMoveStrictDecode`, `TestParticipationETag` | §12.2/§12.7.1 strict body, optional flag, missing/malformed/weak/list/stale/foreign tags |
| `TestMovementRoutesGatesErrorsAndSuccess`, `TestMovementRoutesForwardPreconditionAndBudget` | §12.2/§12.7 transport: trusted identity, five routes, 401/403/404, no-store, codes/envelopes, move ETag, attachment, repeated headers, 413 |
| `TestMovementBoardMovesHistoryCoverageAndRetention` (DB) | §12.1–§12.3 board counts/defaults, versions/tags, all forward steps, backward-any, status reversal, immutable open answers, typed intake/move history, audit, coverage/repeated milestones, first timestamp, retained exact CV |
| `TestMovementRejectedRequestsAreAtomic` (DB) | §12.1–§12.2 no stage/version/history/audit/milestone changes on rejected moves or audit failure, including a hire that would reach coverage |
| `TestMovementConcurrentSameParticipation` (DB) | §12.1 concurrency: exactly one move wins, the other gets 412 |
| `TestCoverageMilestoneRequiresHireAndFirstOrRenewedReach` | §12.1 first hire reaching current headcount, null headcount, already-full deduplication and renewed reach |
| `TestMovementScreeningChoiceSnapshotNoScoring` (DB) | §12.7.6 exact open/choice answer shapes and frozen labels, no private evaluation fields |
| `TestMovementConcurrentHiresOneMilestonePerReach` (DB) | §12.1 DEL-9, concurrent distinct hires at headcounts 1 and 2, exactly one milestone per reach, retained first timestamp |
| `TestMovementAuthorizationDraftAndCVIsolation` (DB) | §12.1/§12.7.5 owner/principal access, non-principal/foreign IDs hidden before preconditions, draft 409, exact participation CV, missing storage 503 after isolation |
| `TestMovementPipelineStructureEditableWithCandidates`, `TestMovementEmptyPipelineStructureRemainsEditable` | §17 replaces §12's lock: rename/reorder/add/remove with and without candidates, live flag, new-order movement |
| `TestMovementBoardOrderingAndLimit` (DB) | §12.2 stage ordering, ID tie-break, exact 1,000 boundary and 1,001 rejection |
| `TestCandidateStatusHidesStage` | §12.6 S3 / §12.7.8 closed candidate status projection |
| `TestMovementErrorExtension` | §12.2/§12.7 additive catalog codes/statuses |
| `TestMovementMigration`, `TestMigration00023MovementDefaultsAndGuardedDown` (DB for latter) | §12.3 additive schema/defaults, down refusal preserves data/schema/version, empty-of-new-data down preserves intake |
| Existing pipeline flow and route topology tests | Coordinated cut-1 response key addition and exactly five additive routes; other registrations preserved |

## Validation boundary

From `backend/`:

```sh
go tool sqlc generate
go test ./internal/features/applications/... ./internal/features/jobs/application/pipelineconfig ./internal/features/jobs/infrastructure/postgres/draftstore ./internal/features/jobs/infrastructure/http ./internal/shared/httpjson ./db/migrations ./cmd/api -count=1
go test ./... -count=1
go vet ./...
go vet -tags=integration ./...
```

The implementation run compiles DB tests but explicitly skips their execution;
no database is created. The parent must execute the DB tests using an existing,
isolated loopback database named `draft_test` via `DRAFT_TEST_DATABASE_URL`.
Run migration rollback tests separately from application/store packages sharing the
same database. Passing compilation is not transactional or concurrency evidence.
Browser review remains queued in [pending-user-review.md](pending-user-review.md).
