# Candidate message read state (D5)

Backend half of frontend `odd/tasks/candidate-cvs-dashboard-redesign.md` D5/S8. Branch `feat/applications-message-read`
(from `feat/applications-updated-at`, which supplies `updated_at`). High risk: migration + new candidate write (item 1).

## Specs

- S1 — Frontend ask, verbatim: «GET /v2/me/applications items with a closing `message` also carry when the candidate read
  it — e.g. `message_read_at` (RFC3339 with offset, null while unread; absent/null when there is no message). Name and
  shape are your call.»
- S2 — Frontend ask, verbatim: «An idempotent, candidate-owned way to mark it read — e.g. PUT
  /v2/me/applications/{id}/message-read (204; repeat = no-op; other candidate's application = 404, no existence leak; no
  message = your choice of 404/409, tell me which code).»
- S3 — Frontend ask, verbatim: «Should a recovery (closed→open, message disappears) and a later new discard reset it to
  unread? I'd say yes: a new message is unread.»
- S4 — Approved proposal (user: «Hacelo con la propuesta»): list item `message_read_at` RFC3339 UTC, key always present,
  null when there is no message or it is unread. Reset to null on every new discard and on recovery. PUT
  /v2/me/applications/{id}/message-read with body `{"updated_at":"<value the candidate saw>"}` → 204; repeat = no-op
  keeping the first read time; not the candidate's / unknown id → 404 `not_found`; no current message → 409
  `message_unavailable`; `updated_at` no longer matches → 409 `message_changed`; malformed body / unknown keys → 400
  `invalid_request`. Migration Down refuses while read data exists. Rejections write nothing.
- S6 — Frontend, verbatim (L3): «please guarantee message_read_at is null whenever message is null (I'll validate that),
  and >= updated_at isn't required, but it must be >= applied_at; (2) for 409 message_unavailable/message_changed keep
  the usual {error, code} envelope.»
- S5 — Coordination: do not ship to a shared environment before the frontend confirms its strict schema accepts the key.

## Tasks

- T1 — S1–S6: migration 00052, list field, PUT route, reset on discard/recovery, contract doc, tests. Route: inline,
  test-first; independent verify + native review (high risk). Commit: 9b28e783. Verify: pass S1–S4, S6; S5 release gate (not shipped).

## Log

- L1 — Frontend request (msg 780e8115, 2026-10-31): S1–S3 verbatim above; «Same coordination as updated_at: the list
  schema is strict, so don't ship the field to a shared env until I confirm the frontend accepts it. Propose shape/codes
  first; the user gives the go-ahead in your session.»
- L2 — User, backend session (2026-10-31): «Hacelo con la propuesta» → S4.
- L3 — Frontend (msg 46bf9967): no objections to S4; asks S6. Will accept `message_read_at` as optional nullable once
  the name is confirmed.
- L4 — Verify (gentle-ai-verify): pass S1–S4, S6; S5 is the release gate (nothing shipped). Native assess of 9b28e783
  alone: medium, reviewDue false (under_budget) → no native review lineage started. Slice boundary: D3 18b5d08f + D7
  8f8b66df (feat/applications-updated-at) | D5 9b28e783 (feat/applications-message-read, stacked).
