# Private draft delivery configuration API (cut 3)

`GET` and `PUT /v2/me/company/job-drafts/{draftId}/pipeline/delivery` configure the
cutoff column, delivery target and commitment date independently of columns,
substates and draft fields. The accepted contract is
`docs/pipeline-customization-design.md` §8; that document wins over this reference.
This cut does not publish drafts, move candidates, evaluate fulfillment or freeze
configuration. All three values may be null while editing a draft.

## Quick path

1. GET delivery and retain its opaque strong ETag. Read column IDs from GET `…/pipeline`.
2. PUT exactly the three nullable fields with that delivery ETag in `If-Match`.
3. Use the returned version, ETag and calendar. After a timeout, reconcile with GET;
   do not retry automatically. No `Idempotency-Key` or `Idempotency-Replayed` is used.

## Identity and caching

Both methods return `200 OK`. The same `NoStore` → auth → recruiter membership
gates as cuts 1–2 apply. Every response, including rejected responses, carries
`Cache-Control: no-store`. Identity comes only from session `CompanyContext`, not
client identity headers. The store rechecks live user/company/membership, then
owner-or-principal draft access **before** comparing preconditions or decoding JSON.
Missing, foreign, non-principal and schema-1 drafts are hidden as `404 not_found`.
Malformed path UUIDs return `400 invalid_request` before calling the store.

## Exact response contract

```json
{
  "version": "0",
  "cutoffStageId": null,
  "targetQuantity": null,
  "commitmentDate": null,
  "limits": { "maxTargetQuantity": 999 },
  "calendar": {
    "timeZone": "America/Mexico_City",
    "today": "2026-10-16",
    "minDate": "2026-10-16",
    "maxDate": "2027-10-16",
    "nonBusinessDates": ["2026-10-17", "2026-10-18", "2026-10-24"]
  }
}
```

The exclusion array above is abbreviated for readability; the server returns
**every** non-business date in the inclusive range, ascending, once each, never
null. Dates are `YYYY-MM-DD`, not timestamps. Root keys are exactly the six shown;
`limits` has exactly `maxTargetQuantity`; `calendar` has exactly the five shown.
Adding a response key is a contract change.

`version` is a decimal string. Version `"0"` means all-null values with no stored
row. GET never materializes settings. The strong opaque delivery ETag is bound to
the draft ID and independent delivery version; clients never construct or parse it.
It cannot be used as a draft, pipeline or substate tag, nor vice versa.

## PUT — full replacement

```json
{
  "cutoffStageId": "<progression stage UUID from GET pipeline>",
  "targetQuantity": 5,
  "commitmentDate": "2026-11-30"
}
```

All three keys are required, each individually nullable; any combination may be
saved **while draft**. Once published, missing required values return
`422 publication_incomplete` with ordered `missing` codes (§10.2). Unknown, missing or duplicate keys (including escaped equivalents), wrong
JSON types, fractional numbers, invalid UTF-8/surrogates, malformed/trailing JSON
and malformed date strings return `400 invalid_request`. The shared strict numeric
decoder accepts mathematically integral JSON spellings, never rounds fractions.

| Field | Save rule (§8.1) |
| --- | --- |
| `cutoffStageId` | Null or an existing progression stage in the pipeline read inside the same locked transaction; never the discarded exit. Stored and deterministic default IDs are supported. |
| `targetQuantity` | Null or integer 1–999 inclusive. |
| `commitmentDate` | Null or a business date in `[today, today + 1 year]` when new or changed. Same calendar date next year, clamping 29 February to 28 February. |

A stored date returned **unchanged** is accepted even if it is now past or outside
the window. Clearing it is valid only while draft. Initial publication enforces
CFG-11; published writes exempt `commitment_date_past` but cannot clear any
required value. A rejected replacement commits no config/version/audit/projection
change. See [public-jobs-v2.md](public-jobs-v2.md). A changed out-of-window date is `400 validation_error`; a changed
in-window weekend/holiday is `400 non_business_date`.

### Calendar (§8.2)

The adapter injects the clock instant into the pure model and evaluates today in
`America/Mexico_City`, not the viewer's zone. `cmd/api/timezone.go` embeds tzdata so
minimal containers need no installed zone files. Business days are Monday–Friday,
excluding art. 74 LFT mandatory rest days:

- 1 January, 1 May, 16 September, 25 December;
- first Monday of February, third Monday of March and third Monday of November;
- 1 October in 2030, 2036, … (`year > 2024 && (year - 2024) % 6 == 0`).

Election days are already Sundays. There are no organization calendars. A law
change requires a backend rule change and a design note. The client disables only
the supplied dates. A stored old date may be shown with a warning and sent back
unchanged. If today changes while the editor is open, the server's `400` wins.

### Preconditions, versioning and no-ops

`If-Match` accepts exactly one nonempty strong delivery tag. Missing is `428`;
empty, weak, wildcard, list (including repeated header lines) or malformed is `400
invalid_request`; a well-formed stale/foreign tag is `412 version_conflict`.
The raw body budget is 1048576 bytes; over-budget is `413`, never truncation.

The first successful PUT creates version `"1"` and one audit event, **even all-null**.
Later value-equal PUTs return `200` with the same version and ETag, no write and no
audit; the calendar is evaluated for the current request. A changing PUT increments
only delivery version. Draft, pipeline, substates and delivery versions/ETags are
four-way independent. Concurrent first PUTs serialize: one winner, one `412`.

## Cutoff deletion guard on the pipeline route

A pipeline PUT omitting the custom column stored as the cutoff returns `409
cutoff_stage_in_use`, with **no** configuration, version or audit change. Renaming
or reordering it is allowed. Clear/replace the delivery cutoff before deleting its
column. Both writes lock the same draft row, so the validation cannot race.
The error body remains exactly `{ error, code }`, without a column ID; a client
that did not expect the cutoff re-reads GET `…/delivery`.

## Persistence and audit

Migration `00017_create_job_draft_delivery_configs.sql` adds one optional row per
draft, cascade-FK/primary `draft_id`, positive BIGINT `version`, nullable UUID
`cutoff_stage_id`, INTEGER `target_quantity` with CHECK 1–999 and DATE
`commitment_date`. No existing data is rewritten. The store locks the parent draft
before reading either delivery or pipeline and co-writes delivery/version/audit in
one transaction. Audit failure rolls back everything.

Every materializing/changing PUT emits one `JobDraftDeliveryConfigured` with actor,
draft association and metadata `version`, `previous`, `new`. Snapshots contain
exactly the three nullable values as JSON documents encoded as strings by the
existing audit port; response limits/calendar are not audit data.

**Risk — migration (item 1):** down removes saved delivery settings, not parent,
pipeline, substates or audit history. It is not a data-preserving rollback.
**Risk — cut-1 change (item 3):** the intentional new deletion guard is documented
also in [pipeline-config.md](pipeline-config.md).

## Status codes

Except `publication_incomplete`, errors contain exactly `{ "error": string, "code": string }`, without details,
stage IDs, data or ETag. Shared error mapping is reused. The additive pipeline
codes are registered in `httpjson.Resolve`; `PipelineErrorCodes` enumerates them
separately so the pinned baseline V1 `ListCodes` and its tests remain unchanged.

| Status | Code | Case |
| --- | --- | --- |
| 400 | `invalid_request` | Strict JSON/key/type/date decoding, malformed path or If-Match |
| 400 | `validation_error` | Unknown/discarded cutoff, target range, changed date outside window |
| 400 | `non_business_date` | Changed in-window date on a weekend or art. 74 day |
| 401 | `unauthenticated` | Missing/invalid token or no live user |
| 403 | `forbidden` | Missing membership / insufficient role |
| 403 | `company_inactive` | Missing/tombstoned company |
| 404 | `not_found` | Missing/foreign/non-principal draft after general gates |
| 409 | `company_not_active` | Company not active at transactional guard |
| 409 | `cutoff_stage_in_use` | On pipeline PUT: omitted custom cutoff column |
| 412 | `version_conflict` | Stale/foreign strong tag |
| 413 | `payload_too_large` | Raw body exceeds budget |
| 422 | `publication_incomplete` | Published write would leave requirements missing; exactly `{error,code,missing:[codes]}` |
| 428 | `precondition_required` | Missing If-Match |
| 500 | `internal_error` | Unexpected failure, corrupt storage or version overflow |

## Test map

Database-backed tests require `-tags=integration`. This table describes assertions,
not a claim those tests ran against a database.

| Test(s) | §8 rules and observable effects |
| --- | --- |
| `TestIsBusinessDay_Article74`, `TestNonBusinessDates_InclusiveAscendingUnique` | §8.2: pinned 2026/2027 movable/fixed dates, 2030/2036 transmission, 2026 October business day; weekends, inclusive sorted exclusions, overlapping holidays once, empty ranges |
| `TestReplace_StrictDocument` | §8.3: strict required/unknown/duplicate keys, JSON types, fractions, malformed dates/encoding → invalid_request; payload budget → 413 |
| `TestReplace_ValidationAndDateOnChange` | §8.1: nulls, every default progression kind, unknown/discarded cutoff, target 1/999 boundaries, window, weekends/holiday → validation_error/non_business_date; unchanged past/future dates and clearing accepted; current input unchanged |
| `TestReplace_NullCombinationsCustomCutoffAndCanonicalNoOp` | §8.1/§8.3: all eight nullable combinations, custom cutoff, canonical UUID no-op, exact integral JSON numbers |
| `TestCalendarAt_MexicoCityAndLeapClamp`, `TestEqual`, `TestETag_IndependentOpaqueStrongPrecondition` | §8.1/§8.3: Mexico City vs UTC today, leap clamp/inclusive maximum, calendar keys, value no-op and independently strong ETags |
| `TestDelivery_RenderStrictResponseContract` | §8.3: actual rendering has exact root/calendar/limits keys, nulls, version, ETag and every exclusion |
| `TestMigration00017DeliveryDefinition`, `TestMigration00017DeliveryUpDown` | §8.4: additive migration, typed nullable columns, primary/cascade-FK/positive-version/target constraints, down removes only delivery |
| `TestDelivery_PureGetFirstNullPutNoOpAndAudit` | §8.3: pure GET, version 0, first all-null version 1/actor/snapshots/one audit, stored no-op leaves all persisted effects unchanged |
| `TestDelivery_ChangesDateOnChangeAndFourWayVersionIsolation` | §8.1/§8.3: default cutoff, changing saves and clearing, unchanged past date, exact actor/previous/new audit and four-resource version/body independence |
| `TestDelivery_RejectionsAreAtomicAndAuthorizeBeforePreconditions` | §8.1/§8.3: 400/404/412/413/428 errors, cross-resource tags, live authorization before preconditions; full draft/pipeline/substates/delivery/audit snapshots unchanged |
| `TestDelivery_ConcurrentFirstPutsHaveOneWinner` | §8.3: one success, one conflict, one version-1 row, one audit |
| `TestDelivery_CustomCutoffRemovalBlockedRenameAndReorderAllowed` | §8.1: stored custom cutoff, rejected pipeline omission changes nothing, rename/reorder accepted, cleared cutoff removable, removed ID rejected |
| `TestDelivery_AuditFailureRollsBackFirstAndLaterPuts`, `TestDelivery_LiveGatesCorruptionAndOverflowFailClosed` | §8.3: first/later audit rollback, live user/company/membership, corrupt DATE and version overflow return no data/change |
| `TestPipelineErrors_CatalogEnvelopeAndRecordedCode`, `TestPipelineErrors_ExtensionListIsIndependentAndDefensive` | §8.3: both new codes/statuses, exact two-key envelopes, no generic conflict data, catalog code recording |
| `TestDeliveryRoutes_*`, `TestRouteTopology_ExactRegistrations` | §8.3: real router success/errors 200/400/401/403/404/409/412/413/428/500, wrapped field-specific errors, no-store throughout, session-derived identity, full If-Match forwarding, exact routes |
| `TestDeliveryFlow_FirstNullSaveLifecycleNoOpAndFourWayVersionIsolation` | §8.3: real auth/router/store, nullable lifecycle, response strict keys/ETags/calendar, pure GET/no-op storage snapshots, audit counts, independent versions |
| `TestDeliveryFlow_RejectedRequestsLeaveEveryPersistedEffectUnchanged` | §8.1/§8.3: strict decoding/date/cutoff/target/precondition/auth errors; status/code/exact keys/no ETag/no-store and all persisted effects unchanged on each rejection |
| `TestDeliveryFlow_PipelineCutoffConflictIsAtomicRenameAndReorderAllowed` | §8.1/§8.3: real pipeline 409 with exact envelope and no persisted change; cutoff rename/reorder preserves delivery |

## Validation commands

From `backend/`:

```sh
go tool sqlc generate
go test ./internal/features/jobs/application/businesscalendar ./internal/features/jobs/application/deliveryconfig ./internal/features/jobs/application/pipelineconfig ./internal/features/jobs/infrastructure/postgres/draftstore ./internal/features/jobs/infrastructure/http ./internal/shared/httpjson ./cmd/api ./db/migrations -count=1
go test ./... -count=1
go vet ./...
go test -tags=integration ./internal/features/jobs/infrastructure/postgres/draftstore ./cmd/api -run '^Test(Delivery|Pipeline|Substates)' -count=1 -v
# Separate invocation: down tests must not race with store/API packages.
go test -tags=integration ./db/migrations -run '^TestMigration0001[567]' -count=1 -v
```

Integration tests guard for a loopback database named `draft_test`, use only
`DRAFT_TEST_DATABASE_URL` and skip explicitly when unset. Do not create a database
or substitute ambient `DATABASE_URL` as part of these commands.
