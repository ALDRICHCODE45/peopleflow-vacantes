# Board filter data (§19, G4 geography)

Apply migrations through **00033** before running this API. G4 (`feat/geo-apply`)
replaces the city snapshot/filter with structured geography. Authority:
`docs/geo-location-design.md` §20.2/§20.6 and pipeline design §19/§18.

## Contract and privacy

Existing owner/principal authorization and `Cache-Control: no-store` are unchanged.
All routes start at `/v2/me/company/job-drafts/{vacancyId}`.

- `GET …/board` includes `screening_filters: [{question_id,prompt,options:[{id,label}]}]`:
  current single-choice questions/options in entered order, using the safe projector.
  No choices → `[]`; never evaluation flags, answer keys, scores or correctness.
- Board items and `GET …/participations/{id}` include `screening_answers:
  [{question_id,option_id}]`: single-choice identifiers only, in frozen answer order,
  classified by frozen questions (not the current questionnaire). Open text stays
  confined to the authorized detail's existing `screening` projection.
- Both reads include `profile: {location,skills,years_of_experience,education_level}`.
  `location` is null or exactly the five-key read shape:

```json
{"country":{"id":"MX","name":"México"},"state":{"id":"14","name":"Jalisco"},"municipality":{"id":"14039","name":"Guadalajara"},"postal_code":null,"label":"Guadalajara, Jalisco"}
```

Country-only and state-only locations have null lower subdivisions. Labels use
municipality + state, otherwise state, otherwise country. Names come from catalogs
for the **frozen codes**, never the candidate's current profile. `postal_code` is
always null. References are exactly `{id,name}`.

Move/discard/recover/substate responses **never** include `profile` or
`screening_answers` (§19.2b). Candidate apply/list, public APIs, history, CV metadata,
audit metadata and request logs do not gain profile data. No phone, email, birth
date, salary or other profile fields are selected by snapshot creation.

SQL NULL snapshots and missing profiles read as:

```json
{"location":null,"skills":[],"years_of_experience":null,"education_level":null}
```

## Immutable storage

Apply reads current country/state/municipality codes, skills, years and education
inside its transaction, **after replay** and before the country gate. It stores
`location: {country,state,municipality}` (codes, each subdivision nullable), or null.
Skills retain order/duplicates; zero years is data. Snapshot, participation, intake,
audit, delivery and idempotency commit together. Rejections write none. Profile
edits and replays never update snapshots. See [apply gate](geo-apply.md).

00033 rewrites existing non-null JSONB snapshots: remove `city`, add `location:null`,
preserve other values. SQL NULL stays SQL NULL. Its CHECK allows exactly the four
root keys, with exact three-key location or null, uppercase two-letter country,
MX-only two-digit state, five-digit municipality prefixed by its required state,
strict string-array skills, nonnegative integer/null years, enum/null education.
Down removes `location`, restores `city:null` and the exact 00029 CHECK, preserving
other data. A later 00029 down still refuses retained snapshots.

## Frontend filter change

Replace **city** with two multi-select dimensions: **state** and **municipality**.
Use reference `id` as value and `name` as label; derive available options from board
items' `profile.location` (not live profiles). Null location/subdivision maps to
`none` («Sin dato»). Do not casefold catalog identifiers. Skills retain casefolded
normalized-label filtering; experience buckets remain `[0,1)`, `[1,3)`, `[3,5)`,
`[5,∞)`; education is unchanged. OR within each dimension, AND across dimensions,
empty selection = no filter. Filtering remains **client-side** on the ≤1,000 board;
there are no new server-side board filter parameters. Removed screening identities
match no current option; missing answers use `none`.

## Tests and validation boundary

- `TestProfileSnapshotNormalization`, `TestGeoSnapshotMissingProfileWire`: exact
  storage allowlist, codes/null, independent copies, skills order/duplicates, zero years.
- `TestFilterDataOnlyOnBoardAndDetailNotMutations`: read-only privacy allowlist.
- Existing screening-filter tests: safe identifiers, snapshot/current ordering, open exclusion.
- `TestGeoSnapshotCurrentCodesAndExpandedBoardDetailWire` (DB): exact five-key locations,
  exact `{id,name}` references, country/state/municipality labels, null postal,
  current-at-apply values, immutable after edits/replay, board/detail parity.
- Updated filter-data/movement exact-wire and privacy tests (DB): legacy defaults,
  immutable snapshots, mutation/candidate/public/history/audit/log exclusion.
- `TestGeoApplyMigrationShapeAndRewrites` and
  `TestMigration00033SnapshotRewriteConstraintsAndDown` (DB): rewrites, SQL NULL,
  valid/invalid nested/root shapes, strict skills, exact down constraint restoration.

From `backend/`: `go tool sqlc generate`, gofmt on changed files, focused tests,
`go test ./... -count=1`, `go vet ./...`, `go vet -tags=integration ./...`.
The parent runs DB tests on an existing isolated loopback `draft_test` via
`DRAFT_TEST_DATABASE_URL`; run migration rollback tests separately. Compilation
and skips do not prove SQL, atomicity or DB privacy behavior. No DB is created here.
