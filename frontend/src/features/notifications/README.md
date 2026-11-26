# Notifications (company inbox, stage 1)

Contract: backend `docs/contracts/notifications-v1.md`, agreed at commit 80a5ce80 (read side N4: list + unread count;
writes and facets N5, backend 89a63897).
Spec and decisions: `odd/tasks/notifications-system.md` (S6, L10–L13).

- `model.ts` — Zod decoders and types: the 14 known types, grouped item, link (unknown kind → `null`), page,
  unread count, mark result, facets, error envelope and `NotificationFailure`. Objects strip unknown fields; `type`
  stays an open string (also in facets).
- `client.ts` (server only) — `listNotifications` (`GET /v2/me/company/notifications`, `state`, `types`, `job_ids`,
  `cursor`, `limit` 1–50, default 20), `getUnreadCount` (`…/unread-count`), `markRead` / `markUnread`
  (`POST …/read` / `…/unread`), `markAllRead` (`POST …/read-all`) and `getFacets` (`GET …/facets?state=unread|all`).
  Input is validated before any request. POSTs send JSON with the Bearer token, `redirect: "error"`, expect `200`.
- `failure.ts` — maps client failures to reasons; only status and allowlisted codes cross, never the backend message.
- `actions.ts` — server actions with the session token; no token → `unauthenticated` without a request.
- `use-unread-count.ts` — bell counter hook.

Polling rule: read on mount, every 30 s (`POLL_INTERVAL_MS`) while the tab is visible, paused while hidden, read
immediately when the tab becomes visible or the window gets focus. A failed read keeps the last value; `unauthenticated`
or `forbidden` stops polling; stale responses are ignored. The inbox can push a fresher value with `set(n)`.

## Read / unread / read-all / facets (T3.5)

- `markReadAction(target)` — `target` is exactly one of `{ groupKeys }` (1–100) or `{ ids }` (1–200); sent as
  `{group_keys}` / `{ids}`.
- `markUnreadAction(target)` — same, plus `{ markedAt }` sent as `{marked_at}`: «Deshacer» passes the `marked_at` of the
  mark it reverts and the backend reverts exactly that batch.
- `markAllReadAction({ types?, jobIds?, before? })` — sent as `{types, job_ids, before}`; an empty list is omitted, never
  sent (the backend refuses it); `{}` marks everything up to now. Attention items are included.
- All three answer `{affected_notifications, affected_groups, marked_at, unread_count, unread_notifications}`; the inbox
  can push `unread_count` into the bell with `set(n)`.
- `getFacetsAction(state = "unread")` — `{state, types[{type, count}], jobs[{job_id, title|null, count}] ≤ 50, jobs_total}`;
  ignores other filters.

Failure reasons for writes:

- `validation_error` (with `fields[{field, code}]`) — a body refused locally before any request (no selection → `body
  required`; two selections or an unknown key → `body invalid`; `markedAt` on read → `marked_at not_allowed`; empty list →
  `empty`; over the limit → `too_many`; malformed group key, UUID, type or timestamp → `invalid`), or the backend's 400
  `validation_error`. Local fields mirror the backend's names (`body`, `group_keys`, `ids`, `marked_at`, `types`,
  `job_ids`, `before`) and codes (`required`, `invalid`, `not_allowed`, `empty`, `too_many`), sorted by field; backend
  fields outside those sets are dropped. Group keys follow D11: `n:<uuid>` or
  `applications|psychometrics|psychometrics_pending:<job uuid>:<YYYY-MM-DD>` (a real date); the nil UUID is refused.
- `invalid_filter` — an unknown facets `state` (local) or the backend's 400 `invalid_filter`.
- 413 `payload_too_large` and 400 `invalid_request` → `unrecognized_response`: a locally validated body stays far below
  the 64 KiB cap and only carries contract keys, so either answer is a contract break, not a user error.
- 401 → `unauthenticated`, 403 → `forbidden`, 5xx → `server_error`, network/timeout → `no_response`, as for reads.
