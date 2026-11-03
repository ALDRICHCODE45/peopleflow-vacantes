# Vacancy team writes

Team writes return **200 with the full GET team resource and its new ETag**.
The authoritative wire contract is [vacancy-team-v1](../../../../../../docs/contracts/vacancy-team-v1.md).
`V` below means `/v2/me/company/job-drafts/{id}`.

## Request sequence

1. Read `GET V/team` and retain the `ETag` header.
2. Send that tag as `If-Match` on every write. POSTs also require a UUID `Idempotency-Key`.
3. Replace the local team with the returned resource and ETag; refresh history after a write.

| Route | Body |
| --- | --- |
| `POST V/team/members` | `user_id`, optional `recruiter_deadline` (date or null) |
| `POST V/team/members/{user_id}/remove` | `{}` |
| `POST V/team/leave` | `{}` |
| `PATCH V/team/members/{user_id}` | `recruiter_deadline` (date or null, required key) |
| `POST V/team/reassign-responsible` | `to_user_id`, `reason`, optional `note`, `recruiter_deadline`, `previous_responsible` |
| `PUT V/team/mode` | `mode`, `responsible_user_id` when switching to `with_responsible` |

Dates use `YYYY-MM-DD`; unknown fields, duplicate keys and invalid types are rejected.
Reassignment reasons are `workload`, `recruiter_departure`, `performance`, `client_request`, `other`.
`other` requires a trimmed 1–500-character note. `previous_responsible` defaults to `remove`;
`keep_as_collaborator` preserves the outgoing responsible's continuous stay.
An existing target keeps their stay and deadline; a non-null requested deadline for them returns
422 `recruiter_deadline_not_applicable` (use the deadline PATCH). A deadline applies only to a new stay.
Sending `responsible_user_id` when switching to `shared` returns 422 `responsible_not_applicable`.

## Rejections and replay

Missing If-Match is 428, malformed If-Match is 400, and a stale tag is 412 `team_version_conflict`.
A visible caller without permission receives 403 `team_action_forbidden`.
An outsider receives 404; an ended team member receives 404 `team_access_ended`.
The permissions and endpoint-specific conflict codes are listed in the authoritative contract.

POST replay is scoped to company, actor and action, checks the request fingerprint, and returns the frozen body
and ETag with `Idempotency-Replayed: true`, even after later changes. Company/user/membership gates always
run first. Only a matching leave replay is looked up before team authorization: the caller may retrieve
their frozen leave response while still a company member, without regaining vacancy access. A different
leave key still receives `team_access_ended`; removing company membership also blocks frozen replay.
Other team writes authorize team access before replay. Changed payloads under the same key on an authorized
write return `idempotency_conflict`. Rejections never advance team versions or append audit/history rows.

## Transaction and history

Every write locks the parent draft before reading membership, then checks replay, ETag, permissions and input.
Function changes close and open periods at one instant without splitting a stay. Ending a stay freezes its effective
deadline; later commitment changes cannot rewrite it. Mode changes and reassignments appear in `GET V/team/history`.
Reassignments capture stage kinds/counts, lifecycle, Mexico City business days, delivery and placements in that transaction.
Without an effective deadline, total business days is null, not zero.

The mutation, version, history, audit event and frozen POST response commit together. Audit metadata contains only
contract-defined IDs, codes and dates, never notes. Offboarding remains a separate slice.

## Own assignment history

`GET /v2/me/vacancy-assignments/history?cursor=` is available to authenticated company members
(owners and recruiters), including those who no longer have access to a vacancy. It lists only the
caller's continuous stays in their current company, not other members' stays. Removed company
members receive the existing company-gate 403.

The response is `{items: [...], next_cursor: string | null}` with 20 stays per page, newest first by
`coalesce(ended_at, latest function started_at, started_at)`, ties by ascending assignment ID.
Pass the opaque cursor unchanged; malformed or foreign cursors return 400 `invalid_cursor`.
Each item contains `vacancy_title` (current title or null), chronological `functions[]`
(`function`, `started_at`, `ended_at`), `started_at`, `ended_at`, `end_cause`, `effective_deadline`,
`delivered_in_tramo`, and `placements: {direct, participant, shared}`. No candidate data is exposed.
Active deadlines use the recruiter deadline, falling back to the commitment; ended stays use their
frozen closing deadline. Delivery counts distinct participations with a qualifying cutoff entry
by the caller during `[started_at, ended_at or now)`, including manual intake beyond the cutoff;
without a cutoff the count is zero. Placement counts use frozen recipients for that stay and include
active and did-not-hold credits, never voided ones. Function changes do not split a stay.

Every item also always includes these table fields (nullable values are explicit JSON null):

- `draft_id`: vacancy UUID only for an active stay; null after it ends.
- `requester`: current company catalog `{kind: internal_area | client, name}`, or null when unset.
- `vacancy_status`: current `{publication: draft | published | paused | closed, process: active | finished | null}`;
  an unpublished draft has publication `draft` and process null.
- `business_days_in_tramo`: Mexico City business days from the start date to the end date or today,
  using exactly the reassignment snapshot's elapsed-day calendar and counting rule.
- `delivery_target`: fulfillment-frozen target when fulfilled, otherwise the current configured target, or null.
- `deadline_result` and `deadline_delta_business_days`: shared vacancy delivery measured against this stay's
  effective deadline, not the caller's individual contribution. Fulfillment belongs to the stay only within
  `[started_at, ended_at or now)`. Whole Mexico City dates apply; meeting the deadline ON its date is on time.

| Result | Rule | Delta measured from |
| --- | --- | --- |
| `on_time` | Fulfilled within the stay on or before its deadline | Fulfillment date |
| `late` | Fulfilled within the stay after its deadline, or deadline passed while still active without fulfillment | Fulfillment date, otherwise end date or today |
| `pending` | Active, unfulfilled, deadline today or later | Today |
| `unfinished` | Ended unfulfilled before or ON the deadline date | End date (zero on deadline date) |
| `not_applicable` | Already fulfilled before the stay started | null |
| `none` | No effective deadline, or delivery not configured | null |

Delta uses fulfillment's sign convention: positive before the deadline, negative after, zero on the date.
A weekend can be late with a zero business-day delta. Missing deadline/configuration yields `none` before
considering fulfillment. History never returns fulfillment candidates. The store clock is injectable through
`WithClock`; production uses the existing real-time clock.

## Placement credits

A move or recovery into placement creates a credit and freezes the current team mode and active tramo recipients.
Moves and discards out of placement require `placement_exit_reason` and close the latest credit's open episode
by recording its exit history and reason, regardless of credit status. An active credit becomes `voided` for
`moved_by_mistake` or `did_not_hold` for `candidate_left`; an already voided credit stays voided, without another
status-change audit event. Older placements without credits may still exit.

- `GET V/participations/{pid}` includes the latest `placement_credit` (or null), plus
  `can: {void_credit, restore_credit}`. Only the owner has correction capabilities.
- `GET V/participations/{pid}/placement-credits` returns `{items: [...]}`, newest first. Each item has
  `id`, `status`, `team_mode`, `hired_at`, `hired_by: {id, name}`, `exit_reason`, and
  `recipients: [{user_id, name, kind}]`.
- `POST V/participations/{pid}/placement-credits/{credit_id}/void` and `/restore` accept strictly `{}`.
  They require a UUID `Idempotency-Key`, **not If-Match**, and return the credit item without an ETag.
  Replay returns the frozen item, even after later transitions. Void accepts `active` or `did_not_hold`;
  restore accepts `voided`, returning `active` only when that credit's own episode has no exit recorded,
  otherwise `did_not_hold`. A later re-hire never reopens an older credit's episode.
  Invalid transitions return 409 `credit_status_unchanged`; visible non-owners receive
  403 `team_action_forbidden`; wrong participation/vacancy/credit IDs receive 404.

Credits, recipients, history and audit events commit atomically with the move/recovery/exit/correction.
Corrections share the draft row lock with board writes. Reassignment snapshots count the vacancy's non-voided
credit rows in `placements.credited`; `placements.current` still counts candidates currently in placement.
