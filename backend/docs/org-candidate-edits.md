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
studies, catalog languages, geo location. Manual records keep the intake rule that
email or phone is required. Contact fields = `full_name`, `email`, `phone`.

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
etag; reload), `400 validation_error {fields:[{field,code}]}` with paths as in manual
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
- List items show effective values; filters and `q` match effective values.
- Organic `professional_title`/`current_company` are no longer always null: they are
  the correction, if any.

## History

`GET /v2/me/company/candidates/{kind}/{id}/history` → most recent first:

```json
{"items":[
  {"id":"…","at":"…","actor":{"id":"…","name":"…"|null},"kind":"edit",
   "changes":[
     {"field":"phone","contact":true},
     {"field":"years_of_experience","from":"2","to":"4"},
     {"field":"seniority","reset":true,"from":"senior","to":"junior"}]},
  {"id":"…","at":"…","actor":{…},"kind":"cv_corrected",
   "participation_id":"…","file_name":"cv-corregido.pdf"}]}
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

## Open point for the user

Corrections apply to the pool (list, detail, filters). The **vacancy board** (sheet,
board profile, CV download) keeps showing the participation snapshot and original CV in
this unit. Recommendation: make the board read corrections in a follow-up cut, so a
corrected CV/profile is what the recruiter sees everywhere.

## Delivery cuts (backend)

- E1: manual edits + history + etag.
- E2: organic correction layer (`set`/`reset`, `original`, effective list/filters).
- E3: corrected CV per participation.
