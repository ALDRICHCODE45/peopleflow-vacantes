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
| A4 | S1–S4 | Implementation of design 01 · Panel dividido, test-first, behind the existing session model | |
| A4.1 | S1, S2 | Server-only Cognito client (SECRET_HASH; InitiateAuth, SignUp, ConfirmSignUp, Resend, ForgotPassword, ConfirmForgotPassword) + mock Cognito fixture | c62f757d, 09c14ac9 |
| A4.2 | S1–S3 | NextAuth CredentialsProvider into the same JWT cookie; refresh via REFRESH_TOKEN_AUTH; logout per session kind; OAuth scope + identity_provider with per-provider flags | 45833b2d, 7fd8bbdd |
| A4.3 | S1, S3 | Ingresar screens (employer, candidate) on LoginScreen, FloatingLines kept as is; generic errors; rate limiting | 12833dc7, a1a1ce93, e25d74f8, 8917f183 |
| A4.4 | S1 | Candidate sign-up + Verifica tu correo + candidate-account onboarding | fe5f4832, cac98023 |
| A4.5 | S1, S4 | Company sign-up: Tu cuenta → Verifica tu correo → Tu empresa (employer-account + POST /companies) | |
| A4.6 | S1 | ¿Olvidaste tu contraseña? request → code + new password → done | |
| A4.7 | S1–S4 | E2e on the mock Cognito + PEM backend; retire inert-shell assertions; docs | |

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
- **L5** (2026-11-27) User decisions: account linking — «Yo digo que la opcion 2, pero realmente mi idea es que despues
  de esto, ir ya de lleno a AWS con la creacion del ambiente de pruebas, entonces eso me parece que lo vamos a tocar
  ahi... pero si esto necesita mucho de aws, podemos adelantar aws ahora y hacemos eso despues, que me recomiendas y
  por que?»; MFA «Después (recomendado)»; screens «Direcciones en el canvas (recomendado)». Agent recommendation: build
  the embedded auth now against a mock Cognito plus one console toggle on the existing dev pool (enable
  ALLOW_USER_PASSWORD_AUTH on the app client) so password sign-in, sign-up, code and reset work end to end; social
  providers, the PreSignUp linking Lambda and SES go into the AWS test-environment phase as infrastructure as code,
  avoiding manual console setup that would be redone. Social buttons ship behind a per-provider flag (hidden until the
  provider exists); until linking exists, a social sign-in with an already registered email shows «Ese correo ya tiene
  cuenta. Entra con tu contraseña.».
- **L6** (2026-11-27) Backend intake: no endpoint creates a recruiter today (PostConfirmation group mapping is dead;
  POST /companies → 401 without a users row, 403 if not recruiter). Proposal accepted: POST /v2/me/employer-account
  (requireAuth, strict body {full_name} 2–120) mirroring POST /v2/me/candidate-account — 200 if already recruiter, 201
  created (audit EmployerAccountCreated), 409 account_exists if candidate, 409 email_in_use, 422 email_not_verified,
  503 identity_unavailable; account_required / wrong_role messages generalized. Blocking finding: UserInfo
  (/oauth2/userInfo) needs an OAuth access token with scope openid, so tokens from USER_PASSWORD_AUTH would be rejected
  and onboarding would 503 → new UserInfoProvider adapter on cognito-idp GetUser with the user's access token (no IAM,
  no hosted domain), chosen by config. Verifier accepts USER_PASSWORD_AUTH access tokens (token_use=access,
  client_id). No candidate JIT: rows are created only by the onboarding endpoints. No linking: unique partial indexes
  on cognito_sub and lower(email) → social with an existing email gets 409 email_in_use (orphan federated identity in
  Cognito, no data risk); providers' email_verified to confirm in the AWS phase. E2e: PEM verifier mode (APP_ENV
  local|test, RS256, iss/aud/sub/iat/exp; add token_use and client_id for parity; helper in
  cmd/api/draft_flow_integration_test.go:192-249) plus a configurable GetUser stub.
- **L7** (2026-11-27) User asked to evaluate https://github.com/aws/aws-emulator. Findings (GitHub API, no clone): official
  AWS local emulator, CC0, created 2026-09-11, ~10k stars, AI-maintained with several releases a day (v1.0.665 on
  2026-11-27), Docker/CLI/embedded, HTTPS on 127.0.0.1:9297, telemetry ON by default (`--telemetry off`), README: «Don't
  use it for production workloads or to test security». Has cognito-idp, ses, sesv2, s3, sqs, secretsmanager, lambda,
  eventbridge, ecs. Open known gaps relevant to us: Cognito Lambda triggers not invoked (PreSignUp linking can't be
  tested); a HIGH issue where the pool's JWKS document is not served and InitiateAuth CUSTOM_AUTH is unimplemented
  (our backend verifies via JWKS; USER_PASSWORD_AUTH status unverified); Lambda invoke cannot run deployment packages.
  Agent recommendation: a time-boxed spike before relying on it — run the image with telemetry off and check exactly
  SignUp, ConfirmSignUp, InitiateAuth USER_PASSWORD_AUTH + REFRESH_TOKEN_AUTH, ForgotPassword/Confirm, GetUser, the
  JWKS URL, plus S3 and SES; adopt it for local/CI if those pass, otherwise keep the hand-made Cognito mock (PEM) for
  e2e. Never a substitute for the real AWS test environment or for security testing.
- **L8** (2026-11-27) Backend contract `docs/contracts/embedded-auth-v1.md` (feat/embedded-auth-backend) approved:
  POST /v2/me/employer-account (strict {full_name} 2–120, same gate/order as candidate, response shape of GET /v2/me,
  200 already recruiter, 409 account_exists, audit EmployerAccountCreated in the tx, label «Creó su cuenta de
  empresa»); generalized messages «account required» / «account role not allowed» (codes unchanged); GetUser provider
  (unsigned POST to cognito-idp with X-Amz-Target GetUser; IDENTITY_PROVIDER=cognito_getuser + IDENTITY_COGNITO_REGION;
  IDENTITY_COGNITO_ENDPOINT only local/test loopback; provider failure 503, sub mismatch / unverified 422; 5 s, 16 KiB,
  no redirects); e2e PEM config (aud mandatory in PEM mode) and GetUser stub shapes. Agent decision Q4: the OAuth
  provider (still used for social login) requests scope aws.cognito.signin.user.admin permanently so GetUser accepts
  both password and social tokens; console checklist gains that allowed scope; IDENTITY_PROVIDER can switch before the
  frontend cutover. Console checklist (user): ALLOW_USER_PASSWORD_AUTH + ALLOW_REFRESH_TOKEN_AUTH, self sign-up, email
  auto-verified, scope aws.cognito.signin.user.admin; the app client is confidential → Next computes SECRET_HASH.
- **L9** (2026-11-27) aws-emulator spike (v1.0.665, built from the official Dockerfile — no prebuilt image; 2.24 GB;
  telemetry off; `--auth off` needed for dummy keys): Cognito with a confidential client passes CreateUserPool/Client,
  SignUp (SECRET_HASH), AdminConfirmSignUp (+AdminUpdateUserAttributes email_verified=true), InitiateAuth
  USER_PASSWORD_AUTH (RS256 access token, token_use=access, client_id, sub), REFRESH_TOKEN_AUTH (SECRET_HASH with the
  sub, same as real Cognito), GetUser, GlobalSignOut, ResendConfirmationCode; JWKS and openid-configuration are served
  and verify (the L7 HIGH issue is fixed). Gaps: the emailed confirmation/reset codes cannot be read (only a
  CustomEmailSender Lambda gets them; SES messages unreadable), `iss` is always https://127.0.0.1:<port>/<pool>,
  self-signed TLS, Lambda triggers not invoked, auth-off skips S3 signature checks; client default
  PreventUserExistenceErrors LEGACY leaks existence (set ENABLED, as in real Cognito). Verdict: partial adoption — use
  it for local/CI login, refresh, GetUser, logout, JWKS verification, error mapping and S3 (pin the version, seed users
  via admin calls, backend IDENTITY_JWT_ISSUER=https://127.0.0.1:9297/<pool>, host networking); keep a small mock for
  the code-entry screens; security testing only in real AWS. Agent decision: the AWS test environment must set
  PreventUserExistenceErrors=ENABLED on the app client.
- **L10** (2026-11-27) Backend: contract checklist gains 2c PreventUserExistenceErrors=ENABLED. The backend JWKS verifier
  and the GetUser adapter both validate TLS, so the emulator's self-signed https can't back the real backend in e2e.
  Agent decision: e2e uses a frontend-owned mock Cognito (InitiateAuth/SignUp/Confirm/Forgot/GetUser) in
  tests/fixtures, signing RS256 tokens with the PEM key the backend runs with (PEM mode + the contract's GetUser stub);
  the aws-emulator stays optional for manual local exploration. Follow-ups for the frontend from the backend change:
  fixture real-responses.json:351 still says «candidate role required» (now «account role not allowed»), and any test
  pinning the audit event type count must expect 76 (EmployerAccountCreated).
- **L11** (2026-11-27) User chose design 01 · Panel dividido, verbatim: «Me gusta mucho la primera opcion hermano,
  evidentemente la primera opcion no tiene las animaciones que si tiene actualmente el sistema, me refiero a la
  animacion que aparece en la parte izquierda de la pantalla de login tanto en candidatos como para empresas, esa
  animacion hay que mantenerla tal cual esta, y ya hermano, todo lo demas me gusta mucho la opcion 1. y como esto toca
  login, autenticacion, yo si creo necesario pasarlo por los lentes de rdd, que dices?» → the left panel keeps the
  current FloatingLines animation unchanged for both audiences. RDD: every A4 work unit is Risk item 2 (security) → its
  own commit, assess with escalate item 2, independent verify and native review (lenses risk, resilience, reliability;
  readability where user-facing copy changes). Canvas handoff in progress.
- **L12** (2026-11-27) Backend A3 usable locally (feat/embedded-auth-backend: T2 248d8846, T3 a5df82ee, review fixes
  134945e9; independent verify running; not in main). POST /v2/me/employer-account {full_name} → 201
  {role:"recruiter", user{id,email,full_name}}; 200 on retry (no provider call); 409 account_exists if candidate; 422
  email_not_verified; 503 identity_unavailable; POST /companies then works. GetUser provider via
  IDENTITY_PROVIDER=cognito_getuser + IDENTITY_COGNITO_REGION (unset → current userInfo); e2e
  IDENTITY_COGNITO_ENDPOINT=http://127.0.0.1:<port>/ (APP_ENV local|test only). Stub request: POST / with
  Content-Type application/x-amz-json-1.1, X-Amz-Target AWSCognitoIdentityProviderService.GetUser, no Authorization,
  body {"AccessToken":"<bearer>"}; a non-200 2xx or an email_verified without Value counts as malformed. Frontend
  follow-ups (A4.7): saved-vacancies/fixtures/real-responses.json:351 «candidate role required» → «account role not
  allowed»; audit catalog now 76 types (EmployerAccountCreated, members, «Creó su cuenta de empresa»).
- **L13** (2026-11-27) A4.1 committed c62f757d (server-only Cognito client, 7 operations, closed outcome unions, no
  logging, existence hiding except sign-up email_taken, 16 KiB/timeout transport, loopback-only override; mock Cognito
  with ephemeral RSA key and public key at /__cognito/public-key, GetUser stub per L12). Independent verify: no
  blockers; fixes requested (in progress): email normalization (trim+lowercase) for Username/attribute/SECRET_HASH,
  an `onServiceError(operation, errorName)` operator hook for silent and unavailable outcomes (a wrong client secret
  would otherwise look like «code sent»), refuse the override under NODE_ENV=production even with local preview, and
  a comment on not_confirmed. Console checklist addition: confirm the real pool's password policy matches
  PASSWORD_REQUIREMENTS (8+, lower, upper, number, symbol) and that usernames are case-insensitive. Pre-existing break
  noted for the backlog: tests/fixtures/jobs-server.test.ts fails in beforeAll (jobs-server.mjs cannot resolve
  '@/features/candidate/model').
- **L14** (2026-11-27) A4.1 done: c62f757d + verify fixes 09c14ac9 (email trim+lowercase everywhere, mock matches
  usernames exactly, onServiceError hook, override refused under NODE_ENV=production; e2e Next must run with
  NODE_ENV=test). Native review approved and acknowledged (lineage review-0021833ce73c8116; lenses risk, resilience,
  reliability). Advisory follow-ups: (1) R3/R4 a wrong or rotated client secret makes Cognito answer
  NotAuthorizedException «Unable to verify secret hash», mapped to invalid_credentials / code_mismatch, so operators
  get no signal → in A4.2 the transport classifies that exact Cognito message (never returned or logged) as a
  configuration failure: outcome unavailable + onServiceError; (2) R3 the mock lets an unconfirmed user get a reset
  code → in A4.6 the mock answers UserNotConfirmedException so the existence-hiding branch runs end to end.
- **L15** (2026-11-27) A4.2 committed 45833b2d: NextAuth credentials provider «password» (tokens handed to jwt under a
  non-enumerable symbol; authorize returns only id/name/email; sub from the access token shape for refresh only;
  codes invalid_credentials / not_confirmed / too_many_attempts / unavailable; challenges → unavailable); cookie keys
  as OAuth plus authKind; refresh dispatch — password via REFRESH_TOKEN_AUTH with the sub, OAuth and legacy cookies
  stay on /oauth2/token (scopes kept; social usernames are not the sub); logout by kind through a 120 s HttpOnly hint
  cookie (password → audience login, others → Cognito /logout); GlobalSignOut not used (signs out every device;
  RevokeToken is a follow-up); OAuth scope adds aws.cognito.signin.user.admin; AUTH_SOCIAL_{GOOGLE,MICROSOFT,LINKEDIN}
  flags with optional *_IDP names; the sign-in route accepts no params or exactly one enabled identity_provider (400
  otherwise); secret-hash NotAuthorized → unavailable + SecretHashMismatch; operator line «[auth] cognito_service_error
  operation=… name=…». 750 scoped tests, 5638 related tests pass. Console checklist: confirm the pool uses email as
  the sign-in attribute with username = sub (refresh SECRET_HASH depends on it). Independent verify running.

- **L16** (2026-11-27) A4.2 done: 45833b2d + verify fixes 7fd8bbdd (guard on decoded NextAuth segments incl. extra or
  encoded segments, undecodable segment → 400; __Host-peopleflow.logout-kind on https, plain name only for http
  loopback, scheme from validated NEXTAUTH_URL). Native review approved and acknowledged (lineage
  review-2adb3651539a0926). Advisory follow-ups folded into A4.3: R1 per-IP and per-email rate limiting on the
  password callback (and the sign-up/code/forgot routes) before the screens ship — the provider is live once deployed;
  R3/R4 resolve social flags lazily so a bad AUTH_SOCIAL_* value only disables identity_provider sign-ins (operator log
  line) and never breaks /api/auth/*; R3 apply the sign-in param allowlist to POST only (pin GET with a test); R4 a
  token-free operator signal when a password refresh fails on Cognito throttling.
- **L17** (2026-11-28) Backend embedded auth merged to local main by the backend session with the user's approval
  (4e26564e, not pushed): independent verify without blockers; build, 136 packages, 30 identity integration tests,
  go vet, sqlc diff clean. IDENTITY_PROVIDER unset keeps today's behaviour. The user received the Cognito console
  checklist from the backend session.
- **L18** (2026-11-28) A4.3 committed 12833dc7: SignInForm inside LoginScreen for /empresa/login and /candidato/login
  (FloatingLines.tsx and the visual panel untouched), signIn("password", {redirect:false}) with artboard copy per code,
  social buttons by server flags (employer Google/Microsoft/LinkedIn, candidate Google/LinkedIn), not_confirmed hands
  the email to the verify screen via sessionStorage; «Ingresar con Cognito» and the hosted sign-up rewrite removed
  without a rollback flag (revert is the rollback; ships only after ALLOW_USER_PASSWORD_AUTH); rate limiting per IP
  and per hashed email on the password callback (429 before Cognito; in-memory per instance, AWS phase needs a shared
  store/WAF and a pinned trusted proxy hop); lazy social flags; POST-only allowlist; RefreshThrottled signal. User
  decision: «Mantener sesión iniciada» — «Sin casilla (recomendado)». Known: /registro, /recuperar, /verificar links
  404 until A4.4–A4.6 (no publication before then); tests/e2e/login-acceptance.spec.ts breaks (A4.7); nothing sets
  ?error=email_in_use yet (identity onboarding redirect, A4.4/A4.5); the verify screen must resend on arrival.
  Independent verify running.
- **L19** (2026-11-28) A4.3 verify fixes a1a1ce93 (8 KiB capped body read → 413 after counting the IP; password
  cleared with flushSync before the verify handoff; stale pending email dropped on submit; .checkbox removed). Native
  review approved and acknowledged (lineage review-b32a34524cd28c7c; risk, resilience, reliability; the request
  context file was omitted because it exceeded the reviewer budget). Advisory follow-ups taken before A4.4 (A4.3b):
  per-email budget counted only for requests with a valid NextAuth CSRF cookie/token pair (no free targeted lockout);
  no per-IP limiting when the client address is unknown (no shared «unknown» bucket), per-email still applies;
  over-limit keys are never evicted before expiry; restore «Cerrar sesión» in the expired-session state; after the
  10 s timeout re-check the session and continue if it became authenticated; log an invalid AUTH_SOCIAL_* key once
  per process. Known and accepted: dead-end /registro /verificar /recuperar until A4.4–A4.6 and the failing
  login-acceptance e2e until A4.7 (no publication before A4.7); no hosted-login fallback (rollback = revert; the
  hosted UI config is untouched in Cognito).
- **L20** (2026-11-28) The user configured the real Cognito console (pool «User pool - shqlba», us-east-1, app client
  peopleflow-web-dev; no agent touched AWS; details in backend odd/tasks/embedded-auth-backend.md L8): ALLOW_USER_PASSWORD_AUTH
  added (REFRESH_TOKEN_AUTH, USER_SRP_AUTH and USER_AUTH remain); OAuth scope aws.cognito.signin.user.admin added;
  PreventUserExistenceErrors and token revocation already on; confidential client (SECRET_HASH); access/ID 60 min,
  refresh 5 days; self sign-up on with email verification by CODE; required attributes email AND name (SignUp must
  send name); sign-in identifier is email; verification email text still English (SES phase); hosted UI and callback
  URLs untouched as rollback. Backend will set IDENTITY_PROVIDER=cognito_getuser, IDENTITY_COGNITO_REGION=us-east-1.
  Local test with real accounts once the own screens are complete.
- **L21** (2026-11-28) A4.3b e25d74f8 + review correction 8917f183. Independent verify blocked e25d74f8 on (B1) the CSRF
  cookie split differing from NextAuth (`token|hash|x` passed NextAuth but skipped the email budget → unlimited
  guesses bounded only per IP) and (B2) the overstated «no free targeted lockout» claim; native review required a
  correction for the fail-closed full table (a filled table refused every untracked user → global sign-in outage, a
  regression introduced by my own L19 request). Correction (one plan, 90 lines): split the cookie exactly like
  NextAuth with a test for the 3-segment cookie; a full table always admits a new key, evicting expired, then the
  oldest under-limit, then the over-limit key whose window ends soonest; docs state honestly that a CSRF pair is not
  tied to a person, so targeted lockout of a known email for one window remains (accepted trade-off). Native review
  approved after correction and acknowledged (lineage review-d15f13a1f791f1d1). Remaining advisories carried to the
  AWS phase / A4.7: requests with no derivable client IP skip the per-IP limit (needs the trusted proxy setting);
  retry-then-late-settle navigation race in SignInForm (attempt counter); invalid AUTH_SOCIAL_* logged once per
  process could go silent (rate-limited log).
- **L22** (2026-11-28) A4.4 committed fe5f4832: /candidato/registro and /candidato/verificar on the LoginScreen shell
  (FloatingLines untouched); server actions signUp/confirmSignUp/resendCode with validation, shared limiter per IP and
  normalized email, closed outcomes; email handed off only via sessionStorage with an origin; auto-resend on arrival
  only from the sign-in not_confirmed handoff; after a correct code → /candidato/login with «Tu correo quedó
  verificado. Ingresa para continuar.» (no auto sign-in); onboarding prefills the name from the session; shared
  password-policy module; mock SignUp requires name; SignInForm attempt counter (L21 race). 1096 scoped tests pass.
  Open for the user: Términos / Aviso de privacidad URLs (no legal pages exist; the terms checkbox is required).
  Known: «Cambiar correo» leaves the old UNCONFIRMED user in Cognito (still answers email_taken for that address);
  ?next= not carried through registro → verificar → login; flaky unrelated test pipeline-movement/board.test.tsx
  «reports its live coverage». Independent verify running.
- **L23** (2026-11-28) User decision on the terms links: «Páginas provisorias en el sitio (recomendado)» — create
  /terminos and /aviso-de-privacidad with provisional text clearly marked as a draft; the partners supply the real
  legal text before publication; the sign-up checkbox links to both.
- **L24** (2026-11-28) A4.4 follow-ups cac98023: server-side terms consent (`terms === true`, before limiter and
  Cognito) and provisional /terminos and /aviso-de-privacidad (draft banner, headings only, noindex) linked from the
  sign-up consent line. Independent verify of fe5f4832: no blockers. Native review UNAVAILABLE for A4.4: the
  candidate (fe5f4832 + cac98023, ~2.7k lines with tests) exceeds the reviewer context budget
  (lens_context_budget_exceeded, no authority created); recorded as nativeReviewOutcome=unavailable. Lesson applied
  to A4.5–A4.7: smaller work units (backend-of-the-screen and screen as separate commits) so each fits the native
  review.
- **L25** (2026-11-28) User: once everything current is finished (A4.5–A4.7 and the local test with real Cognito), both
  sessions (frontend and backend) close before AWS; the AWS work starts in new sessions. Before closing, each session
  leaves its full state in Engram and its feature documents. Communicated to the backend session.
