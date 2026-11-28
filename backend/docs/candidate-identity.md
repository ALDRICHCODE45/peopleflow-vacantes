# Candidate and employer identity — P2b0 + embedded-auth v1

Contract: design §11, T39 (S20/S21); employer onboarding and the GetUser
provider: [`docs/contracts/embedded-auth-v1.md`](../../docs/contracts/embedded-auth-v1.md)
(D1–D14). Same Cognito pool and app client for both roles. Only a live `users.user_type` grants a role; token groups/client id do
not. No migration, role changes, email linking, or onboarding reversal.

## API

All three endpoints require the caller's Bearer access token (`RequireAuth`) and
return `Cache-Control: no-store`, including errors. Invalid/missing tokens:
`401 unauthenticated`. Errors contain exactly `{error, code}`.

`GET /v2/me` returns `200` with exactly:

```json
{"role":"candidate","user":{"id":"…","email":"ana@example.com","full_name":"Ana Pérez"}}
```

Role is `candidate`, `recruiter`, or `null`. No live row for the authenticated
subject (including a soft-deleted row) returns exactly
`{"role":null,"user":null}`. No identity-provider request or write occurs.

The BFF also calls `POST /v2/me/session/start` and `/end` for every signed-in user
(candidates included): they answer `204` and record nothing for a candidate; see
[audit-capture.md](audit-capture.md).

`POST /v2/me/candidate-account` accepts exactly `{"full_name":"Ana Pérez"}`.
Names use the existing normalization (trim surrounding whitespace, preserve
internal whitespace and case), then require 2–120 Unicode code points. The
browser cannot supply an email or role. Unknown/duplicate keys (also escaped
aliases), malformed JSON/types, non-object bodies and trailing values are
`400 invalid_request`; missing/null/invalid-length names are
`400 validation_error`. The inherited JSON transport cap is 1 MiB (`413
payload_too_large`).

`POST /v2/me/employer-account` (embedded-auth-v1 D1–D4) is the same endpoint
for the `recruiter` role: same gate, strict body, name rule, order of checks,
error codes and response shape. A same-subject live recruiter is a `200` retry
(no provider call, no write); a same-subject live candidate is
`409 account_exists` (and the candidate endpoint answers a recruiter the same
way). The account is only the user row: no company or membership is created,
and `POST /companies` (unchanged) then makes the caller `owner`.

For a new subject, the API fetches the identity server-side (UserInfo or
GetUser, §Configuration) using that request's access token. Subject must match, and email verification must be true (Cognito's
boolean or exact string representation). A subject mismatch or explicit false
verification returns `422 email_not_verified`; unreachable/non-200, malformed,
missing/invalid-type claims, or invalid email return `503 identity_unavailable`.
The form supplies the name; UserInfo need not contain `name`.

| Result | Meaning |
| --- | --- |
| `201` | New candidate/employer; body exactly the GET body |
| `200` | Same-subject live account of the requested role (retry); original name/email/id retained, no provider call or write |
| `409 account_exists` | Same-subject account of the other role; never changes role |
| `409 email_in_use` | Verified email belongs to another live subject; never links by email |
| `422 email_not_verified` | Subject mismatch or unverified email |
| `503 identity_unavailable` | No provider configured, provider unreachable/rejected the token (incl. GetUser `NotAuthorizedException`), or malformed answer |

Input is validated before account lookup. An existing candidate/recruiter is
resolved without UserInfo. Creation uses the existing partial unique subject
and email constraints. The insert and its audit event — `CandidateAccountCreated`
(category `candidate`) or `EmployerAccountCreated` (category `members`, label
«Creó su cuenta de empresa»), both non-company-scoped — commit in one
transaction. Event: actor type `user`, actor/entity id = new user
id, entity type `user`, metadata exactly `{}` (no PII/token). Audit failure
rolls back the insert. Concurrent same-subject requests create one account and
one audit; other requests return the unchanged winner without another audit
(a concurrent winner of the other role makes the loser `409 account_exists`).
Conflicts and all other rejections create neither user nor audit.

## Legacy candidate routes (requested authorization change)

Every route below now runs `RequireAuth` then `RequireCandidateRole` against a
live user, with no-store even on authentication/authorization rejection:

- `GET`, `PUT /me/profile/`
- `GET`, `PUT /me/profile/languages/`
- `GET /me/applications`
- `POST /jobs/{jobId}/applications`

No live account: `403 account_required` (formerly downstream 401).
Recruiter: `403 wrong_role` (formerly admitted). Messages are role-neutral since
embedded-auth-v1 D5: «account required» and «account role not allowed» (codes
and statuses unchanged). Valid candidates retain their
existing handler/body behavior. Applications share one mount with per-method
gates so recruiter middleware cannot intercept the candidate POST.
Recruiter application reads/transitions and company membership gates are
unchanged: unknown subject stays `401 unauthenticated`, non-member candidates
stay `403 forbidden` on role-gated company routes.

## Additive catalog codes

`account_required` 403 («account required»), `wrong_role` 403 («account role
not allowed»), `account_exists` 409,
`email_in_use` 409, `email_not_verified` 422, `identity_unavailable` 503.
Existing codes/envelopes remain unchanged.

## Configuration and console checks (§11.4, embedded-auth-v1 D8)

Provider selection: **`IDENTITY_PROVIDER`** = unset | `userinfo` |
`cognito_getuser` (trimmed, exact lowercase; anything else fails startup). One
provider instance serves both onboardings.

- Unset: legacy — `userinfo` when `IDENTITY_USERINFO_ENDPOINT` is set, else no
  provider (onboarding `503`). `IDENTITY_COGNITO_*` must then be unset.
- `userinfo`: `IDENTITY_USERINFO_ENDPOINT` required (below); `IDENTITY_COGNITO_*` unset.
- `cognito_getuser`: `IDENTITY_COGNITO_REGION` required (`^[a-z]{2}(-[a-z]+)+-[0-9]+$`),
  `IDENTITY_USERINFO_ENDPOINT` unset. Calls `https://cognito-idp.<region>.amazonaws.com/`
  with an unsigned `POST`, `Content-Type: application/x-amz-json-1.1`,
  `X-Amz-Target: AWSCognitoIdentityProviderService.GetUser`, body
  `{"AccessToken": <caller token>}` (no AWS credentials). `IDENTITY_COGNITO_ENDPOINT`
  overrides the URL only with `APP_ENV` `local`/`test` and a loopback host
  (`localhost`, `127.0.0.0/8`, `::1`; no path, credentials, query or fragment) —
  for the e2e stub. In `APP_ENV=production` with `IDENTITY_JWT_MODE=jwks` and a
  Cognito issuer, the region must equal the issuer's (D14). Absent
  `email_verified` = not verified (`422`). Every failure is `503` plus one
  `WARN "identity provider failed"` with `provider=cognito_getuser`, a closed
  `class` (`malformed`, `too_large`, `not_authorized`, `user_state`, `throttled`,
  `client_error`, `server_error`, `redirect`, `timeout`, `transport`) and
  `request_id` when present — never the token, email or provider body.

Startup errors are static and name the key, never the value.

UserInfo setting: **`IDENTITY_USERINFO_ENDPOINT`**. Obtain it from the
existing Cognito hosted domain; do not commit its value. It must be a fixed
HTTPS endpoint at the Cognito UserInfo path, without credentials, query, or
fragment. Invalid configured endpoints fail startup with a static error.
Absent configuration leaves the rest of the API working; a new-account
onboarding attempt immediately returns `503 identity_unavailable` without
writing. The client has a five-second deadline, a 16 KiB response cap, and
rejects redirects; provider bodies/tokens never enter errors or logs. The
GetUser adapter has the same limits.

User checks on the existing pool/app client (not a new client or pool):

1. Enable self sign-up, email as sign-in identifier, required email verification.
2. Add `http://localhost:3000/candidato/login` to allowed sign-out URLs.
3. Keep callback `http://localhost:3000/api/auth/callback/cognito` and scopes
   `openid email profile` (also required by the recruiter flow).

A mistaken candidate onboarding has no product undo in this cut; admin/support
reversal remains an open user decision.

## Test-to-contract map

| Test | §11 rule |
| --- | --- |
| `TestCandidateIdentityMe` | §11.2 DB-only roles; §11.3 exact nullable response/no-store/no writes |
| `TestCandidateIdentityOnboarding` | §11.2 name code points/trusted email; §11.3 exact 201/200, unchanged retries, 400/409/422/503 and no writes for rejection/retry |
| `TestCandidateIdentityUnavailableConfiguration` / `TestIdentityUserInfoEndpoint` | §11.4 missing endpoint fails closed only for onboarding; configured endpoint validation |
| `TestClientHardenedTransport` | §11.1 reuse of bounded transport; §11.3 provider failures/redirects/deadlines/body cap |
| `TestRequireCandidateRole` / `TestCandidateIdentityLegacyRoutesRoleGates` | §11.2/S21 all legacy methods; groups never grant a role; 403 codes |
| `TestCandidateIdentityRoutesRequireAuthentication` | §11.3 auth/no-store before handlers |
| `TestIdentityErrorCatalog` | §11.3 additive codes, statuses, exact envelope |
| `TestCandidateIdentityFlowOutcomes` (integration) | §11.3 actual users/audit atomicity, audit failure rollback, exact body and read-only retry; 400/422/503 zero rows |
| `TestCandidateIdentityFlowEmailAndRoleConflicts` (integration) | §11.2 no email linking/role change; §11.3 409s with unchanged users/no audit; recruiter/null GET |
| `TestCandidateIdentityFlowConcurrentOnboarding` (integration) | §11.3 one user/audit, concurrent loser read-only 200s, identical response |
| `TestCandidateIdentityFlowLegacyAndCompanyGates` (integration) | §11.2 legacy candidate behavior, live-row/tombstone gate; §11.3 company 401/403 unchanged |
| `TestAccountOnboardingOrderOfChecks` | embedded-auth D1–D2 order of checks for both roles, concurrent winner of either role |
| `TestEmployerIdentityOnboarding` / `TestEmployerIdentityUnavailableAndUnauthenticated` | D1 strict body, 200/201/400/409/413/422/500/503, no writes on rejection/retry |
| `TestEmployerIdentityFlow*` / `TestEmployerAccountStoreSameSubjectRaceRecheck` (integration) | D2–D4 atomic `EmployerAccountCreated`, rollback, conflicts both ways, concurrent same-subject and cross-role races, email race re-check, then `POST /companies` succeeds |
| `TestIdentityProviderSelection` / `TestRun_RefusesInvalidIdentityProviderConfig` | D8/D14 selection, refusals, loopback override, production region rule; startup fails before infrastructure |
| `TestGetUser*` (`cognitogetuser`) | D6–D11 exact request, strict parse, failure classes, redirects, deadline, cap, value-free logs |
| `TestIdentityGetUserFlowBothOnboardings` (integration) | D6–D12 both onboardings through config-built GetUser adapter and the §e2e loopback stub |

Integration tests require `DRAFT_TEST_DATABASE_URL`, guarded to loopback and the
isolated `draft_test` database. They never create databases or use ambient
`DATABASE_URL`; the parent runs them on its isolated DB. Without the dedicated
setting they explicitly skip. Existing local-bootstrap and PostConfirmation
tests are unchanged and run in the normal suite.
