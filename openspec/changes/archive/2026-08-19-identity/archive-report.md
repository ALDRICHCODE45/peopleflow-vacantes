# Archive Report — `identity`

**Change**: `identity` — first Cognito-aware bounded context (users table, idempotent PostConfirmation handler, RS256 JWT middleware mounted on zero routes)
**Archived to**: `openspec/changes/archive/2026-08-19-identity/`
**Archived on**: 2026-08-19
**Source of truth updated**: `openspec/specs/identity/spec.md` (new domain, created from delta)
**Branch at archive**: `feature/identity` @ `e447367` (13 commits ahead of `main`)
**Authoritative verdict source**: orchestrator launch prompt (outranks `verify-report.md` snapshot at the time it was written)

---

## Verdict at Close

**PASS WITH WARNINGS** — 0 blockers, 0 critical findings.

- Spec coverage: **10/10 requirements**, **17/17 scenarios** compliant (per launch prompt; re-verification passed after remediation).
- Build & tests at HEAD `e447367`: `go test ./...` green, `go vet ./...` clean, `go build ./...` clean, `make test-integration` green with zero skips against local Postgres at `localhost:5432`.
- TDD discipline: 4/6 strict-TDD checks fully passed; per-phase RED state is not separately provable from git history (work-unit commits bundle RED+GREEN; tracked as process debt for future changes).

## Final-State Resolution of Warnings

The orchestrator's launch prompt outranks the intermediate `verify-report.md` snapshot. Where they disagree about whether a warning is open or closed at close, the launch prompt wins.

| ID | verify-report claim (snapshot time) | Final state at close | Evidence |
|----|-------------------------------------|----------------------|----------|
| W1 | Adapter conflict re-fetch path untested | **CLOSED** — unit test added (`TestUserRepository_CreateRefetchesOnConflict`) | commit `e447367` (launch prompt) |
| W2 | `GetByCognitoSub` had no direct hit/miss test | **CLOSED** — directly tested | commit `e447367` (launch prompt) |
| W4 | Down-migration test hand-duplicates DDL instead of invoking `goose down` | **OPEN** — non-blocking test-robustness nit; deferred | per launch prompt |
| W5 | `RequireAuth` middleware constructor mounted on zero routes | **OPEN** — intentional for this slice; goes live when the first authenticated route lands | per launch prompt; verified in current `cmd/api/main.go` |
| W7 | `openspec/config.yaml` capabilities stale (`integration: false`) | **CLOSED** — refreshed to `integration: true`, `formatter: gofmt` | commit `e447367` (launch prompt); independently verified in current `openspec/config.yaml` (lines 36–38, 49–50) |

Two warnings (W4, W5) are carried as documented, non-blocking debt. None block archive readiness.

## Spec Sync

| Domain | Action | Details |
|--------|--------|---------|
| `identity` | **Created** | `openspec/specs/identity/spec.md` — verbatim copy of the delta spec via `cp` (Mechanical Copy Contract). `diff -r` exit 0, byte-identical. |

The main spec carries 10 requirements (R1–R10), 17 Given/When/Then scenarios. No other domains were touched. No REMOVED/MODIFIED/RENAMED sections — this is a greenfield domain.

## Archive Contents (audit trail — immutable)

```
openspec/changes/archive/2026-08-19-identity/
├── archive-report.md       (this file; additive — written after the move)
├── apply-progress.md       (phase-by-phase outcomes; status: complete)
├── design.md               (7 architecture decisions, file-change matrix, threat matrix)
├── proposal.md             (intent, scope, rollback plan, success criteria)
├── specs/
│   └── identity/
│       └── spec.md         (delta spec — 10 requirements, 17 scenarios)
├── tasks.md                (21 tasks across 8 phases; all [x])
└── verify-report.md        (PASS WITH WARNINGS — 0 critical, 5 warnings)
```

Pre-move snapshot vs archived folder: `diff -r` exit 0, empty diff (byte-identical preservation). Source `openspec/changes/identity/` is gone.

## Delivery

- **Branch**: `feature/identity` (off `main`); 13 work-unit commits; HEAD `e447367`.
- **Pushed**: No — user merges to `main` and pushes.
- **PRs**: None.
- **Phase mapping of commits** (per `apply-progress.md`):
  1. `b63dda0` — phase 1: schema, queries, sqlc regen, jwx dep
  2. `259b3b1` — phase 2: domain layer (VOs, entity, sentinels, ports)
  3. `7ab3aee` — phase 3: postgres adapter (Querier seam + `mapCreateError`)
  4. `eacc31e` — phase 4: application use cases (`CreateUser`, `GetUserByID`)
  5. `27f9a4c` — phase 5: `post_confirmation` handler
  6. `a86ffb2` — phase 6: auth verifier (RSA) + `RequireAuth` middleware
  7. `16390e2` — phase 7: composition root wires `RequireAuth` (zero routes)
  8. `cc4dc74` — phase 8: verification (integration tests pass against local Postgres)
  9. `1802f60` — apply-progress artifact
  10. `8229b5b` — proposal/spec/design/tasks/verify report
  11. `82909bd` — verification remediation (TDD evidence, `test-integration` target, gofmt + `go mod tidy`)
  12. `6237ca9` — verify-report re-verification
  13. `e447367` — post-verify remediation (adapter re-fetch test, `GetByCognitoSub` test, config capability refresh)

## Scope Boundaries

In scope (delivered):
- Migration `00005_create_users.sql` with named CHECK + partial unique indexes
- `internal/features/identity/` full hexagonal slice mirroring `companies`
- sqlc: `CreateUser` (idempotent), `GetUserByID`, `GetUserByCognitoSub`
- Use cases `CreateUser`, `GetUserByID` — **no public HTTP endpoints**
- `PostConfirmation` handler — pure Go, env-flag-gated, idempotent
- RS256 JWT middleware — constructed, mounted on zero routes
- One new dep: `lestrrat-go/jwx/v2 v2.1.7`

Deferred (out of scope, per proposal):
- `company_members`, `invitations`
- Real Cognito JWKS + `kid` rotation (verifier port exists; static dev RSA key in use)
- Wiring `RequireAuth` onto protected routes
- Public `POST /users`
- Password / MFA / refresh
- AWS / Terraform

## Risks Carried Forward (non-blocking)

- **`lestrrat-go/jwx/v2 v2.1.7` is deprecated upstream** (v3/v4 available). Pinned by design; migration is a future task — flagged in `apply-progress.md`.
- **Integration tests require a reachable Postgres at `localhost:5432`** (CI must provision). `make test-integration` target sources `.env` and exports `DATABASE_URL`.
- **Per-commit RED-first is not provable from git history** for this change (each phase bundled test + implementation). Future changes should record an explicit RED run or commit tests separately so the strict-TDD gate is provable from history alone.

## SDD Cycle

- propose → spec → design → tasks → apply → verify → **archive** → (cycle continues for the next change).
- This change closes with all 6 artifact types persisted and the source-of-truth spec populated. Ready for the next change.
