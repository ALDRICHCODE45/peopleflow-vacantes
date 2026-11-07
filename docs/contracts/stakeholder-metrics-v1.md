# Stakeholder + metrics v1 (internal, employer-only)

Status: **agreed (2026-11-07)**, not implemented; frontend review F1–F8 applied; D1–D12 approved by the user via the
frontend session (all as recommended). Product source: `docs/product/next-three-features.md`
§3 «Stakeholder + métricas». The backend session wrote this contract; frontend tracking is
`odd/tasks/stakeholder-metrics.md`, backend tracking `odd/tasks/stakeholder-metrics-backend.md`. Nothing is built until
the user approves the metric catalog (§2) and the decisions at the end. Style follows `audit-log-v1.md`.

## Purpose

Give a company a **read-only stakeholder** who looks at performance, and give the owner and that stakeholder a
**metrics view** whose every number has a written definition: formula, data source, time window and edge cases. The
recruiter view is a **ficha per recruiter** (puntualidad, volumen, conversión a placement, reasignaciones), never a
single ranking: the human compares.

The system is not in production and all data is disposable: migrations may backfill or rewrite current rows.

## Backend facts this contract builds on

- `users.user_type` is `candidate | recruiter` (`00005`); `company_members.role` is `owner | recruiter` (`00009`),
  `user_id` UNIQUE, so a user belongs to one company at most. In Go, `MemberRole` is ordered
  (`Unknown=0, Recruiter=1, Owner=2`) and `RequireCompanyRole` passes when `role >= minRole`.
- `POST /me/company/members` (owner) adds an **existing recruiter user** by `user_id`; there is no invitation and no
  email (`docs/decision-email-provider.md`). Both removal paths, plain `DELETE /me/company/members/{id}` and
  `POST …/{id}/offboard`, already write `CompanyMemberOffboarded`.
- The router never separates reads from writes: every recruiter group mixes GET and writes under one gate, and the
  stores add "owner or active team member" checks. Some SQL hard-codes `role='owner'` to mean "sees every vacancy".
- Feature 1 tramos (`00054`): `vacancy_assignments` (one continuous stay; `started_at/ended_at`, causes,
  `recruiter_deadline`, `closing_deadline`), `vacancy_assignment_functions` (`responsible | collaborator | member`
  periods), `vacancy_reassignments` (responsible handovers with reason and `state_snapshot`), `placement_credits` +
  `placement_credit_recipients` (`direct | participant | shared`), `vacancy_commitment_changes`. Pre-00054 drafts were
  backfilled with one tramo `start_cause='backfill'`, `started_at = job_drafts.created_at`.
- Lifecycle: `vacancy_processes` keeps only the **latest** `published_at` (repaired to the first publication),
  `closed_at`, `process_finished_at`; `vacancy_lifecycle_events` keeps the full history (`pause | resume | close |
  finish_process | reopen`, close `reason filled | cancelled | other`, NULL before 00035).
- Delivery: `job_draft_delivery_configs(commitment_date, target_quantity, cutoff_stage_id)`; one frozen
  `process_delivery_fulfillments` row per process (`fulfilled_at`, `result on_time | late`, `candidates jsonb`
  `[{participation_id, candidate, reached_at}]` in delivery order). A candidate is delivered at its first entry into the
  cutoff stage (or later) by intake, move or recovery; the count never goes down.
- **Known defect:** a delivery-config PUT that newly satisfies the target (lower target, other cutoff) records
  `fulfilled_at` and `result` at **save time** (`draftstore/delivery.go:172`), not when candidate N reached the cutoff.
  Recovery records the recovery time. The true moment is `candidates[target-1].reached_at`.
- Origin: `process_participations.source` is `organic | manual`. The public portal and the company careers site both
  apply through the same organic endpoint; **nothing distinguishes them**. Legacy `applications.source` belongs to v1
  `jobs` and is not used.
- Requester (client or internal area): only inside the draft's canonical JSON `fields.requester {kind, id|null}`,
  current value only, no history; catalog `job_draft_requesters(kind internal_area | client)`.
- Existing reads: `GET /v2/me/vacancy-assignments/history` («Mi rendimiento», own tramos with `deadline_result`,
  `delivered_in_tramo`, placements by kind; it reads `fulfilled_at`, so it inherits the defect) and
  `GET /v2/me/company/dashboard` (`origin_by_day` organic/manual over 90 days). Product rule: «Mi rendimiento» uses the
  same definitions as the stakeholder view (`docs/product/asignacion-de-vacantes.md`).
- Audit (`audit-log-v1.md`): catalog-validated events, one row per sensitive read in the read's transaction,
  sessions for any member, owner-only audit screen (D5: the stakeholder sees metrics, not the audit). Time zone for
  every calendar rule is `America/Mexico_City`.
- `docs/recruitment-business-rules.md` ROLE-5 / PRIV-9: the stakeholder is read-only within its own organization and
  has **no global talent search**. This contract keeps both: it sees its company's data, never other companies' or the
  global candidate search.

## 1. Stakeholder role

### 1.1 What it is

- A **company membership role** `stakeholder`, next to `owner` and `recruiter` (`company_members.role` check widened).
  The account itself stays an employer account (`user_type = recruiter`): `user_type` answers "which portal do you
  sign in to", the membership role answers "what can you do in this company" (D1).
- **Read-only, whole company.** It sees every vacancy's metrics and the personal data that appears in metric detail
  (candidate names in deliveries and placements). It never writes anything, never appears in vacancy teams, never gets
  placement credit, and is never a talent-base viewer entry (it reaches no talent-base route in v1, D3).
- One company per user, like every member. A stakeholder is not a recruiter: it cannot be added to a team, made
  responsible, or chosen as a reassignment target — team writes naming a stakeholder answer 422
  `not_company_member`, the code they already use for non-members.
- `GET /me/company/members` (owners and recruiters) lists stakeholders with `role: "stakeholder"` (F1). There is no
  backend "assignable members" endpoint: team and responsible pickers are built from that list, so the frontend
  filters `role === "stakeholder"` out, and the team writes above reject it anyway.

### 1.2 Gate (fail closed)

- `MemberRole` stops being a plain ordering for this role: `RequireCompanyRole(minRole)` **rejects `stakeholder`** for
  every existing `requireRecruiter` and `requireOwner` group (403 `forbidden`, the code those gates already return).
  No existing route changes for owners or recruiters.
- One new gate, `requireMetricsViewer`, passes `owner` and `stakeholder` only, and guards the §3 routes.
- Routes that answer a stakeholder:

| Route | Why |
|---|---|
| `GET /v2/me`, `GET /me/company` | identity and company shell; `GET /me/company` returns `role: "stakeholder"` and `can: { "view_talent_base": false, "view_metrics": true }` |
| `POST /v2/me/session/start`, `POST /v2/me/session/end` | sessions are audited for every member |
| `POST /v2/me/stakeholder-invitations/accept` | joining (§1.3) |
| `GET /v2/me/company/metrics/*` | §3 |
| public routes (vacancies, careers sites, catalogs) | already open to anyone |

- Everything else rejects it: the v2 draft/board/pipeline/team/lifecycle group (~60 routes), talent base
  (`/v2/me/company/candidates*`), company site, requesters, members list, legacy `/jobs*` and v1 drafts — all with
  403 `forbidden` from the gate, before any store lookup. Candidate routes keep rejecting it via `requireCandidate`.
- `can` today holds only `view_talent_base`; v1 adds `view_metrics` (owner and stakeholder `true`, recruiter `false`).
  The sidebar decides the stakeholder shell from `role === "stakeholder"` (Métricas, Mi cuenta, Cerrar sesión) (F8).
- Owners see metrics too. Recruiters do not see the company view; their own numbers stay in «Mi rendimiento»,
  computed with the same definitions (D2).

### 1.3 How a stakeholder joins (no email)

A **copyable invitation link** the owner creates and sends by any channel (WhatsApp, chat). It works the same in
local, dev and production, and needs no email provider (D4).

- `POST /v2/me/company/stakeholder-invitations` (owner) → 201
  `{ "id", "url_token", "expires_at", "created_at" }`. `url_token` is 32 random bytes, base64url, **shown once**;
  the database stores only its SHA-256. The frontend builds `https://<app>/empresa/invitacion/<url_token>`.
  Expiry 7 days; single use; at most 20 pending invitations per company (422 `invitation_limit_reached`).
- `GET /v2/me/company/stakeholder-invitations` (owner) → pending invitations
  `{ "items": [{ "id", "created_at", "created_by", "expires_at" }] }` (no token).
- `DELETE /v2/me/company/stakeholder-invitations/{id}` (owner) → 204; revoking an already used, expired or revoked
  invitation also answers 204 (idempotent).
- `POST /v2/me/stakeholder-invitations/accept` (any signed-in user) body `{ "token" }`:
  - 200 `{ "company_id", "member_id", "role": "stakeholder" }` and the membership exists.
  - **Replay (F2):** the same user accepting a token they already used, while that membership still exists, gets
    200 with the same body; nothing is written again and no audit row is added. A network retry is safe.
  - 404 `invitation_invalid` for unknown, expired or revoked tokens, and for a token used by **another** user or whose
    membership was removed since (one code: no oracle).
  - 403 `candidate_account` when the caller is a candidate account.
  - 409 `already_company_member` when the caller already belongs to a company through anything other than this
    invitation (any company, any role).
  - The frontend accept page posts from the server, redirects to a token-free URL and sets
    `Referrer-Policy: no-referrer`; the token may ride in the login `callbackUrl` when the invitee has no session.
  - The accept runs in one transaction with `FOR UPDATE` on the invitation, so two accepts of one token yield one
    member.
- Signing in: the invitee signs in or signs up as an **employer** (Cognito `recruiters` group in dev/prod;
  `cmd/localidentitybootstrap` in local), opens the link, and the frontend calls accept. No new Cognito group, no
  PostConfirmation change.
- Removing: the owner uses the existing `DELETE /me/company/members/{id}` (a stakeholder has no tramos, so no
  offboard). `PATCH /me/company/members/{id}` refuses to turn a stakeholder into another role or anyone into a
  stakeholder (422 `stakeholder_role_change_not_supported`): remove and re-invite (D5).
- Offboarding a recruiter cannot hand vacancies to a stakeholder: a stakeholder `to_user_id` answers 422
  `not_company_member`, like a non-member.
- Fallback for tests and local scripts: `POST /me/company/members` accepts `role: "stakeholder"` for an existing
  employer account without membership, same rules as the invitation accept.

### 1.4 Audit

New catalog events, company-scoped (category `members`, except `MetricsDetailViewed`, which is `sensitive_read` like every other `*Viewed` read):

| Event | Actor | Metadata |
|---|---|---|
| `StakeholderInvitationCreated` | owner | `invitation_id`, `expires_at` |
| `StakeholderInvitationRevoked` | owner | `invitation_id` |
| `StakeholderInvitationAccepted` | the new stakeholder | `invitation_id`, `member_user_id` |
| `CompanyMemberAdded` (existing) | owner or the new stakeholder | `member_user_id`, `role: "stakeholder"` |
| `CompanyMemberOffboarded` (existing, unchanged) | owner | written by the plain DELETE that removes a stakeholder; its assignment and reassignment id lists are empty |
| `MetricsDetailViewed` (sensitive read) | owner or stakeholder | `report` (`deliveries` \| `placements`), `vacancy_id` |

- Sessions (`SessionStarted/Ended`) already cover the stakeholder as a member.
- Aggregate metric reads (counts, rates, series) carry no personal data and write no audit row. Detail reads that
  return candidate names (§3.5) write one `MetricsDetailViewed` row in the read's transaction, fail-closed, like every
  sensitive read.
- The owner's audit screen lists stakeholders as actors with the role label «Stakeholder».

## 2. Metric catalog

### 2.0 Common rules

- **Period.** Every metric takes `from` and `to` (dates, inclusive, `America/Mexico_City`), at most 366 days. A
  timestamp belongs to the period when its local date falls in `[from, to]`.
- **Business days** use the existing business-day calendar of delivery fulfillment (Mon–Fri, same holiday set).
- **Vacancy universe.** Only vacancies that were **published at least once** (`vacancy_processes.published_at` not
  NULL). Drafts never published are not vacancies yet (D6).
- **Recruiter attribution** comes from tramos and function periods, never from the current team:
  - *assigned in the period* = has a tramo overlapping `[from, to]`;
  - the **function** that counts is the one active at the event's instant (responsible, collaborator, member);
  - former members keep their history and appear with the audit screen's former-member label.
- **Requester filter** (client or internal area) applies to every metric through the vacancy's **current** requester;
  vacancies without requester group under «Sin solicitante» (§2.7).
- **Data status** per metric: ✅ computable with current data, 🟡 computable with a stated approximation, ❌ needs new
  data (§2.10).

### 2.1 Vacantes asignadas por reclutador — ✅

- **Formula:** per recruiter, `count(distinct draft_id)` of vacancies in the universe where the recruiter has a tramo
  overlapping the period; split by the function held at any time in the period (a vacancy counts once per function it
  held: `as_responsible`, `as_collaborator`, `as_member`) plus `started_in_period` (tramo `started_at` in the period).
- **Source:** `vacancy_assignments`, `vacancy_assignment_functions`, `vacancy_processes.published_at`.
- **Edge cases:** a rejoin opens a new tramo but the vacancy counts once; mode changes and handovers do not split a
  tramo; backfilled tramos start at draft creation (disposable data, flagged `backfill` in detail).

### 2.2 Vacantes que concluyen en el tiempo configurado — ❌ (closing target) / ✅ (time to close)

- **Concluded** = a `close` lifecycle event with reason `filled` in the period. Closes with `cancelled` / `other`
  are «sin placement» (§2.4), legacy NULL reasons are «sin motivo».
- **Time to close** (✅): business days from first publication to that close. Reported as median and per vacancy.
- **"In the configured time"** (❌): no vacancy stores a target closing date — `commitment_date` is the date for
  **delivering candidates**, not for closing. Proposal: optional `target_close_date` in the management configuration
  (`job_draft_management_configs`), with changes recorded like commitment renegotiations. Then
  `on_time = close local date ≤ target_close_date in effect at close`; vacancies without the date count as
  `no_target` (D7).
- **Edge cases:** close → reopen → close: each filled close counts in its period, time to close uses the first
  publication; `finish_process` is not a close.

### 2.3 Entrega de candidatos en tiempo y forma — 🟡 (fixed by definition, see defect)

Per vacancy with a delivery configuration:

- **Target moment** = `reached_at` of the N-th delivered candidate, N = `target_quantity` in effect at fulfillment
  (`candidates[target-1].reached_at` of the frozen row). **Never `fulfilled_at`**: it can be the config save time or
  a recovery time (D8).
- **Result:**
  - `on_time` — fulfilled and the target moment's local date ≤ `commitment_date` frozen in the row;
  - `late` — fulfilled after it, with `business_days_late`;
  - `overdue` — not fulfilled and today > `commitment_date`;
  - `pending` — not fulfilled, date not reached;
  - `not_configured` — no delivery configuration.
- **How long it took:** business days from first publication to the target moment.
- **How many:** `delivered` (count never goes down) and `target`.
- **Original vs renegotiated date:** `original_commitment_date` = earliest `vacancy_commitment_changes.previous_date`,
  else the current date; `renegotiations` = count of changes. On-time is judged against the date in effect.
- **Per recruiter:**
  - *delivery result* is attributed to the responsible active at the target moment (`with_responsible` mode) or to
    every member active then (`shared`);
  - *volume* = candidates the recruiter moved into the cutoff stage during their tramo (`delivered_in_tramo`, actor =
    recruiter). Organic applies that land directly in the cutoff stage count for the vacancy but for no recruiter.
- **Period:** a vacancy enters the period by its `commitment_date`.
- **Same definition in «Mi rendimiento»:** its `deadline_result` (and its delta) moves from `fulfilled_at` to the
  target moment (D8). Field names, shapes and enum values do not change; only the computation does (F6).

### 2.4 Placement y sin placement — ✅

- **Placements** = `placement_credits` with `hired_at` in the period and `status` `active` or `did_not_hold`
  (`voided` excluded, as in «Mi rendimiento»); `did_not_hold` shown apart («no se sostuvo»).
- **Per recruiter:** by recipient kind `direct | participant | shared`.
- **Vacancy outcome** for vacancies closed in the period: `filled`, `cancelled`, `other`, `no_reason` (legacy), and
  `covered / hiring_headcount` from active credits (partial coverage visible).
- **Conversion to placement (per recruiter):** vacancies with ≥ 1 credit for the recruiter ÷ vacancies the recruiter
  was assigned to that closed in the period.
- **Edge cases:** a re-hire is a new credit; owner void/restore changes counts retroactively; credits go to tramos
  active at the hire instant, not to who clicked.

### 2.5 De dónde se postulan los candidatos — ❌ (portal vs careers site) / ✅ (organic vs manual)

- **Formula:** participations created in the period grouped by `origin_channel`.
- **New column** `process_participations.origin_channel`: `portal | careers_site | manual | unknown`.
  - The organic apply endpoint accepts optional `channel: "portal" | "careers_site"` (the frontend knows which page
    the candidate applied from); missing → `portal`; any other value → 422 `validation_error`.
  - Manual intake writes `manual`.
  - It is analytics, not security: the channel is self-reported by the client.
  - Field name `channel`, optional (F7): the careers site sends `careers_site`, `/vacantes` sends `portal`.
- **Historical rows:** organic → `unknown` («portal o sitio, sin distinguir»), manual → `manual` (D9).
- The dashboard's `origin_by_day` keeps organic/manual.

### 2.6 Vacantes cerradas por mes — ✅

- **Formula:** per local month, distinct vacancies with ≥ 1 `close` event that month, split by reason.
- **Source:** `vacancy_lifecycle_events`, never `vacancy_processes.closed_at` (only the latest close survives).
- **Edge cases:** a vacancy closed twice in one month counts once; closed in two months counts in each (D10).

### 2.7 Por cliente o departamento interno — 🟡

- **Formula:** every metric above, filtered or grouped by the vacancy's current requester `{kind, id}`.
- **Approximation:** the requester has no history, so a vacancy moved to another client counts entirely under the new
  one.
- **Storage:** proposal to copy `fields.requester` into indexed columns `job_drafts.requester_kind` /
  `requester_id` on save (backfilled from current JSON) instead of parsing JSON per query.
- **Edge cases:** `kind` with `id = null` groups as «Cliente sin especificar» / «Área sin especificar»; catalog
  duplicates by accent stay separate (no merge exists).

### 2.8 Ficha por reclutador — ✅ (built from 2.1–2.4 and 2.9)

- One card per recruiter assigned in the period:
  - vacancies assigned (2.1);
  - delivery: on-time / late / overdue counts, median business days to the target moment, `delivered_in_tramo` (2.3);
  - placements and conversion (2.4);
  - reassignments received / lost (2.9);
  - business days in tramos.
- **No composite score and no rank number.** Default order alphabetical by name; the frontend may sort by a column on
  demand (D11).

### 2.9 Analítica de reasignaciones — ✅

- **Formula:** `vacancy_reassignments` with `performed_at` in the period:
  - by reason (`workload | recruiter_departure | performance | client_request | other`);
  - per recruiter: lost (from) and received (to);
  - by who performed it;
  - median business days the outgoing tramo lasted;
  - delivery state at handover, from `state_snapshot`.
- **Edge cases:**
  - offboarding writes `recruiter_departure` rows;
  - a shared-mode `last_member` handover writes no row and is not a reassignment;
  - adding or removing collaborators is not a reassignment;
  - the note (only for `other`) appears in detail, never in aggregates.

### 2.10 Data changes this catalog needs

| Change | For | Historical rows |
|---|---|---|
| `process_participations.origin_channel` + `channel` on the apply body | 2.5 | organic → `unknown`, manual → `manual` |
| `job_drafts.requester_kind / requester_id` columns | 2.7 speed | backfilled from current JSON |
| `target_close_date` in management config (+ change log) | 2.2 on-time | none: `no_target` |
| metric reads use the N-th `reached_at`, «Mi rendimiento» too | 2.3 | computed from the frozen JSONB, no rewrite |
| `company_members.role` widened, `stakeholder_invitations` table | §1 | none |

## 3. Read API

Prefix `GET /v2/me/company/metrics`, gate `requireMetricsViewer` (owner, stakeholder).

### 3.0 Common query parameters

| Parameter | Meaning |
|---|---|
| `from`, `to` | required, `YYYY-MM-DD`, inclusive, `to - from ≤ 366 days` |
| `recruiter_id` | optional user id |
| `requester_kind` | optional, `client` \| `internal_area` |
| `requester_id` | optional; needs `requester_kind`; the literal `none` means «sin solicitante» |

Bad filters answer 422 `invalid_filter` with `fields[]`, the shape the talent-base and audit filters already use.
Every response carries `"definitions_version": "v1"` and the echoed `period`.

Shape rules (F3–F5):

- **Counts** are integers, `0` when empty, never `null`.
- **Medians and rates** are `null` when there is no sample or the denominator is 0, and every rate travels with its
  numerator and denominator, for example
  `"conversion": { "value": 0.4, "numerator": 2, "denominator": 5 }`. The numerator is vacancies with placement
  for the recruiter, the denominator is `closed_assigned`.
- **Monthly series** (`closed_by_month`, the card's `by_month`) are dense: one entry per month touched by the period,
  zeros included, in ascending order.
- **People** are `{ "user_id", "name", "former_member" }` wherever a person appears: reassignment from / to /
  performed_by, the vacancy's current responsible, the delivering recruiter, credit recipients.
- **Requester** is `{ "kind", "id", "name" }` (`id` and `name` null for «sin especificar»; the whole object null for
  «sin solicitante»).

### 3.1 Company view — `GET /v2/me/company/metrics/summary`

```json
{
  "definitions_version": "v1",
  "period": { "from": "2026-08-01", "to": "2026-10-31", "time_zone": "America/Mexico_City" },
  "vacancies": { "assigned": 42, "closed": { "filled": 18, "cancelled": 4, "other": 1, "no_reason": 0 },
                 "median_business_days_to_close": 23,
                 "closing_target": { "on_time": 0, "late": 0, "no_target": 18 } },
  "delivery": { "on_time": 20, "late": 7, "overdue": 3, "pending": 9, "not_configured": 3,
                "median_business_days_to_target": 11, "delivered": 214 },
  "placements": { "credits": 25, "did_not_hold": 2, "positions_covered": 23, "positions_required": 31 },
  "origin": { "portal": 120, "careers_site": 34, "manual": 61, "unknown": 300 },
  "closed_by_month": [ { "month": "2026-08", "filled": 5, "cancelled": 1, "other": 0, "no_reason": 0 } ],
  "reassignments": { "total": 6, "by_reason": { "workload": 2, "recruiter_departure": 3, "performance": 0,
                     "client_request": 1, "other": 0 } },
  "by_requester": [ { "kind": "client", "id": "…", "name": "Acme", "vacancies": 9, "filled": 4 } ]
}
```

### 3.2 Recruiter cards — `GET /v2/me/company/metrics/recruiters`

`{ "items": [ { "user_id", "name", "former_member": false, "vacancies": { "assigned", "as_responsible",
"as_collaborator", "as_member", "started_in_period" }, "delivery": { "on_time", "late", "overdue",
"median_business_days_to_target", "delivered_in_tramo" }, "placements": { "direct", "participant", "shared",
"did_not_hold", "closed_assigned", "conversion": { "value", "numerator", "denominator" } }, "reassignments":
{ "received", "lost" }, "business_days_in_tramos" } ],
"next_cursor": null }` — alphabetical, `limit` default 50, max 100, opaque `cursor`.

### 3.3 One recruiter — `GET /v2/me/company/metrics/recruiters/{userId}`

The same card plus `by_month` series for vacancies assigned, deliveries and placements. 404 `not_found` when the user
never had a tramo in this company.

### 3.4 Detail lists (paginated)

- `GET …/metrics/vacancies` — one row per vacancy in the period:
  - fields: `draft_id`, `title`, `requester`, current responsible, `first_published_at`, `closes[]` (date, reason),
    `delivery` (result, target, delivered, `target_reached_at`, `commitment_date`, `original_commitment_date`,
    `renegotiations`), `placements` (covered / required), `reassignments`;
  - extra filters: `outcome` (`filled | cancelled | other | open`), `delivery_result`.
- `GET …/metrics/reassignments` — `performed_at`, vacancy, from, to, reason, note (only `other`), performed_by,
  outgoing tramo business days, snapshot summary.
- Pagination: `limit` default 50, max 100; opaque `cursor` over `(sort key, id)`; `next_cursor` null at the end.
  Order: vacancies by `first_published_at` desc, reassignments by `performed_at` desc.
- These lists carry no candidate personal data.

### 3.5 Personal-data detail (audited)

- `GET …/metrics/vacancies/{draftId}/deliveries` — delivered candidates in order: `candidate` label,
  `reached_at`, delivering recruiter.
- `GET …/metrics/vacancies/{draftId}/placements` — credits with candidate label, `hired_at`, recipients, status.
- Each successful read writes one `MetricsDetailViewed` row (§1.4).

### 3.6 Computed on request, not precomputed

**Recommendation: compute each request with SQL over the domain tables**, no metrics tables in v1:

- Volumes are company-scale (tens to hundreds of vacancies per year).
- The definitions will move after the first review; a precomputed table would need a rebuild for every wording change.
- Every metric reads frozen or append-only data (lifecycle events, tramos, credits, fulfillment rows), so on-request
  results are stable.
- Indexes added with the slices: `(draft_id, started_at)` on tramos, `(action, created_at)` on lifecycle events,
  `(created_at)` + `origin_channel` on participations, requester columns.
- Revisit with a materialized table refreshed nightly only if `summary` p95 > 500 ms on realistic data.

## 4. Slices (after approval)

1. **3a Role and invitations:** migration (role, invitations), gates, invitation endpoints, `GET /me/company` flags,
   audit events. Frontend: invitation screen for the owner, accept page, stakeholder shell.
2. **3b Data capture:** `origin_channel` + apply `channel`, requester columns, `target_close_date` (if D7),
   «Mi rendimiento» moves to the N-th `reached_at` (D8).
3. **3c Metrics read API:** §3 endpoints with integration tests per metric definition and edge case.

## Decisions (approved 2026-11-07, all as recommended)

1. **D1 Where the role lives.** Recommendation: a membership role `stakeholder` on a normal employer account, not a
   third `user_type`. A new user type would need a Cognito group, PostConfirmation and bootstrap changes, and a
   removed stakeholder would keep an account that can do nothing anywhere.
2. **D2 Who sees the company metrics.** Recommendation: owner and stakeholder; recruiters keep only their own numbers
   in «Mi rendimiento», with the same definitions.
3. **D3 What the stakeholder sees in v1.** Recommendation: metrics only, with candidate names in the audited detail
   (§3.5). Read-only boards and candidate profiles (CV, contacts) for the stakeholder would be a later slice: they
   need a read-only pass over ~60 mixed routes.
4. **D4 How a stakeholder joins.** Recommendation: copyable single-use link, 7 days, created and revoked by the owner;
   email invitation later when SES has a domain.
5. **D5 Role changes.** Recommendation: no conversion between stakeholder and recruiter/owner; remove and re-invite.
6. **D6 Vacancy universe.** Recommendation: only vacancies published at least once count anywhere.
7. **D7 «Concluir en el tiempo configurado».** There is no closing target today. Recommendation: add an optional
   `target_close_date` to the management configuration; until it is set, report time to close and `no_target`.
   Alternative: judge closing against `commitment_date` (mixes delivery with closing; not recommended).
8. **D8 Delivery moment.** Recommendation: judge on time by the date the N-th candidate reached the cutoff, never by
   the config save time, and change «Mi rendimiento» to the same rule.
9. **D9 Historical origin.** Recommendation: label existing organic applications `unknown` («portal o sitio, sin
   distinguir») instead of guessing `portal`.
10. **D10 Closed per month.** Recommendation: distinct vacancies per month (one vacancy closed twice in one month
    counts once).
11. **D11 Recruiter cards.** Recommendation: no score and no rank; alphabetical by default, sortable by a column on
    demand.
12. **D12 Delivery period.** Recommendation: a vacancy enters a period's delivery metrics by its `commitment_date`
    (the promise falls due in the period).
