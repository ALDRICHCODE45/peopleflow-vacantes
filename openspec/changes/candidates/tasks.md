# Tasks: Candidates — self-service profile, first authenticated HTTP slice

## Review Workload Forecast

Decision needed before apply: Yes
Chained PRs recommended: Yes (sequential work-unit commits on `main` — solo dev, no PRs)
Chain strategy: pending
400-line budget risk: High
Estimated changed lines: ~700–900
Suggested split: WU1 Foundation → WU2 Domain → WU3 Application → WU4 Infrastructure → WU5 Auth → WU6 Verify

### Suggested Work Units

| Unit | Goal | Focused test | Runtime harness | Rollback |
|------|------|--------------|-----------------|----------|
| WU1 Foundation | DB + sqlc | `go test ./internal/db/...` | `make db-up && goose status` | migration + sqlc only |
| WU2 Domain | VOs + entity + port | `go test ./internal/features/candidates/domain/...` | N/A (pure Go) | `domain/**` |
| WU3 Application | Use cases (sub→id) | `go test ./internal/features/candidates/application/...` | N/A (fake repos) | `application/**` |
| WU4 Infra | pgx adapter + handler | `go test -tags=integration ./internal/features/candidates/...` | `make test-integration` | `infrastructure/**` |
| WU5 Auth | wire /me mount + invert W5 | `go test ./cmd/api/...` | `go run ./cmd/api & curl /healthz` | `main.go` + test |
| WU6 Verify | integration + structural | `make test-integration && go test ./cmd/api/...` | `make test-integration` | test files only |

## Phase 1: Foundation (WU1)

- [x] 1.1 Create `backend/db/migrations/00006_create_candidate_profiles.sql` — `candidate_profiles` (§3.3) + `candidate_languages` (§3.4), CHECKs, GIN on `skills`, B-tree on `city`, GIN on `search_vector`, STORED `search_vector`; reversible `-- +goose Down`.
- [x] 1.2 Add `backend/db/queries/candidates.sql` — `UpsertProfile`, `GetProfileByUserID`, `ListLanguagesByUserID`, `DeleteLanguagesByUserID`, `InsertLanguage`.
- [x] 1.3 `make sqlc`; commit regenerated `backend/internal/db/`.

## Phase 2: Domain (WU2)

- [x] 2.1 RED: `domain/valueobjects/{education_level,salary_period,cefr_level,normalize_skills}_test.go` (invalid enums, lowercasing).
- [x] 2.2 GREEN: four VOs with sentinel errors in `domain/valueobjects/`.
- [x] 2.3 RED: `domain/entities/candidate_profile_test.go` (factory + invalid VO).
- [x] 2.4 GREEN: `domain/entities/{CandidateProfile,Language}.go` + sentinels; port `domain/repositories/candidateRepository.go` (4 methods).

## Phase 3: Application (WU3)

- [x] 3.1 RED: `application/usecases/candidate_service_test.go` (fakes; GET, upsert, IDOR, dup-language 400, sub-not-found 401).
- [x] 3.2 GREEN: DTOs + `application/usecases/{GetMyProfile,UpsertMyProfile,ReplaceMyLanguages,ListMyLanguages}.go`; resolve `cognito_sub→users.id` via identity port.

## Phase 4: Infrastructure (WU4)

- [x] 4.1 RED: `infrastructure/postgres/candidateRepository_test.go` (`integration` build; upsert, atomic replace, FK).
- [x] 4.2 GREEN: `infrastructure/postgres/candidateRepository.go` over `*pgxpool.Pool`; `ReplaceLanguagesByUserID` in one `pgx.Tx`.
- [x] 4.3 RED: `infrastructure/http/handler_test.go` (error→status 401/400/404/200).
- [x] 4.4 GREEN: `infrastructure/http/handler.go` `Routes()` (`/` + `/languages/`); map sentinels via `errors.Is`.

## Phase 5: Auth Wiring (WU5)

- [ ] 5.1 `cmd/api/main.go` — finish `buildVerifierFromEnv` via `jwk.ParseKey([]byte(pubPEM), jwk.WithPEM(true))`; fail-closed when env unset.
- [ ] 5.2 Mount `identityhttp.RequireAuth(v)` on `/me/*` via `r.Route("/me", r.Use(reqAuth); r.Mount("/profile", h.Routes()))`; wire identity repo + service + handler.
- [ ] 5.3 Add `IDENTITY_JWT_PUBLIC_KEY_PEM/ISSUER/AUDIENCE` to `backend/.env.example`.
- [ ] 5.4 `cmd/api/main_test.go` — rename guard to `TestRequireAuth_MountedOnMeRoutes`; assert ≥1 route ref.

## Phase 6: Tests & Verification (WU6)

- [ ] 6.1 RED-first guard: re-run WU2/WU3/WU4 tests standalone before WU5 wiring.
- [ ] 6.2 `cd backend && make test-integration` — migration applies, upsert idempotent, replace atomic.
- [ ] 6.3 `go test ./cmd/api/...` passes W5 inversion; `go vet ./...` + `gofmt -l .` clean.
- [ ] 6.4 Mark `[x]` only after each commit lands.