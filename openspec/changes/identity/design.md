# Design: `identity` bounded context

## Technical Approach

Mirror the `companies` slice: domain (`entities`, `valueobjects`, `repositories`, `security`) → application (use cases + `PostConfirmation`) → infrastructure (`postgres`, `auth`, `http`). Cognito owns auth; `users.cognito_sub` is the bridge. No public HTTP routes; the JWT middleware is constructed but mounted on zero routes.

## Architecture Decisions

### Decision 1 — JWT library

| Criterion | golang-jwt/jwt/v5 | lestrrat-go/jwx/v2 |
|---|---|---|
| RS256 + alg pinning | yes | yes (`jwa.RS256`) |
| JWKS + `kid` + rotation + cache | manual (hand-roll resolver+cache) | built-in `jwk.Cache` (refresh, `kid` lookup) |
| Binary footprint | minimal, 1 module | larger graph (~2–3 MB) |
| Already in graph | v4 (indirect, via goose) | no |

**Choice**: `lestrrat-go/jwx/v2` (v2.1.7). **Rationale**: JWKS + `kid` + rotation + caching is the highest-risk part of JWT verification, and jwx ships it battle-tested. Footprint is acceptable for a backend monolith; dependency risk low (actively maintained). golang-jwt v5 is simpler but forces hand-rolling the JWKS resolver — rejected for a security boundary.

### Decision 2 — Verifier/KeyProvider seam

`domain/security` defines the port; the middleware depends only on it. Dev (static RSA key) and prod (Cognito JWKS) swap at `cmd/api` wiring, not in the middleware.

```go
package security

type Claims struct {
    Subject string   // JWT `sub`
    Groups  []string // `cognito:groups`
}

// Verifier validates an RS256 bearer token, returning normalized claims.
// Dev: static local RSA public key. Prod: Cognito JWKS (kid + cache + rotation).
type Verifier interface {
    Verify(ctx context.Context, token string) (Claims, error)
}
```

### Decision 3 — Local dev RSA key (deterministic fixture)

`TestMain` generates a 2048-bit `*rsa.PrivateKey` in-memory; no committed key file. `signToken(t, claims)` signs with the private key; the verifier wraps `&key.PublicKey`. Invalid cases mutate fields (tamper = flip a signature byte; HS256 = sign with the RSA public key as HMAC secret).

### Decision 4 — sqlc idempotent upsert

```sql
-- name: CreateUser :one
INSERT INTO users (id, cognito_sub, email, full_name, user_type)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (cognito_sub) WHERE deleted_at IS NULL DO NOTHING
RETURNING *;
```

`WHERE deleted_at IS NULL` is **required**: Postgres cannot infer a partial unique index from a bare `ON CONFLICT (cognito_sub)` (raises 42P10). `RETURNING *` returns zero rows on conflict → `pgx.ErrNoRows`; the adapter re-fetches by `cognito_sub`. `GetUserByID`/`GetUserByCognitoSub` filter `deleted_at IS NULL`.

### Decision 5 — mapCreateError

```go
func mapCreateError(err error) error {
    var pgErr *pgconn.PgError
    if errors.As(err, &pgErr) && pgErr.Code == "23505" {
        switch pgErr.ConstraintName {
        case "users_cognito_sub_unique": return entities.ErrUserExists
        case "users_email_unique":       return entities.ErrEmailTaken
        }
    }
    if errors.Is(err, pgx.ErrNoRows) { return entities.ErrUserNotFound }
    return err
}
```

Migration MUST name constraints `users_cognito_sub_unique` / `users_email_unique`. The sub branch is defensive (the upsert swallows it); the email branch is live (new sub, existing email). `ErrNoRows → ErrUserNotFound` serves the two `Get` methods.

### Decision 6 — PostConfirmation handler

Pure Go in `application/post_confirmation.go`. Minimal event struct reads `request.userAttributes.sub/.email/.name`; `cognito:groups` from `userAttributes["cognito:groups"]` (JSON-array or comma-separated). First matched group maps `candidates → UserCandidate`, `recruiters`/`company_admins → UserRecruiter`; no match → skip + log. `IDENTITY_POSTCONFIRMATION_ENABLED` read via `os.Getenv` **at call time** (not package init), so `t.Setenv` works. Idempotency inherited from `CreateUser`.

### Decision 7 — Zero-routes guarantee

`go/ast` test parses `cmd/api/main.go`: assert the middleware constructor is called, then walk every `chi` `Use`/`With`/`Group`/`Mount`/`Route` call and fail if any argument references that identifier. RED-first: fails on "not constructed", green once constructed-but-unmounted.

## Data Flow (PostConfirmation)

```
Cognito → PostConfirmation.Handle
  ├─ env flag disabled? return nil
  ├─ extract sub/email/name + groups → UserType
  └─ CreateUser → NewUser(VO validation) → repo.Create
       └─ INSERT..DO NOTHING ──conflict──▶ ErrNoRows ─▶ GetByCognitoSub → existing
```

## File Changes

| File | Action | Description |
|---|---|---|
| `db/migrations/00005_create_users.sql` | Create | `users` + named CHECK + 2 partial unique indexes |
| `db/queries/users.sql` | Create | `CreateUser`, `GetUserByID`, `GetUserByCognitoSub` |
| `internal/db/` | Modify | sqlc regen (`users.sql.go`, `models.go`, `querier.go`) |
| `internal/features/identity/domain/entities/user.go` | Create | `User` + `NewUser` + sentinels |
| `internal/features/identity/domain/valueobjects/{email,fullName,userType}.go` | Create | VOs |
| `internal/features/identity/domain/repositories/userRepository.go` | Create | port (`Create` returns `*User`) |
| `internal/features/identity/domain/security/verifier.go` | Create | `Verifier` + `Claims` |
| `internal/features/identity/application/usecases/{userService,createUser,getUserByID}.go` | Create | use cases |
| `internal/features/identity/application/post_confirmation.go` | Create | Lambda handler |
| `internal/features/identity/infrastructure/postgres/userRepository.go` | Create | sqlc adapter + `mapCreateError` |
| `internal/features/identity/infrastructure/auth/rsa_verifier.go` | Create | jwx `Verifier` over static key |
| `internal/features/identity/infrastructure/http/middleware.go` | Create | `RequireAuth(verifier)` middleware |
| `cmd/api/main.go` | Modify | wire identity; construct middleware, mount nothing |
| `go.mod` / `go.sum` | Modify | add `lestrrat-go/jwx/v2` |

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit (domain) | VOs reject set, `NewUser`, sentinel distinctness | table-driven RED tests |
| Unit (application) | short-circuit, group mapping, env-flag gating | stub repo; `t.Setenv` per subtest |
| Unit (adapter) | `mapCreateError` branches on `ConstraintName` | synthetic `*pgconn.PgError` |
| Unit (middleware) | valid token populates ctx; tampered/expired/iss/aud/HS256 → 401 | in-memory RSA fixture + `signToken` |
| Structural | zero routes mounted | `go/ast` walk of `main.go` |
| Integration | goose up/down, idempotent re-delivery | 1 row after 2 calls |

Malformed `Email` reject set: `""`, `"   "`, `"foo"`, `"foo@"`, `"@bar.com"`, `"foo@bar"`, `"two@@ats.com"`, `"space in@addr.com"` (validator: trim+lowercase, `net/mail.ParseAddress`, non-empty local/domain, domain contains `.`).

## Threat Matrix

`N/A` — no shell, subprocess, VCS/PR automation, or executable-file classification boundary. The auth boundary's adversarial cases (tampered, expired, wrong `iss`/`aud`, HS256) are covered by the middleware RED tests and carry into `tasks.md` unchanged.

## Migration / Rollout

No data migration. `goose up`/`down` handle `00005`. Rollback per proposal.

## Open Questions

- [ ] Exact `cognito:groups` wire format at trigger time (array vs serialized) — confirm against real Cognito before prod; deferred.
- [ ] Dev public key source: `JWT_DEV_PUBLIC_KEY_PEM` env var (proposed) vs local file.
