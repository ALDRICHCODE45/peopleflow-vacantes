# Employer draft HTTP v2 adapter

`NewDraftV2Handler(writer, reader, saver)` receives explicit `drafts.V2Writer`,
`drafts.V2Reader` and `drafts.V2Saver` capabilities. `DraftHandlers()` exposes
create/get/save handler functions without registering any production route.
The existing v1 handler remains unchanged; the composition root passes the
same draft store through all three explicit v2 capabilities.

## Transport contract

The adapter reuses the existing v1 transport helpers unchanged:

- Company context is mandatory and missing context fails closed with 500.
- POST requires exactly one nonempty `Idempotency-Key`; its raw value is
  forwarded to the store, which validates UUID spelling/identity.
- Addressed GET/PATCH parse the path UUID. PATCH forwards the raw `If-Match`
  value and presence; repeated lines become a comma-separated list.
- POST/PATCH read under `draftinput.MaxBodyBytes`. Oversized/read-failed bodies
  are rejected before calling the store. In-budget bytes are forwarded without
  decoding, trimming, schema dispatch or precondition parsing.
- Successful POST is 201, including frozen replay, with exact store bytes/ETag
  and `Idempotency-Replayed: true|false`. GET/PATCH are 200 with exact bytes/ETag
  and no replay header. Employer private answer keys are not projected away.
- Store errors use the existing closed catalog; responses have no editor data
  or raw error details. Unexpected errors and version overflow map to 500.

Authorization/schema/precondition precedence is owned by the v2 capabilities
once called. Transport errors (including failed/oversized body reads) can reject
before that boundary, exactly as in v1; these adapter tests do not prove an
end-to-end resource-first policy for such failures.

## Production router

`newRouter` registers POST `/v2/me/company/job-drafts` and GET/PATCH
`/v2/me/company/job-drafts/{id}` in a root-level group with `NoStore` before
authentication and recruiter middleware. Resource authorization remains in
the store. The exact route-topology guard includes all three registrations.
`draft_flow_v2_integration_test.go` uses the real production router with JWT,
membership gates and an isolated PostgreSQL store, including v1 regression.
The separately tested candidate privacy allowlist remains unwired; this
employer adapter is not a candidate API and does not publish vacancies.

## Verification

From `backend`, no database is required:

```sh
go test ./internal/features/jobs/infrastructure/http -run '^TestDraftV2Handler' -count=1
go test ./internal/features/jobs/infrastructure/http -count=1
go test ./internal/features/jobs/... -count=1
go vet ./internal/features/jobs/infrastructure/http
```

Recording fakes expose only v2 capabilities. Tests assert exact response bytes,
identity/context/header/body forwarding, transport rejection with no capability
call, catalog errors with one call, replay-header rules, body budget/read errors
and test-only no-store middleware on successes and failures. The unchanged
package suite also runs existing v1 tests; no authorization/persistence proof is
claimed from fake-store tests.
