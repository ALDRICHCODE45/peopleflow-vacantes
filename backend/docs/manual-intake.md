# Recruiter manual intake contract

Status: implementation complete (B1–B3b-4). Both routes are registered with
company/recruiter authorization. The create handler reuses the bounded multipart
parser and transactional store; `cmd/api` composes the real `cvs.Inspect` policy
and private local storage. Integration-tag store and real-router coverage require
parent-run validation against the isolated database; unit results do not prove
that database execution.

## Routes and privacy

Base: `/v2/me/company/job-drafts/{id}/pipeline/candidates/manual`.
Both POST routes use the same company/recruiter authorization as board writes.
All responses use `Cache-Control: no-store`.

`POST …/duplicates-check` requires exactly `email` and `phone`, each string or
null. Missing, unknown, or repeated keys, non-object roots, wrong value types,
and trailing JSON produce 400 `invalid_request`. The body limit is 1 MiB
(413 `payload_too_large` above it). Both contacts null produces 400
`validation_error`, field `contact`, code `required`; invalid supplied contact
uses field `email` or `phone`, code `invalid`.

```json
{"email":"ana@example.com","phone":null}
```

The response is `{"matches":[]}` when there are no matches. Otherwise:

```json
{"matches":[{"kind":"manual","id":"10000000-0000-0000-0000-000000000001","full_name":"Ana Pérez","email_masked":"a***@example.com","phone_masked":null,"last_vacancy":{"id":"10000000-0000-0000-0000-000000000002","title":"Analista"},"last_added_at":"2026-10-21T12:00:00Z","in_this_process":false}]}
```

Match normalized email (trimmed and lowercased) OR exact E.164 phone. Scope is
strictly the current company's manual records and organic users with a past or
present participation in that company's processes, including finished/discarded
participations. Never query global candidates to reveal matches. Order by
`last_added_at DESC`, then id. Mask email as `a***@dominio.com`; phone reveals only
its country prefix and last four digits, e.g. `+52 •••• ••12 34`.
`last_vacancy` is the most recent participation of that identity in the company;
its title is the published (public projection) title.

## Create request

`POST …/manual` requires a UUID `Idempotency-Key` and multipart parts `data` (JSON)
and `cv` (file). Stream with a 5,242,880-byte CV limit plus a 64 KiB envelope
allowance. Unknown or repeated parts produce 400 `invalid_request`.
Missing Idempotency-Key produces 400 `idempotency_key_required`; malformed or
multiple keys produce 400 `invalid_idempotency_key`. Missing CV produces 400
`validation_error` with `cv` / `required`.

Example (use a real eligible stage and valid residence; retain the same key for
retries, with unchanged JSON and CV bytes):

```sh
curl -i -X POST "$API/v2/me/company/job-drafts/$DRAFT_ID/pipeline/candidates/manual" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $INTAKE_KEY" \
  --form-string "data={\"stage_id\":\"$STAGE_ID\",\"existing\":null,\"confirmed_distinct\":false,\"candidate\":{\"full_name\":\"Ana Pérez\",\"education_level\":\"bachelor\",\"email\":\"ana@example.com\",\"phone\":null,\"residence\":{\"country\":\"US\"}}}" \
  -F 'cv=@./resume.pdf'
```

CV failures have no `fields`: 400 `cv_content_mismatch`, 415
`cv_unsupported_type`, 413 `cv_too_large`, 503 `cv_storage_unavailable`.
Missing/foreign resources and identity failures follow board writes (404/401/403).
No response, including authentication or parsing failures, is cacheable.

The JSON object must contain exactly these four keys, each once:

```json
{"stage_id":"10000000-0000-0000-0000-000000000003","existing":null,"confirmed_distinct":false,"candidate":{"full_name":"Ana Pérez","education_level":"bachelor","email":"ana@example.com","phone":null,"residence":{"country":"MX","state":"14","municipality":"14039","postal_code":null}}}
```

Residence identifiers must be valid catalog values; the example illustrates the
shape rather than substituting for geo catalog validation. Reuse instead sends
`existing:{"kind":"manual"|"organic","id":"UUID"}` and `candidate:null`.
Without existing, candidate is required. The server never merges automatically.

### Stage selection (S4, S9)

The client sends an explicit UUID and selects the first eligible stage by default.
The server never resolves a default stage.

| Input | Response |
| --- | --- |
| Missing `stage_id` (or another of the four keys) | 400 `invalid_request` |
| `stage_id:null` | 400 `validation_error`, `stage_id` / `required` |
| Empty string, non-UUID string, or non-string | 400 `validation_error`, `stage_id` / `invalid` |
| UUID absent from the current pipeline | `stage_id` / `invalid` |
| Placement or exit stage | `stage_id` / `not_allowed` |

All validation field entries use `{"field":"path","code":"code"}` in a
 top-level `fields` array. Supported codes are `required`, `invalid`, `too_long`,
`not_allowed`, and `duplicate`. Collect all field errors before state/stage checks.

### Candidate fields (S5)

Required: full name (identity rules, valid UTF-8, 2–120 runes), education
(`high_school`, `bachelor`, `master`, `phd`), at least one email/phone, residence,
and CV. Email uses the shared email value object and separate normalized value.
Phone is E.164: +52 followed by exactly ten digits; non-MX bounds follow the
shared phone value object (`+` then 8–15 digits, E.164; `+52` requires exactly ten national digits), matching the `company_candidates` CHECK.

Use the geo validator with `Required`, `RequireState`, `RequireMunicipality`, and
`AllowPostalCode` enabled: MX requires state and municipality, with optional
coherent five-digit CP; other countries prohibit subdivisions.

Optional profile fields: professional_title, current_company, field_of_study
(short text ≤120), experience_years (integer 0–60), summary (≤2000), skills
(≤30 entries, each ≤60), languages (≤10 entries, CEFR A1–C2), linkedin_url and
portfolio_url (HTTPS, ≤2048). Intake-local education, CEFR, and skills rules match
the candidate profile vocabulary without crossing the candidate domain boundary:
education trims/lowercases, CEFR is exact, and accepted skills trim/lowercase while
preserving order. Empty/duplicate skills remain intake field errors.
No birth date, salary, or CV/LinkedIn/OCC extraction belongs in this cut (S8).

## Ordering and effects

1. Authorize company/recruiter access at the router; validate the key and parse
   bounded multipart in memory (no disk writes).
2. Inside the store, reauthorize and resolve replay or fingerprint conflict.
3. Validate JSON shape.
4. Collect field validation errors (400 `validation_error`).
5. Check process state: never published → 409 `vacancy_not_published`; finished →
   409 `process_finished`, using existing lifecycle envelopes.
6. Check current stage eligibility.
7. Validate company-scoped existing identity and recheck duplicates.
8. Inspect CV with `cvs.Inspect`, returning the same codes as `/v2/me/cvs`, without fields.
9. Write private CV storage.
10. In one database transaction, create/reuse the identity, write the CV record,
    participation, intake history, delivery, audit, and idempotency response.

Duplicate warning: 409 `possible_duplicates`, `data:{"matches":[…]}`. Only an
explicit `confirmed_distinct:true` permits creating a separate matching record.
Already participating: 409 `candidate_already_in_process`,
`data:{"participation_id":"UUID"}`. An existing identity outside company scope
produces `validation_error`, field `existing`, code `invalid`.

Rejects must leave rows, files, audit and counters unchanged. Compensate a stored
file on definite pre-commit failures, including insert or audit errors, following
candidate CV upload behavior. Once Commit is attempted, its outcome may be
uncertain: retain the file even if Commit returns an error. Reconciliation keeps
files referenced by committed company_candidate_cvs rows and removes true orphans.
Cleanup failures are returned alongside the original error rather than hidden.

The transaction creates company_candidates and languages only for new identities.
CV ownership is always the company: company_candidate_cvs.company_id is required;
company_candidate_id is null when reusing an organic account. Such a CV must never
appear in that account's candidate CV library. Shared reconciliation retains all
files referenced by `company_candidate_cvs.storage_key`, including rows with null
`company_candidate_id`, under the existing exclusive advisory transaction lock.
Manual file-first writes must use the matching shared advisory lock.
Participation identity is XOR
candidate_id/company_candidate_id, source is manual, added_by is the recruiter,
version is 1, and profile snapshot comes from the selected record. Intake history
has the recruiter actor and null from-stage. Record delivery using the existing
move path when entering at or beyond the cutoff. Emit
`VacancyCandidateAddedManually` without PII metadata. No notification, account
creation, global-search entry, or candidate-panel entry is created (S4, S6, S7).

Success is 201: the full board item including profile/screening_answers, always
present source/added_by/candidate.kind, plus flattened coverage and delivery;
headers include ETag, no-store, and `Idempotency-Replayed:false` on initial
creation. Idempotency fingerprints include canonical
JSON and the CV bytes' SHA-256. A matching replay returns the original body and
ETag with `Idempotency-Replayed:true`; changed fingerprint returns 409
`idempotency_conflict`.

## Test-to-contract map

Implemented unit coverage:

- `TestManualRequestShapeAndStage`: four required keys, unknown/duplicate keys,
  trailing JSON, non-object roots, null/empty/malformed/non-string stage values,
  explicit UUID (L7, S4/S9).
- `TestManualStageEligibility`: active stage, Placement, exit, unknown stage
  (S4/S9).

B3a unit coverage: `TestDuplicateRequestShapeAndValidation`,
`TestDuplicateContactMasks`, `TestWriteValidationErrorFields`, and
`TestManualDuplicatesRoute` (including auth gates, no-store, budget, and fields).

B3a isolated integration coverage (integration tag; database execution by parent):
- `TestManualDuplicatesExactMatchesMasksOrderingAndScope`
- `TestManualDuplicatesLatestCompanyParticipationAndAbsentContacts`
- `TestManualDuplicatesReusedOrganicAndFinishedProcess`
- `TestManualDuplicatesAuthorizationAndErrorBodies`

B3b-1 helper coverage: `TestManualFingerprint`, `TestManualCandidateValidation`,
`TestManualValidationCollectsFieldsAndNormalizes`, `TestManualCandidateUnknownAndDuplicateKeys`,
`TestManualValidationCatalogFailure`, `TestManualProfileVocabularies`, and
`TestManualSkillsNormalizeAndPreserveOrder`.
Reconciliation unit coverage: `TestReconcileRetainsCompanyCVAndRemovesOrphan` and
`TestReconcileLookupFailureKeepsFiles`. The integration-tag
`TestReconcileRetainsCompanyOwnedManualCV` requires parent-run database execution.

B3b-2 transport-helper coverage (not endpoint coverage):
- `TestManualMultipartBoundary`: exactly one data and CV part, either order,
  missing-CV validation, duplicate/unknown parts, file-part shape, transfer
  encoding rejection, per-part and total request limits.
- `TestManualMultipartMalformedAndRawBudget`: malformed content type, missing
  boundary, truncated multipart, and invalid preamble.
- `TestManualMultipartEpilogueCountsAgainstBudget`: bytes after the final
  boundary cannot bypass the raw request budget.
- `TestManualMultipartPreservesUninspectedBytesAndNormalizesBasename`: preserves
  CV bytes for later ordered inspection and strips filename directories.

The parser never spools temporary files. The handler maps its transport-local
too-large error to `cv_too_large`. Architecture rules prohibit applications
infrastructure importing candidates/application/cvs directly; composition-root
injection reuses `cvs.Inspect` without changing archguard.

B3b-3 store coverage:
- `TestManualCreatedBodyUsesGETItem`: exact full GET item key order and values,
  including profile and empty screening answers, followed by coverage/delivery.
  Intake uses `ManualCreatedBody`, never the restricted `Moved.MarshalJSON` shape.
- `TestManualFileCompensation`: Put failure, definite pre-commit failure (Delete),
  success, and simulated uncertain Commit failure (retain file).
- `TestManualCreateFirstStageReplayAndConflict`: GET-shaped response, languages,
  history, audit, byte-equality with GET board plus coverage/delivery, exact
  replay, and changed-CV fingerprint conflict.
- `TestManualCreateAtDeliveryCutoff`: intake at and after the delivery cutoff.
- `TestManualCreateDuplicatesAndConfirmedDistinct`: warning without writes and
  explicitly distinct creation.
- `TestManualCreateExistingReuseAndAlreadyInProcess`: manual and organic reuse,
  company-owned CVs, unchanged organic CV library, and existing participation ID.
- `TestManualCreateRejectionsHaveNoEffects`: process state, stage, field, company
  scope, authorization, and all three inspector errors, with row/audit/replay
  invariants.
- `TestManualCreateValidationOrdering`: authorization before parsing, collected
  field errors before state, and state before stage checks.
- `TestManualCreateTransactionFailureDeletesFile`: audit failure rolls back rows
  and deletes the private file.

`CreateManual` accepts the four parsed inputs in `ManualInput`; its injected
`ManualCVInspector` maps candidate-inspector errors to the applications-owned
`ErrManualCVContentMismatch`, `ErrManualCVUnsupportedType`, and
`ErrManualCVTooLarge` sentinels. The composition adapter translates those
errors, and adapts context-aware local storage to `ManualFileStorage`'s context-free
Put/Delete methods (cleanup does not inherit request cancellation).
The operation returns frozen response bytes, ETag, and a replay flag; the HTTP
handler writes those bytes verbatim and owns status/header/error serialization.
Company-wide manual intake serialization prevents duplicate-check/create races
between vacancies. Replay keys are company/actor/operation scoped; fingerprints
also bind the target vacancy. Intake history beyond the cutoff counts toward
delivery; ordinary move/recovery counting retains exact-cutoff semantics.

B3b-4 endpoint and composition coverage:
- `TestManualCreateHandler`: every store error mapping, validation fields,
  conflict data envelopes, exact success bytes/ETag and false/true replay headers;
  no-store on successes and errors (L7).
- `TestManualCreateTransportErrors` and `TestManualCreateMultipartErrors`:
  missing/invalid/multiple keys, malformed multipart, missing CV and oversized
  uploads rejected before the store (S9).
- `TestManualCreateRouteGates` and `TestRouteTopology_ExactRegistrations`: route
  registration, recruiter/auth gates and no-store even on gate failures.
- `TestManualCVComposition`: real inspection/error translation, private disk
  round trip and compensation adapter, disabled storage (S5/S9).
- `TestManualIntakeCatalogAndData`: additive 409 catalog entries and restricted
  data serialization.
- `TestManualCreateHTTPFlow` (integration tag): real router/auth/store/Inspect
  with temporary private disk storage; 201 equals GET board item plus coverage
  and delivery (including cutoff counting); exact replay without side effects,
  duplicates then confirmed-distinct creation,
  validation fields, content mismatch without writes, and original uploaded
  bytes downloaded through the board participation CV route (S4–S7/S9).

Parent-run isolated database execution remains a release validation step. No
integration execution is implied by unit-test or integration-tag vet results.
