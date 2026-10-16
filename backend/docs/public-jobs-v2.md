# Public jobs v2 (publication P2a)

Anonymous, additive routes over legacy published `jobs` **and** published vacancy
projections. The agreed authority is `docs/pipeline-customization-design.md`
§10.2–§10.4, including the clarifications below the list envelope. `/jobs*` and
legacy applications remain unchanged. Applying to a vacancy is P2b, not this cut.

## Browse/search

`GET /v2/jobs` → `200 {"items": [...], "next_cursor": string | null}`.
Both keys are always present; empty items is `[]`, never null.

Every query key is optional and may appear at most once:

| Key | Accepted value |
| --- | --- |
| `q` | Spanish full-text over title (weight A) and plain description (B) |
| `location` | Case-insensitive literal substring, not SQL wildcards |
| `work_mode` | `onsite`, `remote`, `hybrid` |
| `work_schedule` | `full_time`, `part_time` |
| `contract_type` | `project`, `indefinite`, `professional_services`, `temporary`, `internship` |
| `professional_area` | One of the same 16 exact draft catalog codes |
| `limit` | Decimal integer 1–50, default 20 |
| `cursor` | Opaque `next_cursor` from the previous page |

Unknown/duplicate keys, invalid URL/UTF-8 encoding, invalid enums/limits/cursors
return `400 invalid_request`. Enums are exact, not case-folded. Blank `q` and
`location` mean no filter. Cursors are versioned and bound to the normalized
filters; changing filters requires starting without a cursor. Limit may change.

With `q`, order is rank descending; ties (and browse mode) use `published_at`
descending, source descending in C collation, then UUID descending. The keyset
anchors the last visible row across **both** sources; a newer insertion does not
shift the next page. Rank is round-tripped at the same float8 precision as SQL.
There is no offset paging or total count.

Schedule/contract/area filters exclude legacy rows, whose values are null.
Legacy `employment_type` is never mapped to a schedule or contract type.
Both sources require a published record and an active, non-deleted company;
legacy jobs also require `deleted_at IS NULL`.

## Exact shared item

List items contain exactly these 14 keys. Detail includes them unchanged:

```json
{
  "id": "0192a000-0000-7000-8000-000000000003",
  "source": "vacancy",
  "title": "Backend Go",
  "company": {"id": "0192a000-0000-7000-8000-000000000004", "name": "Acme"},
  "location": "Ciudad de México",
  "work_mode": "hybrid",
  "work_schedule": "full_time",
  "contract_type": "indefinite",
  "professional_area": "technology_systems",
  "seniority": "mid",
  "legacy_employment_type": null,
  "compensation": {"mode":"range","amount":null,"min":"30000.00","max":"40000.00","currency":"MXN","pay_period":"monthly","basis":"gross"},
  "legacy_salary": null,
  "published_at": "2026-10-16T18:00:00.000000Z"
}
```

- `source`: `legacy | vacancy`. Every key is present, including nulls.
- `company`: exactly `{id,name}`. Location is nullable for legacy.
- `seniority`: `intern | junior | mid | senior | lead`, never null for legacy;
  nullable for vacancies (optional at publication).
- Legacy: `work_schedule`, `contract_type`, `professional_area`, `compensation`
  are null. `legacy_employment_type` preserves the original value.
- Vacancy: `legacy_employment_type` and `legacy_salary` are null.
- `published_at`: non-null RFC 3339 UTC; legacy uses its first `jobs.published_at`,
  never creation time; vacancy uses the process clock start, never last edit.
- `compensation`: exactly `{mode,amount,min,max,currency,pay_period,basis}`.
  Non-null only if `public_visible=true` **and** mode, currency, pay period, basis
  and the applicable amount(s) are set. Fixed uses `amount` and null `min/max`;
  range uses `min/max` and null `amount`. Hidden/incomplete is null and is never
  stored in the projection. Amounts are canonical two-decimal strings, currency
  `MXN | USD`, pay period `hourly | weekly | semimonthly | monthly | yearly`,
  basis `gross | net`. `public_visible` itself is not public.
- `legacy_salary`: exactly `{min,max,currency}`, nullable decimal-string bounds,
  `MXN | USD`. Null when both bounds are null; no period/basis is invented.

## Detail

`GET /v2/jobs/{id}` → `200` with the shared shape plus exactly four keys:

| Key | Vacancy | Legacy |
| --- | --- | --- |
| `description` | Validated rich envelope `{schema_version,document}` | null |
| `description_plain` | Shared draftrich derivation | Legacy description |
| `requirements` | `{required,preferred}`, each string or null | Both null |
| `benefits` | `{predefined:[codes],custom:[strings]}` | Both empty arrays |

Unknown, unpublished, malformed or inactive-company ids return `404 not_found`.
The id remains the draft/process UUID, preserving existing public page links.
No requester, hiring headcount, request date, delivery, pipeline, screening,
answer keys or hidden salary enters either public response.

Public errors have exactly `{error,code}`: `400 invalid_request`,
`404 not_found`, or unexpected `500 internal_error`. No public response has
an ETag or `Cache-Control: no-store`; no new caching policy is introduced.

## Projection and published-write guard

Migration `00020_create_vacancy_public_projections.sql` is additive, with a
cascade FK to the process, typed filter columns, JSONB rich content/benefits/
compensation, source draft version, generated Spanish tsvector and GIN index.
It rewrites no existing rows. Its down drops only the derived projection and
is **not data-preserving**. Keep it in its own migration commit.

Publishing writes the projection inside the process/audit/idempotency transaction.
Every published v2 draft save refreshes it in the draft/audit transaction, with
its exact source version and original publication time. This includes a no-op
save: existing P1 processes become discoverable after their next draft save,
without bumping draft version or adding a no-op audit. There is no backfill or
eventual-consistency worker.

While published, draft PATCH, delivery PUT and management PUT cannot leave any
§9.3 requirement missing. Rejection is the existing
`422 {error,code:"publication_incomplete",missing:[codes]}` in readiness table
order, with **no committed draft/config/projection/version/audit changes**.
Only `commitment_date_past` is exempt: clock passage does not undo publication.
Changing complete values remains allowed; other preconditions/validation stay
in their existing order. Pipeline/substate editability remains unchanged.

## Test-to-contract map

Paths below are relative to `backend/`.

| Test | §10 rules/effects |
| --- | --- |
| `application/publicjobs/projection_test.go` | §10.2 VAC-4 allowlist; shared plain derivation; §10.3 fixed/range/hidden/incomplete compensation and canonical decimals; rejects invalid persisted source |
| `application/publication/published_write_test.go` | §10.2 stable missing-code order, only past-date exemption, input unchanged |
| `application/publicjobs/catalog_test.go` | §10.3 strict params/default/boundaries; last-visible cursor across sources, exact rank/time, filter binding, limit+1; exact 14/18-key shape and nulls |
| `infrastructure/http/publicJobsHandler_test.go` | §10.3 anonymous 200/400/404/500; exact envelopes; no ETag/no-store; invalid params do not reach reader; no raw internal error |
| `cmd/api/public_jobs_routes_test.go` | §10.3 real-router anonymous routes, strict error and public headers |
| `cmd/api/published_write_routes_test.go` | §10.2 existing 422 list envelope reused on all three writes, wrapped error, no success ETag, private no-store retained |
| `draftstore/public_projection_integration_test.go` | §10.2 projection absent before publication; publish creation; source-version refresh; guard rejection snapshots of all resources/audit/projection; past-date exemption; audit failure rolls back both draft and projection; P1 no-op materialization without version/audit change |
| `cmd/api/public_jobs_flow_integration_test.go` | §10.3 real SQL UNION: time/source/id and rank ordering, cross-source pagination, newer insertion stability, all filters and no employment mapping, strict source nulls and extras, hidden/incomplete/complete salary, privacy, inactive/deleted company visibility, 404 before publication, legacy route regression; §10.2 all three real guard rejections leave state unchanged |
| `db/migrations/vacancy_public_projection*_test.go` | §10.4 additive definition, typed/JSONB/version columns, generated weighted Spanish search and GIN, cascade FK, isolated up/down scope |

`application` and `infrastructure` refer to `internal/features/jobs/`;
`draftstore` means `internal/features/jobs/infrastructure/postgres/draftstore/`.
Existing P1 replay/race tests now use complete post-publication edits and expect
the guard when delivery clearing loses a race to publication. Existing legacy
handler/use-case/query tests and implementation remain unchanged.

## Validation

From `backend/`:

```sh
go tool sqlc generate
go test ./internal/features/jobs/application/publicjobs ./internal/features/jobs/application/publication ./internal/features/jobs/infrastructure/postgres/draftstore ./internal/features/jobs/infrastructure/postgres/publicjobs ./internal/features/jobs/infrastructure/http ./cmd/api ./db/migrations -count=1
go test -tags=integration ./internal/features/jobs/infrastructure/postgres/draftstore ./cmd/api -run 'TestPublicProjection|TestPublicJobsFlow|TestPublication' -count=1 -v
go test -tags=integration ./db/migrations -run TestMigration00020 -count=1 -v
go test ./... -count=1
go vet ./...
```

DB tests explicitly skip without `DRAFT_TEST_DATABASE_URL` pointing to a loopback
DB named `draft_test`. Do not create databases. The parent owns isolated-DB
execution, review, staging/commits and browser acceptance. Unit passes do not
prove transaction, real ranking or migration correctness.
