# `draftstore` — PostgreSQL adapter for the private draft port

Implements `drafts.Store`. It owns the `*pgxpool.Pool` and one transaction per
operation so authorization, the draft write, its audit event and (create only)
the idempotency record commit together or roll back together.

## Constructor

```go
func NewStore(pool *pgxpool.Pool, audit auditrepositories.AuditEventRepository) *Store
```

`audit` is the stateless, tx-scoped audit port (`Append(ctx, tx, event)`). The
adapter passes its own `pgx.Tx`, so the audit insert participates in the same
transaction.

```go
var _ drafts.Store = (*Store)(nil)
```

## Schema (migration `00012_create_private_job_drafts.sql`)

- `job_drafts` — one row per draft. `company_id`, `created_by` and
  `principal_recruiter_id` are immutable: the adapter's only `UPDATE` touches
  `fields`, `version` and `updated_at`. `fields BYTEA` stores the canonical
  writable envelope `{"schema_version":1,"fields":{...}}` so exact strings and
  mark order survive; `version BIGINT` is positive and CAS/ETag authoritative.
- `job_draft_idempotency` — one row per `(company, actor, operation, key)` with
  the normalized fingerprint and the frozen original `response_body` /
  `response_etag`. No TTL.
- `job_draft_requesters` — minimal immutable catalog, unique on
  `(company_id, kind, name_key)`. Referenced `(id, kind, company)` is validated
  transactionally; the client's name is never accepted.

## Transaction and locking rules

1. Fixed lock order `users → companies → company_members`, each `FOR SHARE`,
   held through commit, so a concurrent revoke/update/delete of the same
   principal or company blocks instead of racing. A request-context role is
   never trusted.
2. `Create` canonicalizes the `Idempotency-Key` to the parsed UUID string once,
   then takes a transaction-scoped advisory lock (`hashtextextended` of a
   bounded `company:actor:operation:canonicalUUID` string) before reading the
   idempotency row; the UNIQUE constraint stays the database authority. Raw
   client spellings (unhyphenated, uppercase, urn/braced) share one identity, so
   they cannot create duplicate drafts. A replay re-checks owner/principal on
   the addressed draft — its id derived from the stored ETag, never from client
   input — after the general gates and before any conflict or replay return.
3. `Save` takes the draft row `FOR UPDATE`, checks authorization, then parses
   and compares `If-Match` with `draftversion`, then decodes the patch and
   merges it over the canonical bytes. A byte-identical merge is a no-op (same
   version/ETag/timestamps, no audit). A real change increments the version
   (overflow fails safely) and appends the save audit event.
4. Response envelopes are always re-derived from the stored canonical bytes, the
   approved rich validator (`description_plain`) and the immutable requester
   catalog name.

## Isolated integration tests

Run only against the dedicated ephemeral database (never an ambient
`DATABASE_URL`): set `DRAFT_TEST_DATABASE_URL` to the loopback `draft_test`
instance. The suite refuses any non-loopback host or non-`draft_test` database
and applies the embedded migrations itself. Deterministic coverage includes
canonical-key UUID spellings, replay re-authorization, same-tag concurrent save
CAS, in-flight membership revoke blocking (channel-coordinated with a
`lock_timeout` bound), and forced real PostgreSQL audit-INSERT failures through
an isolated test-only rule table and trigger (no production hidden features).

```sh
DRAFT_TEST_DATABASE_URL='postgres://draft_test:…@localhost:32768/draft_test?sslmode=disable' \
  go test -tags=integration ./internal/features/jobs/infrastructure/postgres/draftstore -count=1
```
