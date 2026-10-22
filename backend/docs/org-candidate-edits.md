# Org candidate edits — audited internal corrections (DRAFT)

Status: **draft for frontend review**, not implemented. Extends
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
- `reset` (organic only): drop the correction so the original shows again. On manual,
  `reset` is `400 invalid_request`.
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

## Delivery cuts (backend)

- E1: manual edits + history + etag.
- E2: organic correction layer (`set`/`reset`, `original`, effective list/filters).
- E3: corrected CV per participation.
- E4: vacancy board reads corrections (profile, contact, CV).

## E1 implementation notes

Implemented for **manual** candidates; parent DB acceptance is still required.
Migration **00044** must be applied before using these reads/writes.

- **Temporary E1 restriction:** PATCH for a company-visible `kind=organic`
  returns `400 invalid_request` (with If-Match supplied); its history is an empty
  page. Unknown/foreign organic identities remain 404. E2 will enable corrections.
  E3 corrected CVs and E4 board projections are not implemented by this cut.
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
