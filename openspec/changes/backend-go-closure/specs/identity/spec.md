# Delta for Identity

## ADDED Requirements

### Requirement: Production PostConfirmation Lambda Boundary

The system MUST provide an independently buildable, testable, and rollbackable Lambda executable adapter that translates AWS Lambda PostConfirmation trigger events — and ONLY PostConfirmation trigger events — into the existing `PostConfirmationHandler.Handle` application handler (no identity logic is duplicated; the adapter wires Postgres/config/logging around the application handler). Handler errors MUST propagate as Lambda failures so Cognito's retry semantics apply; errors MUST NOT be swallowed as no-ops.

Enablement is production-required (R1): in production configuration, the PostConfirmation path MUST be enabled, and the adapter MUST fail startup/configuration if the path is not explicitly enabled — an unset or `false` flag MUST NOT silently disable production user sync. Explicit disable is valid ONLY in local/test configuration. The idempotent redelivery behavior of the application handler (a repeated `sub` yields exactly one row and no error) MUST be preserved through the adapter.

#### Scenario: adapter translates a PostConfirmation event into the application handler

- GIVEN a Lambda PostConfirmation trigger event carrying `request.userAttributes` (`sub`, `email`, `name`) and `cognito:groups` `["candidates"]`
- WHEN the adapter is invoked
- THEN it maps the event onto `PostConfirmationEvent` and the resulting `users` row is created with `user_type='candidate'` through the existing application handler (no duplicated identity logic in the adapter)

#### Scenario: handler errors propagate as Lambda failures

- GIVEN a translated event whose processing fails (e.g., invalid email attribute)
- WHEN the adapter returns
- THEN the invocation reports a Lambda failure (the error is propagated, never swallowed as a no-op) so Cognito retry semantics apply

#### Scenario: production configuration fails when the path is not explicitly enabled

- GIVEN production configuration with `IDENTITY_POSTCONFIRMATION_ENABLED` unset or `"false"`
- WHEN the adapter starts up / validates its configuration
- THEN startup/configuration fails (non-zero / invocation-refusing error) rather than silently disabling production user sync

#### Scenario: explicit disable is local/test-only

- GIVEN a local/test configuration with `IDENTITY_POSTCONFIRMATION_ENABLED` explicitly `"false"`
- WHEN the adapter runs
- THEN the disable is accepted (the application handler short-circuits without invoking `CreateUser`, no error)

#### Scenario: repeated delivery through the adapter leaves one row

- GIVEN production configuration and the same `sub` delivered twice sequentially
- WHEN both Lambda invocations run
- THEN `users` contains exactly one row for that `cognito_sub` and both invocations complete without failure (idempotent redelivery preserved)

#### Scenario: the adapter builds and tests independently

- GIVEN the Lambda adapter package
- WHEN `go build ./...` and `go test ./...` run
- THEN the adapter builds and its runtime-boundary tests pass without requiring any deployment resource (no Docker/Terraform/Lambda deployment config is created by this change)

## MODIFIED Requirements

### Requirement: PostConfirmation Handler

`backend/internal/features/identity/application/post_confirmation.go` MUST read `request.userAttributes.sub/.email/.name` and `cognito:groups`; map the first matched group (`candidates` → `UserCandidate`; `recruiters`/`company_admins` → `UserRecruiter`; no match → skip without error); invoke `CreateUser`. When `IDENTITY_POSTCONFIRMATION_ENABLED` is unset or `"false"` the application handler MUST short-circuit without invoking `CreateUser` (no error) — this local/test disable gate is the application-layer default; production enablement is enforced by the adapter per `Production PostConfirmation Lambda Boundary`. Repeated delivery of the same `sub` MUST leave exactly one `users` row and return no error (an existing-user outcome is treated as success).

(Previously: the canonical text named a non-existent path `application/identity/post_confirmation.go` and pinned the disable gate as unconditional application behavior; the path is corrected and the production-required enablement boundary now lives in the adapter requirement.)

#### Scenario: group mapping and env-flag gating

- GIVEN env flag `"true"` with groups `["candidates"]` or `["recruiters"]`/`["company_admins"]`, OR env flag unset
- WHEN the handler runs
- THEN `CreateUser` is invoked with the matching `UserType` OR is not invoked (no error)

#### Scenario: repeated delivery leaves one row

- GIVEN env flag `"true"` and the same `sub` delivered twice sequentially
- WHEN both invocations run
- THEN `SELECT COUNT(*) FROM users WHERE cognito_sub = <sub>` returns `1` and both return no error

### Requirement: JWT Middleware

The middleware MUST verify an RS256-signed JWT against the explicitly configured verifier mode (see `JWT Verification Modes`: Cognito JWKS in production; explicit static-PEM local/test mode), validate `iss`/`aud`/`exp`, place `sub` and `cognito:groups` into the request context, reject with 401 on tampered signature / past `exp` / wrong `iss` / wrong `aud` / non-RS256 algorithm, and MUST be attached to the `/me/*` route subtree in `cmd/api/main.go`.

(Previously: the key source was described as "local dev key in this slice; JWKS deferred" — that clause is removed and replaced by the dual explicit-mode verifier contract.)

#### Scenario: valid token populates claims

- GIVEN a token signed with the configured verifier's key, correct `iss`/`aud`, future `exp`
- WHEN the middleware processes the request
- THEN the downstream handler runs and reads `sub` and `cognito:groups` from context

#### Scenario: invalid cases return 401

- GIVEN tampered signature OR past `exp` OR wrong `iss` OR wrong `aud` OR HS256 algorithm
- WHEN the middleware processes the request
- THEN response is `401` and the handler is not invoked

#### Scenario: /me/* route subtree is wrapped

- GIVEN a static scan of `main.go`
- WHEN every `chi.Mount`/`With`/`Use` on `/me/*` paths is checked
- THEN at least one route under `/me/*` passes through the JWT middleware

### Requirement: JWT Verification Modes

The system MUST provide exactly two explicit JWT verifier modes with NO implicit fallback between them (R2):

1. **Cognito JWKS (production mode)** — the verifier MUST fetch the configured Cognito issuer's JWKS, select the verification key by the token's `kid` header, and validate RS256 signature, `iss`, `aud`, `exp`, and `token_use`. Key caching MUST be bounded (size and/or TTL) and MUST refresh on rotation (an unknown `kid` MUST trigger a bounded refresh before rejection). In-flight key fetches MUST honor request cancellation. The verifier MUST fail closed: on configuration errors, key-fetch failures, or any validation failure the token is rejected (401 at runtime) and a production misconfiguration MUST fail startup rather than start permissively.
2. **Static PEM (local/test mode)** — the existing static-PEM verifier is retained as an explicitly selected local/test mode only.

The mode MUST be selected explicitly by configuration. There MUST be no implicit permissive fallback (e.g., no fallthrough from JWKS to PEM, and no unverified acceptance). Table-driven crypto tests against a local JWKS test server MUST cover: correct `kid` selection, bounded cache behavior, rotation refresh on unknown `kid`, cancellation, and fail-closed behavior on fetch/config errors.

#### Scenario: JWKS token with a known kid is verified

- GIVEN production mode against a local JWKS test server and a token signed by a key whose `kid` is in the served JWKS with correct `iss`/`aud`/`exp`/`token_use`
- WHEN the verifier validates the token
- THEN validation succeeds and the claims are available to the middleware

#### Scenario: unknown kid triggers bounded rotation refresh

- GIVEN a token whose `kid` is not in the cached key set but is present in a refreshed JWKS
- WHEN the verifier validates the token
- THEN the verifier performs a bounded refresh and validates the token with the rotated key

#### Scenario: key-fetch failure fails closed

- GIVEN production mode and an unreachable or erroring JWKS endpoint
- WHEN a token is presented at runtime
- THEN validation fails closed (401, no permissive acceptance), and a startup-time equivalent misconfiguration fails startup

#### Scenario: PEM mode requires explicit selection

- GIVEN configuration selecting the static-PEM verifier (local/test)
- WHEN tokens are verified
- THEN verification uses the configured PEM key and no JWKS fetch occurs; with no mode explicitly selected, startup fails rather than choosing one implicitly

#### Scenario: no implicit fallback between modes

- GIVEN any configuration state
- WHEN the verifier is constructed
- THEN the constructed verifier is exactly the configured mode and there is no code path that silently switches modes on error
