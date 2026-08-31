# Backend Runtime Specification

## Purpose

`backend-runtime` is the single canonical owner of the cross-cutting runtime boundary of the Go backend: the migration executable, health/readiness endpoints, HTTP server hardening, the shared stable error envelope and error-code catalog, structured logs and metrics-ready interfaces, the repository-enforced local quality/architecture gates, and the AWS go/no-go evidence contract. Domain capabilities reference this spec's envelope, codes, and readiness by contract; they never restate the mechanism. No requirement in this spec is duplicated into a domain spec.

Locked non-goals (MUST NOT be implemented by this capability, verified at the go/no-go gate): Dockerfile/container image, Terraform, ECS/Fargate, RDS/RDS Proxy, Cognito AWS resources/triggers, Lambda deployment resources (IAM/KMS/Secrets Manager/CloudWatch wiring), CI/CD deployment workflows, outbox/async workers, and OpenTelemetry exporter wiring. The metrics contract stops at in-process interfaces with a no-op default.

## Requirements

### Requirement: Migration Executable (`cmd/migrate`)

The system MUST provide a self-contained `cmd/migrate` executable that embeds all goose SQL migrations via `go:embed` in a single static binary (no filesystem-relative packaging, no external migration tooling required at deploy time). The executable MUST support at least the commands `up` (apply all pending migrations in order), `down` (revert the most recent applied migration, as goose does), and `status` (report each migration as applied or pending). The existing Make/goose developer path MUST remain functional. The executable MUST exit non-zero and emit a safe, non-sensitive error log on any migration failure; it MUST NOT swallow failures.

#### Scenario: up applies pending migrations on a clean database

- GIVEN a clean, empty Postgres database
- WHEN `cmd/migrate up` runs
- THEN all migrations from `00001` through the latest are applied in order, the executable exits 0, and `cmd/migrate status` reports every migration as applied

#### Scenario: up on a fully-migrated database is a no-op

- GIVEN a database with all migrations applied
- WHEN `cmd/migrate up` runs again
- THEN no migration is re-applied, the schema is unchanged, and the executable exits 0

#### Scenario: clean-DB up/down/up is deterministic

- GIVEN a clean database
- WHEN `up`, then `down` until the base state, then `up` again run in sequence
- THEN the final schema is equivalent to the schema after the first `up` (same objects, same constraints, same indexes) and both `up` runs exit 0

#### Scenario: failure exits non-zero with a safe log

- GIVEN a migration failure (e.g., a deliberately broken migration or an unreachable database)
- WHEN the affected `cmd/migrate` command runs
- THEN the executable exits non-zero and the emitted log contains no credentials, connection strings with secrets, or raw driver internals beyond the classified error

### Requirement: Health Liveness and DB Readiness Split

The API server MUST expose two distinct health endpoints with split semantics:

- `GET /healthz` — process liveness. It MUST return `200` with a small, static body whenever the HTTP process is serving, WITHOUT consulting the database. It MUST NOT depend on DB availability.
- `GET /readyz` — DB readiness. It MUST return `200` with a small static success body when the database connection check (pool ping) succeeds within the readiness probe budget, and MUST return `503` with the stable error envelope carrying `code: service_unavailable` when the database is unreachable or the check fails. The success body is not an error envelope.

A non-ready database MUST NOT change the `/healthz` response, and process liveness MUST NOT be gated on DB state.

#### Scenario: liveness is DB-independent

- GIVEN the API process is running and the database is unreachable
- WHEN `GET /healthz` is sent
- THEN the response is `200` with a static body (the DB state does not affect it)

#### Scenario: readiness is 200 when the DB is reachable

- GIVEN the API process is running and the database accepts a pool ping
- WHEN `GET /readyz` is sent
- THEN the response is `200`

#### Scenario: readiness is 503 with a safe body when the DB is non-ready

- GIVEN the API process is running and the database is unreachable
- WHEN `GET /readyz` is sent
- THEN the response is `503` with the stable `service_unavailable` envelope and no connection strings or driver error text — and `GET /healthz` for the same process state is still `200`

### Requirement: HTTP Server Hardening

The API HTTP server MUST configure, at minimum: a read-header timeout, a read timeout, a write timeout, and an idle timeout. The server MUST enforce a maximum request-body size policy and MUST reject bodies exceeding the configured limit with `413` and the stable error envelope (code `payload_too_large`). The server MUST shut down gracefully: on SIGTERM/SIGINT it MUST stop accepting new connections and MUST complete or drain in-flight requests within a bounded drain window before exiting, logging the shutdown event.

#### Scenario: slow-header connections are bounded

- GIVEN a client that opens a connection and never finishes sending request headers
- WHEN the read-header timeout elapses
- THEN the server closes the connection (the request never reaches a handler)

#### Scenario: oversized request body is rejected with 413

- GIVEN a configured maximum request-body size of N bytes
- WHEN a request with a body larger than N bytes is sent
- THEN the response is `413` with the stable error envelope body `{"error":"...","code":"payload_too_large"}` and the body is not processed by the handler

#### Scenario: graceful shutdown completes in-flight requests

- GIVEN an in-flight request being served
- WHEN the process receives SIGTERM
- THEN the server stops accepting new requests, the in-flight request is allowed to complete (or is drained within the configured window), the shutdown event is logged, and the process exits

### Requirement: Stable Error Envelope

Every public API error response MUST use a JSON envelope with Content-Type `application/json` that carries BOTH:

- `error` — a human-readable default message in English (backwards-compatible with the current `{"error":"..."}` wire shape); and
- `code` — a stable machine-readable error code selected from the canonical catalog (see `Stable Error-Code Catalog`).

Error responses MUST NOT expose raw database errors, driver internals, stack traces, connection details, or any other internal representation; internal failures MUST map to the generic internal-error outcome with the real error logged server-side. Every public error outcome is in scope — including router-issued 404 (unmatched route), router-issued 405 (matched route but unsupported method), and recovered panics from handler goroutines — and each MUST emit the stable envelope with a catalog code. UI localization is independent of these default messages. Domain handlers MUST adopt catalog codes via this envelope; they MUST NOT invent ad-hoc code strings.

#### Scenario: envelope carries both message and code

- GIVEN any public API error outcome (e.g., a 400 validation failure)
- WHEN the response body is decoded
- THEN it is a JSON object with Content-Type `application/json` containing a non-empty English `error` string and a `code` value that exists in the canonical catalog

#### Scenario: internal failure is classified, never leaked

- GIVEN a handler that receives an unexpected database error
- WHEN the error is classified for the response
- THEN the client receives the generic internal-error outcome (`500` with code `internal_error` and the English default message) and the real error appears only in the structured server log, not in the response body

#### Scenario: existing clients stay compatible

- GIVEN a client that reads only the `error` field of a response body
- WHEN any error response is returned after code adoption
- THEN the `error` field is still present with a human-readable English message (the added `code` field is additive)

### Requirement: Stable Error-Code Catalog

The system MUST define the stable error-code catalog canonically in this capability as a single, closed, versioned set of code strings declared in one place in the codebase; handlers MUST reference catalog entries and MUST NOT declare codes ad hoc. The version identifier MUST be the integer `ErrorCatalogVersion = 1`, and V1 MUST contain exactly the following 14 codes mapped to the outcome classes already pinned by the canonical domain specs:

| Code | HTTP outcome class (existing canonical mapping) |
|---|---|
| `invalid_request` | 400 — malformed JSON body, invalid UUID/path parameter, or domain validation failure |
| `invalid_status_transition` | 400 — resource status transition rejected by any domain transition table |
| `unauthenticated` | 401 — missing/invalid token (RequireAuth short-circuit) |
| `forbidden` | 403 — authenticated but not a member, or role below the gate |
| `company_inactive` | 403 — `RequireCompanyRole` liveness gate on a tombstoned member company (`company is inactive`) |
| `not_found` | 404 — resource not found / not visible to the caller (including same-company IDOR collapse) |
| `conflict` | 409 — CAS/`If-Unmodified-Since` optimistic-concurrency mismatch (company or job PATCH/DELETE) |
| `company_not_active` | 409 — atomic live-company SQL gate miss (`company is not active`) |
| `industry_unavailable` | 409 — company creation referenced an inactive or unknown industry |
| `already_exists` | 409 — duplicate resource (company RFC, membership, application) |
| `payload_too_large` | 413 — request body exceeds the configured maximum |
| `method_not_allowed` | 405 — router method mismatch for a matched route |
| `service_unavailable` | 503 — database or service readiness failure |
| `internal_error` | 500 — unexpected internal failure (never carries internals in the body) |

The catalog MUST evolve additively: existing codes MUST NOT be removed or repurposed to a different outcome class; new codes MAY be appended for new outcome classes. Codes are not localized; only the `error` message is localized by clients.

#### Scenario: same outcome class yields the same code

- GIVEN two requests producing the same outcome class (e.g., two different 400 validation failures)
- WHEN both responses are returned
- THEN both bodies carry the same stable `code` value even if the English `error` messages differ

#### Scenario: catalog is a closed set referenced by handlers

- GIVEN a static scan of the domain HTTP handlers
- WHEN every emitted `code` value is collected
- THEN each code is a member of the single canonically-declared catalog set and no handler declares its own code literal

### Requirement: Minimum Structured Observability

The API server MUST emit structured (JSON) logs with, per request: a request ID that is generated once per request and attached consistently to all log lines for that request (including domain/error logs), HTTP method, path, response status, and duration. Error logs MUST carry a safe error classification (status/code class), never raw internals. The server MUST log startup (with effective non-secret configuration) and shutdown events. The system MUST provide minimal in-process metrics interfaces (at least counters and gauges) covering HTTP requests, the DB connection pool, and readiness state, with a no-op default implementation so that no exporter wiring exists in this change; exporter destination selection is deferred to the AWS phase.

#### Scenario: request logs are correlated and complete

- GIVEN any served request
- WHEN its structured log lines are inspected
- THEN every line for that request carries the same request ID, and the request log includes method, path, status, and duration

#### Scenario: startup and shutdown are logged

- GIVEN the API process starts and later receives a shutdown signal
- WHEN its structured logs are inspected
- THEN a startup event with non-secret effective configuration and a shutdown event are both present

#### Scenario: metrics interfaces exist with a no-op default and no exporter

- GIVEN the composition root assembles the server without any exporter configuration
- WHEN the application runs and serves traffic
- THEN the metrics interfaces record increments/state in-process (no-op default), no external metrics endpoint/exporter is wired, and the application builds and runs without any exporter dependency

### Requirement: Repository-Enforced Quality Gates

The repository MUST provide reproducible, locally runnable gate commands (Make targets or equivalent scripts) that a contributor or CI can run without cloud resources, covering at minimum:

- `go build ./...` MUST pass;
- `go vet ./...` MUST pass;
- a gofmt check MUST pass (no formatting drift);
- `go test ./...` (unit) MUST pass;
- race tests for suitable packages MUST pass;
- the serial live integration suite `go test -tags=integration -p 1 ./... -count=1` MUST pass with ZERO unexpected skips (R4: the known `TestSoftDeleteCompany_RollbackOnCloseFailure_Placeholder` skip MUST be replaced before GO, and no skip may survive unexplained);
- a migration round-trip (fresh up/down/up, see `Migration Executable`) MUST be deterministic;
- a sqlc generation drift check MUST pass (generated code matches the checked-in queries).

The gate commands and their acceptance semantics are canonical here; the AWS-hosted CI/CD resource itself is out of scope (AWS-phase work).

#### Scenario: the full gate runs locally and passes on a compliant tree

- GIVEN a clean checkout with a reachable Postgres for the integration suite
- WHEN every gate command runs
- THEN all commands exit 0 and the integration suite reports zero unexpected skips

#### Scenario: an unexpected integration skip fails the gate

- GIVEN the integration suite reports a skip that is not an explicitly whitelisted, explained skip (with the whitelist empty at GO time)
- WHEN the gate evaluates the suite result
- THEN the gate reports failure naming the unexplained skip

#### Scenario: sqlc drift fails the gate

- GIVEN a checked-in query file edited without regenerating sqlc output
- WHEN the sqlc drift check runs
- THEN the gate reports failure (generated code no longer matches the queries)

### Requirement: Architecture Guard

The repository MUST enforce the architecture boundaries (decision A1) in CI-runnable form (linter configuration or AST tests): cross-feature imports of another feature's infrastructure packages MUST fail the gate; the narrow documented exceptions — cross-feature domain-port imports and the audit co-write type imports — MUST remain allowed and MUST be explicitly listed in the guard's documented exception set; the authenticated route topology (gated write subtrees on per-route middleware mounts, separate from public mounts) MUST be guarded against composition-root drift. No broad cross-feature refactor is in scope (locked non-goal).

#### Scenario: cross-feature infrastructure import fails the gate

- GIVEN a change that adds an import of another feature's `infrastructure/...` package (not in the documented exception set)
- WHEN the architecture guard runs
- THEN the guard fails naming the offending import

#### Scenario: documented exceptions remain allowed

- GIVEN the narrow approved exceptions (cross-feature domain-port imports and audit co-write type imports)
- WHEN the architecture guard runs on the existing tree
- THEN the guard passes and the exception set is documented alongside the guard

#### Scenario: route topology drift fails the gate

- GIVEN a change that moves a gated write route onto the public mount (or removes a middleware from a gated subtree)
- WHEN the route-topology guard runs
- THEN the guard fails

### Requirement: Traceability Matrix and AWS Go/No-Go Evidence Contract

The system MUST produce, as the final closure artifact, an executable traceability matrix plus an AWS go/no-go report:

- The traceability matrix MUST list every MUST canonical requirement across all capabilities with (a) its single owning capability and (b) its test/evidence anchor (migration, SQL, Go symbol, route, or test). Every MUST requirement MUST name an anchor; the matrix MUST have no unexplained drift/test/runtime (D/R/T) row marked MUST. Capabilities with no behavior/contract change (canonical: `company-membership`, `applications`, `audit_events`) are proven complete through the matrix without any spec modification.
- The go/no-go report MUST state the gate result against every success criterion of the approved proposal (§9), naming each blocking item when the result is NO-GO. The report MUST verify the locked non-goals remain absent (no Docker/Terraform/workers/deployment resources smuggled into Go closure).

#### Scenario: matrix covers every MUST requirement with one owner and one anchor

- GIVEN the traceability matrix is generated from the canonical specs
- WHEN it is inspected
- THEN every MUST requirement appears exactly once with exactly one owning capability and a resolvable test/evidence anchor, and no MUST row is unexplained

#### Scenario: go/no-go report states a criterion-by-criterion result

- GIVEN all prior closure evidence exists
- WHEN the go/no-go report is produced
- THEN it states GO only if every proposal §9 criterion is satisfied, otherwise it states NO-GO and names every blocking item (including any locked non-goal violation)
