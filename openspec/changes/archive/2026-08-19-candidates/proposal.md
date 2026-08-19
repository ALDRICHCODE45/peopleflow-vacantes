# Proposal: Candidates — self-service profile, first authenticated HTTP slice

## Intent

Ship the first authenticated HTTP slice (`GET/PUT /me/profile`, `GET/PUT /me/profile/languages`) per `docs/modelo-de-datos-proyecto-04.md` §3.3/§3.4. Closes W5 by giving `RequireAuth` a real consumer.

## Scope

### In Scope

- Migration `00006_*.sql`: full `candidate_profiles` (§3.3) + `candidate_languages` (§3.4); PK `user_id UUID REFERENCES users(id)` (1:1); CEFR `A1..C2` CHECK; GIN on `skills`, B-tree on `city`, GIN on `search_vector`; composite PK `(user_id, language)`.
- sqlc `candidates.sql`: `UpsertProfile`, `GetProfileByUserID`, `ReplaceLanguages`, `ListLanguages`.
- Slice `backend/internal/features/candidates/` (entities, VOs, repo, service, handler) mirroring `companies`; routes `GET/PUT /me/profile` and `GET/PUT /me/profile/languages`, owner from JWT only.
- `cmd/api/main.go`: finish `buildVerifierFromEnv` (PEM via `jwk.ParseKey(…, jwk.WithPEM(true))` w/ PKCS#1/PKIX fallback); mount `RequireAuth` on `/me/*` via `r.Route("/me", r.Use(reqAuth); …)`.
- Invert `TestRequireAuth_ConstructedButNotMounted` → `TestRequireAuth_MountedOnMeRoutes` (≥1 route ref).
- Document `IDENTITY_JWT_*` in `backend/.env.example`.

### Out of Scope

Recruiter reads, search/matching, `search_vector` queries, status/lifecycle, backoffice, JWKS rotation — all deferred.

## Capabilities

### New Capabilities

- `candidates`: self-service candidate profile CRUD scoped to the authenticated user.

### Modified Capabilities

- `identity`: requirement *JWT Middleware* currently says "registered but NOT attached to any route in this slice" with scenario "zero routes wrapped"; mounting on `/me/*` changes both. Requires delta `MODIFIED` block.

## Approach

Self-service only — owner id from JWT (`Claims.Subject` → `GetUserByCognitoSub`), never the URL (no IDOR). `PUT /me/profile` is `INSERT … ON CONFLICT (user_id) DO UPDATE`; languages update replaces rows inside one `pgx.Tx`. Strict TDD — RED-first per `openspec/config.yaml`.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `backend/db/migrations/00006_*.sql` | New | Schema §3.3/§3.4. |
| `backend/db/queries/candidates.sql` | New | sqlc queries. |
| `backend/internal/features/candidates/**` | New | Hexagonal slice. |
| `backend/cmd/api/main.go` | Modified | PEM parse; `/me` mount. |
| `backend/cmd/api/main_test.go` | Modified | Invert W5 guard. |
| `backend/.env.example` | Modified | IDENTITY_JWT_*. |
| `openspec/specs/identity/spec.md` | Modified (delta) | JWT Middleware on `/me/*`. |
| `openspec/changes/candidates/specs/candidates/spec.md` | New (delta) | New capability. |

## Risks

| Risk | L | Mitigation |
|---|---|---|
| First 1:N; replace-all race | Med | One `pgx.Tx` per PUT. |
| PEM variance (PKCS#1 vs PKIX) | Med | `jwk.ParseKey(…, WithPEM)` + PKCS#1/PKIX raw fallback; clear err. |
| Stale sub → unknown user | Low | `GetUserByCognitoSub`; `ErrUserNotFound` → 401. |
| W5 inversion forgotten | Med | Same package; rename + flip in one PR. |

## Rollback Plan

1. `goose down` for `00006_*` (drops tables/indexes/CHECKs).
2. Revert `/me/*` mount; restore `_ = identityhttp.RequireAuth(verifier)`.
3. Revert W5 test from git.
4. Drop `IDENTITY_JWT_*` from `.env.example`; `TRUNCATE candidate_languages, candidate_profiles` (no inbound FKs).
5. `make test && make build` green; archive revert restores the `identity` delta.

## Dependencies

- `lestrrat-go/jwx/v2` (in identity) for PEM → `jwk.Key`.
- `pgx/v5` + sqlc (existing); no new infra.

## Success Criteria

- [ ] `make db-up && make test` green; migration reversible.
- [ ] Valid dev RSA token + matching user → `GET /me/profile` 200; unknown user → 404; no token → 401.
- [ ] `PUT /me/profile` upserts, idempotent.
- [ ] `PUT /me/profile/languages` atomic, no dup `language` after retry.
- [ ] `TestRequireAuth_MountedOnMeRoutes` passes; old guard removed.
- [ ] `go vet` + `gofmt` clean.
