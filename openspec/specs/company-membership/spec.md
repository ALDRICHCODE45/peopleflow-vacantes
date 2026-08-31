# Company Membership Specification

One-company-per-user membership with `owner|recruiter` roles. Server-side resolver maps the authenticated subject to `(company_id, role)` per request; the JWT carries no role. Mutations are owner-only. The `RequireCompanyRole` middleware resolves `(company_id, role)` per request and additionally probes the resolved company's liveness — a tombstoned company (`deleted_at IS NOT NULL`) or a missing company row collapses to the same `403 company is inactive` from the middleware BEFORE the handler runs; the `company_members` row itself survives in the DB as audit history and is NOT touched by the soft-delete write.

## Requirements

### Requirement: company_members Schema Migration

Migration `00009` MUST create `company_members` `(id UUID PK, user_id UUID FK→users, company_id UUID FK→companies, role TEXT, created_at/updated_at TIMESTAMPTZ)`. `user_id` MUST be `UNIQUE` (one company per user). `role` MUST be constrained by a named CHECK to the closed set `owner|recruiter`. `goose down` MUST reverse.

#### Scenario: up creates named objects

- GIVEN DB at the previous revision
- WHEN `goose up` runs `00009`
- THEN `company_members`, the UNIQUE on `user_id`, and the role CHECK exist

#### Scenario: down drops the table

- GIVEN `00009` applied
- WHEN `goose down` runs
- THEN `company_members` is gone

#### Scenario: invalid role is rejected by the DB

- GIVEN an attempt to insert `role = "admin"`
- WHEN the write runs
- THEN the DB rejects with a constraint violation

#### Scenario: second membership for same user is rejected

- GIVEN user U already has a membership on company X
- WHEN a second insert with `user_id = U` and a different `company_id` runs
- THEN the DB rejects with a uniqueness violation

### Requirement: Membership Resolution from Authenticated Subject

Membership MUST be resolved per request as `sub → users.id → company_members`. The JWT MUST NOT carry any per-company role. Path or body identifiers MUST NOT resolve the caller's identity or role.

#### Scenario: body company_id is ignored

- GIVEN caller is `owner` of company X
- WHEN `POST /me/company/members` carries body `company_id = Y`
- THEN the row is created on company X (the caller's company), not Y

### Requirement: GetMyMembership

`GET /me/company` MUST run behind `RequireAuth` ONLY (the route is NOT gated by `RequireCompanyRole`'s liveness probe). The route MUST return the caller's `(company_id, role)` and the company record. Non-members → 404; unknown `sub` → 401; tombstoned company (`deleted_at IS NOT NULL`) → 404 `company not found`. The `company_members` row itself survives in the DB as audit history (the soft-delete write does NOT touch `company_members`), but the company projection is hidden by `GetCompanyByID`'s `WHERE deleted_at IS NULL` predicate — there is NO archived-company response in this slice (a future restore endpoint is the proper un-tombstone mechanism).

#### Scenario: owner gets their membership

- GIVEN caller is `owner` of company X
- WHEN `GET /me/company`
- THEN response is 200 with `{company_id: X, role: "owner"}` and the company record

#### Scenario: non-member gets 404

- GIVEN caller has no membership row
- WHEN `GET /me/company`
- THEN response is 404

#### Scenario: tombstoned company hides the company projection (no archived view)

- GIVEN caller is `owner` of company X with `companies.deleted_at IS NOT NULL`
- WHEN `GET /me/company`
- THEN response is 404 `company not found` (the membership read resolves the company through `GetCompanyByID`, whose `WHERE deleted_at IS NULL` predicate filters the tombstoned row; the `company_members` row itself survives in the DB as audit history, but no archived-company response is returned)

#### Scenario: unknown sub returns 401

- GIVEN a token whose `sub` matches no live `users.cognito_sub`
- WHEN `GET /me/company`
- THEN response is 401

### Requirement: ListMembers

`GET /me/company/members` MUST run behind `RequireAuth` followed by `RequireCompanyRole("recruiter")`. The route MUST return memberships for the caller's company. `owner` and `recruiter` MAY read. Non-members → 403; tombstoned member company (`deleted_at IS NOT NULL`) → 403 `company is inactive` from the middleware BEFORE the handler runs (no list response, no `CompanyContext`).

#### Scenario: members are listed

- GIVEN caller is `owner` of company X with N members
- WHEN `GET /me/company/members`
- THEN response is 200 and lists exactly N members with roles

#### Scenario: non-member is rejected

- GIVEN caller has no membership
- WHEN `GET /me/company/members`
- THEN response is 403

#### Scenario: tombstoned company is 403 company is inactive

- GIVEN caller is `owner` (or `recruiter`) of company X with `companies.deleted_at IS NOT NULL`
- WHEN `GET /me/company/members`
- THEN response is 403 with reason `company is inactive` and the handler is never invoked (the liveness probe collapses tombstoned and missing-company rows to the same 403; no list response is returned)

### Requirement: AddMember (Owner-Only)

`POST /me/company/members` MUST run behind `RequireAuth` followed by `RequireCompanyRole("owner")`. The route MUST be callable only by the `owner` of the caller's company. Adding a user who already has a membership MUST be rejected. Tombstoned member company (`deleted_at IS NOT NULL`) → 403 `company is inactive` from the middleware BEFORE the handler runs (no row is inserted, no `CompanyContext`).

#### Scenario: owner adds a recruiter

- GIVEN caller is `owner` of company X (live)
- WHEN `POST /me/company/members` with `{user_id: U, role: recruiter}`
- THEN a row exists with `(user_id=U, company_id=X, role=recruiter)`

#### Scenario: non-owner is rejected

- GIVEN caller is `recruiter` or non-member of company X
- WHEN `POST /me/company/members` runs
- THEN response is 403 and no row is inserted

#### Scenario: duplicate user is rejected

- GIVEN user U already has a membership
- WHEN `POST /me/company/members` with `{user_id: U}`
- THEN response is 409 and no second row is inserted

#### Scenario: tombstoned company is 403 company is inactive

- GIVEN caller is `owner` of company X with `companies.deleted_at IS NOT NULL`
- WHEN `POST /me/company/members` runs
- THEN response is 403 with reason `company is inactive` and no row is inserted

### Requirement: UpdateRole (Owner-Only, Same-Company)

`PATCH /me/company/members/{id}` MUST run behind `RequireAuth` followed by `RequireCompanyRole("owner")`. The route MUST be callable only by the `owner` of the target member's company. The target role SHALL be replaced. Tombstoned member company (`deleted_at IS NOT NULL`) → 403 `company is inactive` from the middleware BEFORE the handler runs (no row is updated, no `CompanyContext`).

#### Scenario: owner promotes a recruiter

- GIVEN caller is `owner` of X (live); member M is `recruiter` on X
- WHEN `PATCH /me/company/members/M` with `role=owner`
- THEN M's stored role is `owner`

#### Scenario: non-owner is rejected

- GIVEN caller is `recruiter` on company X
- WHEN `PATCH /me/company/members/M`
- THEN response is 403 and no row is updated

#### Scenario: cross-company target is rejected

- GIVEN caller is `owner` of X; member M belongs to Y
- WHEN `PATCH /me/company/members/M`
- THEN response is 404 and no row is updated

#### Scenario: tombstoned company is 403 company is inactive

- GIVEN caller is `owner` of company X with `companies.deleted_at IS NOT NULL`
- WHEN `PATCH /me/company/members/{id}` runs
- THEN response is 403 with reason `company is inactive` and no row is updated

### Requirement: RemoveMember (Owner-Only, Same-Company)

`DELETE /me/company/members/{id}` MUST run behind `RequireAuth` followed by `RequireCompanyRole("owner")`. The route MUST be callable only by the `owner` of the target member's company. The row SHALL be deleted. Tombstoned member company (`deleted_at IS NOT NULL`) → 403 `company is inactive` from the middleware BEFORE the handler runs (no row is deleted, no `CompanyContext`).

#### Scenario: owner removes a member

- GIVEN caller is `owner` of X (live); member M is `recruiter` on X
- WHEN `DELETE /me/company/members/M`
- THEN response is 204 and M's row is gone

#### Scenario: non-owner is rejected

- GIVEN caller is `recruiter` on company X
- WHEN `DELETE /me/company/members/M`
- THEN response is 403 and M's row remains

#### Scenario: cross-company target is rejected

- GIVEN caller is `owner` of X; member M belongs to Y
- WHEN `DELETE /me/company/members/M`
- THEN response is 404 and M's row remains

#### Scenario: tombstoned company is 403 company is inactive

- GIVEN caller is `owner` of company X with `companies.deleted_at IS NOT NULL`
- WHEN `DELETE /me/company/members/{id}` runs
- THEN response is 403 with reason `company is inactive` and no row is deleted

### Requirement: RequireCompanyRole Middleware

`RequireCompanyRole(minRole)` MUST run AFTER `RequireAuth` and MUST enforce an ordered dispatch: (a) resolve the JWT `sub` to `users.id` (a missing subject is `401`); (b) resolve `users.id` to a `company_members` row (a missing row is `403 not a member of any company`); (c) probe the resolved company's liveness via `GetCompanyByID`'s `WHERE deleted_at IS NULL` predicate (a tombstoned company — `deleted_at IS NOT NULL` — or a missing company row — `ErrCompanyNotFound` — collapses to `403 company is inactive`; an unexpected liveness lookup error is `500`); (d) compare the membership role to `minRole` (a role strictly below `minRole` is `403 insufficient role`). The liveness probe (sub-check c) runs AFTER membership resolution (so a stranger cannot probe company existence via the gate) and BEFORE role comparison (so the handler NEVER receives a `CompanyContext` for a tombstoned company). When the gate passes, the middleware MUST inject a `CompanyContext` carrying `(company_id, user_id, role)` for the handler; when the gate rejects, the handler is NEVER invoked and no `CompanyContext` is injected. The handler MUST short-circuit fail-closed (`500 internal server error`) if no `CompanyContext` is present on the request context (the canonical `RequireCompanyContext` invariant).

#### Scenario: minimal role passes

- GIVEN caller is `owner` of company X (live)
- WHEN `RequireCompanyRole("recruiter")` runs on a route scoped to X
- THEN the handler runs and `CompanyContext` is injected

#### Scenario: insufficient role is 403

- GIVEN caller is `recruiter` of company X (live)
- WHEN `RequireCompanyRole("owner")` runs
- THEN response is 403 and the handler is not invoked

#### Scenario: non-member is 403

- GIVEN caller has no membership
- WHEN `RequireCompanyRole("owner")` runs
- THEN response is 403 and the handler is not invoked

#### Scenario: unknown sub is 401

- GIVEN a token whose `sub` matches no live `users.cognito_sub`
- WHEN `RequireCompanyRole(...)` runs
- THEN response is 401 and the handler is not invoked

#### Scenario: tombstoned member company is 403 company is inactive

- GIVEN caller has a `company_members` row for company X with `companies.deleted_at IS NOT NULL`
- WHEN `RequireCompanyRole(...)` runs
- THEN response is 403 with reason `company is inactive` and the handler is not invoked (the liveness probe collapses tombstoned and missing-company rows to the same 403; no `CompanyContext` is injected)

#### Scenario: missing company row is 403 company is inactive

- GIVEN caller has a `company_members` row referencing company X but `companies` has no row for X (or `GetCompanyByID` returns `ErrCompanyNotFound`)
- WHEN `RequireCompanyRole(...)` runs
- THEN response is 403 with reason `company is inactive` and the handler is not invoked (same collapse as the tombstoned branch)

#### Scenario: unexpected liveness lookup error is 500

- GIVEN `GetCompanyByID` returns an unexpected error (DB connection failure, query timeout — anything other than the row-absent sentinel `ErrCompanyNotFound`)
- WHEN `RequireCompanyRole(...)` runs
- THEN response is 500 and the handler is not invoked (the liveness probe surfaces infrastructure failures as `500`, distinct from the `403` collapse)

### Requirement: HTTP Surface Under /me/company

The `/me/company` subtree MUST be mounted behind `RequireAuth`. `GET /me/company/members` MUST additionally pass `RequireCompanyRole("recruiter")` (owner and recruiter both pass). `POST /me/company/members`, `PATCH /me/company/members/{id}`, and `DELETE /me/company/members/{id}` MUST additionally pass `RequireCompanyRole("owner")`. `GET /me/company` is `RequireAuth`-only and is NOT gated by `RequireCompanyRole`'s liveness probe (the membership read resolves the company through `GetCompanyByID`, which filters tombstoned rows to `404`).

| Route | Method | Auth gate | Role gate |
|-------|--------|-----------|-----------|
| `/me/company` | GET | `RequireAuth` | — |
| `/me/company/members` | GET | `RequireAuth` | `RequireCompanyRole("recruiter")` |
| `/me/company/members` | POST | `RequireAuth` | `RequireCompanyRole("owner")` |
| `/me/company/members/{id}` | PATCH | `RequireAuth` | `RequireCompanyRole("owner")` |
| `/me/company/members/{id}` | DELETE | `RequireAuth` | `RequireCompanyRole("owner")` |

#### Scenario: routes are mounted behind auth

- GIVEN a request to `/me/company/*` without `Authorization`
- WHEN the route runs
- THEN response is 401 and the handler is not invoked

#### Scenario: GET members allows owner and recruiter

- GIVEN caller is `owner` or `recruiter` of company X (live)
- WHEN `GET /me/company/members` runs
- THEN response is 200 and the handler runs

#### Scenario: mutations enforce owner

- GIVEN caller is `recruiter`
- WHEN `POST /me/company/members` runs
- THEN response is 403

#### Scenario: every role-gated route returns 403 company is inactive on tombstoned company

- GIVEN caller has a `company_members` row for company X with `companies.deleted_at IS NOT NULL`
- WHEN `GET /me/company/members`, `POST /me/company/members`, `PATCH /me/company/members/{id}`, or `DELETE /me/company/members/{id}` runs
- THEN response is 403 with reason `company is inactive` and the handler is never invoked (no list response, no mutation)
