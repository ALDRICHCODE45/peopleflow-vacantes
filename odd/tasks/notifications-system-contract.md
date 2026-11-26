# Notifications — backend contract proposal, stage 1 (draft for the backend session)

Source: `odd/tasks/notifications-system.md` (S1–S7, L1–L7) and design/notifications/07, 04, 05. Stage 1 = in-app bell +
inbox for company members and candidates with the S6 events. Email (stage 2) and owner rules (stage 3) are out of scope,
but the model must not block them.

## Model

- **Event** (append-only, written in the same transaction as the domain change that causes it — outbox style):
  `id, company_id (nullable for candidate-only), type, occurred_at, actor_user_id|null, subject {kind, id}, payload`.
- **Notification** (one per recipient, fan-out from the event): `id, recipient_user_id, event_id, type, kind
  (mandatory|operational|informative), group_key, title, body, link {kind, id, path}, urgency (normal|due_soon|overdue),
  created_at, read_at|null`. `group_key` groups rows (e.g. `applications:<job_id>:<yyyy-mm-dd>`): the inbox returns one
  row per group with `count` and the latest items.
- **Recipients (stage 1, fixed rules):** vacancy events → responsible recruiter + vacancy team (stakeholders are never on
  teams; owners only if they are on the team); assignment events → the affected person (mandatory); candidate events →
  the candidate. Stakeholder role: nothing by default (stage 3 lets the owner enable events for the role, all vacancies,
  in-app only; never by name).
- **Stage-1 types:** `application_received` (operational, team), `delivery_due_soon` (operational, team; scheduled job at
  T-24h, once), `delivery_overdue` (mandatory, team; once at due time), `vacancy_assigned` / `vacancy_reassigned` /
  `vacancy_team_added` (mandatory, the person), `psychometric_completed` (operational, team), `psychometric_pending`
  (operational, team, ON by default; and candidate-side `candidate_test_pending`), `candidate_status_changed`
  (operational, candidate), `candidate_message_received` (operational, candidate).

## API (both company members and candidates; scoped to the session user)

- `GET /v2/me/notifications?state=unread|all&types=a,b&job_ids=x,y&cursor=` → `{items: [{id, group_key, type, kind,
  title, body, link, urgency, count, sample: [...], created_at, read}], next_cursor, unread_count, attention: [...]}`
  (`attention` = unread due_soon/overdue pinned on top, as in 02/07).
- `GET /v2/me/notifications/unread-count` → `{unread_count}` (cheap; the bell polls it every ~30 s and on focus).
- `POST /v2/me/notifications/read` `{ids: [...]}` (marks a group when given its id) · `POST /v2/me/notifications/read-all`
  `{before: created_at}` · `POST /v2/me/notifications/unread` `{ids}` (for «Deshacer»).
- `GET /v2/me/notifications/facets` → counts per type and per job for the 07 filter popover (current state).
- Retention: keep 90 days of read notifications (proposal); unread kept until read.

## Open for the backend

1. Where events are emitted today (applications, pipeline moves, delivery commitments, vacancy team, psychometrics,
   candidate messages) and whether an outbox table + worker fits the current architecture.
2. The scheduler for due-soon/overdue (existing jobs runner? Inngest?).
3. Idempotency/dedupe so a retried command doesn't notify twice.
