# Vacancy geography (G2)

Vacancy drafts now write catalog codes and read `{id,name}` references. Public
`/v2/jobs` list/detail return a structured location or null, plus `location_label`
and `remote_scope`. This cut builds on G1; candidate/company geography and the
application-country gate are later cuts. Legacy `/jobs` stays unchanged.

## Draft writes and reads

POST/PATCH use the existing exact `{"fields":{...}}` envelope, on both draft
schema adapters. The current editor is `/v2/me/company/job-drafts` (r2 ETags).

```json
{"fields":{"location":{"country":"MX","state":"14","municipality":"14039","postal_code":"44100"},"remote_scope":{"kind":"countries","countries":["CO","MX"]}}}
```

| Field | Write | Read |
| --- | --- | --- |
| `location` | Null or `{country,state?,municipality?,postal_code?}` with code strings | Null or exactly the five-key object below (`country`, `state`, `municipality`, `postal_code`, `label`; no remote fields) |
| `remote_scope` | Null, `{kind:"anywhere"}`, or `{kind:"countries",countries:[codes]}` | Null, `{kind:"anywhere"}` (no `countries` key) or `{kind:"countries",countries:[{id,name}]}` in submitted order |

```json
{"country":{"id":"MX","name":"México"},"state":{"id":"14","name":"Jalisco"},"municipality":{"id":"14039","name":"Guadalajara"},"postal_code":"44100","label":"Guadalajara, Jalisco"}
```

Missing read levels/postal code are null. Labels use municipality + state,
otherwise state, otherwise the Spanish country name. Create defaults both fields
to null. PATCH replaces each complete field: omission keeps it, null clears it,
and an object is never merged with the previous object. ETag/CAS precedence is
unchanged. A normalized no-op keeps version, timestamp and audit unchanged.
Editor reads retain a configured remote scope even while onsite/hybrid, allowing
mode toggling; public reads suppress it unless remote.

G1's application validator enforces a known country, MX-only state, municipality
parentage and optional five-digit postal-to-municipality consistency. Partial MX
locations are valid drafts. Postal lookup preloads editable fields, never locks
them; the server still rejects a mismatched postal code. No bulk postal endpoint.
Countries scopes require 1–50 distinct known uppercase ISO codes, retaining order.
Both scopes and locations store **only codes**, never submitted display names.

Unknown/read-only keys at every object level return `400 invalid_request`.
Geography value failures return 422 with a details array:

```json
{"error":"invalid location","code":"invalid_location","details":[{"field":"fields.location.municipality","reason":"mismatch"}]}
```

Location reasons: `required`, `unknown`, `mismatch`, `not_allowed`.
`invalid_remote_scope` uses `unknown_country`, `duplicate`, `empty`, `too_many`;
country-item paths include the zero-based index. Storage failures remain generic
500s, not validation failures. No extra request/error logs contain geography.

## Publication and discovery

| Work mode | Readiness |
| --- | --- |
| Onsite/hybrid | No location → `location_missing`; MX without state + municipality → `location_incomplete` |
| Remote | No scope → `remote_scope_missing`; location optional |

Remote scope is ignored by readiness and excluded from the projection when not
remote. Geography missing codes occupy the old location slot after description;
without a chosen work mode only `work_mode_missing` applies. Published-write
protection still runs atomically on all guarded resources. A migrated published
vacancy remains visible with null location/scope until edited, but that edit must
satisfy the new readiness rules.

Public list/detail use the same expanded location and scope shapes. Both new keys
are always present. Legacy rows have `location:null`, `remote_scope:null`, and
`location_label` contains their original free text (or null). Until G5, **all query
parameters remain unchanged**: the case-insensitive literal `location` substring
filter now searches `location_label`, covering both structured labels and legacy
free text. Cursor bindings are unchanged.

## Migration and architecture review

`00031_vacancy_geography.sql` drops only projection free-text `location`, adds
nullable country/state/municipality FKs, optional postal code, nullable remote
kind/country array, and state/municipality/GIN-country indexes for G5. Publication
and published saves rebuild the projection in the existing transaction.

Drafts with a `fields` object gain `remote_scope:null`; string locations become
null. Each rewritten row advances version once and updates its timestamp,
invalidating stale ETags. The Go encoder really does sort `fields` before
`schema_version`, but older migration fixtures also store schema-first partial
envelopes and bare `{}`. Migration 00031 accepts either schema version, arbitrary
valid key order/JSON whitespace and these partial historical shapes. It never
fabricates a missing `fields` object or schema version.

Before PostgreSQL JSON decoding, a session-local helper scans BYTEA with
`get_byte`, tracking quotes and skipping complete escapes, and masks only real
U+0000 escapes (not literal backslash-u text). Its ASCII marker has no overlapping
prefix/suffix. It compares decoded marker occurrences with inserted NUL markers
and retries with a different candidate on collision, including collisions spelled
with Unicode escapes. Only masked bytes enter JSONB. The recursive encoder then
sorts every object's keys in C order, preserves array order and emits compact
Go-style HTML/U+2028/U+2029 string escaping. Finally it restores retained NUL
markers as `\u0000`, without decoding the result again. Thus canonical input
keeps exact canonical bytes apart from the intended field changes; reordered or
whitespace-bearing input becomes canonical too, preserving decoded values.
Both SQL migration directions independently define both helpers, so ordinary
`go tool goose` / `make db-migrate` execution needs no Go migration registration
or helper left behind by an earlier connection. Down restores empty text
projections and null document locations, removes remote scope, and advances
versions; removed test values are unrecoverable.

Frozen idempotency rows, including response bodies and fingerprints, are untouched.
That does **not** guarantee replay of a pre-G2 create: the current codec adds the
`remote_scope:null` default, so its normalized fingerprint no longer matches the
pre-G2 one and the existing comparison returns `409 idempotency_conflict`. A retry
that still submits a string location fails current parsing (`422 invalid_location`)
before the idempotency comparison. Only a request accepted by the current codec
whose normalized fingerprint matches the stored one receives the frozen response.

The exact cross-feature allowlist adds only `geo/application` and `geo/domain`.
Jobs reuses G1's validator with tx-scoped generated catalog queries; it imports no
sibling infrastructure. The error-envelope JSON-key guard is unchanged.

## Verification and browser checklist

From `backend/`, focused unit checks:

```sh
go test ./internal/features/jobs/... ./internal/shared/httpjson ./internal/tools/archguard ./db/migrations ./cmd/api -count=1
```

Parent-owned integration on the existing isolated `draft_test` DB (never create a
DB for these commands):

```sh
go test -tags=integration ./db/migrations -run '^TestMigration00031' -count=1 -v
go test -tags=integration ./internal/features/jobs/infrastructure/postgres/draftstore -run 'TestGeography|TestMigration00031' -count=1 -v
go test -tags=integration ./cmd/api -run 'TestPublicJobsFlow|TestPublicListingEnrichment|TestPublicationFlow' -count=1 -v
```

`TestMigration00031RewrittenDraftReadsNoopPatchesAndPublishes` covers NUL only in
the discarded old location and NUL in retained title/description/collection and
screening values. It checks exact up bytes/version, read/no-op PATCH, subsequent
editing/publication, exact down bytes/previous shape/version, empty projection
location, and byte-identical pre-G2 frozen idempotency rows after both directions.
The publication step edits retained NULs to ordinary text: PostgreSQL's existing
TEXT/JSONB public projection cannot contain NUL; changing that publication
limitation is outside this migration fix. Migration/read/no-op assertions retain
those NUL values unchanged.

`TestMigration00031ScannerNULAndEscapedDelimiterFixtures` executes each direction's
SQL helpers independently on a pinned session for schema 1/2, null/string/object
locations, NULs, mask collisions and escaped delimiter/key decoys, comparing with
the Go canonical encoder. `TestMigration00031HistoricalStoredFixturesUpDown` runs
the real migration over the schema-first partial document used by 00012/00013
fixtures, bare `{}` used by 00022/00027 fixtures, and reordered/whitespace/string-
escape variants. `TestMigration00031RealV1V2CreateAndSaveDocuments` migrates actual
stored bytes from both Store.Create/Save and Store.CreateV2/SaveV2, not hand-typed
prefixes. Both assert exact canonical up/down bytes and version changes.
Geography integration also covers state-only labels on editor/public
reads and remote-scope replacement, null clearing and clear no-op semantics.
Other coverage checks read references/order, postal mismatch, published-mode
guards, projection refresh/suppression and migration schema up/down. Compilation
is not passing database evidence.

- [ ] Select MX state/municipality; resolve one postal code, then edit the preload.
- [ ] Save/reload; check leading zeros, labels, clear and whole-field replacement.
- [ ] Remote: require anywhere/countries; retain country order and reject duplicates.
- [ ] Switch onsite/hybrid: require complete MX location; remote scope survives in editor only.
- [ ] Publish/edit; check public list/detail parity and legacy label fallback/filter.
- [ ] Migrate an old test draft: stale tab gets 412; re-edit location/scope before publication.
