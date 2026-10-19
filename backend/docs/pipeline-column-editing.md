# Editing pipeline columns with candidates (cut 7)

Authority: `docs/pipeline-customization-design.md` §17, including the applied-impact,
preview-stages and deterministic-ID amendments. This replaces the cut-4 structure
lock, not the movement, discard, substate or delivery rules. Legacy applications
and frontend are untouched.

## Rollout and ownership

Apply **00028** with `make db-migrate` before deploying the new API. Quiesce writes
while switching versions: the previous API does not understand the new history kind.
Keep `00028_pipeline_column_editing.sql` and its definition/integration tests as the
migration review unit; the parent owns all staging and commits. Migration 00027's
rollback test already pins version 27 independently of the latest migration.

00028 only extends three history CHECKs. Every old branch stays valid, including
hire/departure, discard/recovery and substate rows. A `not_applicable` row stores its
stage in `stage_id`, has recruiter actor, no from-stage, flags, reason, private text
or substate fields. Down refuses transactionally while any such row exists; it does
not delete history or decide retention. Otherwise it restores the previous CHECKs.
No new columns or generated sqlc DTOs are required.

## Request flow

Base: `/v2/me/company/job-drafts/{vacancyId}/pipeline`.

1. GET the current configuration and opaque pipeline ETag.
2. POST the proposed full replacement to `/preview` (no If-Match).
3. Explain the impact, then PUT the same proposal with `confirm_impact:true` and the
   pipeline If-Match when confirmation is needed.
4. Use the PUT's **applied_impact**, not the earlier preview: candidates can move
   without changing the pipeline version. Reconcile an uncertain PUT with GET,
   never an automatic retry.

All three routes use existing no-store, authentication, recruiter-company and live
owner-or-principal gates. Missing, foreign, non-principal and schema-1 drafts are
404 before decoding/preconditions. Candidate tokens get company-gate 403. Preview
also works on an authorized schema-2 draft (empty impact), like configuration PUT.

### Exact bodies

PUT accepts exactly `{stages, exit, confirm_impact?}`. Preview accepts exactly
`{stages, exit}`; even `confirm_impact:false` is invalid on preview. Existing entries
are `{id,name}`; new custom entries are `{name}`. Client `kind`, retired IDs,
unknown/duplicate keys and wrong types are rejected as before. The 1 MiB budget
and pipeline-only ETags are unchanged; preview ignores If-Match and emits no ETag.

GET 200 has exactly `{version, structure_locked, stages, exit, limits, retired}`.
PUT 200 has those keys **plus** `applied_impact`, always present, including no-op
PUTs and drafts without participations:

```json
{"not_applicable":[],"recovery_reassigned":[]}
```

`retired` is always an array of `{id,kind,name}`. `structure_locked` is true while
any participation exists, including discarded ones; it now signals the need to
preview structure edits, not a prohibition. `stage_change_requires_empty_pipeline`
is no longer returned by pipeline PUT.

Preview 200 has exactly:

```json
{
  "stages": [{"id":"…","kind":"custom","name":"Interview"}],
  "not_applicable": [{"participation_id":"…","candidate":{"id":"…","full_name":"…"},"stage_id":"…"}],
  "recovery_reassigned": [{"participation_id":"…","candidate":{"id":"…","full_name":"…"},"retired_stage_id":"…","default_stage_id":"…"}],
  "has_impact": true
}
```

`stages` is the complete resulting progression in proposed order. New IDs are
server-only UUIDv5: vacancy namespace, stored pipeline version (0 if unsaved), and
zero-based ordinal among id-less entries. Preview and PUT on that version name the
same stages. Every changing save advances the version, preventing ID reuse even
after removal and re-addition. A retired ID cannot be resurrected. Lists are ordered
by affected stage order then participation ID (retirements use last position).

## Rules and persistence

- Rename/reorder/add/remove with or without candidates. Nuevos stays first,
  Placement last, built-ins stay present, at most three active custom stages;
  existing normalization and unique active names remain unchanged.
- Candidates retain their stage, substate, version/ETag and movement time. New
  order determines the next forward move; no silent movement or history rewrite.
- A live non-discarded occupant blocks custom removal. A delivery cutoff also
  blocks removal, including after fulfillment. Resolve occupants and cutoff first.
- After an edit, stages now before each participation that it never actually
  entered and has not already been marked receive `not_applicable`. Discarded
  participations are positioned at their previous stage, or its retained last
  position if removed. Reached = intake/move/recovery only. Marks are idempotent.
- Removal preserves `{id,kind,name,position}` in stored `retired`; position is a
  zero-based progression index at retirement and is not sent on the wire.
  Configuration schema version 2 is written; older stored configurations without
  schema_version/retired still read as empty retirement lists without a write.
- Impact means new marks or newly removed previous stages of discarded candidates.
  Without confirmation PUT writes nothing. Preview always writes nothing.
- One transaction locks **draft → process → participations in ID order**, computes
  against current locked state, writes configuration/version and marks, and appends
  `JobDraftPipelineConfigured` with previous/new snapshots and JSON `applied_impact`
  lists. Audit failure rolls everything back. It does not fulfill delivery or
  change coverage. Delivery reach SQL explicitly permits intake/move/recovery only,
  so marks never count as reached; frozen fulfillment snapshots remain untouched.
- No-op PUT preserves version/ETag and writes no audit; applied-impact arrays are
  empty (therefore its body can differ from the preceding changing PUT).

## Board, history and recovery

Board gains `retired_stages: [{id,kind,name}]` (always an array). Discard objects on
board/detail/discard responses gain `recovery_stage_id`: previous stage if current,
otherwise the nearest current stage strictly before its last retained position.
History gains exactly `{kind:"not_applicable",stage_id,actor,at}` with recruiter
actor `{kind,id,full_name}`. Existing history union members are unchanged. Current
and retired stage lists together supply labels.

Recover accepts `{confirm_placement_reentry?,to_stage_id?}` with the existing
participation If-Match. If the previous stage still exists, `to_stage_id` **must be
absent**. If retired, it is **required** and may name the default recovery stage or
any earlier current progression stage, never later/exit/retired/foreign. Recovery
retains its existing history shape and audits `recovery_override:true` plus the
original `previous_stage_id`. Ordinary recovery audits `recovery_override:false`.
Placement confirmation, coverage/milestones, substate clearing and same-transaction
delivery effects remain as before; candidate-facing fields do not expand.

## Errors

Existing invalid_request/validation_error, auth/liveness/404, ETag/412/428, budget,
cutoff_stage_in_use and internal_error rules remain. All rejections write nothing.

| Status | Code | Shape / cause |
| --- | --- | --- |
| 409 | `stage_occupied` | `{error,code,details:[{stage_id}]}`; one per blocked stage, previous catalog order |
| 409 | `impact_confirmation_required` | `{error,code}`; impact without confirm_impact |
| 409 | `recovery_stage_required` | `{error,code}`; retired previous stage without to_stage_id |
| 400 | `validation_error` | Recover target supplied for existing previous stage, or target outside allowed range; no details |

## §17 test map

| Tests | Rules |
| --- | --- |
| `TestReplace_*`, `TestColumnIDsDeterministicAndNeverReused` | §17.1 invariants, retired IDs/name/position, old JSON compatibility, deterministic version-scoped UUIDv5 and non-reuse |
| `TestColumnImpactReachedMarkedDiscardedAndOrdering`, `TestColumnOccupiedCatalogOrder`, `TestColumnNoopDoesNotInventImpact` | §17.1 never reached vs already marked, discarded positioning, removed previous/default, deduplication and ordered conflicts/impact |
| `TestColumnPipelineGetPutExactWireKeys`, `TestColumnPreviewRouteExactKeysAndGates` | §17.2 exact GET/PUT/preview keys, empty applied arrays, private position omitted, preview stages contain new mark IDs, no If-Match/ETag, 401/candidate403/foreign404 and catalog errors |
| `TestNotApplicableHistoryExactKeys`, `TestRecoverTargetStrictBody`, `TestRecoveryTargetRemovedRangeAndExisting` | §17.2 exact history union, strict recover fields and allowed/default/earlier/later/required/prohibited targets |
| `TestColumnsPreviewAppliedEchoAtomicityAndDeliveryReach` (DB) | §17.1–2 insertion before candidate, preview/PUT same IDs and impact, confirmation rollback, audit lists/actor, unchanged candidate/substate/version/time/coverage/delivery, reached excludes marks, no duplicates/no-op |
| `TestColumnsImpactAuditFailureRollsBackMarksAndConfiguration` (DB) | §17.2 audit failure rolls back configuration/version/history marks together |
| `TestColumnsEditsPreserveFrozenFulfillment` (DB) | §17.1/§16 pipeline insert and cutoff rename preserve frozen attainment, result, candidates and name snapshot |
| `TestColumnsRetiredRecoveryPlacementConfirmationAndRealReach` (DB) | §17.1–2 last-position default, Placement override confirmation, mark excluded from reached, actual recovery adds hire/coverage/delivery reach |
| `TestColumnsAppliedImpactRecomputedAfterPreviewMove` (DB) | §17.2 applied echo recomputed when a candidate moves between preview and PUT; confirmation gate re-evaluated |
| `TestColumnsReorderDoesNotMarkReachedStages` (DB) | §17.1 reorder before candidate, already-reached stages excluded, movement follows new order |
| `TestColumnsRemoveOccupiedCutoffAndDiscardedRecovery` (DB) | §17.1–2 occupied details, cutoff and impact guards with no rejected effects, retained name, board default, required/default/earlier/later/unknown targets, override audit and recovery history |
| `TestColumnsDraftPreviewIDsRetirementAndAuthorization` (DB) | §17.2 draft support/empty impact, preview purity, foreign/nonprincipal404 before decoding, deterministic IDs and non-reuse over actual saves |
| `TestColumnsForcedConcurrentEditMoveDiscardRecoverApply` (DB) | §17.1/§17.2 both forced draft-lock orderings of PUT against each operation, bounded waits, coherent applied impact and audit, new-order move rejection |
| Existing movement/discard/substate/fulfillment tests | §12–16 ETags, Placement exit/reentry, coverage, delivery freeze/attainment and candidate privacy retained; exact board/discard keys updated |
| `TestColumnErrorCatalog`, `TestColumnOccupiedDetailsExactAndFailClosed`, `TestColumnPutOccupiedAndPreviewBudget`, `TestColumnRecoveryStageRequiredWire` | §17.2 additive 409 catalog and controlled detail serialization |
| `TestColumnEditingMigrationPreservesOldChecks`, `TestMigration00028ExistingKindsShapesAndGuardedDown` (latter DB) | §17.3 old branches/all old event kinds and discarded fixture unchanged, exact new shape, guarded down preserving data/version and exact restored CHECKs |

DB tests need an existing isolated loopback `draft_test` via
`DRAFT_TEST_DATABASE_URL`. They are compiled and reported skipped in this worker's
validation; the parent must execute them separately from migration rollback tests,
preferably with `-race`. No database is created. Compilation is not concurrency or
migration-execution evidence. Browser approval remains queued in row 10 of
[pending-user-review.md](pending-user-review.md).
