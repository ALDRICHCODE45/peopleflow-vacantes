# Private draft pipeline configuration API (cut 1)

Implementation reference for per-draft stage configuration. The accepted
contract is `docs/pipeline-customization-design.md` §3–§4; that document wins
if this reference differs. This cut moves no candidates and changes neither
`applications.status` nor the draft publication path.

The HTTP adapter is thin transport over `application/pipelineconfig.Store`.
The PostgreSQL draft store owns live authorization, preconditions, normalization,
versioning, audit and persistence.

## Routes and identity

| Method | Route | Success |
| --- | --- | --- |
| `GET` | `/v2/me/company/job-drafts/{draftId}/pipeline` | `200 OK` |
| `PUT` | `/v2/me/company/job-drafts/{draftId}/pipeline` | `200 OK` |

`{draftId}` must be a UUID; a malformed value is `400 invalid_request` before
calling the store. These routes address schema-2 employer drafts, not legacy
public vacancies. A known schema-1 draft is hidden as `404`, as on draft v2 GET.

Identity comes only from session `CompanyContext`. The same middleware as the
private draft routes runs: `NoStore` → `RequireAuth` → recruiter membership gate.
The store re-reads the live user, company and membership in its transaction,
then authorizes the owner or the draft principal. Missing, foreign-company and
non-principal drafts are indistinguishable `404 not_found`, **before** checking
`If-Match` or decoding the body. See `private-job-drafts.md` for the auth gates.

Every response, including middleware `401`/`403` and all handler errors, has
`Cache-Control: no-store`. Public routes are unchanged.

## GET response

```json
{
  "version": "0",
  "stages": [
    { "id": "…", "kind": "new", "name": "Nuevos" },
    { "id": "…", "kind": "screening", "name": "Screening" },
    { "id": "…", "kind": "screening_ok", "name": "Screening OK" },
    { "id": "…", "kind": "in_process", "name": "En proceso" },
    { "id": "…", "kind": "placement", "name": "Placement" }
  ],
  "exit": { "id": "…", "kind": "discarded", "name": "Descartados" },
  "limits": { "maxCustomStages": 3, "nameMaxLength": 40 }
}
```

`version` is a decimal **string**. `"0"` means no configuration has ever been
stored. GET never writes: each default built-in ID is UUIDv5 with the draft UUID
as namespace and the stage kind as name. Repeated/concurrent reads return the
same IDs without a backfill.

`ETag` is a strong, opaque **pipeline** tag. Clients must retain it, never
construct or parse it. It is distinct from the draft tag, including at version
zero. Pipeline and draft versions are independent: pipeline PUT changes no
draft fields, timestamps, version or ETag; draft PATCH changes no pipeline data,
version or ETag.

## PUT — full replacement

Body is exactly `stages` and `exit`. Each stage accepts exactly `name` and an
optional `id`; `kind` is never accepted. Use existing IDs from GET; omit `id`
only when adding a custom stage. Remove a custom stage by omitting it, unless it
is the stored delivery cutoff (cut 3; see [pipeline-delivery.md](pipeline-delivery.md)).

```json
{
  "stages": [
    { "id": "<new-id>", "name": "Nuevos" },
    { "id": "<screening-id>", "name": "Filtro" },
    { "id": "<screening-ok-id>", "name": "Filtro OK" },
    { "name": "Prueba técnica" },
    { "id": "<in-process-id>", "name": "Entrevistas" },
    { "id": "<placement-id>", "name": "Contratado" }
  ],
  "exit": { "id": "<discarded-id>", "name": "Fuera" }
}
```

The successful response has the GET shape. `stages` preserves request order;
new custom stages have server-assigned random UUIDs. Rename/reorder preserve
identity and semantic kind. Removed custom IDs cannot be reintroduced by a
client.

### Rules on every save

1. Exactly one of each built-in kind; none can be removed.
2. `new` is always first and `placement` always last. All intervening stages
   can be reordered freely.
3. `discarded` exists only in `exit`, never in progression.
4. At most three custom stages, before placement. A custom stage stored as
   `cutoffStageId` cannot be omitted: `409 cutoff_stage_in_use`, with no config,
   version or audit write. Clear/replace the delivery cutoff first. Renaming or
   reordering that column remains allowed. Delivery and pipeline writes lock the
   same parent draft, so cutoff selection and deletion cannot race.
5. Names use the unchanged requester-catalog normalizer: valid UTF-8 → NFC →
   trim/collapse Unicode `White_Space` (including NBSP) to one ASCII space.
   Non-whitespace controls are rejected; zero-width/format characters remain.
   The normalized display name has 1–40 Unicode code points, not bytes.
6. Names are unique across progression **and** exit, on full Unicode casefold
   re-normalized to NFC. Accents remain significant: `Área` = `ÁREA`,
   `Straße` = `STRASSE`, but `Area` ≠ `Área`. No NFKC or fuzzy matching.
7. IDs must belong to the current configuration; kinds are derived from them.

### Preconditions, budget and no-op behavior

`If-Match` is required, exactly one nonempty strong tag from pipeline GET/PUT.
Repeated header lines are joined as a list and rejected, never silently reduced
to the first line. Weak tags, lists, `*`, unquoted or malformed values are
`400 invalid_request`; missing is `428 precondition_required`. A valid but stale
or foreign tag is `412 version_conflict`, with no editor data.

The raw body budget is **1048576 bytes**, shared with draft writes, enforced
while reading before calling the store. Over-budget is `413`, never truncation.
Unknown/duplicate JSON keys (including escaped equivalents), invalid UTF-8,
malformed JSON and trailing input are `400 invalid_request`. Value invariant
violations are `400 validation_error`.

The first successful PUT stores version `"1"` with the deterministic built-in
IDs. A subsequent PUT whose normalized configuration equals the stored value
returns `200` with the **same** version, ETag and body, with no write or audit.
A changing PUT increments only the pipeline version. Concurrent first writes
with the same version-zero ETag serialize: one commits, the other gets `412`.

No `Idempotency-Key` is used and no `Idempotency-Replayed` header is emitted.
After an uncertain PUT (for example a timeout), retain dirty editor state and
reconcile with an explicit GET; do not automatically retry.

## Persistence and audit

Migration `00015_create_job_draft_pipeline_configs.sql` creates an optional row
per draft: `draft_id` primary/FK, positive independent `version`, and complete
configuration bytes. Parent draft locking serializes both initial and later
writes without changing the parent. Down removes only this configuration table;
audit rows survive. Review data loss before any rollback of stored settings.

Each changing PUT appends exactly one `JobDraftPipelineConfigured` event in the
same transaction. Actor and draft entity association use the existing audit
port. Metadata has `version`, `previous` and `new`; the two snapshots are complete
JSON configuration documents encoded as strings by the string-valued audit
metadata port. Audit failure rolls back configuration and version together.

## Status codes

Error envelope is exactly `{ "error": string, "code": string }`, without DTO,
`data`, validation details or ETag.

| Status | Code | Case |
| --- | --- | --- |
| `400` | `invalid_request` | JSON shape/encoding, unknown/duplicate key, path UUID, malformed/empty/weak/list If-Match |
| `400` | `validation_error` | Any stage, identity, order or name invariant |
| `401` | `unauthenticated` | Missing/invalid token or no live user |
| `403` | `forbidden` | No current membership / insufficient role |
| `403` | `company_inactive` | Company missing or tombstoned |
| `404` | `not_found` | Missing/foreign/non-principal draft after general gates |
| `409` | `company_not_active` | Company inactive at the transactional guard |
| `409` | `cutoff_stage_in_use` | Omitted custom stage is the stored delivery cutoff; no writes |
| `412` | `version_conflict` | Stale or foreign strong If-Match |
| `413` | `payload_too_large` | Raw body over budget |
| `428` | `precondition_required` | PUT without If-Match |
| `500` | `internal_error` | Unexpected failure, invalid stored data or version overflow |

The additive shared catalog also includes `400 non_business_date` for a changed
weekend/holiday commitment date on the delivery PUT, not the pipeline PUT.
The `409 cutoff_stage_in_use` envelope contains no stage ID; if the editor did not
expect that column to be the cutoff, re-read GET `…/pipeline/delivery`.

## Validation commands

From `backend/`:

```sh
go test ./internal/features/jobs/application/pipelineconfig ./internal/features/jobs/infrastructure/http ./internal/features/jobs/infrastructure/postgres/draftstore ./cmd/api -count=1
go test ./...
go vet ./...
# Only the disposable loopback draft_test database, never ambient DATABASE_URL:
go test -tags=integration ./internal/features/jobs/infrastructure/postgres/draftstore ./cmd/api -run '^TestPipeline' -count=1 -v
go test -tags=integration ./db/migrations -run '^TestMigration00015' -count=1 -v
```

Integration tests use `DRAFT_TEST_DATABASE_URL`, reject non-loopback/non-`draft_test`
targets, and explicitly skip when that variable is unset. Migration tests must
run separately from packages using the same database because they exercise down.
