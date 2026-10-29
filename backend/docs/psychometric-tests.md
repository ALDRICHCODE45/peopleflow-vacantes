# Vacancy psychometric assessments (B3–B10)

Employers can save a private, vacancy-scoped profile for `ipip60-mx` and manage
invitations and issue single-display links. Stage entry can automatically create invitations.
These slices collect consent and answers and expose audited employer-only
results, but do not deliver messages or move/reject anyone. Completion stores immutable scoring snapshots. The authoritative wire contract
is [psychometric-tests-v1](../../docs/contracts/psychometric-tests-v1.md).

## Read, edit, save

1. `GET /v2/me/company/job-drafts/{id}/psychometric-profile` returns `200`
   with the profile and a strong, opaque, hashed `ETag` (`"pp1-…"`).
2. Send a full replacement with `PUT` to the same path and that exact tag in
   `If-Match`. Omit the server-owned `version` and `confirmed_at` keys.
3. Use the returned `200` profile and ETag for the next edit. A stale tag is
   `412 version_conflict`; refetch before retrying. Identical normalized saves
   change neither the version nor the audit log (including unsaved defaults).

Every response is `Cache-Control: no-store`. Both routes use the checklist's
recruiter membership and owner-or-principal gates: foreign, unknown and
non-principal vacancies are `404`. Draft, published, paused and closed-but-ongoing
processes remain editable; a finished process rejects PUT with
`409 process_finished`, while GET remains available.

## Profile fields

| Field | Behavior |
| --- | --- |
| `version` | Server decimal counter, `"0"` before any changed save; independent of draft/pipeline versions. |
| `enabled` | Boolean, default false; independent of confirmation. |
| `test` | Only `ipip60-mx`. |
| `confirmed` | Writable boolean, default false. |
| `confirmed_at` | Server RFC 3339 timestamp, null while unconfirmed. |
| `competencies` | Exactly one entry per each of the seven embedded catalog IDs, including `comp.presion`. Defaults follow catalog order. |
| `auto_send_stage_ids` | Array of distinct current progression-stage IDs of this vacancy's pipeline; exit/retired/foreign/unknown stages are invalid. Default `[]`. GET silently hides stages no longer current, without rewriting storage/version. B6 creates invitations on configured stage entry. |
| `expires_in_days` | Integer 1–30 inclusive, default 7. |

Each competency entry has exactly `competency_id`, `importance`, `desired_band`,
`rationale` and `task`. Importance is `importance.clave`, `importance.importante`
or `importance.no_relevante`. No relevante requires null `desired_band`,
`rationale` and `task`, even in drafts; any non-null value yields that field's
`not_allowed` error. Never-saved defaults use these three nulls. Clave and
Importante require `band.low`, `band.medium` or `band.high`.

Text is trimmed and counted as Unicode characters. Rationale is at most 1000
characters and a Clave task at most 300. Clave/Importante rationale must always
be a string: `""` is allowed while drafting; null is `invalid` in drafts and on
confirmation. Confirmation requires 1–1000 characters after trim (`required`
for an empty or whitespace-only string).
Only Clave accepts a task: null/empty is allowed while drafting, but confirmation
requires 1–300 trimmed characters. Importante, like No relevante, requires null
task in every state; non-null is `not_allowed`. Confirming an all-No-relevante
profile needs no rationale or task.
A save with `confirmed: false` clears `confirmed_at`, including when requirements
change. Explicit `confirmed: true` confirms changed requirements at server time;
identical confirmed saves retain their timestamp. Non-requirement edits preserve
that timestamp when `confirmed` remains true.

## Errors and audit

- Missing `If-Match`: `428 precondition_required`.
- Empty, malformed, weak, wildcard, repeated or list tag: `400 invalid_request`.
- Well-formed mismatching tag: `412 version_conflict`.
- Invalid profile: `400 validation_error`, `fields[]` with `field` and one of
  `required`, `invalid`, `too_long`, `duplicate`, `not_allowed`. Stage errors use
  `auto_send_stage_ids[k]`. Unknown keys, including server-owned keys, are
  `not_allowed`; malformed JSON and duplicate JSON keys are `invalid_request`.

Changed replacements co-write `JobDraftPsychometricProfileConfigured` on the
`job_draft` entity, with `version` and complete JSON-string `previous`/`new`
snapshots, in the same transaction. Rejected saves and no-ops write nothing.
The shared parent lock serializes profile saves with pipeline and lifecycle
changes. Migration `00049` creates only `job_draft_psychometric_profiles`, linked
to the company-scoped draft; its Down refuses to remove retained profiles.

## Employer invitations (B4)

All paths below start with `/v2/me/company/job-drafts/{id}`. They use the
board's recruiter membership and owner-or-principal gates, with `no-store` on
successes and errors. Unknown/foreign vacancies, participations and invitations
are `404 not_found`. Invalid target UUIDs are also `404`; an invalid vacancy UUID
is `400 invalid_request`. All writes reject a finished process with
`409 process_finished`; paused or closed-but-ongoing processes remain writable.
No `If-Match` or request body is needed.

| Method/path | Response |
| --- | --- |
| `GET /psychometric-invitations` | `200 {"items":[Invitation]}`, latest invitation per participation across the vacancy, ordered by participation ID; no result data. Empty (including unpublished vacancies) is `[]`. |
| `POST /participations/{pid}/psychometric-invitations` | `201 Invitation` when new, `200` with the unchanged existing active invitation on retry. |
| `POST /psychometric-invitations/{iid}/reminders` | `200 Invitation`, sets `last_reminded_at` and increments `reminder_count` on every call. Records only; sends no message. |
| `POST /psychometric-invitations/{iid}/revoke` | `200 Invitation`; repeat revocation is a no-op, including no second audit. |

Creation requires an enabled profile, not confirmation (`409 profile_disabled`
otherwise). Discarded/exit-stage participations give `409 participation_inactive`.
A finished, non-revoked assessment gives `409 already_finished`. Retakes of a
non-revoked finished assessment are not supported. Reminder writes reject
finished, expired or revoked invitations with `409 invitation_closed`.

An Invitation has the contract's exact status-only shape, including nullable
`created_by: {id, full_name}` and `trigger_stage_id`, pinned test/content/scoring
versions and `total_count` (63). B4 creates `origin: manual`, with the current
recruiter as creator, no trigger stage, zero answers/reminders and no token hash.
Creator names are resolved from users on read. Later profile saves do not change
existing invitation versions or expiry; new expiry is creation time plus the
profile's `expires_in_days` (1–30, default 7).

### Computed status and active uniqueness

Status precedence is revoked → finished → expired → in_progress → created.
Expiry applies when server time **now >= expires_at** unless finished/revoked;
consent alone establishes in_progress. No status column is persisted.

Migration `00050` uses an immutable partial unique index on
`(participation_id, test)` where `finished_at`, `revoked_at` and `superseded_at`
are null. PostgreSQL cannot put a current-time expiry check in that predicate.
Under the participation row lock, creation first checks for a non-revoked finish
and a still-active invitation, then sets `superseded_at` on an expired slot before
inserting its replacement. Both changes and the audit commit together. This
preserves the old invitation's **expired** status (not revoked), answers and
retention anchor. Expiry does not require a scheduler, and rejected writes never
release a slot. The index is conservative: an expired row occupies its slot
until a replacement needs it. A second partial unique index independently
forbids two non-revoked finished invitations.

All future writers (including B6 auto-send and B7 candidate writes) must retain
this protocol and the draft → process → participation → invitation lock order.
Two concurrent manual sends yield one 201 and one 200 for the same invitation.
The server samples `clock_timestamp()` after acquiring write locks, avoiding
stale transaction-start time after lock waits. Timestamps use UTC and database
microsecond precision.

### Retention and audit

`purge_after` is set at creation to `expires_at + 12 calendar months`. Revoking
an unfinished invitation changes it to `revoked_at + 12 calendar months`;
revoking a finished one preserves its finish-based anchor. Reminders, retries
and expiry-slot supersession do not restart retention. UTC calendar arithmetic
clamps leap-day anniversaries to the last valid day. B7 will set the finish-based
anchor; B10 executes the one-shot purge described below.

`PsychometricInvitationCreated`, `PsychometricReminderRecorded` and
`PsychometricInvitationRevoked` are co-written in the mutation transaction on
`psychometric_invitation`, with actor, vacancy and participation IDs. They
contain no candidate answers or tokens. An audit failure rolls back every row
change, including expired-slot release. The migration Down locks the invitation
table and refuses rollback while any invitation remains. A nullable, 32-byte,
unique-when-present `token_hash` is reserved for B5; B4 never sets it.

## Employer links (B5)

`POST /v2/me/company/job-drafts/{id}/psychometric-invitations/{iid}/link`
returns `200 {"token":"…","expires_at":"RFC 3339"}` with
`Cache-Control: no-store`. It uses the same recruiter/vacancy gates and requires
no body or `If-Match`. Unknown/foreign invitations or vacancies are `404`;
finished processes are `409 process_finished`; finished, revoked or expired
invitations are `409 invitation_closed`. Expiry is checked using server wall
clock time after acquiring the B4 locks.

Each successful call generates 32 fresh bytes with `crypto/rand` and encodes them
as unpadded base64url (43 ASCII characters). **The stored SHA-256 is over the
43 encoded ASCII/UTF-8 bytes exactly as sent in `token`, not the decoded random
bytes.** Only that 32-byte digest is persisted in `token_hash`. The frontend
composes its own `/evaluacion/{token}` URL. Do not log the token, put it in audit
metadata or errors, or persist it client-side. It is returned only on mint.

The hash replacement and `PsychometricLinkIssued` audit (actor and invitation,
with existing vacancy/participation metadata) commit in one transaction. Audit
failure rolls back the replacement. A previous token becomes unavailable as soon
as the new hash commits; concurrent issuers leave only the last committed token
valid. Progress, account access, invitation expiry and retention are unchanged.

`InvitationsStore.LookupToken` is available internally but **has no public route**
until B7. It accepts exactly 43 base64url characters, hashes the same wire bytes,
and executes the same query shape for every input. Malformed, unknown, revoked
and expired tokens return `uuid.Nil` and the identical `ErrUnavailable`; database
failures remain internal errors. This is not a constant-time database guarantee.
Candidate writes must recheck availability under the B4 lock order; lookup alone
does not authorize a later write. B7/B8 own public responses, headers and limits.

## Automatic invitations (B6)

Board moves, discard recovery, manual intake and candidate apply call the optional
applications-owned `StageEntryHook` in their existing transaction, after updating
or inserting the participation and its history. Nil hooks are no-ops. Production
wiring injects the psychometrics implementation; applications never imports its
infrastructure. Pipeline relocation/not-applicable history and substate changes
never call the hook. The board move response is unchanged: refetch the invitation
list after a move.

Only an enabled profile and a configured **current progression stage** create an
invitation. Retired stage IDs, discarded/exited participations, existing active
invitations and non-revoked finishes silently skip creation. Confirmation is not
required. Automatic and manual creation reuse one slot/pinning/expiry/retention
function, including expired-slot supersession; no token or delivery is generated.
Automatic invitations have `origin: auto`, `created_by: null`, and the entered
`trigger_stage_id`.

`PsychometricInvitationCreated` uses `actor_type: system`, `actor_id: null` for
all automatic entries, even recruiter-caused moves. This records the automatic
policy decision rather than misattributing creation; the separate move/recovery/
intake audit retains its human actor. Vacancy and participation metadata follow
B4. Audit or database failures roll back the stage/history and invitation together.

Lock order remains **draft → process → participation → invitation**. Apply and
manual intake own newly inserted participation rows; move/recovery lock existing
rows before calling. The hook never acquires a draft/process lock or opens or
commits a transaction. Its jobs adapter only reads current stages using the
existing pipeline reader, so it cannot invert manual send's parent-first locks.
Profile/pipeline writers share the caller's draft lock.

## Candidate access (B7)

Public `/v2/assessments/{token}` and account `/v2/me/assessments/{iid}`
share the same pinned assessment. Account access uses the live candidate role
and participation candidate ID, never a token. Every registered candidate
response, including authentication and validation errors, has `Cache-Control:
no-store` and `Referrer-Policy: no-referrer`. Observability records route patterns,
never tokens. Public malformed, unknown, revoked and expired links produce the
same `404 assessment_unavailable` envelope and headers.

- `GET {base}` returns company/vacancy, 10 estimated minutes, computed status,
  answer counts, expiry and the pinned notice version/text/hash (null after consent).
- `POST {base}/consent` accepts only `notice_version` and `text_sha256`;
  mismatch is `409 notice_changed`. Acceptance sets in_progress and stores a
  separate consent row plus `PsychometricConsentGiven` atomically. Identical
  acceptance is a no-op. Public consent uses system actor; account consent uses
  the existing user actor convention (candidate user ID). Metadata contains only
  vacancy/participation IDs; the audit vocabulary has no `candidate` actor type.
- `GET {base}/items` requires consent and returns scale labels and 63 ordinary
  `{position,text,value}` prompts in pinned order. No keys, facets, original
  item numbers or attention identity leave the backend.
- `PUT {base}/answers/{position}` requires UUID `event_id`, integer `value`
  1–5 and optional integer `client_elapsed_ms` 0–3,600,000. Omitted elapsed
  replaces prior timing with null. Unknown keys are `400 validation_error`
  (`fields[].code: not_allowed`); malformed/duplicate JSON is `400 invalid_request`.
- `POST {base}/finish` needs no body. It requires consent and all 63 positions;
  missing answers yield `422 incomplete` with sorted `data.missing_positions`,
  without changing rows, counters, snapshots or audit. Success returns only
  `200 {"status":"finished"}`, never scores. Duplicate finishes and all later
  candidate writes return `409 assessment_finished` on both access paths.
- `DELETE {base}/answers/{position}` accepts only UUID `event_id` and clears
  value/timing. Both answer methods return empty `204`. Invalid or out-of-range
  positions are `404 not_found`, following the existing target-ID convention.
  Replayed IDs are no-ops across methods and positions while still writable.
  Accepted same-value PUTs refresh timing without changing answered_count;
  deleting an empty position does not decrement it. All accepted new events
  are retained, including these no-op value transitions, for B2 to classify.

Each write locks draft → process → participation → invitation, samples server
wall-clock time after locks, and rechecks token rotation, expiry, revocation,
finish and consent. Account closed writes are `409 invitation_closed`; finished
writes are `409 assessment_finished` on both paths. Replays pass the same gates.

`GET /v2/me/assessments` returns only the latest per participation/test, excludes
superseded rows, uses the public vacancy title, and never includes scores.
Organic `application_id` is the participation ID; manual is null. Answerable
rows come first by expiry/id ascending; other rows use creation/id descending.

Migration `00051` separates consent, current nullable answers and ordered events
(unique event UUID and server sequence per invitation), plus immutable result
and comparison snapshots. Its existing schema needs no change for finish.
Down refuses retained assessment data.

Finish reuses the B2 scorer inside the same locked transaction, using the pinned
artifact, final answers and accepted events in server-sequence order. The shared
draft lock serializes profile saves: the current confirmed profile, independent
of enabled, supplies comparison authority. An unconfirmed profile yields null
profile_version and null profile_snapshot, with exploratory guide only.

`psychometric_results.snapshot` is the complete immutable B2 `Result` JSON,
including its original `latest_comparison`. The separate initial comparison row
stores B2 `Comparison` JSON plus its ID/time/version columns and the full confirmed
profile snapshot (including version, rationale and task). B9 must select the
latest comparison row when assembling a report, not treat the result's embedded
initial comparison as mutable latest state. Later profile edits never rewrite
either snapshot. Content/scoring versions are stored on both rows.

Result, comparison, finished_at, finish-based purge_after (12 calendar months in
UTC), and `PsychometricAssessmentFinished` audit commit atomically. Actor and
PII-free metadata follow consent conventions. An audit failure rolls everything
back. Concurrent finishes serialize under the invitation lock: one succeeds,
the other gets assessment_finished, leaving exactly one result/comparison/audit.
Notice review is still required before release.

## Public rate limits (B8)

Only the public token prefix `/v2/assessments/{token}/…` is limited; the
account prefix `/v2/me/assessments` is not. The limiter runs after
`AssessmentPrivacy`, so a `429` also carries `Cache-Control: no-store` and
`Referrer-Policy: no-referrer`.

| Budget | Limit per 10-minute window |
|---|---|
| per token (keyed by its SHA-256, never the raw token) | 300 requests |
| per client IP | 600 requests |
| per client IP, unknown-token lookups (`assessment_unavailable`) | 30 |

Exceeding any budget returns `429 rate_limited` with `Retry-After` in
delta-seconds (the longest remaining window) and the plain envelope
`{"error":"too many requests","code":"rate_limited"}`; the token is never
echoed. Rejected requests do not reach the handler and consume no budget. Once
an IP exhausts its unknown-lookup budget, every public request from it is
limited until that window ends.

Every admitted request reserves one unknown-lookup slot for its IP while it is
in flight; the reservation becomes a counted lookup only when the handler
answers `assessment_unavailable`, and is released otherwise (also on panic).
A concurrent burst therefore cannot exceed the 30-lookup budget. When only
in-flight reservations block an IP, the `429` asks `Retry-After: 1`.

Unmatched paths and methods under `/v2/assessments/{token}` are answered by a
catch-all inside the same group: `404 not_found` with the privacy headers, and
they count against the same budgets.

Windows are fixed and start at a key's first request. The client IP is the
`RemoteAddr` host; only when that peer is inside `TRUSTED_PROXY_CIDRS`
(comma-separated CIDRs, for the production ALB; unset locally) is
`X-Forwarded-For` read, taking the rightmost untrusted hop, and a malformed
header falls back to the peer. An invalid or `/0` value aborts startup. IPv6
clients share their /64. The limiter is in-process and per instance
(distributed limiting is later infrastructure). It holds at most 100000 keys:
expired keys are swept, and when the cap is still reached new keys fail closed
with `429`. The router installs the default limiter even when the composition
root omits it.

## Employer results and comparisons (B9)

Both routes use Bearer authentication and the same recruiter membership and
owner-or-principal vacancy gate as invitations, with `Cache-Control: no-store`.
Neither needs `If-Match` or a request body.

- `GET /v2/me/company/job-drafts/{id}/psychometric-invitations/{iid}/result`
  returns `200 Result`. Unfinished invitations and those whose `purge_after`
  has arrived return `404 not_found`, as do foreign/unknown vacancies and
  invitations belonging to another vacancy. Every successful read co-writes
  `PsychometricResultViewed` with the recruiter actor and invitation.
- `POST …/psychometric-invitations/{iid}/comparisons` returns `201 Comparison`.
  It uses the current **confirmed** profile, regardless of enabled, and the
  invitation's pinned content/scoring versions. Unconfirmed profiles return
  `409 profile_unconfirmed`; unfinished/past-retention invitations return 404.
  The contract's employer-write rule applies here too: a finished process
  rejects POST with `409 process_finished`; result GET remains available.

GET never calls scoring or loads a mutable content bank. It projects the stored
result and reads comparison rows in `(created_at, id)` ascending order; the last
row is the non-null `latest_comparison`, and `comparisons` lists every immutable
ID/profile_version in that same order. A finished result without its required
initial comparison fails closed as an internal invariant violation.

The strict wire projection follows contract update `75c0c690`: interpretation
`intro_text` comes from stored `prepend`, and `hypothesis_text` from stored
`hypothesis`, as plain strings. All three section texts remain unchanged.
Headings, comparison `question_ids`, and guide `tier`/`context_label` stay stored
but are omitted from the wire. Guide order, question text (including STAR),
quality, bands and sums are preserved.

POST reuses B2 `scoring.Recompare` on the stored observed competencies/quality;
it does not rescore answers or select a new interpretation. The full B2 comparison
and full confirmed profile are inserted through the same snapshot writer used by
finish. Earlier comparisons and the original result snapshot are never updated;
creating a comparison does not restart retention. Its response uses the same
wire projection as `latest_comparison`.

Both operations hold draft → process → participation → invitation locks and
check server wall-clock retention after acquiring them. Comparison insertion and
`PsychometricComparisonCreated` audit (actor, invitation, `comparison_id`,
`profile_version`, vacancy and participation) commit in one transaction. Audit
failure rolls back the operation, returning only an internal-error envelope—no
result/comparison payload or unaudited comparison row.

## Retention purge (B10)

From `backend/`, supply `DATABASE_URL` explicitly in the environment (no dotenv
loading). Do not put the DSN on the command line or in logs:

```sh
go run ./cmd/psychometric-purge          # dry run, no changes
go run ./cmd/psychometric-purge -execute # perform deletion
go run ./cmd/psychometric-purge -help
```

Both modes print only aggregate counts, one `table=count` line for
`psychometric_invitations`, `psychometric_answers`,
`psychometric_answer_events`, `psychometric_consents`, `psychometric_results`
and `psychometric_comparisons`, in that order. Invitation counts mean **scrubbed
tombstones**, not deleted invitation rows. No IDs, tokens, answers or PII are
printed. Success exits 0; configuration/database failures exit 1 with only
`psychometric purge failed` on stderr. Invalid arguments use the same static
failure; `-help` prints usage without connecting.

The database wall clock determines eligibility: finite, non-NULL `purge_after`
**at or before** that clock. Future, NULL and non-finite deadlines are untouched.
The existing UTC 12-calendar-month anchors remain unchanged: finish for finished
invitations (even if later revoked), revocation for unfinished revoked ones, and
expiry otherwise, including partial answers. Every comparison follows the same
invitation deadline; creating one never extends retention.

Dry run uses one read-only, repeatable-read transaction. Execute locks at most
100 eligible invitations per transaction with `FOR UPDATE SKIP LOCKED`, deletes
all their comparisons, results, answer events/timing, current answers/timing and
consents, then clears token hashes, consent timestamps and answered counters.
Invitation identity, lifecycle timestamps, retention and administrative metadata
remain as a minimal assessment-free tombstone. This preserves audit entity
references and the finished-invitation uniqueness/no-retake rule; deleting the
invitation would silently allow a new assessment after a retained finish.
Non-psychometric tables, vacancy profiles and audit rows are never modified.

Each batch commits independently. Concurrent commands partition unlocked work
without double-counting: eligibility is rechecked in a fresh statement after row
locking, so a concurrent purge's deleted children cannot survive in the original
SELECT snapshot and inflate tombstone counts. A locked invitation can be deferred
to its owner or a later rerun. Purge takes no parent locks, so it does not invert the normal
parent-first write protocol. Reruns report zero for already scrubbed invitations.
On failure, earlier committed batches remain deleted; rerun safely. Scheduling
is **E3, later**; this command neither starts a worker nor installs deployment
resources.

Before physical deletion, past-retention data is already unavailable: B9 result
GET and comparison POST return 404; candidate public token lookup and its
transactional recheck return assessment_unavailable, account detail/items return
not_found, and both account and employer invitation lists omit retained-expired
rows. Latest-invitation selection happens before this filter, so an older
invitation is never resurrected. Pre-retention expired/revoked account entries
remain visible read-only as before.

Focused purge verification (must PASS, not SKIP) uses only the guarded loopback
`DRAFT_TEST_DATABASE_URL` database named `draft_test`. Tests create and clean a
unique schema, apply the real 00050/00051 assessment DDL with isolated parent
fixtures, and run the public command `run` function through independent database
connections, including concurrent invocations:

```sh
go test -tags=integration ./cmd/psychometric-purge -count=1 -v
```

## Verification

From `backend/`:

```sh
go test -count=1 -timeout 300s ./internal/...
go test -count=1 -timeout 300s ./cmd/api
go test -tags integration -count=1 -timeout 600s ./cmd/api -run '^(TestPsychometric|TestBoard|TestChecklistFlow|TestCandidate|TestApply)'
go test -tags integration -count=1 -timeout 300s ./db/migrations -run '^TestPsychometric'
go vet ./...
go run ./cmd/archguard
```

Integration tests reuse the checklist harness. Set `DRAFT_TEST_DATABASE_URL` to
a dedicated **loopback** database named **draft_test**; never the development DB.
The harness refuses other hosts/database names, never reads ambient
`DATABASE_URL`, migrates only the isolated DB and cleans up its fixtures. With no
dedicated DSN it skips; a skip is not database verification. Archguard's existing
`docker/minio/Dockerfile` locked-non-goal failure is unrelated to B3–B6. On macOS's
bash 3.2, the pre-existing `scripts/closure/gate:44` command-substitution/case
syntax also breaks closure receipt tests in the full suite; it is not a profile
failure.
