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

## UI (`ui/`, `copy.ts`)

- `NotificationBell` sits in the company `SiteHeader` right slot, before the theme toggle; it polls `useUnreadCount()`
  and opens the inbox sheet (design 07 on the 02 sheet base). Every page read or mark pushes `unread_count` into it.
- `notification-inbox.tsx` wires tabs («No leídas» default, «Todas»), the pinned «Requiere atención» section (first page
  only), day sections in America/Mexico_City, «Cargar más» (cursor; `invalid_cursor` reloads page 1) and the states.
- Marks (`use-inbox-marks.ts`): «Marcar como leída» marks one group and keeps the row visible as read until the tab,
  filters or sheet change; opening a row marks its group without delaying navigation; «Marcar todo como leído» sends the
  active filters and `before` = the newest `latest_at` shown (server clock; browser time only for an empty list), then
  offers «Deshacer» through `markUnreadAction({markedAt})`.
- «Filtrar» (`inbox-filter.tsx`): type groups and vacancies with counts from `getFacetsAction` for the current tab,
  applied immediately, at most 20 vacancies. Filter tests use `ui/test-popover.tsx` because the real Base UI popover
  hangs `user.click` in jsdom (same convention as audit-log).
- `copy.ts` is the only place with wording and links per type (contract D24); unknown types read «Nueva notificación».

## Candidate inbox (T3.6)

Contract L14: `GET /v2/me/notifications`, `…/unread-count`, `…/facets`, `POST …/read`, `…/unread`, `…/read-all`, behind
the `/v2/me/applications` gate, same shapes as members. Items carry `company {id, name}` (null when the vacancy can no
longer be resolved; absent on member items); actor null, sample `[]`, attention `[]` / `attention_total` 0; link is
`application` or `assessment`, null when the candidate no longer participates.

- Scope is a closed enum (`NOTIFICATION_SCOPES`: `company` | `candidate`) that `client.ts` maps to a fixed base path;
  any other value is refused before a request. The browser never picks it: `actions.ts` exports a separate fixed set
  per scope (`listCandidateNotificationsAction`, `getCandidateUnreadCountAction`, `markCandidateReadAction`,
  `markCandidateUnreadAction`, `markAllCandidateReadAction`, `getCandidateFacetsAction`), each setting its own scope
  after the caller's input, so a smuggled `scope` key is overwritten.
- 403 `account_required` (no candidate account) / `wrong_role` (company user) → `forbidden`: empty inbox, polling stops.
- UI: `NotificationBell scope="candidate"` provides `NotificationScopeContext` (`ui/scope.tsx`), which picks the action
  set for `useInboxPages`, `useInboxMarks` and the filter. `useUnreadCount(scope)` takes it as an argument.
  `CandidateNotificationBell` mounts it in `CandidateHeader` before the theme toggle, only for a signed-in candidate.
- Candidate inbox = the same sheet without «Filtrar» (design 04 shows no filter), without «Requiere atención» and
  without sample sublists; rows name the company (subtitle or title, per type in `copy.ts`).
- Contract Q4: marking `candidate_message_received` read does not mark the message read; that stays
  `PUT /v2/me/applications/{id}/message-read`, independent.
- T4.3: candidate status rows carry the application status badge of design 04 («Enviada» info, «En proceso» review,
  «Cerrada» neutral; same words as `applicationBadge`), shown only when the row has no urgency badge. The pending-test
  due-date badge of design 04 is not built: the payload has no due date.
