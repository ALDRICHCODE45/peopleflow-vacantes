# Tasks: Identity Bounded Context

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1300–1600 (auth slice + tests + sqlc regen) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes (informational) |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

## Phase 1: Database Foundation

- [x] 1.1 Add `lestrrat-go/jwx/v2 v2.1.7` via `go get`.
- [x] 1.2 Write `db/migrations/00005_create_users.sql` (up+down; named CHECK `users_user_type_check`; partial unique `users_cognito_sub_unique`/`users_email_unique` `WHERE deleted_at IS NULL`). `00005_integration_test.go` (`//go:build integration`) proves Spec "up creates named objects" and "down drops table and indexes".
- [x] 1.3 Write `db/queries/users.sql` (`CreateUser :one` upsert `WHERE deleted_at IS NULL` on conflict target; `GetUserByID`, `GetUserByCognitoSub` filter `deleted_at IS NULL`); `sqlc generate`.

## Phase 2: Domain Layer

- [x] 2.1 RED-first `valueobjects/email_test.go` table-drives reject set (`""`, `"   "`, `"foo"`, `"foo@"`, `"@bar.com"`, `"foo@bar"`, `"two@@ats.com"`, `"space in@addr.com"`) → `ErrInvalidEmail`; green `email.go` trims+lowercases, `net/mail.ParseAddress`, domain has `.`.
- [x] 2.2 RED-first `fullName_test.go` proves `< 2 chars` → `ErrFullNameTooShort`.
- [x] 2.3 RED-first `userType_test.go` proves `"admin"` → `ErrInvalidUserType`; `UserCandidate`/`UserRecruiter` accepted.
- [x] 2.4 RED-first `entities/user_test.go` proves UUID v7 non-zero, `CreatedAt == UpdatedAt` within 1s UTC, empty sub → `ErrEmptyCognitoSub`. Spec "factory populates id and timestamps".
- [x] 2.5 RED-first `entities/sentinels_test.go` proves all six pairwise distinct via `errors.Is`. Spec "sentinels are pairwise distinct".
- [x] 2.6 RED-first `repositories/userRepository_test.go` pins port: `Create`/`GetByID`/`GetByCognitoSub`.
- [x] 2.7 RED-first `security/verifier_test.go` pins `Verifier` + `Claims{Subject, Groups}`.

## Phase 3: Postgres Adapter

- [x] 3.1 RED-first `infrastructure/postgres/mapCreateError_test.go` synthesizes `*pgconn.PgError{Code:"23505", ConstraintName:...}` (both branches) + wrapped `pgx.ErrNoRows` + pass-through; proves Spec "23505 branches on ConstraintName" + "ErrNoRows maps to ErrUserNotFound".
- [x] 3.2 RED-first `infrastructure/postgres/userRepository_test.go` exercises `buildCreateParams`/`toEntity` + adapter wraps sqlc `Querier` with `mapCreateError`.

## Phase 4: Use Cases

- [x] 4.1 RED-first `application/usecases/createUser_test.go` proves Spec "CreateUser short-circuits on bad VO" + happy path (stub repo).
- [x] 4.2 RED-first `application/usecases/getUserByID_test.go` proves Spec "GetUserByID propagates ErrUserNotFound" (stub repo).

## Phase 5: PostConfirmation

- [x] 5.1 RED-first `application/post_confirmation_test.go` uses `t.Setenv("IDENTITY_POSTCONFIRMATION_ENABLED", ...)`, stub repo. Proves Spec "group mapping and env-flag gating" (`candidates`→`UserCandidate`, `recruiters`/`company_admins`→`UserRecruiter`, no-match→skip) + Spec "repeated delivery leaves one row".

## Phase 6: Auth Infrastructure

- [x] 6.1 RED-first `infrastructure/auth/rsa_verifier_test.go` + `TestMain` generate 2048-bit `*rsa.PrivateKey`; `signToken(t, claims)` helper. Proves valid verifies; tampered (flipped sig byte) / expired / wrong `iss` / wrong `aud` / HS256 (sign with RSA pubkey as HMAC secret) all rejected.
- [x] 6.2 RED-first `infrastructure/http/middleware_test.go` wraps handler with `RequireAuth(rsaVerifier)`. Proves Spec "valid token populates claims" (`sub`+`cognito:groups` in ctx) + Spec "invalid cases return 401".

## Phase 7: Composition Root

- [x] 7.1 RED-first `cmd/api/main_test.go` uses `go/ast` to assert `RequireAuth` constructor called AND no `chi` `Use`/`With`/`Group`/`Mount`/`Route` arg references it. Proves Spec "zero routes wrapped".
- [x] 7.2 Wire identity in `cmd/api/main.go`: construct `RequireAuth(verifier)`, attach to chi router, mount zero routes; 7.1 re-runs green.

## Phase 8: Verification

- [x] 8.1 `cd backend && go test ./...` green; `go vet ./...` clean; `go build ./...` clean. `-tags=integration` covers goose up/down + idempotent re-delivery.