# Proposal: `backend-go-closure` — Objective Go Backend Completion Before AWS

Status: proposal (pre-spec, pre-design, pre-tasks; corrective rerun — requirement ownership corrected per config rule "each requirement MUST belong to exactly one feature domain"). Grounded by `exploration.md` (capability matrix, drift list, evidence index) and the confirmed pre-proposal gate (`preproposal.md`). All product decisions are confirmed and locked; this proposal does not re-open any of them. Technical defaults left open in the prior draft are now **pinned** (see §4, D1–D5); nothing is left to user silence.

## 1. Intent

Declare the Go backend **objectively complete and AWS-ready** before any AWS implementation begins. Today the domain logic is substantially delivered (seven canonical contexts plus the industries catalog), but the backend is **not yet an objective AWS-ready system**: canonical specs drift from the running surface, known companies/SQL test debt remains, and the production runtime boundary is missing or unowned (`cmd/migrate`, the PostConfirmation Lambda executable, Cognito JWKS verification, hardened/observable HTTP, enforced local gates, and the final AWS go/no-go evidence contract). The current recorded status is **NO-GO for AWS implementation**.

This change closes exactly that gap: reconcile the seven canonical specifications with the running surface, eliminate the companies/SQL debt, deliver the missing runtime boundaries plus production authentication, harden HTTP with minimum structured observability, make local/CI quality and architecture gates enforceable, and finish with an explicit AWS go/no-go report. It deliberately does **not** implement any AWS infrastructure (Docker, Terraform, ECS/RDS/Cognito resources, deployment workflows) — those belong to the AWS phase that this gate unlocks.

## 2. Requirement ownership model (capability map)

Per `openspec/config.yaml`, every normative requirement must belong to exactly one feature domain. The prior draft scattered cross-cutting runtime requirements (`cmd/migrate`, health endpoints, server limits, error envelope, observability, gates) across workstreams with no owning capability. This rerun fixes ownership as follows:

- **New canonical capability `backend-runtime`** (ADDED in WS1) owns, exclusively:
  - `cmd/migrate` executable contract and migration determinism;
  - `/healthz` process liveness and `/readyz` DB readiness;
  - HTTP server timeouts, request-body limits, graceful shutdown, and the stable error envelope (error codes + English default messages, never raw internal errors);
  - structured request/error logs and metrics-ready interfaces;
  - repository-enforced local quality/architecture gate commands and the final AWS go/no-go evidence contract.
  `backend-runtime` is the single runtime boundary spec; no requirement in it is duplicated into another capability. Domain specs reference error codes/readiness by contract, they do not restate it.
- **New canonical capability `industries`** (ADDED in WS1) owns the industries catalog: active semantics, response shape, and the active-only SQL surface.
- **Existing seven capabilities** (`identity`, `candidates`, `companies`, `company-membership`, `jobs`, `applications`, `audit_events`) receive deltas **only where behavior or contract actually changes** (WS1 reconciliation, WS2 companies closure, WS3 candidates field matrix, WS5 identity JWKS). No empty/no-op deltas are produced for `company-membership`, `applications`, or `audit_events` merely to record that they were reviewed; the executable traceability matrix (WS1) proves unchanged capabilities complete without modifying their specs. If reconciliation uncovers a real behavior/contract change in any of them, a delta is written at that point only.
- Capability-boundary rule for spec phase: a requirement names its owning capability exactly once. Where a behavior spans a domain and the runtime (for example, a companies handler emitting stable error codes), the **domain requirement** owns the business behavior and the `backend-runtime` requirement owns the shared envelope/observability mechanism.

## 3. Problem / current-state gap

Recorded evidence (latest archived verify reports: build, vet, unit, and serial live integration PASS; 811 live integration passes recorded; one intentional rollback placeholder skip, `TestSoftDeleteCompany_RollbackOnCloseFailure_Placeholder`) supports: **core behavior near complete, Go closure NO-GO**. The concrete gaps that block GO:

1. **Requirement traceability is broken.** Canonical specs (seven: `identity`, `candidates`, `companies`, `company-membership`, `jobs`, `applications`, `audit_events`) drift from the running surface: wrong PostConfirmation path, "JWKS deferred" clause contradicting the approved verifier outcome, Companies create/read described in Purpose but with no normative requirements, Jobs `Status Domain` claiming transitions are out of scope while later requirements deliver them, and candidates canonical field set missing the delivered full matrix. There are no canonical specs for `industries` or for the cross-cutting runtime boundary (`backend-runtime`), so the delivered health split, migration executable, HTTP hardening, observability, and quality gates have no requirement owner at all. Explanatory docs (`docs/ROADMAP.md`, `README.md`, architecture/data-model docs) are stale on migrations version, routes, auth mode, `cmd/migrate`, invitations, and repository structure.
2. **Companies W1–W6 test debt.** Rollback-on-close failure is a placeholder skip; no direct live `CompanyRepository.Create`/`GetByID`; PATCH missing/malformed CAS; multi-field update; 409 redaction parity; no true concurrent CAS race test; explicit no-audit on failed outcomes not asserted; named-constraint assertions (`companies_size_check`, `companies_founded_year_check`) missing.
3. **Missing production runtime boundary (owner: `backend-runtime`).** No `cmd/migrate` executable (Make/goose developer path only); PostConfirmation handler exists but has no AWS Lambda event adapter/executable; JWT verification is static-PEM only; HTTP server has only `ReadHeaderTimeout` — no read/write/idle timeouts, body caps, readiness split, or error/log policy.
4. **Candidate wire defect.** `json:"field_of study"` tag contradicts the response/model naming `field_of_study` — an API defect, plus the canonical field contract cannot detect DTO/schema drift.
5. **Industries is delivered but unspecified and under-tested**, including a duplicate industries route registration in `cmd/api/main.go`.
6. **No enforced quality/architecture gates.** Quality evidence is manual/archived; there is no reproducible fmt/vet/race/serial-integration/migration-sqlc-drift gate, and no import/route architecture guard so documented boundaries fail in CI rather than in review.

## 4. Confirmed business decisions (locked — DO NOT re-open)

Resolved in the confirmed pre-proposal gate. Spec, design, and tasks must honor these verbatim:

| # | Decision | Selection | Consequence enforced in this change |
|---|---|---|---|
| C1 | Candidate CV key | `reserve` | Keep `candidate_profiles.cv_s3_key` nullable in DB; reject/ignore client writes; omit from ordinary wire responses until the future CV slice owns storage. Enforces the CV/S3 locked non-goal. |
| C2 | Industry validation | `atomic-active-sql-gate` | Company creation succeeds only when the industry exists AND is active, checked inside the same SQL statement/transaction (no TOCTOU window; inactive industries are not selectable). |
| C3 | Public API errors | `stable-codes-plus-english` | Stable machine-readable error codes plus English default messages; never expose raw DB/internal errors; UI localizes independently. |
| C4 | Health contract | `/healthz` process liveness + `/readyz` DB readiness | Split semantics; liveness must not depend on DB, readiness must reflect DB. Owned canonically by `backend-runtime`. |
| R1 | PostConfirmation enablement | Production-required | Lambda fails startup/config when disabled in production; explicit disable is local/test-only and never silently disables production user sync. |
| R2 | JWT modes | JWKS production + explicit PEM local/test | Cognito JWKS with `kid` selection, bounded caching, rotation refresh, issuer/audience/token-use/RS256 validation, fail-closed startup/runtime. Static PEM is an explicit local/test mode only; no implicit permissive fallback. |
| R3 | Minimum observability | `logs+metrics` | Correlated structured logs (request ID, method/path/status/duration, safe error classification, startup/shutdown events) plus application/runtime/DB metrics; exporter destination stays an AWS-phase decision (metrics-ready contract, not OTel wiring). |
| R4 | Closure gate | Zero unexpected integration skips | The rollback placeholder must be replaced before GO; no skip may survive unexplained. |
| A1 | Cross-feature rule | Document + enforce narrow port/co-write exceptions | Narrow domain-port and audit co-write type imports are documented, approved exceptions; cross-feature **infrastructure** imports remain forbidden and CI-enforced. No broad refactor. |
| A2 | Future material in docs | Label future/non-MVP | Retain long-range context only when clearly labelled future/non-MVP; remove any text that reads as delivered/current. |

### Pinned technical defaults (binding — not user-silence assumptions)

The prior draft carried residual open questions. These are now **pinned technical defaults** resolved by the parent gate, binding on spec, design, and tasks:

| # | Default | Pinned selection |
|---|---|---|
| D1 | Lambda adapter surface | The adapter handles **PostConfirmation trigger events only** and returns handler errors as Lambda failures (propagating failure so Cognito retry semantics apply); errors are never swallowed as no-ops. |
| D2 | `/readyz` failure response | A non-ready DB yields **503 with a safe, non-sensitive body**; `/healthz` stays 200 while the process is live (C4 split, canonical in `backend-runtime`). |
| D3 | Metrics contract shape | Minimal in-process metrics interfaces (counters/gauges for HTTP requests, DB pool, readiness) with a **no-op default implementation**; exporter selection is deferred to AWS design (R3). |
| D4 | `cmd/migrate` packaging | Migrations are **embedded in a single static binary** via `go:embed` (not filesystem-relative packaging), keeping the executable self-contained for one-off deployment. |
| D5 | Error-code inventory | The stable error-code catalog is **defined canonically in the `backend-runtime` spec during WS1, before any handler message cleanup** (C3); handlers adopt it, they never invent codes ad hoc. |

No item in this proposal is resolved by user silence; the proposal question round is not applicable to this corrective rerun (the orchestrator owns product discovery and the pre-proposal gate is confirmed).

## 5. Scope — workstreams and requirement reconciliation

Seven workstreams, ordered so each maps to reviewable work units. The tasks phase owns the forecast and may chain units; this proposal only recommends the boundaries.

### WS1 — Canonical requirement reconciliation, ownership, and executable traceability (MUST)

- Produce canonical deltas for the seven existing specs **where behavior/contract actually changes**, plus new canonical capability specs for **`industries`** and **`backend-runtime`** (both own delivered/missing official surfaces with no canonical requirements today). `backend-runtime` is defined per the ownership model in §2.
- Expected delta map (spec phase confirms): `identity` (PostConfirmation path fix; "JWKS deferred" clause removed per R2), `companies` (create/read normative requirements, atomic-active-sql-gate), `candidates` (full field matrix incl. C1 `reserve`), `jobs` (Status Domain cleanup, delta-era prose removal). `company-membership`, `applications`, and `audit_events` are reviewed for drift but receive deltas **only if** a real behavior/contract change is found; otherwise the traceability matrix records them complete with no spec modification.
- Establish an **executable traceability matrix**: every MUST canonical requirement across all capabilities names its test/evidence anchor (migration, SQL, Go symbol, route, test) and its single owning capability. Unchanged capabilities are proven complete through the matrix, not through no-op deltas.
- **Behavior vs docs distinction (mandatory in every work unit):** behavior requirements are spec requirements + code + tests; explanatory cleanup (ROADMAP, README, architecture/data-model docs) ships in the same work unit as the behavior it explains, is marked as non-normative, and never invents behavior. Doc-only corrections that fix stale claims without behavior change are permitted as their own small unit.

### WS2 — Companies W1–W6 and SQL closure (MUST; owning capability: `companies`)

- W1: replace the rollback placeholder skip with deterministic failure injection (injected tx/query seam or transaction-local trigger with guaranteed cleanup; serial integration only).
- W2–W5: direct live `CompanyRepository.Create`/`GetByID`; PATCH missing/malformed CAS; multi-field update; 200/409 redaction parity; explicit no-audit assertions on failed outcomes.
- W6: true two-writer concurrent CAS race test.
- Constraint tests asserting both SQLSTATE and named constraint for `companies_size_check` and `companies_founded_year_check`; fixture cleanup/isolation.
- Fix stale test preambles/comments claiming "no audit" (cleanup, rides with WS2 behavior).

### WS3 — Candidate and industries contract closure (MUST; owning capabilities: `candidates`, `industries`)

- Correct the `field_of_study` wire tag (behavior defect); specify and test the complete candidate field set including null/default semantics and C1 `reserve` CV-key behavior (writes rejected/ignored, omitted from responses).
- Industries: specify and test active-catalog semantics, response shape, and the active-only SQL against the new `industries` canonical spec; remove the duplicate industries route registration in `cmd/api/main.go` (one canonical registration).

### WS4 — Executable runtime boundaries: `cmd/migrate` and PostConfirmation Lambda (MUST; owning capability: `backend-runtime`)

- `cmd/migrate`: self-contained goose runner with migrations embedded in a single static binary (D4), `up`/`status` commands, defined failure behavior; clean-DB up/down/up runtime test proving migration determinism. The Make/goose developer path remains.
- PostConfirmation Lambda adapter: a new executable translating the AWS Lambda PostConfirmation event (only) into the existing `PostConfirmationHandler.Handle` application handler (no identity logic duplication), wiring Postgres/config/logging; handler errors propagate as Lambda failures so Cognito retry applies (D1); production-required enablement per R1; idempotent redelivery behavior preserved. Independently buildable, testable, rollbackable.
- No Docker/Terraform/Lambda deployment resources in this workstream.

### WS5 — Production authentication: Cognito JWKS verifier (MUST; owning capability: `identity`)

- JWKS verifier with issuer/audience/token-use/RS256 validation, `kid` selection, bounded key caching, rotation refresh, request cancellation, fail-closed startup and runtime behavior.
- Static PEM verifier retained as an explicit local/test mode (R2); configuration surfaces both modes explicitly, never implicit fallback.
- Middleware/route regressions updated; canonical identity spec clause "JWKS deferred" replaced by the new production requirement (identity delta from WS1).

### WS6 — HTTP hardening, health split, and minimum structured observability (MUST; owning capability: `backend-runtime`)

- Server: read-header/read/write/idle timeouts, maximum request-body policy, graceful shutdown verification — all canonical in `backend-runtime`.
- Health split per C4/D2 implemented and contract-tested: `/healthz` process liveness (200 while process-live, DB-independent), `/readyz` DB readiness (503 with safe non-sensitive body when DB is non-ready).
- Error envelope per C3/D5: normalized JSON/content-type/error behavior; handlers emit codes from the canonically-defined stable catalog with English default messages; no raw internal errors. Domain specs reference the envelope contract, they do not restate it.
- Observability per R3/D3: request ID consistently attached to structured logs, method/path/status/duration, safe error classification, startup/config and shutdown events, DB readiness signals; minimal in-process metrics interfaces with a no-op default, no exporter wiring.
- Composition root is already large: extract server config/constructors in one behavior-preserving unit; keep the route-guard AST tests with the move.

### WS7 — Enforceable quality + architecture gates, then AWS go/no-go (MUST; owning capability: `backend-runtime`)

- Reproducible repository-enforced gate: `go build ./...`, `go vet ./...`, gofmt check, `go test ./...` (unit), race tests for suitable packages, serial live integration `go test -tags=integration -p 1 ./... -count=1` with **zero unexpected skips**, migration round-trip (fresh up/down/up), sqlc generation drift check. Commands/scripts and the acceptance contract are canonical `backend-runtime` requirements; the AWS-hosted CI/CD resource itself does not.
- Architecture guard: import-boundary and route-topology enforcement (linter config or AST tests) encoding A1 — narrow approved port/co-write exceptions documented; cross-feature infrastructure imports fail CI.
- SHOULD-tier hardening (not GO-blocking unless tasks elevate): golangci-lint policy, `govulncheck`, coverage trend, fuzz targets for cursor/JWT/JSON boundaries, broader `-race`.
- Finish with the **AWS go/no-go report**: an explicit artifact stating the gate result against every criterion in §9 — the evidence contract for this artifact is a `backend-runtime` requirement.

## 6. Affected areas

| Area | Impact |
|---|---|
| `openspec/specs/{identity,candidates,companies,jobs}/spec.md` | Canonical deltas — behavior/contract changed (WS1, WS2, WS3, WS5) |
| `openspec/specs/{company-membership,applications,audit_events}/spec.md` | Reviewed for drift; delta only if a real change is found — no no-op deltas (WS1) |
| New capability spec: `openspec/specs/backend-runtime/spec.md` | New canonical requirements: cmd/migrate, health split, HTTP limits, error envelope, logs/metrics, gates, go/no-go evidence (WS1, WS4, WS6, WS7) |
| New capability spec: `openspec/specs/industries/spec.md` | New canonical requirements: active catalog semantics, response shape (WS1, WS3) |
| `backend/internal/features/companies/**` + `backend/db/queries/companies.sql` | Test closure, atomic-active-sql-gate (WS2) |
| `backend/internal/features/candidates/infrastructure/http/handler.go` | Wire tag fix, field matrix, CV-key reserve behavior (WS3) |
| `backend/internal/features/industries/**`, `backend/cmd/api/main.go` | Spec/tests, duplicate route removal (WS3) |
| `backend/cmd/api/main.go` + server config | Health split, timeouts, body caps, error envelope, logs/metrics (WS6) |
| New `backend/cmd/migrate` | New executable, embedded migrations (WS4) |
| New PostConfirmation Lambda executable/adapter | New boundary, reuses identity application handler (WS4) |
| `backend/internal/features/identity/infrastructure/auth/**` | JWKS verifier + config modes (WS5) |
| Make/scripts, linter/architecture guard config | CI gate commands (WS7) |
| `docs/ROADMAP.md`, `README.md`, `docs/arquitectura-backend-proyecto-04.md`, `docs/modelo-de-datos-proyecto-04.md` | Explanatory reconciliation, future/non-MVP labels (WS1, A2) |

## 7. Locked non-goals

This change MUST NOT implement, and the go/no-go gate must verify remain absent:

- Event/outbox patterns or async workers (EventBridge/SQS narrative stays future-labelled).
- CV/S3 lifecycle or anonymization (C1 `reserve` enforces the wire boundary).
- Recruiter candidate search.
- Invitations.
- Restore/undelete.
- Salary FX conversion.
- Audit read API.
- Dockerfile/container image, Terraform, ECS/Fargate, RDS/RDS Proxy, Cognito AWS resources/triggers, Lambda deployment resources, IAM/KMS/Secrets Manager, CloudWatch wiring, frontend hosting, CI/CD deployment workflows — all AWS-phase work.
- Broad cross-feature refactor (A1 fixes the rule, not the seams).
- OTel tracing/exporter wiring (R3/D3 stop at metrics-ready interfaces with a no-op default).

## 8. Risks and rollback boundaries

| Risk | Control and rollback boundary |
|---|---|
| Canonical reconciliation accidentally promotes a locked non-goal | Spec diffs must list locked exclusions; rollback is the documentation-only work unit — no code touched. |
| New `backend-runtime` spec duplicates a requirement owned by a domain spec | Ownership matrix in WS1 assigns each requirement exactly one capability; spec-phase review rejects any requirement stated in two specs. Rollback removes the duplicated clause, not the behavior. |
| JWKS cache/rotation admits stale or wrong keys | Table-driven crypto tests against a local JWKS test server; rollback returns to fail-closed static PEM local mode, never permissive auth. |
| Lambda adapter duplicates identity logic | Adapter translates the PostConfirmation event only and composes the existing application handler; rollback removes the executable/dependency without touching the domain. |
| `cmd/migrate` packages migrations incorrectly | Clean-DB up/down/up/status runtime test on the embedded-migration binary; rollback removes the command while the Make/goose developer path remains intact. |
| Failure injection mutates shared DB schema | Prefer injected tx/query seam or transaction-local trigger with guaranteed cleanup; serial integration only. |
| HTTP limits/timeouts break legitimate payloads | Per-route documented limits with boundary tests; middleware/config rollback is independent of domain code. |
| Error normalization breaks existing clients | Stable error codes (C3) are defined canonically in `backend-runtime` (D5) and contract-tested before message cleanup; codes are additive first. |
| Composition-root refactor regresses route topology | Behavior-preserving extraction unit; route-guard AST tests ship in the same unit. |
| Generated sqlc/fixtures inflate review | Exclude generated lines from the authored budget; isolate SQL + generated + tests as one work unit. |
| New runtime dependencies enlarge supply chain | Pin direct dependencies, prefer service-specific AWS modules over the SDK-wide import, run vuln scan in the gate. |

## 9. AWS go/no-go gate (success criteria)

AWS work is **GO** only when all of the following hold; otherwise the report states NO-GO with the blocking items named:

1. Every MUST canonical requirement has exactly one owning capability; the executable traceability matrix has no unexplained D/R/T row marked MUST and names an anchor for every MUST requirement. New canonical specs `industries` and `backend-runtime` exist with their owned requirements; capabilities with no behavior/contract change (expected: `company-membership`, `applications`, `audit_events`) are proven complete by the matrix without no-op deltas.
2. `go build ./...`, `go vet ./...`, gofmt check, unit tests, and selected race suite pass.
3. Serial live integration passes with **zero unexpected skips**; the rollback placeholder is replaced (R4).
4. Fresh migration up/down/up via `cmd/migrate` (embedded migrations, D4) and sqlc regeneration are deterministic.
5. `cmd/api`, `cmd/migrate`, and the PostConfirmation-only Lambda executable (D1) build and have runtime-boundary tests.
6. Production auth uses tested Cognito JWKS rotation and fails closed on configuration/key-fetch errors; static PEM exists only as explicit local/test mode.
7. `/healthz` (process-live) + `/readyz` (DB readiness, 503 safe-body on failure per D2), HTTP timeout/body limits, graceful shutdown, the stable error envelope, and minimum structured observability (correlated logs + metrics-ready interfaces with no-op default per R3/D3) are contract-tested as `backend-runtime` requirements.
8. Companies W1–W6, Create/GetByID live evidence, named constraints, industries contract, candidate wire fields, and the error-code contract have direct evidence.
9. Atomic-active-sql-gate industry validation has direct SQL-level evidence against the `industries` canonical spec.
10. Locked non-goals remain absent; no Docker/Terraform/workers/deployment resources were smuggled into Go closure.
11. Architecture guard enforces A1 boundaries in CI and passes.
12. Explanatory docs no longer contradict delivered behavior; future material is labelled future/non-MVP.

## 10. Dependencies and sequencing

- WS1 first: it defines the new `backend-runtime` and `industries` canonical contracts (including the D5 error-code catalog) before any other workstream claims closure against them. WS2 and WS3 depend on WS1's deltas for companies/candidates/industries; WS4, WS6, and WS7 depend on the `backend-runtime` contract; WS5 depends on WS1's identity delta.
- WS2–WS6 are independently buildable once their contracts exist; WS7 last because the gate consumes all prior evidence and produces the go/no-go report as a `backend-runtime` evidence artifact.
- No external research dependency: the pre-proposal gate confirmed repository evidence is sufficient (research unselected).
- Strict TDD applies throughout (`cd backend && go test ./...` as the session preflight command).

## 11. Review workload notes

- `delivery_strategy` remains `ask-on-risk`; the tasks phase owns the review workload forecast and any `size:exception` decision. This proposal makes no chain_strategy or sizing choice.
- Known >400-authored-line hotspots (from exploration): JWKS verifier plus tests; Lambda adapter plus AWS event/runtime dependencies; companies live-DB closure; server-hardening extraction; CI/architecture-guard setup. These should be split into work-unit commits with tests and rollback notes in the same unit.
- Authored-line budget: 400 authored lines per review unit stands; generated sqlc/migration output is excluded from the authored count but included in snapshots.
