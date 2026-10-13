# Schema-2 draft creation capability

`drafts.V2Writer.CreateV2` is a separate employer-only creation capability. The production
POST `/v2/me/company/job-drafts` consumes it through `DraftV2Handler`;
this capability does not implement v2 saves. The default
`drafts.Store` and its v1 codecs, operations and responses remain unchanged.

## Transaction and version boundary

- Validate/canonicalize the UUID idempotency key, then acquire the existing
  company/membership gates before decoding with `DecodeCreateV2`.
- Store the codec's complete normalized 17-field schema-2 bytes unchanged,
  including private evaluated answer keys. Description remains schema 1.
- Validate requester references transactionally, render the v2 employer envelope
  and use the quoted `jd-r2` ETag. This is not a candidate projection.
- Co-write the draft, SHA-256-tagged idempotency response and create audit event
  in one transaction. Failures return a zero result and roll back every write.

## Idempotency and replay

The operation is `create:v2`, separate from v1 `create` in the existing table
and advisory-lock namespace. The same UUID can independently create one draft
per version. Equivalent normalized payloads replay the original response bytes
and ETag without auditing again; a changed fingerprint conflicts.

Replay re-authorizes the addressed current row before fingerprint comparison.
Known schema 1 is hidden; corrupt/unknown schema or invalid persisted v2 content
is an internal invariant failure. An unknown persisted fingerprint algorithm
fails closed. Cached response bytes are never re-rendered or migrated.

## Verification

Only use a dedicated loopback database named `draft_test`; the integration
harness applies the existing embedded migrations. Never use `DATABASE_URL`.

```sh
DRAFT_TEST_DATABASE_URL='postgres://draft_test:…@127.0.0.1:PORT/draft_test?sslmode=disable' \
  go test -tags=integration ./internal/features/jobs/infrastructure/postgres/draftstore -run '^TestCreateV2' -count=1
DRAFT_TEST_DATABASE_URL='postgres://draft_test:…@127.0.0.1:PORT/draft_test?sslmode=disable' \
  go test -tags=integration ./internal/features/jobs/infrastructure/postgres/draftstore -count=1
go test ./internal/features/jobs/... -count=1
go vet ./internal/features/jobs/application/drafts ./internal/features/jobs/infrastructure/postgres/draftstore
```

Run from `backend`. Tests cover canonical persistence, private-field readback,
v1 isolation, normalized frozen replay, namespace separation, conflict and
algorithm rejection, input taxonomy, authorization/schema gates and audit
rollback. Fixture preparation and side-effect inspection use SQL because the
public API has no audit/idempotency counters; behavior uses public capabilities.
