# Design: Candidates — self-service profile

## Technical Approach

Mirror the `companies` hexagonal slice for `candidates` (domain VOs + entity, application use cases + DTOs, http + postgres adapters). Add migration `00006` (§3.3/§3.4), sqlc `candidates.sql`, finish `buildVerifierFromEnv`, and mount `RequireAuth` on `/me/*`. Owner id resolves from JWT `sub` → `users.id` at the use-case edge; never from URL/body.

## Architecture Decisions

| # | Decision | Choice | Alternatives (rejected) | Rationale |
|---|---|---|---|---|
| 1 | Slice layout | Mirror `companies` exactly (`domain/entities`, `domain/valueobjects`, `domain/repositories`, `application/usecases`, `application/dtos`, `infrastructure/http`, `infrastructure/postgres`) | Flat package; reuse companies types | Port lives in `domain/repositories` (matches `companyRepository.go`); consistency wins, no cross-feature reuse |
| 2 | Ownership | `candidate_profiles.user_id UUID PK REFERENCES users(id)` (1:1); resolve `cognito_sub`→`users.id` via existing identity `repositories.UserRepository.GetByCognitoSub` at the use-case edge | Denormalized `cognito_sub` on candidate tables | FK keeps single source of truth (§1.5); denormalizing risks drift on sub rotation |
| 3 | sqlc surface | `UpsertProfile` (`INSERT … ON CONFLICT (user_id) DO UPDATE`), `GetProfileByUserID`, `ListLanguagesByUserID`, `DeleteLanguagesByUserID`, `InsertLanguage`; atomic replace over `pgx.Tx` in the adapter | Single CTE replace; `:copyfrom` batch | Explicit, testable tx; adapter holds `*pgxpool.Pool` (builds `db.New(pool)`/`db.New(tx)`) because `*db.Queries` has no `Begin` |
| 4 | PEM parsing | `jwk.ParseKey([]byte(pem), jwk.WithPEM(true))` then `auth.NewRSAVerifier` | Manual `x509.ParsePKCS1/PKIX` switch | `WithPEM(true)` accepts PKCS#1 + PKIX; minimal completion of the stubbed path |
| 5 | Route mount | `r.Route("/me", func(r chi.Router){ r.Use(identityhttp.RequireAuth(v)); r.Mount("/profile", candidateHandler.Routes()) })` | Global `r.Use` | Scoped to `/me/*`; handler defines `/` and `/languages/`. No `{id}` segment → path-id IDOR structurally impossible |
| 6 | W5 inversion | `main_test.go` asserts `routeReferences >= 1` (`TestRequireAuth_MountedOnMeRoutes`); same PR as mount | Separate PRs | Guard + consumer must move atomically |
| 7 | Error mapping | `ErrUnknownSubject`→401; VO errors (education/salary/CEFR)→400; `ErrProfileNotFound`→404; duplicate language→400 | Leak pgx SQLSTATE | Domain sentinels, HTTP layer maps via `errors.Is` |
| 8 | `skills` | lower-case + trim in Go before write | DB trigger/SQL normalize | §3.3 note; GIN needs canonical form |
| 9 | `search_vector` | STORED generated column + GIN index in `00006`; zero app code | App-maintained tsvector | Postgres owns it (§1.8/§3.3) |

## Data Flow

```
Client ──> RequireAuth (verify JWT → Claims{sub}) ──> candidate handler
   handler: sub := security.ClaimsFromContext(r.Context()).Subject
   use case: userID = identityRepo.GetByCognitoSub(sub)  // ErrUserNotFound → ErrUnknownSubject
             └─ profile/languages ops keyed by userID
   postgres adapter: db.New(pool) | db.New(tx) for replace
```

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/db/migrations/00006_create_candidate_profiles.sql` | Create | `candidate_profiles` + `candidate_languages`, CHECKs, GIN/B-tree indexes, STORED `search_vector` |
| `backend/db/queries/candidates.sql` | Create | 5 sqlc queries (see decision 3) |
| `backend/internal/features/candidates/domain/entities/*` | Create | `CandidateProfile` + `Language`; sentinels |
| `backend/internal/features/candidates/domain/valueobjects/*` | Create | `EducationLevel`, `SalaryPeriod`, `CefrLevel` + `NormalizeSkills` |
| `backend/internal/features/candidates/domain/repositories/candidateRepository.go` | Create | Port (4 methods) |
| `backend/internal/features/candidates/application/{dtos,usecases}/*` | Create | DTOs + `CandidateService` + 4 use cases |
| `backend/internal/features/candidates/infrastructure/http/handler.go` | Create | `CandidateHandler` + routes |
| `backend/internal/features/candidates/infrastructure/postgres/candidateRepository.go` | Create | Adapter over `*pgxpool.Pool`; tx replace + `mapCreateError` |
| `backend/cmd/api/main.go` | Modify | Finish `buildVerifierFromEnv`; wire `identityRepo` + candidates; mount `/me` |
| `backend/cmd/api/main_test.go` | Modify | Invert W5 guard |
| `backend/.env.example` | Modify | Add `IDENTITY_JWT_*` |
| `backend/internal/db/*` | Regenerate | `make sqlc` |

## Interfaces / Contracts

```go
// buildVerifierFromEnv — PKCS#1 and PKIX both accepted.
key, err := jwk.ParseKey([]byte(pubPEM), jwk.WithPEM(true))
if err != nil { return nil, fmt.Errorf("parse IDENTITY_JWT_PUBLIC_KEY_PEM: %w", err) }
return auth.NewRSAVerifier(key, issuer, audience)
```

```go
// ReplaceLanguagesByUserID — atomic 1:N replace in one tx.
tx, err := r.pool.Begin(ctx)
if err != nil { return err }
defer tx.Rollback(ctx) // no-op after Commit
q := r.queries.WithTx(tx)
if err := q.DeleteLanguagesByUserID(ctx, userID); err != nil { return err }
for _, l := range langs {
    if err := q.InsertLanguage(ctx, buildInsertParams(userID, l)); err != nil { return err }
}
return tx.Commit(ctx)
```

## Testing Strategy (RED-first, `strict_tdd: true`)

| Layer | What | Approach |
|---|---|---|
| Unit (domain) | VO parse/reject, `NormalizeSkills`, entity constructor | table-driven; no DB |
| Unit (usecase) | sub→id resolution, no-IDOR, error propagation, dup-language 400 | fake `CandidateRepository` + `UserRepository` |
| Integration (`//go:build integration`) | migration CHECK/index; upsert idempotency; atomic replace | `pgxpool` via `make test-integration` |
| Structural | ≥1 `RequireAuth` route reference | AST guard (inverted) |

## Threat Matrix

N/A — no shell, subprocess, executable-file classification, or VCS/PR automation boundary. The only boundary touched is chi HTTP middleware routing (`RequireAuth` over `/me/*`), which the matrix does not cover; rows are recorded N/A and no tasks are manufactured.

## Migration / Rollout

`00006` reversible via `goose down`; no data migration (greenfield). Rollback: revert mount + W5 test + drop `IDENTITY_JWT_*` (see proposal).

## Open Questions

- [ ] `PUT /me/profile` response shape: 200 empty vs. persisted row echo (self-service, no redaction needed) — minor, non-blocking.
