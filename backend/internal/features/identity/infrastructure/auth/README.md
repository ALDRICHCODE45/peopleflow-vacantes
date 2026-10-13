# JWT verifier profiles

`NewVerifierConfigFromEnv` selects one verifier explicitly. It does not load
`.env` files. Do not send private environment files, signing keys or tokens to
agents or commit them to Git.

## Cognito access tokens (opt-in JWKS profile)

Set `IDENTITY_JWT_CLIENT_ID` to the expected Cognito App Client ID and
`IDENTITY_JWT_TOKEN_USE=access`. For example, with public placeholder values:

```dotenv
APP_ENV=local
IDENTITY_JWT_MODE=jwks
IDENTITY_JWT_ISSUER=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXAMPLE
IDENTITY_JWT_CLIENT_ID=example-app-client-id
IDENTITY_JWT_TOKEN_USE=access
IDENTITY_JWT_CACHE_TTL=10m
IDENTITY_JWT_FETCH_TIMEOUT=5s
```

Leave `IDENTITY_JWT_AUDIENCE` unset for ordinary Cognito access tokens without
resource binding. If it is configured, the token must ALSO carry a matching
`aud`; it is never ignored or treated as a substitute for `client_id`. For
resource-bound access tokens, the audience is the resource identifier, not the
App Client ID. An existing audience value must be reviewed by the human
operator, not silently bypassed by the verifier.

The verifier requires RS256, a JWKS key ID, a valid signature, the configured
issuer, temporal validation (30-second skew), expiration, nonempty subject,
`token_use=access`, and an exact string `client_id` match. An ID token is not an
API access-token substitute. Missing, differently typed or mismatched client
claims fail closed and return no principal. This profile needs no Cognito
Client secret: Go only verifies public signing keys and token claims.

JWKS configuration requires an HTTPS issuer without credentials, query or
fragment, a cache TTL from 1 minute to 24 hours, and a fetch timeout from 1
second to 1 minute. Signing keys are discovered at
`<issuer>/.well-known/jwks.json`. A whitespace-only client configuration and a
client configured with any token purpose other than `access` fail at startup.

## Existing profiles remain available

Without `IDENTITY_JWT_CLIENT_ID`, JWKS still requires
`IDENTITY_JWT_AUDIENCE` and `IDENTITY_JWT_TOKEN_USE` and validates both exactly
as before. Its existing configured token purposes are not changed.

PEM mode retains its issuer/audience contract and remains local/test only;
production rejects it. `IDENTITY_JWT_CLIENT_ID` is supported only in JWKS mode
and is rejected when explicitly supplied in PEM mode. No private signing key
is accepted as a PEM verifier key.

## Authorization is separate

This change does not provision a database user, create company membership or
grant recruiter/owner privileges. Existing routes resolve the verified subject
through `users` and `company_members`; their gates remain unchanged. Offline
signature/expiration validation alone does not establish token revocation.

## Checks (fixtures only)

From `backend`, without AWS credentials or a database:

```sh
go test ./internal/features/identity/infrastructure/auth -run '^TestCognitoAccess' -count=1
go test ./internal/features/identity/... -count=1
go vet ./internal/features/identity/...
```
