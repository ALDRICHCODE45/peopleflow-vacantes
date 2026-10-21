# Vacancy lifecycle — L1 API and L2 effects

L1 adds manual lifecycle transitions, private reads, history and audit. L2 applies
publication availability and process editability across existing endpoints. Frontend pairing:
`feat/vacancy-lifecycle-ui`; design: [§21](../../docs/vacancy-lifecycle-design.md).

## Quick path

1. Publish through the existing `POST …/publication` (unchanged draft ETag).
2. Read `GET /v2/me/company/job-drafts/{id}/lifecycle` and retain its `ETag`.
3. POST an action below with that lifecycle `If-Match`, a UUID
   `Idempotency-Key`, and its strict JSON body. All successes return **200**,
   the resulting view, its new `ETag`, and `Idempotency-Replayed: false`.
4. For uncertain network outcomes, retry the same action/body/key. Replay
   returns the original 200 body and ETag with `Idempotency-Replayed: true`,
   even without `If-Match` or after a later transition.

Every route is private and `no-store`, including errors. Authentication and the
existing recruiter/company middleware are unchanged. The store uses publish's
live-user, active-company, current-membership locks and owner-or-principal rule.
Other recruiters and foreign-company drafts get 404 `not_found`; anonymous
requests get 401 and candidates fail the existing company-role gate with 403.

## Routes and transitions

Base: `/v2/me/company/job-drafts/{id}/lifecycle`.

| Method / suffix | Body | Valid source | Result |
| --- | --- | --- | --- |
| GET (base) | — | Any authorized v2 draft | View + lifecycle ETag |
| GET `/history` | — | Any authorized v2 draft | `{ "items": […] }`, newest first |
| POST `/pause` | `{}` | published / active | paused / active |
| POST `/resume` | `{}` | paused / active | published / active |
| POST `/close` | `{"process":"continue","reason":"cancelled","reason_note":null}` | published or paused / active | closed / active |
| POST `/close` | `{"process":"finish","reason":"filled","reason_note":null}` | published or paused / active | closed / finished |
| POST `/finish-process` | `{}` | closed / active | closed / finished |
| POST `/reopen` | `{}` | closed / active **or** finished | published / active |

There is no default close choice, automatic close, transition back to draft,
or lifecycle `publish` action. Publish remains on its existing route. Unknown
keys, duplicate keys, non-object/null bodies and invalid close choices are
400 `invalid_request`. The existing bounded-body transport also applies.

Close requires all three keys: `process: "continue"|"finish"`,
`reason: "filled"|"cancelled"|"other"`, and `reason_note: string|null`.
For `other`, the note must be non-blank after trimming Unicode whitespace and
at most 200 Unicode code points after trimming; the stored note is trimmed.
For `filled`/`cancelled`, it must be null. Shape failures are 400 `invalid_request`.

«Cubierta is allowed only when the required positions are filled.» `filled`
requires a non-null current hiring headcount and current Placement coverage
at least that headcount, using the same query as the board (not historical
milestones or delivery fulfillment). Otherwise the response is 422:

```json
{"error":"close reason not covered","code":"close_reason_not_covered","data":{"covered":0,"required":2}}
```

`required` is null when no headcount is configured. No rejected close writes
state, versions, history, audit or idempotency.

### View

```json
{"publication":"closed","process":"active","version":"4",
 "published_at":"2026-10-16T18:00:00.000000Z","paused_at":null,
 "closed_at":"2026-10-20T18:00:00.000000Z","process_finished_at":null,
 "allowed_actions":["finish_process","reopen"],"close_reason":"cancelled","close_reason_note":null}
```

Exactly ten root keys. Versions are decimal strings, not JSON numbers.
Timestamps are UTC strings with microsecond precision, or null. `published_at`
is the **first publication** and never changes on resume/reopen. Other dates
retain the latest occurrence, even after leaving their state. Reopening does
not erase historical pause, close or process-finish timestamps.
`close_reason` and `close_reason_note` are always present: the latest close's
values while publication is closed, null otherwise (also null for legacy closes).

| State | `allowed_actions` (ordered) |
| --- | --- |
| Never published | `["publish"]` |
| published / active | `["pause","close"]` |
| paused / active | `["resume","close"]` |
| closed / active | `["finish_process","reopen"]` |
| closed / finished | `["reopen"]` |

A never-published draft returns 200, both axes null, version `"0"`, all four
timestamps null, and `allowed_actions: ["publish"]`. Its ETag is
`"vl-<draftId>-v0"`. Publication creates published/active at version 1.
Thereafter each successful transition increments only the lifecycle version.
Content edits do not change lifecycle ETags; transitions do not change draft or
configuration versions/timestamps.

### Preconditions, replay and errors

Store order: **authorization → key/replay → precondition → transition validity
→ body validation → coverage (close) or readiness (resume/reopen)
→ atomic state/history/idempotency/audit write**.
Transport checks (e.g. the request body size cap or malformed path ID) happen
before the store, as on publication.

- UUID key required: 400 `idempotency_key_required` / `invalid_idempotency_key`.
- Scope: company + actor + `vacancy-lifecycle:r1` + normalized UUID key.
  Fingerprints include the draft ID, action and canonical body (including the
  trimmed close note). JSON whitespace is
  immaterial; a changed action, draft or valid-JSON body gives 409
  `idempotency_conflict`. Malformed JSON is still 400. Authorization is always
  rechecked before replay; old successes never bypass revoked access.
- `If-Match`: one strong lifecycle tag `"vl-<draftId>-v<N>"`.
  Missing → 428 `precondition_required`; well-formed mismatch → 412
  `version_conflict`; malformed/weak/list/wildcard/draft tags → 400
  `invalid_request`. Replay runs before these checks.
- Invalid transition → 409 `lifecycle_transition_invalid`:

  ```json
  {"error":"lifecycle transition invalid","code":"lifecycle_transition_invalid",
   "data":{"action":"pause","lifecycle":{"publication":"closed","process":"active","version":"4","published_at":"2026-10-16T18:00:00.000000Z","paused_at":null,"closed_at":"2026-10-20T18:00:00.000000Z","process_finished_at":null,"allowed_actions":["finish_process","reopen"],"close_reason":"cancelled","close_reason_note":null}}}
  ```

- Resume/reopen run the shared published-write readiness guard: every readiness
  rule except `commitment_date_past`. Failure is 422 `publication_incomplete`
  through `httpjson.WritePublicationError`, with **root** `missing`, never
  `data.missing`:

  ```json
  {"error":"publication requirements missing","code":"publication_incomplete",
   "missing":["hiring_headcount_missing"]}
  ```

All rejected operations leave state, versions, history, audit and idempotency
unchanged. A shared draft lock serializes lifecycle with content/configuration
writers. Racing distinct-key transitions on one ETag yield one write and one
412; racing identical keys yield one write and one replay.

## History, audit and preservation

History has no publication entry and is separate from participation history:

```json
{"items":[{"id":"<event UUID>","action":"close","process":"finish",
 "actor":{"id":"<user UUID>","name":"Recruiter name at transition"},
 "created_at":"2026-10-20T18:00:00.000000Z","reason":"filled","reason_note":null}]}
```

Each item has seven keys. `reason` and `reason_note` are always present, null
except on close (and null on legacy closes). `process` is the explicit
`continue|finish` choice on close, null on other entries. `action` uses `finish_process` (underscore); its URL uses
`finish-process`. Names are retained snapshots, unaffected by later renames.
Ordering is timestamp descending, then lifecycle version descending for ties.
Never-published drafts have `items: []`. History has no ETag/replay header.

One audit event is emitted per transition: `VacancyPaused`, `VacancyResumed`,
`VacancyClosed`, `VacancyProcessFinished`, `VacancyReopened`, respectively.
Close-with-finish emits `VacancyClosed` with resulting process `finished`;
`VacancyProcessFinished` belongs to the separate action. Entity is
`vacancy_process`; metadata contains `version`, `publication`, `process`, plus
`reason` on close, never the note. Actor ID is in the audit actor column;
actor names stay out of audit/logs.
Audit failure rolls back all transition writes.

Reopen retains pipeline, candidates, participation history, coverage and frozen
delivery fulfillment; finishing does not manufacture a fulfillment snapshot.

## Storage

Migration **00034** widens publication status, adds process status/version and
four timestamp fields (the existing `published_at` plus three new columns),
and creates `vacancy_lifecycle_events`. CHECKs enforce the closed vocabularies,
positive versions, close-choice shape and **finished ⇒ closed**. Existing rows
become published / active / v1 without changing their publication data.
Down refuses any non-published/active row **or any lifecycle history**, locking
the affected tables before checking. It does not silently erase lifecycle data.

Migration **00035** adds nullable reason/note to lifecycle events with vocabulary,
non-close-null, other-note-required and 200-character constraints. It restores
process `published_at` from `vacancy_public_projections.published_at`: the
projection upsert (`db/queries/vacancy_public_projections.sql`) deliberately
excludes that column from content updates. Public listing order is unchanged.
Current close reasons are read from the latest close event by lifecycle version,
only while closed, avoiding duplicated state on the process row. Down locks
history and refuses recorded reasons; clean rollback removes the columns but
retains repaired first-publication dates.

## L2 — effects on existing endpoints

| Surface | Contract |
| --- | --- |
| Public list/search | Unchanged: only published, live-company vacancies |
| Public detail and screening | Paused/closed → 410 `vacancy_unavailable`, exactly `data: {id,title,company:{id,name},availability:"paused"|"closed"}`; no content, compensation or screening. Draft/unknown/malformed/inactive-company → existing 404 |
| Apply | Locks → idempotency replay/conflict → availability → G4 country → screening/CV/duplicate. Paused/closed → 409 `vacancy_not_accepting_applications`, exactly `data:{availability}`. Earlier successes still replay after pause/close; rejections write nothing |
| Move/discard/recover/substate | Any publication with active process is editable; finished → 409 `process_finished`, exactly `data:{lifecycle:<current view>}` |
| Pipeline PUT/preview, substates PUT, delivery PUT, management PUT | Same finished-process conflict, before configuration validation/preconditions; no writes |
| Board/detail/history/CV, lifecycle and configuration GETs | Remain readable when finished |
| Content PATCH | Remains allowed, retaining existing readiness/projection guards; hidden projection stays hidden |
| Candidate list | Adds `vacancy.state:"open"|"closed"`; closed **only** for finished process. Application status/message semantics are unchanged |
| Company draft list | `status: draft|published|paused|closed`; new always-present `process:null|"active"|"finished"`. Paging/order unchanged |

Editor `GET /v2/me/company/job-drafts/{id}`, board GET and pipeline GET embed the
same ten-key view as root `lifecycle`. Their existing ETags (or absence for the
board) are unchanged; use lifecycle GET for the lifecycle precondition tag.
Create/PATCH and pipeline PUT response/replay shapes stay unchanged.

Availability is read in a **fresh statement after the draft lock**, not from the
join that may have waited on that lock (the G4 snapshot-race fix pattern).
Board writes lock draft → process → participation, and check process state after
those first two locks. Configuration guards likewise read the process only after
the parent draft lock shared with L1 transitions. Concurrent finish cannot be
missed through a pre-wait process snapshot. Finishing remains distinct from
fulfillment: reopening unfreezes the process but never unfreezes its delivery
snapshot.

## Verification map

| Test file | Evidence |
| --- | --- |
| `db/migrations/vacancy_lifecycle*_test.go` | Shape, backfill, state/event CHECKs, guarded down |
| `internal/features/jobs/application/lifecycle/*_test.go` | Complete state/action matrix, ETags, precision and retained timestamps |
| `internal/features/jobs/infrastructure/postgres/draftstore/lifecycle*_test.go` | Strict bodies/fingerprints; DB transitions/rejections, replay, races, authorization/live gates, readiness, history/actor/audit, rollback and preservation |
| `cmd/api/lifecycle*_test.go` | All seven routes, NoStore/headers, error envelopes, candidate denial and real DB-backed HTTP flow |
| `internal/shared/httpjson/lifecycle*_test.go` | Additive catalog, exact effect data and fail-closed writer |
| `cmd/api/lifecycle_effects_integration_test.go` | Exact public tombstones, live-company/404 gates, list exclusion, embedded views, company list and finished-configuration conflicts; no-write snapshots |
| `applications/infrastructure/postgres/v2/lifecycle_apply_integration_test.go` | Replay/availability precedence, no-write rejections, forced pause/close/resume while apply waits on draft lock |
| `applications/infrastructure/postgres/v2/lifecycle_board_integration_test.go` | Active-any-publication moves/discard/recovery/substate, finished read-only/CV/candidate state, forced move vs finish-process lock ordering |

DB tests use the existing integration build tag and isolated-DB harness. They
must be run by the parent on its isolated DB; compiling them is not evidence of
passing database behavior. Browser review: publish → pause → resume → both close
choices → finish separately → reopen finished; try stale tabs, incomplete
resume/reopen, principal vs other recruiter, and retained history/fulfillment.
