# Audit log v1 (internal, employer-only)

Status: **agreed (2026-11-04)**, not implemented; frontend review F1–F6 applied; D1–D7 approved by the user via the
frontend session (all as recommended). Product source:
`docs/product/next-three-features.md` §2 «Auditoría». The backend session wrote this contract; frontend tracking is
`odd/tasks/audit-log.md`, backend tracking `odd/tasks/audit-log-backend.md`. Style follows `vacancy-team-v1.md` and
`talent-base-visibility-v1.md`.

## Purpose

Answer, for a company: **who did what, when, from where, and what happened after** — including sensitive reads (a
candidate's detail, a CV download, revealed contacts), sign-ins and clicked sign-outs, and member and role changes.
The record is append-only in the database, carries IDs instead of personal data, has a defined retention, and the
owner reads it on an audit screen with filters and an audited export.

The system is not in production and all data is disposable: migrations may rewrite or drop current audit rows.

## Backend facts this contract builds on

- One table, `audit_events` (`db/migrations/00011_create_audit_events.sql`): `id`, `occurred_at` (DB `now()`),
  `actor_id` (nullable, no FK), `actor_type` (`user` | `system`), `event_type` (free text), `entity_type`,
  `entity_id`, `metadata jsonb`. One index: `(entity_type, entity_id, occurred_at DESC)`.
- **No `company_id` column.** Some emitters put `company_id` inside `metadata`, many do not (psychometric events,
  `ParticipationMoved`, `CompanyCandidateEdited`, …).
- Appends go through `Append(ctx, tx, event)` on the **caller's transaction**: the write and its audit row commit or
  roll back together (fail-closed). Two emitters write raw SQL on the same tx (`pool/corrections.go`, `pool/cv.go`).
- About 40 event types exist; most are string literals, not constants. There is **no read API** for audit events.
- Append-only is a convention: no trigger, no grant. The API connects as the database owner (`admin`), the same role
  that runs migrations. Integration tests `DELETE FROM audit_events` freely.
- The only audited read today is `PsychometricResultViewed`: one row per successful read, in the read's transaction,
  metadata `{vacancy_id, participation_id}`.
- Sensitive reads with no audit today: pool detail `GET /v2/me/company/candidates/{kind}/{id}`, pool CV
  `GET …/participations/{participationId}/cv` and `…/cv/original`, contacts `POST /v2/me/company/candidates/contacts`
  (JSON, at most 100 candidates; there is **no CSV export** anywhere), board detail
  `GET /v2/me/company/job-drafts/{id}/participations/{pid}` and board CV `…/{pid}/cv`, `…/{pid}/cv/original`. CVs
  are streamed bytes (`Content-Disposition: attachment`), not presigned URLs.
- Auth is a Bearer Cognito JWT verified per request (`RequireAuth`); there is **no login or logout endpoint**. Claims
  carry only `sub` and groups.
- Members: `POST /me/company/members` (add), `PATCH /me/company/members/{id}` (role), `DELETE
  /me/company/members/{id}` and `POST …/{id}/offboard` (remove; `{id}` is the `company_members.id`). Only the offboard
  path audits (`CompanyMemberOffboarded`). Roles are `owner` | `recruiter`.
- Client IP: no `RealIP` middleware, no code reads `User-Agent`. The only IP logic is the public assessment rate
  limiter (`runtime/ratelimit/assessment.go`), which honours `X-Forwarded-For` only from `TRUSTED_PROXY_CIDRS`. There
  is no shared secret between the Next BFF and the API.
- List conventions: opaque versioned cursor bound to company + filter hash, `limit` 1–50, strict query parser
  (unknown/duplicate/invalid params rejected, values never echoed), response `{items, total, next_cursor}`. Error
  envelope `{error, code}` with optional `fields: [{field, code}]`.

## 1. Event record (schema change)

Migration `00056_audit_log.sql` adds to `audit_events`:

| Column | Type | Rule |
| --- | --- | --- |
| `company_id` | `uuid NULL` | The company the event belongs to. Null **only** for events with no company (candidate-side account events, a candidate's own session). Every employer-side emitter sets it. |
| `vacancy_id` | `uuid NULL` | The vacancy (job draft) the event concerns, when there is one. Feeds the vacancy filter. |
| `ip` | `inet NULL` | Client IP from the request context (§4). Null for system events and when unknown. |
| `user_agent` | `text NULL` | Client `User-Agent`, truncated to 512 bytes. Null when absent. |
| `ip_source` | `text NULL` | `bff` (trusted forwarded header) or `peer` (TCP peer / trusted proxy chain). CHECK on these two values. |

- Indexes: `(company_id, occurred_at DESC, id DESC)`, `(company_id, actor_id, occurred_at DESC)`,
  `(company_id, vacancy_id, occurred_at DESC)`, `(company_id, event_type, occurred_at DESC)`.
- Backfill: existing rows get `company_id`/`vacancy_id` from `metadata` when present, otherwise stay null (dev data,
  disposable). They will not appear on the screen if null — accepted.
- Go: `AuditEvent` gains `CompanyID *uuid.UUID` and `VacancyID *uuid.UUID`. **Every** emitter (including the two raw
  SQL ones and every string-literal type) sets them; event types become constants in one catalog file (§8.2). `ip`,
  `user_agent` and `ip_source` are **not** passed by emitters: the adapter reads them from the request context set by
  middleware, so emitter signatures do not change.
- A test enumerates the event catalog and fails when an employer-side type is appended with a null `company_id`.

## 2. Sensitive reads

**Rule: one row per successful read, no deduplication window** (D1). Same pattern as `PsychometricResultViewed`:
the audit row is written in the read's transaction and the read fails with 500 `internal_error` if the audit insert
fails (fail-closed). The backend has no `304` path (it ignores `If-None-Match`), so every successful read is a `200`
and one row, revalidation included. Rejected requests (400, 401, 403, 404) write nothing.

| Route | Event type | Entity | Metadata (IDs only) |
| --- | --- | --- | --- |
| `GET /v2/me/company/candidates/{kind}/{id}` | `CompanyCandidateViewed` | `company_candidate` / `{id}` | `{kind}` |
| `GET /v2/me/company/candidates/{kind}/{id}/participations/{participationId}/cv` | `CompanyCandidateCVDownloaded` | `company_candidate` / `{id}` | `{kind, participation_id, variant: "current"}` |
| `… /cv/original` | `CompanyCandidateCVDownloaded` | same | `{kind, participation_id, variant: "original"}` |
| `POST /v2/me/company/candidates/contacts` | `CompanyCandidateContactsRevealed` | `company` / company id | `{count, candidates: [{kind, id}]}` (≤ 100, sorted) |
| `GET /v2/me/company/job-drafts/{id}/participations/{pid}` | `ParticipationViewed` | `process_participation` / `{pid}` | `{}` (`vacancy_id` column = `{id}`) |
| `GET /v2/me/company/job-drafts/{id}/participations/{pid}/cv` | `ParticipationCVDownloaded` | `process_participation` / `{pid}` | `{variant: "current"}` |
| `… /{pid}/cv/original` | `ParticipationCVDownloaded` | same | `{variant: "original"}` |

- The CV row is committed **before** the first byte is streamed. A download interrupted mid-stream stays recorded as
  «descargó» (honest wording on the screen: «inició la descarga»).
- Contacts: the record is that the user **revealed** the email/phone of these candidates; the values themselves are
  never stored. The row lists only the candidates actually returned; unknown ids reveal nothing, and a request that
  reveals nobody writes no row. Validation errors stay as today (400 `validation_error`).
- Pool CV rows also set the `vacancy_id` column to the participation's vacancy (as `CompanyCandidateCVCorrected`).
- Frontend impact: detail queries should not refetch on window focus (each refetch is one row). Recommended
  `staleTime` ≥ 5 min and `refetchOnWindowFocus: false` on these queries.

## 3. Sessions

Two new endpoints the BFF calls; both `requireAuth`, `NoStore`, answer `204 No Content`. The body is not read (send
none; any body is ignored), the same convention as psychometric revoke and site unpublish. An audit failure answers
500; the frontend logs it and continues.

| Endpoint | When the BFF calls it | Event |
| --- | --- | --- |
| `POST /v2/me/session/start` | Once per sign-in, server side, in the NextAuth `jwt` callback when it carries `account` (sign-in only, never on refresh), with the fresh access token and a short timeout. | `SessionStarted` |
| `POST /v2/me/session/end` | When the user clicks any «Cerrar sesión» button: a server-side frontend action calls it **before the frontend calls NextAuth `signOut()`** (which drops the token), with a short timeout; errors are ignored. | `SessionEnded` |

- Entity `user` / the caller's user id; `company_id` = their membership company. **Only users with a company
  membership are recorded**; for a candidate (no membership) both endpoints answer 204 and write nothing (data
  minimisation).
- Metadata `{}`; the IP and browser come from §4.
- Honest limits, stated as such on the screen: a session that ends by **token expiry or closing the tab** has no
  `SessionEnded`; «Cerró sesión» means «hizo clic en cerrar sesión». A failed call to `/session/end` must not block the
  sign-out (the frontend logs it and continues); a failed `/session/start` does not block the sign-in either. The
  candidate area calls both too; the API answers 204 and records nothing for them (D6).
- A caller with a valid token can always call `/session/start`; the row truthfully says «this user's token was used
  to start a session from this IP».
- Unknown user (no `users` row yet) → 204, nothing recorded.

## 4. IP and browser (trusted only from the BFF)

The browser never talks to the API directly for employer screens; the Next server does. There is no single BFF
module: about 52 server-side call sites build their own Bearer request, so the frontend adds one server-only helper for
these headers and a test that every API call uses it. The Next server forwards the real client data and **proves it is
the frontend server** with a shared secret:

| Header (BFF → API) | Value |
| --- | --- |
| `X-PF-Proxy-Secret` | Shared secret, env `AUDIT_PROXY_SECRET` on both sides (≥ 32 random bytes). |
| `X-PF-Client-IP` | The client IP as the BFF sees it (its hosting's first trusted `X-Forwarded-For` hop, or the socket peer). |
| `X-PF-Client-User-Agent` | The browser's `User-Agent`. |

- A middleware (all routes, before auth) compares `X-PF-Proxy-Secret` in constant time. **Match** → `ip` /
  `user_agent` from the `X-PF-Client-*` headers, `ip_source = bff` (invalid IP → null). **No match or absent** → the
  `X-PF-Client-*` headers are **ignored**, `ip` = the existing trusted-proxy logic (`TRUSTED_PROXY_CIDRS` +
  `X-Forwarded-For`, else the TCP peer), `user_agent` = the request's own `User-Agent`, `ip_source = peer`. A client
  that sends the headers without the secret cannot fake its IP.
- The secret never appears in logs, errors or audit rows. When `AUDIT_PROXY_SECRET` is unset the API runs with
  `peer` only (local dev).
- The IP-resolution helper moves out of the rate limiter into a shared package so both use one rule.
- A call that escapes the helper arrives as `ip_source = peer` with the Next server's IP, not the user's. The screen
  shows `ip_source = peer` rows as «IP no verificada»; that is the intended meaning of `peer`.

## 5. Members and roles

| Route | Event | Entity | Metadata |
| --- | --- | --- | --- |
| `POST /me/company/members` | `CompanyMemberAdded` | `company_member` / membership id | `{member_user_id, role}` |
| `PATCH /me/company/members/{id}` | `CompanyMemberRoleChanged` | `company_member` / `{id}` | `{member_user_id, from_role, to_role}`; no row when the role does not change |
| `DELETE /me/company/members/{id}` / `POST …/offboard` | `CompanyMemberOffboarded` (exists; before 2a only the offboard path emitted it, `DELETE` wrote nothing) | `company_member` / `{id}` | existing metadata + `member_user_id` |

- Written in the same transaction as the change (the member repository gains the audit port). Owner transfer, when it
  exists, is a role change pair.
- Removing a member keeps their past events and their name on the screen (§8.3).

## 6. Immutability

- Migration `00056` adds a trigger `audit_events_append_only` (`BEFORE UPDATE OR DELETE`, plus a statement-level
  `BEFORE TRUNCATE`) that raises `audit_events is append-only`.
- **One exception, for retention (§7):** `DELETE` is allowed only for rows with `occurred_at < now() - retention`
  **and** only inside a transaction where the purge job set `SET LOCAL peopleflow.audit_purge = 'on'`. `UPDATE` has no
  exception.
- Honest limit: the API connects as the database owner, who can `ALTER TABLE … DISABLE TRIGGER`. The trigger stops
  every application path and every mistake, not a malicious DBA. The real fix is a **least-privilege app role**
  (`INSERT`/`SELECT` only on `audit_events`, migrations run by a separate owner role); proposed for the AWS deployment
  work, outside v1 (D4).
- Test cost: integration tests that `DELETE FROM audit_events` switch to a test helper that sets the purge flag and
  drops the trigger guard only in the disposable test schema (or recreates the schema).
- **Hash chain: deferred** (D3). A chain serialises every insert per company (a hot lock on the busiest table) and only
  proves something when the chain head is anchored outside the database; without the least-privilege role first it
  adds cost and little proof.

## 7. Personal data (LFPDPPP) and retention

- `metadata` holds **IDs, enums and counts only**: no names, emails, phones, CV file names, free text, salaries or
  notes. Existing emitters are reviewed against this rule in 2a; the event catalog pins the allowed metadata keys per
  event type and `Append` refuses any other key (the transaction fails closed).
- **Exception: company configuration.** The `previous`/`new` snapshots of configuration documents (pipeline stages,
  substates, checklist, psychometric profile) keep their recruiter-authored labels: they describe the company's
  process, not a person, and they answer «what changed». Anything about a person stays out.
- 2a review result: `VacancyDeliveryFulfilled` no longer embeds candidates' `full_name` (its `snapshot.candidates` is
  `[{participation_id, candidate_id, reached_at}]`); `ParticipationChecklistMarked` stores `{verdict, has_note}`
  instead of the note text. Rows written before 2a are dev data and are not rewritten.
- `ip` and `user_agent` are personal data, kept for the security purpose the product asked for, under the same
  retention.
- Names and emails are **resolved at read time** from `users` (§8.3), never copied into the row; deleting or
  anonymising a user later also anonymises how the audit screen shows them.
- **Proposed retention (D2): 24 months.** A daily purge job deletes rows older than 24 months (the §6 exception). The
  privacy notice should mention the audit and its retention. This is a product/legal decision; the LFPDPPP sets no fixed
  number (it requires keeping data only as long as the purpose needs), so the user should validate it with counsel.
- Deleting a company: its audit rows stay until retention expires (no FK); no one can read them through the API.

## 8. Read API (audit screen)

All under `requireAuth` + `requireOwner` (D5). A recruiter gets 403 `forbidden`; a candidate 403 as today.

### 8.1 List — `GET /v2/me/company/audit-events`

| Param | Rule |
| --- | --- |
| `actor_id` | uuid, optional, single. |
| `event_type` | optional, repeatable (OR), each must be in the catalog (§8.2). |
| `category` | optional, single, one of the catalog categories. Combined with `event_type` by AND. |
| `vacancy_id` | uuid, optional. |
| `from`, `to` | optional `YYYY-MM-DD`, inclusive whole days in `America/Mexico_City`; `from ≤ to`. |
| `limit` | 1–100, default 50. |
| `cursor` | opaque, bound to company + filter hash (same scheme as the pool list). |

Order `occurred_at DESC, id DESC`. Strict parser like the pool list: unknown/duplicate/invalid param → 422
`invalid_filter` with `fields: [{field, code}]` (`invalid`, `unknown`, `duplicate`, `range`), values never echoed; bad
or foreign cursor → 400 `invalid_cursor`. Only rows with `company_id` = the caller's company.

```json
{
  "items": [
    {
      "id": "…",
      "occurred_at": "2026-11-04T17:03:12.441Z",
      "event_type": "CompanyCandidateCVDownloaded",
      "category": "sensitive_read",
      "actor": { "type": "user", "user_id": "…", "name": "Ana López", "email": "ana@…", "is_current_member": true },
      "entity": { "type": "company_candidate", "id": "…", "label": "María Pérez" },
      "vacancy": { "id": "…", "title": "Ejecutivo de ventas" },
      "metadata": { "kind": "organic", "participation_id": "…", "variant": "original" },
      "ip": "201.141.12.7",
      "ip_source": "bff",
      "user_agent": "Mozilla/5.0 …"
    }
  ],
  "total": 1342,
  "next_cursor": "…"
}
```

- `actor` is `{ "type": "system" }` for system events. `name`/`email` come from `users` at read time; a deleted user
  shows `name: null, email: null` (frontend: «Usuario eliminado»).
- `vacancy` is null when the event has none; `title` is read live (a deleted vacancy → `title: null`).
- `entity.label` is resolved at read time, never stored (§7): the candidate's visible name for `company_candidate` and
  `process_participation` (the participation's candidate), the member's name via `member_user_id` for
  `company_member`, the vacancy title for `job_draft`/`vacancy`/`vacancy_process`, the company name for `company`;
  `null` when the entity no longer exists or the type has no label. One shape for every type, no separate `candidate`
  object.
- `total` is the exact count for the filters (bounded by the indexes; revisit if it gets slow).
- Viewing the list is **not** audited (it would audit itself on every page); exporting is.

### 8.2 Catalog — `GET /v2/me/company/audit-events/types`

`{ "items": [{ "event_type": "CompanyCandidateCVDownloaded", "category": "sensitive_read" }, …] }`, closed and
ordered. Categories: `session`, `sensitive_read`, `candidate`, `vacancy`, `pipeline`, `team`, `company`,
`members`, `audit`. **Labels are frontend copy** (es-MX lives in the frontend, as everywhere else); this contract's
annex lists the proposed label per type so both sides start from the same table. A type added later appears here first;
the frontend shows an unknown type with a generic label instead of failing.

### 8.3 Actors — `GET /v2/me/company/audit-events/actors`

Distinct users that appear as actors in this company's events, **including former members**:
`{ "items": [{ "user_id", "name", "email", "is_current_member" }] }`, ordered by name. Feeds the «Persona» filter
(the members list only has current members).

### 8.4 Vacancies — `GET /v2/me/company/audit-events/vacancies`

Distinct vacancies that appear in this company's events (`vacancy_id` column), **including closed and deleted
ones**: `{ "items": [{ "vacancy_id", "title" }] }`, `title: null` when deleted, ordered by title (nulls last). Feeds
the «Vacante» filter.

### 8.5 Export — `POST /v2/me/company/audit-events/export`

- Owner only. Body: the same filters as the list as JSON (`{actor_id, event_types, category, vacancy_id, from, to}`);
  `from` and `to` are **required** and span at most 366 days.
- Response `200 text/csv; charset=utf-8` with a UTF-8 BOM (Excel es-MX), `Content-Disposition: attachment;
  filename="auditoria-YYYY-MM-DD.csv"`, `no-store`. Columns: `occurred_at` (ISO, UTC), `occurred_at_mx` (local),
  `event_type`, `category`, `actor_user_id`, `actor_name`, `actor_email`, `entity_type`, `entity_id`, `entity_label`,
  `vacancy_id`,
  `vacancy_title`, `ip`, `user_agent`, `metadata` (JSON). Values starting with `= + - @` are prefixed with `'` (CSV
  injection).
- Validation: `from`/`to` missing → 422 `invalid_filter` with `fields: [{field: "from", code: "required"}]` (and/or
  `to`); malformed date → `invalid`; `from > to` or a span over 366 days → `range` on `to`. The span counts **both
  ends inclusive**: at most 366 calendar days from `from` to `to` (1 Jan–31 Dec of a leap year passes). `required` is
  also a valid field code for the list parser's catalog, used only by the export.
- Limit **50,000 rows**. Above it → 422 `audit_export_too_large` with `row_count` and `limit` **at the top level of the
  envelope** — `{"error": "…", "code": "audit_export_too_large", "row_count": 61234, "limit": 50000}` — and nothing
  is exported (no truncated files).
- Response shapes are closed: the frontend decoders are strict, so any new field in the list, catalogs or export
  responses is a contract change announced to the frontend first. The count runs **before the first byte**, in the same `REPEATABLE READ` transaction as the rows, so
  every error (422, 403, validation) is a normal JSON error response and the streamed file matches the count. Once
  streaming starts the status is 200; a later failure aborts the connection (the frontend route handler shows a
  generic error).
- Audited: `AuditLogExported`, entity `company`, metadata `{filters, row_count}` (filters are IDs/enums/dates only),
  committed **before** streaming starts.

## 9. Slices

| Slice | Content | Frontend |
| --- | --- | --- |
| **2a — capture** | Migration 00056 (columns, indexes, backfill, append-only trigger), request-context middleware + proxy secret, `company_id`/`vacancy_id` on every emitter + catalog constants + metadata key test, sensitive reads (§2), session endpoints (§3), member events (§5). | BFF headers (§4) and the two session calls (§3). |
| **2b — screen** | List, catalog, actors, vacancies, export (§8), retention purge job (§7). | Audit screen + export. |

2a is the high-risk slice (append-only trigger, a shared secret, every emitter); it goes in its own commits (schema +
trigger; request context; emitters; new events) so each can be reviewed alone. 2a is useful alone: history starts
accumulating the day it merges, which is the point of doing it early («lo no registrado no se reconstruye»).

## Annex — proposed labels (frontend copy, es-MX)

| Event type | Category | Label |
| --- | --- | --- |
| `SessionStarted` | session | Inició sesión |
| `SessionEnded` | session | Cerró sesión |
| `CompanyCandidateViewed` | sensitive_read | Vio el detalle de un candidato |
| `CompanyCandidateCVDownloaded` | sensitive_read | Inició la descarga de un CV |
| `CompanyCandidateContactsRevealed` | sensitive_read | Consultó datos de contacto |
| `ParticipationViewed` | sensitive_read | Vio un candidato de la vacante |
| `ParticipationCVDownloaded` | sensitive_read | Inició la descarga de un CV de la vacante |
| `PsychometricResultViewed` | sensitive_read | Vio un resultado psicométrico |
| `CandidateAccountCreated` | candidate | Creó su cuenta de candidato |
| `CompanyCandidateEdited` | candidate | Editó los datos de un candidato |
| `CompanyCandidateCVCorrected` | candidate | Corrigió el CV de un candidato |
| `VacancyCandidateAddedManually` | candidate | Agregó un candidato a una vacante |
| `VacancyApplicationSubmitted` | candidate | Se postuló a una vacante |
| `ApplicationSubmitted` | candidate | Envió una postulación |
| `ApplicationTransitioned` | candidate | Cambió el estado de una postulación |
| `PsychometricInvitationCreated` | candidate | Creó una invitación psicométrica |
| `PsychometricInvitationRevoked` | candidate | Revocó una invitación psicométrica |
| `PsychometricReminderRecorded` | candidate | Registró un recordatorio psicométrico |
| `PsychometricLinkIssued` | candidate | Generó un enlace psicométrico |
| `PsychometricConsentGiven` | candidate | Aceptó el consentimiento psicométrico |
| `PsychometricAssessmentFinished` | candidate | Terminó una evaluación psicométrica |
| `PsychometricComparisonCreated` | candidate | Generó una comparación psicométrica |
| `JobDraftCreated` | vacancy | Creó una vacante |
| `JobDraftSaved` | vacancy | Guardó cambios en una vacante |
| `JobDraftRequesterCreated` | vacancy | Agregó un solicitante al catálogo |
| `JobDraftManagementConfigured` | vacancy | Configuró la gestión de una vacante |
| `JobDraftDeliveryConfigured` | vacancy | Configuró la entrega de una vacante |
| `JobDraftChecklistConfigured` | vacancy | Configuró los criterios de revisión de una vacante |
| `JobDraftPsychometricProfileConfigured` | vacancy | Configuró el perfil psicométrico de una vacante |
| `VacancyPublished` | vacancy | Publicó una vacante |
| `VacancyPaused` | vacancy | Pausó una vacante |
| `VacancyResumed` | vacancy | Reanudó una vacante |
| `VacancyClosed` | vacancy | Cerró una vacante |
| `VacancyProcessFinished` | vacancy | Terminó el proceso de una vacante |
| `VacancyReopened` | vacancy | Reabrió una vacante |
| `VacancyCommitmentRenegotiated` | vacancy | Renegoció la fecha de compromiso de una vacante |
| `VacancyDeliveryFulfilled` | vacancy | Cumplió la entrega de una vacante |
| `VacancyPlacementCredited` | vacancy | Acreditó una colocación |
| `VacancyPlacementCreditChanged` | vacancy | Cambió el estado de un crédito de colocación |
| `JobDraftPipelineConfigured` | pipeline | Configuró las etapas de una vacante |
| `JobDraftSubstatesConfigured` | pipeline | Configuró los subestados de una vacante |
| `ParticipationMoved` | pipeline | Movió a un candidato de etapa |
| `ParticipationDiscarded` | pipeline | Descartó a un candidato |
| `ParticipationRecovered` | pipeline | Recuperó a un candidato descartado |
| `ParticipationSubstateChanged` | pipeline | Cambió el subestado de un candidato |
| `ParticipationChecklistMarked` | pipeline | Marcó un criterio de revisión |
| `VacancyTeamCreated` | team | Creó el equipo de una vacante |
| `VacancyTeamModeChanged` | team | Cambió el modo del equipo de una vacante |
| `VacancyTeamMemberAdded` | team | Agregó a una persona al equipo de una vacante |
| `VacancyTeamMemberRemoved` | team | Quitó a una persona del equipo de una vacante |
| `VacancyTeamMemberLeft` | team | Salió del equipo de una vacante |
| `VacancyResponsibleReassigned` | team | Reasignó al responsable de una vacante |
| `VacancyAssignmentDeadlineChanged` | team | Cambió la fecha límite de una persona del equipo |
| `VacancyAssignmentEndedByMembership` | team | Terminó una asignación por la baja de un miembro |
| `CompanyUpdated` | company | Actualizó los datos de la empresa |
| `CompanyDeleted` | company | Eliminó la empresa |
| `CompanySitePublished` | company | Publicó el sitio de la empresa |
| `CompanySiteUnpublished` | company | Despublicó el sitio de la empresa |
| `TalentBaseVisibilityChanged` | company | Cambió quién ve la Base de talento |
| `CompanyMemberAdded` | members | Agregó a un miembro |
| `CompanyMemberRoleChanged` | members | Cambió el rol de un miembro |
| `CompanyMemberOffboarded` | members | Dio de baja a un miembro |
| `AuditLogExported` | audit | Exportó la auditoría |

The annex lists every catalog type (63) in catalog order; a test fails when a catalog type has no row.

## Decisions (approved 2026-11-04)

User, verbatim via the frontend: D2 «24 meses (Recomendado)»; D5 «Solo el owner (Recomendado)»; D1, D3, D4, D6 and D7
«Sí, todas como recomiendan (Recomendado)».

| # | Decision | Approved |
| --- | --- | --- |
| D1 | Sensitive reads: one row per read, or deduplicate (e.g. one per person + candidate per 15 min)? | **One per read.** Simple, exact («cuándo»), same as the psychometric result. The screen can group repeats visually. |
| D2 | Retention of audit events (and their IP/browser). | **24 months**, then automatic deletion; validate with counsel. Alternatives: 12 or 36 months. |
| D3 | Hash chain now or later? | **Later**, after the least-privilege DB role (D4); without it the chain proves little and costs a hot lock. |
| D4 | Least-privilege DB role for the API (the only way the owner of the database cannot rewrite the log). | **Do it with the AWS deployment work**, not in v1; v1 ships the trigger. |
| D5 | Who sees the audit screen? | **Owner only** in v1. The stakeholder (feature 3) sees metrics, not the audit. Option for later: each recruiter sees only their own activity. |
| D6 | Record candidates' own sign-ins? | **No** (data minimisation): only users with a company membership. |
| D7 | Export limit and format. | **CSV, max 50,000 rows, max 366-day range**, refuse (not truncate) above the limit. |
