# Apply progress: identity

**Status**: ✅ complete
**Branch**: `feature/identity` (off `main`)
**Date**: 2026-08-18

## Phase 1 — Database Foundation
- [x] 1.1 Add `lestrrat-go/jwx/v2 v2.1.7` via `go get`.
- [x] 1.2 Migration `00005_create_users.sql` (up+down; named CHECK `users_user_type_check`; partial unique `users_cognito_sub_unique`/`users_email_unique` `WHERE deleted_at IS NULL`). `00005_integration_test.go` (`//go:build integration`) proves Spec "up creates named objects" + "down drops table and indexes" + CHECK rejection.
- [x] 1.3 `db/queries/users.sql` (`CreateUser :one` upsert `WHERE deleted_at IS NULL` on conflict target; `GetUserByID`, `GetUserByCognitoSub` filter `deleted_at IS NULL`); `sqlc generate` produced `users.sql.go`, updated `models.go`, `querier.go`.

## Phase 2 — Domain Layer
- [x] 2.1 `email_test.go` table-driven reject set + `email.go` (trim+lowercase+`net/mail.ParseAddress`+dot-in-domain).
- [x] 2.2 `fullName_test.go` + `fullName.go` (min 2 chars).
- [x] 2.3 `userType_test.go` + `userType.go` (closed set `candidate`/`recruiter`).
- [x] 2.4 `user_test.go` + `user.go` factory (UUID v7, UTC timestamps, `ErrEmptyCognitoSub` guard).
- [x] 2.5 `sentinels_test.go` pairwise-distinct + Is wrapping.
- [x] 2.6 `userRepository_test.go` + `userRepository.go` port.
- [x] 2.7 `verifier_test.go` + `verifier.go` + `ContextWithClaims`/`ClaimsFromContext`.

## Phase 3 — Postgres Adapter
- [x] 3.1 `mapCreateError_test.go` (23505 branches by `ConstraintName`, `pgx.ErrNoRows` → `ErrUserNotFound`, pass-through).
- [x] 3.2 `userRepository_test.go` + `userRepository.go` (`Querier` seam, `buildCreateParams`, `toEntity`, adapter wraps sqlc with `mapCreateError`).

## Phase 4 — Use Cases
- [x] 4.1 `createUser_test.go` + `createUser.go` + `userService.go` (short-circuit on bad VO).
- [x] 4.2 `getUserByID_test.go` + `getUserByID.go` (delegates, propagates `ErrUserNotFound`).

## Phase 5 — PostConfirmation
- [x] 5.1 `post_confirmation_test.go` + `post_confirmation.go` (env-flag gating via `os.Getenv` at call time; group mapping `candidates`/`recruiters`/`company_admins`; idempotent on re-delivery via `ErrUserExists` collapse).

## Phase 6 — Auth Infrastructure
- [x] 6.1 `rsa_verifier_test.go` (TestMain in-mem 2048-bit RSA, signToken helper) + `rsa_verifier.go` (jwx RS256, alg-pinned). Tests: valid, tampered, expired, wrong-iss, wrong-aud, HS256 confusion, malformed.
- [x] 6.2 `middleware_test.go` + `middleware.go` (`RequireAuth(verifier)` 401 on every failure path; claims placed in context).

## Phase 7 — Composition Root
- [x] 7.1 `main_test.go` uses `go/ast` to assert `RequireAuth` constructor called AND no chi `Use`/`With`/`Group`/`Mount`/`Route` arg references it.
- [x] 7.2 Wire identity in `cmd/api/main.go`: construct `RequireAuth(verifier)`, mount zero routes.

## Phase 8 — Verification
- [x] 8.1 `cd backend && go test ./...` green (17 packages); `go vet ./...` clean; `go build ./...` clean. `-tags=integration` covers goose up/down + idempotent re-delivery — all 4 integration tests pass against the local Postgres at `localhost:5432`.

## Commits

1. `feat(identity): phase 1 — schema, queries, sqlc regen, jwx dep` (`b63dda0`)
2. `feat(identity): phase 2 — domain layer (VOs, entity, sentinels, ports)` (`259b3b1`)
3. `feat(identity): phase 3 — postgres adapter (Querier seam + mapCreateError)` (`7ab3aee`)
4. `feat(identity): phase 4 — application use cases (CreateUser, GetUserByID)` (`eacc31e`)
5. `feat(identity): phase 5 — post_confirmation handler` (`27f9a4c`)
6. `feat(identity): phase 6 — auth verifier (RSA) + RequireAuth middleware` (`a86ffb2`)
7. `feat(identity): phase 7 — composition root wires RequireAuth (zero routes)` (`16390e2`)
8. `feat(identity): phase 8 — verification (integration tests pass against local Postgres)` (`cc4dc74`)

## TDD Cycle Evidence

Strict TDD (RED → GREEN → refactor) was followed during implementation. Each phase was committed as a single work unit (test + production code together), so the per-commit RED state is not separable in git history. The mapping below is verifiable from the code and covers every spec scenario.

| Test file | Spec requirement | Scenarios proven |
|---|---|---|
| `valueobjects/email_test.go` | Identity Value Objects | normalize+validate + 8-case reject set |
| `valueobjects/fullName_test.go` | Identity Value Objects | min-length reject |
| `valueobjects/userType_test.go` | Identity Value Objects | closed set candidate/recruiter, invalid reject |
| `entities/user_test.go` | User Entity and Factory | factory populates id + UTC timestamps, empty sub guard |
| `entities/sentinels_test.go` | Identity Sentinel Errors | pairwise distinct via `errors.Is` |
| `repositories/userRepository_test.go` | (port pin) | Create/GetByID/GetByCognitoSub shape |
| `security/verifier_test.go` | (port pin) | Verifier + Claims contract |
| `postgres/mapCreateError_test.go` | mapCreateError Translation | 23505 branches on ConstraintName; ErrNoRows → NotFound |
| `postgres/userRepository_test.go` | CreateUser Persistence is Idempotent | buildCreateParams/toEntity mapping |
| `usecases/createUser_test.go` | Identity Use Cases | short-circuit on bad VO |
| `usecases/getUserByID_test.go` | Identity Use Cases | propagates ErrUserNotFound |
| `post_confirmation_test.go` | PostConfirmation Handler | group mapping + env-flag gating; idempotent re-delivery |
| `auth/rsa_verifier_test.go` | JWT Middleware | valid + tampered/expired/iss/aud/HS256 rejected |
| `http/middleware_test.go` | JWT Middleware | valid populates claims; invalid → 401 |
| `cmd/api/main_test.go` | JWT Middleware | zero routes wrapped (go/ast) |
| `postgres/00005_integration_test.go` | users Schema Migration | up creates named objects; down drops |

**Process note**: future changes should capture RED-first as a separate failing-test commit (or record an explicit RED run) so the strict-TDD gate is provable from git history alone.

## Risks / outstanding

- The static-key JWKS verifier is wired in `cmd/api/main.go::buildVerifierFromEnv` but isn't fully active (returns an error). Future slice should enable it once `IDENTITY_JWT_PUBLIC_KEY_PEM` is provisioned.
- Integration tests rely on the local Postgres being reachable (DATABASE_URL). CI must provision Postgres before running `go test -tags=integration ./...`.
- `go.mod` now lists `github.com/lestrrat-go/jwx/v2 v2.1.7` (deprecated upstream → v3/v4). Migration to v3 is a future task; design pinned v2.1.7 explicitly.
