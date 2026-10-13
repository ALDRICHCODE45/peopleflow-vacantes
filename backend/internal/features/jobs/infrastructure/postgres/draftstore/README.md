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

## GET schema isolation (U1a)

The existing v1 `GET` checks the stored `schema_version` after general and
owner/principal authorization, before requester lookup or read rendering:

- Schema `1` retains its exact response and ETag behavior.
- Known schema `2` returns `404 not_found`, with no ETag or editor data.
- Missing, malformed or unknown schema markers return `500 internal_error`.
- Unauthorized resources still return `404` without inspecting their schema.

These reads never change draft bytes, CAS/timestamps, audit or idempotency rows.
The schema marker is independent of the row's CAS `version`. This is only GET
isolation: PATCH and replay isolation remain a separate unit. No v2 route or
codec is enabled, and v2 storage must not be enabled before those gates exist.

Public HTTP regression (real JWT, production router and isolated PostgreSQL):

```sh
DRAFT_TEST_DATABASE_URL='postgres://draft_test:…@localhost:32768/draft_test?sslmode=disable' \
  go test -tags=integration ./cmd/api -run '^TestDraftFlow_GetSchemaIsolation$' -count=1
```

## PATCH schema isolation (U1b1)

The existing v1 `Save` checks the stored `schema_version` after general and
owner/principal authorization, and before `If-Match` is parsed or the patch body
is decoded:

- Schema `1` retains its exact save/no-op/CAS/body behavior.
- Known schema `2` returns `404 not_found` — even when `If-Match` is missing,
  malformed or stale, or the patch body is malformed — with no ETag or editor
  data.
- Missing, malformed or unknown schema markers return `500 internal_error`.
- Unauthorized resources still return `404` without inspecting their schema.

A rejected save never changes draft bytes, CAS/timestamps, audit or idempotency
rows. The schema marker is independent of the row's CAS `version`. This is only
PATCH isolation: idempotency replay isolation remains a separate unit. No v2
route or codec is enabled, and v2 storage must not be enabled before those gates
exist.

Public HTTP regression (real JWT, production router and isolated PostgreSQL):

```sh
DRAFT_TEST_DATABASE_URL='postgres://draft_test:…@localhost:32768/draft_test?sslmode=disable' \
  go test -tags=integration ./cmd/api -run '^TestDraftFlow_PatchSchemaIsolation$' -count=1
```

## Replay schema isolation (U1b2)

`Create` gates the addressed draft's stored `schema_version` on every
idempotency replay. The gate runs after the general locks, after the
owner/principal re-authorization of the addressed draft (its id derived from
the stored ETag, never from client input), and before the persisted fingerprint
is evaluated, so it cannot leak or replay a row whose current representation the
server cannot read:

- Schema `1` keeps its exact frozen replay: the stored `response_body` and
  `response_etag` are returned byte-for-byte, even when the row's independent
  CAS version has advanced past the replayed ETag.
- Known schema `2` returns `404 not_found`, with no ETag or editor data.
- Missing, malformed or unknown markers return `500 internal_error`.
- Unauthorized resources still return `404` without inspecting their schema, so
  the current-row gate cannot turn an authorization decision into a `500`.

A known foreign schema is therefore hidden and a corrupt/unknown marker fails
closed **before** the fingerprint comparison could return `409`; the
`idempotency_conflict` behavior for a genuinely changed v1 payload is unchanged.
A rejected replay never changes draft bytes, CAS/timestamps, audit or
idempotency rows. The replay path decodes the addressed row's stored bytes only
to read its schema marker and never rewrites or migrates them, while the
idempotency record's frozen cached `response_body` bytes are returned verbatim
and never parsed or re-rendered. This adds no new corruption policy of its own:
it reuses the same schema-marker predicate the GET and PATCH paths already
apply. No v2 route or codec is enabled.

Public HTTP regression (real JWT, production router and isolated PostgreSQL):

```sh
DRAFT_TEST_DATABASE_URL='postgres://draft_test:…@localhost:32768/draft_test?sslmode=disable' \
  go test -tags=integration ./cmd/api -run '^TestDraftFlow_Replay' -count=1
```

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
