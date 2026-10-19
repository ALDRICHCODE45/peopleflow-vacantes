# §20 Structured geography (proposal, for frontend review)

Replaces every free-text location with catalog codes: vacancy, public projection/search, candidate
profile, company, and the §19 profile snapshot. Tracking: `odd/tasks/geo-location.md` (S1–S10).
Code map that grounds this design: L2 in that file.

## 20.1 Scope and principles

- **Countries:** the whole world (ISO 3166-1 alpha-2). **Subdivisions:** Mexico only (S4): state
  = INEGI `CVE_ENT` (2 digits), municipality = INEGI `CVE_ENT`+`CVE_MUN` (5 digits), optional postal
  code = SEPOMEX `d_codigo` (5 digits). Other countries store only the country today.
- **Open door for other countries:** the value shape is generic. `state` and `municipality` are
  "first/second subdivision of `country`". Adding another country means importing its subdivisions;
  the contract does not change.
- Writes store **codes only**. Reads return codes **plus display names** taken from the catalog.
  Clients never send names.
- **No backfill (S8).** Free-text fields are removed and their test values are dropped (§20.8).
- The legacy `jobs` table and its `/jobs` routes are **out of scope**. Their free text stays;
  structured filters never match them (§20.6).

## 20.2 Location value

Write shape, used in every write contract below:

```json
{"country": "MX", "state": "14", "municipality": "14039", "postal_code": "44100"}
```

Read shape: the same keys, expanded with names; `null` stays `null`.

```json
{"country": {"code": "MX", "name": "México"},
 "state": {"code": "14", "name": "Jalisco"},
 "municipality": {"code": "14039", "name": "Guadalajara"},
 "postal_code": "44100",
 "label": "Guadalajara, Jalisco"}
```

`label` is the server-built display text:
- municipality + state when there is a municipality;
- otherwise the state;
- otherwise the country name.

Consistency rules apply in every context:
- `country` is required whenever the object is present, and must be a known ISO code.
- `state` requires `country` = `MX` and a known state.
- `municipality` requires `state`, must be a known municipality, and must belong to that state.
- `postal_code` requires `municipality`, must be 5 digits, must exist, and must map to that
  municipality in the SEPOMEX pairs.
- Each context (§20.4–§20.5) states which levels are **required** and whether `postal_code` is
  **allowed**.
- Unknown keys → 400 `invalid_request`.

Violation → 422 `invalid_location`, carried in the standard error envelope with `details`:

```json
{"field": "location.municipality", "reason": "unknown|mismatch|required|not_allowed"}
```

The field path is prefixed with the field name, e.g. `fields.location.state` for drafts.

## 20.3 Catalog (G1)

**Migration 00030** creates these tables:

| Table | Columns |
|---|---|
| `geo_countries` | `code CHAR(2) PK`, `name_es`, `name_en` |
| `geo_states` | `country_code`, `code` (PK `(country_code, code)`), `name`, `abbreviation` |
| `geo_municipalities` | `country_code`, `state_code`, `code` (PK `(country_code, code)`), `name`; FK to state |
| `geo_postal_codes` | `country_code`, `postal_code`, `municipality_code` (PK of the three); FK to municipality |
| `geo_catalog_imports` | source, source date, rows, imported_at |

- Codes are text, keeping leading zeros.
- Colonias are **not** stored: nobody stores them (S2). The postal code only resolves the state and
  municipality.

**Importer** `go run ./cmd/geoimport` (`make geo-import`):
- Reads reduced, versioned CSVs under `backend/db/geo/`:
  - `countries.csv` (ISO, Spanish/English names);
  - `mx_states.csv` and `mx_municipalities.csv` (from the INEGI AGEEML catalog);
  - `mx_postal_codes.csv` (deduplicated `d_codigo, c_estado, c_mnpio` pairs from the SEPOMEX
    national file).
- A separate `make geo-reduce RAW=…` regenerates the CSVs from raw downloads. Raw files are not
  committed.
- Runs in one transaction and upserts.
- A code missing from the new files is never deleted while referenced. The importer reports it and
  fails, unless `-allow-orphans`.
- Every SEPOMEX state/municipality pair must exist in INEGI. Mismatches are listed and skipped, and
  the run reports them.
- Idempotent; the import row records the source dates. Refreshing is manual (no automatic sync).

**Public endpoints.** No auth. Responses carry `Cache-Control: public, max-age=86400` and a strong
ETag derived from the last import, with `304` on `If-None-Match`.

| Route | Response | Errors |
|---|---|---|
| `GET /v2/geo/countries` | `{items:[{code,name}]}`, ordered by the Spanish name (collation `es`) | — |
| `GET /v2/geo/countries/MX/states` | `{items:[{code,name}]}`, ordered by code | unknown or unsupported country → 404 `country_not_found` |
| `GET /v2/geo/countries/MX/states/{state}/municipalities` | full list, ordered by name (largest state is about 570 rows; the client filters while typing) | unknown state → 404 `state_not_found` |
| `GET /v2/geo/countries/MX/postal-codes/{cp}` | `{postal_code, matches:[{state:{code,name}, municipality:{code,name}}]}`; usually one match, sometimes more | not 5 digits → 400 `invalid_postal_code`; unknown → 404 `postal_code_not_found` |

- There is no bulk postal-code listing. Postal codes are only looked up one at a time (see §20.9 Q1).
- Unknown query params → 400.

## 20.4 Vacancy (G2)

**Draft fields** (PATCH `{"fields":{…}}`, same ETag/CAS rules):
- `location`: free-text string → **location object or `null`**, MX postal code allowed (S2).
- **New** `remote_scope`: `null`, `{"kind":"anywhere"}` or
  `{"kind":"countries","countries":["MX","CO"]}`.
  - The countries list has 1–50 unique ISO codes, in submitted order.
  - Errors: 422 `invalid_remote_scope` with reasons `unknown_country`, `duplicate`, `empty`,
    `too_many`.
- Both fields are replaced as a whole, never merged.

**Publication readiness**, extending `readiness.go`:
- `onsite` or `hybrid` (S5):
  - `location` required with country; for MX, state + municipality are also required.
  - Missing → `location_missing`; incomplete MX → `location_incomplete`.
  - `remote_scope` is ignored, so the editor may keep it while the user toggles the mode.
- `remote` (S3):
  - `remote_scope` required, else `remote_scope_missing`.
  - `location` optional; when present it must be valid.

**Projection.** The projection keeps the published state of each field:
- Location codes + postal code.
- `remote_scope_kind` (NULL unless `remote`) and `remote_countries CHAR(2)[]`.
- The free-text `location` column is dropped.

**Public `/v2/jobs` item and detail:**
- `location`: the read shape or `null`.
- New `location_label`: the label, or the free text for legacy rows.
- New `remote_scope`: `null` unless `remote`, otherwise `{kind, countries:[{code,name}]}`.

This changes the type of `location` (string → object), agreed with the frontend (S8).

The draft editor read returns the same read shapes.

## 20.5 Candidate profile and company (G3)

**Candidate** (`GET/PUT /me/profile`, full replacement):
- `city` and `country` → `location` (object or `null`).
- No postal code: sending one → `not_allowed` (S2, candidate up to municipality).
- All levels are optional but must be consistent (S6).

**Company** (`POST /companies`, `PATCH /me/company`, public `GET /companies/{id}`):
- `city` and `country` → `location` (object or `null`), MX postal code allowed (S2).
- Optional. PATCH keeps tri-state semantics: absent = keep, `null` = clear, object = replace.

**Storage:** `country_code`, `state_code`, `municipality_code`, plus `postal_code` (company only),
all with FKs to the catalog.

## 20.6 Apply gate and §19 data (G4)

**Gate (S3, P1).** The vacancy is `remote` with `remote_scope.kind = countries`. Inside the apply
transaction the server reads the candidate's **current** profile country. The order is:
1. After the idempotency replay check, so a replay of an earlier success stays a success.
2. After the vacancy lookup.
3. Before the screening, CV and duplicate checks.

Outcomes:
- No country → 422 `applicant_country_required`, with `data: {allowed:[codes]}`. The UI asks the
  candidate to complete the profile country.
- Country not in the list → 422 `applicant_country_not_allowed`, with the same `data`.
- `anywhere`, onsite and hybrid have no gate.

The public detail exposes `remote_scope`, so the frontend can warn before the candidate applies.

**§19 snapshot:**
- `city` is replaced by `location` `{country, state, municipality}` (codes, or `null`).
- The CHECK is updated accordingly.
- Board and detail return the read shape.
- The board filters by state and municipality (both multi-select, §18), replacing the city filter.
- Existing snapshots get `location: null` («Sin dato»).
- Mutations still never carry it (§19.2b).

## 20.7 Public search filters (G5)

On `/v2/jobs`:
- `location` (substring) is replaced by repeatable `state` and `municipality` (MX codes).
- `work_mode` stays.
- New `applicant_country` (one ISO code) means "I can apply from here". It matches:
  - non-remote vacancies;
  - remote with `anywhere`;
  - remote whose countries contain the code.
- Multi-select semantics follow §18: OR within a dimension, AND across dimensions.
- `state` and `municipality` never match legacy `jobs` rows or vacancies without a location.
- Unknown codes → 400 `invalid_filter`.
- The cursor binding gains the new filters.
- Indexes on the projection's state, municipality and remote countries (GIN).

## 20.8 Migrations and data (Risk item 1, authorized by S8)

| Migration | Changes |
|---|---|
| 00030 | catalog only; additive |
| 00031 | projection columns; drops projection `location`; rewrites stored draft documents (`location` string → `null`, version + 1) |
| 00032 | drops profile and company `city`/`country`, adds the code columns |
| 00033 | snapshot CHECK change; `city` key → `location: null` |

- Each down restores the previous columns and shapes, **empty**.
- After 00031, published test vacancies have no location until re-edited. They still show
  publicly, with `location: null`, but any edit must satisfy readiness.
- The seed `00008` (legacy jobs) is untouched.

## 20.9 Open points

- **Q1 (user, legal):** SEPOMEX states that its catalog «se proporciona en forma gratuita, no
  estando permitida su comercialización, total o parcial».
  - We only use it to autocomplete state and municipality from a postal code, one at a time, with
    no bulk listing and no resale.
  - **Recommendation: use it this way.** The INEGI catalogs have no such restriction.
- **Q2 (frontend):** `applicant_country` in public search was described in P6's recommended option
  text, though the option label only names state/municipality/work mode. Keep it in G5, or drop it?
- **Q3 (frontend):** do you want postal-code autocomplete to fill the state and municipality and
  lock them, or only prefill them?

## 20.10 Cuts

| Cut | Contents | Migration |
|---|---|---|
| G1 | catalog, importer, data files, geo endpoints | 00030 |
| G2 | vacancy draft + readiness + projection + public item | 00031 |
| G3 | candidate profile + company | 00032 |
| G4 | apply gate + §19 snapshot/board | 00033 |
| G5 | public search filters | none |

Frontend counterparts:
- shared `LocationField` + `RemoteScopeField` (with G1/G2);
- adopting it in vacancy, company and candidate;
- the board and public filters.

Vacancy SEO, done last, then uses these codes (`addressRegion`, `addressLocality`,
`applicantLocationRequirements`).
