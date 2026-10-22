# Board filter data (§19, H4 harmonized profiles)

Apply migrations through **00043** before running this API. Binding contract:
`docs/profile-harmonization-design.md` §1/§6; geography remains governed by
`docs/geo-location-design.md` §20.2/§20.6.

## Contract and privacy

Owner/principal authorization and `Cache-Control: no-store` are unchanged.
Routes start at `/v2/me/company/job-drafts/{vacancyId}`.

- `GET …/board` includes `screening_filters: [{question_id,prompt,options:[{id,label}]}]`:
  current single-choice questions/options in entered order, using the safe projector.
  No choices → `[]`; never evaluation flags, answer keys, scores or correctness.
- Board items and `GET …/participations/{id}` include `screening_answers:
  [{question_id,option_id}]`: choice identifiers only, in frozen answer order,
  classified by frozen questions. Open text stays in authorized detail's `screening`.
- Both reads include exactly this six-key `profile` (no `education_level`):

```json
{"location":null,"skills":["Go"],"years_of_experience":"1.5","seniority":"junior","education":{"highest_completed":"bachelor","in_progress":"master"},"languages":[{"code":"en","level":"B2"}]}
```

`years_of_experience` is a decimal string or null, normalized without a zero
fraction (`"3.0"` → `"3"`), never an integer. Seniority is a shared literal or null.
Languages contain exactly `{code,level}`, ordered by stored code, and default to `[]`.
Education contains exactly `{highest_completed,in_progress}`: the highest **completed**
qualification and the highest **in-progress** qualification, each in §1 order and
null if no study has the corresponding status. `in_progress` is a level, never a boolean.
Paused/incomplete studies never contribute to either. An ongoing doctorate cannot
replace a completed bachelor's degree.

`location` is null or exactly the five-key read shape:

```json
{"country":{"id":"MX","name":"México"},"state":{"id":"14","name":"Jalisco"},"municipality":{"id":"14039","name":"Guadalajara"},"postal_code":null,"label":"Guadalajara, Jalisco"}
```

Country-only/state-only locations have null lower subdivisions. Labels use
municipality + state, otherwise state, otherwise country. References are exactly
`{id,name}`. Organic reads expand frozen codes, never the current candidate profile;
postal code is null. Manual company profiles are live, including their stored postal code.

Move/discard/recover/substate responses **never** include `profile` or
`screening_answers`. Candidate apply/list, public APIs, history, CV metadata,
audit metadata and request logs do not gain profile data. Snapshot creation selects
no phone, email, birth date, salary or other private profile fields.

SQL NULL snapshots and missing profiles read as:

```json
{"location":null,"skills":[],"years_of_experience":null,"seniority":null,"education":{"highest_completed":null,"in_progress":null},"languages":[]}
```

## Storage and migration

Organic apply reads the harmonized profile inside its transaction, **after replay**
and before the country gate. It stores location codes `{country,state,municipality}`
or null, skills in their existing order (including duplicates), decimal years,
seniority, completed/ongoing education summary, and languages. Snapshot, participation,
intake, audit, delivery and idempotency commit together. Rejections write none.
Profile edits/replays never update organic snapshots. See [apply gate](geo-apply.md).

Manual creation and reuse freeze the same six-key shape from the selected record;
board/detail still read company candidates live. Reused organic identities retain
an immutable snapshot. Initial manual 201 item bytes match the GET board item;
replay bodies remain frozen.

00043 rewrites every non-null historical snapshot without consulting live profiles:
integer years become decimal strings, `education_level` becomes
`education:{highest_completed:<old value>,in_progress:null}`, seniority is null,
languages are empty. SQL NULL stays NULL. Historical nonnegative integer years above
the current profile-write range are preserved, not discarded. JSONB cannot store
an actual escaped NUL; literal backslash-u0000 text is preserved without JSON-text
reparsing or masking. The exact six-key CHECK retains the geography/skills checks.

Down refuses fractional years, non-legacy completed education levels, ongoing study,
non-null seniority or non-empty languages. Representable rows regain the exact four-key
00033 shape and CHECK. The v1 recruiter list is **unchanged**: years still truncate
to integers there only.

## Client-side filters

Filtering remains client-side on the ≤1,000 board, with no new server parameters.
OR within a multi-select dimension, AND across dimensions, empty selection = no filter.
Missing values use `none` («Sin dato») rather than zero or a completed qualification.

| Dimension | Matching rule |
| --- | --- |
| State / municipality | Match location reference `id`; labels use `name`. Null subdivision → `none`; do not casefold IDs. |
| Skills | Existing casefolded normalized-label matching. |
| Seniority | Exact literal; OR across selected seniorities. Null → `none`. |
| Languages | OR across selected codes; an optional minimum level applies to those selected languages. Match any selected code at or above that minimum, ordered `A1 < A2 < B1 < B2 < C1 < C2 < native`. Without a minimum, any level matches. Empty languages → `none`. |
| Education | `highest_completed ≥ X`; with «include in-progress», also match `in_progress ≥ X`. Both use `secondary < high_school < technical < tsu < bachelor < specialty < master < phd`. Null does not meet a minimum; paused/incomplete studies never count. |
| Experience | Decimal-aware `[0,1)`, `[1,3)`, `[3,5)`, `[5,∞)`; parse decimal strings, never truncate (`"0.9"` belongs to the first bucket, `"1.5"` to the second). Null → `none`. |

Removed screening identities match no current option; missing answers use `none`.

## Test map and validation boundary

- `TestProfileSnapshotNormalization`, `TestGeoSnapshotMissingProfileWire`: exact
  six-key shape, decimal years, language order/copy isolation, normalized empty arrays.
- `TestManualHarmonizedEducation`: new levels, completed versus ongoing/paused/incomplete.
- `TestFilterDataOnlyOnBoardAndDetailNotMutations`: read-only privacy allowlist.
- `TestFilterDataApplySnapshotNormalizationAndReplay` (DB): harmonized profile copy,
  code-ordered languages, missing profile, immutability/replay and atomic rejections.
- `TestGeoSnapshotCurrentCodesAndExpandedBoardDetailWire` and filter-data/movement
  exact-wire tests (DB): geography, board/detail parity, null defaults, privacy.
- `TestManualHarmonizationPersistenceReuseAndSnapshot`,
  `TestManualCreateExistingReuseAndAlreadyInProcess`, `TestManualCreateHTTPFlow` (DB):
  new/manual/organic reuse, live manual education, decimal years, 201/GET equality.
- `TestParticipationHarmonizationMigrationDefinition` and
  `TestMigration00043SnapshotRewriteChecksAndGuardedDown` (DB): rewrite, historical
  shapes, SQL NULL, literal NUL escape preservation/actual NUL rejection, exact
  CHECK, guarded atomic Down, repeat Up/Down/Up.

From `backend/`: focused tests, `go test ./... -count=1`, `go run ./cmd/archguard`,
`go vet ./...`, `go vet -tags=integration ./...`. Parent runs DB tests on the isolated
`DRAFT_TEST_DATABASE_URL` harness and the separate migrated `DATABASE_URL` packages
(including the unchanged legacy recruiter-list tests). Rollback tests create their own
loopback `draft_test_mig_*` databases from the guarded `draft_test` connection,
requiring CREATEDB; cleanup drops only the owned database, never the shared harness.
Compilation/skips do not
prove SQL or transactional behavior.
