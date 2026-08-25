# Delta for Jobs

This delta **LIFTS** the `closed` terminality that the canonical `Status Transition Table` and its `closed is terminal` scenario currently enforce, so a recruiter of a job's owning company can bring a closed vacancy back to life via the existing `PATCH /jobs/{id}` endpoint. The change adds an atomic **active-company update gate** to the same SQL `UPDATE` (mirroring the `POST /jobs` precedent from `jobs-create`), and the canonical `Error Taxonomy` for `PATCH /jobs/{id}` gains a `409 company is not active` branch. The change does NOT add any new endpoint, handler, route, migration, schema column (`closed_at`, `reopened_at`), candidate-side behavior, or notification/event-publishing path. The public read side (`GET /jobs`, `GET /jobs/{id}`, `SearchJobsItem`) is untouched; a re-opened row whose company is `active` surfaces through the existing visibility predicate the moment its `status` becomes `'published'`.

## Out of scope (deferred)

This delta does NOT cover: a dedicated `POST /jobs/{id}/reopen` endpoint, a soft-delete endpoint, notification or event publishing, `company_members` ownership, a recruiter subtree beyond the gated `POST /jobs` and `PATCH /jobs/{id}` write routes, frontend job board, production seed strategy, currency conversion (FX), or a `closed_at` / `reopened_at` column (the audit trail across a close/re-open cycle lives in `published_at` + `updated_at`).

## ADDED Requirements

### Requirement: Re-Open Transitions

A `PATCH /jobs/{id}` body that explicitly sets `status` to `'draft'` or `'published'` against a row whose current `status='closed'` MUST succeed subject to the existing CAS guard, the existing same-company invariant, the existing `RequireAuth` + `RequireCompanyRole(recruiter)` gate, and the new atomic active-company update gate. The two transitions `closed → draft` and `closed → published` are legal; the no-op `closed → closed` is rejected with `400 invalid status transition`. `published_at` MUST be preserved across a `closed → published` re-open (the existing `published_at = COALESCE(published_at, now())` branch in the `UpdateJob` SQL already encodes this — no SQL change is needed for the timestamp).

#### Scenario: closed → draft re-opens the row to draft

- GIVEN a job owned by company `A` with `status='closed'`, `published_at='2025-03-01T00:00:00Z'`, `updated_at='T'`, and a recruiter membership in company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"draft"}` and a matching `If-Unmodified-Since: T`
- THEN the response is `200` with the editor view of the row carrying `status="draft"`, `published_at='2025-03-01T00:00:00Z'` (preserved as audit history), and a new `updated_at`

#### Scenario: closed → published re-opens the row and preserves the original published_at

- GIVEN a job owned by company `A` with `status='closed'`, `published_at='2025-03-01T00:00:00Z'`, `updated_at='T'`, and a recruiter membership in company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"published"}` and a matching `If-Unmodified-Since: T`
- THEN the response is `200` and the row's `status='published'`, `published_at` remains `'2025-03-01T00:00:00Z'`, and `updated_at` is within the request window

#### Scenario: closed → published preserves published_at across close/reopen cycles

- GIVEN a job that was first published at `'2025-03-01T00:00:00Z'`, then `closed`, then re-opened via `closed → published`
- WHEN the row is read after the re-open
- THEN the row's `published_at` is still `'2025-03-01T00:00:00Z'` (audit-history semantics; a re-open does not reset the original first-publish timestamp)

#### Scenario: closed → closed (no-op) returns 400 invalid status transition

- GIVEN a job owned by company `A` with `status='closed'` and a recruiter membership in company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"closed"}` and a matching `If-Unmodified-Since`
- THEN the response is `400 invalid status transition` because a no-op write against a closed row is meaningless

#### Scenario: closed → draft re-opens through the same gate as PATCH and CREATE

- GIVEN a recruiter membership in company `A` and a closed job owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"draft"}` and a matching CAS token
- THEN the response is `200` (the request passes the same `RequireAuth` + `RequireCompanyRole(recruiter)` middleware the existing `POST /jobs` and `PATCH /jobs/{id}` flows pass — rule #2 extends to re-open)

### Requirement: Re-Open + Field Edits Apply Atomically

A `PATCH /jobs/{id}` body that combines an explicit re-open transition (`status='draft'` or `status='published'`) with one or more field edits MUST apply both in the same SQL `UPDATE` statement: `updated_at` advances exactly once, the STORED `search_vector` regenerates from the new `title`/`description`, and `published_at` follows the re-open policy above. A `PATCH /jobs/{id}` body that contains ONLY field edits and NO `status` against a row whose current `status='closed'` is rejected with `400 invalid status transition` — the closed row is frozen for content, and the only escape is an explicit `closed → {draft, published}` transition.

#### Scenario: closed → draft + title edit applies atomically

- GIVEN a job owned by company `A` with `status='closed'`, `title='Old'`, `description='Old'`, `updated_at='T'`, and a recruiter membership in company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"draft","title":"New"}` and a matching `If-Unmodified-Since: T`
- THEN the response is `200` and the row's `status='draft'`, `title='New'`, `description='Old'`, `updated_at` advances exactly once within the request window, and `published_at` is preserved

#### Scenario: closed → published + description edit applies atomically and regenerates search_vector

- GIVEN a job owned by company `A` with `status='closed'`, `title='Engineer'`, `description='old body'`, `published_at='2025-03-01T00:00:00Z'`, `updated_at='T'`, and a recruiter membership in company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"published","description":"new body"}` and a matching `If-Unmodified-Since: T`
- THEN the response is `200` and the row's `status='published'`, `description='new body'`, `published_at='2025-03-01T00:00:00Z'` (preserved), and the STORED `search_vector` reflects the new `description` text on the next read

#### Scenario: field-only PATCH on a closed row returns 400 invalid status transition

- GIVEN a job owned by company `A` with `status='closed'`, `title='Old'`, and a recruiter membership in company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"title":"New"}` and NO `status` key
- THEN the response is `400 invalid status transition` (the closed row is frozen for content — only an explicit `status` transition out of `closed` unlocks it; LOCKED by user round 2026-08-25)

#### Scenario: PATCH with status absent on a closed row leaves status unchanged

- GIVEN a job owned by company `A` with `status='closed'`, `updated_at='T'`, and a recruiter membership in company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"description":"New body"}` and NO `status` key
- THEN the response is `400` and the row's `status` remains `'closed'` (the transition table does not apply because `status` is absent; the closed-terminal early-return still rejects the field-only body per the rule above)

### Requirement: Active-Company Update Gate

Every `PATCH /jobs/{id}` write — not only re-open transitions — MUST be gated by the same atomic active-company predicate the `POST /jobs` flow uses (the `Active Company Creation Gate` requirement). The active-company predicate MUST be enforced atomically inside the same SQL `UPDATE` statement that writes the row (no read-then-write TOCTOU window): a non-active company (`status='suspended'` or `status='pending_verification'`) MUST yield the existing `entities.ErrCompanyNotActive` sentinel, and the HTTP layer MUST map that sentinel to `409 Conflict` with body `{"error":"company is not active"}` (reusing the `classifyError` branch added by `jobs-create`). A zero-row outcome on the SQL guard (whether the company is suspended, pending, or — defensively — missing) MUST surface as the same sentinel and the same `409 Conflict` response.

#### Scenario: suspended company PATCH returns 409 company is not active

- GIVEN a recruiter membership in company `A` whose `companies.status='suspended'` and a job owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent with a valid body and a matching CAS token
- THEN the response is `409 Conflict` with body `{"error":"company is not active"}` and the row is NOT updated

#### Scenario: pending_verification company PATCH returns 409 company is not active

- GIVEN a recruiter membership in company `A` whose `companies.status='pending_verification'` and a job owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent with a valid body and a matching CAS token
- THEN the response is `409 Conflict` with body `{"error":"company is not active"}` and the row is NOT updated

#### Scenario: active company PATCH passes the gate

- GIVEN a recruiter membership in company `A` whose `companies.status='active'` and a job owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent with a valid body and a matching CAS token
- THEN the response is `200` (the SQL guard produces 1 row; the active predicate passes; LOCKED by user round 2026-08-25 — gate is required for ALL `PATCH /jobs/{id}` writes, not just re-open)

#### Scenario: the active check is atomic with the UPDATE

- GIVEN the SQL guard encodes the active predicate in the same statement that writes the row (CTE / `WHERE`-on-`UPDATE` shape, mirroring `CreateJob`)
- WHEN `PATCH /jobs/{id}` is sent for a job whose company is `active` at the middleware gate but is `suspended` immediately after the gate middleware resolves the membership
- THEN the SQL predicate STILL wins — the company was not active at `UPDATE` time, so the `UPDATE` yields 0 rows and the response is `409 Conflict` (no TOCTOU window between middleware and write)

### Requirement: Re-Open Inherits CAS and Same-Company Invariants

A re-open `PATCH /jobs/{id}` MUST inherit the existing CAS, same-company, and soft-delete invariants unchanged: a stale `If-Unmodified-Since` returns `409 Conflict` with the editor view of the latest row (same shape as a successful `200`); a re-open of another company's closed job surfaces as `404 job not found`; a re-open of a soft-deleted job also surfaces as `404 job not found`. The two new legal transitions and the active-company update gate are additive — they do not relax or bypass any existing concurrency, IDOR, or soft-delete defense.

#### Scenario: re-open with a stale If-Unmodified-Since returns 409 with the latest editor view

- GIVEN a job owned by company `A` with `status='closed'` and current `updated_at='2026-02-02T11:00:00Z'` (changed by a concurrent writer since the client last read it)
- AND a recruiter of company `A` sends `If-Unmodified-Since: 2026-02-01T10:00:00Z`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"draft"}`
- THEN the response is `409 Conflict` and the body is the editor view of the row carrying `status="closed"` and `updated_at='2026-02-02T11:00:00Z'` so the client can re-read without an extra round-trip

#### Scenario: cross-company re-open returns 404 job not found

- GIVEN a closed job owned by company `B`
- WHEN a recruiter of company `A` sends `PATCH /jobs/{id}` for that job with body `{"status":"draft"}` and a matching CAS token
- THEN the response is `404 job not found` and the body shape is identical to a non-existent id (no leak of existence — the same-company invariant is unchanged by re-open)

#### Scenario: re-open on a soft-deleted closed job returns 404 job not found

- GIVEN a soft-deleted (`deleted_at IS NOT NULL`) closed job owned by company `A`
- WHEN a recruiter of company `A` sends `PATCH /jobs/{id}` with body `{"status":"draft"}` and a matching CAS token
- THEN the response is `404 job not found` (soft-delete is not relaxed by re-open — a re-open exception on a soft-deleted row is out of scope; LOCKED by user round 2026-08-25)

## MODIFIED Requirements

### Requirement: Status Transition Table

(Previously: every transition out of `closed` was illegal; the table marked `closed → {draft, published}` as `NO → 400`, and the requirement carried a `closed is terminal` scenario that rejected ANY body on a closed row. This delta lifts `closed → {draft, published}` to `YES`, tightens the wording for the `published_at` write to match the audit-history policy, and removes the obsolete `closed is terminal` scenario; the remaining seven scenarios and the integrity-guard sentence are unchanged.)

The `status` field on PATCH MUST obey the following transition matrix; every illegal transition MUST return `400 invalid status transition`. When `status` is absent from the request body, the transition table MUST NOT apply and the field MUST be left untouched.

| Current `status` | Requested `status` | Allowed | Side effect |
|---|---|---|---|
| `draft` | `draft` | YES | Field-only edit; no `published_at` change. |
| `draft` | `published` | YES | Server MUST set `published_at = COALESCE(published_at, now())` in the same SQL UPDATE; on a fresh draft (`published_at IS NULL`) this resolves to `now()`; on a re-open (`closed → published` from a row that was previously published) this preserves the row's prior `published_at` (audit-history policy). |
| `draft` | `closed` | NO | `400`. |
| `published` | `draft` | NO | `400` — no un-publish in this change. |
| `published` | `published` | YES | Field-only edit; `published_at` preserved; `search_vector` regenerates via the STORED column. |
| `published` | `closed` | YES | `published_at` is preserved as audit history. |
| **`closed`** | **`draft`** | **YES (NEW — re-open)** | **Transition + field edits in the same call MUST apply atomically. `published_at` is preserved as audit history (the column is left unchanged by the SQL `ELSE` branch).** |
| **`closed`** | **`published`** | **YES (NEW — re-open)** | **Transition + field edits in the same call MUST apply atomically. `published_at` is preserved (audit-history policy — the existing `COALESCE(published_at, now())` branch already encodes "preserve on re-publish to published"; no SQL change for the timestamp).** |
| `closed` | `closed` | NO | `400` — no-op transition on a closed row is a pointless write. |

The DB integrity guard `CHECK (status <> 'published' OR published_at IS NOT NULL)` MUST continue to hold: when the patch sets `status='published'`, the same SQL UPDATE MUST also set `published_at = COALESCE(published_at, now())` atomically (one statement, not two writes). For a fresh draft this resolves to `now()`; for a re-open of a previously-published row, the original `published_at` is preserved.

#### Scenario: draft → published sets published_at now

- GIVEN a job with `status='draft'` and `published_at IS NULL`
- WHEN `PATCH /jobs/{id}` is sent with `{"status":"published"}`
- THEN the response is `200` and the row's `status='published'` and `published_at` is within the request window

#### Scenario: published → closed preserves published_at

- GIVEN a job with `status='published'` and `published_at='2026-01-15T12:00:00Z'`
- WHEN `PATCH /jobs/{id}` is sent with `{"status":"closed"}`
- THEN `status='closed'` and `published_at` remains `'2026-01-15T12:00:00Z'`

#### Scenario: status + field mix applies atomically

- GIVEN a job with `status='draft'` and `title='Old'`
- WHEN `PATCH /jobs/{id}` is sent with `{"status":"published","title":"New"}`
- THEN the response is `200` and the row's `status='published'`, `title='New'`, and `published_at` is set within the request window

#### Scenario: published field-only edit preserves published_at

- GIVEN a job with `status='published'`, `published_at='2026-01-10T00:00:00Z'`, and `description='Old'`
- WHEN `PATCH /jobs/{id}` is sent with `{"description":"New"}` and no `status`
- THEN `description='New'`, `status` remains `'published'`, and `published_at` remains `'2026-01-10T00:00:00Z'`

#### Scenario: published → draft is rejected

- GIVEN a job with `status='published'`
- WHEN `PATCH /jobs/{id}` is sent with `{"status":"draft"}`
- THEN the response is `400`

#### Scenario: draft → closed is rejected

- GIVEN a job with `status='draft'`
- WHEN `PATCH /jobs/{id}` is sent with `{"status":"closed"}`
- THEN the response is `400`

#### Scenario: status-only PATCH is allowed

- GIVEN a job with `status='draft'`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"published"}` and no other field
- THEN the response is `200` with the editor view

#### Scenario: closed → draft re-open is allowed (NEW — replaces the obsolete "closed is terminal" scenario)

- GIVEN a job with `status='closed'`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"draft"}` and a matching CAS token
- THEN the response is `200` with the editor view (the transition is legal under this delta)

#### Scenario: closed → published re-open is allowed (NEW — replaces the obsolete "closed is terminal" scenario)

- GIVEN a job with `status='closed'` and `published_at='2025-03-01T00:00:00Z'`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"published"}` and a matching CAS token
- THEN the response is `200` and `published_at` remains `'2025-03-01T00:00:00Z'` (audit-history policy)

### Requirement: Error Taxonomy

(Previously: the `PATCH /jobs/{id}` error taxonomy did not include an active-company branch; `ErrCompanyNotActive` and its `409 company is not active` mapping existed only for `POST /jobs`. This delta adds one new `409` row to the taxonomy so the new atomic active-company update gate (see `Active-Company Update Gate`) classifies correctly; every other outcome and the three scenarios below are unchanged.)

The HTTP layer MUST classify PATCH errors into the following status codes. The body MUST carry enough information for the client to surface a useful message. Classification MUST NOT leak row existence beyond the `404` / `409` cases pinned by the same-company invariant and CAS requirements.

| Outcome | HTTP status | Body |
|---|---|---|
| `{id}` is not a valid UUID | `400 invalid job id` | error message |
| Status transition is illegal | `400 invalid status transition` | error message naming the offending transition |
| Unknown VO, empty `title` / `description`, or `salary_min > salary_max` | `400 validation` | error message naming the failing field |
| No `Authorization` header / unverifiable token | `401 unauthenticated` | error message |
| Authenticated but not a member of the job's owning company, or role too low | `403 not a member / role too low` | error message |
| Row does not exist for the caller's company (cross-company, soft-deleted, or non-existent) | `404 job not found` | error message |
| `If-Unmodified-Since` mismatches the row's current `updated_at` (or header missing) | `409 conflict` | editor view of the latest row |
| **Owning company is not `active` at the moment of the `UPDATE` (suspended, `pending_verification`, or 0 rows on the atomic SQL guard — applies to ALL `PATCH /jobs/{id}` writes, not only re-open)** | **`409 company is not active`** | **error message (`ErrCompanyNotActive` — reuses the `classifyError` branch added by `jobs-create`)** |
| Anything else | `500 internal` | error message |

#### Scenario: invalid job id returns 400

- GIVEN a request to `PATCH /jobs/not-a-uuid`
- WHEN the request reaches the gated route
- THEN the response is `400`

#### Scenario: 404 is identical for cross-company and non-existent

- GIVEN a recruiter of company `A`
- WHEN `PATCH /jobs/<id-of-company-B>` is sent and `PATCH /jobs/<random-uuid>` is sent
- THEN both responses are `404` with the same body shape (no leak of existence)

#### Scenario: 409 carries the latest editor view

- GIVEN a CAS conflict
- WHEN the response is returned
- THEN the body is the editor view of the latest row (the same shape as a `200` response)

#### Scenario: 409 for a non-active company carries "company is not active" (NEW)

- GIVEN a recruiter of company `A` whose `companies.status='suspended'` and a job owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent with a valid body and a matching CAS token
- THEN the response is `409 Conflict` with body `{"error":"company is not active"}` and the row is NOT updated (the new atomic SQL guard yields 0 rows; `mapUpdateError` maps the guard miss to `ErrCompanyNotActive`; `classifyError` returns `409 company is not active`)
