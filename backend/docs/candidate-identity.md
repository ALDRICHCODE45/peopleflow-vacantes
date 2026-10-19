# Candidate identity — P2b0

Contract: design §11, T39 (S20/S21). Same Cognito pool and app client for both
roles. Only a live `users.user_type` grants a role; token groups/client id do
not. No migration, role changes, email linking, or onboarding reversal.

## API

Both endpoints require the caller's Bearer access token (`RequireAuth`) and
return `Cache-Control: no-store`, including errors. Invalid/missing tokens:
`401 unauthenticated`. Errors contain exactly `{error, code}`.

`GET /v2/me` returns `200` with exactly:

```json
{"role":"candidate","user":{"id":"…","email":"ana@example.com","full_name":"Ana Pérez"}}
```

Role is `candidate`, `recruiter`, or `null`. No live row for the authenticated
subject (including a soft-deleted row) returns exactly
`{"role":null,"user":null}`. No identity-provider request or write occurs.

`POST /v2/me/candidate-account` accepts exactly `{"full_name":"Ana Pérez"}`.
Names use the existing normalization (trim surrounding whitespace, preserve
internal whitespace and case), then require 2–120 Unicode code points. The
browser cannot supply an email or role. Unknown/duplicate keys (also escaped
aliases), malformed JSON/types, non-object bodies and trailing values are
`400 invalid_request`; missing/null/invalid-length names are
`400 validation_error`. The inherited JSON transport cap is 1 MiB (`413
payload_too_large`).

For a new subject, the API fetches UserInfo server-side using that request's
access token. Subject must match, and email verification must be true (Cognito's
boolean or exact string representation). A subject mismatch or explicit false
verification returns `422 email_not_verified`; unreachable/non-200, malformed,
missing/invalid-type claims, or invalid email return `503 identity_unavailable`.
The form supplies the name; UserInfo need not contain `name`.

| Result | Meaning |
| --- | --- |
| `201` | New candidate; body exactly the GET body |
| `200` | Same-subject live candidate retry; original name/email/id retained, no provider call or write |
| `409 account_exists` | Same-subject recruiter; never changes role |
| `409 email_in_use` | Verified email belongs to another live subject; never links by email |
| `422 email_not_verified` | Subject mismatch or unverified email |
| `503 identity_unavailable` | UserInfo missing configuration, unreachable, or malformed |

Input is validated before account lookup. An existing candidate/recruiter is
resolved without UserInfo. Creation uses the existing partial unique subject
and email constraints. The insert and `CandidateAccountCreated` audit event
commit in one transaction. Event: actor type `user`, actor/entity id = new user
id, entity type `user`, metadata exactly `{}` (no PII/token). Audit failure
rolls back the insert. Concurrent same-subject requests create one account and
one audit; other requests return the unchanged winner without another audit.
Conflicts and all other rejections create neither user nor audit.

## Legacy candidate routes (requested authorization change)

Every route below now runs `RequireAuth` then `RequireCandidateRole` against a
live user, with no-store even on authentication/authorization rejection:

- `GET`, `PUT /me/profile/`
- `GET`, `PUT /me/profile/languages/`
- `GET /me/applications`
- `POST /jobs/{jobId}/applications`

No live account: `403 account_required` (formerly downstream 401).
Recruiter: `403 wrong_role` (formerly admitted). Valid candidates retain their
existing handler/body behavior. Applications share one mount with per-method
gates so recruiter middleware cannot intercept the candidate POST.
Recruiter application reads/transitions and company membership gates are
unchanged: unknown subject stays `401 unauthenticated`, non-member candidates
stay `403 forbidden` on role-gated company routes.

## Additive catalog codes

`account_required` 403, `wrong_role` 403, `account_exists` 409,
`email_in_use` 409, `email_not_verified` 422, `identity_unavailable` 503.
Existing codes/envelopes remain unchanged.

## Configuration and console checks (§11.4)

API environment setting: **`IDENTITY_USERINFO_ENDPOINT`**. Obtain it from the
existing Cognito hosted domain; do not commit its value. It must be a fixed
HTTPS endpoint at the Cognito UserInfo path, without credentials, query, or
fragment. Invalid configured endpoints fail startup with a static error.
Absent configuration leaves the rest of the API working; a new-account
onboarding attempt immediately returns `503 identity_unavailable` without
writing. The client has a five-second deadline, a 16 KiB response cap, and
rejects redirects; provider bodies/tokens never enter errors or logs.

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

Integration tests require `DRAFT_TEST_DATABASE_URL`, guarded to loopback and the
isolated `draft_test` database. They never create databases or use ambient
`DATABASE_URL`; the parent runs them on its isolated DB. Without the dedicated
setting they explicitly skip. Existing local-bootstrap and PostConfirmation
tests are unchanged and run in the normal suite.
