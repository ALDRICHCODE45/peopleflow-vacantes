# Company member guards

All routes require authentication. Company-scoped routes use the company ID
resolved by `RequireCompanyRole`, never a company ID from the request body.

| Route | Guard | Success |
| --- | --- | --- |
| `GET /me/company` | Authenticated user; no role gate; missing membership → 404 | 200 |
| `GET /me/company/members` | Recruiter or owner; live company | 200 |
| `POST /me/company/members` | Owner; live company; target must be a recruiter account; one membership per user | 201 |
| `PATCH /me/company/members/{id}` | Owner; live company; valid role; same-company target; retain an owner | 200 |
| `DELETE /me/company/members/{id}` | Owner; live company; same-company target; retain an owner | 204 |

Missing/invalid authentication returns 401; insufficient role, no membership, or
an unavailable company returns 403 on gated routes. Invalid UUIDs/roles return
400. Unknown and foreign member IDs both return 404, without revealing whether
the foreign row exists. Duplicate membership creation returns 409.

## Final owner

Demoting an owner to a non-owner role or deleting an owner is rejected if it
would leave the company with zero owners. This includes acting on one's own
membership. The rejection leaves membership, role, and timestamps unchanged:

```json
{"error":"company must retain at least one owner","code":"last_owner"}
```

Status: **409 Conflict**. Domain sentinel: `entities.ErrLastOwner`. The shared
`httpjson` catalog owns the code, message, and status. A foreign/unknown target
still returns **404 before this rule is evaluated**. Promotions, keeping the
owner role, non-owner targets, and removing/demoting an owner when another
owner remains retain their existing behavior.

A distinct actor cannot normally target the *only* owner as an owner: that
actor would also have to be an owner. Non-owner actors fail the role gate with
403. The persistence guard is actor-independent and also covers already
authorized, in-flight requests whose caller's role changes concurrently.

## Atomicity

The PostgreSQL adapter owns a READ COMMITTED transaction for every role change
and removal. It locks the stable `companies` parent row with `SELECT ... FOR
UPDATE`, then reads the company-scoped target, counts current owners when the
action would remove ownership, and updates/deletes before committing. All
removals and role changes use the same lock, including promotions. Pool-backed
writes explicitly select READ COMMITTED; rollback fixtures use nested pgx
savepoints inside their outer READ COMMITTED transaction.

The target lookup and count are **separate statements after the lock**. A
waiting writer therefore sees the preceding commit rather than a stale
statement snapshot. A single lock-and-count CTE would not provide this
READ COMMITTED guarantee. Two already-authorized owners cannot both remove
ownership: one succeeds; the other sees the remaining final owner and gets
`ErrLastOwner`. Errors roll back the whole mutation. This protects these
member routes, not arbitrary direct SQL or company deletion.

## Test map

- `internal/features/companies/infrastructure/postgres/companyMemberRepository_test.go`:
  final-owner rejection and unchanged stored state; allowed promotions,
  non-owner mutations and multiple-owner actions; foreign/unknown 404
  precedence; explicit isolation; begin/lock/count/write/commit failures.
- `internal/features/companies/infrastructure/http/memberHandler_lastOwner_test.go`:
  wrapped/domain errors surface as the catalog's 409 envelope for both methods.
- `internal/shared/httpjson/company_member_errors_test.go`: canonical code,
  status, message, two-field envelope, and independent additive catalog list.
- `cmd/api/company_members_integration_test.go` (`integration`): real production
  router, authentication, authorization and SQL; 16 HTTP scenarios with complete
  membership snapshots on rejection. Three real concurrency scenarios cover
  demote/demote, remove/remove, and mixed operations. A barrier starts both
  workers; a held company lock is released only after PostgreSQL reports both
  workers waiting. Exactly one succeeds, one gets `ErrLastOwner`, and one owner
  remains. Persistence is called directly in the concurrency cases so a late
  authorization recheck cannot mask the result with a 403.
- Existing `companyMemberRepository_integration_test.go`: same-company and
  foreign-target SQL behavior; its allowed owner mutations retain another owner.

Run from `backend/`, with **`DRAFT_TEST_DATABASE_URL` explicitly set** to an
isolated loopback database named **`draft_test`** (existing harness applies
migrations and cleans its own fixtures):

```sh
go test -tags=integration ./cmd/api -run '^TestCompanyMembersLastOwner(HTTP|Concurrent)$' -count=1 -v
```

The new tests never read `.env` or ambient `DATABASE_URL`. They skip when the
explicit variable is absent; a skip does not prove database behavior. Older
companies adapter integration tests separately use `DATABASE_URL`.
