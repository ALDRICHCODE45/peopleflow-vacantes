# Vacancy applications (P2b)

Organic applications for published **vacancy processes**, separate from legacy
`applications`. Contract: pipeline design §10.5; identity: §11.

## Screening (public)

`GET /v2/jobs/{id}/screening` → 200 exactly:

```json
{"questionnaire_revision":"opaque","questions":[{"id":"…","prompt":"Why?","type":"open","options":null}],"limits":{"open_answer_max_length":2000}}
```

Choice type is `single_choice`, with `options:[{id,label}]`. No questions → `[]`.
Uses the existing safe projector: never publishes evaluation flags or answer keys.
Revision hashes canonical **candidate-visible** questions, preserving question and
option order; it never hashes private answer keys (which have a small guessable
space). Public text/options edits change the revision; evaluation-only edits do not.
Legacy, unpublished, unknown or inactive-company IDs return `404 not_found`.
This route is anonymous like detail, without private no-store headers or ETag.

## Apply (private)

`POST /v2/jobs/{id}/applications`, body exactly:

```json
{"cv_id":"…","questionnaire_revision":"opaque","answers":[{"question_id":"…","text":"My answer"},{"question_id":"…","option_id":"…"}]}
```

Uses `NoStore → RequireAuth → RequireCandidateRole`. No account →
`403 account_required`; recruiter → `403 wrong_role`; no session → 401.
Every private response (including errors) has `Cache-Control: no-store`.
Applying and the candidate list do not access file storage: they remain available
when `CV_STORAGE_ROOT` is unset (only CV-library routes return 503).
No cover letter or client-supplied actor, source, stage, evaluation or status.
Unknown/duplicate JSON keys, unknown fields and malformed identifiers are rejected.
JSON bodies have the existing 1 MiB budget (`413 payload_too_large`).

All questions are mandatory, one answer each. Open text is trimmed Unicode
whitespace and must have 1–2,000 code points. Single-choice answers use an option ID,
not a label; `text` and `option_id` are not interchangeable. Unknown/duplicate
question IDs → `400 invalid_request`. Per-question problems → 422 exactly:

```json
{"error":"invalid answers","code":"invalid_answers","details":[{"question_id":"…","reason":"required"}]}
```

Reasons: `required`, `unknown_option`, `too_long`, `wrong_type`. Only this error gets
`details`. G4 adds two country errors with `data`; other errors remain `{error,code}`.

For a published remote vacancy restricted to countries, the current profile country
is checked before screening/CV/duplicate checks. Missing country → 422
`applicant_country_required`; outside scope → 422 `applicant_country_not_allowed`.
Both return exactly `{error,code,data:{allowed:[ISO codes in scope order]}}`.
Anywhere/onsite/hybrid do not require a country. See [G4](geo-apply.md).

Success is 201 exactly `{id,vacancy_id,status:"submitted",applied_at}`;
`applied_at` is UTC RFC3339 (microsecond precision).

### Idempotency

Exactly one nonempty UUID `Idempotency-Key` header is required, following draft
create: absent → `400 idempotency_key_required`; empty, repeated or malformed →
`400 invalid_idempotency_key`. Scope is candidate + vacancy + key. First success
sets `Idempotency-Replayed: false`. Equivalent canonical payload replays the exact
original 201 bytes with `Idempotency-Replayed: true`, even after questionnaire edits
or CV library removal, profile-country edits or published-country-scope changes.
Existing vacancy/auth gates still run before replay. Different payload → `409 idempotency_conflict`.

Canonical payload normalizes the CV/question UUIDs and trims open answers; answer
array order is irrelevant. Fingerprints include answer field presence/type markers,
so adding even an empty forbidden answer field cannot masquerade as a replay.
Persisted fingerprints are SHA-256 plus an explicit algorithm tag; unknown/malformed
stored records fail closed. Rejected first attempts create no idempotency record.

### Transaction and privacy

Candidate-row locking serializes candidate library changes and applies; a shared
lock on the draft serializes questionnaire edits; a shared company lock keeps its
active state stable; the vacancy process is locked for update. Under these locks:

1. Require a published process, public projection and active/live company (404).
2. Check idempotency replay/conflict before current profile/questionnaire/CV checks.
3. Read current profile allowlist once; enforce the published remote country scope
   (`422 applicant_country_required` / `422 applicant_country_not_allowed`).
4. Compare current revision (`409 questionnaire_changed`), validate answers.
5. Require the CV in this candidate's live library (`422 cv_unavailable`, including
   another candidate's ID).
6. Reject an existing participation (`409 already_applied`).
7. Insert participation referencing its immutable CV version, frozen safe questions
   and answers, source `organic`, deterministic pipeline `new` stage ID, and private
   profile snapshot (location codes/null, skills, years, education; migration 00033).
8. Insert intake history, append PII-free `VacancyApplicationSubmitted` audit and
   persist the original idempotent response; commit together.

Audit metadata is only vacancy ID, stage ID and source, never answer text or CV
content. There is no scoring, automatic rejection or automatic movement. Legacy
jobs/applications and their routes are not written or migrated.

Migration **00022** adds process participations (unique per process + candidate),
intake history and idempotency. It references **00021** CV versions with matching
candidate ownership. Down refuses while participation/idempotency data exists.

## Candidate list (private)

`GET /v2/me/applications?cursor&limit` →
`{items:[{id,vacancy:{id,title},company:{id,name},applied_at,status,message}],next_cursor}`.
As of cut 5, `status` is the closed enum `submitted | in_process | closed`:
`closed` while currently discarded, otherwise `submitted` in the deterministic
semantic `new` stage and `in_process` in every other progression stage.
`message` is **always present**: the recruiter's optional candidate-facing message
while closed, otherwise null (also null if discarded without a message). It is plain
text, not HTML. Recovery removes it from the candidate view; retained internal
history is recruiter-only. The internal reason and comment are never selected or
exposed to candidates. Renaming columns does not affect status; recovering or moving
back to `new` returns it to `submitted`. No stage identity, name or history is exposed.
The original apply/replay response remains `status: "submitted"`, even after moves.
Newest first, ID descending as tie-breaker. Only the candidate's new participations;
legacy applications stay on their legacy endpoint. Internal stages are never exposed.
`limit` defaults to 20, range 1–50; only canonical decimal values. Unknown/repeated
parameters, invalid encoding and malformed/noncanonical opaque cursors are 400.
`next_cursor` is null when no following page exists.

Cut-4 status coverage: `TestCandidateStatusHidesStage` (unit) and
`TestMovementBoardMovesHistoryCoverageAndRetention` (database; forward and backward
status changes). Cut-5 tests `TestDiscardRecoveryEachStageAndCoverage` and
`TestDiscardRecoveryExactWireAndCandidatePrivacy` protect closed/message visibility,
nulls after recovery and absence of internal reason/comment. See
[pipeline-movement.md](pipeline-movement.md) and [pipeline-discard.md](pipeline-discard.md).

## §10.5 test map and evidence boundary

| Tests | Contract rules |
| --- | --- |
| `TestBuildScreeningPrivacyRevisionAndNullOptions` | safe questions, open null options, stable/changing revision, empty array |
| `TestPublicScreeningHTTPExactShape`, `TestP2bScreeningIsPublic` | exact public envelope/limits, missing 404, no private headers |
| `TestDecodeApplyStrictAndCanonical`, `TestValidateAnswers`, `TestSingleChoiceAnswerAndCanonicalOrder` | strict shape, trimming, unknown/duplicate question IDs, all four detail reasons; valid single-choice answer and order-independent canonical fingerprint |
| `TestFingerprintDoesNotReplayDifferentAnswerShape` | different answer shape never replays as the original payload |
| `TestApplyTransport` | exact 201 keys/replay headers, key validation, all application codes, details-only invalid_answers and ordered country-error data |
| `TestStrictListQuery`, `TestCandidateListHTTPStrictQueryAndShape` | strict limits, unknown/duplicate parameters, cursor round-trip/rejection, exact list/item envelopes |
| `TestApplicationErrorExtension`, `TestOnlyInvalidAnswersHasDetails` | additive error statuses; only invalid_answers carries details |
| `TestParticipationRulesReusePublishedContracts` | production composition reuses safe questions and deterministic default stage identities |
| `TestP2bPrivateRoutesLiveCandidateGates` | every method's 401/403/live candidate gate and no-store |
| `TestParticipationAtomicReplaySnapshotAndCVRetention` (integration) | rejected writes unchanged; replay/conflict; foreign CV; initial deterministic stage; immutable question and answer snapshots after questionnaire edits; CV retention; own-only list |
| `TestConcurrentAppliesCreateOneParticipation` (integration) | concurrent same-candidate applies produce one participation |
| `TestParticipationAuditFailureRollsBackAllEffects` (integration) | injected audit failure rolls back participation/history/idempotency and leaves files/legacy untouched |
| `TestCandidateListPagingAndVacancyScopedKeys` (integration) | stable newest-first pages; same key in a different vacancy is independent |
| `TestScreeningAndApplyHideLegacyUnpublishedAndInactive` (integration) | public source lookup and apply hide legacy/unpublished/unknown/inactive/deleted-company vacancies with no writes |
| `TestParticipationCanonicalAnswerOrderReplays` (integration) | same key and answers in different order replay the exact original response, with one set of effects |
| `TestCVRemovalVersusApplyCandidateLock` (integration) | force both candidate-lock orderings; apply retains its version or receives cv_unavailable after removal |
| `TestMigration00022ParticipationDownRefusesDataAndSucceedsEmpty` (integration) | down refuses participation/history or idempotency-only data transactionally; empty down succeeds |
| `TestProcessParticipationMigration` | additive table/uniqueness/version-reference definitions, legacy table untouched |
| G4 country/snapshot/migration tests | See [G4 test map](geo-apply.md) for gate order, no writes, frozen replay, strict 00033 CHECK and expanded board/detail privacy |

Run integration tests only against an existing, isolated loopback database named
`draft_test`, configured by `DRAFT_TEST_DATABASE_URL`. Missing variable explicitly
skips them; compilation is not transactional or concurrency execution evidence.
The parent owns isolated execution, review and all migration commits.
