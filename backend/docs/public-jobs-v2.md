# Public jobs v2 (P2a + listing enrichment)

Anonymous, additive routes over legacy published `jobs` **and** published vacancy
projections. The agreed authority is `docs/pipeline-customization-design.md`
§10.2–§10.4 and §14, including their agreed clarifications. `/jobs*` and
legacy applications remain unchanged. Applying to a vacancy is P2b, not this cut.

## Browse/search

`GET /v2/jobs` → `200 {"items": [...], "next_cursor": string | null}`.
Both keys are always present; empty items is `[]`, never null.

Every query key is optional. Only `state`, `municipality`, and `work_mode` may
repeat (one exact value per parameter, not comma-separated):

| Key | Accepted value |
| --- | --- |
| `q` | Spanish full-text over title (weight A) and plain description (B) |
| `state` | Repeatable known MX state codes, e.g. `09`, `14` |
| `municipality` | Repeatable known MX municipality codes, e.g. `09002`, `14039`; state selection is not required |
| `work_mode` | Repeatable `onsite`, `remote`, `hybrid`; existing single-value requests still work |
| `applicant_country` | Exactly one known uppercase ISO country code, e.g. `MX`: “I can apply from here” |
| `work_schedule` | `full_time`, `part_time` |
| `contract_type` | `project`, `indefinite`, `professional_services`, `temporary`, `internship` |
| `professional_area` | One of the same 16 exact draft catalog codes |
| `limit` | Decimal integer 1–50, default 20 |
| `cursor` | Opaque `next_cursor` from the previous page |

The old `location` substring parameter is removed (now `400 invalid_request`).
Unknown keys, repeated single-valued keys (except `applicant_country`), invalid
`q`/enum/limit/cursor encoding or values return `400 invalid_request`. Invalid
`state`, `municipality`, `work_mode`, or `applicant_country` values/encoding return
`400 invalid_filter`, including unknown catalog codes, blanks, duplicate selected
values, and repeated `applicant_country` (even identical). Codes/enums are exact:
no whitespace trimming, case folding, comma splitting or coercion. `none` is
reserved by §18 and is not an offered public-search option (400). Blank `q` means
no text filter; omit an unselected dimension rather than sending a blank value.
Catalog lookup failures return generic 500, never `invalid_filter` or empty 200.

Repeated values combine with **OR** within each dimension; dimensions combine with
**AND**. A municipality outside the selected states is valid but produces no
matches, not a hierarchy validation error. Geographic values must exist in the
imported G1 catalog, even if no jobs match. `state`/`municipality` exclude legacy
rows and vacancies with no location. `applicant_country` includes non-remote
vacancies (with or without location), remote `anywhere`, and remote `countries`
containing that country. It does not filter by the vacancy's location country.
Legacy onsite/hybrid rows match; legacy remote rows and migrated remote vacancies
without a scope conservatively do **not** match, because eligibility is unknown.
This is discovery only; the transactional apply gate remains authoritative.

Cursors are version 2 and SHA256-bound to normalized filters, with repeated values
sorted independently per dimension (parameter/value order does not matter).
Changing any filter requires starting without a cursor; limit may change. Every
pre-G5 version-1 cursor is rejected with `400 invalid_request`, including those
with the removed `location` filter. Ordering and keyset anchors are unchanged.
See [G5 test/plan checklist](geo-search.md).

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

List items contain exactly these 24 keys. Detail includes them unchanged:

```json
{
  "id": "0192a000-0000-7000-8000-000000000003",
  "source": "vacancy",
  "title": "Backend Go",
  "company": {"id": "0192a000-0000-7000-8000-000000000004", "name": "Acme", "logo_url": "https://example.test/logo.png"},
  "location": {"country":{"id":"MX","name":"México"},"state":{"id":"09","name":"Ciudad de México"},"municipality":{"id":"09002","name":"Azcapotzalco"},"postal_code":null,"label":"Azcapotzalco, Ciudad de México"},
  "location_label": "Azcapotzalco, Ciudad de México",
  "remote_scope": null,
  "work_mode": "hybrid",
  "work_schedule": "full_time",
  "contract_type": "indefinite",
  "professional_area": "technology_systems",
  "seniority": "mid",
  "legacy_employment_type": null,
  "compensation": {"mode":"range","amount":null,"min":"30000.00","max":"40000.00","currency":"MXN","pay_period":"monthly","basis":"gross"},
  "legacy_salary": null,
  "published_at": "2026-10-16T18:00:00.000000Z",
  "excerpt": "Construye servicios con Go.",
  "excerpt_truncated": false,
  "benefits_preview": {"predefined": ["health_insurance"], "custom": ["Café"]},
  "benefits_total": 2,
  "skills_preview": ["Go", "SQL"],
  "skills_total": 2,
  "applicants": "under_10",
  "screening_questions": 0
}
```

- `source`: `legacy | vacancy`. Every key is present, including nulls.
- `company`: exactly `{id,name,logo_url}`. Logo is an absolute `https:` URL
  with a host and no credentials, otherwise null (including relative, `http:`,
  `data:` and malformed values). Both sources use the current company value;
  sanitization never rewrites company data.
- `location`: expanded catalog object or null; references are `{id,name}`, never
  writable display names. `location_label`: municipality + state, state, or country
  name; legacy free text is retained here while legacy `location` is null.
- `remote_scope`: null unless a remote vacancy; `{kind:"anywhere"}` or
  `{kind:"countries",countries:[{id,name}]}` in submitted order. Legacy is null.
  See [geo-vacancy.md](geo-vacancy.md) for G2's exact contract and migration.
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

### Card enrichment (§14)

All enrichment keys are always present, on both list and detail:

| Key | Vacancy | Legacy |
| --- | --- | --- |
| `excerpt` | Normalized plain description excerpt, or null | Same over legacy description |
| `excerpt_truncated` | Boolean | Same |
| `benefits_preview` | First 3 combined benefits, predefined first, stored order within each array | `{predefined:[],custom:[]}` |
| `benefits_total` | Predefined + custom count | 0 |
| `skills_preview` | First 6 skills, entered order | `[]` |
| `skills_total` | Full skill count | 0 |
| `applicants` | `under_10` (0–9), `10_plus` (10–24), `25_plus` (25–49), `50_plus` (50+) | null |
| `screening_questions` | Current published questionnaire's question count, including zero | null |

Before excerpt measurement, collapse every run of Unicode `White_Space` (including
newlines) to one ASCII space and trim. Empty becomes null with `false`. Keep at
most 240 Unicode code points (not bytes or graphemes), cutting at the last ASCII
space inside that prefix or hard-cutting if none. No ellipsis is appended.
`excerpt_truncated` compares against the normalized text, not the original bytes.

Preview arrays are never null. Skills/custom benefits retain their validated
trimmed, non-empty text (≤200 code points each); skills are at most 100 and retain
entered order, including case, interior whitespace and combining characters.
Predefined benefits use the existing draft catalog codes, never display labels.
Applicant ranges are computed at read time over **all** process participations,
including discarded ones. Neither an exact count nor any candidate identity,
state, discard reason or answer is serialized.

## Detail

`GET /v2/jobs/{id}` → `200` with the shared shape plus exactly five keys (29 total):

| Key | Vacancy | Legacy |
| --- | --- | --- |
| `description` | Validated rich envelope `{schema_version,document}` | null |
| `description_plain` | Shared draftrich derivation | Legacy description |
| `requirements` | `{required,preferred}`, each string or null | Both null |
| `benefits` | Full `{predefined:[codes],custom:[strings]}` (not the preview) | Both empty arrays |
| `skills` | Full skill array, entered order | `[]` |

Unknown, unpublished, malformed or inactive-company ids return `404 not_found`.
The id remains the draft/process UUID, preserving existing public page links.
No requester, hiring headcount, request date, delivery, pipeline, screening
question content, answer keys or hidden salary enters either public response.
Only the screening question count is added to these routes; the separate safe
`/screening` endpoint is unchanged.

Public errors have exactly `{error,code}`: `400 invalid_request` / `invalid_filter`,
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
without bumping draft version or adding a no-op audit. There is no
eventual-consistency worker.

Migration `00025_public_listing_enrichment.sql` adds ordered `skills TEXT[]` and
`screening_questions INTEGER` to existing projections. It backfills both from
UTF-8 canonical JSON in the source draft in the same transaction. Invalid JSON,
Unicode, duplicate keys, missing/wrong collections or invalid collection entries
fail loudly without echoing private source content; no guessed zero/default is
used. It leaves original projection/source columns unchanged. Down drops **only**
these two derived columns (their values are reconstructible). Keep 00025 and its
sqlc model update in their own migration commit. Publish and every published save
(including no-op saves) write both new values in the existing transaction.

While published, draft PATCH, delivery PUT and management PUT cannot leave any
§9.3 requirement missing. Rejection is the existing
`422 {error,code:"publication_incomplete",missing:[codes]}` in readiness table
order, with **no committed draft/config/projection/version/audit changes**.
Only `commitment_date_past` is exempt: clock passage does not undo publication.
Changing complete values remains allowed; other preconditions/validation stay
in their existing order. Pipeline/substate editability remains unchanged.

Migration `00031_vacancy_geography.sql` replaces projection free text with catalog
FKs/postal code and remote scope columns/indexes. Existing published test rows
remain visible with null geography; edits must satisfy mode-dependent readiness.
Draft string locations are cleared, remote scope defaults to null, and draft
versions advance. See [G2 migration and test map](geo-vacancy.md).

## Test-to-contract map

Paths below are relative to `backend/`.

| Test | §10 rules/effects |
| --- | --- |
| `application/publicjobs/projection_test.go` | §10.2 VAC-4 allowlist; shared plain derivation; §10.3 fixed/range/hidden/incomplete compensation and canonical decimals; rejects invalid persisted source |
| `application/publication/published_write_test.go` | §10.2 stable missing-code order, only past-date exemption, input unchanged |
| `application/publicjobs/catalog_test.go` | §10.3 strict params/default/boundaries; last-visible cursor across sources, exact rank/time, filter binding, limit+1; exact 24/29-key shape and nulls |
| `infrastructure/http/publicJobsHandler_test.go` | §10.3 anonymous 200/400/404/500; exact envelopes; no ETag/no-store; invalid params do not reach reader; no raw internal error |
| `application/publicjobs/filters_test.go` | G5 imported-catalog membership, independent dimensions, fail-closed catalog outages |
| `cmd/api/public_geo_search_integration_test.go` | G5 state/municipality/work-mode OR and dimension AND, applicant-country eligibility and conservative legacy/migrated behavior, invalid filters on empty results, canonical cursor continuation, actual generated SQL state/municipality index capability and GIN containment-arm capability |
| `cmd/api/public_jobs_routes_test.go` | §10.3 real-router anonymous routes, strict error and public headers |
| `cmd/api/published_write_routes_test.go` | §10.2 existing 422 list envelope reused on all three writes, wrapped error, no success ETag, private no-store retained |
| `draftstore/public_projection_integration_test.go` | §10.2 projection absent before publication; publish creation; source-version refresh; guard rejection snapshots of all resources/audit/projection; past-date exemption; audit failure rolls back both draft and projection; P1 no-op materialization without version/audit change |
| `cmd/api/public_jobs_flow_integration_test.go` | §10.3 real SQL UNION: time/source/id and rank ordering, cross-source pagination, newer insertion stability, all filters and no employment mapping, strict source nulls and extras, hidden/incomplete/complete salary, privacy, inactive/deleted company visibility, 404 before publication, legacy route regression; §10.2 all three real guard rejections leave state unchanged |
| `application/publicjobs/catalog_test.go` — `TestCatalogEnrichmentExcerptAndLogo`, `TestCatalogEnrichmentPreviews` | §14.1/14.5 excerpts at 239/240/241, multibyte and combining code points, hard/word cuts, whitespace/empty, list/detail parity; both-source HTTPS/relative/HTTP/data/credential/malformed logo handling; preview 0/under/at/over limits, predefined-first and entered ordering, totals |
| `application/publicjobs/projection_test.go` — `TestBuildProjectionSkillsAndScreeningCount` | §14.3/14.5 validated trimming/order, full skills and questionnaire count, empty arrays/zero |
| `cmd/api/public_listing_enrichment_integration_test.go` | §14.1–14.5 real-router list/detail exact key sets and parity per source; public logos without source rewrites; full/preview benefits/skills and totals; applicant boundaries 0/9/10/24/25/49/50 with every fixture discarded; published questionnaire edits 2→1→0 with source-version sync; exact-count/candidate/private-content exclusion and legacy defaults |
| `draftstore/public_projection_integration_test.go` | §14.3 skills/count refresh on published save and atomic audit-failure rollback |
| `db/migrations/public_listing_enrichment*_test.go` | §14.3 existing-row ordered backfill, empty/zero, no original-state changes, down scope, malformed/UTF-8/duplicate/surrogate/wrong-shape source rejection with schema/data/version rollback |
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
go test -tags=integration ./cmd/api -run TestPublicListingEnrichment -count=1 -v
go test -tags=integration ./db/migrations -run 'TestMigration00020|TestMigration00025' -count=1 -v
go test ./... -count=1
go vet ./...
go vet -tags=integration ./...
```

DB tests explicitly skip without `DRAFT_TEST_DATABASE_URL` pointing to a loopback
DB named `draft_test`. Do not create databases. The parent owns isolated-DB
execution, review, staging/commits and browser acceptance. Unit passes do not
prove transaction, real ranking or migration correctness.
