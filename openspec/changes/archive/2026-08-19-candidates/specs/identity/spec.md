# Delta for Identity

## MODIFIED Requirements

### Requirement: JWT Middleware

The middleware MUST verify an RS256-signed JWT against the configured key source (local dev key in this slice; JWKS deferred), validate `iss`/`aud`/`exp`, place `sub` and `cognito:groups` into the request context, reject with 401 on tampered signature / past `exp` / wrong `iss` / wrong `aud` / non-RS256 algorithm, and MUST be attached to the `/me/*` route subtree in `cmd/api/main.go`.
(Previously: middleware was registered in `cmd/api/main.go` but NOT attached to any route in this slice.)

#### Scenario: valid token populates claims

- GIVEN a token signed with the configured dev RSA key, correct `iss`/`aud`, future `exp`
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
