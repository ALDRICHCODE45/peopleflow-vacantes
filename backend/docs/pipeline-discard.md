# Discard with a reason and recovery (cut 5)

Authority: `docs/pipeline-customization-design.md` §13, including the refinements
in §13.6. Extends [cut-4 movement](pipeline-movement.md); legacy applications and
frontend are unchanged. No candidate notification is sent.

## Before running

Apply migrations through **00026** with `make db-migrate` (cut-6 active substates;
[contract](pipeline-substates-active.md)). Quiesce participation writes during the
migration/API rollout: the new history event kind is explicit for move writes.
Keep 00024, its tests, the 00023 rollback-test pin and regenerated
`internal/db/models.go` in a separate migration review/commit unit. The parent
owns all staging and commits.

00024 adds nullable discard fields to participations and private history details,
plus `event_kind` (`intake | move | discard | recovery`). Existing history kinds are
derived from `from_stage_id`, without changing prior IDs, actors, flags, times,
versions, CV references or answers. Both tables CHECK the exact group/key catalog
(stored in SQL `reason_group` / `reason_code`) and coherent nullable shapes;
text lengths are checked in code points. The previous
stage remains valid through cut 4's structure lock.

Down refuses **any** current discard data or retained discard/recovery history,
including after recovery clears the current fields. Refusal is transactional:
data, schema and migration version remain intact. Without cut-5 data, down preserves
existing cut-4 rows. This is not a retention policy or permission to delete data.
The ALTER/backfill takes table locks; assess production volumes before rollout.

## Routes and preconditions

Base: `/v2/me/company/job-drafts/{vacancyId}/participations/{participationId}`.

Both POST routes use `NoStore → RequireAuth → RequireCompanyRole(recruiter)`, then
the live transactional owner-or-principal rule. Foreign or non-principal resources,
including a real participation belonging to another vacancy, are 404 before tag
comparison. Candidate tokens receive the existing company-gate `403 forbidden`.
An authorized draft returns `409 vacancy_not_published`. All responses are no-store.

Keep the board item's opaque participation `etag`; send it unchanged as `If-Match`.
Missing → 428; empty, weak, wildcard, list/repeated, malformed → 400 invalid_request;
well-formed stale/foreign → 412 version_conflict. Version strings are display-only.
Do not construct tags or automatically retry; reload after uncertain results,
412/404, or already_discarded/not_discarded.

### Discard

`POST …/discard`, body exactly (only `reason` required):

```json
{"reason":{"group":"recruiter","key":"other"},"comment":"Internal explanation","candidate_message":"Thank you for applying.","confirm_placement_exit":false}
```

| Group | Keys |
| --- | --- |
| `recruiter` | `requirements_not_met`, `profile_mismatch`, `salary_expectation`, `other_candidate_selected`, `other` |
| `candidate` | `accepted_other_offer`, `no_longer_interested`, `unresponsive`, `other` |

Group/key pairing is mandatory. Per §13.6.9 the reason is exactly `{group,key}`
in the body, board, detail and history. A body using `code` instead of `key`
(or sending both) is `400 invalid_request`; `code` is reserved for error envelopes.
`other` in either group requires `comment`.
Optional comment is 1–1,000 Unicode code points; optional candidate message is
1–500. Leading/trailing Unicode White_Space is trimmed, interior kept verbatim;
remaining control characters except newline/tab are rejected. Emoji count as one
code point; combining marks count separately. Empty/whitespace-only text is invalid:
omit an optional empty field, do not send null. Text is plain text, never HTML.
Unknown/duplicate keys (including nested reason keys), wrong types, malformed JSON
or invalid UTF-8 are invalid_request. Bodies retain the 1 MiB transport budget.

Discard saves the previous progression stage, reason, text and timestamp, moves to
the exit and increments participation version once. Discard from Placement requires
`confirm_placement_exit:true`: departure=true, hire=false, coverage decreases,
all milestones stay. Other progression stages need no flag.

### Recover

`POST …/recover`, body exactly `{}` or `{"confirm_placement_reentry":true}`.
The optional flag must be boolean. Sending this operation confirms recovery.

Recovery returns to the stored previous stage, **never** performs a forward-skip
check, and clears all current discard fields. Placement reentry requires the flag:
hire=true, departure=false, coverage increases. A renewed below-to-full crossing
records another milestone; the API still reports the first milestone timestamp.
Non-Placement recovery needs no additional flag. Cut 6: recovery into
`in_process` always starts with `substate_id:null`, never restores the old label. History retains private details
of every discard even though current detail and the candidate list no longer do.

### Atomicity

One transaction locks **draft → process → participation**, the same order as cut 4.
It checks the locked item's tag before request/state guards. It updates stage,
version and discard fields, appends history and PII-free audit
`ParticipationDiscarded` / `ParticipationRecovered`, updates live coverage and
records any milestone before commit. Audit contains actor, vacancy/from/to IDs,
version and hire/departure flags, **never free text**. Any rejection or audit failure
rolls everything back. Concurrent stale operations cannot overwrite the winner.
Moves into **or out of** the exit are `400 validation_error`; other move rules stay.
Cut 6: discarding from `in_process` clears any active substate in this same
transaction and records a `substate` → null entry **before** the discard entry.
The clear has its own audit, but shares the discard's single version bump.

## Exact projections

Both POSTs return 200 with the flattened cut-4 board item **plus `coverage`**, and
the new tag in both item `etag` and response `ETag`. No idempotency header is added.

Every board/mutation/detail item also has `substate_id` (cut 6), always null
outside `in_process`, including while discarded.

Every board/mutation item gains `discard`, always present:

```json
{"reason":{"group":"recruiter","key":"other"},"discarded_at":"2026-10-16T18:00:00Z","previous_stage_id":"…"}
```

It is null unless currently discarded. Discarded items use the exit `stage_id`,
count in `exit.count`, and have `moved_at = discarded_at`. The previous stage is a
current progression stage. Board items never include either free-text field.

Participation detail adds always-present `comment` and `candidate_message` to its
item + screening shape. Both are null unless currently discarded (and may still
be null then when omitted). `discard` is the same object as on the board.

History is oldest-first, exactly this discriminated union:

| Kind | Exact keys |
| --- | --- |
| `intake`, `move`, `recovery` | `kind, from_stage_id, to_stage_id, hire, departure, actor, at` |
| `discard` | Same keys plus `reason, comment, candidate_message` (text string or null) |
| `substate` (cut 6) | `kind, from_substate_id, from_substate_name, to_substate_id, to_substate_name, actor, at` (nullable ID/name pairs; names snapshotted at event time) |

Intake/move keys are unchanged. Discard from=previous stage, to=exit, hire=false.
Recovery from=exit, to=previous stage, departure=false. Actor is always
`{kind:"candidate"|"recruiter",id,full_name}`. These recruiter-only history details
never enter the candidate DTO/query.

Candidate list items are exactly `{id,vacancy,company,applied_at,status,message}`.
Status is `submitted | in_process | closed`; closed means currently discarded.
`message` is always present: optional candidate message while closed, otherwise
null, including after recovery. Internal reason/comment, stage and history are
never exposed. Apply/replay stays the original frozen submitted response.
See [vacancy-applications.md](vacancy-applications.md).

## Errors

Every error is exactly `{error,code}`, no validation details or ETag.

| Status | Code | Cause |
| --- | --- | --- |
| 400 | `validation_error` | Invalid reason pairing, missing other comment, empty/long/control text, move crossing exit |
| 400 | `invalid_request` | Body/path/header shape or wrong types |
| 401/403/404 | Existing cut-4 gate codes | Authentication, membership/liveness, owner/principal isolation |
| 409 | `company_not_active`, `vacancy_not_published` | Existing transactional gates |
| 409 | `already_discarded` | Discard of current exit occupant |
| 409 | `not_discarded` | Recovery of progression occupant |
| 409 | `placement_exit_confirmation_required` | Unconfirmed Placement departure |
| 409 | `placement_reentry_confirmation_required` | Unconfirmed Placement reentry |
| 412 | `version_conflict` | Stale/foreign item tag |
| 413 | `payload_too_large` | Body exceeds budget |
| 428 | `precondition_required` | Missing If-Match |
| 500 | `internal_error` | Unexpected failure or corrupt stored invariant |

The three new 409 catalog entries are additive; baseline V1 codes are untouched.

## §13 test map

| Tests | Rules/effects protected |
| --- | --- |
| `TestDiscardReasonKeyContract` | §13.6.9 accepted `{group,key}`, exact reason output keys, rejected old/mixed member spellings |
| `TestDiscardCatalogPairs` | §13.1 exact Cartesian group/key catalog, both other comment requirements, non-other optional comment |
| `TestDiscardTextAndOther`, `TestDiscardRecoverStrictBodies` | §13.1/§13.2/§13.6.1 Unicode trim, emoji/combining boundaries, retained interior, controls, strict shapes/types/duplicate keys, recovery {} |
| `TestDiscardProjectionNulls`, `TestDiscardHistoryUnion` | §13.6.2–3 always-present detail/item nulls, discriminated exact history key sets and nullable private text |
| `TestDiscardRecoveryEachStageAndCoverage` (DB) | §13.1 all six progression kinds; previous stage/exit counts/times/version/tag; Placement flags, coverage down/up and retained/repeated milestones; detail text; candidate closed/message/recovery; history actor/reason/flags/time; audits; both 409 state conflicts; exit-source move rejection; second discard cycle |
| `TestDiscardRecoveryRejectedRequestsAndAuditFailureAreAtomic` (DB) | §13.1/§13.2 tag errors before writes, malformed/invalid bodies, audit failure rolling back discard, Placement departure and renewed hire/milestone, including all current private fields |
| `TestDiscardCatalogAndTextRejectionsAreAtomic` (DB) | §13.1/§13.6.1 every reason pair and text boundary with persisted-state snapshots on all rejections; valid text/pairs stored and recovered |
| `TestDiscardRecoveryExactWireAndCandidatePrivacy` (DB) | §13.2/§13.6 exact board/mutation/detail/history union/candidate list keys, ETag, exit count/time, text retained only in history after recovery, candidate never sees internal reason/comment |
| `TestDiscardRecoveryAuthorizationAndRejectionsOverHTTP` (DB) | §13.2/§13.6 envelope without details, foreign real participation/vacancy 404, draft 409, missing/malformed/stale tags, old reason member 400, no rejected writes |
| `TestDiscardRecoveryOwnerPrincipalAndNonprincipal` (DB) | §13.1 owner/non-owner principal acceptance, nonprincipal 404 before body/precondition checks with no writes |
| `TestDiscardMoveRecoveryConcurrentOneWinner` (DB) | §13.1 force each operation first with queued draft locks; one winner, both stale contenders 412, exactly one version/history/audit change and coherent coverage/milestones |
| `TestMovementRoutesGatesErrorsAndSuccess`, `TestDiscardRecoveryRoutesDispatchErrorsPreconditionsAndBudget` | §13.2 no-store, 401/candidate 403, trusted identity, correct operation dispatch, statuses, flattened 200 + ETag, repeated header forwarding, 413 |
| `TestDiscardErrorExtension`, `TestCandidateStatusHidesStage` | §13.2 additive codes/statuses and closed status projection |
| `TestDiscardMigration`, `TestMigration00024ExistingMovementCatalogAndGuardedDown` (latter DB) | §13.3 cut-4 intake/move preservation and kind backfill, exact catalog CHECK in both tables, current/history-only down refusal preserving schema/version/data, successful down preserving cut-4 rows |
| Existing cut-4 movement/coverage tests | §12 base behavior unchanged, exit-target move guard, structure lock and cross-resource locking |

DB tests require an **existing**, isolated loopback database named `draft_test` via
`DRAFT_TEST_DATABASE_URL`. This implementation run deliberately unsets that variable
for focused integration tests: they compile and explicitly skip; no database is
created or modified. Passing compilation is not transaction/concurrency evidence.
The parent must execute them (preferably with `-race`), with migration rollback tests
separate from store/API tests sharing the same database. Unit tests and full test/vet
commands are reported in the implementation handoff. Browser review is queued in
[pending-user-review.md](pending-user-review.md), row 6.
