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

## Schema (migrations `00012_create_private_job_drafts.sql`, `00013_version_draft_idempotency_fingerprint.sql`)

- `job_drafts` — one row per draft. `company_id`, `created_by` and
  `principal_recruiter_id` are immutable: the adapter's only `UPDATE` touches
  `fields`, `version` and `updated_at`. `fields BYTEA` stores the canonical
  writable envelope `{"schema_version":1,"fields":{...}}` so exact strings and
  mark order survive; `version BIGINT` is positive and CAS/ETag authoritative.
- `job_draft_idempotency` — one row per `(company, actor, operation, key)` with
  the normalized fingerprint and the frozen original `response_body` /
  `response_etag`. No TTL. `fingerprint_algorithm` is the persisted
  representation of the `fingerprint` column:
  - `go-json-v1+canonical-bytes` — the pre-00013 representation: `fingerprint`
    holds the raw canonical go-json-v1 writable bytes. It is the column
    `DEFAULT`, so a row inserted before 00013, or by a pre-00013 binary that
    does not name the column, is tagged legacy without reinterpreting bytes.
  - `go-json-v1+sha256` — `fingerprint` holds the 32-byte SHA-256 digest of the
    canonical writable bytes. A DB CHECK enforces the 32-byte width for this
    tag only.
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
   The replay/conflict decision is dispatched by the persisted
   `fingerprint_algorithm`: the legacy tag compares the stored canonical bytes,
   the sha256 tag compares the 32-byte digest in constant time, and an unknown
   tag or malformed digest fails closed as an internal error with no write.
3. `Save` takes the draft row `FOR UPDATE`, checks authorization, then parses
   and compares `If-Match` with `draftversion`, then decodes the patch and
   merges it over the canonical bytes. A byte-identical merge is a no-op (same
   version/ETag/timestamps, no audit). A real change increments the version
   (overflow fails safely) and appends the save audit event.
4. Response envelopes are always re-derived from the stored canonical bytes, the
   approved rich validator (`description_plain`) and the immutable requester
   catalog name.

## Fingerprint algorithm rollout

- A new insert stores the SHA-256 digest and the explicit `go-json-v1+sha256`
  tag. The draft row still stores the canonical writable bytes, so the read
  path and the stored `fields` shape are unchanged.
- A pre-00013 row (or a row inserted by a pre-00013 binary that omits the
  column) is tagged `go-json-v1+canonical-bytes` and replays/conflicts on its
  original bytes. Existing keys, response bodies, ETags, audit events and
  counters are untouched.
- Do **not** run an old binary (one that selects only the pre-00013 column set)
  against a table that already holds digest rows: it would read the 32-byte
  digest as canonical bytes and turn every replay into a conflict. Deploy the
  new binary before any new digest row is written, and do not treat a mixed
  rollback as safe.
- Migration 00013 down **refuses transactionally** while any non-legacy row
  exists, so digest rows are never silently left unreadable. A legacy-only
  table (no new writes yet) reverts cleanly.

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
