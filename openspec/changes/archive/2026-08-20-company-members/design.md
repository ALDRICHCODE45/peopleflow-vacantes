# Design: company-members

## Technical Approach

Extend the `companies` slice with a `company_members` subdomain (ROADMAP + data model §3.5). Add a `company_members` table (migration `00009`), sqlc queries, a `CompanyMember` entity + `MemberRole` VO + repository port, a `CompanyMemberService`, and a `RequireCompanyRole(minRole)` middleware in `identity/infrastructure/http/` that resolves `sub → users.id → company_members` per request and injects `CompanyContext{company_id, role}`. Membership is never read from the JWT.

## Architecture Decisions

| # | Decision | Choice | Alternatives | Rationale |
|---|----------|--------|--------------|-----------|
| D1 | Placement | Membership inside `companies` | New top-level context; role-in-JWT | ROADMAP/§3.5 commit to it; company + members are one aggregate; role-in-JWT is a stale-token anti-pattern |
| D2 | Delete semantics | **HARD delete** (no `deleted_at`) | Soft delete + partial `UNIQUE(user_id) WHERE deleted_at IS NULL` | Relationship, not history; removal frees `user_id` for re-assignment; §3.5 has none; keeps `UNIQUE(user_id)` full |
| D3 | `updated_at` | **Include** (`created_at`+`updated_at`) | `created_at` only (§3.5) | `role` mutates via `UpdateRole`; matches `companies`/`users`/`jobs` convention and the spec's schema requirement |
| D4 | Middleware location + scoping | `identity/infrastructure/http/`; **route-scoped** via `r.With(...)` | Subtree-scoped role; middleware in `companies/http` | Authz is an identity concern; routes need different `minRole`; `GetMyMembership` needs *no* role gate (404, not 403) |
| D5 | Import direction | Identity middleware imports `companies/domain/repositories` port + `entities` only | Shared/neutral port package | Adapter stays in `companies`; port-only import keeps the arrow `identity → companies/domain`, never `→ infrastructure` |
| D6 | Caller resolution | `sub → GetByCognitoSub → users.id → GetMembershipByUserID` | Trust path/body ids | IDOR-resistant, mirrors `candidateService.resolveUserID`; middleware resolves once, gated handlers use injected `CompanyContext.CompanyID` |
| D7 | Same-company enforcement | SQL `WHERE id=$1 AND company_id=$2`; 0 rows → `ErrMemberNotFound` | Post-fetch compare in Go | Data-layer guard is race-free and IDOR-proof for `UpdateRole`/`RemoveMember` |

### Error → HTTP mapping

| Sentinel | Status | Source |
|----------|--------|--------|
| `ErrUnknownSubject` | 401 | unknown `sub` (service + middleware) |
| `ErrNotAMember` | 404 (GetMyMembership) / 403 (middleware) | no membership row |
| `ErrMemberExists` | 409 | 23505 `company_members_user_unique` |
| `ErrMemberNotFound` | 404 | cross-company/0-rows update-remove |
| `ErrUserNotFound` | 404 | 23503 `user_id` FK (AddMember target) |
| `ErrInvalidMemberRole` | 400 | VO parse |
| insufficient role | 403 | middleware `role < minRole` |

`MemberRole` is an ordinal enum (`Unknown=0, Recruiter=1, Owner=2`) so `role >= minRole` implements ranking.

## Data Flow

```
Client → RequireAuth (Bearer→Claims{sub}) → RequireCompanyRole(minRole)
        → UserRepo.GetByCognitoSub(sub) → users.id        (404→401 unknown sub)
        → MemberRepo.GetMembershipByUserID(users.id)      (none/role<min → 403)
        → ctx = CompanyContext{company_id, role}
        → Handler → Service → MemberRepo (company_id from context, never path/body)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/db/migrations/00009_create_company_members.sql` | Create | table + `company_members_role_check` + `UNIQUE(user_id)` + `company_id` index |
| `backend/db/queries/company_members.sql` | Create | 5 sqlc queries (Create/GetByUserID/ListByCompanyID/UpdateRole/Remove) |
| `backend/internal/db/*.sql.go` | Regenerate | sqlc output (not hand-edited) |
| `.../companies/domain/valueobjects/memberRole.go` | Create | `MemberRole` VO |
| `.../companies/domain/entities/companyMember.go` | Create | `CompanyMember` + sentinels |
| `.../companies/domain/repositories/companyMemberRepository.go` | Create | port |
| `.../companies/application/usecases/companyMemberService.go` | Create | service + `resolveMember` |
| `.../companies/infrastructure/postgres/companyMemberRepository.go` | Create | adapter + `mapCreateError` |
| `.../companies/infrastructure/http/memberHandler.go` | Create | handler + `classifyMemberError` |
| `.../identity/domain/security/companyContext.go` | Create | `CompanyContext` + helpers |
| `.../identity/infrastructure/http/requireCompanyRole.go` | Create | middleware |
| `backend/cmd/api/main.go` | Modify | wire repo/service/middleware + mount `/me/company` |

## Interfaces / Contracts

```go
// companies/domain/repositories
type CompanyMemberRepository interface {
    Create(ctx, *entities.CompanyMember) error
    GetMembershipByUserID(ctx, userID uuid.UUID) (*entities.CompanyMember, error)
    ListByCompanyID(ctx, companyID uuid.UUID) ([]entities.CompanyMember, error)
    UpdateRole(ctx, id, companyID uuid.UUID, role valueobjects.MemberRole) error
    Remove(ctx, id, companyID uuid.UUID) error
}

// identity/infrastructure/http
func RequireCompanyRole(users identityrepositories.UserRepository,
    members companiesrepositories.CompanyMemberRepository,
    minRole valueobjects.MemberRole) func(http.Handler) http.Handler
```

```sql
-- UpdateMemberRole / RemoveMember: same-company guard in SQL
UPDATE company_members SET role=$3, updated_at=now() WHERE id=$1 AND company_id=$2;
```

Endpoints: `GET /me/company` (no role gate); `GET /me/company/members` (`recruiter`); `POST|PATCH|DELETE /me/company/members[/{id}]` (`owner`).

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | VO parse/order; factory; `resolveMember` mapping; middleware 401/403; classifier | stdlib, no DB |
| Integration | `00009` CHECK/UNIQUE/up/down; adapter `mapCreateError` (23505/23503/0-rows); same-company update/remove | `//go:build integration` |

## Threat Matrix

`N/A` — HTTP CRUD + authz middleware only. No routing-infra change, no shell/subprocess, VCS/PR automation, executable-file classification, or process integration. The authz boundary (IDOR, 401/403) is covered by the unit/integration tests above.

## Migration / Rollout

`goose up` adds the table (additive); `goose down` drops it. No data migration or feature flag. Rollback = revert `main.go`, delete member files, `goose down 00009`.

## Open Questions

- [ ] Enforce `target.user_type == recruiter` on `AddMember`? Spec is silent; recommend deferring to a later change (invariant §1.7), noted here to avoid scope creep.
- [ ] `ListMembers` response: include `user.full_name`/`email` via JOIN? Spec requires roles only; defer.
