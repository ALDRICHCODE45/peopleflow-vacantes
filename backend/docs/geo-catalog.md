# Geo catalog (G1)

Anonymous reference lookups for the shared LocationField. Countries are worldwide;
subdivision detail and postal resolution are Mexico-only. G1 adds no location write
routes and does not change existing vacancy, company, or candidate fields.
G2 now wires the validator and expands vacancy reads; see
[Vacancy geography](geo-vacancy.md) for the draft/public contract, migration 00031,
readiness rules and verification map.

## Routes

| GET route | Success body | Ordering |
| --- | --- | --- |
| `/v2/geo/countries` | `{"items":[{"id":"MX","name":"México"}]}` | Spanish country name, ICU `es`, then code |
| `/v2/geo/countries/MX/states` | `{"items":[{"id":"14","name":"Jalisco"}]}` | Code |
| `/v2/geo/countries/MX/states/14/municipalities` | `{"items":[{"id":"14039","name":"Guadalajara"}]}` | Spanish municipality name, then code |
| `/v2/geo/countries/MX/postal-codes/44100` | See below | State code, Spanish municipality name, then municipality code |

Examples show shapes, not the complete lists. Every read reference is `{id,name}`:
`id` contains the catalog code, **not** a new UUID. Values are strings; retain leading
zeros. The states and municipalities endpoints return the full list, without
pagination or server-side search. The client filters while typing.

```json
{
  "postal_code": "44100",
  "matches": [
    {
      "state": {"id": "14", "name": "Jalisco"},
      "municipality": {"id": "14039", "name": "Guadalajara"}
    }
  ]
}
```

There is deliberately **no bulk postal-code endpoint**. Several matches are
supported: the user picks one. Postal lookup preloads editable state/municipality
fields; never lock them. Clear a postal code when the chosen municipality no
longer matches it. Colonias and streets are neither imported nor returned (S11).

## Errors and caching

All query parameters are unsupported: any nonempty query string, including a
malformed one, returns `400 invalid_request`. Authentication is not required;
an Authorization header does not change a reference response.

| Condition | Status | Stable code |
| --- | ---: | --- |
| Unknown or unsupported country (including a known non-MX country) | 404 | `country_not_found` |
| Unknown MX state | 404 | `state_not_found` |
| Postal code not exactly five ASCII digits | 400 | `invalid_postal_code` |
| Postal code with no catalog pair | 404 | `postal_code_not_found` |
| Unexpected storage error | 500 | `internal_error` |

Errors use the existing shared envelope, e.g.
`{"error":"postal code not found","code":"postal_code_not_found"}`. Technical
storage details are not returned or logged.

Successful responses carry `Cache-Control: public, max-age=86400` and a **strong**
quoted ETag. Its SHA-256 input includes the latest `geo_catalog_imports.id`, the
resource path, and serialized response data. Including the representation protects
against racing refreshes assigning one strong tag to different response bytes.
A matching `If-None-Match` returns **304**, no body, and the same cache headers.
Weak request validators, comma-separated validators, and `*` are accepted for GET.
Errors are not given the public caching headers. Reimporting unchanged data still
records a new generation and invalidates ETags. An empty catalog uses a stable
`empty` generation until the first import.

## Import and refresh

From `backend/`:

```sh
make geo-reduce RAW=/absolute/path/to/raw-sources
make geo-import
# ISO/INEGI only; do not read/import the SEPOMEX CSV:
make geo-import GEO_ARGS=-skip-postal-codes
# Only after reviewing the reported missing codes:
make geo-import GEO_ARGS=-allow-orphans
```

`geo-import` requires an explicitly supplied `DATABASE_URL`, an already migrated
database, and `db/geo/sources.json`. Default import requires all four CSVs and
manifest entries. `-skip-postal-codes` requires only countries, states and
municipalities; it never opens the postal CSV, and its manifest entry may be absent
(or is ignored if present). It never loads `.env`, creates a database, downloads
data, or runs migrations. Use `go run ./cmd/geoimport -dir /path/to/reduced` for a
different reduced directory. `-reduce` runs without database access and cannot
be combined with `-skip-postal-codes`.

The importer validates code formats, unique identities, and INEGI parentage;
deduplicates postal triples; lists and skips SEPOMEX pairs absent from INEGI;
serializes concurrent refreshes; checks missing old codes; and upserts plus
records source dates/counts in **one transaction**. A failed import records no
history and changes no rows. No old code is ever deleted. Missing old codes fail
by default even when unreferenced; `-allow-orphans` retains and reports them.
Reimporting is idempotent for catalog rows; provenance is intentionally append-only
(one row per enabled file: four normally, three when postal codes are skipped).

### Optional postal import step

The SEPOMEX upsert is an isolated step inside the same transaction when enabled.
With `-skip-postal-codes`, the importer does not read, lock, write or orphan-check
the postal table, and records no SEPOMEX provenance. Core catalog orphan checks
remain enforced. On a fresh database the postal table stays empty: the other three
endpoints still return normal cacheable lists, while a well-formed postal lookup
returns `404 postal_code_not_found`. Existing postal rows are **retained**, not
cleared or disabled by the skip flag. Re-enable the default import to populate or
refresh them later.

The user accepted the documented SEPOMEX risk for G1; this optional step keeps it
removable without coupling countries/states/municipalities to the postal dataset.

See [data provenance, counts, licences, and refresh layout](../db/geo/README.md),
including the broader redistribution restriction in the downloaded SEPOMEX TXT.
Migration 00030 creates only the five catalog tables, constraints, ordering index,
and ICU Spanish collation; its down drops them all.

## Read and write values for later cuts

The frontend-agreed `{id,name}` reference also applies to future location reads:

```json
{"country":{"id":"MX","name":"México"},"state":{"id":"14","name":"Jalisco"},"municipality":{"id":"14039","name":"Guadalajara"},"postal_code":"44100","label":"Guadalajara, Jalisco"}
```

Null levels remain null. Write shapes and DB column names are **unchanged**; a
write still sends codes directly, e.g.
`{"country":"MX","state":"14","municipality":"14039","postal_code":"44100"}`.
No location read/write adapter is wired in G1. The existing shared error envelope's
`code` key is unchanged; no archguard exception is needed for reference data.

## Validator seam for later cuts

`geo/application.NewValidator(lookup).Validate(ctx, value, rules)` returns a
`[]domain.Violation` containing `Field` and `Reason`, plus a separate storage
error. It reports the first inconsistent level deterministically. Null is allowed
unless `Required`; present objects require a known country. State is MX-only;
municipality must belong to the state; allowed postal codes must map to the
municipality. Rules select required MX levels, postal allowance, and field prefix
(default `location`, or e.g. `fields.location`). Reasons are `required`, `unknown`,
`mismatch`, and `not_allowed`. Malformed postal input uses `unknown` in the value
validator; the lookup endpoint independently returns `invalid_postal_code`.

`invalid_location` is registered additively as 422 for later adapters. G1 does
**not** add a write adapter or alter existing error-envelope behavior. Future
write adapters must reject unknown JSON keys and carry field/reason details under
the §20.2 contract; they must not turn database failures into validation failures.

## Verification

- `go test ./internal/features/geo/... ./internal/shared/httpjson ./cmd/api ./internal/tools/archguard ./db/migrations -count=1`
- `go test -tags=integration ./db/migrations -run '^TestGeoCatalog' -count=1 -v`

The integration tests require the existing isolated `DRAFT_TEST_DATABASE_URL`
contract (loopback host, database named `draft_test`). They do not create a
database. They cover migration up/down, code CHECKs/FKs, Spanish ordering,
idempotent import, provenance dates, mismatch skipping, orphan refusal/retention,
multiple postal matches, cache invalidation, base-only import with an empty postal
table, the other three endpoints in that state, and retention when skipping an
already populated postal table. Run on a disposable DB, not a
shared development DB; the parent owns that run. Compilation or skips are not
passing database evidence.
