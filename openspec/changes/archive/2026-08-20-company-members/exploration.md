# Exploration: company-members

Company ownership / membership. This change delivers the `company_members` relationship (who belongs to a company and with what role) and the authorization seam it enables for future company-scoped writes (`POST /jobs`, `UpdateCompany`/`DeleteCompany`, `applications` recruiter pipeline).

---

## Current State

### Architecture (hexagonal vertical slices)

Every feature under `backend/internal/features/<domain>/` follows the same shape: `domain/` (entities + value objects + repository **port**), `application/` (DTOs + use cases bound to a `*Service`), `infrastructure/` (postgres **adapter** + http **handler**), all wired manually at the composition root `backend/cmd/api/main.go`. sqlc generates `internal/db` from `db/queries/*.sql` against `db/migrations/*.sql` (goose).

### Reference slice: `companies` (the slice membership must mirror)

- `domain/entities/company.go` — aggregate root `Company` + `NewCompany` factory (parses VOs, generates UUID v7, `status=active`, UTC timestamps). Sentinels `ErrCompanyNotFound`, `ErrEmptyIndustry`, `ErrDuplicateCompany`, `ErrIndustryNotFound`.
- `domain/valueobjects/` — `CompanyName`, `CompanyRfc`, `CompanyStatus`, `CompanyDescription`, `CompanySize`, `FoundedYear`. Enums are Go ints with `String()`/`Parse*`; wire format is the DB `TEXT` value.
- `domain/repositories/companyRepository.go` — port `Create`, `GetByID` (returns `*entities.Company`).
- `application/usecases/` — `CompanyService` (`CreateCompany`, `GetCompanyByID`) + `CreateCompanyDto`.
- `infrastructure/postgres/companyRepository.go` — adapter over `*db.Queries`; `mapCreateError` translates pgconn codes (23505→`ErrDuplicateCompany`, 23503→`ErrIndustryNotFound`); pgtype helpers for nullable columns; `var _ repositories.CompanyRepository = (*CompanyRepository)(nil)`.
- `infrastructure/http/handler.go` — `CompanyHandler{Routes()}` mounted at `/companies`; DTO shapes; `classifyCreateCompanyError` maps sentinels→4xx/409/500.

### Identity: `users`, `RequireAuth`, claims

- `users` (migration `00005`): `id UUID PK`, `cognito_sub/email/full_name TEXT NOT NULL`, `user_type TEXT CHECK ('candidate','recruiter')`, soft delete via `deleted_at`. Named partial unique indexes `users_cognito_sub_unique` / `users_email_unique` `WHERE deleted_at IS NULL`. Idempotent upsert `ON CONFLICT (cognito_sub) WHERE deleted_at IS NULL DO NOTHING` (adapter re-fetches on `pgx.ErrNoRows`).
- `domain/security/verifier.go` — the seam: `Verifier.Verify(ctx, token) (Claims, error)`. **`Claims` holds exactly two fields: `Subject` (JWT `sub`) and `Groups` (`cognito:groups` normalized). Nothing else.**
- `infrastructure/auth/rsa_verifier.go` — RS256-pinned verifier (alg-confusion mitigation), validates `iss`/`aud`/`exp`, reads `sub` + `cognito:groups`. **No `company_id`, no role, no custom claim is extracted from the token.**
- `infrastructure/http/middleware.go` — `RequireAuth(verifier)` checks `Authorization: Bearer`, verifies, stores `Claims` in context via `ContextWithClaims`. 401 on any failure. **This is pure authentication — there is zero authorization today.**
- `application/post_confirmation.go` — Cognito trigger maps groups→`user_type`: `candidates`→candidate, `recruiters`/`company_admins`→recruiter. Confirms Cognito groups are `candidates`, `recruiters`, `company_admins`, but **`company_admins` carries no per-company identifier**.

### How `sub` flows to a handler today (the pattern to reuse)

`candidates/infrastructure/http/handler.go` + `candidates/application/usecases/candidateService.go`:
1. `RequireAuth` puts `Claims` in context.
2. Handler calls `requireSub` → `security.ClaimsFromContext(ctx).Subject`.
3. Use case `resolveUserID(sub)` → `identityrepositories.UserRepository.GetByCognitoSub(sub)` → stable `users.id`. This is the **IDOR-resistant boundary**: the JWT subject is resolved to a server-side `users.id` at the edge; unknown sub → `ErrUnknownSubject` → 401.

There is no role/ownership concept anywhere in the request path today. The `users.user_type` (`candidate|recruiter`) is identity, not authorization, and is only set at creation; it is never checked on a route.

### Jobs (the downstream consumer)

- `jobs` is **read-only** (`GET /jobs`, `GET /jobs/{id}`, both public). Visibility rule "published job of active company" is enforced **in SQL** (`db/queries/jobs.sql`: `j.status='published' AND j.deleted_at IS NULL AND c.status='active'`), not in Go.
- `jobs.company_id UUID NOT NULL REFERENCES companies (id)` exists. **`created_by` does NOT exist** — the data model doc (§3.7) shows it but it was not delivered in `00007`. The future job write flow will need both `created_by` and a membership check; `company-members` unblocks that.
- `jobs` depends on `companies` only via the SQL JOIN; it does not import the companies domain package.

### Migrations `00001`–`00008` conventions

- Zero-padded sequential names; `-- +goose Up/Down`; `+goose StatementBegin/End` for multi-statement bodies.
- Closed-set enums as `TEXT NOT NULL` + **named** `CHECK` constraint (e.g. `jobs_work_mode_check`).
- Soft delete via `deleted_at TIMESTAMPTZ` + **partial unique indexes** `WHERE deleted_at IS NULL` (companies `rfc`, users `cognito_sub`/`email`).
- Seed idempotency: fixed UUIDs + `ON CONFLICT (id) DO NOTHING`; down deletes by fixed UUID in FK-safe order (`00008`).
- Integration tests for migrations live in `infrastructure/postgres/migration_*.go` under `//go:build integration` (assert CHECK via SQLSTATE `23514`, seed counts, idempotency, down behavior).

### Prior design intent (authoritative)

`docs/modelo-de-datos-proyecto-04.md` already specifies the target model:
- §1.6 — `users.user_type` is **identity**; `company_members.role` is **role**. "Owner" is NOT a `user_type`; an owner is a recruiter with more permissions.
- §1.7 — **Model A: one user → one company**, implemented as `company_members` + `UNIQUE (user_id)`. Migration to multi-company = drop the constraint.
- §3.5 — canonical DDL:

```sql
CREATE TABLE company_members (
    id          UUID PRIMARY KEY,
    company_id  UUID NOT NULL REFERENCES companies (id),
    user_id     UUID NOT NULL REFERENCES users (id),
    role        TEXT NOT NULL
        CONSTRAINT company_members_role_check
        CHECK (role IN ('owner', 'recruiter')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT company_members_user_unique UNIQUE (user_id)
);
```

`docs/ROADMAP.md` states: "`company_members` — ownership de empresa … **Vive en el feature `companies`**", and lists it as the prerequisite of `jobs` write + `UpdateCompany`/`DeleteCompany`.

---

## Affected Areas

- `backend/db/migrations/00009_create_company_members.sql` (new) — the membership table + role CHECK + `UNIQUE(user_id)`.
- `backend/db/queries/company_members.sql` (new) — sqlc queries (`CreateCompanyMember`, `GetMembershipByUserID`, `ListByCompanyID`, `UpdateRole`, `RemoveMember`).
- `backend/internal/features/companies/domain/` — new entity `CompanyMember` (+ factory), new VO `MemberRole`, new port `CompanyMemberRepository`, new sentinels (`ErrNotAMember`, `ErrMemberExists`, `ErrInvalidMemberRole`, `ErrCompanyNotFound`, `ErrUserNotFound`).
- `backend/internal/features/companies/application/usecases/` — new `CompanyMemberService` (or extended `CompanyService`) with `AddMember`/`GetMyMembership`/`ListMembers`/`UpdateRole`/`RemoveMember`.
- `backend/internal/features/companies/infrastructure/postgres/` — new `companyMemberRepository.go` adapter (+ `mapCreateError` for 23505 on `company_members_user_unique`, 23503 FK).
- `backend/internal/features/companies/infrastructure/http/` — membership endpoints + the authorization middleware (or middleware lives in identity — see Recommendation).
- `backend/internal/features/identity/infrastructure/http/` — **only if** the authz middleware is placed here next to `RequireAuth` (recommended location, see below).
- `backend/cmd/api/main.go` — wire the membership repo/service/handler and mount a protected `/me/company` subtree behind `RequireAuth` + the new authz middleware.
- `docs/ROADMAP.md` — tick `company_members` when delivered (no code change).
- Downstream (out of scope, noted): `jobs` write flow, `UpdateCompany`/`DeleteCompany` will consume this middleware.

---

## Approaches

### 1. Extend `companies` feature with a `company_members` subdomain (RECOMMENDED)

Add the membership aggregate + port + adapter + use cases + endpoints **inside the existing `companies` slice**, and add an authorization middleware (`RequireCompanyRole`) that resolves `sub → users.id → company_members` and injects `{company_id, role}` into context.

- Pros: matches the explicit design intent (ROADMAP "vive en el feature companies"; data model §3.5); no new top-level context to justify; membership lifecycle is governed by company owners; reuses the companies domain sentinels (`ErrCompanyNotFound`); the authz middleware is a thin consumer of identity's `Claims` seam like `RequireAuth` already is.
- Cons: the `companies` package grows; the middleware is technically a cross-context concern (consumed by `jobs`/`applications` later).
- Effort: Medium.

### 2. New top-level bounded context `company_members`

A full standalone slice mirroring `companies` (`internal/features/company_members/...`), plus a shared/`identity`-hosted authz middleware.

- Pros: cleaner isolation; membership + authorization is a first-class context; matches the "one feature = one vertical slice" convention literally.
- Cons: contradicts the ROADMAP/data-model ("vive en el feature companies"); duplicates the companies repository wiring patterns; the ownership of the `companies` aggregate would be split across two features (a company and its members are one aggregate boundary); more moving parts in `main.go`.
- Effort: Medium-High.

### 3. Role in the JWT / Cognito group (`company_admins` + custom `company_id` claim)

Put `company_id`/`role` in the token (Cognito custom claims) and read them in the verifier, avoiding a per-request DB lookup.

- Pros: zero extra DB round-trip on the hot path; middleware is stateless.
- Cons: token is minted at login and cached client-side → stale membership (member removed but token still valid) and revocation lag; requires Cognito pre-token-generation Lambda to enrich claims and to maintain group membership; **security anti-pattern** (golang-security: server-side authorization, don't trust client/token for ownership that changes); breaks the IDOR-resistant `sub→users.id` pattern the codebase already standardized on. Rejected.
- Effort: High (infra + security surface).

---

## Recommendation

**Approach 1 — extend the existing `companies` feature with a `company_members` subdomain**, plus a reusable authorization middleware.

Concrete shape:

1. **Migration `00009`** creates `company_members` exactly per data model §3.5 (id UUID PK, `company_id`/`user_id` FKs, `role TEXT CHECK ('owner','recruiter')` named `company_members_role_check`, `UNIQUE (user_id)` named `company_members_user_unique`, `created_at`). Two open items to settle in `sdd-design` (flag them, don't decide here):
   - **soft-delete**: the delivered convention adds `deleted_at` to mutable entity tables, but §3.5 has none and the `UNIQUE(user_id)` is a *full* (non-partial) constraint. Membership removal is likely a **hard delete** (freeing `user_id` for re-assignment); adding `deleted_at` would force `UNIQUE(user_id) WHERE deleted_at IS NULL` and an upsert mirroring `users`. Recommend: **no `deleted_at`** on `company_members` for MVP (relationship, not history), document the divergence.
   - **`updated_at`**: role can change; consider adding `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` for consistency with `companies`/`users` (or add it when `UpdateRole` lands).
2. **Role model = `owner | recruiter`** (data model §1.6). `owner` is a *role within a company*, never a `users.user_type`; the "only recruiters can be members" invariant is enforced in the Go use case (no DB trigger), per §1.7.
3. **Membership is NOT in the JWT.** The token carries only `sub` (+ `cognito:groups` for coarse identity). Authorization is **resolved server-side at request time**: `sub → GetByCognitoSub → users.id → GetMembershipByUserID → {company_id, role}`, exactly mirroring `candidateService.resolveUserID`. This keeps revocation correct and matches the existing IDOR-resistant boundary.
4. **Authorization middleware `RequireCompanyRole(minRole)`** — place it in `identity/infrastructure/http/` next to `RequireAuth` (it depends only on `security.ClaimsFromContext` + a `CompanyMemberRepository` port, so it stays reusable by `jobs`/`applications` without importing the companies domain), and expose a small `CompanyContext` (or reuse a new `security.Claims` extension) holding `{CompanyID, Role}`. `main.go` mounts `/me/company` (and later `/me/jobs`) behind `RequireAuth` + `RequireCompanyRole`.
5. **Endpoints (MVP)**: membership self-service + owner management under an authenticated subtree — e.g. `GET /me/company` (my membership), `POST /me/company/members` (owner invites/adds), `PATCH /me/company/members/{id}` (owner changes role), `DELETE /me/company/members/{id}` (owner removes), `GET /me/company/members` (list). Scope is negotiable in `sdd-propose`; the invariant-critical slice is the repository + middleware, which unblocks `jobs` write.

Rationale for placing the membership under `companies`: the ROADMAP and data model already commit to it; the aggregate (`company_members`) is owned by the company owner; and the authorization middleware is the only cross-context surface — solved by keeping it in `identity`'s http layer (authentication + authorization are both identity concerns) while the *membership data* lives in `companies`.

---

## Risks

- **Divergence between data model doc and delivered schema** — `jobs.created_by` (§3.7) was never delivered in `00007`; the doc is design-ahead. `sdd-design` must treat `docs/modelo-de-datos-proyecto-04.md` as intent, and reconcile `company_members` with *delivered* conventions (soft-delete/`updated_at`), not copy §3.5 blindly.
- **Authorization vs authentication confusion** — `users.user_type` and Cognito `company_admins` group both exist and *look* like roles but are identity. Building on them (Approach 3) would reintroduce stale-token + revocation bugs. Must resolve membership server-side.
- **One-company-per-user (Model A)** is a hard `UNIQUE(user_id)`; relaxing it later is a schema change (drop constraint) that touches the authz resolution shape (`company_id` becomes a *set*). Worth an explicit decision note now.
- **Per-request DB cost** — the middleware adds a `GetByCognitoSub` + `GetMembershipByUserID` round-trip on every protected write. Acceptable at current scale (the candidates `/me/*` path already does the same), but should be noted for the future hot path.
- **FK ordering in seeds/tests** — any seed or integration test inserting `company_members` must create the parent `companies` + `users` rows first (same order discipline as `00008` down).
- **Cross-feature import direction** — if the middleware lives in `identity` and consumes the `companies` repository port, watch the dependency arrow (`identity` importing `companies/domain/repositories` is acceptable only if it stays a *port* import, not a concrete adapter import). Alternative: define the membership port in a small shared/neutral location. Decide in `sdd-design`.

---

## Ready for Proposal

**Yes.** The domain model, role set, and placement are already established in the repo's own docs; what remains is design-level reconciliation (soft-delete/`updated_at`, middleware location, endpoint scope). The orchestrator should hand `sdd-propose` the following prompt to the user:

> "Propose the `company-members` change: a `company_members` table (owner/recruiter roles, one-company-per-user) living inside the `companies` feature, resolved server-side from the Cognito `sub` (no role in the token), with a reusable `RequireCompanyRole` authorization middleware. Scope MVP endpoints and confirm whether membership removal is a hard delete."
