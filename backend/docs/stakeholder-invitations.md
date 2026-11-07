# Stakeholder invitations

A company owner invites a read-only **stakeholder** with a copyable single-use
link; no email is involved. Contract:
[`stakeholder-metrics-v1.md`](../../docs/contracts/stakeholder-metrics-v1.md) §1.3.
Roles and the gate: [company-members.md](company-members.md).

## Routes

| Route | Guard | Success |
| --- | --- | --- |
| `POST /v2/me/company/stakeholder-invitations` | Owner; live company | 201 `{id, url_token, expires_at, created_at}` |
| `GET /v2/me/company/stakeholder-invitations` | Owner; live company | 200 `{items: [{id, created_at, created_by, expires_at}]}` |
| `DELETE /v2/me/company/stakeholder-invitations/{id}` | Owner; live company | 204 |
| `POST /v2/me/stakeholder-invitations/accept` body `{"token"}` | Any signed-in user | 200 `{company_id, member_id, role: "stakeholder"}` |

Every response is `Cache-Control: no-store`. Times are RFC 3339 UTC with
microseconds; `created_by` is the creator's user id.

- **Token.** 32 random bytes, base64url without padding, returned **once** by
  the create. The table `stakeholder_invitations` (migration `00057`) stores
  only its SHA-256. The frontend builds `/empresa/invitacion/<url_token>`.
- **Expiry and limit.** 7 days. At most 20 pending (not revoked, not used, not
  expired) per company: the 21st create returns 422 `invitation_limit_reached`.
  The create locks the company row, so two creates cannot both pass the limit.
- **List.** Pending invitations only, newest first, never a token.
- **Revoke.** 204 for a pending invitation (audited) and also, writing nothing,
  for an already used, expired, revoked, unknown or other-company invitation.
  A malformed id is 400 `invalid_request`.

## Accept

One transaction with `FOR UPDATE` on the invitation row; two accepts of one
token yield one member.

| Case | Answer |
| --- | --- |
| Pending token, employer account without membership | 200; stakeholder membership created, invitation marked used |
| Same user again while that membership exists (replay) | 200 with the same body; nothing written, no audit row |
| Unknown, malformed, expired or revoked token; used by another user; membership removed since | 404 `invitation_invalid` (one code, no oracle) |
| Candidate account (checked before the token) | 403 `candidate_account` |
| Caller already belongs to a company (any company, any role) | 409 `already_company_member` |
| Missing/empty/non-string token, invalid JSON | 400 `invalid_request` |
| No or invalid bearer token | 401 `unauthenticated` |

A soft-deleted company's invitation is `invitation_invalid` too.

## Audit

`StakeholderInvitationCreated {invitation_id, expires_at}` and
`StakeholderInvitationRevoked {invitation_id}` (actor: owner);
`StakeholderInvitationAccepted {invitation_id, member_user_id}` plus
`CompanyMemberAdded {member_user_id, role: "stakeholder"}` (actor: the new
stakeholder). Each commits with its write. See [audit-capture.md](audit-capture.md).

## Code map

- `companies/application/usecases/stakeholderInvitationService.go`: token, hash,
  clock, TTL, limit, candidate check.
- `companies/infrastructure/postgres/stakeholderInvitationRepository.go` and
  `db/queries/stakeholder_invitations.sql`: transactions, locks, audit.
- `companies/infrastructure/http/stakeholderInvitationHandler.go`; routes in
  `cmd/api/router.go`.

## Tests

Run from `backend/` with `DRAFT_TEST_DATABASE_URL` set to the isolated loopback
`draft_test` database (the harness applies migrations and cleans its fixtures):

```sh
make test-integration PKG=./cmd/api RUN='^TestStakeholderInvitations_'
make test PKG='./internal/shared/httpjson/ ./internal/features/audit_events/domain/entities/'
```

`cmd/api/stakeholder_invitations_integration_test.go` covers create and list,
the pending limit, idempotent revoke, owner-only access, accept and replay,
every rejection (with invitations, members and audit unchanged) and the
concurrent accept.
