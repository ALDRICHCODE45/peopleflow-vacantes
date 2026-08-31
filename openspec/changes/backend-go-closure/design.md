# Design: Objective Go Backend Closure Before AWS

## 1. Outcome and review path

This design closes WS2–WS7 without adding AWS infrastructure or reopening approved product decisions. The implementation remains inside `backend/` except for explanatory closure evidence under `docs/`. AWS work remains **NO-GO** until the WS7 report proves every proposal §9 criterion.

**Traceability status:** paths, symbols, package names, and test selectors introduced by this document are design targets until tasks/apply creates or confirms them. Existing repository paths cited here are contextual evidence, not proof that future anchors exist. The final WS7 checker MUST inspect the candidate tree and resolve every recorded file, Go/SQL symbol, route, test function, and test selector; prose, generated Markdown, and this design cannot satisfy an anchor check.

Review in this order:

1. Confirm the dependency graph and work-unit boundaries in §3.
2. Confirm the shared runtime contracts in §§4–10.
3. Use the traceability matrix in §12 to verify single ownership and planned evidence.
4. Use §§13–15 to forecast review size, TDD evidence, rollout, and rollback.

## 2. Architectural decisions

| ID | Decision | Consequence |
|---|---|---|
| D1 | Shared HTTP errors live in `internal/shared/httpjson`, as a typed, versioned catalog plus one encoder. | Domain adapters classify domain errors to catalog entries; they do not define envelope mechanics or ad-hoc code strings. |
| D2 | Company create becomes `INSERT … SELECT` from a locking active-industry CTE inside the existing bootstrap transaction. | There is no application read-before-write gap; inactive/unknown industries return the dedicated `industry_unavailable` outcome and no owner membership can be written. |
| D3 | Migration SQL is embedded by a small package colocated with `db/migrations`; `cmd/migrate` consumes that `fs.FS`. | `go:embed` remains legal and the deployed executable has no working-directory dependency. |
| D4 | Every `cmd/migrate` operation acquires one fixed Postgres session advisory lock before invoking goose and releases it on exit. | Concurrent closure/deployment runners serialize; an interrupted runner releases the session lock when its connection closes. |
| D5 | The PostConfirmation executable is an event adapter and composition root only. | AWS event translation, config validation, Postgres wiring, and Lambda startup stay outside identity business logic. |
| D6 | Production JWT mode is an explicitly selected JWKS verifier; PEM is an explicitly selected local/test verifier. | Missing/invalid mode is a startup error; fetch or verification failure never causes mode fallback. |
| D7 | JWKS caching is a bounded whole-set cache with TTL, single-flight refresh, and one forced refresh for an unknown `kid`; shared fetches use a verifier-owned bounded context rather than any caller's context. | Rotation is supported without an unbounded key map or refresh storm; each waiter may cancel independently without cancelling the shared fetch, and a token receives at most one rotation refresh attempt. |
| D8 | API assembly is split into testable config, router, server, and lifecycle constructors while `cmd/api/main.go` remains the composition root. | Timeouts, health, limits, route topology, and graceful shutdown can be tested without sending OS signals to the whole process. |
| D9 | Logs use `slog` and metrics use narrow consumed-side interfaces with no-op defaults. | The closure has useful structured signals but no exporter, metrics endpoint, OTel wiring, or AWS dependency. |
| D10 | Closure evidence is data, not prose: a checked manifest plus generated Markdown and command receipts drive the go/no-go report. | Missing requirements, anchors, commands, or unexplained skips force NO-GO automatically. |
| D11 | Integration evidence runs serially with `-p 1`; concurrency is created only inside the specific race test. | Shared Postgres fixtures stay deterministic while the CAS and industry races still exercise true concurrent transactions. |

## 3. Work units and dependency order

```text
WS2A active-industry SQL ─┬─> WS2B direct adapters/constraints
                          └─> WS2C rollback injection ─> WS2D HTTP/CAS/races
WS3A candidate contract ────────────────────────────────┐
WS3B industries contract/route ─────────────────────────┤
WS4A embedded migrate ──────────────────────────────────┤
WS4B PostConfirmation executable ───────────────────────┤
WS5A verifier config ─> WS5B JWKS cache/rotation ─> WS5C middleware wiring
WS6A error catalog ─> WS6B router/server/health ─> WS6C logs/metrics
                                                       └─> WS7A gates
WS2–WS6 focused evidence ─────────────────────────────────> WS7B guards/matrix
WS7A + WS7B ──────────────────────────────────────────────> WS7C go/no-go report
```

WS2–WS6 may proceed independently after their own prerequisite unit, but integration is merged in the order shown. WS7 is last and consumes immutable evidence from all prior units.

| Unit | Deliverable and principal owners | Focused finish condition | Rollback boundary |
|---|---|---|---|
| WS2A | Active-industry CTE in `db/queries/companies.sql`, regenerated `internal/db/companies.sql.go`, bootstrap mapping. | Active succeeds; inactive/unknown return catalog `industry_unavailable`; deterministic two-order live race passes. | Revert query, generated output, mapper, and focused tests together. |
| WS2B | Direct live `CompanyRepository.Create`/`GetByID` and named CHECK evidence. | Persistence/read-back pass; both CHECK tests assert `23514` and exact constraint names with cleanup. | Test-only/adaptor evidence unit; no unrelated company behavior removed. |
| WS2C | Injectable transaction/query seam for inline job-close failure. | Placeholder is deleted; forced close error proves company/job/audit rollback and seam cleanup. | Remove only seam and its test; production happy path remains semantically identical. |
| WS2D | PATCH missing/malformed CAS, multi-field update, payload redaction parity, zero-audit failures, two-writer PATCH and DELETE races. | Exactly one winner per race; every specified failure keeps audit count; no skip. | Revert handler/test changes without reverting WS2A–C. |
| WS3A | Candidate replacement DTO/use case/repository contract. | `field_of_study` round-trips; omitted/null fields clear/default; `cv_s3_key` cannot be asserted and never appears on wire. | Candidate-only DTO/use-case/query/tests. |
| WS3B | Industries handler/SQL tests and one canonical route. | Active-only ordered array has exact fields; duplicate registration guard passes. | Industries tests/route change only. |
| WS4A | Embedded migrations package and `cmd/migrate`. | Binary-level clean up/down-to-base/up/status, idempotent up, advisory-lock serialization, and non-zero safe failure evidence pass. | Remove command and embed wrapper; existing Make/goose path remains. |
| WS4B | PostConfirmation Lambda executable and adapter. | Only PostConfirmation accepted; mapping/idempotency pass; errors propagate; production-disabled config refuses startup. | Remove executable/adapter and Lambda-specific modules; application handler remains. |
| WS5A | Explicit verifier configuration factory. | `jwks` and `pem` are the only values; production requires `jwks`; omitted/invalid configuration fails startup. | Revert factory while preserving the existing fail-closed PEM implementation for local use. |
| WS5B | JWKS source/cache/rotation verifier. | Known/unknown `kid`, TTL/size bound, one refresh under concurrent misses, independent waiter cancellation (including starter cancellation), verifier-owned fetch timeout, bounded `Close`, and RS256/claims/time failures pass against `httptest.Server` with no goroutine leak. | Remove JWKS implementation; no permissive production fallback is introduced. |
| WS5C | Middleware/composition integration. | API starts only with a valid explicit mode; auth routes preserve 401 fail-closed behavior and route guards. | Wiring-only rollback to explicit local PEM, never production downgrade. |
| WS6A | Typed error catalog and gradual handler adoption, preceded by the companies 409 wording correction described in §4. | Static catalog scan finds no handler code literals; all API errors retain `error` and add valid `code`; internals never reach clients; company PATCH 409 carries parity DTO in `data`. | Catalog adoption can be reverted by capability, but encoder compatibility remains additive. |
| WS6B | Router/server/lifecycle extraction, shared JSON decode/body limit, liveness/readiness, timeouts and graceful shutdown. | `httptest` and bounded network tests prove split health, fixed-length and chunked N/N+1 behavior, trailing-JSON rejection, no use-case call after decode failure, configured timeouts, and drain behavior. | Revert constructors/middleware as one runtime unit; domain code is untouched. |
| WS6C | Request correlation, structured lifecycle logs, DB/readiness/HTTP metrics interfaces and no-op implementation. | Captured JSON logs and spy metrics prove bounded fields, same request ID, and `path` equals a matched route pattern or bounded `unmatched`; no raw URL or exporter dependency exists. | Remove instrumentation implementation while retaining interfaces/no-op if callers already depend on them. |
| WS7A | Reproducible local gate targets/scripts. | Build, vet, fmt, unit, selected race, serial integration, migration, sqlc drift all return machine-readable receipts. | Gate files only; no runtime behavior rollback. |
| WS7B | Import/route/non-goal guards and traceability checker. | Forbidden infrastructure import and route mutations fail fixtures; manifest has exactly one row per effective MUST. | Guard/tooling files and manifest only. |
| WS7C | Generated traceability Markdown and objective AWS report. | GO only when all proposal §9 checks are PASS and skip whitelist is empty; otherwise all blockers are listed. | Regenerate after fixes; never hand-edit a NO-GO into GO. |

## 4. Central stable error catalog

### 4.1 Representation and immutable meanings

The design target `internal/shared/httpjson/errors.go` owns the only public catalog. It uses a typed code enumeration and an explicit version constant; it does not use marker fields or an exported mutable map:

```go
type Code string

const ErrorCatalogVersion = 1

const (
    CodeInvalidRequest          Code = "invalid_request"
    CodeInvalidStatusTransition Code = "invalid_status_transition"
    CodeUnauthenticated         Code = "unauthenticated"
    CodeForbidden               Code = "forbidden"
    CodeCompanyInactive         Code = "company_inactive"
    CodeNotFound               Code = "not_found"
    CodeConflict               Code = "conflict"
    CodeCompanyNotActive       Code = "company_not_active"
    CodeIndustryUnavailable    Code = "industry_unavailable"
    CodeAlreadyExists          Code = "already_exists"
    CodePayloadTooLarge        Code = "payload_too_large"
    CodeMethodNotAllowed       Code = "method_not_allowed"
    CodeServiceUnavailable     Code = "service_unavailable"
    CodeInternalError          Code = "internal_error"
)

type Definition struct {
    Code    Code
    Status  int
    Message string // stable English default
}

type ErrorEnvelope struct {
    Error string `json:"error"`
    Code  Code   `json:"code"`
    Data  any    `json:"data,omitempty"`
}
```

A package function resolves each `Code` with a closed `switch` and returns a `Definition` value, so callers cannot mutate shared catalog storage. Another function returns a fresh copy of the ordered code list for enumeration. Code, HTTP status, and default English message are declared together and immutable within catalog version 1. Additions are append-only and require an enumeration test plus traceability row; changing or removing an existing code/status meaning requires a new catalog version rather than silently repurposing V1.

The V1 catalog contains exactly 14 codes: the original 10 backend-runtime codes, the additive domain code `industry_unavailable`, and the three audited runtime/domain gaps `already_exists`, `method_not_allowed`, and `service_unavailable`. `industry_unavailable` is always HTTP 409 and exclusively means that company creation referenced an unknown or inactive industry. `already_exists` is 409 for duplicate RFC, membership, and application; `conflict` remains HTTP 409 for CAS/optimistic-concurrency mismatch on company PATCH/DELETE and job PATCH/DELETE and MUST NOT be reused for the industry gate or duplicate-exists cases. All other code/status meanings remain those listed in the backend-runtime spec.

`WriteError(w, definition)` writes JSON and the status from the resolved definition. No encoder accepts an internal `error` object. Domain classifiers return a catalog `Definition` (and, for the company/job PATCH/DELETE safe DTO semantics below, a safe DTO), not `(status, arbitraryMessage)`. Domain-specific English validation detail may be supplied only through a safe-message helper bound to a catalog definition; it cannot alter `code` or status. Internal errors are returned to the HTTP boundary, logged once with request context, and encoded as `internal_error`.

### 4.2 PATCH/DELETE conflict envelope and redaction parity

Every error remains an envelope. Therefore company PATCH conflict and job PATCH/DELETE conflict have the same exact envelope shape:

```json
{
  "error": "resource was modified; retry with the latest representation",
  "code": "conflict",
  "data": { "<exact redacted DTO fields>": "..." }
}
```

`data` is required for company PATCH and job PATCH/DELETE 409s and is exactly the same redacted DTO schema and constructor used for the 200 response body; for company DELETE (no CAS data available after the resource is gone), the 409 envelope is written without `data`. `ErrCompanyGone` maps to `company_not_active` (409) in the classifier. The `conflict` envelope uses `WriteCatalogErrorData`; the no-data 409 uses `WriteCatalogError`. It is not a second envelope and it never includes `rfc`, `status`, `deleted_at`, `created_at`, or `updated_at`. Tests decode the 200 body as the redacted DTO, decode the 409 as `{error,code,data}`, compare the 200 DTO to 409 `data`, and run the same forbidden-field assertions against both the 200 body and the 409 `data`. The outer 409's `error` and `code` are intentionally additional because the stable-envelope contract applies to every error.

This is the only consistent operational interpretation of the two binding contracts: backend-runtime requires every error to be an envelope, while companies requires 200/409 redacted-resource parity. Before implementation, the first WS6A task MUST apply a wording-only spec sync/correction to the companies delta if its phrase “response bodies ... same redacted shape” could be read as requiring the entire 409 body to equal the 200 body. That correction must state parity between the 200 body and 409 `data`; it does not change behavior or ownership.

### 4.4 Consumption and enforcement

- `httpjson` tests assert `ErrorCatalogVersion == 1` and enumerate the exact closed 14-code V1 set, unique strings, immutable code/status/default triples, content type, compatibility of `error`, and no accidental serialization of wrapped errors.
- Handler tests pin `industry_unavailable` for both inactive and unknown industries, `already_exists` for duplicate RFC/membership/application, and reserve `conflict` for CAS outcomes.
- Router-issued 404 (unmatched route), 405 (matched route but unsupported method), and recovered handler panics are all mapped to the catalog; custom router middleware writes the envelope for these.
- A WS7 AST check rejects string literals assigned to a `code` JSON field outside `httpjson` and rejects direct feature writes of error JSON.
- Domain specs continue to own business outcome classification. `backend-runtime` alone owns serialization, catalog evolution, and safe internal-error behavior.

## 5. Atomic active-industry SQL

`CreateCompany` becomes a single data-modifying statement:

```sql
WITH active_industry AS MATERIALIZED (
    SELECT id
    FROM industries
    WHERE id = sqlc.arg('industry_id') AND active = true
    FOR UPDATE
)
INSERT INTO companies (..., industry_id, ...)
SELECT ..., active_industry.id, ...
FROM active_industry
RETURNING *;
```

The statement executes inside `CompanyBootstrapRepository.CreateWithOwner`'s existing transaction. A zero-row return is mapped to a dedicated domain sentinel for “industry unavailable,” then to catalog `industry_unavailable` (409). The CAS-oriented `conflict` code is not involved. The membership insert occurs only after a company row is returned. Parameterization is retained.

`FOR UPDATE` is intentional: `FOR KEY SHARE` would not conflict with an update of the non-key `active` column. The lock establishes a linearization order with catalog maintenance updates. Under Postgres READ COMMITTED, if deactivation wins first, the waiting create rechecks the predicate and inserts zero rows. If create locks first, creation linearizes before deactivation; deactivation waits for commit. There is no state in which an application pre-check passes and a later unlocked INSERT ignores the committed deactivation.

Deterministic live evidence uses two connections and barrier channels, not sleeps:

1. **Deactivate-first:** transaction A updates `active=false` and holds before commit; transaction B starts create and is observed blocked; A commits; B returns the industry-unavailable outcome and no company/member exists.
2. **Create-first:** transaction A executes the locking create and holds before commit; transaction B attempts deactivation and is observed blocked; A commits; B proceeds. This proves serialization and documents that the create linearized while the catalog row was active.
3. **Inactive and unknown:** direct bootstrap calls return the same safe `industry_unavailable` classification and write neither table.

These tests run under the integration tag with `-p 1`; each case creates unique industry/company/user IDs and registers reverse-FK cleanup with bounded contexts.

## 6. Executable runtime boundaries

### 6.1 Embedded migration executable

`db/migrations/embed.go` uses `//go:embed *.sql` and exports a read-only `fs.FS`. Keeping the embed directive beside the SQL avoids illegal parent-directory patterns. `cmd/migrate` parses exactly `up`, `down`, and `status`, opens pgx's `database/sql` adapter, sets the goose Postgres dialect/base FS, and never logs the DSN.

Before any goose operation, the command reserves a dedicated `*sql.Conn`, executes `SELECT pg_advisory_lock($1)` with a fixed documented int64 key, and defers `pg_advisory_unlock`. Closure and future deployment targets call this executable and therefore share the lock. The existing Make/goose developer targets remain functional as required, are labelled local/manual, and are not accepted as deployment or closure evidence because external goose does not participate in this executable's advisory-lock protocol. Re-running `up` is idempotent through goose's version table.

Exit contract:

- invalid command/config/open/ping/lock/migration/unlock-critical failure: safe structured error and non-zero;
- successful `up`, `down`, or `status`: zero;
- context cancellation while waiting for the advisory lock: non-zero;
- logs contain command and classified stage, never credentials or raw DSN.

The round-trip harness uses a disposable database, snapshots normalized `pg_catalog` objects/constraints/indexes after first and second `up`, and compares them after down-to-base/up. It invokes the built command boundary rather than goose package helpers.

### 6.2 PostConfirmation executable

A narrow adapter package converts the AWS PostConfirmation event's `request.userAttributes` into `application.PostConfirmationEvent`. It rejects other trigger sources before invoking the handler. `cmd/postconfirmation/main.go` validates environment, opens/pings Postgres, constructs the existing user repository and `PostConfirmationHandler`, and starts the Lambda runtime.

Production config (`APP_ENV=production`) requires `IDENTITY_POSTCONFIRMATION_ENABLED=true`; unset, false, or malformed values fail construction/startup. Local/test may explicitly set false and preserve the application handler's no-op behavior. Adapter errors are returned unchanged to the Lambda runtime so Cognito sees invocation failure and may retry. Logs classify the failure but do not swallow it or log email/name attributes.

The adapter is tested without a deployed Lambda. A fake application handler proves translation and error propagation; a live repository integration proves duplicate delivery leaves one user. Only service-specific Lambda event/runtime dependencies are added and pinned.

## 7. Production-safe JWT verification

### 7.1 Explicit modes and configuration

`IDENTITY_JWT_MODE` is required and accepts only `jwks` or `pem`.

| Mode | Required configuration | Environment rule |
|---|---|---|
| `jwks` | HTTPS issuer, audience/client ID, expected `token_use`, bounded TTL, fetch timeout; JWKS URL is derived from the normalized issuer or explicitly validated as same-origin for tests. | Required in production. |
| `pem` | Public PEM, issuer, audience. | Local/test only; production rejects it. |

The API returns a startup error for missing/unknown mode, malformed issuer, empty audience/token-use, invalid TTL, invalid PEM, or production PEM. The current “warn and install deny-all” composition behavior is replaced: production cannot appear healthy while all authenticated traffic is unusable. Runtime verification still fails closed with 401.

### 7.2 Cache and rotation

The JWKS verifier owns:

- a mutex-protected immutable key-set snapshot and expiry;
- maximum accepted key count and response byte size;
- TTL clamped between configured minimum and maximum;
- exactly one in-flight refresh record shared by concurrent callers;
- a verifier lifecycle context, cancellation function, and wait group;
- a required positive fetch timeout and an `http.Client` with bounded transport timeouts;
- validation that every selected key has a non-empty `kid`, RSA type, and RS256 compatibility.

Verification flow:

1. Parse only enough protected header to require `alg=RS256` and a non-empty `kid`; never trust claims before signature verification.
2. Read a non-expired cached snapshot. On miss/expiry, join or start one shared refresh.
3. The starter launches the refresh under `context.WithTimeout(verifierLifecycleContext, fetchTimeout)`, never under the starter's request context. The JWKS HTTP request uses that bounded verifier-owned context. The refresh publishes one immutable result, clears the in-flight record under the mutex, and closes a completion channel exactly once.
4. Every caller, including the starter, waits with `select { case <-refresh.done: ...; case <-requestContext.Done(): ... }`. A cancelled waiter returns its own context error immediately but never invokes the shared refresh cancel function. Waiting creates no per-waiter goroutine.
5. If `kid` is absent after the normal lookup, force at most one bounded shared refresh even when TTL has not expired, then reject if still absent.
6. Verify signature and require exact issuer, audience membership, configured `token_use`, non-empty subject, `exp`, and standard time validation (`exp` and `nbf`; `iat` cannot be unreasonably in the future under the small configured clock skew).
7. Return normalized subject/groups or an error; middleware maps every verifier error to catalog `unauthenticated` without exposing why.

A failed refresh never extends expiry. A still-valid cached key set may serve known keys until its original expiry during a transient refresh failure; unknown keys and expired caches fail closed. Cache replacement is whole-set and bounded, so removed keys disappear at the next successful refresh. `Close` cancels the verifier lifecycle context and waits for the in-flight refresh wait group; the fetch timeout and HTTP cancellation guarantee bounded completion. The refresh goroutine has no unbuffered result send and always closes its completion channel, so caller cancellation cannot strand it.

Table-driven tests use generated RSA keys and `httptest.Server` to prove known `kid`, wrong algorithm/type, issuer/audience/token-use/time failures, unknown-`kid` rotation, response/key bounds, TTL replacement, server errors, malformed JSON, and no PEM fallback. Concurrency tests specifically prove: one HTTP refresh under concurrent misses; cancelling the first/starter request lets that caller stop waiting while another waiter succeeds from the same refresh; cancelling any other waiter does not affect the fetch; and a stalled server observes cancellation at the verifier-owned fetch deadline. Tests call `Close`, assert bounded return, and use package-level goroutine-leak detection (or an equivalent wait-group assertion) so no refresh goroutine survives. An injected clock controls TTL; only bounded synchronization channels/deadlines, never sleeps as correctness conditions, coordinate fetch tests.

## 8. HTTP hardening and observability

### 8.1 Server and router

Proposed runtime packages are deliberately small:

- `internal/runtime/config`: typed environment parsing and safe effective-config view;
- `internal/runtime/server`: `http.Server` construction and lifecycle;
- `internal/runtime/health`: liveness/readiness handlers with a narrow `Ping(ctx)` port;
- `internal/runtime/middleware`: body limits, request context/logging, CORS policy, and optional limiter;
- `internal/runtime/metrics`: narrow interfaces and no-op implementation.

`cmd/api/main.go` composes these packages and feature adapters. Existing route AST guards move with router construction and scan the actual router owner rather than assuming every route remains textually in `main.go`.

The typed server config requires positive read-header, read, write, idle, readiness, and drain timeouts. The closure pins the JSON request-body limit to `N = 1,048,576` bytes (1 MiB); a future additive config may only lower it per route unless the canonical contract and boundary evidence are updated.

Body enforcement is a shared decode boundary, not error translation attempted solely in middleware:

1. Optional middleware pre-rejects a valid `Content-Length > N` before dispatch and writes `payload_too_large`; it never trusts Content-Length as complete coverage and never pre-buffers the body.
2. Every handler that accepts JSON MUST call the shared design-target helper `httpjson.DecodeJSON(w, r, dst, N)` before invoking any use case. Direct `json.Decoder` use in feature handlers is rejected by the WS7 AST guard.
3. The helper wraps the streaming body with `http.MaxBytesReader(w, r.Body, N)`, decodes exactly one JSON value, and performs a second decode that must return `io.EOF`. It uses `errors.As(err, *http.MaxBytesError)` on both decode attempts and returns the typed catalog definition `payload_too_large` (413) for that condition. Other decode errors, an empty body where a body is required, and any trailing JSON/value return `invalid_request` (400). The helper never writes a response itself, so there is one encoding point.
4. The handler writes the returned definition through `WriteError` and returns immediately, so no domain use case or repository is invoked. The capped body is closed without draining or buffering arbitrary attacker-controlled content after rejection.

This division is required because middleware cannot centrally translate a `*http.MaxBytesError` produced later by a downstream decoder, and chunked requests have no reliable Content-Length. Shared-helper tests pin exactly N bytes and N+1 bytes for both fixed-length requests (`Content-Length` set) and chunked requests (`ContentLength = -1`), asserting N reaches the handler only when it is valid JSON, N+1 receives the 413 envelope, and a spy use case remains untouched on rejection. Separate tables cover malformed JSON, two concatenated JSON values, and trailing non-whitespace. A bounded real-server test complements `httptest` so transfer framing follows `net/http` behavior.

`/healthz` writes a static 200 without touching the DB port. `/readyz` calls the narrow ping port with its own shorter timeout and returns static 200 or safe 503 JSON; readiness failure updates a gauge and logs only a safe classification. Graceful shutdown is driven by an injected context in tests and OS signals in `main`: stop accepting, call `Shutdown` with the drain deadline, then `Close` only if the deadline expires.

### 8.2 CORS and rate limiting boundary

The approved specs do not make CORS or application rate limiting GO criteria, so this design does not silently promote them to new domain requirements. Their production-safe closure posture is nevertheless explicit:

- **CORS:** no allowlist means no cross-origin permission headers (default deny). If configured, origins are an exact normalized allowlist; credentials are disabled unless separately explicit; wildcard plus credentials is rejected. Preflight never bypasses route authentication for the actual request. Unit tests pin default-deny and exact-match behavior.
- **Rate limiting:** a narrow middleware port and route-class key (`public-read`, `authenticated-write`, `health`) may be provided with a no-op default. Any in-process token-bucket implementation is SHOULD-tier and must use bounded buckets with periodic eviction and a trusted client-key policy; it is not an AWS GO blocker because ingress topology and trusted proxy headers are deferred. Health probes are not accidentally throttled. No handler trusts arbitrary `X-Forwarded-For` unless trusted-proxy configuration is explicitly enabled.

Tasks must label optional limiter implementation as SHOULD and may not displace any MUST evidence.

### 8.3 Logs and metrics

A request middleware generates or accepts chi's request ID once, places it in context, wraps the response writer to capture status/bytes, and emits one completion record with bounded fields: `request_id`, `method`, `path`, `status`, `duration`, and catalog code class. The required `path` key contains the matched chi route pattern, never `r.URL.Path` or another raw URL. If no matched pattern exists (for example, a router-level 404), it uses the bounded constant `unmatched`, not attacker-controlled text. Captured-log and metric-spy tests send multiple random unknown URLs and prove they all emit `path=unmatched`; known parameterized routes emit their template such as `/companies/{id}`. Domain errors are returned with context and logged once at the HTTP boundary. Logs exclude tokens, request bodies, CV keys, email/name attributes, DSNs, and raw DB errors in client-facing fields.

Startup logs include address and timeout/limit values but no secrets. Shutdown logs include reason and graceful/forced classification.

Narrow interfaces are defined where consumed, for example:

```go
type HTTPMetrics interface { ObserveRequest(method, route string, status int, d time.Duration) }
type DBMetrics interface { ObservePool(acquired, idle, max int32) }
type ReadinessMetrics interface { SetReady(bool) }
```

The default implementation does nothing and allocates no exporter. A test spy proves calls and bounded labels. A lightweight sampler may observe `pgxpool.Stat()` on request/readiness boundaries without a background goroutine; no metrics endpoint is added.

## 9. Quality and architecture gates

`backend/Makefile` delegates to small checked-in scripts where shell logic is necessary. Required targets are:

```text
make gate-build        go build ./...
make gate-vet          go vet ./...
make gate-fmt          fail if gofmt -l reports files
make gate-unit         go test ./... -count=1
make gate-race         go test -race <documented suitable packages> -count=1
make gate-integration  go test -tags=integration -p 1 ./... -count=1 -json
make gate-migrations   built cmd/migrate clean up/down-to-base/up/status
make gate-sqlc         sqlc generate in a clean temp copy, then diff generated outputs
make gate-arch         import, route, error-catalog, traceability, and non-goal guards
make closure-gate      all required targets and receipt/report generation
```

The integration wrapper parses `go test -json`; any `Action:"skip"` is a failure. The whitelist is an explicit checked file and MUST be empty for GO. Missing `DATABASE_URL`, unreachable Postgres, or missing fixtures fails the closure gate rather than converting evidence into skips. Individual developer integration tests may retain environment skips outside the closure invocation, but the gate preflight makes those branches unreachable and still rejects emitted skips.

Required static gates are `go test`-based or small Go commands so they run locally and in future CI:

- import guard walks `go list -json ./...`; feature A cannot import feature B's `infrastructure/**`;
- allowed cross-feature domain ports/types and audit co-write types are exact package/path entries, not wildcards;
- route guard checks public mounts and auth/role middleware topology after router extraction;
- catalog guard rejects ad-hoc error codes;
- non-goal guard rejects newly introduced Docker/Terraform/workers/outbox/deployment-resource paths for this closure;
- traceability guard validates the effective requirements and resolvable anchors.

SHOULD targets (`golangci-lint`, `govulncheck`, coverage trend, fuzz boundaries, broader race) are reported separately and cannot be represented as required PASS unless tasks explicitly elevate them without displacing MUST work.

## 10. Traceability and objective go/no-go generation

### 10.1 Artifacts

WS7 owns these implementation-time artifacts:

- `backend/quality/traceability.json`: source manifest, one object per effective MUST requirement;
- `backend/quality/receipts/*.json`: command, commit/tree identity, start/end time, exit status, test counts, skip names, and normalized artifact hashes;
- `docs/backend-go-closure-traceability.md`: generated human view;
- `docs/aws-go-no-go.md`: generated criterion-by-criterion proposal §9 result.

The checker reads canonical `openspec/specs/*/spec.md` plus this change's delta specs while the change is active. An ADDED title is appended; a MODIFIED title replaces the canonical title of the same capability. After archival, canonical specs alone produce the same effective set. Duplicate titles, duplicate owners, missing manifest rows, extra rows, missing paths/symbols/tests, and zero anchors fail.

Each manifest record contains `requirement`, `capability`, `tier`, `owners` (Go/SQL/migration/route), and `evidence` (focused unit/integration/static command and test selector). The generated Markdown is never the source of truth.

### 10.2 Report algorithm

The report generator starts at NO-GO and flips to GO only when:

1. traceability validation passes with exactly one owner and at least one resolvable anchor for every MUST;
2. all required receipts match the same tree identity and exit zero;
3. integration skip count and whitelist length are zero;
4. built executables and runtime boundary tests are present;
5. every proposal §9 criterion is mapped to passing receipt/manifest rows;
6. locked non-goal scans pass.

Stale/missing receipts are blockers. The generator lists all blockers in one run and never accepts a manual waiver or `size:exception` as technical evidence.

## 11. Strict TDD evidence protocol

Every work unit records four stages in its implementation notes/receipt:

| Stage | Required evidence |
|---|---|
| RED | Focused test/guard added first; exact command and expected failure reason showing the missing behavior, not a compile accident. |
| GREEN | Smallest implementation makes the focused command pass. Integration units use live Postgres with `-tags=integration -p 1 -count=1`. |
| TRIANGULATE | Add at least one independent edge/counterexample: opposite race order, unknown key/id, null/omitted value, failure/cancellation, or boundary-size input. |
| REFACTOR | Improve names/seams/duplication with focused tests still green, then run `go test ./...`; DB-touching units also rerun the serial integration selector. |

Stage mapping by unit:

| Unit | RED | TRIANGULATE |
|---|---|---|
| WS2A | Inactive/unknown industry currently reaches FK/create behavior. | Both lock acquisition orders, owner-row absence, and exact 409 `industry_unavailable` mapping. |
| WS2B | Direct adapter/named-constraint assertions absent. | Valid read-back and both exact constraint names. |
| WS2C | Existing placeholder skip is the RED evidence and must be replaced by a failing assertion. | Error before commit proves company, jobs, and audit all unchanged. |
| WS2D | Missing/malformed CAS and race tests fail. | PATCH and DELETE each prove one winner; all failed status classes prove zero audit. |
| WS3A | DTO tag/full-replacement/CV wire tests fail. | Omitted versus explicit null, empty arrays/default MXN, preexisting reserved CV value omitted. |
| WS3B | Inactive/order/exact-shape/single-route tests fail. | Tied sort order, DB failure, Authorization header ignored. |
| WS4A | Command build/embedded round-trip tests fail because command is absent. | Idempotent up, lock contention/cancellation, unreachable DB safe failure. |
| WS4B | Adapter/config tests fail because executable is absent. | Wrong trigger, repeated delivery, local disabled and production disabled. |
| WS5A–C | Explicit mode/JWKS tests fail against PEM-only wiring. | Rotation, one concurrent refresh, starter/other-waiter cancellation independence, verifier fetch deadline, bounded close/no leak, expiry, malformed/fetch failures, no fallback. |
| WS6A | Envelope/catalog compatibility tests fail on current message-only JSON. | Exact V1 enumeration, `industry_unavailable`, safe internal error, and 200 body versus 409 `data` parity with forbidden-field checks on both. |
| WS6B | DB-dependent health and missing timeout/body tests fail. | DB-down health split; fixed-length and chunked N/N+1; trailing JSON; use-case non-invocation; graceful and forced drain. |
| WS6C | Captured logs/spy metrics lack required fields/calls. | Success/error/readiness/startup/shutdown, matched-pattern `path`, randomized unknown URLs collapsing to `unmatched`, and no-op assembly. |
| WS7A–C | Mutation fixtures prove each gate initially misses its violation. | Skip, import, route, sqlc, stale receipt, non-goal, and missing-anchor mutations each force NO-GO. |

No work unit may claim RED from a test written after implementation. Exact command output, runtime harness result (or justified N/A), and rollback boundary stay with the unit.

## 12. Executable traceability-matrix design

The rows below seed `traceability.json`; every listed owner path, symbol, and evidence selector is a **design target**, not an assertion that it already exists. Existing tests may be reused only after the checker confirms their actual function names and that their assertions cover the requirement. During apply, the manifest records the final concrete path plus Go/SQL symbol or route and the exact test function/selector. The final checker parses or enumerates the candidate tree and fails missing paths, unresolved symbols/routes, selectors matching zero tests, and tests that were renamed; it never trusts this prose or generated Markdown. The effective set includes the six completed change specs plus unchanged canonical capabilities.

### 12.1 Backend runtime, industries, and changed capabilities

| Capability — MUST requirement | Go/SQL/migration owner | Focused evidence |
|---|---|---|
| backend-runtime — Migration Executable (`cmd/migrate`) | `db/migrations/embed.go`; `cmd/migrate/**`; all `db/migrations/*.sql` | `go test -tags=integration -p 1 ./cmd/migrate ./db/migrations -run 'TestMigrate' -count=1` plus binary harness |
| backend-runtime — Health Liveness and DB Readiness Split | `internal/runtime/health`; router owner | unit `TestHealthz_*`, `TestReadyz_*` with fake ping; live readiness case |
| backend-runtime — HTTP Server Hardening | `internal/runtime/server`; shared `httpjson.DecodeJSON`; optional Content-Length precheck middleware | target `TestServerConfig`, fixed-length/chunked `TestDecodeJSON_BodyLimit_NAndNPlusOne`, trailing-JSON test, use-case non-invocation test, `TestGracefulShutdown` |
| backend-runtime — Stable Error Envelope | `internal/shared/httpjson` | `go test ./internal/shared/httpjson -run 'Test(ErrorEnvelope|InternalError)'` and handler contract scan |
| backend-runtime — Stable Error-Code Catalog | `internal/shared/httpjson/errors.go` | target V1 exact-enumeration/immutable-meaning test, `industry_unavailable` mapping tests, and WS7 AST literal guard |
| backend-runtime — Minimum Structured Observability | runtime request middleware and `internal/runtime/metrics` | captured-slog and spy/no-op metric tests |
| backend-runtime — Repository-Enforced Quality Gates | `Makefile`; `scripts/closure/**` | mutation tests for each target; `make closure-gate` receipt |
| backend-runtime — Architecture Guard | `internal/tools/archguard` or equivalent test package | forbidden-import fixture, allowed-exception fixture, route mutation fixtures |
| backend-runtime — Traceability Matrix and AWS Go/No-Go Evidence Contract | `quality/traceability.json`; closure report generator | missing/duplicate/extra anchor tests; stale receipt and NO-GO/GO fixtures |
| industries — Public Active-Catalog Endpoint | `features/industries/infrastructure/http/handler.go` | handler exact-shape/public/error table tests |
| industries — Active-Only Catalog Semantics | `db/queries/industries.sql`; generated adapter | live active/inactive and `sort_order,id` test |
| industries — Single Canonical Route Registration | router owner | static route count plus endpoint smoke test |
| candidates — Candidate Profile Field Matrix | candidate request/response DTO, service, repository/query, migration `00006` | handler JSON matrix plus live replacement persistence test |
| candidates — CV Storage Key Reserve Semantics | candidate DTO/mapper/repository boundary; migration `00006` retained | request assertion rejection/ignore test, response omission test, column-exists static/live test |
| candidates — Field Validation (modified) | candidate VOs/use case and HTTP tags | enum/skills tests plus `field_of_study` static and round-trip tests |
| candidates — Self-Service Profile Access | candidate handler/service/repository | existing candidate handler/service access tests |
| candidates — Ownership Invariant (No IDOR) | subject-to-user resolution in candidate service | existing no-path-ID and subject-resolution tests |
| candidates — Languages List Management | candidate language service/repository SQL | existing replace/list unit and live transaction tests |
| candidates — Profile Lifecycle | candidate migration/repository | existing create/read/update lifecycle tests plus replacement regression |
| candidates — Authentication Required | API router and `RequireAuth` | middleware tests and `/me/profile` route guard |
| companies — Public Company Create Endpoint | company handler/use case/bootstrap repository; companies/member SQL | handler create tests and live bootstrap atomicity/read-back |
| companies — Public Company Read Endpoint | handler/service, `GetCompanyByID` SQL | public redaction, invalid UUID, missing/tombstone parity tests |
| companies — Atomic Active-Industry Create Gate | locking CTE in `companies.sql`; bootstrap repository | target WS2A inactive/unknown exact 409 `industry_unavailable` assertions and two-order deterministic live race |
| companies — Companies Write-Surface Evidence Contract | companies HTTP/postgres suites and constraints | W1–W6 named focused selectors, zero skip |
| companies — PATCH /me/company Endpoint, Owner-Only Gate, and Field Mutability | company handler/use case/update SQL | handler gate/field table and multi-field live update |
| companies — PATCH /me/company CAS Optimistic Concurrency Control | update SQL CAS | stale/missing/malformed and two-writer PATCH integration |
| companies — PATCH /me/company Response Shape | redacted DTO and error-envelope `data` | 200/409 redacted payload parity and forbidden-field assertions |
| companies — DELETE /me/company Endpoint, Owner-Only Gate, and Idempotency | delete handler/use case/repository | handler authorization/idempotency tests |
| companies — DELETE /me/company CAS Optimistic Concurrency Control | soft-delete SQL/repository transaction | stale/malformed and two-writer DELETE integration |
| companies — Soft-Delete Atomic Transactional Close of Jobs | company repository transaction and jobs close SQL | happy-path invariants and deterministic close-failure rollback |
| companies — Soft-Deleted Company Read Visibility | company read SQL/repositories | existing tombstone read/membership visibility live tests |
| companies — Authorization Dispatch Order for /me/company Writes | router + role middleware + handler | route AST and error-order table tests |
| companies — Audit Events for Companies | company use cases/repository plus audit append port | existing success co-write tests and new zero-audit failure tables |
| identity — Production PostConfirmation Lambda Boundary | adapter and `cmd/postconfirmation`; existing application handler | adapter unit/build/config tests and live idempotent redelivery |
| identity — PostConfirmation Handler (modified) | `identity/application/post_confirmation.go` | existing group/flag/idempotency tests plus adapter boundary tests |
| identity — JWT Middleware (modified) | identity middleware and router | middleware invalid-case table and `/me` route guard |
| identity — JWT Verification Modes | verifier config factory; PEM/JWKS implementations | local JWKS crypto table, explicit-mode/startup/no-fallback tests |
| identity — users Schema Migration | migration `00005`; users SQL | existing `00005_integration_test.go` |
| identity — Identity Value Objects | identity valueobjects | existing email/name/type unit tables |
| identity — User Entity and Factory | identity entity | existing entity factory tests |
| identity — Identity Sentinel Errors | identity entities | existing sentinel `errors.Is` tests |
| identity — CreateUser Persistence is Idempotent | users SQL/repository | existing unit/live duplicate-sub tests |
| identity — User Reads | users SQL/repository/use cases | existing GetByID/GetByCognitoSub tests |
| identity — mapCreateError Translation | identity postgres mapper | existing SQLSTATE/constraint mapping tests |
| identity — Identity Use Cases | identity application use cases | existing create/get use-case tests |
| jobs — Status Domain (modified) | jobs status VO, read SQL, gated patch route | existing default/visibility/transition/route tests; stale-text static guard |

### 12.2 Unchanged `company-membership`

No empty spec delta is created. Every canonical MUST remains represented:

| MUST requirement | Go/SQL/migration owner | Focused evidence |
|---|---|---|
| company_members Schema Migration | migration `00009`; company member SQL | `db/migrations` 00009 up/down/check/unique live tests |
| Membership Resolution from Authenticated Subject | membership service + identity user port | existing subject resolution/no-member tests |
| GetMyMembership | member handler/service/repositories | existing unit/live no-IDOR and tombstone tests |
| ListMembers | member handler/service/repository | existing list ordering/redaction live tests |
| AddMember (Owner-Only) | member handler/service/repository | existing owner/duplicate/type tests |
| UpdateRole (Owner-Only, Same-Company) | member handler/service/repository | existing owner/same-company/last-owner tests |
| RemoveMember (Owner-Only, Same-Company) | member handler/service/repository | existing owner/same-company/last-owner tests |
| RequireCompanyRole Middleware | identity role middleware + liveness port | existing role/liveness/error-order tests |
| HTTP Surface Under /me/company | router owner and member handlers | existing route topology AST tests |

### 12.3 Unchanged `applications`

No empty spec delta is created. Each row remains owned by applications even where it co-writes through the narrow audit port.

| MUST requirement | Go/SQL/migration owner | Focused evidence |
|---|---|---|
| Applications Schema Migration | migration `00010`; applications SQL | existing 00010 up/down/constraint/index integration |
| Status Domain | application status VO/schema | existing status VO and migration tests |
| Status Transition Matrix | status VO/use case | existing transition table tests |
| Apply Endpoint | application handler/service | existing apply handler/use-case tests |
| Candidate Identity Resolution (No IDOR) | application service + identity user port | existing subject resolution tests |
| Atomic Apply Eligibility Gate | application repository transaction/SQL | existing live eligibility race/rollback tests |
| No Double-Apply | partial unique constraint/apply SQL | existing duplicate/race live tests |
| Apply Domain Validation | DTO/use case/domain | existing validation tables |
| Apply Response | application DTO/handler | existing response contract tests |
| Apply Error Taxonomy | application classifier + shared catalog adoption | existing error table plus WS6 envelope scan |
| Apply Route Security Boundary | API router | existing candidate-apply route AST guard |
| Candidate My Applications Endpoint | handler/service/repository | existing list-my tests |
| Candidate My Applications DTO Shape | application DTO mapper | existing DTO/redaction tests |
| Recruiter List Endpoint | recruiter handler/service/repository | existing recruiter list tests |
| Recruiter List Same-Company Invariant | repository SQL/service | existing cross-company collapse tests |
| Recruiter List Cap | list query/service | existing cap boundary tests |
| Soft-Deleted Job Applications Stay Recruiter-Accessible | applications read SQL | existing soft-deleted-job history live test |
| Recruiter Detail Endpoint | handler/service/repository | existing detail tests |
| Recruiter Detail Same-Company Invariant | repository/service | existing IDOR tests |
| Recruiter Detail PII Minimization | detail DTO | existing forbidden-field tests |
| Recruiter Transition Endpoint | transition handler/service/repository | existing transition endpoint tests |
| Recruiter Transition Matrix Enforcement | transition domain/use case | existing legal/illegal table tests |
| Recruiter Transition Lost Race | atomic transition SQL | existing concurrent live transition test |
| Recruiter Transition Same-Company Invariant | transition query/service | existing cross-company tests |
| Recruiter Transition Error Taxonomy | classifier + shared catalog adoption | existing table plus WS6 envelope scan |
| Recruiter Route Security Boundary | API router | existing recruiter subtree AST guard |
| ApplicationSubmitted Audit Emission | applications repository + audit port | existing live event shape test |
| ApplicationTransitioned Audit Emission | applications repository + audit port | existing live event shape test |
| Transition Actor Identity (CompanyContext UserID) | role context + transition event builder | existing actor ID tests |
| Fail-Closed Application + Audit Co-Write | applications transaction + audit adapter | existing forced audit failure rollback live test |

### 12.4 Unchanged `audit_events`

No empty spec delta is created.

| MUST requirement | Go/SQL/migration owner | Focused evidence |
|---|---|---|
| Audit Events Schema Migration | migration `00011`; audit SQL | existing 00011 schema/constraint/index live tests |
| Actor Type Vocabulary | audit entity | existing vocabulary tests |
| Event Type Vocabulary (Closed Set for This Cycle) | audit entity constants | existing event vocabulary tests |
| Append-Only Port | audit repository port/adapter | existing compile-time/port tests and absence-of-update guard |
| Co-Write Atomicity Contract | consuming repositories and audit adapter | existing applications/companies rollback integration |
| Metadata Shape (PII-Free) | audit entity/event builders | existing metadata allowlist/PII tests |

### 12.5 Remaining unchanged jobs requirements

The Status Domain row is in §12.1 because its text changes; all other canonical MUST rows remain owned by jobs.

| MUST requirement | Go/SQL/migration owner | Focused evidence |
|---|---|---|
| Public Read Endpoints | job handler/service/read SQL | existing public list/detail tests |
| Read-Side Visibility Rule | jobs read SQL | existing published/live-company visibility integration |
| Jobs Schema Migration | migrations `00007`/`00008` | existing migration/index/seed tests |
| Full-Text Search | jobs search vector/index/query | existing ranking/query integration |
| Listing Filters | search DTO/query | existing filter tables |
| Keyset Pagination | cursor package/query | existing cursor and page-boundary tests |
| Enum Invariants | job VOs/schema checks | existing VO/migration tables |
| PATCH /jobs/{id} Endpoint and Gate | job handler/service/router | existing handler and AST gate tests |
| Field Editability Matrix | update DTO/use case/query | existing omitted/null/immutable field tables |
| Status Transition Table | status VO/use case | existing legal/illegal transitions |
| CAS Optimistic Concurrency | update SQL | existing stale and concurrent writer tests |
| Domain Validation Rules | job VOs/use case | existing validation tests |
| Same-Company Invariant and IDOR Defense | job repository/service | existing cross-company 404 tests |
| Editor Response DTO | job editor mapper | existing redaction/shape tests |
| Write Route Security Boundary | router | existing PATCH AST guard |
| Error Taxonomy | job classifier + shared catalog adoption | existing table plus WS6 envelope scan |
| Job Creation Endpoint | create handler/service/repository | existing create HTTP/live tests |
| Create Field Set | create DTO/entity/query | existing field matrix tests |
| Draft Creation Semantics | schema default/create use case | existing draft default/live tests |
| Active Company Creation Gate | create SQL | existing active/inactive company integration |
| Create Domain Validation | create DTO/VO/use case | existing validation tables |
| Create Response | editor DTO/handler | existing 201 shape tests |
| Create Route Security Boundary | router | existing POST AST guard |
| Create Error Taxonomy | create classifier + catalog | existing table plus WS6 scan |
| Re-Open Transitions | status transition logic | existing closed-to-draft/published tests |
| Re-Open + Field Edits Apply Atomically | update SQL/use case | existing combined update tests |
| Active-Company Update Gate | update SQL | existing tombstoned/inactive company tests |
| Re-Open Inherits CAS and Same-Company Invariants | update SQL/service | existing reopen stale/cross-company tests |
| DELETE /jobs/{id} Endpoint, Gate, and Route Boundary | delete handler/service/router | existing handler and DELETE AST guard |
| Soft-Delete Concurrency Controls | soft-delete SQL | existing stale/two-writer tests |
| Soft-Delete Eligibility, Audit, and Read-Side Invariants | delete use case/repository/read SQL | existing eligibility/audit/visibility integration |

## 13. File-change forecast and review workload

The tasks phase must count authored additions plus deletions and must not treat this design as permission for an over-budget review. Generated sqlc output is excluded only from authored-line count; it remains in snapshots and review identity.

| Hotspot | Likely authored size | Required task slicing response |
|---|---:|---|
| WS2 companies live-DB closure | 500–900 | Split WS2A SQL/race, WS2B adapters/constraints, WS2C rollback seam, WS2D HTTP/CAS races. |
| WS3 candidate replacement tests | 250–450 | Keep DTO/use-case/live replacement together; if forecast exceeds 400, ask before chaining candidate subunits. |
| WS4A migration command/harness | 300–500 | Separate command core/unit tests from live round-trip only if each remains independently meaningful. |
| WS4B Lambda adapter/dependencies/tests | 350–600 | Separate pure adapter/config from executable/live wiring. |
| WS5 JWKS verifier plus crypto tests | 600–1,000 | Keep WS5A config, WS5B cache/verifier, WS5C wiring as chained review candidates. |
| WS6A catalog and all-handler adoption | 500–900 | Adopt by capability after shared catalog; never create one mechanical all-handler mega-unit. |
| WS6B/C server extraction and observability | 500–900 | Split server/health from logs/metrics; route guards accompany the moved router. |
| WS7 gates/guards/report tooling | 500–900 | Split executable gates, architecture/traceability guards, and final generated evidence. |

`delivery_strategy=ask-on-risk`: if any indivisible proposed review unit is forecast above 400 authored changed lines, `sdd-tasks` must surface the risk and ask. It must not silently select `size:exception`. Tests remain with behavior, and splitting by file type is forbidden.

## 14. Rollout and operational safety

1. Merge behavior/evidence units WS2–WS3 first; they do not alter deployment shape.
2. Build all three executables (`cmd/api`, `cmd/migrate`, PostConfirmation) in WS4, but deploy none in this change.
3. Land explicit verifier modes before enabling JWKS wiring; production startup remains fail-closed throughout.
4. Land the additive error `code` field before message cleanup. Existing clients reading only `error` continue to work.
5. Land health/readiness split before any future orchestrator configuration: `/healthz` becomes DB-independent and `/readyz` becomes the future readiness target.
6. Run WS7 against a disposable Postgres database and the exact candidate tree. The first honest result is expected to remain NO-GO until every receipt exists.
7. AWS design/implementation may begin only after the generated report says GO; this closure does not deploy, provision, or publish artifacts.

No schema migration is needed for the candidate wire correction, error envelope, JWT modes, or HTTP hardening. The active-industry change modifies SQL behavior only and retains the existing FK. Rollback never changes the locked `cv_s3_key` column.

## 15. Risks and controls

| Risk | Control |
|---|---|
| Active-industry race test gives timing-dependent evidence | Barrier-controlled transactions and opposite lock-order scenarios; no sleeps as correctness conditions. |
| Advisory lock is bypassed by retained developer goose commands | Retained Make/goose targets are labelled local/manual; closure and future deployment targets invoke `cmd/migrate`, and only their locked receipts count as evidence. |
| JWKS outage causes permissive authentication | Expired/unknown keys fail closed; no mode fallback; known keys are usable only until original bounded expiry. |
| Error centralization erases domain behavior | Domain classifiers retain business ownership; only envelope/code/default mechanics are centralized. |
| 409 company payload leaks private fields | Optional envelope `data` uses the same redacted DTO constructor as public success payload; forbidden-field contract tests run for both. |
| Request logs leak PII or create cardinality explosions | Emit the matched route pattern under structured key `path`, use bounded `unmatched` fallback, and test forbidden fields; no user IDs/tokens/raw URLs as log values or metric labels. |
| Integration gate reports false confidence through skips | `go test -json` parser rejects every skip and DB preflight fails before tests; GO whitelist is empty. |
| Composition extraction invalidates route guards | Guards scan the new router owner and include mutation fixtures proving public/gated topology. |
| Generated evidence is manually edited | JSON manifest/receipts are source inputs; Markdown is regenerated and checked for drift. |
| Optional CORS/rate work expands scope | CORS default-deny is pinned; rate implementation stays SHOULD and cannot block or replace MUST closure. |
| Review units exceed 400 authored lines | Tasks forecast each unit, split by behavior, and ask on risk; no exception is authorized here. |
