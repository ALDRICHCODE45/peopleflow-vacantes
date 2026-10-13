# Schema-2 draft save capability

`drafts.V2Saver.SaveV2` is a separate employer-only save capability. The production
PATCH `/v2/me/company/job-drafts/{id}` consumes it through `DraftV2Handler`;
this capability does not implement v2 creates or reads. The
default `drafts.Store.Save`, its v1 codecs and `CreateV2`/`GetV2` remain
unchanged; SaveV2 never touches create idempotency records, so a frozen create
replay stays byte-original after a valid save.

## Store order

General gates, then the scoped row `FOR UPDATE`, then owner-or-principal
authorization, then full persisted v2 validation, then
`ParseIfMatchV2`/`mapPreconditionError`/`Compare`, then
`DecodePatchV2`/`mapInputError`. Resource and schema errors always precede
precondition and body errors. Known schema-1 rows are hidden (`ErrNotFound`);
corrupt, unknown or noncanonical persisted v2 documents are server invariant
failures, never mapped to client validation, and they precede a missing or
malformed precondition and a malformed body, while an unauthorized caller
keeps the hidden 404. Every error returns a zero Result.

## Schema-2 merge

The merge is separate from v1: supplied groups fully replace the stored
groups, absent fields, array order and the root `schema_version: 2` marker are
preserved, and there is no nested merge. It reuses `envelopeFieldsOf` and
`draftjson.EncodeValidatedValue`, then revalidates the merged full 17-field
document with `ValidatePersistedDraftV2`. Private evaluated answer keys are
preserved; description remains schema 1. An omitted `screening_questions` key
preserves the stored questions while an explicit empty array clears them.

A normalized equivalent delta is an exact byte no-op: the current envelope and
ETag return unchanged with the same version, timestamps, audit count and
idempotency records. An empty patch stays `ErrEmptyPatch`.

## Real changes

A real change increments the version once under CAS (`version = $stored`),
rejects `MaxInt64` overflow, validates requester references transactionally
(missing, cross-company or wrong-kind references are `ErrValidation`), renders
the employer v2 envelope with the quoted `jd-r2` ETag, co-writes
`EventJobDraftSaved` and commits atomically. An audit failure rolls back the
fields, version, timestamps and audit write. A deterministic concurrent
same-tag race yields exactly one winner and one `ErrVersionConflict` with a
zero result; the winner's response equals the current `GetV2` projection, the
final stored document is the canonical schema-2 full-17 document, and exactly
one audit event with unchanged idempotency rows remain.

## Verification

Only use a dedicated loopback database named `draft_test`; the integration
harness applies the existing embedded migrations. Never use `DATABASE_URL`.

```sh
DRAFT_TEST_DATABASE_URL='postgres://draft_test:…@127.0.0.1:PORT/draft_test?sslmode=disable' \
  go test -tags=integration ./internal/features/jobs/infrastructure/postgres/draftstore -run '^TestSaveV2' -count=1
DRAFT_TEST_DATABASE_URL='postgres://draft_test:…@127.0.0.1:PORT/draft_test?sslmode=disable' \
  go test -tags=integration ./internal/features/jobs/infrastructure/postgres/draftstore -count=1
go test ./internal/features/jobs/... -count=1
go vet ./internal/features/jobs/application/drafts ./internal/features/jobs/infrastructure/postgres/draftstore
```

Run from `backend`. Test never touches create idempotency records, so a frozen create replay stays
byte-original after a valid save. Tests cover canonical full-17 persistence with private
question keys, group replacement with every other envelope key preserved and
an exact stored full-17 merged document, screening omitted versus empty, the
byte-exact normalized no-op including the full
storage snapshot, authorization/schema precedence, invariant precedence over
precondition/body with the unauthorized 404, missing/malformed/r1/
wrong-id/stale tags, structural/value/empty/body-budget input taxonomy,
overflow, requester rejection with unchanged state, audit rollback, the frozen
create replay after a successful save and the
deterministic same-tag concurrency race. Every rejection asserts a zero result
and an unchanged snapshot; fixture preparation and counter inspection use SQL
because the public API has no audit/idempotency counters. The unchanged full
draftstore integration suite provides the v1 regression.
