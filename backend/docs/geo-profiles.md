# Candidate and company structured locations (G3)

`feat/geo-profiles` is stacked on `feat/geo-vacancy` (G2). Apply migration **00032**
after 00030/00031 and import the [geo catalog](geo-catalog.md) before saving a location.
Free-text candidate/company `city` and `country` are replaced, with no backfill.
Authority: `docs/geo-location-design.md` §20.2, §20.5, §20.8–20.9.

## Write codes; read names

```json
{"location":{"country":"MX","state":"14","municipality":"14039","postal_code":"44100"}}
```

Postal code is **company-only**. Candidate writes stop at municipality.

```json
{"location":{
  "country":{"id":"MX","name":"México"},
  "state":{"id":"14","name":"Jalisco"},
  "municipality":{"id":"14039","name":"Guadalajara"},
  "postal_code":"44100",
  "label":"Guadalajara, Jalisco"
}}
```

Every non-null read location has **exactly** `country`, `state`, `municipality`,
`postal_code`, `label`; each non-null reference has **exactly** `id`, `name`.
All read-location keys are present; missing state, municipality and postal code
are `null`. Missing location is `"location":null`, never an omitted key.
References are `{id,name}`. Labels are municipality + state, otherwise state,
otherwise Spanish country name. Names come from the catalog, never client input.

| Endpoint | Location semantics |
| --- | --- |
| [Candidate GET/PUT `/me/profile`](candidate-profile.md) | Optional; PUT omitted/null clears; postal key forbidden, including empty/null |
| [Company POST `/companies`](company-profile.md) | Optional; omitted/null starts without a location; MX postal optional |
| Company owner PATCH `/me/company` | Absent keeps; null clears all codes; object replaces all levels, never merges |
| Company public GET `/companies/{id}` | Expanded read shape; existing visibility/redaction rules unchanged; no `updated_at` |
| Member GET `/me/company` | Adds `company.location` (read shape/null) and `company.updated_at`, visible to all members |
| Company PATCH 200 and 409 editor data | Same expanded location shape; existing CAS token and conflict envelope unchanged |

## Validation

Country is required **inside a present object**, and must be known ISO alpha-2.
State is MX-only and known. Municipality requires state and must belong to it.
Company postal code requires municipality, five digits and a known matching pair.
No colonias or streets. Postal autocomplete preloads editable choices; it never
locks them. The server remains authoritative after a manual edit.

Unknown nested location keys or wrong JSON types → `400 invalid_request`.
Consistency failures → `422 invalid_location`, through the shared error writer:

```json
{"error":"invalid location","code":"invalid_location",
 "details":[{"field":"location.municipality","reason":"mismatch"}]}
```

Reasons are `required`, `unknown`, `mismatch`, `not_allowed`. Validation precedes
persistence. Company CAS still precedes consistency validation, so stale writes
return 409 with the current editor data, without applying the submitted location.
JSON decoding precedes CAS: even a stale token does not suppress a 400 for unknown
nested keys or wrong types. For well-formed input, stale token + unknown country
returns 409 with current editor data; with a current token it returns 422.

Catalog validation **and name expansion** for candidate PUT and company
POST/PATCH happen before persistence, including preparation of the PATCH
lost-race conflict shape. A missing catalog row or reader error fails closed
with generic 500 and no write. Write responses reuse the prepared shape, never
performing another catalog read after commit. Existing bounded/redacted logging,
routes, role gates and logging census are unchanged.

### Membership editor token

`GET /me/company` now returns `location` and `updated_at` inside `company` for
owners and recruiters alike; PATCH remains owner-only. The timestamp is UTC
RFC3339Nano, exactly the value represented by the PATCH editor view. Echo the
string verbatim in `If-Unmodified-Since`, preserving fractional seconds. Saving
with that token succeeds; reusing it after a successful update returns 409 with
the current token. Public `GET /companies/{id}` deliberately gains no timestamp.

## Migration and temporary §19 behavior

00032 drops both tables' old city/country columns and the candidate city index.
New nullable country/state/municipality columns reference G1 catalog keys; company
postal code additionally references the exact country/postal/municipality triple.
CHECKs prevent orphan levels, non-MX subdivisions and municipality/state mismatch.
Down drops structured values and restores **empty nullable** city/country columns
and the old index. Neither direction preserves the removed data (S8).

**Until G4:** new applications read `NULL::text` instead of the removed profile
city column. Their unchanged §19 four-key snapshot contains `city:null`, while
skills, experience and education still snapshot normally. Existing snapshots
(including old city values), replay and board/detail privacy are unchanged.
Migration 00029 and the §19 JSON shape are not modified. G4/00033 will replace
snapshot city with structured location and add the country apply gate.

## Review and test map

- `TestLocationInputStrictShape`, `TestCandidatePostalPresenceNotAllowed`:
  codes-only shape and candidate postal presence restriction.
- `TestProfileLocationRoundTripAndReplacement`, `TestProfileLocationErrorsNoWrite`:
  candidate reads, labels, every optional depth, clear/replacement and 400/422.
- `TestCompanyLocationCreateErrors`, `TestCompanyLocationOptionalCreateAndPublicNull`,
  `TestCompanyLocationPatchConflictAndClear`: company postal, nulls, nested keys,
  whole-object replacement and unchanged conflict/editor semantics.
- `TestProfileCatalogFailureDoesNotWrite`, `TestCompanyCatalogFailureDoesNotWrite`,
  `TestProfileResponseUsesPreWriteCatalogSnapshot`: fault injection at each read
  level, 500/no-write and successful writes with post-write reads forbidden.
- `TestExpandLocationMissingRowsAndReaderErrorsFailClosed`: missing country/state/
  municipality and each reader error return no partial shape and preserve errors.
- `TestMembershipCompanyLocationAndTokenAllMembers`: exact additive summary and
  location/reference key sets for both roles, nulls and UTC nanosecond precision.
- `TestMembershipTokenRoundTripsIntoOwnerPatch`: GET token → PATCH success, matching
  refreshed membership/editor tokens, stale token → 409 without a second write.
- `TestGeoProfilesMigration`: migration definition; integration test
  `TestGeoProfilesMigrationConstraintsAndEmptyDown`: physical FK/CHECK matrix,
  discarded free text, dropped index and empty downgrade.
- Updated repository fixtures and §19 apply/replay/privacy tests exercise the
  new storage while preserving unrelated profile and audit contracts.
- Existing archguard exceptions cover only `geo/domain` and `geo/application`;
  no exception added and no error-key rule weakened.

From `backend/`: focused tests, `go tool sqlc generate`, gofmt on changed Go files,
`go test ./... -count=1`, `go vet ./...`, `go vet -tags=integration ./...`;
from the worktree root: `git diff --check`.
DB execution is parent-owned on an isolated database; integration-tagged vet only
proves compilation. Run migration rollback tests separately from application tests.

Browser review: save/clear candidate country/state/municipality, reject postal
input; create and edit company with/without postal code, change municipality to
invalidate postal, clear/reload, and save a stale tab to see current conflict data.
Review queue: row 14 in [pending-user-review.md](pending-user-review.md).
