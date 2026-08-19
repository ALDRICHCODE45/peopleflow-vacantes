# Exploration: `candidates`

A new bounded context modeling a candidate's professional profile for vacancy
matching. This is the **first authenticated HTTP slice** in the codebase, and it
will close the `identity` slice's W5 debt (middleware constructed but mounted on
zero routes).

---

## Current State

### Reference slice — `companies` (the pattern to mirror)

Hexagonal vertical slice under `backend/internal/features/companies/`:

| Layer | File | Role / pattern |
|-------|------|----------------|
| domain | `domain/entities/company.go` | Aggregate root `Company`, sentinel errors, `NewCompany(...)` factory. Optional fields as `*T` pointers. `uuid.NewV7()`, `time.Now().UTC()`. |
| domain | `domain/valueobjects/*.go` | One VO per concept (`CompanyName`, `CompanyRfc`, `CompanyStatus`, `CompanySize`, `CompanyDescription`, `FoundedYear`). Each has a constructor that validates and returns a sentinel; enum-style VOs (`CompanyStatus`, `CompanySize`) have `ParseXxx(string)` + `String()`. |
| domain | `domain/repositories/companyRepository.go` | Port interface `CompanyRepository { Create(ctx, *Company) error; GetByID(ctx, id) (*Company, error) }`. |
| application | `application/dtos/createCompanyDto.go` | Raw string/primitive DTO; use case owns VO parsing. |
| application | `application/usecases/companyService.go` | `CompanyService{repository}` + `NewCompanyService(repo)`. |
| application | `application/usecases/createCompany.go` / `getCompany.go` | Use-case methods; validate VOs → build aggregate → persist; delegate reads. |
| infrastructure | `infrastructure/http/handler.go` | `CompanyHandler{service}` + `NewCompanyHandler(service)`, `Routes() chi.Router`, request/response structs with JSON tags, `classifyCreateCompanyError` (domain sentinels → 4xx/409). |
| infrastructure | `infrastructure/postgres/companyRepository.go` | Adapter wrapping `*db.Queries`; `buildCreateParams` (entity → sqlc params, `pgtype` for NULLs), `toEntity` (row → entity, rebuilds VOs), `mapCreateError` (PgError codes → sentinels). Compile-time `var _ repositories.CompanyRepository = (*CompanyRepository)(nil)`. |

sqlc: `backend/db/queries/companies.sql` (`CreateCompany :one`, `GetCompanyByID :one`),
generated into `internal/db` (`package db`, `emit_json_tags`, `emit_interface`,
`sql_package: pgx/v5`, uuid override). Regenerate with `make sqlc`.

Migrations: goose in `backend/db/migrations/0000X_*.sql`. Convention: `-- +goose Up`
/ `-- +goose Down`; named CHECK constraints (`companies_status_check`,
`companies_size_check`); partial unique indexes with `WHERE deleted_at IS NULL`
(`companies_rfc_unique`); soft-delete via `deleted_at TIMESTAMPTZ`. `id UUID PRIMARY KEY`
with **no DB default** — application generates UUID v7. New migration via
`make db-new NAME=add_foo`.

### Identity / auth state

- **`users` table** (`00005_create_users.sql`): `id UUID PK` (no default),
  `cognito_sub TEXT NOT NULL`, `email`, `full_name`, `user_type` (CHECK
  `users_user_type_check` ∈ `candidate|recruiter`), `created_at`/`updated_at`/`deleted_at`.
  Named partial unique indexes `users_cognito_sub_unique` and `users_email_unique`
  (`WHERE deleted_at IS NULL`). **Stable identity**: `cognito_sub` is the Cognito
  bridge (opaque, unique, stable across sessions); `id` is the local relational PK.
- **`security.Verifier` seam** (`identity/domain/security/verifier.go`):
  `Verify(ctx, token) (Claims, error)`; `Claims{Subject, Groups}`; helpers
  `ContextWithClaims` / `ClaimsFromContext`. `Claims.Subject` == JWT `sub` == `cognito_sub`.
- **`RequireAuth`** (`identity/infrastructure/http/middleware.go`):
  `func RequireAuth(verifier security.Verifier) func(http.Handler) http.Handler`.
  Reads `Authorization: Bearer <tok>`, verifies, stores `Claims` in context, else 401.
- **`RSAVerifier`** (`identity/infrastructure/auth/rsa_verifier.go`): **fully
  implemented**, not a stub. `NewRSAVerifier(publicKey jwk.Key, iss, aud)` pins
  alg to RS256 (mitigates HS256 confusion), parses with `jwt.WithKey(jwa.RS256, key)`,
  validates `iss`/`aud`/`exp`, normalizes `cognito:groups`. Already unit-tested
  against an in-memory RSA key (tampered/expired/wrong-iss/wrong-aud/HS256/garbage).

### What is missing to make real RS256 verification work end-to-end

The **only** dead code is in the composition root, not the verifier:

1. `cmd/api/main.go::buildVerifierFromEnv` reads `IDENTITY_JWT_PUBLIC_KEY_PEM`,
   `IDENTITY_JWT_ISSUER`, `IDENTITY_JWT_AUDIENCE`, but then does `_ = auth.RSAVerifier{}`
   and returns `errors.New("JWKS wiring deferred; ...")`. There is **no PEM → jwk.Key
   parsing** anywhere in the codebase (tests use `jwk.FromRaw(&rsa.PublicKey)` from an
   in-memory key). Missing piece: parse the PEM into a `jwk.Key` (jwx v2 `jwk.ParseKey`
   with `jwk.WithPEM(true)`, or manual `pem.Decode` + `x509.ParsePKIXPublicKey` /
   `ParsePKCS1PublicKey` + `jwk.FromRaw`) and call `auth.NewRSAVerifier`.
2. `main.go` calls `_ = identityhttp.RequireAuth(verifier)` — the returned middleware
   is discarded; zero routes are wrapped.
3. `cmd/api/main_test.go::TestRequireAuth_ConstructedButNotMounted` asserts
   `routeReferences == 0`. This structural guard enforces W5 and must be **inverted**
   when we mount the middleware (it would otherwise fail the build).

So closing W5 = (a) implement PEM parsing in `buildVerifierFromEnv`, (b) build the
middleware and attach it via `r.Route(...)`/`r.With(...)`/`r.Group(...)` on the
candidate "my profile" routes, (c) replace the "not mounted" structural test with a
"mounted on candidate routes" assertion, (d) document `IDENTITY_JWT_*` in `.env.example`
(currently absent).

---

## Affected Areas

- `backend/db/migrations/00006_*.sql` — new: `candidate_profiles` + `candidate_languages`
  (child) tables.
- `backend/db/queries/candidates.sql` — new sqlc queries.
- `backend/internal/features/candidates/**` — new slice mirroring `companies`
  (domain / application / infrastructure).
- `backend/cmd/api/main.go` — `buildVerifierFromEnv` PEM parsing; wire candidate
  handler + mount `RequireAuth`.
- `backend/cmd/api/main_test.go` — replace "zero routes" assertion with "mounted"
  assertion.
- `backend/.env.example` — add `IDENTITY_JWT_PUBLIC_KEY_PEM`, `IDENTITY_JWT_ISSUER`,
  `IDENTITY_JWT_AUDIENCE`.
- `backend/internal/features/identity/infrastructure/auth/` (read-only reuse) — the
  verifier is already complete; no change expected here.

---

## Approaches

### 1. Candidate ↔ user ownership

**A. `candidate_profiles.user_id UUID REFERENCES users(id)` (FK on local PK).**

- Pros: proper relational integrity; single source of truth for soft-delete; survives
  `cognito_sub` rotation/migration; joins are indexed on PK; consistent with the
  companies → industries FK pattern already in the codebase.
- Cons: requires a lookup from the JWT `sub` → `users.id` on every request
  (`GetUserByCognitoSub` already exists in identity, so this is one cheap indexed read).
- Effort: Medium (one extra lookup + a resolver in the slice).

**B. `candidate_profiles.cognito_sub TEXT` (denormalized text column, no FK).**

- Pros: zero join/lookup — `Claims.Subject` is already `cognito_sub`.
- Cons: no referential integrity; duplicates the identity key; soft-delete of `users`
  doesn't cascade semantics; drifts if Cognito sub ever rotates; diverges from the FK
  pattern the codebase already uses (`companies.industry_id REFERENCES industries`).
- Effort: Low.

**Recommendation: A.** Store `users.id` as the FK. Resolve `cognito_sub → users.id`
via the existing `identity` `GetUserByCognitoSub` at the edge of the candidate use
case. This keeps the slice relational and matches the existing FK convention.

### 2. Self-service "my profile" ownership flow

The authenticated `sub` (from `RequireAuth`) is resolved to `users.id` once, and every
read/update is scoped `WHERE user_id = $owner` (never by URL id, or by URL id
cross-checked against owner). No IDOR surface: a candidate cannot address another
candidate's profile because the owner id is taken from the token, not the path.

### 3. Profile creation timing

**A. Explicit on sign-up (PostConfirmation also creates a `candidate_profiles` row).**

- Pros: clear lifecycle; no empty-profile edge case; "profile exists" is a stable
  invariant for matching.
- Cons: couples the identity handler to the candidate context; a user created before
  this slice ships has no profile row (backfill needed).

**B. Lazy on first read (GET /me/profile auto-creates a blank profile).**

- Pros: no backfill; sign-up stays untouched.
- Cons: GET becomes a write (side effect); races on concurrent first read; harder to
  reason about.

**Recommendation: A (explicit), but decoupled.** For the MVP, the cleanest split is a
`PUT /me/profile` upsert (`ON CONFLICT (user_id) DO UPDATE`) driven by the candidate
themselves, plus a `GET /me/profile` that returns 404 when no profile exists yet. This
avoids both the backfill problem and the write-on-read surprise. Lazy creation is only
acceptable later if matching needs a guaranteed profile row.

### 4. `candidate_languages` (1:N child)

No existing 1:N exists anywhere in the codebase (companies/industries/users are all
flat). This is the **first** child table, so there is no in-repo pattern to copy; the
closest convention is the flat FK in `companies.industry_id`. Proposed shape:

- `candidate_languages (id UUID PK, profile_id UUID NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE, language TEXT NOT NULL, proficiency TEXT NOT NULL CHECK (proficiency IN (...)), ...)`.
- `proficiency` as a VO enum (`LanguageProficiency`) mirroring `CompanySize`/`UserType`
  (closed set, `ParseXxx` + `String()`), backed by a named DB CHECK.
- Update = replace-all-in-a-transaction (`DELETE` then bulk `INSERT`) scoped to the
  owning profile, inside the same `pgx.Tx` as the profile update. sqlc `:many`/`:exec`
  queries; a `Querier` interface seam in the postgres adapter (mirroring identity's
  `Querier`) for testability.

### 5. Auth slice scope (minimal to close W5)

Minimal set of work: (1) `buildVerifierFromEnv` PEM parsing → `auth.NewRSAVerifier`;
(2) mount `RequireAuth` on candidate "my profile" routes via `r.Route`/`r.With`;
(3) invert `TestRequireAuth_ConstructedButNotMounted` into a "mounted" assertion;
(4) document `IDENTITY_JWT_*` in `.env.example`. No change to `RSAVerifier` itself.

---

## Recommendation

Build the `candidates` slice as a faithful mirror of `companies`:

1. **Ownership via `users.id` FK** (approach 1A), resolving `cognito_sub → users.id`
   with the existing identity `GetUserByCognitoSub`.
2. **Self-service profile** under `GET/PUT /me/profile` (and
   `GET/PUT /me/profile/languages`), all owner-scoped from the token.
3. **`candidate_languages`** as the first 1:N child table with a
   replace-all-in-transaction update and a `LanguageProficiency` VO enum.
4. **Profile creation explicitly via upsert** on PUT (no lazy-on-read side effect,
   no backfill).
5. **Close W5 in this same change**: PEM parsing + real `RequireAuth` mounting + invert
   the structural test, since `candidates` is the natural first consumer of the
   middleware.

## Risks

- **First 1:N table** — no in-repo pattern; transaction/replace-all semantics must be
  spelled out in the design phase.
- **Inverting the `main.go` structural test** — the current `routeReferences == 0`
  assertion is a hard guard; forgetting to update it breaks CI.
- **PEM format variance** (PKCS#1 `RSA PUBLIC KEY` vs PKIX `PUBLIC KEY`) — the parser
  must accept both or fail loudly with a clear message.
- **`cognito_sub → users.id` lookup latency/absence** — `GetUserByCognitoSub` returns
  `ErrUserNotFound` for unknown subs; the candidate use case must map that to 401/404
  cleanly rather than leaking a 500.
- **`lestrrat-go/jwx/v2` is deprecated upstream** (already flagged in the identity
  archive) — reuse is fine, but note the future migration to v3/v4.

## Ready for Proposal

Yes. Recommend the orchestrator advance to `sdd-propose` for the `candidates` change,
scoping it to: `candidate_profiles` + `candidate_languages` schema, the self-service
"my profile" endpoints, and the W5-closing auth wiring (PEM verifier + mounted
middleware).
