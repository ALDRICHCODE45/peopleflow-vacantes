# Vacancy management (P1)

Internal request information for a v2 draft or published vacancy. Contract:
`docs/pipeline-customization-design.md` §9.2 and §9.4. These values are never
public and hiring headcount is independent of the delivery target.

## Routes and identity

`GET` / `PUT /v2/me/company/job-drafts/{id}/management`.

Session identity only. The live user, active company and membership are
rechecked transactionally. Owner or draft principal may read/write; missing,
foreign and non-principal drafts return `404 not_found`. Authorization precedes
preconditions. Every response, including middleware failures, has
`Cache-Control: no-store`.

## Read and replacement

`GET` → `200` with a strong opaque management `ETag`:

```json
{"version":"1","requestDate":"2026-10-10","hiringHeadcount":2,"limits":{"maxHiringHeadcount":999},"today":"2026-10-16"}
```

These five keys and the single limit key are exact. Both values are always
present, nullable. `today` is the date in `America/Mexico_City` from the server
clock; it is not the browser's date.

`PUT` requires `If-Match` from this resource and exactly:

```json
{"requestDate":"2026-10-10","hiringHeadcount":2}
```

Both keys are required and nullable; unknown/duplicate keys and invalid UTF-8
are rejected. A non-null date must be exactly `YYYY-MM-DD`. On change it must
be today or any past date, including weekends and holidays; there is no lower
window. An unchanged stored date is accepted even if the clock has moved
backwards. Headcount must be an integer in `1..999` (integral JSON numbers are
accepted, fractional values are not).

Never-saved defaults are version `"0"` and all-null. GET never materializes them.
The first PUT saves version `"1"`, even all-null, and writes one
`JobDraftManagementConfigured` audit with actor and complete `previous` / `new`
JSON values in the same transaction. Later value-identical replacements return
the same version and ETag without writes or audit. Changes increment only this
resource's version. Draft, pipeline, substate and delivery versions/timestamps
remain unchanged, and their writes do not change management.

Writes lock the parent draft, including concurrent first saves. Publication
uses this same lock. The resource remains editable after publication, but
published PUTs cannot clear required values: `422 publication_incomplete` with
ordered missing codes rejects the candidate state and commits no configuration,
version, projection or audit changes. `commitment_date_past` alone is exempt.
See [public-jobs-v2.md](public-jobs-v2.md) (§10.2 guard and tests).
No Idempotency-Key: reconcile an uncertain PUT with GET, not an automatic retry.

## Errors

Except `publication_incomplete`, errors have exactly `{ "error", "code" }`,
no data/list or success ETag. That existing 422 alone has the third key `missing`
with readiness codes; no error returns a success ETag.

| Status | Code | Case |
| --- | --- | --- |
| 400 | invalid_request | Shape/type/date syntax, malformed path or If-Match |
| 400 | validation_error | Changed future date or headcount outside 1–999 |
| 401 / 403 / 404 / 409 | same as private drafts | Live gates and authorization |
| 412 | version_conflict | Stale/foreign tag, including another resource's tag |
| 413 | payload_too_large | Raw body over 1,048,576 bytes |
| 422 | publication_incomplete | Published replacement would leave requirements missing; `{error,code,missing:[codes]}` |
| 428 | precondition_required | Missing If-Match |
| 500 | internal_error | Unexpected failure, corrupt storage, version overflow |

## Storage and verification

Migration `00018_create_job_draft_management_configs.sql` is additive: one
optional row per draft, positive version, nullable DATE and range-checked
INTEGER, cascading draft FK. No backfill or legacy changes. Down removes saved
management settings, not drafts or audits; it is **not data-preserving**.

| Tests | Contract coverage |
| --- | --- |
| `application/vacancymanagement/config_test.go` | Strict decoding, nullable values, bounds 1/999, weekends/holidays, unbounded past, future-on-change, unchanged future, clearing, value equality, Mexico City day boundary, opaque independent tags |
| `draftstore/management_test.go` | Actual response keys/limits/nulls, injected clock, ETag |
| `draftstore/management_integration_test.go` | Pure reads, first/null/no-op saves, exact audit values, draft isolation, rejection snapshots and authorization-before-precondition |
| `draftstore/management_atomicity_integration_test.go` | First audit rollback, unchanged stored date after clock reversal, concurrent first PUT, live gates, corrupt date, overflow |
| `cmd/api/management_routes_test.go` | Real-router gates/no-store, error/status/header projection, session identity and repeated If-Match forwarding |
| `cmd/api/management_flow_integration_test.go` | Real auth/store HTTP lifecycle, exact response shape, five-way version independence, audit actor/snapshot, all rejected effects unchanged |
| `db/migrations/vacancy_management*_test.go` | Additive SQL definition; isolated up/down types, nullability and constraints |

`application` paths are under `backend/internal/features/jobs`; `draftstore`
means its `infrastructure/postgres/draftstore` directory. `cmd` and `db` paths
are under `backend`. Integration files require `-tags=integration` and
`DRAFT_TEST_DATABASE_URL` pointing to an isolated **loopback database named
`draft_test`**. With no URL they explicitly skip; unit tests alone do not prove
DB behavior. Do not create a database as part of verification.
