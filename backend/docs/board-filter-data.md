# Board filter data (§19)

Apply migration **00029** with `make db-migrate` before running this API.
Branch `feat/pipeline-filter-data` is stacked on cut 7 (review queue row 10).
Authority: `docs/pipeline-customization-design.md` §19; filtering semantics: §18.

## Contract

All keys are always present. Existing board/detail authorization and
`Cache-Control: no-store` remain unchanged: vacancy owner or principal recruiter only.

- `GET …/board` gains `screening_filters: [{question_id, prompt, options: [{id,label}]}]`.
  These are the **current** questionnaire's single-choice questions, in questionnaire
  order, with options in entered order. No questions/only open questions → `[]`.
  The composition root reuses the safe screening projector: no answer keys,
  evaluation flags, scores or correctness are exposed.
- Every board item gains `screening_answers: [{question_id,option_id}]`: only
  single-choice answers, in stored **answers_snapshot** order, classified using
  **questions_snapshot**, never the current questionnaire. Removed questions/options
  remain in answers but disappear from the current filter catalog. Open text is absent.
- Every board item and participation detail gain
  `profile: {city, skills, years_of_experience, education_level}`. The detail extends
  the board item (including `screening_answers`) and retains its existing complete
  frozen `screening` projection. Move/discard/recover/substate
  responses keep their previous key sets: these new fields are read-only board/detail data.
- Legacy participations with SQL NULL snapshots return
  `{"city":null,"skills":[],"years_of_experience":null,"education_level":null}`.

All paths above are under `/v2/me/company/job-drafts/{vacancyId}`;
participation detail is `/participations/{participationId}`.
See [movement](pipeline-movement.md) for complete root/item keys.

## Snapshot and normalization

**G3 interim (00032):** candidate city/country columns have been removed. New
applications read `NULL::text` for city, so new snapshots contain `city:null`.
Skills, years and education still snapshot normally; existing snapshots and
replays are untouched. G4/00033 will replace city with structured location.
Migration 00029 and its JSON CHECK are unchanged. See [G3](geo-profiles.md).

Before G3, P2b apply read only city, skills, years and education from `candidate_profiles`
inside the existing apply transaction. A missing profile produces the no-data
object above. City is trimmed and every run of Unicode whitespace is collapsed
into one ASCII space; empty becomes null. Skills are copied as stored, including
order and duplicates; years and education are copied unchanged. Zero years is data,
not null. Education is `high_school | bachelor | master | phd | null`.

Snapshot creation is atomic with participation, intake history, audit, delivery
and idempotency. Candidate profile edits never update old participations. Replay
returns the original response before reading the profile, without re-snapshotting.
Rejected/rolled-back applications leave no snapshot. Profile values are not added
to audit metadata or the candidate apply response.

Migration 00029 adds a nullable JSONB column with an exact four-key shape CHECK:
city string/null, skills string array, years non-negative integer/null, education
from the enum/null. No default or backfill. Down refuses while any non-null snapshot
exists, including an all-no-data snapshot; retention/removal needs an explicit
separate decision. Empty-of-snapshots down preserves legacy participations.
Migration 00028's rollback test is pinned to its own version.

## Privacy and client filtering

No new data appears in candidate `/v2/me/*`, anonymous `/v2/jobs*`, mutation responses, history, CV
metadata or other APIs. No phone, email, birth date, salary, country or other profile
fields are read by snapshot creation. Open screening answers remain confined to
the existing authorized participation detail, never the board.

The ≤1,000-item board is still filtered client-side: OR within each multi-select
dimension, AND across dimensions, empty selection = no filter. Profile options
are derived from board items. City/skills values use casefolded normalized labels;
experience buckets are `[0,1)`, `[1,3)`, `[3,5)`, `[5,∞)`, with `none` for no data.
There are no server-side filter parameters in this cut. An answer with a removed
question/option matches no current option; a missing answer uses `none`.

## Test map

| Tests | §19 rules protected |
| --- | --- |
| `TestProfileSnapshotNormalization` | §19.2 Unicode whitespace, empty/missing city, preserved skill order/duplicates, zero years, education, exact keys, independent copy, missing-profile defaults |
| `TestScreeningFilterDataUsesOnlyChoiceAndKeepsSnapshotOrder` | §19.1 safe identifier-only answers, open exclusion, stored answer order, case-insensitive question identity, current-questionnaire order, exact option/filter keys, empty arrays |
| `TestBoardFilterDataUsesSafeCurrentScreeningProjector` | §19.1 composition-root reuse of safe current questionnaire projection, evaluated choices without private keys/flags, empty/open-only catalogs |
| `TestFilterDataApplySnapshotNormalizationAndReplay` (DB) | §19.2–§19.3 actual transactional snapshot, missing/present profile with G3 null city, every other field, immutable after profile edits, frozen replay, invalid answers/unavailable CV/stale revision/audit failure leave none, duplicate/conflicting applies preserve the original |
| `TestFilterDataBoardDetailLegacyCurrentQuestionnaireAndPrivacy` (DB) | §19.1–§19.2 exact root/item/detail/profile keys, legacy defaults, edited questionnaire removes question/option only from filters, open-text exclusion, positive applied profile on board/detail and immutable replay, candidate apply/list, mutation/history and public list/detail/screening privacy, no-question catalog |
| `TestBoardFilterDataMigration` | §19.3 additive nullable shape CHECK and retention-guarded down definition |
| `TestMigration00029ExistingRowsShapeAndGuardedDown` (DB) | §19.3 existing-row preservation, complete valid/invalid shape matrix (including nested/non-string skills and fractional/negative years), retained-data down refusal, empty down preserves rows |
| `TestFilterDataOnlyOnBoardAndDetailNotMutations` | §19.2 privacy allowlist: board/detail contain the new fields; mutation responses do not |
| Updated movement/substate/column-editing exact-wire tests | §19 additive root/item/detail changes; existing mutation key sets preserved |
| Existing owner/principal, cross-vacancy and real-router gate tests | §19.2 authorization and no-store remain in force |
| Existing `TestParticipationAuditFailureRollsBackAllEffects` | §19.3 same-transaction rollback after snapshot insertion |

## Validation

From `backend/`: `go tool sqlc generate`, `gofmt -w` on changed Go files,
focused tests, `go test ./... -count=1`, `go vet ./...`, and
`go vet -tags=integration ./...`.

DB tests compile but execution is deferred to the parent on an existing isolated
loopback database named `draft_test`, with `DRAFT_TEST_DATABASE_URL`. No database
is created by the implementation run. Run migration rollback tests separately
from application tests sharing that database. Compilation/skips do not prove SQL
constraints, transaction behavior or database privacy projections.
