# Public geography search (G5)

`GET /v2/jobs` now uses catalog filters, not a free-text `location` substring.
The [complete parameter, error and cursor contract](public-jobs-v2.md#browsesearch)
is authoritative. No migration or response-shape change is introduced.

## Decisions

- `state`, `municipality` and `work_mode` use §18 repeated parameters: OR within
  each dimension, AND across dimensions. A single `work_mode` remains compatible.
- Duplicate selected values are rejected with 400 `invalid_filter`, not deduped.
  `applicant_country` must occur exactly once when supplied, even for equal values.
- `none` is reserved, not a supported public option. Omit an empty selection.
- MX state and municipality membership is validated independently against G1;
  municipalities need no state parameter. Contradictory dimensions return empty
  results rather than a location-hierarchy error.
- Applicant country means eligibility, not location. All non-remote rows match,
  including legacy onsite/hybrid and migrated non-remote vacancies without location.
  Remote vacancies match anywhere or explicit country containment. Legacy remote
  rows and migrated remote vacancies without scope do not match: no eligibility
  is inferred. No state/municipality filter ever matches legacy or absent location.
- Cursor version 2 hashes every filter, sorting repeated dimensions before SHA256.
  All old cursors fail as invalid cursors (400 `invalid_request`), including ones
  bound to removed location substrings. Limit is still not bound. Rank/time/source/
  UUID ordering, float8 rank precision, and keyset comparison remain unchanged.
- `invalid_filter` is additive in the shared geography error catalog. Baseline V1
  codes, exact public item/detail shapes and archguard restrictions are unchanged.

Example: `?state=09&state=14&work_mode=remote&work_mode=hybrid&applicant_country=MX`.
Codes are exact (including leading zeros); unknown/malformed values, blank values
and duplicate selections fail even if the text search has no results. Catalog
storage failures remain generic 500s without leaking internal context.

## SQL and index evidence

Filtering runs inside each UNION source before expansion: geography excludes the
legacy source, and the projection predicates compare bare indexed CHAR columns
against cast parameters. Remote country selection uses GIN-compatible `@>` array
containment, not `ANY` over the stored array or expanded JSON/display labels.

`TestPublicGeoSearchIndexCapability` follows the existing draft-list capability
pattern: transaction-local sequential scans disabled, EXPLAIN of the **actual
sqlc-generated search** for state and municipality must name G2's corresponding
indexes. The exact country-containment arm must permit G2's GIN index. The full
applicant-country OR also admits non-remote/anywhere rows, so it does not promise
GIN selection for the whole query. This is index capability, not a production
cost/performance benchmark; final plans depend on data/statistics.

## Verification

From `backend/`, the parent runs these against the existing isolated loopback
`draft_test` DB (do not create a database):

```sh
go test -tags=integration ./cmd/api -run 'TestPublicGeoSearch|TestPublicJobsFlow|TestPublicListingEnrichment' -count=1 -v
```

`TestPublicGeoSearchFilters` exercises real-router/SQL OR/AND semantics, standalone
municipality, all applicant-country branches, absent location/scope and legacy
rules, unknown values on empty searches, duplicate rejection and reordered cursor
continuation. Existing public flow tests now isolate fixtures by a unique text
marker instead of the removed substring filter. Exact public wire checks remain.
Unit tests cover syntax, canonical cursors including version-1 invalidation,
catalog membership/outages, wrapped error mapping, exact error wire and headers.

Required non-DB gates: `go tool sqlc generate`, focused tests, `go test ./... -count=1`,
`go vet ./...`, `go vet -tags=integration ./...`, `git diff --check`, and gofmt on
changed Go files. Compilation is not passing database evidence.

## Browser review

- [ ] Select multiple states/municipalities and modes; check OR and cross-filter AND.
- [ ] Select applicant country; verify anywhere/restricted/non-remote matches.
- [ ] Clear selections by omitting params; ensure no `none` or blank values sent.
- [ ] Page with filters, then change filters and restart without the old cursor.
- [ ] Confirm legacy cards retain free-text labels but do not match geography.
