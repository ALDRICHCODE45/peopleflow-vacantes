# Talent base visibility v1 (internal, employer-only)

Status: **agreed (2026-11-04)**, not implemented; D1–D3 approved by the user via the frontend session. Product source:
`docs/product/next-three-features.md` §1, «Decisiones del 2026-11-02», Q1 (unit 1b). The backend session wrote this contract. Style follows `vacancy-team-v1.md`.

## Purpose

The company owner decides who can use the **company talent base** (the company-wide candidate pool): every recruiter
(default, as today) or only selected members. A recruiter outside the list keeps working their vacancies from the board
(candidates of vacancies where they have an active tramo) but loses the company-wide surfaces: global search, candidate
detail outside a vacancy, base CVs and the contacts export. The setting is owner-only and audited.

The system is not in production and all data is disposable.

## Backend facts this contract builds on

- The talent base is one router group (`cmd/api/router.go:300-310`, `requireAuth` + `requireRecruiter`) of nine routes
  under `/v2/me/company/candidates`. It filters by `company_id` only: there is no per-user check today.
- Vacancy-scoped surfaces (`/v2/me/company/job-drafts/{id}/...`: board, participation detail/history/CV, psychometric
  invitations, manual intake) already pass through the vacancy access predicate (owner or active tramo,
  `vacancy-team-v1.md` «Access»). This contract does not change them.
- Company roles are `owner` and `recruiter` (`company_members.role`); `company_members.user_id` is unique. Removing a
  member is a hard DELETE inside the offboard transaction (`draftstore/offboard.go`, `departCompanyMember`).
- Owner-only routes use `RequireCompanyRole(owner)`, which answers 403 `forbidden` to a recruiter.
- ETag convention (company site, vacancy team): strong quoted integer `"N"`; missing `If-Match` → 428
  `precondition_required`; malformed → 400 `invalid_request`; stale → 412 with the current document and its ETag.
- `GET /me/company` is the response every employer screen reads at entry (`{company_id, role, company}`). No
  capability object exists yet.

## Data model (migration 00055)

```sql
CREATE TABLE company_talent_base_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  mode       text NOT NULL CHECK (mode IN ('all_recruiters','selected_users')),
  version    bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at timestamptz NOT NULL,
  updated_by uuid NULL REFERENCES users(id)          -- NULL only for the backfill and company creation
);

-- Only meaningful while mode = 'selected_users'; always empty in 'all_recruiters'.
CREATE TABLE company_talent_base_viewers (
  company_id uuid NOT NULL REFERENCES company_talent_base_settings(company_id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES company_members(user_id) ON DELETE CASCADE,
  added_at   timestamptz NOT NULL,
  added_by   uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (company_id, user_id)
);
```

- The migration inserts one `all_recruiters` row (version 1) per existing company; company creation inserts it in the
  same transaction. A company never lacks the row.
- The `ON DELETE CASCADE` on `user_id` is a safety net; the offboard transaction deletes the viewer row explicitly so it
  can audit it (see «Member removal»).
- Down drops both tables (no data to preserve).

## Rules

### Who sees the talent base

`can_view_talent_base(user)` is true when **any** holds:

1. the user's role is `owner`;
2. the company mode is `all_recruiters`;
3. the user has a row in `company_talent_base_viewers`.

The stakeholder role of feature 3 will be added as rule 1b («always sees»); nothing is built for it now.

### What changes for a user without access

| Surface | Route | Result |
| --- | --- | --- |
| Search | `GET /v2/me/company/candidates` | 403 `talent_base_restricted` |
| Summary counts | `GET /v2/me/company/candidates/summary` | 403 `talent_base_restricted` |
| Contacts export | `POST /v2/me/company/candidates/contacts` | 403 `talent_base_restricted` |
| Detail outside a vacancy | `GET /v2/me/company/candidates/{kind}/{id}` | 403 `talent_base_restricted` |
| Edit | `PATCH /v2/me/company/candidates/{kind}/{id}` | 403 `talent_base_restricted` |
| History | `GET /v2/me/company/candidates/{kind}/{id}/history` | 403 `talent_base_restricted` |
| Base CV (current, original) | `GET .../{kind}/{id}/participations/{pid}/cv`, `.../cv/original` | 403 `talent_base_restricted` |
| Replace a CV from the base | `POST .../{kind}/{id}/participations/{pid}/cv` | 403 `talent_base_restricted` |

- The check runs **before** any candidate lookup, so the 403 never reveals whether a candidate exists. A missing
  candidate for a user **with** access stays 404 `not_found`.
- 403, not 404: the user knows the base exists (the owner restricted it); the frontend needs a distinct code to show
  «El owner limitó el acceso a la Base de talento» instead of «no encontrado».
- Reads evaluate the setting at request start. The two writes (edit, replace CV) re-check it inside their transaction
  with `SELECT … FROM company_talent_base_settings … FOR SHARE`; the setting PUT takes `FOR UPDATE`. A write that
  commits after a revocation is therefore impossible.

### What does not change

Every route under `/v2/me/company/job-drafts/{id}/...` keeps its current behavior for the owner and for any member with
an active tramo, whatever the setting: board, participation detail, participation history, participation CV (current and
original), discard/recover/move, checklist marks, psychometric invitations and results, manual intake. Losing the tramo
still gives 404 `team_access_ended` as today.

**Manual intake duplicate check** (`POST .../job-drafts/{id}/pipeline/candidates/manual/duplicates-check`) is the one
vacancy route that reads the pool company-wide (by exact email or phone). Decision **D2**: keep it working
for everyone, because it prevents duplicate candidates, but for a user without access return `last_vacancy: null` and
`last_added_at: null` in each match. `kind`, `id`, `full_name`, masked contacts and `in_this_process` stay, so the
recruiter can still choose «es la misma persona» (`existing`) or `confirmed_distinct`.

### Role changes and member removal

- Promoting a viewer to `owner` deletes their viewer row in the same transaction (the owner always sees; demoting them
  later does not silently restore the old selection).
- Removing a member from the company (`DELETE /me/company/members/{id}` or `POST .../offboard`) deletes their viewer row
  in the offboard transaction. `CompanyMemberOffboarded` metadata gains `talent_base_viewer_removed: true|false`.
- The mode never changes by itself: if the last viewer leaves, the company stays in `selected_users` with an empty list.

### Empty selection (decision **D1**)

`selected_users` with an empty list is **valid**: only the owner sees the talent base. The frontend should say so
(«Solo el owner ve la Base de talento»).

## Endpoints

### `GET /v2/me/company/talent-base-visibility` (any company member)

Readable by recruiters too, so the settings screen can show a recruiter why they lack access. `ETag: "N"`.

```json
{
  "mode": "selected_users",
  "viewers": [
    { "user_id": "…", "full_name": "Ana Pérez", "email": "ana@empresa.mx", "role": "recruiter", "added_at": "2026-11-04T18:00:00Z" }
  ],
  "version": 3,
  "updated_at": "2026-11-04T18:00:00Z",
  "updated_by": { "user_id": "…", "full_name": "Owner" }
}
```

- `viewers` is `[]` in `all_recruiters`, ordered by `full_name`, then `user_id`. `updated_by` is `null` when the row was
  never edited.

### `PUT /v2/me/company/talent-base-visibility` (owner, `If-Match` required)

```json
{ "mode": "selected_users", "user_ids": ["…", "…"] }
```

The body **replaces** the setting. Unknown keys → 400 `invalid_request`.

| Case | Status | Code | `fields` |
| --- | --- | --- | --- |
| Recruiter calls it | 403 | `forbidden` | — |
| Missing `If-Match` | 428 | `precondition_required` | — |
| Malformed `If-Match` | 400 | `invalid_request` | — |
| Stale `If-Match` | 412 | `talent_base_visibility_version_conflict` | body = current GET document, `ETag` = current |
| `mode` missing or not one of the two values | 422 | `validation_error` | `mode` |
| `user_ids` missing or not an array of UUIDs | 422 | `validation_error` | `user_ids` |
| Duplicate id in `user_ids` | 422 | `validation_error` | `user_ids[i]` |
| `user_ids` not empty with `all_recruiters` | 422 | `talent_base_users_not_applicable` | `user_ids` |
| An id is not a member of this company | 422 | `talent_base_viewer_not_member` | `user_ids[i]` |
| An id is an owner | 422 | `talent_base_viewer_is_owner` | `user_ids[i]` |

- Success: 200 with the new GET document and `ETag`. The version increments on every accepted PUT, including one that
  changes nothing (it is still audited, with empty `added_user_ids` and `removed_user_ids`).
- `selected_users` with `user_ids: []` is accepted (D1).

### Capability flag on `GET /me/company` (breaking-additive)

```json
{ "company_id": "…", "role": "recruiter", "company": { … }, "can": { "view_talent_base": false } }
```

- `can` is always present; v1 has one key. The frontend hides the «Base de talento» entry when it is `false` and maps
  a later 403 `talent_base_restricted` (setting changed mid-session) to the same restricted state.

## Error catalog additions

| Code | Status | Message |
| --- | --- | --- |
| `talent_base_restricted` | 403 | `the company owner restricted the talent base` |
| `talent_base_visibility_version_conflict` | 412 | `talent base visibility changed` |
| `talent_base_users_not_applicable` | 422 | `user_ids must be empty when mode is all_recruiters` |
| `talent_base_viewer_not_member` | 422 | `user is not a member of this company` |
| `talent_base_viewer_is_owner` | 422 | `owners always see the talent base` |

## Audit events

Same transaction, `entity_type = 'company'`, `entity_id = company_id`. IDs and codes only, no personal data.

| Event | Metadata (structured) |
| --- | --- |
| `TalentBaseVisibilityChanged` | company_id, version, previous_mode, new_mode, added_user_ids, removed_user_ids |
| `CompanyMemberOffboarded` (existing, gains a key) | … , talent_base_viewer_removed |

Promotion to owner deleting a viewer row is not audited in v1: role changes are not audited yet (feature 2 adds them and
will carry `talent_base_viewer_removed` the same way).

## Decisions (approved 2026-11-04)

- **D1 — Empty selection** («Sí, es válido»): valid, only the owner sees the base.
- **D2 — Duplicate check for a user without access** («Aviso sin la última vacante»): kept, with `last_vacancy` and
  `last_added_at` null.
- **D3 — 403 vs 404** («Mensaje claro»): 403 `talent_base_restricted`; no existence leak because the check precedes the
  lookup.

## Out of scope (v1)

Per-vacancy or per-candidate visibility; read auditing of the talent base (feature 2); the stakeholder role (feature 3);
notifying a recruiter when they lose access.
