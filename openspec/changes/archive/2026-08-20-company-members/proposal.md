# Proposal: company-members

## Intent

Companies need per-tenant authorization so future recruiter writes (`POST /jobs`, `UpdateCompany`/`DeleteCompany`, applications) can answer "is the caller a member, and at what role?" Today every authenticated request is a stranger — `RequireAuth` only verifies `sub`; `users.user_type` is identity, not authority. This change ships `company_members` (one-company-per-user, `owner|recruiter`) and the server-side `RequireCompanyRole` middleware that consumes it. Membership resolves per request (`sub → users.id → company_members`), never trusted from the JWT.

## Scope

### In Scope
- `company_members` table, migration `00009`, sqlc queries.
- `CompanyMember` entity, `MemberRole` VO, sentinels, port + postgres adapter inside `backend/internal/features/companies/`.
- `CompanyMemberService`: `AddMember`/`GetMyMembership`/`ListMembers`/`UpdateRole`/`RemoveMember` (owner-only mutations).
- `GET /me/company`, `GET|POST /me/company/members`, `PATCH|DELETE /me/company/members/{id}`.
- `RequireCompanyRole(minRole)` in `backend/internal/features/identity/infrastructure/http/`.

### Out of Scope
- `POST /jobs`, `PUT /jobs/{id}`, publish/close, `UpdateCompany`/`DeleteCompany`.
- Role-in-JWT / Cognito custom claims (rejected: stale-token bug).
- Multi-company-per-user (Model B).

## Capabilities

### New Capabilities
- `company-membership`: one-company-per-user, `owner|recruiter` roles, owner-managed lifecycle, server-side `RequireCompanyRole` resolved from `sub`.

### Modified Capabilities
- None. `identity` `JWT Middleware` stays verbatim (Claims = `sub` + `cognito:groups`; no role from token). `candidates`/`jobs` specs unaffected.

## Approach

Extend `companies` slice with `company_members` subdomain (matches `docs/ROADMAP.md` + `docs/modelo-de-datos-proyecto-04.md` §3.5). Middleware in `identity/infrastructure/http/` next to `RequireAuth` — authorization shares identity's dependency direction; membership *data* stays in `companies`. Per-request cost: `GetByCognitoSub` + `GetMembershipByUserID` (same shape as `candidates` `/me/*`). Soft-delete / `updated_at` open items flagged for `sdd-design`.

## Affected Areas

| Area | Impact |
|------|--------|
| `backend/db/migrations/00009_create_company_members.sql` | New |
| `backend/db/queries/company_members.sql` | New |
| `backend/internal/features/companies/` | Modified (member files) |
| `backend/internal/features/identity/infrastructure/http/` | Modified (middleware) |
| `backend/cmd/api/main.go` | Modified (wire + mount) |

## Risks

| Risk | Mitigation |
|------|------------|
| Migration breaks existing rows | `00009` only adds; `goose down` drops table |
| Stale membership via custom claim | DB-resolved each request; never from JWT |
| `identity` importing `companies` port | Port-only import; adapter stays in `companies` |
| Per-request DB cost | Same as `candidates` `/me/*`; acceptable now |

## Rollback Plan

1. Revert `main.go` wiring; remove `/me/company` mount.
2. Delete new member files (handler/service/repo/middleware).
3. `goose down` on `00009`.
4. `go test ./...` MUST stay green — no existing requirement changes.

## Dependencies

- Postgres 16 (existing docker compose) — one new table; no new infra.
- `identity/domain/security.Claims` (existing seam) — unchanged.
- No new libraries.

## Success Criteria

- [ ] `00009` up/down reverts; integration test asserts named CHECK + `UNIQUE(user_id)`.
- [ ] `RequireCompanyRole("owner")` → 403 for non-members/`recruiter`s; 200 for `owner`.
- [ ] `POST /me/company/members` → 403 for non-owners; 401 for unknown `sub`.
- [ ] Membership resolved server-side per request; path/body ids ignored.
- [ ] All existing spec suites remain green; no requirement modified.
