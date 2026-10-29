# Vacancy psychometric assessments (B3–B5)

Employers can save a private, vacancy-scoped profile for `ipip60-mx` and manage
invitations and issue single-display links. These slices do not auto-send, collect answers, expose
results or move/reject anyone. The authoritative wire contract
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
| `auto_send_stage_ids` | Array of distinct current progression-stage IDs of this vacancy's pipeline; exit/retired/foreign/unknown stages are invalid. Default `[]`. GET silently hides stages no longer current, without rewriting storage/version. No auto-send runs in B3. |
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
anchor; B10 owns purge execution.

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

## Verification

From `backend/`:

```sh
go test -count=1 ./internal/features/psychometrics/... ./internal/shared/...
go test ./cmd/api -run 'Route' -count=1
go test -tags integration ./cmd/api -run '^(TestPsychometric|TestChecklistFlow|TestBoard)' -count=1
go test -tags integration ./db/migrations -run '^TestPsychometric.*MigrationGuardedDown$' -count=1
go vet ./...
go run ./cmd/archguard
```

Integration tests reuse the checklist harness. Set `DRAFT_TEST_DATABASE_URL` to
a dedicated **loopback** database named **draft_test**; never the development DB.
The harness refuses other hosts/database names, never reads ambient
`DATABASE_URL`, migrates only the isolated DB and cleans up its fixtures. With no
dedicated DSN it skips; a skip is not database verification. Archguard's existing
`docker/minio/Dockerfile` locked-non-goal failure is unrelated to B3–B5. On macOS's
bash 3.2, the pre-existing `scripts/closure/gate:44` command-substitution/case
syntax also breaks closure receipt tests in the full suite; it is not a profile
failure.
