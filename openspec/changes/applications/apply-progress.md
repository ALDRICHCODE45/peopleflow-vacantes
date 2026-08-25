# Apply Progress — `applications`

Phase: apply. Strict TDD. Single-pr delivery (size-exception accepted).

## TDD cycle evidence

| Commit | Phase | RED (test) | GREEN (impl) | Verify | Notes |
|---|---|---|---|---|---|
| A | 1 — Domain VOs + entities | 1.1 tests reference `ApplicationStatus` / `ApplicationSource` / sentinels that don't exist → compile RED | 1.2 `applicationStatus.go`, `applicationSource.go`, `application.go` land | `cd backend && go test ./internal/features/applications/...` green; `gofmt -l` empty | single sentinel `ErrInvalidStatusTransition` for both unknown-parse and illegal-matrix per D6 |

## TDD Cycle Evidence

| Commit | Phase | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| A | 1 — Domain VOs + entities | 1.1 — `applicationStatus_test.go`, `applicationSource_test.go`, `entities/sentinels_test.go` reference undeclared identifiers (`ApplicationStatus`, `ApplicationSource`, sentinels) → compile failure, the accepted "missing-type compile RED" pattern. | 1.2 — VOs and entities land; `go test ./internal/features/applications/...` green. | n/a — VO-level tests are exhaustive table-driven over the closed sets; no further triangulation needed. | 1.3 — `gofmt -l` empty; no parallel sentinel drift; `ErrInvalidStatusTransition` is the single sentinel (no second `ErrInvalidApplicationStatus`). |

## Commits landed

- **Commit A** — `feat(applications): status/source value objects and domain entities` (Phase 1: tasks 1.1–1.3)
- **Commit B** — `feat(applications): migration 00010 applications table` (Phase 2: task 2.1)
- **Commit C** — `feat(applications): repository port, DTOs, and five use cases` (Phase 3: tasks 3.1–3.3)
- **Commit D** — `feat(applications): sqlc queries, regen, and postgres adapter` (Phase 4: tasks 4.1–4.4)

## Phase 1 — Domain VOs + entities (Commit A)

### Files (all NEW)

- `backend/internal/features/applications/domain/valueobjects/applicationStatus.go` — `ApplicationStatus` enum (UnknownApplicationStatus as zero), `String`, `ParseApplicationStatus` (trim + lowercase), `CanTransitionTo` (pure 3-edge matrix), `ErrInvalidStatusTransition`.
- `backend/internal/features/applications/domain/valueobjects/applicationSource.go` — `ApplicationSource` enum (UnknownApplicationSource as zero), `String`, `ParseApplicationSource`, `ErrInvalidSource`.
- `backend/internal/features/applications/domain/entities/application.go` — `Application`, `CandidateSnippet` (PII-minimized), `JobSummary`, `ApplicationWithCandidate`, `MyApplication` (cv_s3_key/anonymized_at deliberately absent), the 7 entity sentinels.
- `backend/internal/features/applications/domain/valueobjects/applicationStatus_test.go` — stringer, parser, full 4×4 transition matrix.
- `backend/internal/features/applications/domain/valueobjects/applicationSource_test.go` — stringer + parser table.
- `backend/internal/features/applications/domain/entities/sentinels_test.go` — pairwise distinctness.

### Test commands run

- `cd backend && go test ./internal/features/applications/...` → green (1.2 GREEN)
- `cd backend && go vet ./internal/features/applications/...` → clean
- `cd backend && gofmt -l ./internal/features/applications/` → empty

### Deviations from tasks.md

- None.

### Remaining tasks

- 5.1 / 5.2 (Commit E) — SQL integration
- 6.1 / 6.2 (Commit F) — HTTP handler
- 7.1 / 7.2 (Commit G) — composition root + AST guards
- 8.1 — full-suite gate

## Workload / PR boundary

Single-pr delivery (size-exception accepted). Commit A accounts for ~13.7 KB of authored code across 6 new files (3 production + 3 tests).
