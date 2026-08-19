# Proposal: `identity` bounded context

## Intent

Cognito owns auth; Postgres owns domain; the bridge is `users.cognito_sub`. Without a `users` row we cannot resolve the caller on any authenticated route, blocking every follow-up. This change introduces the `identity` bounded context — first to depend on Cognito, first to carry a JWT auth middleware. Self-contained, no AWS, no Terraform.

## Scope

### In Scope

- Migration `00005_create_users.sql` per §3.2 of the data model.
- `internal/features/identity/` mirroring `companies`: aggregate, VOs, port, sentinels, Postgres adapter.
- sqlc: `CreateUser` (idempotent), `GetUserByID`, `GetUserByCognitoSub`.
- Use cases `CreateUser`, `GetUserByID`. **No public HTTP endpoints.**
- Lambda `PostConfirmation` handler: pure Go, idempotent, env-flag-gated for tests; not deployed.
- JWT auth middleware (RS256, `iss`/`aud`/`exp`). **Mounted on zero routes.**
- One new Go dep: JWT/JWKS lib (decided in design).

### Out of Scope

`company_members`, `invitations`, real Cognito/AWS/Terraform, wiring middleware onto protected routes, public `POST /users`, password/MFA/refresh — all deferred.

## Capabilities

### New Capabilities
- `identity`: ownership of `users` — domain, persistence, PostConfirmation, JWT middleware reused by every future authenticated route.

### Modified Capabilities
None.

## Approach

Mirror `companies` exactly. PostConfirmation lives in `application/` so the API binary (env flag) and the future Lambda binary call it unchanged. JWT middleware lives under `identity`; future features consume it via the application seam.

## Affected Areas

| Area | Impact |
|------|--------|
| `db/migrations/00005_create_users.sql` | New |
| `db/queries/users.sql` | New |
| `internal/db/` | sqlc regen |
| `internal/features/identity/` | New slice |
| `cmd/api/main.go` | Wires identity |
| `go.mod` / `go.sum` | New dep |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| JWT lib bloats binary / locks us in | Med | Decide in design. |
| `mapCreateError` can't split 23505 | Low | Branch on `pgconn.PgError.ConstraintName`. |
| Lambda re-delivery duplicates rows | Med | `ON CONFLICT (cognito_sub) DO NOTHING RETURNING *`. |
| Middleware silently mounted on wrong route | Med | Specs: zero routes wrapped. |
| New dep breaks strict TDD / vet | Low | RED-first tests. |

## Rollback Plan

`goose down` for `00005` → delete `internal/features/identity/` → revert `go.mod`/`go.sum` and `cmd/api/main.go` → `git checkout -- internal/db/`.

## Dependencies

JWT/JWKS lib (design). Stdlib `crypto/rsa`/`rand`/`x509` for the local dev keypair. `google/uuid` v1.6 (pinned) for UUID v7.

## Success Criteria

- [ ] `cd backend && go test ./...` green; `go build`/`vet` clean.
- [ ] `goose up` applies `00005`; `down` drops it.
- [ ] sqlc regen; `Querier` gains three methods.
- [ ] Two PostConfirmation calls with same `cognito_sub` leave one row, both succeed.
- [ ] JWT middleware accepts a valid local-key token; rejects tampered, expired, wrong-`aud`/`iss`/algorithm.
- [ ] `identity` exposes zero public HTTP routes.
