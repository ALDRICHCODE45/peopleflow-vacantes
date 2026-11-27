# Embedded auth v1 (employer onboarding and GetUser identity provider)

Status: **Draft — pending frontend review**. Source of the request: the frontend decisions forwarded in
`odd/tasks/embedded-auth-backend.md` (S1–S6, L1–L2; frontend feature `odd/tasks/embedded-auth.md`, L4–L5). Builds on the
candidate onboarding contract `backend/docs/candidate-identity.md`: every rule there stays unless a decision below says
otherwise. Branch `feat/embedded-auth-backend`. Style follows `notifications-v2.md`. Every `path:line` is a backend path
(under `backend/`) at commit 1266c561 unless it starts with `docs/` or `frontend/`. **Nothing here touches AWS (S6)**:
the Cognito items in §Cognito console checklist are for the user to do, and the AWS facts are taken from the public AWS
documentation (URLs cited inline and in §AWS references).

## Purpose

The frontend replaces the Cognito hosted UI with its own login and sign-up screens (S5): the Next server calls the
Cognito user pools API (`SignUp`, `ConfirmSignUp`, `InitiateAuth` with `USER_PASSWORD_AUTH`) and sends the resulting
access token to this API exactly as today. Two backend gaps block that:

1. **No self-service path creates an employer (recruiter) account** (L2), so a new employer cannot reach
   `POST /companies`. This contract adds `POST /v2/me/employer-account` (S1, S2).
2. **Onboarding reads identity from `/oauth2/userInfo`, which rejects the access tokens the embedded login gets** (L2).
   This contract adds a second identity provider over cognito-idp `GetUser`, selected by configuration (S3), used by
   both onboardings.

It also fixes the exact e2e configuration and the `GetUser` stub the frontend fixtures must run (S4), and a short
read-only console checklist for the user (S5).

## Backend facts this contract builds on

- **Roles live only in `users.user_type`** (`candidate` | `recruiter`, `internal/features/identity/domain/valueobjects/userType.go:21-33`);
  token groups and client id never grant a role (`internal/features/identity/infrastructure/http/requireCandidateRole.go:14-15`).
  `GET /v2/me` returns `{"role", "user"}` from the live row only, `{"role":null,"user":null}` without one
  (`internal/features/identity/infrastructure/http/candidate_identity.go:26-44`, `:53-69`; `backend/docs/candidate-identity.md`).
- **Candidate onboarding is the template.** Use case `internal/features/identity/application/usecases/candidate_identity.go:59-94`:
  name trimmed and 2–120 code points (`:60-63`) → lookup by subject (`:64-70`; non-candidate → `ErrAccountExists`, `:52-57`)
  → no provider → unavailable (`:71-73`) → provider fetch, any error → unavailable (`:74-77`) → subject mismatch or
  unverified → `ErrEmailNotVerified` (`:78-80`) → invalid email → unavailable (`:81-84`) → create (`:85-93`).
  Handler `internal/features/identity/infrastructure/http/candidate_identity.go:71-116`: `Cache-Control: no-store` (`:72`),
  1 MiB JSON cap (`:17`, `:79`), strict `{"full_name"}` decoder rejecting unknown/duplicate keys and trailing data
  (`:118-146`), the bearer token forwarded to the provider (`:92`), error mapping (`:94-109`), `201` when created else
  `200` (`:111-115`).
- **Creation is atomic with its audit event.** `internal/features/identity/infrastructure/postgres/candidateAccountStore.go:36-77`:
  one transaction inserts the user and appends `CandidateAccountCreated` (actor type `user`, actor id = entity id = new
  user id, entity type `user`, metadata `{}`, `:70`); a same-subject concurrent winner is returned with `created=false` and
  no audit (`:65-67`); an email unique violation re-reads by subject so a same-subject winner beats its own email collision
  (`:47-60`). The insert is `ON CONFLICT (cognito_sub) WHERE deleted_at IS NULL DO NOTHING`
  (`db/queries/users.sql:1-10`); lookups ignore soft-deleted rows (`db/queries/users.sql:16-18`).
- **Audit catalog**: `CandidateAccountCreated` is the only non-company-scoped entry (`internal/features/audit_events/domain/entities/catalog.go:60`,
  `:189`); `Validate` refuses unknown types and metadata keys (`catalog.go:302-329`); every catalog type must have exactly one
  row in the Annex of `docs/contracts/audit-log-v1.md` (`internal/features/audit_events/domain/entities/catalog_annex_test.go:17-62`;
  `docs/contracts/audit-log-v1.md:331`). The notifications capture decorator ignores types it does not build
  (`internal/features/notifications/capture/capture.go:64-74`).
- **`POST /companies` requires a live recruiter**: unknown subject → `401 unauthenticated`, non-recruiter →
  `403 forbidden` (`internal/features/companies/application/usecases/createCompanyWithOwner.go:31-42`,
  `internal/features/companies/infrastructure/http/handler.go:347-350`); route `cmd/api/router.go:193` (`requireAuth` only).
- **PostConfirmation never creates a recruiter in practice**: it is off unless `IDENTITY_POSTCONFIRMATION_ENABLED=true`
  (`internal/features/identity/application/post_confirmation.go:56`, `:110-113`) and maps only from `cognito:groups`
  (`:63-71`, `:141-150`), which a self-signed-up user does not have.
- **The UserInfo provider** (`internal/features/identity/infrastructure/userinfo/client.go`): `GET` with
  `Authorization: Bearer` (`:24-46`), 5 s deadline and no redirects (`:54-58`), 16 KiB body cap (`:18`, `:42-44`), strict
  parse of `sub`, `email`, `email_verified` (bool or exact `"true"`/`"false"`), duplicates/missing/invalid types →
  unavailable (`:71-123`). Config `IDENTITY_USERINFO_ENDPOINT` must be HTTPS with path exactly `/oauth2/userInfo`
  (`internal/runtime/config/identity.go:9`, `:13-27`); absent → onboarding answers `503 identity_unavailable`. Wiring:
  `cmd/api/main.go:171-174`, `:269-273` (the provider is built only when the endpoint is set). Local bootstrap has its own
  UserInfo client over the same transport (`internal/features/identity/infrastructure/localbootstrap/userinfo.go:65`) and is
  not changed here.
- **Verifiers.** `IDENTITY_JWT_MODE` selects `jwks` or `pem`; `APP_ENV` must be `production`, `local` or `test`
  (`internal/features/identity/infrastructure/auth/config.go:46-61`). JWKS checks RS256, `kid`, issuer, optional audience,
  `exp`, `token_use`, optional `client_id`, non-empty `sub`, 30 s skew (`auth/jwks_verifier.go:27`, `:100-159`) and **never
  checks `scope`**. PEM (local/test only, `auth/config.go:114-116`) requires a public RSA key, an absolute-URL issuer and an
  audience, rejects any `IDENTITY_JWT_CLIENT_ID` value (`auth/config.go:110-143`), and verifies only RS256, `iss`, `aud`
  and the standard time claims with zero skew (`auth/rsa_verifier.go:54-78`); it reads no `token_use`/`client_id` and does
  not require `sub` (an empty subject is answered `401` by the handlers, `candidate_identity.go:56-59`, `:74-77`).
  `RequireAuth` answers every failure `401 {"error":"unauthorized","code":"unauthenticated"}` with
  `WWW-Authenticate: Bearer realm="identity"` (`internal/features/identity/infrastructure/http/middleware.go:23-54`, `:75-84`).
  The integration-test signer shows the PEM token shape (`cmd/api/draft_flow_integration_test.go:86-87`, `:192-249`).
- **Identity error codes** (`internal/shared/httpjson/identity_errors.go:5-35`): `account_required` 403 «candidate account
  required», `wrong_role` 403 «candidate role required», `account_exists` 409, `email_in_use` 409, `email_not_verified` 422,
  `identity_unavailable` 503. Every error body is exactly `{error, code}` (`internal/shared/httpjson/errors.go:226-230`).

## Decisions

`S#` / `L#` refer to `odd/tasks/embedded-auth-backend.md`; `CI` to `backend/docs/candidate-identity.md`.

| # | Source | Decision — reason |
| --- | --- | --- |
| D1 | S1, S2 | **`POST /v2/me/employer-account` mirrors `POST /v2/me/candidate-account` exactly**: same gate (`NoStore` + `requireAuth`, no role gate), same strict body `{"full_name"}`, same name rule, same order of checks, same response shape as `GET /v2/me`, same error codes. Only the target role (`recruiter`), the "already the other role" side and the audit event differ — one flow, two roles, no new rules for the frontend to learn. |
| D2 | S2 | **Same-subject live recruiter → `200` with the existing account, no provider call, no write; same-subject live candidate → `409 account_exists`.** Symmetric for the candidate endpoint (unchanged). An account never changes role (CI). |
| D3 | S2 | **The employer account is only the user row.** No company, membership or role in a company is created; `POST /companies` stays unchanged and makes the caller `owner` of the new company (`createCompanyWithOwner.go:31-66`). |
| D4 | S1 | **New audit event `EmployerAccountCreated`**, non-company-scoped, category `members` (Q1), actor type `user`, actor id = entity id = new user id, entity type `user`, metadata exactly `{}` — the `CandidateAccountCreated` pattern; committed in the insert transaction, its failure rolls the insert back. The Annex of `audit-log-v1.md` gets its row (the annex test requires it). |
| D5 | S1 | **Generalized messages, codes unchanged**: `account_required` → «account required», `wrong_role` → «account role not allowed». Statuses, codes and every route behavior stay; only the `error` text changes. |
| D6 | S3 | **New provider `cognito_getuser`**: `POST https://cognito-idp.<region>.amazonaws.com/` with `X-Amz-Target: AWSCognitoIdentityProviderService.GetUser`, body `{"AccessToken": …}`, no AWS credentials. It implements the existing `UserInfoProvider` port (`candidate_identity.go:27-33`), so both onboardings use whichever provider is configured. |
| D7 | S3, L2 | **Why GetUser**: access tokens from user pools API sign-in carry only the `aws.cognito.signin.user.admin` scope, `/oauth2/userInfo` requires `openid` and rejects them, and `GetUser` requires exactly `aws.cognito.signin.user.admin` (§Why GetUser). L2's inference is now verified against AWS docs. |
| D8 | S3 | **Selection by config**: `IDENTITY_PROVIDER = userinfo \| cognito_getuser`; unset keeps today's behavior. `IDENTITY_COGNITO_REGION` (required for `cognito_getuser`) builds the endpoint; `IDENTITY_COGNITO_ENDPOINT` overrides it **only** when `APP_ENV` is `local`/`test` and the host is loopback. Mixed or partial configuration fails startup with a static message (§Configuration). |
| D9 | S2, S3 | **Every provider failure is `503 identity_unavailable`**, including `NotAuthorizedException` and `UserNotFoundException` (Q2); only a parsed answer whose `sub` differs from the token subject, or whose email is not verified, is `422 email_not_verified`. No new error codes (S1 fixed the set). |
| D10 | S3 | **Missing `email_verified` attribute in a GetUser answer = not verified → `422`** (Q3); a present value other than exactly `"true"`/`"false"` is malformed → `503`. GetUser lists only attributes that have values. The UserInfo parser keeps its current rule. |
| D11 | S3 | **Same hardening as UserInfo**: 5 s deadline, 16 KiB response cap, no redirects, strict parse, provider bodies and tokens never in errors or logs. New: one value-free warning per failure with a closed `class` (§Failure mapping) so operators can tell throttling from revoked tokens. |
| D12 | S4 | **e2e uses PEM mode plus a local GetUser stub** on loopback; the exact env, token claims and stub bodies are in §e2e. The backend sends the stub the same request it sends AWS. |
| D13 | S5, S6 | **The console checklist is the user's**; the backend needs nothing from Cognito except what it already reads (issuer, JWKS, client id) plus the region. The existing app client keeps its client secret; `SECRET_HASH` is the Next server's concern; `GetUser` needs no secret (§Cognito console checklist). |
| D14 | S3 | **In production with JWKS and a Cognito issuer, `IDENTITY_COGNITO_REGION` must equal the issuer's region** (`https://cognito-idp.<region>.amazonaws.com/<pool>`), checked at startup — a token can only be read by the pool's own region. |

## `POST /v2/me/employer-account` (D1–D4)

### Route and gate

Mounted in the identity group next to the candidate endpoint (`cmd/api/router.go:395-402`):
`identityhttp.NoStore`, `d.requireAuth`, no role gate. Every response, errors included, carries
`Cache-Control: no-store`.

### Request

```http
POST /v2/me/employer-account
Authorization: Bearer <access token>
Content-Type: application/json

{"full_name":"Laura Gómez"}
```

Body exactly `{"full_name": <string>}` — the candidate decoder (`candidate_identity.go:118-146`) unchanged: unknown or
duplicate keys (also escaped aliases), non-object bodies, wrong types and trailing values are `400 invalid_request`;
missing, `null`, or a name outside 2–120 Unicode code points after trimming surrounding whitespace is
`400 validation_error`. Internal whitespace and case are preserved. Over 1 MiB → `413 payload_too_large`. The browser
cannot send an email or a role.

### Order of checks

1. `requireAuth` — missing/invalid token → `401 unauthenticated`. Empty subject → `401`.
2. JSON transport (`413`, `400 invalid_request`), then the strict body (`400 invalid_request`).
3. Name rule → `400 validation_error`.
4. Lookup by subject (live rows only): live **recruiter** → `200` with that account (no provider call, no write); live
   **candidate** → `409 account_exists`.
5. No provider configured → `503 identity_unavailable`.
6. Provider call with the request's own bearer token; any failure → `503 identity_unavailable` (§Failure mapping).
7. Provider `sub` ≠ token subject, or email not verified → `422 email_not_verified`.
8. Provider email invalid for `valueobjects.NewEmail` → `503 identity_unavailable`.
9. One transaction: insert `users` row (`user_type = recruiter`, email from the provider, name from the body) +
   `EmployerAccountCreated` → `201`. Email already used by another live subject (any role) → `409 email_in_use`.
   A concurrent same-subject winner → that row: recruiter → `200`, candidate → `409 account_exists`; no audit for the
   loser.

Rejections at steps 1–8 and conflicts write nothing (no user, no audit).

### Responses

`201 Created` — new employer; body exactly the `GET /v2/me` shape:

```json
{"role":"recruiter","user":{"id":"0193f2a4-7c1e-7a10-9d2b-5f0e8c4a1b23","email":"laura@empresa.mx","full_name":"Laura Gómez"}}
```

`200 OK` — same-subject live recruiter (retry, or an account that already existed); original id, email and name are
kept even if the body sends a different name:

```json
{"role":"recruiter","user":{"id":"0193f2a4-7c1e-7a10-9d2b-5f0e8c4a1b23","email":"laura@empresa.mx","full_name":"Laura Gómez"}}
```

Errors (exact bodies):

| Status | Body | When |
| --- | --- | --- |
| 400 | `{"error":"invalid request","code":"invalid_request"}` | malformed JSON, unknown/duplicate key, trailing data |
| 400 | `{"error":"validation failed","code":"validation_error"}` | missing/`null`/short/long name |
| 401 | `{"error":"unauthorized","code":"unauthenticated"}` | no/invalid token (plus `WWW-Authenticate`) |
| 409 | `{"error":"account already exists","code":"account_exists"}` | the subject already has a candidate account |
| 409 | `{"error":"email already in use","code":"email_in_use"}` | the verified email belongs to another live account |
| 413 | `{"error":"payload too large","code":"payload_too_large"}` | body over 1 MiB |
| 422 | `{"error":"email not verified","code":"email_not_verified"}` | provider subject mismatch or email not verified |
| 503 | `{"error":"identity unavailable","code":"identity_unavailable"}` | provider not configured, unreachable, rejected the token, or malformed answer |
| 500 | `{"error":"an internal error occurred","code":"internal_error"}` | database failure |

### Idempotency and concurrency

Retries are safe: the second call of the same subject is answered at step 4 with `200` and the unchanged account. Two
concurrent first calls of the same subject create one row and one `EmployerAccountCreated`; the loser gets `200` with the
winner's row (same body). A concurrent candidate onboarding of the same subject that wins makes the employer call
`409 account_exists` (and vice versa). Implementation: the existing `ON CONFLICT (cognito_sub)` upsert and the
`created.ID != user.ID` check (`candidateAccountStore.go:65-67`), generalized to both types.

### Audit `EmployerAccountCreated` (D4)

| Field | Value |
| --- | --- |
| Catalog | `EventEmployerAccountCreated = "EmployerAccountCreated"`, `{Category: CategoryMembers, CompanyScoped: false}` (no metadata keys) |
| Actor | type `user`, id = new user id |
| Entity | type `user`, id = new user id |
| Company / vacancy | `NULL` (the account has no company yet) |
| Metadata | `{}` — no email, name or token |
| Annex row (`audit-log-v1.md`) | type `EmployerAccountCreated`, category `members`, label «Creó su cuenta de empresa» |

Like `CandidateAccountCreated`, it never appears on a company audit screen (no company). It is not a notification type.

### After onboarding

| Moment | `GET /v2/me` | `GET /me/company` | `POST /companies` |
| --- | --- | --- | --- |
| Signed in, no account | `{"role":null,"user":null}` | `401 unauthenticated` (unknown subject) | `401 unauthenticated` |
| After candidate onboarding | `{"role":"candidate","user":{…}}` | `404` (not a member) | `403 forbidden` |
| After employer onboarding | `{"role":"recruiter","user":{…}}` | `404` (no membership yet; `router.go:427-431`, `internal/features/companies/application/usecases/companyMemberService.go:127-139`, `internal/features/companies/infrastructure/http/memberHandler.go:558-563`) | allowed → creator becomes `owner` |
| After `POST /companies` | unchanged (`role` stays `recruiter`; `/v2/me` has no company) | the membership | — |

The frontend reads company membership from the existing company routes, never from `/v2/me`.

### Generalized messages (D5)

| Code | Status | Before | After |
| --- | --- | --- | --- |
| `account_required` | 403 | `candidate account required` | `account required` |
| `wrong_role` | 403 | `candidate role required` | `account role not allowed` |

Affected callers (codes and statuses unchanged, only the `error` text):

- `RequireCandidateRole` (`internal/features/identity/infrastructure/http/requireCandidateRole.go:30-41`), so every route
  behind `requireCandidate`: `/v2/me/assessments*` (`cmd/api/router.go:225-234`); `/v2/me/saved-jobs*`, `/v2/me/cvs*`,
  `POST /v2/jobs/{id}/applications`, `GET /v2/me/applications`, `PUT /v2/me/applications/{id}/message-read`
  (`router.go:235-250`); `/v2/me/notifications*` incl. preferences (`router.go:354-364`); `POST /jobs/{jobId}/applications`
  (`router.go:410`); `/me/profile/*`, `GET /me/applications` (`router.go:417-421`).
- Candidate notifications scope `CandidateScope` (`internal/features/notifications/inbox/handler.go:68-87`, `account_required` at `:78`).
- Tests/fixtures that assert the text: `cmd/api/psychometric_candidate_flow_integration_test.go:333` (backend, updated in
  T2) and `frontend/src/features/saved-vacancies/fixtures/real-responses.json:351` (frontend fixture; the frontend code
  branches on `code` only, e.g. `frontend/src/features/candidate-cvs/failure.ts:13`).

## Why GetUser (D7)

- «Amazon Cognito issues access tokens in response to user pools API requests like InitiateAuth. Because they don't
  contain any scopes, the userInfo endpoint doesn't accept these access tokens»; the access token must carry «at least
  an openid scope claim» — https://docs.aws.amazon.com/cognito/latest/developerguide/userinfo-endpoint.html
- «A token from Amazon Cognito API sign-in only contains the scope aws.cognito.signin.user.admin» —
  https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html ; same
  note in https://docs.aws.amazon.com/cognito/latest/developerguide/user-pools-API-operations.html
- `GetUser`: «Authorize this action with a signed-in user's access token. It must include the scope
  aws.cognito.signin.user.admin», and «Amazon Cognito doesn't evaluate AWS Identity and Access Management (IAM) policies …
  you can't use IAM credentials to authorize requests» —
  https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GetUser.html
- GetUser is a *token-authorized* operation: «To send these requests in a public client … you don't need to configure
  any credentials. Include an AccessToken … You can also send requests directly to the service endpoints … include the
  access or session token in the POST body» — https://docs.aws.amazon.com/cognito/latest/developerguide/user-pools-API-operations.html

Consequence: hosted-UI tokens (scopes `openid email profile`, CI §Configuration) work with UserInfo but not with
GetUser, and embedded-login tokens work with GetUser but not with UserInfo. The provider must match the login the
frontend uses (Q4, §Deployment order).

## GetUser provider (D6, D8–D11, D14)

### Request (exact)

```http
POST / HTTP/1.1
Host: cognito-idp.<region>.amazonaws.com
Content-Type: application/x-amz-json-1.1
X-Amz-Target: AWSCognitoIdentityProviderService.GetUser

{"AccessToken":"<the caller's bearer token, verbatim>"}
```

- URL `https://cognito-idp.<region>.amazonaws.com/` (regional endpoint list:
  https://docs.aws.amazon.com/general/latest/gr/cognito_identity.html), or the override (§Configuration). Path always `/`.
- `awsJson1_1` protocol: `POST`, path `/`, `Content-Type: application/x-amz-json-1.1`,
  `X-Amz-Target: {service}.{operation}` — https://smithy.io/2.0/aws/protocols/aws-json-1_1-protocol.html
- **No `Authorization` header, no SigV4, no AWS credentials, no client secret** (the token goes only in the body).
  The token is the same string `RequireAuth` verified, read from the request header (`candidate_identity.go:92`); it is
  JSON-encoded, never logged.
- Go's transport may add `Accept-Encoding: gzip` and `User-Agent`; the stub must not depend on them.

### Response (success)

`200`, JSON (AWS's own sample answers `Content-Type: application/x-amz-json-1.0`, so the content type is not checked):

```json
{
  "Username": "a1b2c3d4-5678-90ab-cdef-EXAMPLE11111",
  "UserAttributes": [
    {"Name": "sub", "Value": "a1b2c3d4-5678-90ab-cdef-EXAMPLE11111"},
    {"Name": "email_verified", "Value": "true"},
    {"Name": "email", "Value": "laura@empresa.mx"}
  ]
}
```

Shape per https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GetUser.html (`Username`,
`UserAttributes[{Name, Value}]`, optional `MFAOptions`, `PreferredMfaSetting`, `UserMFASettingList`).

Parse rules (strict like `userinfo/client.go:71-123`):

- One top-level object, no trailing data; `UserAttributes` present exactly once and an array; other top-level keys
  ignored (`Username` is not used).
- Each element an object with string `Name`; `Value` a string when present. Unknown attribute names ignored.
- `sub`, `email`, `email_verified` at most once each (a duplicate → malformed).
- `sub` and `email` required, non-blank strings → else malformed.
- `email_verified`: `"true"` → verified, `"false"` → not verified, **absent → not verified** (D10), anything else →
  malformed.
- Output `VerifiedIdentity{Subject, Email, EmailVerified}`; the use case does the subject comparison and email
  validation exactly as today (`candidate_identity.go:78-84`).

### Failure mapping (D9, D11)

Errors follow `awsJson1_1`: non-2xx status, error name in the `X-Amzn-ErrorType` header and/or the body `__type`
(either may carry a `:`-suffix or a `namespace#` prefix to strip) —
https://smithy.io/2.0/aws/protocols/aws-json-1_1-protocol.html . GetUser's modeled errors (all HTTP 400 except
`InternalErrorException` 500) are listed in the API reference above; common errors (`ThrottlingException` 400,
`ServiceUnavailable` 503, `InternalFailure` 500 …) in
https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/CommonErrors.html .

| Provider outcome | Onboarding result | Logged `class` |
| --- | --- | --- |
| 200, parsed, `sub` matches, `email_verified` `"true"`, valid email | continue to insert | — |
| 200, parsed, `sub` ≠ token subject | `422 email_not_verified` | — |
| 200, parsed, `email_verified` `"false"` or absent | `422 email_not_verified` | — |
| 200, email fails `NewEmail` | `503 identity_unavailable` | `malformed` |
| 200, malformed / missing `sub`/`email` / duplicate / over 16 KiB | `503 identity_unavailable` | `malformed` / `too_large` |
| 400 `NotAuthorizedException` (revoked, expired, wrong-pool or forged token) | `503 identity_unavailable` | `not_authorized` |
| 400 `UserNotFoundException` / `UserNotConfirmedException` / `PasswordResetRequiredException` | `503 identity_unavailable` | `user_state` |
| 400 `TooManyRequestsException` / `ThrottlingException` | `503 identity_unavailable` | `throttled` |
| any other 4xx (incl. `ForbiddenException`, `InvalidParameterException`, `ResourceNotFoundException`) | `503 identity_unavailable` | `client_error` |
| 5xx (`InternalErrorException`, `ServiceUnavailable`, …) | `503 identity_unavailable` | `server_error` |
| 3xx (redirect refused) | `503 identity_unavailable` | `redirect` |
| deadline (5 s) / connection / TLS error | `503 identity_unavailable` | `timeout` / `transport` |

The class is derived from the sanitized error name against a closed list; the raw header, body, message and token
never reach logs or errors. One `slog.Warn("identity provider failed", "provider", "cognito_getuser", "class", …)` per
failure, plus `request_id` when present (same bounded pattern as `middleware.go:62-68`). No retries (the user retries;
the onboarding is idempotent).

### Limits

5 s total deadline (client and context), response body ≤ 16 KiB (`userinfo.MaxResponseBytes`), redirects refused,
one request per onboarding attempt and only for subjects without a live account (step 4 short-circuits retries). The
request body is the token only (Cognito access tokens are a few KiB; no extra cap).

### Configuration (D8, D14)

| Key | Values | Rule |
| --- | --- | --- |
| `IDENTITY_PROVIDER` | unset, `userinfo`, `cognito_getuser` | Trimmed, exact lowercase. Unset → legacy: `userinfo` when `IDENTITY_USERINFO_ENDPOINT` is set, else no provider (onboarding `503`). Any other value → startup error. |
| `IDENTITY_USERINFO_ENDPOINT` | HTTPS `/oauth2/userInfo` URL | Unchanged validation (`identity.go:22-25`). Required when `IDENTITY_PROVIDER=userinfo`; **must be unset** when `cognito_getuser`. |
| `IDENTITY_COGNITO_REGION` | e.g. `us-east-1` | Required when `cognito_getuser`; must match `^[a-z]{2}(-[a-z]+)+-[0-9]+$`. Builds `https://cognito-idp.<region>.amazonaws.com/`. **Must be unset** otherwise. D14: in `APP_ENV=production` with `IDENTITY_JWT_MODE=jwks` and an issuer host `cognito-idp.<r>.amazonaws.com`, `<r>` must equal it. |
| `IDENTITY_COGNITO_ENDPOINT` | e.g. `http://127.0.0.1:4599` | Optional, only with `cognito_getuser`. Rejected when `APP_ENV=production`. Must be `http` or `https`, host `localhost`, `127.0.0.0/8` or `::1`, optional port, path empty or `/`, no credentials, query or fragment. Replaces the regional URL; the region is still required and validated. |

Startup errors are static strings naming the key, never the value (as `identity.go:23-25`). `APP_ENV` is read with the
same normalization as the verifier (`auth/config.go:50-53`). Both onboardings receive the same provider instance in
`cmd/api/main.go` (the `identityProvider` variable, `main.go:269-273`).

Production example (no secrets; the region is public):

```dotenv
APP_ENV=production
IDENTITY_JWT_MODE=jwks
IDENTITY_JWT_ISSUER=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXAMPLE
IDENTITY_JWT_CLIENT_ID=example-app-client-id
IDENTITY_JWT_TOKEN_USE=access
IDENTITY_JWT_CACHE_TTL=10m
IDENTITY_JWT_FETCH_TIMEOUT=5s
IDENTITY_PROVIDER=cognito_getuser
IDENTITY_COGNITO_REGION=us-east-1
```

`IDENTITY_JWT_AUDIENCE` stays unset: user-pool access tokens have no `aud` unless resource-bound
(`auth/README.md`; https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html).

## e2e (S4, D12)

### Backend environment

```dotenv
APP_ENV=test
IDENTITY_JWT_MODE=pem
IDENTITY_JWT_ISSUER=https://e2e.peopleflow.test/identity
IDENTITY_JWT_AUDIENCE=peopleflow-e2e
IDENTITY_JWT_PUBLIC_KEY_PEM=<SPKI public key, see below>
IDENTITY_PROVIDER=cognito_getuser
IDENTITY_COGNITO_REGION=us-east-1
IDENTITY_COGNITO_ENDPOINT=http://127.0.0.1:4599
```

- `APP_ENV` `test` or `local` (PEM is refused in production, `auth/config.go:114-116`).
- **`IDENTITY_JWT_CLIENT_ID` must be absent or empty** — any value fails startup in PEM mode (`auth/config.go:111-113`).
  `IDENTITY_JWT_TOKEN_USE`, `_CACHE_TTL`, `_FETCH_TIMEOUT` are not read in PEM mode; leave them unset.
  `IDENTITY_USERINFO_ENDPOINT` must be unset (D8).
- Issuer: any absolute URL (`auth/config.go:121-128`); audience: any non-empty string. The values above are
  recommendations; the token must carry the same ones.
- Key: an RSA **public** key, PEM `-----BEGIN PUBLIC KEY-----` (SPKI; `RSA PUBLIC KEY` PKCS#1 also parses), 2048 bits
  recommended. A private key is refused (`auth/config.go:136-141`). The variable must contain real newlines: the API
  does not unescape `\n` (only `godotenv` does, for double-quoted values in a `.env` file). Node:
  `generateKeyPairSync("rsa", {modulusLength: 2048, publicKeyEncoding: {type: "spki", format: "pem"}, privateKeyEncoding: {type: "pkcs8", format: "pem"}})`.
- Port `4599` is a suggestion; any loopback port works.

### Tokens the frontend mock must sign

Header `{"alg":"RS256","typ":"JWT","kid":"e2e"}` (`kid` optional in PEM mode). Payload:

```json
{
  "iss": "https://e2e.peopleflow.test/identity",
  "aud": "peopleflow-e2e",
  "sub": "e2e-employer-0001",
  "iat": 1795000000,
  "exp": 1795003600,
  "token_use": "access",
  "client_id": "peopleflow-e2e",
  "username": "e2e-employer-0001",
  "scope": "aws.cognito.signin.user.admin"
}
```

- Required by the PEM verifier: RS256 with the matching private key, `iss` exactly, `aud` (string or array containing
  the audience). **`aud` is required here although real Cognito access tokens have none** (PEM checks it, JWKS-with-client-id does not).
- `sub` non-empty (else the identity handlers answer `401`); it is the account key.
- `exp` strongly recommended (PEM does not require it, but validates it when present); `iat` must not be in the future
  — zero clock skew in PEM mode (jwx default validators).
- `token_use`, `client_id`, `username`, `scope`: ignored by the PEM verifier; recommended so the mock looks like a real
  user-pool access token (`token_use=access` and `client_id` are what production checks).
- The same token is what the backend forwards to the stub in `AccessToken`; the stub may decode its payload (no
  signature check needed) to read `sub`.

### GetUser stub

Listen on the loopback address of `IDENTITY_COGNITO_ENDPOINT`. The backend sends exactly §GetUser provider → Request:

```http
POST / HTTP/1.1
Content-Type: application/x-amz-json-1.1
X-Amz-Target: AWSCognitoIdentityProviderService.GetUser

{"AccessToken":"eyJhbGciOiJSUzI1NiIs…"}
```

Recommended stub checks (so contract drift fails loudly): method `POST`, path `/`, both headers exact, body a JSON
object with a string `AccessToken`; otherwise answer `400` with
`{"__type":"SerializationException","message":"stub: unexpected request"}` (the backend maps it to `503`).

Responses (the stub chooses per `sub` or per scenario; all `Content-Type: application/x-amz-json-1.1`):

| Scenario | Status | Extra header | Body | API result |
| --- | --- | --- | --- | --- |
| Success | 200 | — | `{"Username":"<sub>","UserAttributes":[{"Name":"sub","Value":"<sub>"},{"Name":"email_verified","Value":"true"},{"Name":"email","Value":"laura@empresa.mx"}]}` | `201` (or `409 email_in_use` if that email has another account) |
| Unverified email | 200 | — | same with `{"Name":"email_verified","Value":"false"}` | `422 email_not_verified` |
| Subject mismatch | 200 | — | success body with a different `sub` value | `422 email_not_verified` |
| Invalid / revoked token | 400 | `x-amzn-ErrorType: NotAuthorizedException` | `{"__type":"NotAuthorizedException","message":"Invalid Access Token"}` | `503 identity_unavailable` |
| User not found | 400 | `x-amzn-ErrorType: UserNotFoundException` | `{"__type":"UserNotFoundException","message":"User does not exist."}` | `503 identity_unavailable` |
| Throttled | 400 | `x-amzn-ErrorType: TooManyRequestsException` | `{"__type":"TooManyRequestsException","message":"Rate exceeded"}` | `503 identity_unavailable` |
| Provider down | 500 | `x-amzn-ErrorType: InternalErrorException` | `{"__type":"InternalErrorException","message":"Internal error"}` | `503 identity_unavailable` |
| Malformed | 200 | — | `{"Username":"x"}` | `503 identity_unavailable` |

Messages are free text; the backend reads only the status and, for logging, the error name. A slow stub (> 5 s) yields
`503`. The stub is not called for a subject that already has an account (step 4), so "retry → 200" needs no stub
response.

## Cognito console checklist (S5, D13) — for the user, read-only from our side

On the **existing** user pool and the **existing** app client (the one whose id is `IDENTITY_JWT_CLIENT_ID` and
`COGNITO_CLIENT_ID` in the frontend); no new pool or client. Do it before the frontend cutover.

1. **App client → Authentication flows**: enable `ALLOW_USER_PASSWORD_AUTH` (console: «Sign in with username and
   password») and `ALLOW_REFRESH_TOKEN_AUTH`. Leave `ALLOW_USER_SRP_AUTH` as it is (Q6). Do **not** enable
   `ALLOW_ADMIN_USER_PASSWORD_AUTH` (needs IAM credentials on the server) or `ALLOW_USER_AUTH` (choice-based/passwordless,
   not used). Source: https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow-methods.html
2. **Client secret — keep it.** The existing client is confidential (`COGNITO_CLIENT_SECRET`, `docs/employer-cognito-auth.md:36`);
   a secret cannot be added or removed after creation (a new client would change the client id the API trusts). The Next
   server must therefore send `SECRET_HASH = Base64(HMAC_SHA256(client secret, username + client id))` in
   `InitiateAuth` (`AuthParameters.SECRET_HASH`) and `SecretHash` in `SignUp`, `ConfirmSignUp`,
   `ResendConfirmationCode`, `ForgotPassword`, `ConfirmForgotPassword`; for `REFRESH_TOKEN_AUTH` the hash username is the
   user's `sub` when the username is not a sign-in attribute. The secret stays server-side (never in the browser).
   `GetUser` (backend) needs no secret. Sources: https://docs.aws.amazon.com/cognito/latest/developerguide/signing-up-users-in-your-app.html ,
   https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_InitiateAuth.html ,
   https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html
3. **Sign-up → Self-service sign-up**: enabled.
4. **Sign-in identifier**: email (email as username, or email alias). Check only — it cannot be changed after the pool
   exists (https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html); if the pool
   uses something else, report it: that is a new pool, i.e. the AWS/IaC phase.
5. **Sign-up → Attribute verification and user account confirmation**: «Allow Cognito to automatically send messages to
   verify and confirm» on, attribute to verify **email**, message type **verification code** (the embedded screen asks for
   the code and calls `ConfirmSignUp`; a link would land on Cognito). Source:
   https://docs.aws.amazon.com/cognito/latest/developerguide/signing-up-users-in-your-app.html
6. **Required attributes**: report which ones are required (they cannot be changed after creation, same attributes
   doc). The backend needs only `email` (+ `email_verified`, `sub`); the name comes from the onboarding form. If `name`
   is required, the frontend must send it in `SignUp`.
7. **Email delivery**: the Cognito default sender has a daily limit
   (https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html) — fine for development; SES is the
   AWS/IaC phase.
8. **Token validity (app client)**: report current values. Defaults: access/ID 1 h, refresh 30 days
   (https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UserPoolClientType.html ,
   https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html).
   The API needs only a valid `exp` (30 s skew); recommendation: access 60 min, refresh per product decision.
9. **Hosted UI / managed login, callback and sign-out URLs, scopes**: leave untouched until the cutover is stable (it is
   the rollback path, Q4).

Deferred to the AWS phase as IaC (S5, S6): social identity providers, the **PreSignUp Lambda** that links a social
sign-up to an existing native user by email, SES (domain identity, custom sender), retiring the PostConfirmation Lambda
and `post_confirmation.go` (dead in practice, §Backend facts), removing `ALLOW_USER_SRP_AUTH`, threat protection / WAF.

## Error codes

No new codes. Used by the two onboarding endpoints:

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalid_request` | malformed JSON, unknown/duplicate key, trailing data |
| 400 | `validation_error` | name missing/`null`/outside 2–120 code points |
| 401 | `unauthenticated` | no/invalid token, empty subject |
| 409 | `account_exists` | the subject already has the other role |
| 409 | `email_in_use` | the verified email belongs to another live account |
| 413 | `payload_too_large` | body over 1 MiB |
| 422 | `email_not_verified` | provider subject mismatch, email not verified (incl. absent attribute in GetUser) |
| 503 | `identity_unavailable` | no provider, provider failure of any kind, malformed answer, invalid email |
| 403 | `account_required` / `wrong_role` | candidate gates (unchanged codes, new messages, D5) |

## Limits

Body ≤ 1 MiB; name 2–120 code points; provider deadline 5 s; provider response ≤ 16 KiB; no redirects; one provider
call per first onboarding attempt.

## Audit

`EmployerAccountCreated` (D4) in the insert transaction; `CandidateAccountCreated` unchanged. Rejections, retries and
conflicts are not audited. Provider failures are logged value-free (D11), not audited.

## Deployment order

1. **Backend T2 + T3** merged with `IDENTITY_PROVIDER` unset everywhere: identical behavior except the new endpoint, the
   new audit type and the two messages.
2. **Frontend e2e** with PEM + the GetUser stub (§e2e) against that build.
3. **User console checklist** (§Cognito console checklist) — no backend change.
4. **Cutover**: the frontend switches to the embedded login **in the same release** that sets
   `IDENTITY_PROVIDER=cognito_getuser` + `IDENTITY_COGNITO_REGION` (and unsets `IDENTITY_USERINFO_ENDPOINT`) — hosted-UI
   tokens cannot call GetUser (Q4). Rollback = revert both.
5. **AWS/IaC phase** (social, PreSignUp linking, SES, PostConfirmation retirement) later, when S6 is lifted.

## Slices (~400 lines each, tests included)

| Slice | Task | Content |
| --- | --- | --- |
| A1 | T2 | Generalized messages (`identity_errors.go`), updated assertions (`identity_errors_test.go` if needed, `psychometric_candidate_flow_integration_test.go:333`); `EventEmployerAccountCreated` in the catalog + Annex row in `docs/contracts/audit-log-v1.md` (annex test). |
| A2 | T2 | Use case generalized by target role (candidate / recruiter; name error renamed, same mapping), store `CreateAccount` choosing the audit event by user type, handler `CreateEmployerAccount`, route; unit tests (order of checks, 200/201/409/422/503, no writes on rejection) and integration tests on `DRAFT_TEST_DATABASE_URL` (atomic audit, rollback, concurrent same-subject, candidate↔employer conflicts, then `POST /companies` succeeds); `backend/docs/candidate-identity.md` → covers both endpoints. |
| A3 | T3 | `internal/runtime/config/identity.go`: `IDENTITY_PROVIDER`, `IDENTITY_COGNITO_REGION`, `IDENTITY_COGNITO_ENDPOINT`, legacy default, mixed-config errors, production/loopback rules, D14 region check; table tests. |
| A4 | T3 | `internal/features/identity/infrastructure/cognitogetuser` client (request, strict parse, failure classes, bounded transport, value-free logs) + httptest stub tests for every row of §Failure mapping; `main.go` selection; a cmd/api test proving both onboardings reach the stub. |

## Open questions (with recommendations)

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Category of `EmployerAccountCreated` in the audit catalog and its label. | **`members`**, label «Creó su cuenta de empresa». It never shows on a company screen (no company), so the choice only matters for the catalog/annex. |
| Q2 | Should a GetUser `NotAuthorizedException` (token revoked by global sign-out, or expired between verification and call) be `401 unauthenticated` instead of `503`? | **Keep `503 identity_unavailable`** (S1 fixed the code set; the frontend shows «intentá de nuevo» and its session refresh handles real expiry). Revisit if e2e shows confusion. |
| Q3 | GetUser answer without `email_verified`: `422` or `503`? | **`422 email_not_verified`** (D10): Cognito omits attributes without a value, retrying cannot fix it, and the UI can send the user to verification. |
| Q4 | Transition: hosted-UI tokens lack `aws.cognito.signin.user.admin`, embedded tokens lack `openid`. | **Switch provider in the same release as the frontend cutover** (§Deployment order). Alternative if both logins must coexist: allow and request `aws.cognito.signin.user.admin` in the hosted UI client scopes and use `cognito_getuser` for both — a console change, so only on the user's decision. |
| Q5 | `IDENTITY_COGNITO_ENDPOINT` is loopback-only. Does the frontend e2e run the API and the stub in containers with service hostnames? | **Keep loopback-only** unless the frontend needs otherwise; if so, allow any host only when `APP_ENV=test`. |
| Q6 | Keep `ALLOW_USER_SRP_AUTH` on the app client? | **Keep it** for now (harmless; the hosted UI does not depend on it, but nothing gains from changing AWS now); remove in the IaC phase. |
| Q7 | Exact generalized messages. | **«account required»** and **«account role not allowed»** (frontend branches on `code` only; only one fixture holds the text). |

## Out of scope (v1)

- Any AWS change (S6): pool, app client, Lambdas, SES, IaC — the user does §Cognito console checklist manually.
- Social login, account linking by email, PreSignUp/PostConfirmation changes, retiring `post_confirmation.go`.
- Role change, account reversal or deletion (CI); employer onboarding creating a company in the same call.
- Token revocation checks on ordinary API requests (the verifier stays offline, `auth/README.md`); GetUser is called
  only during onboarding.
- Changes to the local identity bootstrap (`cmd/localidentitybootstrap`) or its UserInfo client.
- Sign-up, sign-in, password reset and `SECRET_HASH` code — frontend (Next server).

## AWS references

- https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GetUser.html
- https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/CommonErrors.html
- https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_InitiateAuth.html
- https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UserPoolClientType.html
- https://docs.aws.amazon.com/cognito/latest/developerguide/userinfo-endpoint.html
- https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html
- https://docs.aws.amazon.com/cognito/latest/developerguide/user-pools-API-operations.html
- https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow-methods.html
- https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html
- https://docs.aws.amazon.com/cognito/latest/developerguide/signing-up-users-in-your-app.html
- https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html
- https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html
- https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html
- https://docs.aws.amazon.com/general/latest/gr/cognito_identity.html
- https://smithy.io/2.0/aws/protocols/aws-json-1_1-protocol.html
