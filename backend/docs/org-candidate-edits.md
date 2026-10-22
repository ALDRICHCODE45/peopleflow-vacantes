# Org candidate edits — audited internal corrections (DRAFT)

Status: **contract approved; E1–E3 accepted; E4 implemented pending parent DB acceptance**.
E4 validation and review remain open. Extends
[org-candidates.md](org-candidates.md) (SRCH-4, AUD-1). Feature document:
`odd/tasks/org-candidate-edits.md`.

## Decisions (user)

- Every candidate in the pool is editable, manual and organic, with the **same fields**.
- Manual: the edit rewrites the company record.
- Organic: the edit is a **company-only correction layer** over the frozen data; the
  candidate's own profile, account and snapshots are never written. The original stays
  visible next to the corrected value.
- Any recruiter of the company may edit (same access as the pool).
- History: contact changes show who/when/which field only; every other field shows
  previous → new.
- A recruiter may attach a corrected CV to a participation; the candidate's original CV
  is kept and stays downloadable.

## Editable fields

`full_name`, `email`, `phone`, `location`, `professional_title`, `current_company`,
`seniority`, `years_of_experience`, `education`, `languages`, `skills`,
`linkedin_url`, `portfolio_url`. Same shapes and validation as manual intake
([manual-intake.md](manual-intake.md)): E.164 phone, decimal-string years, the six-key
studies, catalog languages, geo location. The **effective** contact must keep at least
email or phone, for both kinds (intake rule): otherwise
`400 validation_error {fields:[{field:"contact",code:"required"}]}`. Contact fields =
`full_name`, `email`, `phone`.

## Write

`PATCH /v2/me/company/candidates/{kind}/{id}` with `If-Match: <etag>` (required).

```json
{"set":{"professional_title":"Desarrolladora Frontend Senior","years_of_experience":"4"},
 "reset":["seniority"]}
```

- `set`: fields to change, each the full new value (arrays replace, never merge).
  `null` means «empty» (for organic: corrected to no value).
- `reset` (organic only): drop the correction so the original shows again. Resetting
  an uncorrected field is `400 invalid_request` (the entire request is rejected).
  On manual, `reset` is `400 invalid_request`.
- A field cannot appear in both. At least one change.
- 200 → the full detail (same shape as GET detail) with the new `etag` header and body
  field. Unchanged values are a no-op (no history entry, etag unchanged).

Errors: `428 precondition_required` (no If-Match), `412 precondition_failed` (stale
etag; body is only `{error, code}` — the client reloads with GET detail), `400 validation_error {fields:[{field,code}]}` with paths as in manual
intake but without the `candidate.` prefix (`education[0].status`, `phone`…),
`404` (unknown/other company), auth gates as the pool.

## Read changes (additive to the detail and list)

Detail gains:

```json
{"etag":"\"…\"",
 "updated_at":"…"|null, "updated_by":{"id":"…","name":"…"|null}|null,
 "corrected_fields":["professional_title","years_of_experience"],
 "original":{"full_name":"…","contact":{"email":"…","phone":"…"|null},
             "professional_title":null,"current_company":null,"profile":{…six keys…},
             "linkedin_url":null,"portfolio_url":null}|null}
```

- All existing top-level values become the **effective** values (correction applied).
- `original` (organic only; null for manual) = the uncorrected values: account name/email,
  profile phone, the latest-participation snapshot. `corrected_fields` lists organic
  fields with a correction; always `[]` for manual.
- New top-level `skills`, `linkedin_url`, `portfolio_url` are added to the detail
  (the six-key `profile.skills` stays as is).
- New top-level `education`: the full study list (six-key studies, as in manual
  intake) or null. Manual → the stored list. Organic → the corrected list when
  `education` is corrected, otherwise **null**: the organic snapshot keeps only the
  summary `profile.education {highest_completed, in_progress}`, never the list.
  `original.education` is therefore always null; the original summary is
  `original.profile.education`. Editing an uncorrected organic candidate's studies
  starts from an empty list (show the original summary as reference); once set, the
  corrected list drives the effective `profile.education` summary.
- `languages` and `location` are already complete in `profile` (effective) and
  `original.profile` (organic); no extra keys.
- List items show effective values; filters and `q` match effective values.
- Organic `professional_title`/`current_company` are no longer always null: they are
  the correction, if any.

## History

`GET /v2/me/company/candidates/{kind}/{id}/history?limit=20&cursor=…` → most recent
first, `limit` 1–50 (default 20), opaque `next_cursor` (null at the end), same cursor
rules as the list:

```json
{"items":[
  {"id":"…","at":"…","actor":{"id":"…","name":"…"|null},"kind":"edit",
   "changes":[
     {"field":"phone","contact":true},
     {"field":"years_of_experience","from":"2","to":"4"},
     {"field":"seniority","reset":true,"from":"senior","to":"junior"}]},
  {"id":"…","at":"…","actor":{…},"kind":"cv_corrected",
   "participation_id":"…","file_name":"cv-corregido.pdf"}],
 "next_cursor":"…"|null}
```

- Contact changes never store or return values (`contact:true`).
- Non-contact `from`/`to` use the field's API shape (arrays/objects for studies,
  languages, location; `null` for empty). For a reset, `to` is the original value.
- Stored in a company-private history table, not in the shared `audit_events`
  metadata (which stays PII-free); an `audit_events` row per edit records only
  actor/entity/fields.

## Corrected CV

`POST /v2/me/company/candidates/{kind}/{id}/participations/{participationId}/cv`
(multipart `cv`, same types/size/errors as manual intake) with `If-Match` of the
candidate etag.

- The participation's **current** CV becomes the corrected one; the original stays.
- Detail participation `cv` (current) gains `"source":"candidate"|"company"`, and a new
  `original_cv` `{file_name, uploaded_at}|null` (null when never corrected).
- `GET …/participations/{participationId}/cv` returns the current CV;
  `GET …/participations/{participationId}/cv/original` returns the candidate's original.
- Uploading again replaces the corrected CV (history keeps each upload).

## Vacancy board (E4)

User decision: «Sí, en esta unidad (recomendado)» — the board reads corrections too.
Board routes keep their owner-or-principal authorization.

- Board items (`GET …/job-drafts/{id}/board`) and the participation detail: `candidate.full_name`
  and the six-key `profile` become the effective values; each gains `corrected_fields`
  (same keys as the pool detail; `[]` when none).
- Participation detail also gains `original` (same shape as the pool detail's
  `original`, null when nothing is corrected) and its `contact` becomes effective.
- Participation `cv` (current) gains `source`; new `original_cv` `{file_name,
  uploaded_at}|null`; `GET …/participations/{participationId}/cv` returns the current
  CV and `GET …/participations/{participationId}/cv/original` the candidate's original.
- Snapshots stay frozen in storage: corrections are applied at read time only.
- `original` uses this participation's frozen profile (the same shape as the pool
  original, which uses the latest company participation). It is null for manual
  candidates and organic candidates without corrected fields, including CV-only edits.
- Original CV download follows E3 exactly: it works **before** any correction;
  404 means no original metadata/file reference, not «never corrected».
- Mutation items keep their existing privacy allowlist: effective name/current CV
  and additive `corrected_fields`/`cv.source`, never contact, original, profile or
  screening filter data. Manual 201 retains the full effective board item;
  idempotent replays remain frozen.

## Delivery cuts (backend)

- E1: manual edits + history + etag.
- E2: organic correction layer (`set`/`reset`, `original`, effective list/filters).
- E3: corrected CV per participation.
- E4: vacancy board reads corrections (profile, contact, CV).

## E4 implementation notes

No new migration: apply through **00046**. Board item SQL overlays corrections
using the participation process's company and organic identity (not intake source).
The pool and board share the E2 profile/education SQL and E3 CV expressions in
`applications/infrastructure/postgres/candidateview`; contact correction also
shares a pointer-independent projector. Manual records remain live.

- Board/detail, move/discard/recover/substate and manual 201 all use the same item
  projector. Movement responses keep the pre-existing private-field exclusions.
- Detail reads effective and participation-local original values in one repeatable
  snapshot; mutation transaction isolation/authorization/locks are unchanged.
- Current CV item metadata identifies the corrected object, if present. Only detail
  gains `original_cv`; its two-key shape is shared with the pool. Downloads keep
  MIME, length, nosniff and no-store behavior. Corrected-current board filenames
  retain an existing `.pdf`/`.docx` suffix case-insensitively. Non-corrected and
  original board downloads deliberately retain legacy extension appending, even
  for already-suffixed names; no filename or stored metadata is rewritten.
- Owner-or-principal checks run before CV lookup/storage, for both downloads.
  No snapshots, candidate accounts/profiles or original CV references are written.

### E4 validation boundary

Observed RED: 10 HTTP subtests (five missing additive-wire checks and five missing
original-route/no-store checks). GREEN: all 10; full unit suite, both vet modes and
archguard. Contact tests exercise set/null/unchanged pointer independence; a golden
pins uncorrected item bytes after stripping only the two additive E4 keys. Existing
exact-wire expectations change only for additive keys/new route. No new logging,
dependencies or generated schema changes.

**Parent DB round 1:** the v2 board/movement/filter-data suite passed. The new
HTTP flow assertions passed up to fixture cleanup, which failed on retained stage
history; leftover rows then caused unique-email failures in later suites. This is
not E4 DB acceptance. Fixture cleanup now removes private edit/CV history, audit,
stage history, idempotency and process counters before participations, then CV
objects/library/versions and candidates. Shared manual/organic seed emails include
the fixture UUID. CV cleanup is registered before setup writes, including partial
construction failures. Existing dirty rows are not removed by these changes;
parent-owned cleanup of the isolated harness is required before rerunning.

**DB tests are authored/vetted, not executed by the writer.**
`TestBoardCorrectionsFlow` covers manual and organic profiles/contact/studies,
set/null/reset, company isolation (byte-identical uncorrected and foreign boards),
frozen snapshots, participation-local originals, owner/principal privacy,
current/original CV bytes/headers, all four mutation responses and corrected
manual/organic reuse 201/GET byte equality. `TestBoardCorrectionsCVOnly` pins
`corrected_fields:[]`, `original:null` and preserved original downloads for CV-only
edits of both kinds.

Parent runs sequentially from `backend/`, injecting guarded
`DRAFT_TEST_DATABASE_URL` for isolated `draft_test` externally; never source or
print `.env`. Existing board/movement/filter-data suites are included:

```sh
go test -tags=integration ./cmd/api -run '^TestBoardCorrections(Flow|CVOnly)$' -count=1 -v
go test -tags=integration ./internal/features/applications/infrastructure/postgres/v2 -run '^Test(Movement|Manual|FilterData|GeoSnapshot|DetailContact|Discard|Substate|LifecycleBoard)' -count=1 -v
go test -tags=integration ./cmd/api -run '^Test(OrgCandidate(Edits|Corrections|CV)(Flow|Rejections|AtomicRollback|ConcurrentIfMatch)$|OrgCandidatesFlow$|ManualCreateHTTPFlow$|DraftFlow_|DraftListFlow_)' -count=1 -v
```

Do not run shared-DB packages concurrently with each other or migration rollback
suites. Compilation and unit fakes are not SQL acceptance; T6 awaits parent results.
For repeated-run cleanup evidence, rerun the first command with `-count=2` after
the three acceptance commands succeed.

## E1 implementation notes

Implemented for **manual** candidates; parent DB acceptance is still required.
Migration **00044** must be applied before using these reads/writes.

- **Historical E1 restriction (removed by E2 below):** organic PATCH initially
  returned `400 invalid_request` and organic history was empty. Unknown/foreign
  organic identities remain 404. E3 corrected CVs and E4 board projections are
  not implemented by these cuts.
- Detail adds all read fields above, including full manual `education` in stored
  position order (each study has exactly six keys). Organic `education` and
  `original.education` remain null. Manual `original` is null and
  `corrected_fields` is always `[]`. Existing profile and participation keys stay.
- Manual ETags are strong, candidate/version-specific tokens. Missing If-Match
  is 428; a stale/weak/wildcard/list token is 412 with only `{error,code}`.
  GET and successful PATCH return the same ETag in header and body.
- The candidate row is locked before version comparison, parsing and validation.
  Manual-intake validators are reused; paths omit `candidate.` and the edit's
  `location` corresponds to intake's `residence`. Unchanged legacy fields need
  not be repaired to edit another field. Required name/location/studies cannot
  clear to null; optional null values clear and null skills/languages become `[]`.
- Language order normalizes by code before no-op detection. Arrays replace.
  No-op PATCH does not advance provenance/version or append history/audit.
- The live record, child arrays, private history and PII-free audit event commit
  in one transaction. PATCH builds its detail inside that transaction, avoiding
  a racing post-commit reload. Contact history contains field names plus
  `contact:true`, never values; other changes use edit-value shapes (location
  codes, full studies, decimal-string years). Audit metadata contains only the
  changed field names; actor/entity IDs are audit columns.
- Existing rows backfill version 1 and creation provenance deterministically.
  Never-edited new rows project creation provenance when update columns are null.
  Down locks both tables and refuses retained history or advanced provenance/version.
- History is ordered by `at DESC,id DESC`; its strict versioned base64url cursor
  binds company/kind/candidate, uses microsecond UTC positions, and is bounded
  to 4096 encoded bytes. Limit is not bound, allowing page-size changes.

### E1 validation boundary

- `org_candidate_edits_{routes,validation,history_routes}_test.go`: real router,
  gates/no-store, 44 invalid-body/field cases, contact invariant, no-op and null
  clears, contact-redacted history, limits/defaults, strict cursor mutations.
- `TestOrgCandidateEditsFlow`: all 13 fields through real HTTP/SQL, six-key
  studies/order, live list/filter reads, replacements, no-op, rejection rollback,
  privacy, history pagination/ties, company isolation and nullable actor names.
- `TestOrgCandidateEditsAtomicRollback`: fixture-specific PostgreSQL constraint
  failures at history and audit writes must roll back record and child arrays.
- `TestOrgCandidateEditsConcurrentIfMatch`: holds the row externally, observes
  both database waiters before release, then requires exactly one 200 and one 412.
- `TestOrgCandidateEditsBackfillAndGuardedDown`: isolated migration database;
  deterministic backfill/index, atomic guarded Down and safe Down/Up round trip.

Observed RED: five absent-route/no-store HTTP subtests, one missing migration
check, one language-order no-op and one noncanonical base64 cursor rejection.
Focused tests, full `go test ./... -count=1`, both vet modes and archguard pass.
The initial full-suite SQLc drift failure was resolved by `make sqlc` (the new
schema changes generated models even without changes to query files).
No new log calls or dependencies. **DB tests have not been executed by the
implementation writer**; compilation/vet are not SQL/concurrency acceptance.

Parent runs from `backend/`, with guarded `DRAFT_TEST_DATABASE_URL` injected
externally (do not source or print `.env`):

```sh
go test -tags=integration ./cmd/api -run '^TestOrgCandidateEdits(Flow|AtomicRollback|ConcurrentIfMatch)$' -count=1 -v
go test -tags=integration ./db/migrations -run '^TestOrgCandidateEditsBackfillAndGuardedDown$' -count=1 -v
go test -tags=integration ./cmd/api -run '^Test(OrgCandidatesFlow$|ManualCreateHTTPFlow$|DraftFlow_|DraftListFlow_)' -count=1 -v
```

Migration tests create their own loopback `draft_test_mig_*` database and require
CREATEDB. All fixtures clean up only their own rows/catalog additions.

## E3 implementation notes

Apply migration **00046** before these pool reads/writes. The nullable
`process_participations.corrected_company_cv_id` is an additive company-owned
reference: neither original CV reference is overwritten. Old corrected objects
remain stored, and each upload keeps a private `cv_corrected` history entry.
The guarded Down refuses corrected references or CV history, preserving ordinary
edit history through a clean Down/Up round trip.

- POST accepts exactly one multipart `cv`, using intake's in-memory 5,242,880-byte
  file and 64 KiB envelope budgets. The **same composition-root inspector and
  storage ports** as manual intake enforce PDF/DOCX content sniffing and storage
  policy. Missing CV uses `validation_error` (`cv` / `required`); malformed,
  unknown or repeated parts use `invalid_request`. Inspection errors have no
  fields: 400 `cv_content_mismatch`, 415 `cv_unsupported_type`, 413 `cv_too_large`;
  disabled storage is 503 `cv_storage_unavailable`.
- Candidate/company/participation membership is checked before private storage.
  Missing If-Match is 428; the exact strong token is compared under the **same
  manual candidate / organic correction lock and version** as profile edits.
  Uploads serialize with profile edits and each other, including first organic
  writes. Successful POST returns 200, full pool detail and matching header/body
  ETag. Every upload advances provenance/version, even for repeated bytes.
- The object is stored before the CV reference/version/history/audit co-write.
  Storage shares reconciliation advisory lock `75210410021`. Definite pre-commit
  failures compensate the new object, joining cleanup failures with the cause;
  uncertain Commit failures retain it for reconciliation, as manual intake does.
- Detail's current `cv` has `source:"candidate"` without a correction (including
  company-owned manual-intake originals), or `source:"company"` with one.
  `original_cv` is a separate two-key value, null when never corrected or when
  original metadata is absent. Current/original downloads retain MIME, length,
  nosniff and no-store headers. Pool attachment filenames now append the MIME
  extension only if it is absent (case-insensitive), so `cv` becomes `cv.pdf`
  and `corrected.PDF` stays `corrected.PDF`, never `.pdf.pdf`. This applies to
  both current and original pool downloads. Original download works even before
  a correction and is 404 when no original is available.
- CV history uses the existing company-bound pagination and omits `changes`;
  it contains `participation_id`, `file_name`, `at` and `actor`. Shared
  `CompanyCandidateCVCorrected` audit metadata contains only participation ID,
  never filenames or CV content. Candidate CV library/version rows and original
  company CV objects remain untouched. **Board routes/shapes are unchanged.**

### E3 validation boundary

QA filename regression: observed RED in 16 of 36 HTTP filename cases; all 36
now pass, covering pool/board current/original, PDF/DOCX, suffix case and plain
names. Board original/non-corrected filename bytes remain pinned to the legacy
rule. DB flow attachment expectations now reflect the corrected naming policy.

Observed RED: five absent-route/no-store HTTP checks and missing migration
00046. GREEN: those six checks; manual/organic HTTP validation/composition,
PDF/DOCX, gates, 428/412/404/503, current/original headers; focused pool regression,
full unit suite, both vet modes, sqlc regeneration and archguard. Initial full
suite exposed expected route-topology, formatting and generated-model drift;
these were fixed without changing board registrations. No new log calls or
dependencies.

**DB tests are authored and vetted, not executed by the writer.** They cover
real HTTP uploads/re-uploads, exact detail/history/pagination, current/original
bytes/headers, unchanged originals/library/snapshots, company isolation, rejected
uploads without side effects, rollback at CV/history/audit writes with file
compensation, and deterministic first/existing manual/organic If-Match contention.
Migration tests cover default/backfilled values, history CHECKs, both retention
guards, and safe Down/Up preserving ordinary history and original CV references.

Parent runs from `backend/`, injecting guarded `DRAFT_TEST_DATABASE_URL` for
isolated `draft_test` externally; never source or print `.env`:

```sh
go test -tags=integration ./cmd/api -run '^TestOrgCandidateCV(Flow|Rejections|AtomicRollback|ConcurrentIfMatch)$' -count=1 -v
go test -tags=integration ./cmd/api -run '^TestOrgCandidateCVConcurrentIfMatch$' -count=4 -v
go test -tags=integration ./db/migrations -run '^TestOrgCandidateCVGuardedDown$' -count=1 -v
go test -tags=integration ./db/migrations -run '^TestOrgCandidate(EditsBackfillAndGuardedDown|CorrectionsGuardedDown)$' -count=1 -v
go test -tags=integration ./cmd/api -run '^Test(OrgCandidateEdits(Flow|AtomicRollback|ConcurrentIfMatch)$|OrgCandidateCorrections(Flow|AtomicRollback|ConcurrentIfMatch)$|OrgCandidatesFlow$|ManualCreateHTTPFlow$|DraftFlow_|DraftListFlow_)' -count=1 -v
```

Migration tests require CREATEDB and create isolated loopback `draft_test_mig_*`
databases. Compilation/vet are not database acceptance; T4 awaits parent results.

## E2 implementation notes

Apply migration **00045** before these pool reads/writes. It adds one correction
object and version per `(company_id,user_id)`; it does not alter candidate-owned
storage. Down refuses retained corrections, advanced versions/provenance or any
organic history, including after all corrections have been reset.

- Organic PATCH now uses the same intake validators as manual edits. Optional
  nulls are explicit empty corrections (null skills/languages normalize to `[]`);
  required name/location/studies still cannot be cleared. Arrays replace.
- `reset` removes an existing correction, even if its current effective value
  equals the original. It rejects unknown, duplicate, overlapping or uncorrected
  fields atomically. Effective contact validation also runs for reset-only requests.
- Organic ETags bind company, user and correction version. First edits serialize
  through the composite unique key, then all writes compare If-Match under a row
  lock. No-op writes leave version/provenance/history/audit unchanged. Successful
  writes, private history and field-name-only audit commit in one transaction.
- The shared pool SQL overlays corrections **before** filtering/count/pagination.
  Name/email search, all profile filters, and list/detail values are effective.
  Original detail uses the same catalog hydration over the uncorrected snapshot.
  Corrected studies remain a full list; completed/in-progress maxima drive the
  effective summary. Reset restores the snapshot summary and null full list.
- Reset history adds `reset:true`; contact resets contain only field/contact/reset,
  never values. Other resets use the original edit-value shape as `to`.
- No candidate account, profile, education/language row, participation, snapshot,
  CV or board projection is written. No new logging calls or dependencies.

### E2 validation boundary

Observed RED: organic HTTP dispatch still returned the E1 temporary 400; migration
00045 was absent; a whitespace-formatted empty `set` with a valid reset incorrectly
returned 400. All three now pass. HTTP tests also exercise intake-validation parity,
contact/reset invariants, null clears, no-ops, language ordering, redacted history,
428/412/404 and auth/no-store gates.

Integration tests are **authored and vetted, not executed by the writer**:

- `TestOrgCandidateCorrectionsFlow`: all fields, exact effective/original/history
  shapes, education ranking, every filter/search, isolation of the same user in
  another company, and byte-identical candidate-owned rows/snapshots after edits.
- `TestOrgCandidateCorrectionsAtomicRollback`: fail history/audit co-writes;
  correction writes and first-write row creation must roll back too.
- `TestOrgCandidateCorrectionsConcurrentIfMatch`: observe both lock waiters before
  release, for both first and existing corrections; require one 200 and one 412.
- `TestOrgCandidateCorrectionsGuardedDown`: default/composite identity, retention
  guards for corrections/version/provenance/history and safe Down/Up round trip.

Parent runs from `backend/` on isolated `draft_test`, injecting the guarded
`DRAFT_TEST_DATABASE_URL` externally (never source or print `.env`):

```sh
go test -tags=integration ./cmd/api -run '^TestOrgCandidateCorrections(Flow|AtomicRollback|ConcurrentIfMatch)$' -count=1 -v
go test -tags=integration ./db/migrations -run '^TestOrgCandidateCorrectionsGuardedDown$' -count=1 -v
go test -tags=integration ./cmd/api -run '^Test(OrgCandidateEdits(Flow|AtomicRollback|ConcurrentIfMatch)$|OrgCandidatesFlow$|ManualCreateHTTPFlow$|DraftFlow_|DraftListFlow_)' -count=1 -v
```

Migration acceptance needs CREATEDB. Compilation/vet and unit fakes are not SQL,
rollback or concurrency acceptance; T3 stays open until the parent records it.
