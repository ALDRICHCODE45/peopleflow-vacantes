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
| `frontend/src/lib/auth/credentials.ts` | Embedded password sign-in: NextAuth `CredentialsProvider` (`password`) over the server-only Cognito client. |
| `frontend/src/lib/auth/token-shape.ts` | Well-formedness checks for Cognito JWTs (no signature verification; identifiers and display only). |
| `frontend/src/lib/auth/social.ts` | Per-provider social flags; `resolveSocialProviders()` (lazy, never throws) for the screens and the route guard. |
| `frontend/src/lib/auth/route-guard.ts` | Wraps the NextAuth handler: POST social sign-in param allowlist, password-callback rate limiting and the sign-out session-kind hint. |
| `frontend/src/lib/auth/rate-limit.ts` | In-memory per-IP and per-email limiter for the password callback and the A4.4–A4.6 routes. |
| `frontend/src/components/auth/sign-in/` | Embedded «Ingresar» form (artboard 01), error mapping and copy, social buttons, the A4.3–A4.6 paths and the `sessionStorage` email handoffs. |
| `frontend/src/components/auth/forgot-password/` | «¿Olvidaste tu contraseña?» (A4.6): request a code, then the code and the new password. |
| `frontend/src/components/auth/sign-up/`, `frontend/src/components/auth/verify/` | «Crea tu perfil» / «Registra tu empresa» and «Verifica tu correo» (A4.4, A4.5 by audience): live password requirements, six-box code input, resend cooldown. |
| `frontend/src/components/auth/company/` | «Tu empresa» (A4.5): company sign-up step 3. |
| `frontend/src/features/employer-company/company-step-actions.ts` | Server Actions of «Tu empresa»: employer account, then POST /companies. |
| `frontend/src/lib/auth/sign-up/` | Server Actions for sign-up, confirm and resend (validation, rate limiting, closed results). |
| `frontend/src/lib/auth/forgot-password/` | Server Actions for the password reset: request a code and confirm it with the new password (A4.6). |
| `frontend/src/lib/auth/password-policy.ts` | Client-safe password requirements shared by the Cognito client and the screens. |
| `frontend/src/lib/auth/cognito-shared.ts` | The one lazily built server-only Cognito client per process (NextAuth and the actions). |
| `frontend/src/lib/auth/service-log.ts` | One-line, token-free operator log for the Cognito client's `onServiceError`. |
| `frontend/src/app/api/auth/[...nextauth]/route.ts` | Node `GET`/`POST` NextAuth route handler (guarded). |
| `frontend/src/app/api/auth/cognito/logout/route.ts` | Same-origin logout handoff (Cognito hop only for OAuth sessions). |

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

Social sign-in flags (names only; unset or `off` hides the button):

| Variable | Rules |
| --- | --- |
| `AUTH_SOCIAL_GOOGLE`, `AUTH_SOCIAL_MICROSOFT`, `AUTH_SOCIAL_LINKEDIN` | `on` or `off`. Read per request; any other value (or a bad `*_IDP` below) turns every social provider off and logs `[auth] social_config_invalid key=<KEY>` once per key per process (never the value). Password sign-in and the rest of `/api/auth/*` keep working. |
| `AUTH_SOCIAL_GOOGLE_IDP`, `AUTH_SOCIAL_MICROSOFT_IDP`, `AUTH_SOCIAL_LINKEDIN_IDP` | Optional Cognito identity provider name (`[A-Za-z0-9._-]{1,32}`); defaults `Google`, `Microsoft`, `LinkedIn`. Two providers may not share a name. |

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

Desde A4.3, «Ingresar» de candidato usa el formulario propio (correo y
contraseña, `signIn("password", …)`) con `callbackUrl=/candidato/ingresar`, y
el registro es la ruta propia `/candidato/registro` (A4.4). Ya no se reescribe
`/oauth2/authorize` a `/signup` de Cognito (`signup-url.ts` quedó sin uso).
Solo el asistente de postulación conserva `signIn("cognito")` sin parámetros
hasta A4.7.

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
`http://localhost:3000/api/auth/callback/cognito`).
Además, el user pool debe tener habilitado **self sign-up** (autorregistro) para
que la API `SignUp` del registro propio (A4.4/A4.5) funcione, y el app client
**ALLOW_USER_PASSWORD_AUTH** + **ALLOW_REFRESH_TOKEN_AUTH** para «Ingresar»
con contraseña (L8); sin ese ajuste el formulario responde «No pudimos
conectarnos.».

Después de guardar, verificar «Cerrar sesión» como candidato y como empresa:
cada uno debe volver a su login (`/candidato/login` o `/empresa/login`), sin
mostrar la página de error de Cognito. La configuración en AWS y la comprobación
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

## Session kinds (embedded auth, A4.2)

Two ways produce the same encrypted JWT cookie shape — `sub`, `name`, `email`,
`picture`, `accessToken`, `refreshToken`, `expiresAt` (ms) — plus `authKind`:

| `authKind` | Established by | Refresh | Logout |
| --- | --- | --- | --- |
| `password` | `signIn("password", { email, password })` → `CredentialsProvider` → Cognito `InitiateAuth USER_PASSWORD_AUTH` (server-only client with `SECRET_HASH`) | `InitiateAuth REFRESH_TOKEN_AUTH`, `SECRET_HASH` over the stored `sub` | Clear cookies, return to the audience login page; no Cognito `/logout` |
| `oauth` (or absent: cookies issued before A4.2) | Cognito OAuth provider (social; the bare hosted page only from the candidate apply wizard until A4.7) | `/oauth2/token` `refresh_token` grant (unchanged) | Clear cookies, Cognito `/logout` hop |

**Password sign-in.** `authorize()` returns only `{ id: sub, name, email, image: null }`.
The Cognito tokens travel to the `jwt` callback on that same object under a
non-enumerable symbol, so a serialized, spread or logged user never carries
them; NextAuth gives the user object only to server-side callbacks. `sub` is
read from the access token after a well-formedness check (three base64url
segments, signed `alg`, `token_use: "access"`, Cognito subject alphabet); the
signature is not verified here — the token comes straight from Cognito over
TLS, the claim is only an identifier, and the backend verifies every token.
`name` is a display hint from the ID token. Failures throw a stable code that
NextAuth returns as `error`; the «Ingresar» screens map it (A4.3, copy from
artboard 01):

| Code | When |
| --- | --- |
| `invalid_credentials` | Wrong email/password, unknown user, `PasswordResetRequiredException`, malformed or oversized input (email > 254, password > 256) → «Correo o contraseña incorrectos.» (both fields marked, password cleared, focus on the summary) |
| `not_confirmed` | Correct password on an unconfirmed account → the verify-code route (`/empresa/verificar`, `/candidato/verificar`, A4.4), email carried in `sessionStorage` (`peopleflow.auth.pendingEmail`, origin `sign-in` in `peopleflow.auth.pendingOrigin`, so the verify screen resends a code on arrival), never in the URL; the password is cleared before leaving, and each new attempt drops any earlier carried email |
| `too_many_attempts` | Cognito throttling, or our rate limit (below) → «Demasiados intentos.» with a link to reset the password |
| `unavailable` | Cognito unreachable or misconfigured (incl. hash mismatch), a challenge with no screen yet (`NEW_PASSWORD_REQUIRED`, MFA), a malformed access token → «No pudimos conectarnos.» (also on a thrown request or after 10 s), what was typed stays. After a timeout, once the request settles the screen calls `getSession()` and continues to the destination if a live session exists |

**Screens (A4.3).** `/empresa/login` and `/candidato/login` render
`LoginScreen` (FloatingLines panel unchanged) with `EmployerAuthControls` /
`CandidateAuthControls`, which show `sign-in/SignInForm` when there is no live
session: email (`autocomplete=username`) and password
(`current-password`, show/hide toggle with `aria-pressed`), «¿Olvidaste tu
contraseña?» (→ `/empresa/recuperar`, `/candidato/recuperar`, A4.6),
«Ingresar» → `signIn("password", { redirect: false, email, password,
callbackUrl })`, then a full navigation to the callback: employers to the safe
`callbackUrl` or `/empresa/dashboard`, candidates to `/candidato/ingresar`
(with the safe `next`). The shell links «Registra tu empresa» /
«Crea tu perfil» to `/empresa/registro` / `/candidato/registro` (A4.5 / A4.4).
`/candidato/registro` exists since A4.4 and `/empresa/registro` since A4.5. «Ingresar
con Cognito» and the candidate hosted sign-up rewrite are gone, with no
rollback flag (`signup-url.ts` is now unused). An expired session shows «Tu
sesión venció. Vuelve a ingresar.» with the form and «Cerrar sesión» below it; any `?error=` shows the generic callback
failure, except `?error=email_in_use`, which shows the L5 notice «Ese correo ya
tiene cuenta. Entra con tu contraseña.» (nothing sets it yet: the social
onboarding redirect is a follow-up).

**Rate limiting.** The route guard counts every POST to the password callback
per client address and per normalized email (SHA-256 of trim+lowercase; the
raw email is never stored or logged, the password never read) before NextAuth
runs. The email is counted only when the request carries a valid NextAuth CSRF
pair (cookie `next-auth.csrf-token`, or `__Host-next-auth.csrf-token` on https,
holding `token|sha256(token + NEXTAUTH_SECRET)`, and the body `csrfToken`
equal to `token`, compared in constant time; the cookie is split like NextAuth,
`split("|")`, first two parts). Requests without a valid pair spend only the
address budget and reach NextAuth, which rejects them, so bare scripted requests
cannot burn an email's budget. A pair is not tied to a person (anyone can fetch
one from `/api/auth/csrf`), so targeted lockout of a known email for one window
remains possible: an accepted trade-off of per-account limiting. A full counter
table never refuses a new key: the key whose window ends soonest is evicted.
When no client address can be derived, the per-IP limit is skipped (no shared
«unknown» bucket) and the per-email limit still applies; over either limit it answers `429 { url: …/api/auth/error?error=too_many_attempts }`
with `Retry-After`, without calling Cognito. The email is read from a clone
of the body capped at 8 KiB (`MAX_PASSWORD_CALLBACK_BODY_BYTES`; a real body is
under 1 KiB): a larger declared `Content-Length` or more actual bytes stops the
read and answers `413 { url: …/api/auth/error?error=invalid_request }` after
counting the address (429 if the address is already over), never reaching
NextAuth. Passing it on would let a padded body skip the per-email limit.
Budgets (`AUTH_RATE_LIMITS`):
sign-in 50/IP and 10/email per 15 min; sign-up 10/IP and 5/email per hour;
confirm and confirm-forgot 30/IP and 10/email per 15 min; resend and forgot
10/IP and 3/email per 15 min. The A4.4–A4.6 routes call
`createAuthAttemptLimiter().attempt(<operation>, { ip, email })` the same way.
The client address is the right-most `X-Forwarded-For` entry (else
`X-Real-IP`). The counter table holds at most 10 000 keys per limiter: expired
windows go first, then the oldest key still under its limit; a key over its
limit is never evicted before its window ends. If every tracked key is over its
limit, a new key is refused until the first window expires (fail closed;
existing keys keep their state). Limits: counters are in memory per instance (N instances give N×
the budget; a restart resets them) and, without a trusted proxy in front, the
header is client-controlled, so only the per-email limit holds. The AWS phase
must move counters to a shared store or WAF rules and pin the trusted hop.

**Refresh decision.** OAuth sessions stay on `/oauth2/token`: that grant keeps
the OAuth scopes the hosted/social tokens were issued with, and
`REFRESH_TOKEN_AUTH` needs the Cognito *username* in `SECRET_HASH`, which for
federated users is `Google_…`-style rather than the `sub`. The existing tests
do not show the two paths equivalent, so `refreshSessionTokens` dispatches on
`authKind`. The 30 s skew and «a failed refresh expires the session» behavior
are shared; `authKind` survives refresh and expiry.

**Logout.** NextAuth clears the session cookie before the logout route runs,
so the route guard sets a `password` hint on the sign-out response (HttpOnly,
`SameSite=Lax`, `Path=/`, 120 s; cleared for any other kind). On https it is
`__Host-peopleflow.logout-kind` (Secure, no Domain), so a sibling subdomain
cannot plant it; the plain `peopleflow.logout-kind` exists only for http
loopback development. The logout route accepts only the name matching the
scheme of the validated `NEXTAUTH_URL`, reads it, clears it and sends a
password session straight to `/empresa/login` or `/candidato/login`. The hint
grants nothing: a forged value only skips the Cognito hop for that browser, and
a missing one falls back to the hop. `GlobalSignOut` is deliberately not called:
it revokes the user's refresh tokens on every device (sign out everywhere), not
just this session; per-session revocation (`RevokeToken`) is a follow-up.

**Social.** The OAuth provider requests
`openid email profile aws.cognito.signin.user.admin` (L8; the app client must
allow that scope). A social button calls
`signIn("cognito", { callbackUrl }, { identity_provider: <name> })` with a name
from `resolveSocialProviders()`; Cognito forwards straight to the provider.
Employers see Google, Microsoft and LinkedIn, candidates Google and LinkedIn,
each only when its flag is on (no divider when none is). The
route guard matches the Cognito sign-in on the decoded, lower-cased route
segments, from both the URL and Next's `nextauth` params. NextAuth reads only
the first two segments, so `/signin/cognito/x`, `/signin/cognito/` and
`/signin/%63ognito` count as the same route; a segment that cannot be decoded
is refused. On a POST to that route it admits either no query params (the
bare hosted page, still used by the candidate apply wizard until A4.7) or
exactly one `identity_provider` naming an enabled provider; anything else
(disabled provider, `scope`/`redirect_uri` overrides, repeated params) gets
`400 { url: …/api/auth/error?error=OAuthSignin }` without reaching NextAuth.
GET passes through unchanged: NextAuth only starts an authorization on POST
(GET renders or redirects to the sign-in page). The enabled providers are
resolved on each social sign-in; if the flags are invalid every
`identity_provider` is refused.

**Operator signal.** The Cognito client's `onServiceError` writes one line,
`[auth] cognito_service_error operation=<op> name=<ErrorName|none>`, with values
outside the closed operation set or the error-name alphabet replaced. A
`NotAuthorizedException` whose message starts with «Unable to verify secret
hash for client» (wrong or rotated client credential) is classified in the
transport as `unavailable` with `name=SecretHashMismatch`; the message is read
only for that check and never returned or logged. Sign-in also signals
`ChallengeNotSupported`, `MalformedAccessToken` and `ConfigurationError`; a
password refresh Cognito refuses with throttling (which the client maps to
`too_many_attempts` silently and which expires the session) signals
`operation=refresh name=RefreshThrottled`.

## Sign-up and email verification (A4.4)

`/candidato/registro` and `/candidato/verificar` render inside `LoginScreen`
(`screen="signUp"` / `screen="verify"`, FloatingLines unchanged). They call
three Server Actions in `lib/auth/sign-up/actions.ts`: `signUpAction`,
`confirmSignUpAction` and `resendCodeAction`. Next accepts a Server Action POST
only when its `Origin` matches the host (no `serverActions.allowedOrigins` is
configured), so only same-origin pages can call them. Each action validates
again on the server: email trimmed, ≤ 254 characters, plausible shape; name
2–120 code points without control characters (the candidate-account rule);
password against `PASSWORD_REQUIREMENTS` (≤ 256); the terms consent as the
literal `terms: true` (the checkbox is not trusted alone); code exactly six
ASCII digits. Invalid input never reaches the limiter or Cognito. Valid input is
counted per client address (`clientIpFrom`, the same derivation as the route
guard; skipped when none can be derived) and per normalized email with the
`signUp` / `confirmSignUp` / `resendCode` budgets above. Over budget, the
action answers `too_many_attempts` without calling Cognito. Results are closed
unions with no password, code or Cognito detail:

| Action | Results |
| --- | --- |
| `signUpAction({ name, email, password })` | `ok` (`confirmed`), `invalid_input` (fields), `email_taken`, `invalid_password`, `too_many_attempts`, `unavailable` |
| `confirmSignUpAction({ email, code })` | `ok`, `invalid_input`, `code_mismatch`, `code_expired`, `too_many_attempts`, `unavailable` |
| `resendCodeAction({ email })` | `ok` (also for unknown or confirmed accounts: existence hiding), `invalid_input`, `too_many_attempts`, `unavailable` |

SignUp always sends the `name` attribute: the real pool requires email and name (L20).
`email_taken` is the only existence signal (Cognito answers it on SignUp). The copy
says no more than «Ese correo no se puede usar para crear un perfil. Si ya tienes
perfil con ese correo, ingresa o restablece tu contraseña.», with links to sign in
and to recover.

**Legal pages (L23).** The consent line links «Léelos aquí: Términos · Aviso de
privacidad» to `/terminos` and `/aviso-de-privacidad` on their own line, outside the
checkbox label, with 44 px targets. Both pages are provisional: public, noindex, a
banner «Texto provisional: el texto legal definitivo se publicará antes del
lanzamiento.», and section headings only, with no clause text, until the real texts
replace them before launch.

**Handoff.** After a successful sign-up, the email (never the password) goes to
`sessionStorage` with origin `sign-up`, the password is cleared and the browser
goes to `/candidato/verificar`; nothing travels in the URL. The verify screen
reads the email once and keeps it without its origin, so a reload keeps the email
but never resends again. It resends a code on arrival **only** for origin
`sign-in` (the A4.3 `not_confirmed` handoff: InitiateAuth sends no code). For
sign-up, SignUp has just sent one, and the 60 s resend wait starts at once.
Without a carried email it asks for one and sends nothing by itself.

**After the code.** Cognito's ConfirmSignUp returns no tokens. The screen
deliberately does not keep the password from the sign-up step to sign in
automatically: that would mean carrying it across a navigation (storage) or
merging both screens to keep it in memory, and the verify screen is also reached
from «Ingresar» and with no context at all. On success it stores the email under
`peopleflow.auth.verifiedEmail` and goes to «Ingresar». There the form opens with
«Tu correo quedó verificado. Ingresa para continuar.», the email filled in and
the focus on the password. The first sign-in lands on `/candidato/ingresar`,
which creates the candidate account (`POST /v2/me/candidate-account`, which
requires `email_verified`). The name field there is prefilled from the session
name (the ID token `name` given at sign-up), so the person only confirms it.
The backend still requires `full_name` in the body, and the route never creates
an account by rendering.

**«Cambiar correo».** An unconfirmed Cognito user cannot change its sign-in
email, so «Cambiar correo» drops the carried email and starts the sign-up again
with the new address. The old user stays UNCONFIRMED: it cannot sign in, and its
code expires after 24 h. Whether Cognito ever purges unconfirmed users is not
verified here. Until an operator deletes it, that email answers `email_taken` on
sign-up.

## Company sign-up (A4.5)

Three steps, the step read in the eyebrow («Registro de empresa · Paso N de 3»):

1. **Tu cuenta** — `/empresa/registro`: the A4.4 `SignUpForm` with
   `audience="employer"` (violet accent, «Correo corporativo» with the hint «De
   preferencia el de tu empresa; te ayudará cuando la verifiquemos.», same terms
   consent, same Server Actions and limits). The email goes to the next step in
   `sessionStorage`, as for candidates.
2. **Verifica tu correo** — `/empresa/verificar`: the A4.4 `VerifyForm`. A correct
   code leads to `/empresa/login` with «Tu correo quedó verificado.»; no automatic
   sign-in (same reasons as A4.4).
3. **Tu empresa** — `/empresa/registro/empresa` (inside `LoginScreen`,
   `screen="company"`, FloatingLines unchanged). It needs a session: without one
   it goes to `/empresa/login?callbackUrl=/empresa/registro/empresa`. Fields follow
   `POST /companies`: «Nombre comercial» (`name`, at least 4 characters), «RFC»
   (exactly 12), «Industria» (required) and an optional «Sitio web»: accepted with
   or without `https://` and `www`, rejected only when it does not look like a
   domain, and sent as `https://…` (`http://` kept if typed). The artboard's
   «Razón social» has no API field, so it is not asked. The name for the account
   is the session name (given at step 1). Only when the session has no usable
   name does the form ask for it.

**Server Actions** (`features/employer-company/company-step-actions.ts`; the token
is resolved on the server, never sent to the browser):

| Action | Results |
| --- | --- |
| `loadCompanyStepAction()` | `ready` (industries) for an account without a users row or a recruiter whose `GET /me/company` is 404 `not_found`; `done` (already in a company: own or invited) → dashboard; `candidate_account`; `unauthenticated` → login; `unavailable` (retry) |
| `completeCompanyStepAction({ fullName, name, rfc, industryId, website? })` | validates every field before any write, then `POST /v2/me/employer-account {full_name}` (201 created / 200 already recruiter), then `POST /companies`: `created` → `/empresa/dashboard`; `invalid` (fields); `candidate_account` (409 `account_exists`); `email_in_use` (409); `email_not_verified` (422); `industry_unavailable`; `forbidden`; `unauthenticated`; `unavailable` (503 `identity_unavailable`, 5xx, network) |

**Idempotence.** The form holds a lock while a request is in flight, so a double
click sends one request. A repeat after a lost response is safe: the account
answers 200 when it is already a recruiter, and the backend refuses a second
company for the same user (409 `already_exists`, «user already has a company
membership»). On that 409 the action reads `GET /me/company`. If this account has
a company, the result is `created`. If it has none, the 409 means the RFC belongs
to another company («Ese RFC ya está registrado.»).

**Guard.** `EmployerGuard` sends an account without a users row (`role: null`)
from any employer page to «Tu empresa», replacing the old «Esta cuenta todavía no
tiene acceso a empresa» screen. It also sends a recruiter whose membership is
`none` there, but only from the landings (`/empresa`, `/empresa/dashboard`), so
Configuración keeps creating a company (e.g. after the local bootstrap) and deep
links stay put. Invitation pages (`/empresa/invitacion/**`) are never redirected:
an invitee joins a company instead of creating one. Candidates still see «Esta
cuenta es de candidato», and stakeholders still land on Métricas.

**`?error=email_in_use`.** It is not wired. A 409 `email_in_use` on the employer
account shows the L5 notice inline on «Tu empresa», with «Cerrar sesión». Moving
it to `/empresa/login?error=email_in_use` would need the logout route
(`app/api/auth/cognito/logout`) to carry a closed notice value through the Cognito
`/logout` hop. That is a follow-up.

## Password recovery (A4.6)

`/empresa/recuperar` and `/candidato/recuperar` (the paths «¿Olvidaste tu
contraseña?» already linked to) render `forgot-password/ForgotPasswordForm` inside
`LoginScreen` (`screen="recover"`, FloatingLines unchanged, the audience's accent).
The form owns the heading and the footer, because both change with the step.

1. **Restablece tu contraseña.** Only the email (`autocomplete=username`) and
   «Enviar código». An admitted request always moves on to step 2 with «Si hay una
   cuenta con ese correo, te enviamos un código.» (existence hiding).
2. **Crea una contraseña nueva.** «Para <email>. Usar otro correo», the six-box
   code, «Nueva contraseña» (`new-password`, show/hide, the live requirements, no
   «confirm password»), «Cambiar contraseña» and «Reenviar código», which calls
   `forgotPasswordAction` again. The resend waits 60 s between sends, the same as
   «Verifica tu correo». A wrong or expired code gets one message, «El código no
   es correcto o ya venció.», and the new password typed so far is kept.
   `invalid_password` marks the field. `too_many_attempts` and failures show the
   shared alerts.
3. **Done.** There is no separate «Listo» screen: ConfirmForgotPassword returns no
   tokens, so the form stores the email under `peopleflow.auth.passwordResetEmail`
   and goes to the audience's «Ingresar». There the form opens with «Tu contraseña
   se actualizó. Ingresa con tu nueva contraseña.», the email filled in and the
   focus on the password. That handoff takes precedence over a leftover
   «verified» one. Both are consumed together.

The email lives in component state. While step 2 is open it is also kept in
`peopleflow.auth.recoveryEmail`, so a reload stays on step 2 without sending
anything. «Usar otro correo» and a successful reset forget it. It never goes in
the URL. The code and the new password stay in memory only, and the password is
cleared before the browser leaves.

**Server Actions** (`lib/auth/forgot-password/actions.ts`, same-origin only like
the sign-up actions). Input is validated before the limiter and Cognito: the
email as in sign-up, the code as exactly six ASCII digits, and `newPassword`
against `PASSWORD_REQUIREMENTS` (≤ 256). Valid input is then counted per client
address (`clientIpFrom`) and per normalized email, with the `forgotPassword` /
`confirmForgotPassword` budgets. Nothing is logged by these actions. The Cognito
client's value-free `onServiceError` line still reports silent and unavailable
outcomes:

| Action | Results |
| --- | --- |
| `forgotPasswordAction({ email })` | `ok` (also for unknown, unconfirmed or unverified accounts: the client maps `UserNotFoundException`, `UserNotConfirmedException`, `InvalidParameterException` and `NotAuthorizedException` to a silent success), `invalid_input`, `too_many_attempts`, `unavailable` |
| `confirmForgotPasswordAction({ email, code, newPassword })` | `ok`, `invalid_input` (fields `email` / `code` / `password`), `code_mismatch`, `code_expired`, `invalid_password`, `too_many_attempts`, `unavailable` |

**Unconfirmed accounts.** Real Cognito sends a reset code only to a verified
email. An UNCONFIRMED sign-up gets `InvalidParameterException` and no code. The
mock Cognito now does the same (L14 advisory 2), so the silent-ok path is
exercised end to end (`client.mock.test.ts`). Such a person sees the same step
2, receives no email, and still has to finish «Verifica tu correo» (signing in
with the right password leads there).

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
   route; the route guard leaves the session-kind hint on that response.
3. `GET /api/auth/cognito/logout` clears the NextAuth cookies (and the hint)
   defensively and redirects OAuth sessions to
   `${COGNITO_DOMAIN}/logout?client_id=...&logout_uri=...`, password sessions
   straight to the audience login page (see Session kinds).

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

A4.2 adds `credentials.test.ts` (authorize mapping, hidden tokens, nothing
sensitive in errors/logs), `credentials-flow.test.ts` (the real NextAuth
pipeline issues the password-session cookie; error codes),
`route-guard.test.ts`, `social.test.ts`, `service-log.test.ts`, the per-kind
cases in `options.test.ts`, `refresh.test.ts`, `logout.test.ts` and the logout
route test, and the hash-mismatch classification in
`cognito/transport.test.ts` and `cognito/client.test.ts`.

`cd frontend && pnpm test src/lib/auth` covers
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

A4.3 adds `rate-limit.test.ts`, the rate-limit, lazy-flag and GET pass-through
cases in `route-guard.test.ts`, `resolveSocialProviders` in `social.test.ts`,
the throttled-refresh signal in `refresh.test.ts` and `options.test.ts`, and
`components/auth/sign-in/*.test.ts(x)` (submit arguments, every error mapping
and its copy, focus and `aria-describedby`, social buttons per flag and
audience, the 10 s timeout, the verify-code handoff).

A4.4 adds `password-policy.test.ts`, `sign-up/operations.test.ts` (validation,
per-IP and per-email limits without calling Cognito, each outcome mapping, nothing
sensitive returned), `sign-up/actions.test.ts` (Server Actions module, client
address as the route guard derives it), `components/auth/sign-up/*.test.tsx`,
`components/auth/verify/*.test.tsx` (paste, auto-advance, Backspace, arrows, the
60 s wait, auto-resend only from the sign-in handoff, the success → «Ingresar»
notice), the routes test under `app/(auth)/candidato/`, the late-settle attempt
counter and the verified notice in `SignInForm.test.tsx`, the prefilled name in
`features/identity/flow.test.tsx`, and the required `name` in the mock Cognito
test.

A4.6 adds `forgot-password/operations.test.ts` (validation before the limiter,
per-IP and per-email budgets, each outcome mapping, nothing sensitive returned or
logged), `forgot-password/actions.test.ts`, the unconfirmed-account silent ok in
`cognito/client.mock.test.ts` and `tests/fixtures/cognito-mock.test.ts`,
`components/auth/forgot-password/ForgotPasswordForm.test.tsx` (both steps, every
error, resend wait, «Usar otro correo», reload, handoff to «Ingresar»), the reset
notice in `SignInForm.test.tsx`, the handoff helpers in `pending-email.test.ts`
and `app/(auth)/recover-routes.test.tsx`.

Both login UIs use a local `SessionProvider` with a 60-second refetch interval
and focus refresh; signed in, they offer the way to the account and «Cerrar
sesión».

A4.7 adds the browser end to end (`frontend/tests/e2e/`), against the mock
Cognito and the fixture API, never a real pool:

- `embedded-auth.spec.ts`: candidate sign-up → code (read from the mock's
  `/__cognito/codes`) → «Tu correo quedó verificado.» → sign-in → «Crear mi
  cuenta de candidato» → `/candidato/dashboard`; employer sign-up → code →
  sign-in → «Tu empresa» → `/empresa/dashboard`; a wrong password and an unknown
  email get the same «Correo o contraseña incorrectos.» (401); an unconfirmed
  account goes to «Verifica tu correo», which resends a code on arrival; forgot
  password → code → new password → «Tu contraseña se actualizó.» → the old
  password fails, the new one signs in; «Cerrar sesión» ends a password session
  without the Cognito `/logout` hop; after 10 refused sign-ins for one email the
  11th, even with the right password, gets 429 «Demasiados intentos.». Every test
  records every requested and navigated URL and fails if a password or a code
  appears in one, and the auth pages keep the FloatingLines panel and canvas.
- `login-acceptance.spec.ts` (rewritten; it asserted the inert shell): the real
  form on both login routes in light/dark × desktop/mobile with axe WCAG A/AA
  (`@a11y`), 40 px targets, the Tab order email → «¿Olvidaste tu contraseña?» →
  password → «Mostrar contraseña» → «Ingresar» → sign-up → other audience with a
  visible focus paint, Enter on an empty form (field errors, nothing sent), the
  show/hide toggle, and the load boundaries (no business mutation, only
  `GET /api/auth/session`, storage unchanged except NextAuth's own
  `nextauth.message` broadcast).
- `tests/fixtures/embedded-auth-accounts.test.ts`: the fixture's identity and
  company routes against the real mock.

The unit follow-ups in A4.7: `takeSignInHandoff` (and `takeVerifiedEmail`)
ignore an implausible stored email with the same `validEmail` as
`readRecoveryEmail`; after a confirm that failed as «No pudimos conectarnos.»
(the answer may have been lost after Cognito changed the password), a later
«El código no es correcto o ya venció.» adds «Si ya cambiaste tu contraseña,
ingresa con la nueva.» with a link to «Ingresar»; the actions tests locate their
module from `import.meta.url`, not the working directory.

**Running the e2e.** From `frontend/`:

```sh
pnpm test:e2e tests/e2e/embedded-auth.spec.ts
pnpm test:e2e tests/e2e/login-acceptance.spec.ts
pnpm test:a11y tests/e2e/login-acceptance.spec.ts
```

`playwright.config.ts` starts the stack when `PLAYWRIGHT_APP_ORIGIN` is unset:
the mock Cognito (`:4599`), the fixture API (`:4010`) and `next dev` on
`http://127.0.0.1:3100` with `NODE_ENV=test` and `COGNITO_IDP_ENDPOINT` on the
mock (the override is refused under `NODE_ENV=production`). Outside CI it reuses
servers already listening on those ports. Details, the fixture routes and the
rate-limit budget per run: `frontend/tests/fixtures/README.md` («E2e stack»,
«Embedded-auth accounts», «Mock Cognito»). Browser visual review and acceptance
against the real pool stay human-owned (below).

## Local run against the real pool

For the human check with real accounts (L20); agents do not touch AWS or read
local environment files. Names only, values come from the operator:

- **Backend** (`backend/`): the usual local configuration plus
  `IDENTITY_PROVIDER=cognito_getuser` and `IDENTITY_COGNITO_REGION=us-east-1`
  (GetUser accepts the access tokens of password sign-in; without these the
  backend keeps the UserInfo provider and onboarding answers 503). Do not set
  `IDENTITY_COGNITO_ENDPOINT` (local/test loopback override for the mock only).
- **Frontend** (`frontend/`, `pnpm dev`): `PEOPLEFLOW_API_BASE_URL` (the local
  backend origin), `PEOPLEFLOW_SITE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`,
  `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`, `COGNITO_ISSUER` and
  `COGNITO_DOMAIN` (Configuration above). Leave `COGNITO_IDP_ENDPOINT` unset: the
  client then calls `https://cognito-idp.<region>.amazonaws.com/` with the region
  of `COGNITO_ISSUER`. `AUTH_SOCIAL_*` stay unset or `off` until the providers
  exist (AWS phase).
- **Pool** (console checklist, done by the user, L20): `ALLOW_USER_PASSWORD_AUTH`
  and `ALLOW_REFRESH_TOKEN_AUTH` on the confidential app client, self sign-up with
  email verification by code, required attributes email and name, scope
  `aws.cognito.signin.user.admin`, `PreventUserExistenceErrors` on.

Then walk the same paths as `embedded-auth.spec.ts` with real mail: create a
candidate and a company account, verify with the emailed code, sign in, finish
onboarding / «Tu empresa», reset a password, sign out. The verification email
text is still Cognito's default English (SES phase).
