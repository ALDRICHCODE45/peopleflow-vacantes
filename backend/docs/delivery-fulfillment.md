# Delivery fulfillment

Delivery is attained historically, once per candidate, and fulfilled automatically
at its target. Fulfillment freezes the delivery configuration and its explaining
snapshot. Authority: `docs/pipeline-customization-design.md` **§16, including §16.6**;
calendar §8.2, publication guard §10.2, participation operations §12–§15 remain in force.
Legacy applications, frontend, lifecycle pauses and KPI dashboards are unchanged.

## Quick path

1. Apply **00027** with `make db-migrate` before deploying the API.
2. Read the published vacancy's `GET …/pipeline/delivery/status` for the full result;
   the board and write responses carry a compact `delivery` summary.
3. To edit a pending delivery, POST a preview. If it would fulfill, ask for explicit
   confirmation, then PUT with the delivery ETag and `confirm_fulfillment: true`.
   Preview is advisory: PUT revalidates under the transaction locks.
4. Reconcile uncertain writes with GET; never retry automatically. Once fulfilled,
   display the configuration read-only (`fulfilled: true`). The server's 409 wins.

All routes below start with `/v2/me/company/job-drafts/{vacancyId}`. Same cut-3
NoStore → auth → recruiter company gates and live owner-or-principal authorization.
Candidates receive `403 forbidden`; missing, foreign and non-principal vacancies
are `404 not_found`. All responses, including failures, carry `Cache-Control: no-store`.

## Exact contract

### Status

`GET …/pipeline/delivery/status` → 200, **published only**:

```json
{
  "state": "pending",
  "delivered": 3,
  "target": 5,
  "cutoff_stage_id": "<uuid>",
  "commitment_date": "2026-11-30",
  "business_days_remaining": 12,
  "fulfillment": null
}
```

These seven keys are always present. `state` is `pending | fulfilled`; target,
cutoff and commitment are non-null because publication requires them and the
published-write guard keeps them. Pending `delivered` counts all historical
attainments, including candidates now discarded or moved elsewhere.

When fulfilled, `business_days_remaining` is null. Delivered count, target, cutoff
and commitment stay frozen at fulfillment (an edit can freeze a delivered count
larger than the target). `fulfillment` is exactly:

```json
{
  "fulfilled_at": "2026-11-20T18:00:00Z",
  "result": "on_time",
  "business_days_delta": 6,
  "target": 5,
  "cutoff_stage_id": "<uuid>",
  "cutoff_stage_name": "Screening OK",
  "commitment_date": "2026-11-30",
  "candidates": [
    {"participation_id":"<uuid>","candidate":{"id":"<uuid>","full_name":"Ana Pérez"},"reached_at":"2026-11-20T17:59:00Z"}
  ]
}
```

The example candidate array is abbreviated: a real fulfillment contains exactly
`target` candidates. Candidate names and cutoff name are frozen, not joined from
current names. Timestamps are RFC3339 UTC; dates are Mexico City civil dates.
Status has no ETag or precondition.

### Preview

`POST …/pipeline/delivery/preview` → 200, exactly:

```json
{"would_fulfill":true,"delivered":3,"target":2,"candidates":[]}
```

The example array is abbreviated. Preview returns **every** candidate delivered
under the proposed cutoff, unique per participation, ordered by `reached_at`
ascending, then `participation_id` ascending. Candidate shape is identical to the
fulfillment shape above. Fulfillment keeps the first `target` of this list.

Body validation is identical to delivery PUT: three required nullable configuration
members (`cutoffStageId`, `targetQuantity`, `commitmentDate`), optional boolean
`confirm_fulfillment`, strict duplicate/unknown/type/Unicode handling, 1–999 target,
current progression cutoff, changed-date window and art. 74 calendar. An unchanged
stored past date is accepted. Preview takes **no If-Match**, never returns 412/428,
and writes no configuration, versions, participations, history, idempotency,
projection, audit or fulfillment. It requires a published, not-yet-fulfilled vacancy.

### Delivery configuration and write summaries

GET/PUT delivery gains **always-present `fulfilled: boolean`**; all previous keys,
independent delivery version and strong ETag remain. PUT gains optional boolean
`confirm_fulfillment` (default false; null/string are invalid). A published edit
that would fulfill without confirmation returns 409 without any writes. With
confirmation it saves configuration and records fulfillment **at edit time**, not
at the old reached time. Both audit events commit in that transaction. After
fulfillment **all** delivery PUTs, including no-ops, are rejected without writes.
The published completeness guard still rejects incomplete writes with 422.
See [cut-3 configuration](pipeline-delivery.md).

GET board root gains `delivery`, exactly `{state, delivered, target}`. The flattened
200 responses of move, discard, recover and substate gain the same object, computed
after the write (including a substate no-op). An event that fulfills returns
`state: "fulfilled"`. Individual board/detail items and candidate APIs do not gain
this private process summary. Coverage/headcount and hiring rules are independent.

## Rules and transaction boundary

| Rule | Implementation |
| --- | --- |
| Reached, §16.1 / DEL-1–3 | First history entry into the cutoff with kind intake, move or recovery. Substate/discard events are not attainments. Process/candidate uniqueness means one person once. Later moves/discards never subtract. |
| Trigger, §16.1 | Actual move/recovery into cutoff, intake into Nuevos when it is cutoff, or a qualifying delivery edit. One fulfillment row per process, no backfill. Review databases evaluate on their next qualifying event. |
| Atomicity | Existing draft → process → participation lock order (intake retains its existing candidate lock first). The transaction-scoped recorder uses the caller's pgx transaction, never a second transaction. Process serialization plus the primary key and conflict-safe insert yield one snapshot and one fulfillment audit. |
| Freeze, CFG-3/7 | Store snapshot includes target, actual delivered count, cutoff ID/name, commitment, timestamp, ordered explaining candidates and result. Future candidate/name/movement changes cannot rewrite it. Delivery PUT rejects before making writes. |
| Result, §16.1 | Compare the fulfillment's America/Mexico_City local date with commitment: on/before is `on_time`, after is `late`. Commitment covers the whole day. |
| Whole business days | Count dates strictly after the earlier endpoint, through the later endpoint inclusive. Positive early, negative late, zero on commitment. A late weekend may have delta 0 while result is still `late`. Art. 74 fixed/movable/transmission holidays and weekends are excluded. No hour rounding. |
| Remaining, §16.2 | Same signed endpoint rule from Mexico City today to commitment; negative past dates; null after fulfillment. |
| Audit | `VacancyDeliveryFulfilled`, actor and vacancy association, immutable JSON `snapshot` metadata. Snapshot is private recruiter-facing evidence, never public projection, candidate API or request logs. Audit failure rolls back the triggering operation too. |

Composition ports in applications avoid sibling-feature implementation imports:
the composition root injects draftstore's recorder and summary reader. All guard,
recording and read queries run inside the existing locked transaction.

## Codes

Errors use exactly `{error,code}` without ETag or private data; the existing
`publication_incomplete` missing-list exception on PUT is unchanged.

| Status | Code | Case |
| --- | --- | --- |
| 400 | `invalid_request` | Strict body/path/type/duplicate keys; PUT malformed If-Match |
| 400 | `validation_error` | Invalid cutoff/target/changed-date window |
| 400 | `non_business_date` | Changed in-window weekend or art. 74 day |
| 401/403/404 | Existing cut-3 gate codes | Authentication, company membership/liveness, owner/principal isolation |
| 409 | `company_not_active` | Transactional live-company gate |
| 409 | `vacancy_not_published` | Status/preview for a draft |
| 409 | `delivery_fulfilled` | Preview or delivery PUT after fulfillment |
| 409 | `fulfillment_confirmation_required` | Proposed published delivery PUT would fulfill without confirmation |
| 412/428 | `version_conflict` / `precondition_required` | Delivery PUT only, not preview/status |
| 413 | `payload_too_large` | Body exceeds inherited 1 MiB budget |
| 422 | `publication_incomplete` | PUT would remove published required values |
| 500 | `internal_error` | Unexpected failure or corrupt stored invariant |

The two new codes are an additive `httpjson` extension; pinned baseline catalog
and architecture guard remain unchanged.

## Migration review unit

00027 adds `process_delivery_fulfillments`, primary/FK process ID, typed frozen
columns, bounded target/result/count shapes and JSONB explaining candidates. No
existing data is rewritten. The partial history index on
`(participation_id, stage_id, created_at)` covers intake/move/recovery first-entry
lookups. Down refuses while **any fulfillment row exists**, preserving schema,
data and migration version. An empty down removes only the new table/index.
Keep migration, its tests, the 00026 version pin and regenerated sqlc model in
the parent's separate migration commit. No retention/deletion decision is made.

## §16 test map

DB tests below are specifications, **not claims of DB execution**.

| Test | Rules/effects |
| --- | --- |
| `TestEvaluationWholeMexicoCityDates` | §16.1 result/whole-day sign, local-midnight boundary, same date, early/late, weekend late with zero delta, all art. 74 holiday categories; §16.2 signed remaining including past dates |
| `TestExactWireKeysAndNulls` | §16.2/16.6 exact status/snapshot/preview/candidate/person keys, null fulfillment and array shapes |
| `TestConfirmationStrictOptionalBoolean` | §16.2 optional omitted/true/false confirmation, null/string/unknown/duplicate rejection; flag not persisted as configuration |
| `TestDelivery_RenderStrictResponseContract`, updated cut-3 flow tests | §16.6.2 seven-key delivery resource including fulfilled; existing independent ETag/calendar/null rules |
| `TestFulfillmentRoutesGatesErrorsAndNoPrecondition`, `TestFulfillmentPreviewIgnoresIfMatchAndKeepsBodyBudget` | §16.2/16.6 real router routes, trusted session identity/body, status/preview exact keys, no ETag/If-Match requirement (malformed If-Match ignored), inherited 413 budget, candidate 403/anonymous 401/foreign 404/draft 409, validation codes, wrapped freeze/confirmation errors, no-store |
| `TestDeliverySummaryAlwaysOnBoardAndWrites`, updated movement/discard/substate wire tests | §16.2/16.6.1 exact three-key delivery summary on board and all flattened writes, including no-op substate |
| `TestFulfillmentHistoricalReachedUniqueAndDiscardRetention` (DB) | §16.1 unique first history attainment across backward/repeated moves, discard/recovery retention, pending/past remaining, preview reads no writes, substates do not count |
| `TestFulfillmentMoveFreezesSnapshotAndAllWritesKeepSummary` (DB) | §16.1 move fulfillment time/result, exactly one row/audit with matching snapshot, §16.2 frozen PUT/no-op/malformed-body and preview rejection with unchanged full snapshots; subsequent move/discard/application/name change cannot change status; resource fulfilled flag and board/write summaries |
| `TestFulfillmentDeliveryEditsPreviewConfirmationAndCandidateOrder` (DB) | DEL-6/7 lower-target and cutoff-change previews, all candidates/tied timestamp UUID order, no preview writes, unconfirmed PUT changes nothing, confirmed edit freezes at edit time with first target candidates, frozen delivered count may exceed target, both audits |
| `TestFulfillmentApplicationIntoNewAndRecovery` (DB) | §16.1 Nuevos intake, recovery trigger at current event with retained original reached time, no backfill, pending value-equal PUT remains a no-op, and one audit |
| `TestFulfillmentStatusPreviewAuthorizationAndValidationNoWrites` (DB) | §16.2 owner scope, real foreign vacancy/missing 404 before body, draft 409, invalid previews leave full storage snapshot unchanged |
| `TestFulfillmentAuditFailureRollsBackTriggerAndSnapshot` (DB) | §16.1 atomic move/intake/recovery/edit, failure specifically on fulfillment audit rolls back config/version/history/participation/idempotency/projection/snapshot/audit |
| `TestFulfillmentConcurrentMovesExactlyOnce` (DB) | §16.1 fixed lock order, forced first winner in both orderings, threshold-crossing response fulfilled, one row/audit and correctly ordered explaining candidates |
| `TestFulfillmentConcurrentApplicationsExactlyOnce` (DB) | §16.1 two concurrent Nuevos applications reaching target, bounded blocking probe, no deadlock, exactly one row/audit and unique explaining candidates |
| `TestMigration00027FulfillmentDefinition`, `TestMigration00027ExistingRowsAndGuardedDown` (latter DB) | §16.3 additive schema/index/no backfill, prior history preserved, duplicate row refused, data/schema/version retained on refused down, empty down preserves existing rows |
| `TestFulfillmentErrorsAreAdditiveAndExact`, route-topology/architecture/closure gates | §16.2 both additive 409 codes and exact envelopes, baseline catalog and architecture preserved |

## Validation boundary

From `backend/`: `go tool sqlc generate`, gofmt on changed Go files, focused tests,
`go test ./... -count=1`, `go vet ./...`, `go vet -tags=integration ./...`.

Focused database commands (run migration rollback tests separately):

```sh
go test -tags=integration ./internal/features/applications/infrastructure/postgres/v2 ./cmd/api -run '^TestFulfillment' -count=1 -v
go test -tags=integration ./db/migrations -run '^TestMigration00027' -count=1 -v
```

They require an **existing isolated loopback database named `draft_test`** through
`DRAFT_TEST_DATABASE_URL`. With it unset, all DB-backed cases explicitly skip;
compilation is not migration/atomicity/concurrency proof. No database was created.
The parent owns isolated-DB execution and every staging/commit action. Browser
review is [queued at row 9](pending-user-review.md).

**Risk:** additive migration/table locks and concurrency-sensitive co-writes;
isolated-DB execution and independent review remain required before approval.
