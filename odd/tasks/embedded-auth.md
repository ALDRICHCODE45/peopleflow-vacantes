# Embedded auth: own sign-in and sign-up screens on Cognito, with Google, Microsoft and LinkedIn

All authentication happens inside PeopleFlow with its own UI; the Cognito hosted pages disappear. Company verification
(who may publish) is a separate, later feature (frontend-backlog «Company onboarding, verification and embedded auth»).

## Specs

- **S1** User, verbatim (L1): «no quiero el login actual, porque el login actual te redirige a otra pagina de cognito
  para loguearte, para crear tu cuenta, y eso no es lo que queremos, queremos que todo sea dentro del sistema con la
  misma ux/ui etc.. quiero que todos esos procesos se realizen dentro del sistema, no fuera en una pantalla de aws
  cognito» → sign in, sign up, email verification code, forgot / reset password (and later MFA) as PeopleFlow screens.
- **S2** Decision (L2): «Cognito con pantallas propias (recomendado)» — keep Cognito as the identity provider, use its
  API from our own screens.
- **S3** Social login (L2): «Google, Microsoft, LinkedIn» — buttons go straight to the provider's own consent screen,
  never through a Cognito page; GitHub later.
- **S4** Company sign-up (L2): «Cualquiera, autoservicio (recomendado)» — anyone creates an account and a company;
  publishing is gated later by verification (out of scope here).
- **S5** User, verbatim (L3): «el login con pantallas propias en lugar de cognito si se debe de hacer, una cosa es la
  verificacion para que puedan subir vacantes, eso es algo mas, pero el tema del login si hay que hacerlo ahora.»

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| A1 | S1–S4 | Map the current auth (NextAuth + Cognito, login pages, post-confirmation, user_type, company bootstrap) and the Cognito changes needed (explorer) | |
| A2 | S1, S3, S4 | Screen design directions on the canvas (`design/embedded-auth/`): sign in, sign up (candidate / company), code, forgot password, social buttons, errors | |
| A3 | S1–S4 | Technical design + backend needs (with the backend session) + AWS console checklist for the user (AWS stays untouched by agents) | |
| A4 | S1–S4 | Implementation, test-first, behind the existing session model | |

## Log

- **L1** (2026-11-27) User, verbatim: «no quiero el login actual, porque el login actual te redirige a otra pagina de
  cognito para loguearte, para crear tu cuenta, y eso no es lo que queremos, queremos que todo sea dentro del sistema
  con la misma ux/ui etc.. quiero que todos esos procesos se realizen dentro del sistema, no fuera en una pantalla de
  aws cognito, y tambien ligin con google, con linkedin, con github, y con microsoft.. hay que hablarlo, no estoy
  cerrado a nada.»
- **L2** (2026-11-27) User decisions: «Cognito con pantallas propias (recomendado)»; social: Google, Microsoft, LinkedIn;
  company sign-up: «Cualquiera, autoservicio (recomendado)».
- **L3** (2026-11-27) User, verbatim: «Si, pero lo de pagina propia de login?? eso no tiene que ver con la verificacion
  de la empresa, el login con pantallas propias en lugar de cognito si se debe de hacer, una cosa es la verificacion
  para que puedan subir vacantes, eso es algo mas, pero el tema del login si hay que hacerlo ahora.»
- **L4** (2026-11-27) A1 map (explorer): NextAuth v4 with only CognitoProvider (OAuth code + PKCE), JWT session holding
  access/refresh tokens server-side, refresh via /oauth2/token with client secret, logout through Cognito /logout.
  LoginScreen already has an inert email/password form, «¿Olvidaste tu contraseña?», provider buttons and sign-up
  links. Candidate accounts are created JIT by the backend (UserInfo, email_verified required); no self-service path
  creates a recruiter (PostConfirmation group mapping is effectively dead); POST /companies requires user_type
  recruiter. Backend verifies RS256 via JWKS; users linked by cognito_sub, never by email. No fake auth for e2e
  (real Cognito capture); login-acceptance.spec asserts the inert shell. Agent decisions (technical): keep the app
  client with secret and call Cognito only from the Next server with SECRET_HASH; USER_PASSWORD_AUTH from the server
  (the password reaches our server either way; SRP adds complexity without benefit there); a NextAuth
  CredentialsProvider puts the Cognito tokens into the same JWT cookie (jwt/refresh/session unchanged); the Cognito
  OAuth provider stays only for social login with `identity_provider` (no hosted page shown); refresh via
  InitiateAuth REFRESH_TOKEN_AUTH for both kinds; one app client for both roles; employer role from a new backend
  onboarding endpoint mirroring the candidate flow (never from a client field); generic errors that never reveal
  whether an email exists; rate limiting on our auth routes; e2e against a mock Cognito fixture server.
