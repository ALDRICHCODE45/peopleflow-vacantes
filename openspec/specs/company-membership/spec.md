# Company Membership Specification

One-company-per-user membership with `owner|recruiter` roles. Server-side resolver maps the authenticated subject to `(company_id, role)` per request; the JWT carries no role. Mutations are owner-only.

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

`GET /me/company` MUST return the caller's `(company_id, role)` and the company record. Non-members → 404; unknown `sub` → 401.

#### Scenario: owner gets their membership

- GIVEN caller is `owner` of company X
- WHEN `GET /me/company`
- THEN response is 200 with `{company_id: X, role: "owner"}` and the company record

#### Scenario: non-member gets 404

- GIVEN caller has no membership row
- WHEN `GET /me/company`
- THEN response is 404

#### Scenario: unknown sub returns 401

- GIVEN a token whose `sub` matches no live `users.cognito_sub`
- WHEN `GET /me/company`
- THEN response is 401

### Requirement: ListMembers

`GET /me/company/members` MUST return memberships for the caller's company. `owner` and `recruiter` MAY read. Non-members → 403.

#### Scenario: members are listed

- GIVEN caller is `owner` of company X with N members
- WHEN `GET /me/company/members`
- THEN response is 200 and lists exactly N members with roles

#### Scenario: non-member is rejected

- GIVEN caller has no membership
- WHEN `GET /me/company/members`
- THEN response is 403

### Requirement: AddMember (Owner-Only)

`POST /me/company/members` MUST be callable only by the `owner` of the caller's company. Adding a user who already has a membership MUST be rejected.

#### Scenario: owner adds a recruiter

- GIVEN caller is `owner` of company X
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

### Requirement: UpdateRole (Owner-Only, Same-Company)

`PATCH /me/company/members/{id}` MUST be callable only by the `owner` of the target member's company. The target role SHALL be replaced.

#### Scenario: owner promotes a recruiter

- GIVEN caller is `owner` of X; member M is `recruiter` on X
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

### Requirement: RemoveMember (Owner-Only, Same-Company)

`DELETE /me/company/members/{id}` MUST be callable only by the `owner` of the target member's company. The row SHALL be deleted.

#### Scenario: owner removes a member

- GIVEN caller is `owner` of X; member M is `recruiter` on X
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

### Requirement: RequireCompanyRole Middleware

`RequireCompanyRole(minRole)` MUST resolve `(company_id, role)` from the authenticated subject per request. The handler MUST run only if the caller has a membership and `role ≥ minRole` on the path's `company_id`. Non-members or insufficient role → 403; unknown `sub` → 401.

#### Scenario: minimal role passes

- GIVEN caller is `owner` of company X
- WHEN `RequireCompanyRole("recruiter")` runs on a route scoped to X
- THEN the handler runs

#### Scenario: insufficient role is 403

- GIVEN caller is `recruiter` of company X
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

### Requirement: HTTP Surface Under /me/company

The `/me/company` subtree MUST be mounted behind `RequireAuth`. All mutations MUST additionally pass `RequireCompanyRole("owner")`.

#### Scenario: routes are mounted behind auth

- GIVEN a request to `/me/company/*` without `Authorization`
- WHEN the route runs
- THEN response is 401 and the handler is not invoked

#### Scenario: mutations enforce owner

- GIVEN caller is `recruiter`
- WHEN `POST /me/company/members` runs
- THEN response is 403
