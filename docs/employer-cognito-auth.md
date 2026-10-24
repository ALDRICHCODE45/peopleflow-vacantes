# Employer Cognito authentication

Server-side employer authentication for the Next.js App Router frontend,
implemented with stable `next-auth@4.24.15`. This document covers the server
portion: provider configuration, encrypted JWT sessions, refresh handling, the
logout handoff to Cognito managed login, and the security contract with the UI.

Backend token exchange, draft saving, and any API token bridge are out of scope
for this step.

## Files

| Path | Responsibility |
| --- | --- |
| `frontend/src/lib/auth/env.ts` | Validates the server auth configuration. |
| `frontend/src/lib/auth/provider.ts` | Builds the Cognito OAuth provider with PKCE and state. |
| `frontend/src/lib/auth/refresh.ts` | Token-endpoint refresh and expiry/fail-closed logic. |
| `frontend/src/lib/auth/session.ts` | Projects the server JWT into the public session. |
| `frontend/src/lib/auth/logout.ts` | Builds the Cognito logout destination and cookie clearing. |
| `frontend/src/lib/auth/callbacks.ts` | Production callback factory, exercised with synthetic config in regression tests. |
| `frontend/src/lib/auth/refresh-observer.ts` | Development-only, whitelisted refresh signal formatter and observer. |
| `frontend/src/lib/auth/options.ts` | Guarded server-only entry, supplying validated config and the development observer to the factory. |
| `frontend/src/app/api/auth/[...nextauth]/route.ts` | Node `GET`/`POST` NextAuth route handler. |
| `frontend/src/app/api/auth/cognito/logout/route.ts` | Same-origin federated logout handoff. |

## Configuration

All values are read from the server environment and validated at startup. None
of these values is exposed to the browser bundle.

| Variable | Required | Rules |
| --- | --- | --- |
| `NEXTAUTH_URL` | yes | Exact origin without path, query, or fragment. HTTP is only accepted for loopback hosts (`localhost`, `127.0.0.1`, `::1`) outside production; every remote origin must use HTTPS. |
| `NEXTAUTH_SECRET` | yes | Non-empty server secret used to encrypt session JWTs. Value is never documented here. |
| `COGNITO_CLIENT_ID` | yes | Public app client identifier. |
| `COGNITO_CLIENT_SECRET` | yes | Server-only client secret placeholder; supplied by the human operator. |
| `COGNITO_ISSUER` | yes | HTTPS Cognito user pool issuer URL, no query or fragment. |
| `COGNITO_DOMAIN` | yes | HTTPS Cognito hosted domain origin, no path, query, or fragment. |

Derived values (never request-controlled):

- Token endpoint: `${COGNITO_DOMAIN}/oauth2/token`.
- Employer login return URL: `${NEXTAUTH_URL}/empresa/login`.

Reference identifiers for the configured environment (public values from the
approved spec, safe to document):

- Issuer: `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Dmb1XsIw9`
- Hosted domain: `https://us-east-1dmb1xsiw9.auth.us-east-1.amazoncognito.com`
- Client ID: `18a05uprp34uosfg1ov6lvvkbu`
- Callback: `http://localhost:3000/api/auth/callback/cognito`
- Logout return: `http://localhost:3000/empresa/login`

Secrets are configured by the human operator outside this repository. Do not
commit `.env` files or values.

## OAuth flow

The employer signs in through Cognito managed login using the authorization
code flow. PKCE (`S256`) and state are handled by NextAuth v4 through the
provider `checks: ["pkce", "state"]` option. NextAuth issues signed, short-lived
`next-auth.pkce.code_verifier` and `next-auth.state` cookies during the
authorization request and validates both in the callback; a missing or mismatched
value aborts the callback. The default Cognito provider derives the authorization
endpoint from the configured issuer discovery document and the requested scopes
are `openid email profile`. The UI starts the flow with
`signIn("cognito", { callbackUrl: "/empresa/login" })`.

The Cognito App Client must allow the `profile` OpenID Connect scope to make
readable profile attributes such as `name` available through UserInfo. Requesting
`profile` in the frontend does not enable it in the App Client configuration.
After changing the allowed scopes, sign out and sign in again: refreshed access
tokens retain the original grant's scopes, so a reload or token refresh does not
add the new scope.

## Registro de candidatos y configuración en Cognito

«Ingresar» de candidato conserva `signIn("cognito", { callbackUrl:
"/candidato/ingresar" })`. «Crear cuenta» obtiene el CSRF con `getCsrfToken()`
y envía el POST estándar de NextAuth a `/api/auth/signin/cognito`, con
`csrfToken`, `callbackUrl=/candidato/ingresar` y `json=true`. En NextAuth v4,
`redirect: false` no devuelve la URL para proveedores OAuth. Este POST permite
obtenerla sin omitir la transacción: NextAuth genera los parámetros y las cookies
de state/PKCE. Solo se cambia la ruta exacta `/oauth2/authorize` a `/signup`;
el origen y la consulta se conservan sin reconstruir ni normalizar parámetros.
Si la URL devuelta no es la de autorización esperada, se navega a ella sin cambios.

**Acción del usuario en la consola de AWS:** en el app client del user pool,
en la configuración de managed login/Hosted UI, agregar estas dos entradas en
**Allowed sign-out URLs**, sustituyendo `<NEXTAUTH_URL>` por el origen configurado
(sin barra final):

- `<NEXTAUTH_URL>/candidato/login`
- `<NEXTAUTH_URL>/empresa/login`

En local, las entradas exactas son:

- `http://localhost:3000/candidato/login`
- `http://localhost:3000/empresa/login`

El callback en **Allowed callback URLs** no cambia:
`<NEXTAUTH_URL>/api/auth/callback/cognito` (local:
`http://localhost:3000/api/auth/callback/cognito`). `/signup` no es un callback.
Además, el user pool debe tener habilitado **self sign-up** (autorregistro) para
que `/signup` muestre el formulario de registro.

Después de guardar, verificar «Cerrar sesión» como candidato y como empresa:
cada uno debe volver a su login (`/candidato/login` o `/empresa/login`), sin
mostrar la página de error de Cognito. Sin sesión, «Crear cuenta» debe abrir el
formulario de registro de Cognito. La configuración en AWS y la comprobación
real quedan a cargo del usuario; ver el paso 89 de
[`employer-manual-test.md`](employer-manual-test.md).

## Session contract

Sessions use the JWT strategy: an encrypted (JWE), HttpOnly session cookie. The
access token, refresh token, and ID token live only inside that server-managed
token. They are never included in the public session returned to the browser.

The public session is projected by `toPublicSession` and contains at most:

```ts
{
  user?: { name?: string | null; email?: string | null; image?: string | null };
  expires: string;
  error?: "RefreshAccessTokenError";
}
```

- A token is usable only with a non-blank access credential and a safe-integer expiry strictly in the future, without a refresh error. Future expiry alone never establishes authentication.
- On a usable token, only the standard user fields are returned.
- On an unusable token, `user` is omitted and `session.error` is set to the
  generic `"RefreshAccessTokenError"` so the UI can request a new login.
- The session provider state alone does not authorize company membership.

## Refresh behavior

The `jwt` callback stores `accessToken`, `refreshToken`, and a millisecond
`expiresAt` (from `account.expires_at` seconds) on first sign-in. Initial account
credentials and expiry are validated before publishing any identity; a missing,
blank, expired or unknown credential lifetime fails closed. On later session reads:

1. If usable access credentials exist and `expiresAt - 30s` is still in the
   future, the stored token is returned unchanged.
2. Otherwise, if a refresh token exists, the server calls the derived token
   endpoint with a form-encoded `refresh_token` grant that includes the client
   ID and client secret, under a server-side timeout.
3. A successful refresh must return non-blank access credentials and a positive,
   finite `expires_in` producing a safe-integer future timestamp; zero, negative
   and overflowing lifetimes are rejected. The returned session token is validated
   again before replacing credentials; a rotated refresh token is stored when
   the provider returns one.
4. On a missing refresh token, a non-OK response, an unusable payload, a
   timeout, or a network error, the session expires: token material is dropped
   and `error: "RefreshAccessTokenError"` is emitted.

Failures collapse into the single generic message `Cognito token refresh
failed`; token values, response bodies, and provider errors are never logged or
returned.

## Development refresh signal

A development-only, server-terminal marker can confirm that a real token
refresh was attempted and how it ended, without exposing any credential. It is
wired by the guarded server entry (`options.ts`) and only when
`NODE_ENV === "development"`; in `test`, `production`, or when `NODE_ENV` is
unset the factory returns no observer and the server emits nothing. The
optional observer is inert: if a reporter or the log sink throws, the refresh
result and fail-closed behavior are unchanged.

Exact marker format (one line per event):

```text
AUTH_REFRESH START id=<opaque> category=<expired|proactive|unusable>
AUTH_REFRESH SUCCESS id=<opaque> category=<expired|proactive|unusable>
AUTH_REFRESH FAILURE id=<opaque> category=<expired|proactive|unusable>
```

- `START` is emitted only when a refresh is actually attempted, immediately
  before the token-endpoint call. Fast paths that do not call the endpoint
  (session already errored, credentials still valid, missing refresh token)
  emit nothing.
- `SUCCESS` is emitted only after the refreshed credentials and lifetime pass
  the same validation as the session contract. `FAILURE` is emitted when the
  endpoint throws (network error, non-OK response, timeout) or returns an
  invalid or unusable payload.
- The `id` is generated per attempt with `crypto.randomUUID()`, or two random
  fragments if that API is unavailable. Neither path uses a clock, counter,
  token, user, or configuration value. A paired `START`+`SUCCESS`/`FAILURE`
  shares the same `id` and `category`.
- `category` is a logical reason only: `expired` means a safe-integer expiry at
  or before `now` (a real expiry), `proactive` means the token was still valid
  but inside the 30-second safety skew, and `unusable` is the fallback for
  unknown or invalid expiry metadata.

The formatter builds every line from a fixed allow-list. It never prints or
spreads runtime token values, the access/refresh/ID token, provider error
objects or messages, response bodies, request payloads, user/PII, session
objects, environment values, OAuth URLs, or client IDs. Unknown labels,
categories, or unsafe ids are replaced rather than echoed.

### Human observation procedure

Code alone does not prove the live path; only a human observing the server
terminal can. Do not read browser Network/cookie/token panels or environment
dumps, and do not capture full logs or screenshots.

1. Sign in fresh with Cognito and note the time `T0`.
2. Close every PeopleFlow tab without signing out, so the session provider
   cannot proactively renew, and keep the human dev server running.
3. Wait about 65 minutes, given the human-reported ~60-minute access expiry.
   Do not mutate configuration or TTLs.
4. Reopen `/empresa/login` without `signIn`/relogin.
5. Read only the authorized `AUTH_REFRESH` marker lines in the server terminal.

A matched expired `START`+`SUCCESS` pair confirms the marked expired renewal
path. A `FAILURE` or a missing pair is not a pass. A `proactive` pair only
proves early renewal inside the skew window. No code signal implies a live pass
until the human observes it.

## Logout

1. The UI calls `signOut({ callbackUrl: "/api/auth/cognito/logout" })`.
2. NextAuth clears the local session and redirects to the same-origin logout
   route.
3. `GET /api/auth/cognito/logout` clears the NextAuth cookies defensively and
   redirects to `${COGNITO_DOMAIN}/logout?client_id=...&logout_uri=...`.

The destination is built only from validated configuration and the request URL
is never used as a redirect target, so the endpoint cannot become an open
redirect. If the configuration is invalid the route fails closed with a generic
`500` instead of redirecting. This ends the Cognito managed-login session; it
does not claim that already-issued access JWTs are revoked.

## Security properties

- No access, refresh, or ID token ever appears in the public session, error
  strings, logs, or route responses.
- The token endpoint and logout destination derive from server configuration,
  not from request input.
- Missing or invalid credentials fail closed and force re-authentication.
- Expiry is validated with a safety skew; an unknown expiry triggers a refresh
  attempt rather than trusting the token.
- Fixed cookie names are cleared with the correct `Secure` attribute for
  `__Secure-` / `__Host-` prefixes. Normal UI logout first uses NextAuth's
  CSRF-protected POST, including its numbered session-cookie chunk cleanup.

## Limitations

- The direct federated logout GET is a redirect handoff, not a CSRF-protected
  action: a cross-site navigation can trigger logout. Normal UI logout uses
  NextAuth's protected POST first; direct-route logout-CSRF remains an advisory.
- Defensive cleanup in the GET route covers fixed names, not numbered session
  chunks. NextAuth clears chunks on the ordinary UI sign-out path, but direct
  invocation must not be described as complete local-session cleanup.
- Concurrent session reads that both observe an expired token can each start a
  refresh. NextAuth v4 does not deduplicate `jwt` callback invocations, and this
  step intentionally avoids adding a cross-request lock. With rotating Cognito
  refresh tokens one racing request can fail and surface the generic refresh
  error, requiring a new login. A shared lock or single-flight helper is a
  follow-up.
- The backend access-token `aud` / `client_id` / `token_use` contract is still
  pending; no token is sent to the API and no drafts are connected.
- Functional login, logout, refresh, and browser acceptance require a human to
  configure the Cognito callback/logout URLs, local secrets, and an enabled user.
- ID tokens are not forwarded to the API and are not used as an API `aud`
  compatibility source.

## Tests

`cd frontend && pnpm exec vitest run src/lib/auth --no-file-parallelism` covers
configuration validation, provider PKCE/state wiring, session redaction,
refresh success/error/missing-token/expiry, the logout destination, and the
development refresh signal. `options.test.ts` invokes the exact production
JWT/session callbacks using the same factory as the guarded entry, covering
missing credentials with future expiry, malformed initial accounts,
nonpositive/overflowing refresh lifetimes, valid login/refresh redaction, and
the correlated signal only when a refresh actually runs. `refresh-observer.test.ts`
covers the fixed marker format, the field allow-list, category classification,
and the development-only gate. These tests do not load local environment files
or perform real Cognito requests. When isolation from private app environment is
required, the same public auth files are copied into a project-contained
scratch directory with a node-environment Vitest config and fake fixtures.

The employer UI uses a local `SessionProvider` with a 60-second refetch interval
and focus refresh, accessible generic error/relogin feedback, and separate
sign-in/sign-out pending states. Los controles de candidato conservan el bloqueo,
los estados pendientes y los mensajes de error; el registro usa el flujo descrito
arriba. Browser
visual and actual Cognito acceptance are still human-owned; TypeScript/Vitest
proof is not an end-to-end login claim.
