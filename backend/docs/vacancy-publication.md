# Vacancy publication P1

Employer-only publication of a v2 draft; public discovery and applications are
P2. Authoritative contract: `docs/pipeline-customization-design.md` §9 (including
L25's no-materialization resolution). Legacy `jobs` / `applications` are untouched.

## Identity and storage

`GET` / `POST /v2/me/company/job-drafts/{id}/publication` use the existing session
identity and live draft gates. Owner or draft principal only; missing, foreign
and non-principal drafts are indistinguishable `404`s. Every response carries
`Cache-Control: no-store`, including middleware rejections.

The published vacancy keeps the draft id. Migration
`00019_create_vacancy_processes.sql` adds one process row per draft: company,
status `published`, publication instant and actor. The primary key enforces
at-most-once publication. No data is backfilled. Down drops publication state,
not drafts/configurations/audits; it is **not data-preserving**. Publication
idempotency responses also survive down, so down is not a safe lifecycle reset
or a supported publish-again operation.

Content, pipeline, substates, delivery and management remain the same editable
per-id resources after publication. Publishing changes **none** of their
versions, ETags, fields or timestamps. Never-saved pipeline defaults remain
version `"0"`: built-in UUIDv5 ids already depend deterministically on draft id
and kind. No default pipeline rows or configuration audits are created.

## Readiness

GET is a pure read, with no ETag or Idempotency-Replayed header. Exact body:

```json
{"status":"draft","publishedAt":null,"missing":["request_date_missing","commitment_date_past"]}
```

`status` is `draft` or `published`; `publishedAt` is RFC 3339 UTC or null.
`missing` is always an array, empty when ready or already published. A shared
parent-draft lock gives one coherent content/configuration view.

Readiness codes are returned in this exact order (not alphabetically):

1. `title_missing`
2. `description_missing`
3. `location_missing`
4. `work_mode_missing`
5. `work_schedule_missing`
6. `contract_type_missing`
7. `professional_area_missing`
8. `requester_missing`
9. `request_date_missing`
10. `hiring_headcount_missing`
11. `delivery_cutoff_missing`
12. `delivery_target_missing`
13. `commitment_date_missing`
14. `commitment_date_past`

Description is checked using the validated rich document's derived plain text;
empty/whitespace-only paragraphs do not satisfy it. A requester kind without a
selected catalog id is incomplete. Principal recruiter already exists.
Requirements, benefits and compensation are optional. A commitment date before
**today in America/Mexico_City** is past; the entire local day is inclusive.
A missing date produces only `commitment_date_missing`, not the past code.

## Publish

POST body must be exactly `{}` (JSON whitespace is immaterial).

Required headers:

- `Idempotency-Key`: exactly one non-empty UUID, same canonicalization and
  persisted-algorithm replay rules as draft create.
- `If-Match`: the **draft** ETag from GET of the draft, not a configuration tag.

Evaluation order inside the transaction:

1. Live auth gates, scoped draft lock and owner/principal authorization.
2. Key presence and UUID shape.
3. Idempotency lookup/replay: same key and equivalent payload returns the
   original `201`, body and ETag with `Idempotency-Replayed: true`, **before**
   precondition or already-published checks. A different payload returns
   `409 idempotency_conflict`.
4. Draft If-Match: missing `428`, malformed `400`, stale/foreign `412`.
5. Existing process → `409 already_published`.
6. Atomic readiness → `422 publication_incomplete` if anything is missing.
7. Insert process, frozen response/idempotency record and publication audit;
   commit all or nothing.

Transport still bounds the body before invoking the store (1,048,576 bytes).
For an existing key, strict JSON decoding precedes payload comparison, as for
draft create. For a fresh key, the precondition and already-published checks
precede body validation. A valid non-empty payload can conflict with an existing
key, but cannot create a process.
The idempotency operation is `publish:v2`, scoped by company and actor; the
fingerprint includes the addressed draft id as well as the canonical payload,
so the same key on a different authorized draft conflicts. New records use the
existing tagged SHA-256 representation. Unknown algorithms fail closed.

First success: `201`, unchanged draft `ETag`, `Idempotency-Replayed: false`,
with exactly:

```json
{"id":"0192a000-0000-7000-8000-000000000003","status":"published","publishedAt":"2026-10-16T18:00:00.000000Z"}
```

No public URL/slug exists in P1. Server timestamps use UTC microseconds.
Publication starts the delivery clock. `VacancyPublished` records the actor,
`publishedAt` and a frozen six-key `snapshot` of `targetQuantity`,
`cutoffStageId`, `cutoffStageName`, `commitmentDate`, `hiringHeadcount` and
`requestDate` in string-valued audit metadata (the snapshot is encoded JSON).
Later edits never rewrite it. All draft/configuration writers use the same
draft-row lock, so readiness cannot race a delivery/content/management change.

## Errors and client behavior

Inherited draft catalog errors remain exactly `{ "error", "code" }`, no success
ETag or replay header. Extensions:

| Status | Code | Body |
| --- | --- | --- |
| 422 | publication_incomplete | Exactly `{ "error", "code", "missing": [codes] }` |
| 409 | already_published | Exactly `{ "error", "code" }` |

Only `publication_incomplete` carries a list. The baseline catalog/code list is
unchanged; publication entries are an additive extension. The list items from
GET `/v2/me/company/job-drafts` now include `status` and `published_at`; see
[draft-list.md](draft-list.md). Ordering/cursor/filters do not change.

The confirmation UI first reads draft summary/ETag and readiness. One key per
confirmation attempt; never auto-retry an uncertain POST. “Comprobar” reads
readiness and may reuse the same key if still draft. Treat `412` as changed
elsewhere; reconcile `409 already_published` as success. Translate missing
codes, handling unknown ones generically. Management uses its own save under
“Solicitud”; its date picker uses the server's `today`. No frontend changes
are part of this backend cut.

## Test-to-contract map

| Tests | §9 rules/codes |
| --- | --- |
| `application/publication/readiness_test.go` | Every §9.3 code individually, full table order, optional requirements/benefits/salary, non-null empty array, Mexico City boundary and whole-day/past date |
| `draftstore/publication_test.go` | Canonical `{}` replay payload, addressed-id separation, distinct payload fingerprints, malformed/duplicate/UTF-8/surrogate/budget failures |
| `draftstore/publication_integration_test.go` | Pure readiness; exact success and published-readiness bodies; frozen audit/process actor/time; all five resource versions unchanged including pipeline zero; replay after edits without If-Match; auth/key/replay/precondition/already/incomplete order; audit rollback; concurrent same/different-key publication yields one process; delivery clear/past-date races never freeze invalid requirements |
| `draftstore/publication_atomicity_integration_test.go` | Stored pipeline/substate version preservation; renamed cutoff snapshot remains frozen; create/publication key namespaces; cross-draft key conflict; live gate before replay; unknown fingerprint algorithm rollback |
| `internal/shared/httpjson/publication_errors_test.go` | Canonical 422/409 definitions, list only for incomplete, exact envelope keys, empty array, unknown/forged definitions fail closed |
| `cmd/api/publication_routes_test.go` | Real-router no-store/gates, every mapped status/code, exact error/list envelope, ETag and true/false replay headers, session identity and all key/If-Match header lines forwarded |
| `cmd/api/publication_flow_integration_test.go` | Real JWT/gates/store: 13 missing codes on empty draft; exact GET/POST and headers; frozen audit/process; unchanged resources and list ordering; original replay after edits; malformed/unknown/type/budget rejection snapshots; specified precedence before/after publication |
| `db/migrations/vacancy_publication*_test.go` | Additive process schema; isolated up/down typed non-null fields, PK/FKs/status check; legacy/draft/management tables survive down |
| `draftstore/list_publication_integration_test.go`, `http/draftListPublication_test.go` | List's two new keys, null/UTC timestamp, no order/cursor/draft-version change |

`application` paths are under `backend/internal/features/jobs`; `draftstore`
and `http` mean its `infrastructure/postgres/draftstore` and
`infrastructure/http` directories. `internal/shared`, `cmd` and `db` paths
are under `backend`. Integration files are build-tagged and
require an isolated loopback `draft_test` database via
`DRAFT_TEST_DATABASE_URL`; absent configuration explicitly skips them. Unit
passes alone do not establish transaction/race/migration correctness.

Run from `backend`:

```sh
go test ./internal/features/jobs/application/vacancymanagement ./internal/features/jobs/application/publication ./internal/features/jobs/infrastructure/postgres/draftstore ./internal/features/jobs/infrastructure/http ./internal/shared/httpjson ./db/migrations ./cmd/api -count=1
go test -tags=integration ./internal/features/jobs/infrastructure/postgres/draftstore ./cmd/api ./db/migrations -run 'TestManagement|TestPublication|TestListPublication|TestMigration0001[89]' -count=1 -v
go test ./... -count=1
go vet ./...
```

Do not create a database for these commands. The parent runs DB-backed coverage
on an isolated database and owns review, browser acceptance, staging and commits.
