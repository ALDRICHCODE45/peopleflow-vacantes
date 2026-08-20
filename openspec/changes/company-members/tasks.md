# Tasks: company-members

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 2,600–4,200 (11 new files + tests + sqlc regen) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

`single-pr` + High risk ⇒ a `size:exception` label MUST be approved before `sdd-apply`, or the user opts into the split below.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Migration `00009` + sqlc queries/regen | PR 1 | `make test-integration` | `goose up/down 00009` | `db/migrations/00009*`, `db/queries/company_members.sql`, `internal/db` |
| 2 | Domain VO + entity + port + service | PR 2 | `cd backend && go test ./internal/features/companies/...` | N/A — no runtime boundary (pure domain) | `companies/domain/*`, `companies/application/usecases/companyMemberService.go` |
| 3 | Postgres adapter + HTTP handler | PR 3 | `cd backend && go test ./internal/features/companies/... && make test-integration` | `curl /me/company/members` | `companies/infrastructure/{postgres,http}/*Member*.go` |
| 4 | `CompanyContext` + `RequireCompanyRole` + `main.go` wiring | PR 4 | `cd backend && go test ./internal/features/identity/...` | `curl -H "Authorization: Bearer …" /me/company` | `identity/**/companyContext.go`, `requireCompanyRole.go`, `main.go` diff |

## Phase 1: Foundation — Schema & Queries

- [x] 1.1 RED: integration test `db/migrations/migrations_test.go` asserting `00009` up creates `company_members`, `UNIQUE(user_id)`, `company_members_role_check` (spec: up creates named objects).
- [x] 1.2 RED: integration test asserting `goose down` drops `company_members` (spec: down drops the table).
- [x] 1.3 RED: integration tests asserting `role='admin'` insert fails and a second `user_id` insert fails (spec: invalid role / second membership).
- [x] 1.4 GREEN: write `backend/db/migrations/00009_create_company_members.sql` (table, named CHECK, `UNIQUE(user_id)`, `company_id` index, up+down).
- [x] 1.5 GREEN: write `backend/db/queries/company_members.sql` — Create, GetMembershipByUserID, ListByCompanyID, UpdateRole (`WHERE id=$1 AND company_id=$2`), Remove (same guard).
- [x] 1.6 GREEN: run `sqlc generate`; commit regenerated `backend/internal/db/*.sql.go` unedited.

## Phase 2: Core — Domain & Service

- [x] 2.1 RED: `companies/domain/valueobjects/memberRole_test.go` — parse `owner|recruiter`, reject `admin` with `ErrInvalidMemberRole`, assert ordinal ranking `Owner > Recruiter > Unknown`.
- [x] 2.2 GREEN: `companies/domain/valueobjects/memberRole.go` — ordinal enum + `ParseMemberRole` + `String`.
- [x] 2.3 RED: `companies/domain/entities/companyMember_test.go` — factory sets id/timestamps, rejects invalid role.
- [x] 2.4 GREEN: `companies/domain/entities/companyMember.go` — `CompanyMember` + sentinels (`ErrUnknownSubject`, `ErrNotAMember`, `ErrMemberExists`, `ErrMemberNotFound`, `ErrUserNotFound`).
- [x] 2.5 GREEN: `companies/domain/repositories/companyMemberRepository.go` — port per design Interfaces.
- [x] 2.6 RED: `companies/application/usecases/companyMemberService_test.go` with fake repos — `resolveMember` maps unknown sub → `ErrUnknownSubject`, no row → `ErrNotAMember` (spec: Membership Resolution).
- [x] 2.7 RED: service tests — `AddMember` uses caller's `company_id`, ignoring body `company_id=Y` (spec: body company_id is ignored).
- [x] 2.8 RED: service tests — `GetMyMembership` returns `(company_id, role)`+company; `ListMembers` returns N members; `UpdateRole`/`RemoveMember` propagate `ErrMemberNotFound` for cross-company targets.
- [x] 2.9 GREEN: `companies/application/usecases/companyMemberService.go` — the five use cases + `resolveMember`.

## Phase 3: Wiring — Adapter, Handler, Middleware

- [ ] 3.1 RED: integration test for `companyMemberRepository` — `mapCreateError` maps 23505 → `ErrMemberExists`, 23503 → `ErrUserNotFound`.
- [ ] 3.2 RED: integration test — `UpdateRole`/`Remove` with a foreign `company_id` affect 0 rows → `ErrMemberNotFound` (spec: cross-company target rejected).
- [ ] 3.3 GREEN: `companies/infrastructure/postgres/companyMemberRepository.go` — adapter + `mapCreateError`.
- [ ] 3.4 RED: `companies/infrastructure/http/memberHandler_test.go` (httptest) — `classifyMemberError` mapping: 401/404/409/404/400 per design table.
- [ ] 3.5 RED: handler tests — `GET /me/company` 200 owner, 404 non-member, 401 unknown sub; `GET /me/company/members` 200 lists N, 403 non-member; `POST` 201 owner / 409 duplicate; `PATCH` promotes; `DELETE` 204.
- [ ] 3.6 GREEN: `companies/infrastructure/http/memberHandler.go` — handlers + `classifyMemberError` + routes.
- [x] 3.7 RED: `identity/domain/security/companyContext_test.go` — inject/read `CompanyContext`, missing context returns not-ok.
- [x] 3.8 GREEN: `identity/domain/security/companyContext.go` — `CompanyContext` + ctx helpers.
- [ ] 3.9 RED: `identity/infrastructure/http/requireCompanyRole_test.go` with fake repos — owner passes `minRole=recruiter`; recruiter under `minRole=owner` → 403 handler not invoked; non-member → 403; unknown sub → 401 (spec: RequireCompanyRole, 4 scenarios).
- [ ] 3.10 GREEN: `identity/infrastructure/http/requireCompanyRole.go` — port-only imports, resolves once, injects `CompanyContext`.

## Phase 4: Testing — HTTP Surface & Regression

- [ ] 4.1 RED: route test — `/me/company/*` without `Authorization` → 401, handler not invoked (spec: routes mounted behind auth).
- [ ] 4.2 RED: route test — recruiter calling `POST /me/company/members` → 403 via `RequireCompanyRole("owner")` (spec: mutations enforce owner).
- [ ] 4.3 GREEN: `backend/cmd/api/main.go` — wire member repo/service/handler; mount `/me/company` under `RequireAuth`; `r.With(RequireCompanyRole(...))` per-route (`GET /me/company` ungated, list = recruiter, mutations = owner).
- [ ] 4.4 Run `cd backend && go test ./...` and `make test-integration`; both MUST be green.
- [ ] 4.5 Run `cd backend && go vet ./...` and `gofmt -l .`; zero findings.
- [ ] 4.6 REFACTOR (optional): dedupe error-classification helpers between handler and middleware; re-run 4.4.
