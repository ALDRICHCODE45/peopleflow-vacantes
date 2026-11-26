# Notifications (company inbox, stage 1)

Contract: backend `docs/contracts/notifications-v1.md`, agreed at commit 80a5ce80 (read side N4: list + unread count).
Spec and decisions: `odd/tasks/notifications-system.md` (S6, L10–L12).

- `model.ts` — Zod decoders and types: the 14 known types, grouped item, link (unknown kind → `null`), page,
  unread count, error envelope and `NotificationFailure`. Objects strip unknown fields; `type` stays an open string.
- `client.ts` (server only) — `listNotifications` (`GET /v2/me/company/notifications`, `state`, `types`, `job_ids`,
  `cursor`, `limit` 1–50, default 20) and `getUnreadCount` (`…/unread-count`). Input is validated before any request.
- `failure.ts` — maps client failures to reasons; only status and allowlisted codes cross, never the backend message.
- `actions.ts` — server actions with the session token; no token → `unauthenticated` without a request.
- `use-unread-count.ts` — bell counter hook.

Polling rule: read on mount, every 30 s (`POLL_INTERVAL_MS`) while the tab is visible, paused while hidden, read
immediately when the tab becomes visible or the window gets focus. A failed read keeps the last value; `unauthenticated`
or `forbidden` stops polling; stale responses are ignored. The inbox can push a fresher value with `set(n)`.
