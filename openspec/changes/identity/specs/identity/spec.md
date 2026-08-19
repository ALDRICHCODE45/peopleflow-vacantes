# Identity Specification

Owns `users` in Postgres, the Cognito→backend bridge via `users.cognito_sub`, and the RS256 JWT middleware every future authenticated route will consume.

## ADDED Requirements

### Requirement: users Schema Migration

`00005_create_users.sql` MUST create `users` (`id UUID PK`, `cognito_sub`/`email`/`full_name` TEXT NOT NULL, `user_type TEXT` constrained by named CHECK `users_user_type_check` to `'candidate'|'recruiter'`, `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `deleted_at TIMESTAMPTZ NULL`). `id` has no DB default — application generates UUID v7. Named partial unique indexes `users_cognito_sub_unique` and `users_email_unique` MUST use predicate `WHERE deleted_at IS NULL`. `goose down` MUST reverse.

#### Scenario: up creates named objects

- GIVEN DB at `00004`
- WHEN `goose up` runs `00005`
- THEN `users`, `users_user_type_check`, and both partial indexes exist

#### Scenario: down drops table and indexes

- GIVEN `00005` applied
- WHEN `goose down` runs
- THEN `users` and its indexes are gone

---

### Requirement: Identity Value Objects

`NewEmail` MUST trim, lowercase, reject empty/malformed with `ErrInvalidEmail`. `NewFullName` MUST trim, reject < 2 chars with `ErrFullNameTooShort`. `UserType` is an enum with constants `UserCandidate`/`UserRecruiter`; `NewUserType` MUST reject others with `ErrInvalidUserType`. All immutable.

#### Scenario: email normalizes; name/type reject bad input

- GIVEN `"  Alice@Example.COM  "`, `NewFullName("A")`, `NewUserType("admin")`
- WHEN each constructor runs
- THEN email value is `"alice@example.com"` and the other two return their respective sentinels

---

### Requirement: User Entity and Factory

`NewUser(cognitoSub, email, fullName, userType)` MUST validate each VO, generate `id` via UUID v7, set `CreatedAt`/`UpdatedAt` to UTC now, return `ErrEmptyCognitoSub` on empty sub.

#### Scenario: factory populates id and timestamps

- GIVEN valid inputs
- WHEN `NewUser` runs
- THEN `id` is a non-zero UUID v7 and `CreatedAt == UpdatedAt` within 1s of UTC now

---

### Requirement: Identity Sentinel Errors

The domain MUST export distinct sentinels `ErrEmptyCognitoSub`, `ErrInvalidEmail`, `ErrFullNameTooShort`, `ErrInvalidUserType`, `ErrUserNotFound`, `ErrUserExists`, `ErrEmailTaken`, all usable with `errors.Is`.

#### Scenario: sentinels are pairwise distinct

- GIVEN any pair of listed sentinels
- WHEN compared with `errors.Is`
- THEN the comparison is false

---

### Requirement: CreateUser Persistence is Idempotent

`CreateUser` MUST issue `INSERT ... ON CONFLICT (cognito_sub) DO NOTHING RETURNING *`. On conflict the adapter MUST re-fetch by `cognito_sub` and return the existing entity with no error.

#### Scenario: first call inserts one row

- GIVEN no row for `cognito_sub = "abc"`
- WHEN `CreateUser` runs
- THEN one row is persisted and returned

#### Scenario: repeated call is a no-op

- GIVEN existing row for `cognito_sub = "abc"`
- WHEN `CreateUser` runs again
- THEN no second row is inserted and no error is returned

---

### Requirement: User Reads

`GetUserByID(ctx, id)` and `GetUserByCognitoSub(ctx, sub)` MUST return the matching `*User` for live rows or `ErrUserNotFound` otherwise. `deleted_at IS NOT NULL` rows count as not found.

#### Scenario: hit returns user; miss returns sentinel

- GIVEN a live row for the lookup key OR no live row for it
- WHEN the read runs
- THEN result is the matching `*User` OR `ErrUserNotFound`

---

### Requirement: mapCreateError Translation

`mapCreateError` MUST translate: `*pgconn.PgError{Code:"23505", ConstraintName:"users_cognito_sub_unique"}` → `ErrUserExists`; same with `"users_email_unique"` → `ErrEmailTaken`; wrapped `pgx.ErrNoRows` → `ErrUserNotFound`; otherwise pass-through.

#### Scenario: 23505 branches on ConstraintName

- GIVEN `23505` on `users_cognito_sub_unique` OR on `users_email_unique`
- WHEN `mapCreateError` runs
- THEN result is `ErrUserExists` OR `ErrEmailTaken` respectively

#### Scenario: ErrNoRows maps to ErrUserNotFound

- GIVEN an error wrapping `pgx.ErrNoRows`
- WHEN `mapCreateError` runs
- THEN `errors.Is(result, ErrUserNotFound)` is true

---

### Requirement: Identity Use Cases

`CreateUser` MUST validate VOs, build via `entities.NewUser`, persist, return entity. `GetUserByID` MUST delegate and propagate `ErrUserNotFound`. Neither MUST be exposed via HTTP in this slice.

#### Scenario: CreateUser short-circuits on bad VO

- GIVEN empty `email`
- WHEN `CreateUser` runs
- THEN `ErrInvalidEmail` is returned and the repository is not invoked

#### Scenario: GetUserByID propagates ErrUserNotFound

- GIVEN repo returns `ErrUserNotFound`
- WHEN `GetUserByID` runs
- THEN result satisfies `errors.Is(err, ErrUserNotFound)`

---

### Requirement: PostConfirmation Handler

`application/identity/post_confirmation.go` MUST read `request.userAttributes.sub/.email/.name`; map first matched group (`candidates` → `UserCandidate`; `recruiters`/`company_admins` → `UserRecruiter`); invoke `CreateUser`. When `IDENTITY_POSTCONFIRMATION_ENABLED` is unset or `"false"`, MUST short-circuit without invoking `CreateUser`.

#### Scenario: group mapping and env-flag gating

- GIVEN env flag `"true"` with groups `["candidates"]` or `["recruiters"]`/`["company_admins"]`, OR env flag unset
- WHEN the handler runs
- THEN `CreateUser` is invoked with the matching `UserType` OR is not invoked (no error)

#### Scenario: repeated delivery leaves one row

- GIVEN env flag `"true"` and the same `sub` delivered twice sequentially
- WHEN both invocations run
- THEN `SELECT COUNT(*) FROM users WHERE cognito_sub = <sub>` returns `1` and both return no error

---

### Requirement: JWT Middleware

The middleware MUST verify an RS256-signed JWT against the configured key source (local dev key in this slice; JWKS deferred), validate `iss`/`aud`/`exp`, place `sub` and `cognito:groups` into the request context, reject with 401 on tampered signature / past `exp` / wrong `iss` / wrong `aud` / non-RS256 algorithm, and MUST be registered in `cmd/api/main.go` but NOT attached to any route in this slice.

#### Scenario: valid token populates claims

- GIVEN a token signed with the configured dev RSA key, correct `iss`/`aud`, future `exp`
- WHEN the middleware processes the request
- THEN the downstream handler runs and reads `sub` and `cognito:groups` from context

#### Scenario: invalid cases return 401

- GIVEN tampered signature OR past `exp` OR wrong `iss` OR wrong `aud` OR HS256 algorithm
- WHEN the middleware processes the request
- THEN response is `401` and the handler is not invoked

#### Scenario: zero routes wrapped

- GIVEN a static scan of `main.go`
- WHEN every `chi.Mount`/`With`/`Use` is checked
- THEN zero routes pass through the JWT middleware