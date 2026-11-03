# Commitment renegotiation and placement exits

Employer routes use the existing owner-or-active-tramo guard (404 for outsiders).
`V` means `/v2/me/company/job-drafts/{id}`.

## Commitment

Before publication, edit delivery through `PUT V/pipeline/delivery` as before.
After a `vacancy_processes` row exists, changing `commitmentDate` through that PUT
returns 409 `commitment_change_requires_renegotiation`, without writing or advancing
the version. Other fields remain editable with an unchanged date, subject to the
existing fulfillment and publication guards.

`POST V/commitment` accepts:

```json
{"commitment_date":"2026-11-20","reason":"client_request","note":"Optional explanation"}
```

Reasons: `client_request`, `scope_change`, `internal_delay`, `other`. Dates use
`YYYY-MM-DD`. Notes are trimmed, 1–500 Unicode characters when supplied; `other`
requires a note (422 `commitment_note_required`). Unknown fields, duplicate keys,
wrong types, malformed dates and invalid reasons return the existing invalid-request
error. This endpoint has no draft-calendar window/business-day restriction.

Supply a UUID `Idempotency-Key` and the delivery configuration ETag in `If-Match`.
Missing If-Match returns 428; malformed tags return 400; stale tags return 412
`version_conflict`. Domain conflicts are 409 `vacancy_not_published`,
`delivery_not_configured`, and `commitment_unchanged`.

Success is 200, the same body as GET delivery, with an advanced delivery ETag.
The change row, version, idempotency response and `VacancyCommitmentRenegotiated`
audit are transactional. Audit metadata contains company/change IDs, previous/new
dates and reason, never the note. Replays return the frozen response and ETag,
even after later changes, without requiring the old If-Match again. Fulfillment
snapshots already captured remain unchanged.

## Placement exit

Moves and discard replace `confirm_placement_exit` with
`placement_exit_reason: "moved_by_mistake" | "candidate_left"`. The old flag is
unknown input and rejected. A missing reason when leaving placement returns 409
`placement_exit_reason_required`; invalid values/types or a reason when not leaving
placement return 400 `invalid_request`.

Discard from placement independently requires its normal discard `reason.group/key`
and `placement_exit_reason`. Neither implies the other. The decoded reason reaches
the movement/discard store request but is not persisted until placement credits
(T4). Recovery's `confirm_placement_reentry` is unchanged.
