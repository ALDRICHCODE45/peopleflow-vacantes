# Company member offboarding

All paths use the membership ID (`company_members.id`), not the user ID,
under `/me/company/members/{id}`. All three endpoints retain the existing
company-owner middleware. Removed company members receive its existing 403.

- `GET /offboard-preview`: read-only `{user: {id, full_name}, vacancies,
  other_tramos}`. Each vacancy includes `draft_id`, `title`, `lifecycle`,
  `hand_over` (`responsible` or `last_member`), and `team` excluding the leaver.
  Finished processes only contribute to `other_tramos`; drafts without a
  process are non-finished.
- `DELETE` on the membership itself: 409 `member_is_responsible` with
  `data.vacancies` matching the preview when handovers are needed. Otherwise
  ends all active tramos and deletes the membership atomically; returns 204.
- `POST /offboard`: strict body `{default_to_user_id?, reassignments?:
  [{draft_id, to_user_id}]}`. Requires one UUID `Idempotency-Key`, no team ETag.
  Per-vacancy targets override the default. Duplicate vacancy entries, unknown
  fields and malformed UUIDs are invalid requests. Missing targets produce
  422 `offboard_unresolved_vacancies` with `data.vacancies`; non-applicable
  entries produce 422 `offboard_reassignment_not_applicable`; targets outside
  the company or equal to the leaver produce 422 `not_company_member`.

Successful POST returns 200 `{user_id, handed_over: [{draft_id, hand_over,
 to_user_id, reassignment_id}], ended_assignment_ids}`. The reassignment ID is
null for shared-team handovers. Responsible handovers use the existing
reassignment writer, snapshot and `reassigned` end cause. Remaining tramos end
with `membership_ended`, freezing their effective deadlines and closing their
function periods. `ended_assignment_ids` lists these membership-ended tramos;
responsible handovers are identified separately by their reassignment IDs.

Writes preserve the existing last-owner guard (self-removal is allowed only
when another owner remains). Membership writes serialize on the company row,
then lock affected vacancy rows in draft-ID order. Team versions and audit
entries commit with membership deletion. Matching POST retries return frozen
bytes before looking up the deleted target membership, while the caller still
passes the company owner gate. Self-offboarding therefore revokes the caller's
ability to replay through that gate, just like any other company endpoint.

A finished vacancy without a responsible in `with_responsible` mode cannot be
reopened: lifecycle reopen returns 409 `responsible_required` without a write.
