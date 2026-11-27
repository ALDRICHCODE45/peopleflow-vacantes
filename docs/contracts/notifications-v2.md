# Notifications v2 (stage 2: email channel and personal preferences)

Status: **Agreed — reviewed by the frontend and approved by the user (2026-11-26); not implemented yet**. Source of the request: the frontend decisions forwarded in
`odd/tasks/notifications-v2-backend.md` (S1–S9, L1; frontend feature L17–L18). Builds on
`docs/contracts/notifications-v1.md` (stage 1, merged e6b2d501): every stage-1 rule stays unless a decision below says
otherwise. Branch `feat/notifications-v2-backend`. Style follows `notifications-v1.md`. Every `path:line` is a backend path
(under `backend/`) at commit 42d4a65a unless it starts with `docs/`. **Nothing here touches AWS (S9)**: SES, domain
identity, DKIM and bounce ingestion are out of scope and only reserved.

## Purpose

Let company members and candidates with an account (S3) choose, per notification type, whether they get it **in the
app** and **by email**. Mandatory types (overdue deliveries, assignment, reassignment, unassignment, team addition) are
always on in both channels (S2, S5). Send a minimal email (S6) per notification, or one per group when events burst
(10-minute coalescing, S4), with one-click unsubscribe for non-mandatory types (RFC 8058, S7) and a suppression list
consulted before every send. Dev sends to Mailpit through a `Mailer` port; production SES comes later (S7, S9). The
digest is stage 3 (S1). The system is not in production and all data is disposable.

## Backend facts this contract builds on

- **Notification types, kinds and recipient kinds are a closed table in code**: 14 types with `Kind ∈ mandatory |
  operational | informative` (`internal/features/notifications/domain/types.go:29-36`, `informative` reserved and unused,
  `types.go:35`), recipient kind and group rule per type (`types.go:90-105`). Six types are mandatory
  (`delivery_overdue`, `assignment_deadline_overdue`, `vacancy_assigned`, `vacancy_reassigned`, `vacancy_unassigned`,
  `vacancy_team_added`), eleven are member types and three candidate types (`types.go:91-104`).
- **Rows are created in exactly two places, each in one transaction:**
  - Fan-out (`internal/features/notifications/fanout/process.go:54-70` `Tick`, `process.go:100-121` `process`): one
    claimed event per tx, rows inserted by `InsertNotification` (`process.go:157-176`), which is `:exec` with
    `ON CONFLICT … DO NOTHING` (`db/queries/notifications.sql:102-122`) — **the caller cannot tell today whether a row was
    inserted**. Plan and recipients: `fanout/plan.go:117-147` (`Plan`), `plan.go:261-273` (`row`), group keys in the
    `America/Mexico_City` date (`plan.go:20`, `plan.go:277-282`).
  - Scheduler (`internal/features/notifications/schedule/run.go:50-108`): the whole run is one tx;
    `InsertScheduledNotification` is `:execrows` (`db/queries/notifications.sql:162-178`, used at `run.go:121-135`), so
    the caller already knows when the dedupe skipped a row. Resolution: `db/queries/notifications.sql:180-213`.
- **Dedupe is the notification row itself** (v1 D21): `notifications_dedupe_immediate` and `notifications_dedupe_scheduled`
  (`db/migrations/00068_notifications.sql:53-56`). The scheduler re-evaluates every deadline every 15 min
  (`schedule/scheduler.go:10`) and relies on the scheduled unique key to fire once.
- **Every inbox read and mark query repeats the caller scope** `recipient_user_id + recipient_kind + company_id`
  (`db/queries/notifications.sql:215-220`): attention (`:222`), groups and their lateral `latest` (`:242`, `:269-278`),
  member samples (`:285`), unread count (`:347`), read / unread / read-all (`:358`, `:381`, `:405`), facets (`:429`,
  `:446`). The unread counter uses the partial index `notifications_recipient_unread … WHERE read_at IS NULL AND
  resolved_at IS NULL` (`00068_notifications.sql:61-62`).
- **Groups**: `applications:`, `psychometrics:` and `psychometrics_pending:<job_id>:<YYYY-MM-DD>` for
  `application_received`, `psychometric_completed`, `psychometric_pending`; `n:<notification_id>` for every other type
  (`types.go:66-75`, `plan.go:277-282`).
- **Link descriptors already exist** per type (`internal/features/notifications/inbox/link.go:8-56`: `vacancy_candidates`,
  `participation`, `vacancy`, `vacancy_delivery`, `application`, `assessment`); the frontend maps kinds to paths.
- **Background loops**: the fan-out loop runs in every instance every 2 s without a lock (`fanout/loop.go:10`,
  `loop.go:17-86`), with backoff constants at `fanout/process.go:18-27` and value-free failure logs
  (`process.go:127-143`); the scheduler runs under a session advisory lock (`schedule/lock.go:13`, key `notif_sc`).
  Both are composed and started/stopped in `cmd/api/notifications_fanout.go:29-51`,
  `cmd/api/notifications_schedule.go:18-37`, `cmd/api/main.go:336,340`.
- **Archguard forbids** new paths with an `outbox` segment, a `deploy` segment, the substring `worker`, `Dockerfile*`
  basenames and `*.tf` (`internal/tools/archguard/archguard.go:270-285`). `docker-compose*.yml` is allowed.
- **Email provider decision** (`docs/decision-email-provider.md:8-13`): Amazon SES, sent **by queue** (EventBridge → SQS →
  Fargate Go worker), Terraform in `infra/`, domain «Pendiente»; local dev through an interface pointing to LocalStack
  or Mailpit (`decision-email-provider.md:33-36`). `docs/ROADMAP.md:251-252` says the domain is «ya comprado» and AWS is
  frozen by the user (2026-11-22). No email code, config, template or HMAC helper exists in the backend.
- **Users**: `users.email TEXT NOT NULL`, soft delete `deleted_at`, unique on `email` among live users
  (`db/migrations/00005_create_users.sql:6,13,22-23`); there is no `email_verified` column — candidate accounts are only
  created when the identity provider reports a verified email
  (`internal/features/identity/application/usecases/candidate_identity.go:78`). `company_candidates.email_normalized =
  lower(btrim(email))` is the existing normalization precedent (`db/migrations/00036_company_candidates.sql:27-30`).
- **Token precedents** are random opaque tokens stored as SHA-256: stakeholder invitations (32 random bytes, base64url,
  hash in DB, `internal/features/companies/application/usecases/stakeholderInvitationService.go:25,64-75,112-113`) and
  psychometric links (43-char base64url, one outcome for malformed / unknown / expired / revoked,
  `internal/features/psychometrics/application/invitations/links.go:16-35`). Neither is stateless.
- **Public routes** sit outside auth groups; the public assessment group uses `Cache-Control: no-store` +
  `Referrer-Policy: no-referrer` (`internal/features/psychometrics/infrastructure/http/assessment.go:23-29`) and an
  in-process per-instance limiter (`cmd/api/router.go:186-198`, `internal/runtime/ratelimit/assessment.go:1-3`).
  Request logs carry chi's route pattern, never the raw path or query (`internal/runtime/middleware/request.go:50-54`).
- **Routes**: member notifications behind `NoStore, requireAuth, requireDocumentReader` (owner, recruiter, stakeholder,
  `cmd/api/router.go:308-319`); candidate notifications behind `NoStore, requireAuth, requireCandidate`
  (`router.go:321-332`). Stakeholders never receive rows in stage 1 (v1 D6).
- **Errors**: shared catalog (`internal/shared/httpjson/errors.go:53-120`), `rate_limited` 429
  (`httpjson/rate_limit_errors.go:9,15`), 422 precedents such as `document_link_invalid`
  (`httpjson/document_errors.go:53`); bodies through `httpjson.DecodeJSON` with a size cap (`httpjson/decode.go:14`).
- **Config** is loaded by `internal/runtime/config/*.go` loaders taking `getenv` and validating without echoing values
  (e.g. `internal/runtime/config/site_media.go:21-60`, which refuses dev endpoints when `APP_ENV=production`).
- **Compose**: `backend/docker-compose.yml:1-21` has Postgres 16 only; MinIO lives in `backend/docker-compose.minio.yml`
  bound to `127.0.0.1`. Retention: `cmd/notifications-purge` deletes notifications, then events
  (`cmd/notifications-purge/store.go:48-57`).
- **Next migration number:** `00069` (last is `db/migrations/00068_notifications.sql`). Database: PostgreSQL 16
  (`docs/modelo-de-datos-proyecto-04.md:3`), so `UNIQUE NULLS NOT DISTINCT` is available.

## Decisions

`S#` / `L#` refer to `odd/tasks/notifications-v2-backend.md`; `v1 D#` to `notifications-v1.md`.

| # | Source | Decision — reason |
| --- | --- | --- |
| D1 | S7 | **Preferences are keyed `(user_id, company_id, type, channel)` with `company_id NULL` for candidates**; a member's choices belong to their membership in that company — the frontend decision; a user is a member or a candidate, never both. |
| D2 | S2, S5, S8 | **Defaults come from the type's kind in a closed code table; the table stores only sparse override rows; effective = row if present, else default.** Mandatory: `in_app` and `email` on and locked. Operational: `in_app` on, `email` off (S2), **except the three candidate types: `email` on by default** (user decision Q1, 2026-11-26). Informative (none yet): `in_app` on, `email` off. Mandatory rows are refused by the API (422) and by a DB `CHECK` — no way to store an override that would be ignored. |
| D3 | S8 | **`GET …/preferences` returns the caller's full catalog** (their recipient kind's types × both channels) with `default`, `enabled` (effective) and `mandatory_locked` — the frontend never duplicates the type table. |
| D4 | S8 | **`PUT …/preferences` takes a partial list, is atomic (all or nothing) and idempotent, writes an explicit row for every entry (even when equal to the default) and returns the full catalog** — an explicit choice survives a later change of defaults, retries are harmless, and the response is directly renderable. |
| D5 | — | **Preference changes (settings or unsubscribe) are not audited.** The audit log is the company's record of actions on company data (owner screen); personal channel choices are not company data, candidates have no company, and the row keeps `source` + `updated_at` for support. Same reasoning as v1 D23. |
| D6 | S5, S8 | **In-app off ⇒ the row is still created, hidden (`notifications.in_app = false`), decided at creation and never resurfaced.** Full justification in §In-app off. |
| D7 | S2 | **Preferences are evaluated when the notification is created** (both channels, same tx) and the email preference is **re-checked at send time** — a change applies to everything not yet sent; nothing is re-created or resurrected afterwards. |
| D8 | S4, S7 | **A new table `notification_email_deliveries` holds one row per email to send**, created by the fan-out and the scheduler **in the same tx, isolated by a savepoint, and only for notification rows actually inserted** (`InsertNotification` becomes `:execrows`) — exactly-once per notification inherits v1 D21, no extra infrastructure; an email-side failure rolls back only to the savepoint, so the in-app rows (and the scheduler run) still commit and that batch gets no email (L13). |
| D9 | S2, S3, S7 | **Email eligibility at creation** = mailer not `off` ∧ effective email preference on ∧ recipient user live (`deleted_at IS NULL`) with a non-empty email ∧ `lower(btrim(email))` not in `email_suppressions`. Candidates are reached only through accounts (stage-1 rows already exist only for organic participations, v1 D6). Suppression wins over mandatory: a bounced address is never mailed. |
| D10 | S4 | **Coalescing per `(recipient, group_key)` with a fixed 10-minute window** for the three grouped types; single groups (`n:<id>`, every mandatory type) send immediately. One open delivery per recipient and group, enforced by a partial unique index. Exact rules in §Coalescing. |
| D11 | S4, S6 | **At send time a delivery is skipped** (no email) when the recipient is gone or has no address, the address got suppressed, the email preference is now off, every linked notification is resolved (any kind), or — non-mandatory only — every linked notification was already read in the app. |
| D12 | — | **Sender = in-process loop in every instance** (like the fan-out, v1 D4): short claim tx with `FOR UPDATE SKIP LOCKED` and a lease, send outside any tx, fenced finalize; transient failures retry with backoff, permanent ones fail at once; per-instance throttle. Package names avoid `worker` / `outbox` (archguard). |
| D13 | S7 | **`Mailer` port with `log` and `smtp` adapters now** (Mailpit in the dev compose); `ses` is a reserved value, rejected until the SES adapter ships. `NOTIFICATIONS_MAILER=off` (default) creates no deliveries and starts no sender. |
| D14 | S6 | **Email content is minimal**: type, count (groups), vacancy title (Q2), company name, dates in `America/Mexico_City`, one deep link to the app and the footer link(s). **Never** candidate names, actor names, free text (discard messages, reassignment notes) or ids in visible text. |
| D15 | S7 | **Non-mandatory emails carry `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) and a visible «Dejar de recibir este tipo de correo» link; mandatory emails carry no unsubscribe header and only link to «Mis preferencias».** |
| D16 | S7 | **Unsubscribe token = stateless HMAC-SHA256 with a key id, payload `{v, u, c, t, x}`, 365-day expiry, verified in constant time; every invalid token gets one identical response.** Key rotation by keeping old keys as verify-only. Details in §Unsubscribe. |
| D17 | S7, Q4 | **Public endpoints**: `POST /v2/notifications/unsubscribe?token=…` (one-click and landing confirm, idempotent) and `GET` the same URL (never mutates: link scanners prefetch GETs) returning what would be turned off. In the frontend the landing page (`/notificaciones/baja`) and the one-click route handler (`/api/notificaciones/baja`) live on **different paths** (a Next page and a route handler cannot share one); both reach these same two backend endpoints (§Unsubscribe). Effect = upsert `(user, company, type, email, enabled=false, source='unsubscribe')`; never for mandatory types (no token is ever issued for them, and they are refused). |
| D18 | S7 | **`email_suppressions(address, reason bounce\|complaint\|manual, created_at)` designed now**, global (not per user or feature), consulted at delivery creation and at send; rows are inserted manually for now, ingestion arrives with SES. |
| D19 | S6 | **The recipient address is never copied** into deliveries or logs; the sender reads `users.email` at send time — no extra PII store, address changes apply to pending emails. |
| D20 | v1 D22 | **Deliveries follow the 180-day retention** in `cmd/notifications-purge` (terminal rows only); preferences and suppressions are kept until the user is deleted / manually. |
| D21 | S9, L2 | **Delivery is DB-backed and in-process, deviating from the queue design of `docs/decision-email-provider.md:11`** (EventBridge/SQS/Fargate worker): AWS is frozen (S9) and archguard forbids worker/outbox paths. The `Mailer` port keeps SES pluggable; the decision doc gets a follow-up note (Q10). |
| D22 | S7 | **Templates live in the backend** (embedded Go templates, plain-text + HTML from the same copy), one per email-enabled type and per group form; **the Spanish copy comes from the frontend** (§Templates). Deep links are built from the existing link descriptors plus the frontend path map (Q3, §Templates). |
| D23 | — | **Stakeholders get the member catalog** behind the same gate as their inbox (`requireDocumentReader`), although no rule notifies them in stage 2 — one gate per tree, and stage-3 role rules will read the same preferences (Q7: hide the page in the UI until then). |

## Data model (migration `00069_notifications_email`, proposal)

```sql
-- Personal preferences (D1, D2, D4): sparse explicit overrides; defaults live in code.
CREATE TABLE notification_preferences (
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id  uuid NULL REFERENCES companies(id) ON DELETE CASCADE,       -- NULL = candidate (D1)
    type        text NOT NULL CHECK (type IN (                              -- mandatory types can never be stored (D2)
                    'application_received','delivery_due_soon','assignment_deadline_due_soon',
                    'psychometric_completed','psychometric_pending',
                    'candidate_status_changed','candidate_message_received','candidate_test_pending')),
    channel     text NOT NULL CHECK (channel IN ('in_app','email')),
    enabled     boolean NOT NULL,
    source      text NOT NULL CHECK (source IN ('settings','unsubscribe')), -- support trace instead of audit (D5)
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_preferences_key UNIQUE NULLS NOT DISTINCT (user_id, company_id, type, channel),
    CHECK ((company_id IS NULL) = (type IN ('candidate_status_changed','candidate_message_received','candidate_test_pending')))
);

-- Suppression list (D18): global, normalized address; ingestion arrives with SES.
CREATE TABLE email_suppressions (
    address     text PRIMARY KEY CHECK (address = lower(btrim(address)) AND address <> '' AND char_length(address) <= 320),
    reason      text NOT NULL CHECK (reason IN ('bounce','complaint','manual')),
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per email to send (D8, D10, D12). No address column (D19).
CREATE TABLE notification_email_deliveries (
    id                uuid PRIMARY KEY,                                     -- uuid v7; also the Message-ID local part
    recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- never blocks a user hard delete
    recipient_kind    text NOT NULL CHECK (recipient_kind IN ('member','candidate')),
    company_id        uuid NULL REFERENCES companies(id) ON DELETE CASCADE, -- same rule as notifications
    type              text NOT NULL CHECK (type IN (/* the same 14 values as notifications.type */)),
    group_key         text NOT NULL CHECK (char_length(group_key) BETWEEN 3 AND 120),
    job_id            uuid NOT NULL,
    status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sending','retry','sent','skipped','failed')),
    skip_reason       text NULL CHECK (skip_reason IN
                      ('recipient_gone','no_address','suppressed','preference_off','resolved','read')),
    send_after        timestamptz NOT NULL,                                 -- window close (grouped) or creation (single)
    attempts          integer NOT NULL DEFAULT 0,
    next_attempt_at   timestamptz NULL,                                     -- status 'retry'
    lease_until       timestamptz NULL,                                     -- status 'sending'
    error_class       text NULL CHECK (error_class IN ('transient','permanent')),  -- never a provider message
    provider_message_id text NULL,
    sent_at           timestamptz NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CHECK ((recipient_kind = 'candidate') = (company_id IS NULL)),
    CHECK ((status = 'skipped') = (skip_reason IS NOT NULL)),
    CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
    CHECK ((status = 'retry') = (next_attempt_at IS NOT NULL)),   -- the claim clears next_attempt_at
    CHECK ((status = 'sending') = (lease_until IS NOT NULL))      -- every finalize clears lease_until
);
-- At most one open window per recipient and group (D10); 'retry'/'sending' rows are outside it on purpose.
CREATE UNIQUE INDEX notification_email_deliveries_open ON notification_email_deliveries (recipient_user_id, group_key)
    WHERE status = 'pending';
-- Sender claim (D12).
CREATE INDEX notification_email_deliveries_due ON notification_email_deliveries (send_after, id)
    WHERE status IN ('pending','retry','sending');
-- Retention (D20).
CREATE INDEX notification_email_deliveries_created ON notification_email_deliveries (created_at);

ALTER TABLE notifications
    ADD COLUMN in_app boolean NOT NULL DEFAULT true,                        -- D6: false = hidden from every inbox read
    ADD COLUMN email_delivery_id uuid NULL REFERENCES notification_email_deliveries(id) ON DELETE SET NULL;
CREATE INDEX notifications_email_delivery ON notifications (email_delivery_id) WHERE email_delivery_id IS NOT NULL;
-- The unread counter / attention index only covers visible rows (D6).
DROP INDEX notifications_recipient_unread;
CREATE INDEX notifications_recipient_unread ON notifications (recipient_user_id, group_key)
    INCLUDE (type, job_id) WHERE read_at IS NULL AND resolved_at IS NULL AND in_app;
```

- Existing rows get `in_app = true` (the default); no backfill of preferences or deliveries.
- A notification links to at most one delivery (`email_delivery_id`); a delivery covers 1..n notifications of one
  recipient, group, type and job. The count shown in an email is the number of linked rows at send time.
- Down migration: restore the stage-1 unread index, drop the two columns, then the three tables (data disposable).

## Preferences (D1–D5, D23)

### Default table (code, `domain`)

| Kind | `in_app` default | `in_app` locked | `email` default | `email` locked |
| --- | --- | --- | --- | --- |
| mandatory | on | yes | on | yes |
| operational | on | no | **off** (S2); **on** for the three candidate types (Q1, D2) | no |
| informative (no type yet) | on | no | off | no |

Per type (member tree: 11 types; candidate tree: 3 types; order = `types.go:90-105`):

| Type | Kind | Tree | `in_app` | `email` |
| --- | --- | --- | --- | --- |
| `application_received` | operational | member | on | off |
| `delivery_due_soon` | operational | member | on | off |
| `delivery_overdue` | mandatory | member | on 🔒 | on 🔒 |
| `assignment_deadline_due_soon` | operational | member | on | off |
| `assignment_deadline_overdue` | mandatory | member | on 🔒 | on 🔒 |
| `vacancy_assigned` | mandatory | member | on 🔒 | on 🔒 |
| `vacancy_reassigned` | mandatory | member | on 🔒 | on 🔒 |
| `vacancy_unassigned` | mandatory | member | on 🔒 | on 🔒 |
| `vacancy_team_added` | mandatory | member | on 🔒 | on 🔒 |
| `psychometric_completed` | operational | member | on | off |
| `psychometric_pending` | operational | member | on | off |
| `candidate_status_changed` | operational | candidate | on | on (Q1) |
| `candidate_message_received` | operational | candidate | on | on (Q1) |
| `candidate_test_pending` | operational | candidate | on | on (Q1) |

**Effective preference** of `(user, company, type, channel)` = the override row's `enabled` if one exists, else the
default above; a locked pair is always on (no row can exist, D2).

### Endpoints

| Tree | Path | Middleware | Scope |
| --- | --- | --- | --- |
| Members | `/v2/me/company/notifications/preferences` | `NoStore, requireAuth, requireDocumentReader` (same group as the inbox, `router.go:311`) | session user + `CompanyContext.company_id`; member types |
| Candidates | `/v2/me/notifications/preferences` | `NoStore, requireAuth, requireCandidate` (`router.go:324`) | session candidate account, `company_id NULL`; candidate types |

#### `GET …/preferences`

```json
{
  "channels": ["in_app", "email"],
  "email_deliverable": true,
  "items": [
    {
      "type": "application_received",
      "kind": "operational",
      "channels": {
        "in_app": { "default": true,  "enabled": true, "mandatory_locked": false },
        "email":  { "default": false, "enabled": true, "mandatory_locked": false }
      }
    },
    {
      "type": "delivery_overdue",
      "kind": "mandatory",
      "channels": {
        "in_app": { "default": true, "enabled": true, "mandatory_locked": true },
        "email":  { "default": true, "enabled": true, "mandatory_locked": true }
      }
    }
  ]
}
```

- `items`: every type of the caller's tree, in table order (11 member / 3 candidate), always both channels.
- `enabled` is the effective value (D2). `default` lets the UI show «(predeterminado)» / offer a reset.
- `email_deliverable`: `false` when the account email is suppressed (or empty), so the UI can explain why nothing
  arrives; the address and the suppression reason are not returned.
- Response `Cache-Control: no-store` (group middleware). Not audited (D5).

#### `PUT …/preferences`

Body: a partial list; only the listed pairs change.

```json
{
  "preferences": [
    { "type": "application_received", "channel": "email",  "enabled": true },
    { "type": "psychometric_pending",  "channel": "in_app", "enabled": false }
  ]
}
```

- 1–28 entries; each `(type, channel)` at most once; `enabled` is required (boolean).
- Atomic: validation runs over the whole list first; any error writes nothing.
- Each entry upserts `(user, company, type, channel)` with `source = 'settings'`, `updated_at = now()` — even when
  `enabled` equals the default (D4). Idempotent: the same body twice leaves the same state.
- Response `200` = the full `GET` body after the change.
- Takes effect for notifications created afterwards; pending emails are re-checked at send (D7, D11). Hidden rows
  never reappear when `in_app` is turned back on (D6).

Errors specific to preferences:

| Status | Code | When |
| --- | --- | --- |
| 400 | `validation_error` | missing / empty / over-long `preferences`; unknown `type` or `channel`; a type of the other tree (candidate type on the member route or vice versa); duplicate `(type, channel)`; missing or non-boolean `enabled` — `fields[]` names e.g. `preferences[1].type` |
| 422 | `notification_preference_locked` (**new**) | any entry targets a mandatory type (either channel), whatever `enabled` says; `data: {"types": ["delivery_overdue"]}`. Nothing is written. |

Plus the gate errors of each tree (`unauthenticated`, `forbidden`, `company_inactive`, `account_required`,
`wrong_role`), `invalid_request` and `payload_too_large` from the shared decoder (v1 §Error codes).

## In-app off (D6, S5, S8)

**Choice: create the row, hidden** — `notifications.in_app = false`, set at creation from the effective `in_app`
preference; mandatory types are always `true`. Every inbox read and mark query adds `AND n.in_app` to its caller scope.

Why, over "do not create the row":

1. **Dedupe stays in one place.** v1 D21 makes the notification row the exactly-once record. The scheduler re-evaluates
   due-soon deadlines every 15 min; without a row, a member with in-app off and email on would get the due-soon email
   again on every run unless deliveries duplicated the dedupe keys. Keeping the row keeps the existing unique indexes
   as the only dedupe.
2. **Email still needs the notification.** Coalescing is by `group_key` and the email counts linked rows; a delivery
   linked to real rows reuses grouping, links (`inbox/link.go`) and resolution (`ResolveStaleScheduledNotifications`
   also resolves hidden rows, so a pending email for a fulfilled deadline is skipped, D11) with no parallel model.
3. **Unread counters stay correct and cheap.** The rebuilt partial index adds `AND in_app`, so `unread-count` remains an
   index-only count over visible unread rows; hidden rows are never counted, marked, faceted or listed.
4. **Re-enabling is predictable.** `in_app` is a creation-time snapshot like the email decision (D7): turning the
   channel back on shows new items only, never a burst of old ones, and «Deshacer» / `read-all` cannot reveal hidden
   rows because marks are scoped by `in_app` too.
5. **Retention is unchanged.** Hidden rows expire with the 180-day purge like any other.

Cost, accepted: one predicate in each of the ten scoped statements listed in §Backend facts plus the index rebuild. A
guard test asserts that every query in `db/queries/notifications.sql` that filters by `recipient_kind` also filters by
`in_app` (or is the sender's explicit exception), so a future query cannot leak hidden rows.

A hidden row is created even when the email is off too (the cost is one row; it keeps the creation path single and the
scheduler's dedupe intact).

## Email delivery (D7–D13, D19)

### Creation (fan-out and scheduler, same tx, email steps in a savepoint)

For each notification row **actually inserted** (fan-out: `InsertNotification` changed to `:execrows`; scheduler:
`InsertScheduledNotification` already returns rows, `run.go:121-135`):

1. Read in the same tx, with one query: the effective `in_app` / `email` preferences of `(recipient, company, type)`,
   `users.deleted_at` / `users.email` and whether `lower(btrim(users.email))` is in `email_suppressions`. (Step 1 runs
   before the insert so `in_app` can be written; the delivery steps run after it.)
2. If the email is eligible (D9) — otherwise stop:
   - grouped type (`application_received`, `psychometric_completed`, `psychometric_pending`):
     ```sql
     INSERT INTO notification_email_deliveries (id, recipient_user_id, recipient_kind, company_id, type, group_key, job_id, send_after)
     VALUES ($id, $user, $kind, $company, $type, $group_key, $job, now() + interval '10 minutes')
     ON CONFLICT (recipient_user_id, group_key) WHERE status = 'pending'
     DO UPDATE SET updated_at = now()
     RETURNING id;
     ```
   - single group (every other type, including all mandatory): plain insert with `send_after = now()`.
3. `UPDATE notifications SET email_delivery_id = $returned_id WHERE id = $notification_id`.

Steps 2–3 (and their email-preference / deliverability reads) run inside a **savepoint** of the creating tx
(`emaildelivery.CreateIsolated`, L13). If any of them fails, the tx rolls back to the savepoint only: the in-app rows
stay, the event is marked processed (no failed attempt) or the scheduler run commits its rows and resolution, those rows
get **no delivery** (no email, never retried), and the failure is logged with `step = email` and its SQLSTATE only. A
failure of the in-app steps still fails the event's tx like any stage-1 insert (v1 D4 backoff); a failure to open,
release or roll back the savepoint itself fails the tx too. With `NOTIFICATIONS_MAILER=off` steps 2–3 are skipped.

### Coalescing (D10, S4)

- **Window opens** when an eligible notification of a grouped type is inserted for a recipient and **no `pending`
  delivery exists for that `(recipient_user_id, group_key)`**: a delivery is created with `send_after = now() + 10 min`.
- **While open**, every further eligible notification of the same recipient and group links to that delivery (the
  `ON CONFLICT … DO UPDATE` returns its id). The window is **fixed, not sliding**: later rows never push `send_after`,
  so the first event of a burst is emailed at most ~10 min (+ the sender period) after it was fanned out.
- **Window closes** when the sender claims the delivery (`pending → sending`, at or after `send_after`). From then on
  it is outside the partial unique index, so the next eligible notification of the group opens a new window. (If the
  fan-out's upsert is waiting on the claim's row lock, PostgreSQL re-checks the arbiter after the claim commits and
  inserts a new delivery; an integration test covers this race.)
- **One email covers**: one recipient, one type, one job and one local day (all encoded in `group_key`, v1 D11) and
  `count` = the notifications linked to the delivery at send time. Because `group_key` carries the
  `America/Mexico_City` date, a burst crossing local midnight yields two emails (Q8).
- **Idempotency**: one delivery per notification (`notifications.email_delivery_id`, set once in the creating tx; a
  re-run of the scheduler or a retried event inserts no notification, hence no delivery); one open window per group
  (`notification_email_deliveries_open`); one email per delivery under normal operation (see §Sender for the crash
  case).

### Sender (D11, D12)

Package `internal/features/notifications/email` (templates, `Mailer` port) with adapters in
`internal/features/notifications/email/logmail` and `…/email/smtpmail` (later `…/email/sesmail`); the loop is
`internal/features/notifications/sender` (no `worker` / `outbox` in the path, archguard). Composed in
`cmd/api/notifications_email.go` (`newNotificationSender`: mailer adapter, renderer with the unsubscribe signer, throttle)
before any background loop starts — a non-off mailer that cannot be fully composed refuses startup — and started after
the fan-out and the scheduler, stopped first (waiting for its in-flight delivery) before the pool closes, only when
`NOTIFICATIONS_MAILER ≠ off`.

Every instance, every **5 s** (and once at start), up to **20 deliveries per tick**, each:

1. **Claim** (own short tx): the oldest due row —
   `status = 'pending' AND send_after <= now()`, or `status = 'retry' AND next_attempt_at <= now()`, or
   `status = 'sending' AND lease_until < now()` (crashed sender) — `ORDER BY send_after, id LIMIT 1 FOR UPDATE SKIP
   LOCKED`; set `status = 'sending'`, `attempts = attempts + 1`, `lease_until = now() + 2 min`, `next_attempt_at = NULL`
   (the timer CHECK); one autocommit statement. No network call ever happens inside a tx, so the fan-out is never
   blocked behind an SMTP call.
2. **Re-check** (D11, read-only, each read its own autocommit statement), in this order: recipient exists, live and —
   for a member delivery — still a member of the delivery's company, company not soft-deleted (`recipient_gone`);
   non-blank address (`no_address`); address not suppressed (`suppressed`); effective email preference still on,
   mandatory always (`preference_off`); linked rows not all resolved — no linked row left counts as resolved
   (`resolved`); non-mandatory: linked rows not all read (`read`; `read_at IS NOT NULL`; hidden rows are never read, so
   they never cause a skip). Failing any → finalize `skipped` with that `skip_reason`. A read failure is a transient
   failure.
3. **Render** the template (§Templates) with the variables of §Content (count = linked rows, group day = the oldest
   linked row, payload enums of the latest; the link through the inbox rule `inbox.LinkFor`, member `can_open` = owner or
   active assignment, candidates only while they participate) and **send** through the `Mailer` with a 15 s timeout,
   after taking a throttle slot. A view that cannot render (unknown label code, inconsistent link) is a permanent
   failure; a throttle refused by shutdown is a transient one.
4. **Finalize** (own tx, fenced by `WHERE id = $id AND status = 'sending' AND lease_until = $lease`):
   - success → `sent`, `sent_at`, `provider_message_id`, `error_class NULL`;
   - transient error (network, timeout, SMTP 4xx, provider throttling) → `retry` with
     `next_attempt_at = now() + min(1 min · 2^(attempts−1), 1 h)`; at **8 attempts** → `failed` (`error_class =
     'transient'`), ~4 h of retries;
   - permanent error (`Mailer` returns `ErrPermanent`: SMTP 5xx on the recipient, invalid address) → `failed`
     (`error_class = 'permanent'`). No automatic suppression in stage 2 (that is SES ingestion).
   A fenced update that matches nothing (lease expired and another instance took over) is logged and ignored.
- **Throttle**: a per-instance pacer of `NOTIFICATIONS_EMAIL_MAX_PER_SECOND` (default **1**, the SES sandbox rate):
  one slot every 1/rate, burst one, taken only right before a send (skips cost nothing), so no second ever exceeds
  the rate; the global rate is that value × instances (Q5). A tick waits for its slots (a 20-claim tick at 1/s lasts
  ~20 s; the next tick starts after it) instead of stopping early, which with a one-second bucket would cap the rate at
  one email per period. The finalize runs even on shutdown (an attempt cut short becomes a `retry`).
- **At-least-once**: an instance that crashes after the provider accepted a message but before finalizing leaves a
  `sending` row whose lease expires; it is sent again. Accepted (rare, non-production); the stable `Message-ID`
  (`<delivery_id@sender domain>`) lets clients collapse duplicates.
- **Logs** carry delivery id, type, status, step, attempt and error class only — never the address, subject, body or
  provider error text (same discipline as `fanout/process.go:127-143`).

### `Mailer` port and adapters (D13)

```go
type Message struct {
    To, From, Subject, Text, HTML string
    MessageID string            // "<delivery_id@domain>"
    Headers   map[string]string // List-Unsubscribe, List-Unsubscribe-Post, Auto-Submitted
}
type Mailer interface {
    Send(ctx context.Context, m Message) (providerID string, err error) // wrap ErrPermanent for permanent failures
}
```

| `NOTIFICATIONS_MAILER` | Adapter | Use |
| --- | --- | --- |
| `off` (default) | none | no deliveries created, no sender (D13) |
| `log` | writes one structured line per email: delivery id, type, template, has-unsubscribe — no address, no body | CI, dev without Mailpit |
| `smtp` | plain SMTP to `NOTIFICATIONS_SMTP_HOST:NOTIFICATIONS_SMTP_PORT`, `multipart/alternative` text + HTML, no auth in dev | Mailpit in dev |
| `ses` | reserved; startup error until the SES adapter exists | after AWS is released (S9) |

Dev compose: a `mailpit` service added to `backend/docker-compose.yml` (pinned `axllent/mailpit` tag, SMTP
`127.0.0.1:1025`, web UI `127.0.0.1:8025`, no volume — mails are disposable).

### Config keys (names only)

| Key | Required when | Meaning |
| --- | --- | --- |
| `NOTIFICATIONS_MAILER` | — | `off` \| `log` \| `smtp` (`ses` reserved); default `off` |
| `NOTIFICATIONS_EMAIL_FROM` | mailer ≠ off | sender, e.g. `PeopleFlow <no-reply@…>` (domain deferred to the SES work, Q11) |
| `NOTIFICATIONS_SMTP_HOST`, `NOTIFICATIONS_SMTP_PORT` | mailer = smtp | Mailpit `localhost` / `1025` in dev; refused when `APP_ENV=production` |
| `NOTIFICATIONS_EMAIL_MAX_PER_SECOND` | — | per-instance throttle, integer 1–1000, default `1`; read only when the mailer is not off |
| `NOTIFICATIONS_UNSUBSCRIBE_KEYS` | mailer ≠ off (also loaded and validated when present with the mailer off) | secret: comma list `kid:base64key` (kid `[a-z0-9]{1,16}`, distinct; std or URL-safe base64), first signs, all verify; each key ≥ 32 bytes. **Independent of the mailer**: with `NOTIFICATIONS_MAILER=off` (kill switch) nothing is sent, but present keys still build the verifier so links already in inboxes keep working; keep the keys configured when turning the mailer off |
| `NOTIFICATIONS_UNSUBSCRIBE_URL` | mailer ≠ off | absolute https URL (http allowed outside production) that receives the one-click POST; value = `APP_BASE_URL` + `/api/notificaciones/baja` (frontend pass-through, Q4); the backend appends `?token=…` |
| `APP_BASE_URL` | mailer ≠ off | frontend origin for deep links, «Mis preferencias» and the unsubscribe landing (paths in §Templates, Q3) |

Loaded by a new `internal/runtime/config/notifications_email.go` (same style as `site_media.go`: validate, never echo
values; the keys list is never logged).

## Content (D14, D15, S6, S7)

- **Subject and body** come from the template of the type and group form (§Templates); the visible text never contains
  candidate names, actor / member names, discard messages, reassignment notes, emails or ids.
- **Variables** are resolved at send time: `job_title` (members: the current draft title, like
  `ListNotificationJobs`, `db/queries/notifications.sql:303-319`; candidates: the public title they see in
  `/v2/me/applications`, like `ListCandidateNotificationJobs`, `:492-507`; `null` → template fallback «una vacante»),
  `company_name` (the member's own company / the hiring company for candidates; `null` → «una empresa»), `count`, `date_local` (group day),
  `commitment_date_local`, `function`, `reason`, `status`. Dates are formatted in Spanish in
  `America/Mexico_City` (e.g. «26 de noviembre de 2026»); no times are shown except `sent_at_local` if the copy wants it.
- **Deep link** (`app_url`): `APP_BASE_URL` + the path the frontend assigns to the item's existing link descriptor
  (`inbox/link.go:22-56`; path map in §Templates, Q3), computed for the delivery's group (`count = 1` →
  `participation`, else `vacancy_candidates`). **`vacancy_unassigned` (T13) may have a `null` link** (the recipient can
  no longer open the vacancy, v1 D19): then `app_url` = `APP_BASE_URL` + `/empresa`. The app enforces access as usual (login, vacancy access); the email adds no token to it.
  Candidate tests link to the in-app assessment (`assessment {invitation_id}`), never to a public assessment token.
- **Footer**:
  - non-mandatory: «Mis preferencias» (`preferences_url`) + «Dejar de recibir este tipo de correo»
    (`unsubscribe_url` = `APP_BASE_URL` + `/notificaciones/baja?token={token}`, the landing page, Q3);
  - mandatory: «Mis preferencias» only, with a line explaining these emails are required (S7).
- **Headers** (non-mandatory only): `List-Unsubscribe: <{NOTIFICATIONS_UNSUBSCRIBE_URL}?token=…>` (the one-click
  route handler `/api/notificaciones/baja`, a different path from the landing, Q4) and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). All emails: `Auto-Submitted: auto-generated`,
  `Message-ID: <delivery_id@domain>`. (RFC 8058 also needs a DKIM signature covering these headers — that is the
  SES/domain step, out of scope.)
- `preferences_url` = `APP_BASE_URL` + `/empresa/configuracion/notificaciones` (member) or
  `/candidato/configuracion/notificaciones` (candidate) (Q3).

## Unsubscribe (D16, D17)

### Token

- Format: `<kid>.<payload>.<mac>` — `payload` = base64url (no padding) of compact JSON
  `{"v":1,"u":"<user_id>","c":"<company_id>"|null,"t":"<type>","x":<unix expiry>}`;
  `mac` = base64url(HMAC-SHA256(key[kid], "pf-notif-unsub:v1:" + kid + "." + payload)), 32 bytes.
- Issued per email (non-mandatory types only), expiry **365 days** after issue (Q9). No database row: stateless.
- **Rotation**: `NOTIFICATIONS_UNSUBSCRIBE_KEYS` lists `kid:key` pairs; the first signs, every listed key verifies.
  Rotate by prepending a new key; drop an old one after 365 days (its links then become invalid). `kid` matches
  `[a-z0-9]{1,16}`.
- **Verify** in this order, every failure collapsing into the same outcome: total length ≤ 512 and charset
  `[A-Za-z0-9_.-]`; three parts; known `kid` (an unknown `kid` is verified against a per-process random key so the
  work is the same); recompute the MAC and compare with `hmac.Equal` (constant time); then decode the payload; `v = 1`;
  `x > now`; `t` is a non-mandatory type of the tree implied by `c` (company → member type, null → candidate type);
  user exists, live and of the matching `user_type`; for a member token, the company exists and is not soft-deleted.
  **Company membership is not re-checked**: the row is keyed by the token's company (D1), so it only ever affects mail
  of that company, and a former member can still stop it. A user or company deleted between the check and the upsert
  (FK violation) is the same invalid outcome. The token is never logged (request logs carry the route pattern only,
  `internal/runtime/middleware/request.go:50-54`); store failures log their step and SQLSTATE only.

### Endpoints (public)

Group outside auth: `Cache-Control: no-store`, `Referrer-Policy: no-referrer` (as `AssessmentPrivacy`). No cookies or
session are read. **Limits** (in-process, per instance, fixed 10-minute windows, applied after the token check so a
limited request never reaches the database), both → `429 rate_limited` with `Retry-After`:

- **invalid token** (any cause the token check refuses): **60 / 10 min per client IP** — the probing vector. The client
  IP is the one requestmeta resolves before every route: the BFF-attested `X-PF-Client-IP` when `X-PF-Proxy-Secret`
  matches, else the TCP peer or, only behind `TRUSTED_PROXY_CIDRS`, the forwarded client; IPv6 shares its /64;
- **valid token**: **10 / 10 min per token** (per `(user, company, type)`; the effect is idempotent) and never counted
  per IP, so a mail provider or the BFF relaying many people's one-clicks from one address never loses a legitimate
  unsubscribe. "Valid" means validly signed and unexpired: a token whose user or company is gone (answered with the
  uniform 422) still counts against **its per-token budget, not the IP's** — it cannot be forged at will, so it is no
  probing vector (L17).

A full limiter table never refuses a new client: single-request entries are evicted oldest first, clients that already
spent more keep their budget.

| Method | Path | Effect |
| --- | --- | --- |
| GET | `/v2/notifications/unsubscribe?token=…` | none — returns what would be turned off (landing page and link-scanner safe) |
| POST | `/v2/notifications/unsubscribe?token=…` | upsert `email = false` for the token's `(user, company, type)`, `source = 'unsubscribe'`; idempotent |

- **Frontend origin, two paths (Q4)**. Emails only show the frontend origin:
  - **one-click** (`List-Unsubscribe`): `APP_BASE_URL` + `/api/notificaciones/baja?token=…`, a Next route handler that
    accepts **only `POST`** and forwards the token and the body to `POST /v2/notifications/unsubscribe?token=…`, with
    no cookies, no session and no same-origin check. It **MUST** forward `X-PF-Proxy-Secret` and `X-PF-Client-IP`
    (requestmeta, as the BFF already does for audit metadata) so the invalid-token per-IP limit sees the real client;
    without them every invalid request through the frontend shares the Next server's single budget;
  - **landing** (`unsubscribe_url` in the footer): `APP_BASE_URL` + `/notificaciones/baja?token=…`, a Next page that
    calls `GET /v2/notifications/unsubscribe` to show what would be turned off and confirms with a server action that
    calls `POST`.
  A Next page and a route handler cannot share a path, hence the two paths; the backend endpoints are the same for
  both.
- `POST` accepts the RFC 8058 body `List-Unsubscribe=One-Click` (`application/x-www-form-urlencoded`) from mail
  providers (forwarded by the one-click route), or an empty / `{}` body from the landing's server action; the body is
  ignored, capped at 1 KiB: over the cap → `413 payload_too_large`, **before** the token is checked.
- Valid token, both methods, `200`:

```json
{
  "type": "application_received",
  "channel": "email",
  "enabled": false,
  "company": { "id": "7c2a…", "name": "Acme Talento" }
}
```

  (`GET` reports the current effective value in `enabled`; `company` is `null` for candidates.) The type label is
  frontend copy.
- **Any** invalid token (malformed, bad MAC, unknown key, expired, mandatory or foreign type, user gone):
  `422 unsubscribe_link_invalid` (**new**, no `data`), identical bytes for every case.
- Never audited (D5); pending deliveries of that type are skipped at send by the re-check (D11).

## Suppression (D18)

- `email_suppressions` stores the normalized address (`lower(btrim(...))`, the `company_candidates` precedent) with
  `reason ∈ bounce | complaint | manual`. Stage 2 writes rows only manually (SQL, `reason = 'manual'`); bounce and
  complaint ingestion arrives with SES (out of scope).
- Consulted at delivery creation (D9) and at send (D11). It applies to mandatory emails too. In-app notifications are
  unaffected. `GET …/preferences` exposes only `email_deliverable: false`.
- Global on purpose: any future email feature (member invitations, `decision-email-provider.md:40`) must honour it.

## Templates (D22, S7, S8)

The Spanish copy below is the frontend review approved by the user (2026-11-26), kept **verbatim**; its source is
`odd/tasks/notifications-v2-backend.md` L5 (S10). Each template has a **subject**, a **heading**, **one body line** and a
**button label** (the button opens `app_url`), plus one footer. Variables in `{{…}}` are the only dynamic parts (none
is a candidate or actor name, D14). Every template receives `app_url`, `preferences_url` and `company_name`;
non-mandatory ones also `unsubscribe_url`. Templates ship with this copy in E5 (no placeholder copy). Values are
HTML-escaped in the HTML part.

### Template map

`app_url` = `APP_BASE_URL` + the path of the link kind (§Path map). Footer F2 for the mandatory types (🔒, type table in
§Preferences), F1 for every other type.

| # | Template id | Type / form | Variables | Footer | Link kind → `app_url` path |
| --- | --- | --- | --- | --- | --- |
| T1 | `application_received.one` | `application_received`, single (1 new application in the group) | `job_title`, `date_local` | F1 | `participation` → `/empresa/vacantes/{job_id}/pipeline?candidato={participation_id}` |
| T2 | `application_received.many` | `application_received`, group (coalesced) | `job_title`, `count`, `date_local` | F1 | `vacancy_candidates` → `/empresa/vacantes/{job_id}/pipeline` |
| T3 | `psychometric_completed.one` | `psychometric_completed`, single | `job_title` | F1 | `participation` → `/empresa/vacantes/{job_id}/pipeline?candidato={participation_id}` |
| T4 | `psychometric_completed.many` | `psychometric_completed`, group | `job_title`, `count` | F1 | `vacancy_candidates` → `/empresa/vacantes/{job_id}/pipeline` |
| T5 | `psychometric_pending.one` | `psychometric_pending`, single | `job_title` | F1 | `participation` → `/empresa/vacantes/{job_id}/pipeline?candidato={participation_id}` |
| T6 | `psychometric_pending.many` | `psychometric_pending`, group | `job_title`, `count` | F1 | `vacancy_candidates` → `/empresa/vacantes/{job_id}/pipeline` |
| T7 | `delivery_due_soon` | `delivery_due_soon`, single | `job_title`, `commitment_date_local` | F1 | `vacancy_delivery` → `/empresa/vacantes/{job_id}/configuracion/entrega` |
| T8 | `delivery_overdue` 🔒 | `delivery_overdue`, single | `job_title`, `commitment_date_local` | F2 | `vacancy_delivery` → `/empresa/vacantes/{job_id}/configuracion/entrega` |
| T9 | `assignment_deadline_due_soon` | `assignment_deadline_due_soon`, single | `job_title`, `commitment_date_local`, `function` | F1 | `vacancy_delivery` → `/empresa/vacantes/{job_id}/configuracion/entrega` |
| T10 | `assignment_deadline_overdue` 🔒 | `assignment_deadline_overdue`, single | `job_title`, `commitment_date_local`, `function` | F2 | `vacancy_delivery` → `/empresa/vacantes/{job_id}/configuracion/entrega` |
| T11 | `vacancy_assigned` 🔒 | `vacancy_assigned`, single | `job_title`, `company_name` | F2 | `vacancy` → `/empresa/vacantes/{job_id}/pipeline` |
| T12 | `vacancy_reassigned` 🔒 | `vacancy_reassigned`, single | `job_title`, `reason` | F2 | `vacancy` → `/empresa/vacantes/{job_id}/pipeline` |
| T13 | `vacancy_unassigned` 🔒 | `vacancy_unassigned`, single | `job_title`, `reason` | F2 | `vacancy` → `/empresa/vacantes/{job_id}/pipeline`; **link `null` → `/empresa`** |
| T14 | `vacancy_team_added` 🔒 | `vacancy_team_added`, single | `job_title`, `function` | F2 | `vacancy` → `/empresa/vacantes/{job_id}/pipeline` |
| T15 | `candidate_status_changed` | `candidate_status_changed`, single | `job_title`, `company_name`, `status` | F1 | `application` → `/candidato/postulaciones?postulacion={participation_id}` |
| T16 | `candidate_message_received` | `candidate_message_received`, single (message text never included) | `job_title`, `company_name` | F1 | `application` → `/candidato/postulaciones?postulacion={participation_id}` |
| T17 | `candidate_test_pending` | `candidate_test_pending`, single | `job_title`, `company_name` | F1 | `assessment` → `/candidato/evaluaciones/{invitation_id}` |
| F1 | `footer.optional` | non-mandatory footer | `preferences_url`, `unsubscribe_url` | — | — |
| F2 | `footer.mandatory` | mandatory footer | `preferences_url` | — | — |

The `.one` / `.many` choice follows the link rule of `inbox/link.go:22-29`: `count = 1` with a participation →
`.one` + `participation`; otherwise `.many` + `vacancy_candidates`.

### Path map (Q3)

All paths are appended to `APP_BASE_URL`; one code table with a test.

| Link / URL | Path |
| --- | --- |
| `vacancy`, `vacancy_candidates` | `/empresa/vacantes/{job_id}/pipeline` |
| `participation` | `/empresa/vacantes/{job_id}/pipeline?candidato={participation_id}` |
| `vacancy_delivery` | `/empresa/vacantes/{job_id}/configuracion/entrega` |
| `application` | `/candidato/postulaciones?postulacion={participation_id}` |
| `assessment` | `/candidato/evaluaciones/{invitation_id}` |
| `null` link (only `vacancy_unassigned`, T13) | `/empresa` |
| `preferences_url`, member | `/empresa/configuracion/notificaciones` |
| `preferences_url`, candidate | `/candidato/configuracion/notificaciones` |
| `unsubscribe_url` (landing page) | `/notificaciones/baja?token={token}` |
| `NOTIFICATIONS_UNSUBSCRIBE_URL` (one-click, `List-Unsubscribe`) | `/api/notificaciones/baja` (the backend appends `?token=`) |

### Copy (verbatim)

| # | Asunto | Encabezado | Línea | Botón |
| --- | --- | --- | --- | --- |
| T1 | Nueva postulación en {{job_title}} | Nueva postulación en {{job_title}} | Recibiste una postulación nueva el {{date_local}}. | Ver candidatos |
| T2 | {{count}} postulaciones nuevas en {{job_title}} | igual (= asunto: {{count}} postulaciones nuevas en {{job_title}}) | Llegaron {{count}} postulaciones nuevas el {{date_local}}. | Ver candidatos |
| T3 | Prueba psicométrica completada en {{job_title}} | Prueba psicométrica completada | Un candidato de {{job_title}} terminó su prueba psicométrica. | Ver resultado |
| T4 | {{count}} pruebas psicométricas completadas en {{job_title}} | {{count}} pruebas psicométricas completadas | {{count}} candidatos de {{job_title}} terminaron su prueba psicométrica. | Ver candidatos |
| T5 | Prueba psicométrica pendiente en {{job_title}} | Prueba psicométrica pendiente | Se envió una prueba psicométrica a un candidato de {{job_title}} y aún no la responde. | Ver candidato |
| T6 | {{count}} pruebas psicométricas pendientes en {{job_title}} | {{count}} pruebas psicométricas pendientes | Se enviaron {{count}} pruebas psicométricas a candidatos de {{job_title}} y aún no las responden. | Ver candidatos |
| T7 | La entrega de {{job_title}} vence pronto | La entrega vence pronto | La fecha compromiso de {{job_title}} es el {{commitment_date_local}}. | Ver entrega |
| T8 | La entrega de {{job_title}} está vencida | La entrega está vencida | La fecha compromiso de {{job_title}} era el {{commitment_date_local}}. | Ver entrega |
| T9 | Tu fecha límite en {{job_title}} se acerca | Tu fecha límite se acerca | Como {{function}} de {{job_title}}, tu entrega vence el {{commitment_date_local}}. | Ver entrega |
| T10 | Venció tu fecha límite en {{job_title}} | Venció tu fecha límite | Tu entrega como {{function}} de {{job_title}} era el {{commitment_date_local}}. | Ver entrega |
| T11 | Te asignaron {{job_title}} | Te asignaron una vacante | Ahora eres responsable de {{job_title}} en {{company_name}}. | Abrir vacante |
| T12 | Ahora eres responsable de {{job_title}} | Te reasignaron una vacante | Ahora eres responsable de {{job_title}}. Motivo: {{reason}}. | Abrir vacante |
| T13 | Ya no eres responsable de {{job_title}} | Se reasignó una vacante | Otra persona quedó a cargo de {{job_title}}. Motivo: {{reason}}. | Ir a PeopleFlow |
| T14 | Te agregaron al equipo de {{job_title}} | Te agregaron a un equipo | Formas parte del equipo de {{job_title}} como {{function}}. | Abrir vacante |
| T15 | Tu postulación a {{job_title}} cambió de estado | Tu postulación ahora está «{{status}}» | {{company_name}} actualizó tu proceso para {{job_title}}. | Ver postulación |
| T16 | {{company_name}} te dejó un mensaje | Tienes un mensaje sobre tu postulación | {{company_name}} te escribió sobre {{job_title}}. Por privacidad no lo incluimos aquí; léelo en PeopleFlow. | Leer mensaje |
| T17 | Tienes una prueba psicométrica pendiente | Tienes una prueba pendiente | {{company_name}} te envió una prueba psicométrica para {{job_title}}. | Empezar prueba |

T2's heading is «igual» in the review: the same text as its subject.

### Footers (verbatim)

- **F1** (non-mandatory): «Recibes este correo porque este aviso está activado en tus preferencias.», con los links
  «Mis preferencias» (`preferences_url`) · «Dejar de recibir este tipo de correo» (`unsubscribe_url`).
- **F2** (mandatory): «Este aviso es obligatorio y no se puede desactivar.», con el link «Mis preferencias»
  (`preferences_url`).

### Labels (verbatim)

| Variable | Code value → label |
| --- | --- |
| `function` | `responsible` → responsable · `collaborator` → colaborador · `member` → integrante |
| `reason` | `workload` → carga de trabajo · `recruiter_departure` → salida del reclutador · `performance` → desempeño · `client_request` → solicitud del cliente · `other` → otro motivo (the free-text note is never included) |
| `status` | `submitted` → Enviada · `in_process` → En proceso · `closed` → Cerrada |

### Fallbacks (verbatim)

- `job_title` null → «una vacante».
- `company_name` null → «una empresa».

## Error codes

Reused from the catalog plus two new codes:

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalid_request` | malformed JSON, unknown body field (preferences) |
| 400 | `validation_error` | preferences body errors (§PUT), `fields[]` |
| 401 | `unauthenticated` | preferences: missing / invalid session |
| 403 | `forbidden` / `company_inactive` | member preferences: existing gate |
| 403 | `account_required` / `wrong_role` | candidate preferences: existing gate |
| 413 | `payload_too_large` | body over the cap |
| 422 | `notification_preference_locked` (**new**) | PUT entry on a mandatory type; `data.types` |
| 422 | `unsubscribe_link_invalid` (**new**) | any invalid unsubscribe token, identical response |
| 429 | `rate_limited` | unsubscribe: invalid tokens over the per-IP limit, or a valid token over its per-token limit |

## Limits

`PUT` ≤ 28 entries (headroom over 11 member types × 2 channels = 22); unsubscribe token ≤ 512 chars, POST body ≤ 1 KiB, invalid tokens 60 / 10 min per IP, valid
tokens 10 / 10 min per token;
coalescing window 10 min; sender 5 s period, 20 claims per tick, lease 2 min, 8 attempts, backoff 1 min … 1 h,
throttle default 1 email/s per instance; token expiry 365 days.

## Audit

Preference changes (settings and unsubscribe) and email sends are **not audited** (D5). The delivery table is the send
trace (status, attempts, timestamps, error class) for 180 days.

## Deployment order

1. **Migration 00069** (additive; existing rows `in_app = true`; the unread index is rebuilt — trivial on
   non-production volumes).
2. **Backend slices** E1–E8 with `NOTIFICATIONS_MAILER=off` everywhere except dev (`smtp` + Mailpit). Nothing existing
   changes shape: inbox responses are identical (hidden rows simply never appear).
3. **Frontend** preferences screens after E2 is live; unsubscribe landing (`/notificaciones/baja`) and
   one-click route handler (`/api/notificaciones/baja`) after E7. The copy and the path map are already in §Templates.
4. **Real email** requires the SES adapter, verified domain and DKIM — blocked by S9; until then non-dev environments
   keep `off` (or `log`).
5. Purge (E8) any time before 180 days of deliveries exist.

## Slices (~400 lines each, tests included)

| Slice | Content |
| --- | --- |
| E1 | Migration 00069; domain: channels, default table by kind, effective-preference function, locked rule; `AND n.in_app` in the ten scoped inbox statements + guard test; inbox tests prove hidden rows are invisible to list / count / marks / facets. |
| E2 | Preferences store + handlers for both trees (GET catalog, PUT partial/atomic/idempotent), `notification_preference_locked` code, routes in `router.go`. |
| E3 | In-app off at creation: preference lookup in the fan-out and scheduler txs, `in_app` written; `InsertNotification` → `:execrows`; tests (hidden row, dedupe unchanged, mandatory always visible). |
| E4 | Config loader (`notifications_email.go`), eligibility (preference, address, suppression), delivery creation with coalescing upsert and link, in both creation paths; race test for the window close. |
| E5 | `Mailer` port, `log` and `smtp` adapters, Mailpit service in `docker-compose.yml`, template engine with the 17 + 2 templates (final copy, labels and fallbacks from §Templates), headers, Spanish dates in `America/Mexico_City`, deep-link path map (§Path map, T13 `null` → `/empresa`). |
| E6 | Sender loop: claim with lease, re-check/skip rules, fenced finalize, backoff, throttle; start/stop in `main.go`. |
| E7 | Unsubscribe token (sign/verify, rotation, constant-time, uniform failure), public GET/POST, per-IP limit, `unsubscribe_link_invalid`; token issued in E5 templates. |
| E8 | `cmd/notifications-purge` deletes terminal deliveries older than 180 days (after notifications, `ON DELETE SET NULL` link); follow-up note in `docs/decision-email-provider.md` (Q10). |

## Resolved questions (2026-11-26)

No open questions remain. All eleven are resolved or deferred.

| # | Question | Resolution |
| --- | --- | --- |
| Q1 | Default email for the three candidate types (S2 read literally = off). | **User**: `email` **on by default** for `candidate_status_changed`, `candidate_message_received`, `candidate_test_pending` (still switchable off); members stay off per S2 (D2). |
| Q2 | Include the vacancy title in emails? | **User**: yes, with the title; fallback «una vacante» (D14, §Templates). |
| Q3 | Frontend paths for each link kind, both preferences pages and the unsubscribe URLs. | **Frontend**: path map in §Templates (§Path map), one code table with a test; `vacancy_unassigned` with a `null` link → `/empresa`. |
| Q4 | Which public origin receives the RFC 8058 POST? | **Frontend origin**: `NOTIFICATIONS_UNSUBSCRIBE_URL` = `APP_BASE_URL` + `/api/notificaciones/baja`, a route handler that accepts only `POST` and forwards token and body to `POST /v2/notifications/unsubscribe`, with no cookies, no session and no same-origin check. The landing `/notificaciones/baja` (a different path) uses the backend `GET` and confirms with a server action (§Unsubscribe). |
| Q5 | Per-instance throttle enough? | Accepted as recommended: default 1/s per instance; global limiter only if several instances run. |
| Q6 | Skip a non-mandatory email if everything it covers was already read? | **User**: yes, skipped (D11); mandatory emails are never skipped for being read. |
| Q7 | Show the preferences page to stakeholders? | **User**: hide it in the UI until stage 3; the backend still returns the catalog (D23). |
| Q8 | Burst crossing midnight yields two emails. | Accepted (consistent with the inbox groups). |
| Q9 | Unsubscribe links valid 365 days; old keys kept 365 days after rotation. | Accepted. |
| Q10 | Update `docs/decision-email-provider.md` for the in-process delivery? | Accepted: short note in E8 (provider still SES; transport DB-backed until a queue is justified). |
| Q11 | Sender domain («Pendiente» vs «ya comprado»). | **Deferred to the SES work** (S9); not needed for dev (Mailpit accepts any sender). |

## Out of scope (v2)

- **Digest** (daily / weekly summary email) — stage 3 (S1).
- **SES adapter, domain verification, DKIM / SPF / DMARC, sandbox exit, Terraform, any AWS resource** (S9).
- **Bounce and complaint ingestion** (SES events → `email_suppressions`) and automatic suppression on permanent SMTP
  failures.
- Owner rules per event and role, stakeholder notifications (stage 3; v1 D5 seam).
- Email for manual candidates without an account (S3), SMS / push, per-vacancy mute, quiet hours.
- Showing delivery status to users, resend, or an email history screen.
