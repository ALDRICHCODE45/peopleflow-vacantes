# Explicit v2 employer draft reads

`Store.GetV2` implements the narrow `drafts.V2Reader` capability. This is not a
partial v2 `drafts.Store`: there are no placeholder Create/Save methods, and the
existing Store interface and v1 methods are unchanged. The production GET
`/v2/me/company/job-drafts/{id}` consumes this capability through
`DraftV2Handler`; writes and replay use separate v2 capabilities.

The method fixes the expected schema to 2; no client parameter, configuration
switch or stored-row dispatch selects the expected version. Live user/company/
membership gates and tenant-scoped owner-or-principal authorization run before
schema inspection. A known v1 document returns `drafts.ErrNotFound`; unknown or
corrupt schema markers and invalid persisted v2 values are server invariant
errors, not client validation failures. Errors always return a zero Result.

Only complete documents accepted by `draftinput.ValidatePersistedDraftV2` are
rendered. Reads do not repair or rewrite stored values. The employer envelope
contains root schema_version 2, id, status, principal_recruiter_id, positive
string version, UTC microsecond timestamps and all 17 fields, plus derived
`description_plain` and `requester.name`. A null requester stays null. Evaluated
screening retains `correct_option_id`; this must never be used as a candidate
response. The ETag uses `jd-r2`; Replayed is false. The stored canonical document
remains distinct from this metadata-bearing read envelope.

## Verification

Run from `backend` with `DRAFT_TEST_DATABASE_URL` explicitly targeting a dedicated
loopback database named `draft_test` (the harness applies embedded migrations):

```sh
go test -tags integration ./internal/features/jobs/infrastructure/postgres/draftstore -run '^TestGetV2_' -count=1
go test -tags integration ./internal/features/jobs/infrastructure/postgres/draftstore -count=1
go test ./...
```

An unset DSN skips integration tests and does not establish correctness. Read-focused tests
seed v2 bytes directly, then call public read methods. Before/after database snapshots prove reads and rejected calls do
not change drafts, audit rows or idempotency records. Existing v1 methods, schema
gates, routing, canonical encoding and replay behavior are not widened.
