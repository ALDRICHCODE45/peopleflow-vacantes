# Embedded auth backend — employer onboarding and GetUser identity provider

Branch `feat/embedded-auth-backend` (worktree `peopleflow-vacantes-notif`, from main 75d84651). The frontend replaces the
Cognito hosted UI with an embedded login (frontend feature `odd/tasks/embedded-auth.md`, L4–L5). Contract first
(`docs/contracts/embedded-auth-v1.md`, Draft for frontend review), then implementation with tests.

## Specs

- **S1** Employer onboarding (frontend, seq 22, verbatim): «POST /v2/me/employer-account tal cual lo propusiste: body {full_name}, 200/201/409 account_exists/409 email_in_use/422 email_not_verified/503 identity_unavailable, auditoría EmployerAccountCreated y los mensajes de account_required/wrong_role generalizados.»
- **S2** Proposal it refers to (backend intake reply, verbatim): «Propuesta: POST /v2/me/employer-account, detrás de requireAuth, con body estricto {"full_name"}. Es el mismo flujo que POST /v2/me/candidate-account […]: nombre de 2 a 120 caracteres → si no, 400 validation_error; busca por sub. Si ya es recruiter, 200 con la cuenta y sin llamar al proveedor. Si es candidato, 409 account_exists; consulta el proveedor de identidad. Si el sub no coincide o el email no está verificado, 422 email_not_verified; inserta la fila con su evento de auditoría (EmployerAccountCreated) en una transacción y responde 201. Si el email ya lo usa otra cuenta, 409 email_in_use. Si el proveedor no responde, 503 identity_unavailable. Después de eso, POST /companies funciona como siempre.»
- **S3** GetUser provider (frontend, seq 22, verbatim): «Adapter de UserInfoProvider sobre cognito-idp GetUser, elegido por config, con endpoint configurable para tests. Que funcione para el onboarding de candidato y de empleador.»
- **S4** e2e (frontend, seq 22, verbatim): «En el contrato, para e2e: la config PEM exacta y el stub de GetUser (shape de request/response) que tengo que levantar en los fixtures del frontend.»
- **S5** Console checklist (frontend, seq 22, verbatim): «Una lista corta para el usuario de lo que va a tener que hacer en la consola de Cognito (solo lectura de tu lado, sin tocar AWS): por ahora ALLOW_USER_PASSWORD_AUTH + ALLOW_REFRESH_TOKEN_AUTH en el app client y el self sign-up con email auto-verificado. Lo social, el Lambda PreSignUp y SES van a la fase de AWS como IaC.»
- **S6** Constraint (user, 2026-11-22): «nadie TOQUE NADA DE AWS TODAVIA».

## Tasks

- T1 — S1–S6 — contract `docs/contracts/embedded-auth-v1.md` (Draft) for frontend review — worker (docs) — pending
- T2 — S1, S2 — employer onboarding endpoint, generalized identity error messages — pending (after T1 agreed)
- T3 — S3, S4 — GetUser identity provider adapter selected by config, test endpoint — pending (after T1 agreed)

## Log

- **L1** 2026-11-27, frontend request (seq 22, verbatim): «Gracias, buen hallazgo lo de UserInfo. El usuario aprobó hacer el login propio ahora, así que te pido que escribas el contrato (docs/contracts/embedded-auth-v1.md o como uses) e implementes con tests, en una rama desde main: 1. […S1…] 2. […S3…] 3. […S4…] 4. […S5…] Avisame cuando el contrato quede en Draft, para revisarlo.»
- **L2** 2026-11-27, intake evidence (backend explore): no self-service path creates a recruiter (PostConfirmation group mapping effectively dead, post_confirmation.go:63,144-146; POST /companies requires recruiter, createCompanyWithOwner.go:32-42); candidate onboarding in identity/application/usecases/candidate_identity.go:59 and postgres/candidateAccountStore.go (tx + CandidateAccountCreated audit); UserInfo path pinned to /oauth2/userInfo (runtime/config/identity.go:24) which needs an OAuth access token with openid scope — USER_PASSWORD_AUTH tokens carry only aws.cognito.signin.user.admin (inference, not verified against AWS); JWKS verifier accepts access tokens and never checks scope (jwks_verifier.go:141-157); PEM verifier checks only RS256, iss, aud, exp/nbf (rsa_verifier.go:55-77); identity error messages hard-code «candidate» (shared/httpjson/identity_errors.go:6-11).
