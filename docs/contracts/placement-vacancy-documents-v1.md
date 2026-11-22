# Placement and vacancy documents v1 (internal, employer-only)

Status: **Draft — pending frontend review** (2026-11-22). Nothing is implemented; nothing is agreed beyond the user decisions quoted in
§«Decisions». Product source: the 2 Oct 2026 agreement «Documentos de placement y de vacante».
Tracking: `odd/tasks/placement-vacancy-documents-backend.md` (branch `feat/placement-vacancy-documents-backend`). The backend session wrote
this contract; the frontend session reviews it before any implementation slice starts (T2). Style follows `replacement-processes-v1.md` and
`vacancy-team-v1.md`. Every `path:line` below is a backend path (under `backend/`) at the commit this draft was written against.
`S#` are the feature doc's specs (S1 candidate-process documents, S2 vacancy documents, S3 replacement linking, S4 after closure, S5 formats and
size, S6 delete, S7 storage); `D#` are this contract's decisions, numbered in reading order, so the frontend and the user can challenge each one.

## Purpose

A recruiting team needs to keep files next to the work: the contract of a vacancy, the signed offer or the ID scan of a hired candidate, the
spreadsheet the client sent. Today the only files in the system are candidate CVs (5 MB, PDF/DOCX, one library per candidate) and site images.
This contract adds **internal documents** at two scopes:

1. **Vacancy documents**: attached to a vacancy (the job draft id), from the moment the draft exists and for the whole life of the process,
   including closed and finished processes.
2. **Participation documents** (the «candidate process documents» of the business rules): attached to one candidate participation in one
   process, for participations that are in or went through **Placement**.

Both are private to the organization: never public attachments, never part of the candidate-managed profile, never visible to the candidate.
Replacing a document creates a **version**; deleting is audited and removes the file; a replacement process can **link** (not copy) documents of
the processes it replaces.

The system is not in production and all data is disposable (L2): the migration may be strict and the endpoints may change before the first
implementation slice.

## Backend facts this contract builds on

- **One id for draft and process.** `vacancy_processes.id` is `job_drafts.id` (`db/migrations/00019_create_vacancy_processes.sql:4`); a process row
  exists from the first publication on, a draft row from creation. A vacancy document therefore keys on `job_drafts.id` and works in `draft`
  state, where the board cannot (`board/store.go:55-73` `beginTx` needs the process row, answers `vacancy_not_published`).
- **The board's write path refuses finished processes**: `beginMutation` returns 409 `process_finished`
  (`internal/features/applications/infrastructure/postgres/board/store.go:77-100`). S4 says documents must be attachable after closure «without
  reopening the process or changing its metrics»: **document writes never use `beginMutation`/`beginTx`**, they use the draft authorization
  (below) and never touch `vacancy_processes`, lifecycle events, `lifecycle_version` or `job_drafts.version`.
- **Vacancy authorization** is `authorized(auth, …)` = company owner OR an active tramo on the draft's team
  (`internal/features/jobs/infrastructure/postgres/draftstore/store.go:466-468`), evaluated after `lockGates` (live user, active company,
  membership; `store.go:423`) and `readDraft` (`store.go:508`, scoped to the session company). A denied non-member is `drafts.ErrNotFound`; a
  member whose tramo ended gets `drafts.ErrTeamAccessEnded` → 404 `team_access_ended` (`draftAccessError`, `…/draftstore/team.go:19-32`).
  `readDraft(lock=true)` takes `job_drafts … FOR UPDATE` in its own statement, which already serializes with moves, team changes and lifecycle
  transitions (`pipeline.go:138-151`, `movement.go:13`). The draft must be a v2-schema draft (`requireV2ReadDocument`, `read_v2.go:62`: a v1 draft
  is `not_found`).
- **Stakeholders have no vacancy route today.** The route group of `/v2/me/company/job-drafts/*` uses `requireRecruiter`, whose ladder rule
  rejects the stakeholder role (`internal/features/identity/infrastructure/http/requireCompanyRole.go:60-70`); the only stakeholder gate is
  `RequireMetricsViewer` (owner + stakeholder only, `:78`). A read gate for **owner + recruiter + stakeholder** is new
  (`requireCompanyMember(users, members, liveness, allowed)`, `:89`).
- **Participations**: `process_participations` (`00022`, `00038`, `00024` `discarded_at`, `00063` `carried_from_participation_id`); the stage of a
  participation is `stage_id`, its **kind** comes from the process' pipeline configuration (`Pipeline.StageKind`, as in
  `board/discard.go:56`), `placement` being the hire stage. A hire records a `placement_credits` row (`00054`: `status active | did_not_hold |
  voided`, `participation_id`, `exit_reason`; `board/credits.go:19-77`).
- **Replacements** (`00063`, merged): `vacancy_replacements(process_id, source_process_id, root_process_id, sequence ≥ 1)`; the original process
  has no row and is position 0; a carried candidate is a new participation with `carried_from_participation_id` = the template participation
  (`docs/contracts/replacement-processes-v1.md` «Carried candidates»).
- **CV file machinery to reuse**: content inspection `Inspect` (`internal/features/candidates/application/cvs/content.go:32`, PDF magic `%PDF-`, OOXML
  by reading only the ZIP central directory: ≤ 1024 entries, marker parts non-empty, not encrypted, ≤ 8 MiB expanded, never decompressed) and
  `NormalizeName` (`content.go:65`: NFC, no control characters, whitespace collapsed, ≤ 120 runes); streaming multipart upload with `MaxBytesReader` at
  `MaxBytes + 64 KiB`, `NextRawPart`, rejection of `Content-Transfer-Encoding` and unknown parts
  (`internal/features/candidates/infrastructure/http/cvs/handler.go:57-149`); file-first/row-second with deferred delete
  (`internal/features/candidates/infrastructure/postgres/cvs/library.go:81-133`); download headers (`handler.go:240-265`,
  `httpjson.AttachmentFilename`, `internal/shared/httpjson/attachment.go:7`).
- **Audited download**: the board CV download commits its `ParticipationCVDownloaded` audit row **before** the stream starts, and records nothing
  when the file is missing or storage is down (`board/store.go:534-585`).
- **Storage today**: port `cvs.Storage` `Put([]byte) / Open / Delete / Keys` (`cvs/library.go:39-44`); local adapter with `os.Root` and 64-hex keys, `Put`
  capped at `cvs.MaxBytes` = 5 MB (`candidates/infrastructure/storage/local.go:44-60`); an S3 adapter only for site media, which **buffers the whole object
  on `Open`** and caps at 5 MiB (`companysites/infrastructure/storage/s3/storage.go:76-110`); site media config `SITE_MEDIA_STORAGE=disk|s3`,
  `SITE_MEDIA_S3_BUCKET|REGION|PREFIX|ENDPOINT|FORCE_PATH_STYLE` (`internal/runtime/config/site_media.go:22`); CV root `CV_STORAGE_ROOT`
  (`internal/runtime/config/cvs.go:9`). `cvs` `Reconcile` (`postgres/cvs/library.go:211-225`) deletes any key that no row references; it is only exercised by
  tests today but would delete document files if it ever shared their storage (§«Storage»).
- **Audit**: closed catalog in `internal/features/audit_events/domain/entities/catalog.go` (constant + `spec(…)` row; 70 types today), the Annex of
  `docs/contracts/audit-log-v1.md` («(70)», `catalog_annex_test.go`), the frontend copy `frontend/src/features/audit-log/model.ts` (`ANNEX`,
  count pinned in `model.test.ts:75`). `AuditEvent.StructuredMetadata` allows id/code arrays and numbers (`auditEvent.go:107`). No audited file delete exists.
- **Error catalog**: `internal/shared/httpjson` (families in `*_errors.go`, resolved from `Resolve`; `WriteLifecycleError` carries `data`).

## Decisions

Quoted words are the user's, verbatim from the feature doc. «Spec» is the feature doc's `S#`.

| # | Spec | Decision |
| --- | --- | --- |
| D1 | S1, S2 | **Two scopes, one document model.** One `placement_documents` row per document; `participation_id IS NULL` = vacancy document, otherwise participation document. Same versions, formats, limits, audit and endpoints shape; only the URL prefix and the gate differ. Why one model: the business rules say «apply the same access model», and two tables would double every rule. |
| D2 | S2, S4 | **Vacancy documents key on `job_drafts.id`** and are allowed in every lifecycle state: draft, published, paused, closed (covered or not), finished. No `process_finished` guard, no process row needed. |
| D3 | S1, S4 | **A participation document upload (and a link) requires Placement eligibility**: the participation is **not discarded and sits in a stage of kind `placement` now**, OR it **holds a placement credit with status `active` or `did_not_hold`** (it was hired and the credit was not voided). This holds **after closure and on finished processes** (S4). Why: S1 ties these documents to Placement («contracts», «post-hiring follow-up remain within Placement»); the credit clause keeps the follow-up documents of a hire that later left (resignation letter, settlement) possible, while a `voided` credit (moved by mistake) is not a hire. **Replace and delete of an existing participation document do not re-check eligibility** (cleanup must stay possible after a correction); reading is never gated by eligibility. |
| D4 | S1, S2 | **Manage = owner + active vacancy team members; read = those + every stakeholder of the organization.** Manage (upload, replace, delete, link, unlink) is `authorized` (§«Authorization»); read (list, versions, download, sources list) adds stakeholders through a **new read gate**; a former team member gets `team_access_ended` (404) and a recruiter who was never on the team gets `not_found`. Why the recruiter gate for writes: it is the gate every vacancy write already uses; stakeholders are rejected by it with the existing 403. |
| D5 | S1 | **Candidate-pool access grants nothing.** Participation documents live only under `…/job-drafts/{id}/participations/{pid}/documents`; no route under `/v2/me/company/candidates/*` serves them, and `pid` must belong to process `{id}` or the answer is 404. |
| D6 | S1, S2 | **A stakeholder reads only vacancies that have a process row (published at least once).** Drafts that were never published are visible to owner and team only (Q3). Why: the stakeholder has no draft surface today and unpublished drafts are still private working material; the cost of being wrong is one `if`. |
| D7 | S1 | **Versions: replace = new version, never an overwrite.** `POST …/{doc}/versions` adds version `n+1` (actor and timestamp recorded per version, as the business rules require: «Replacing … creates a new version rather than silently overwriting it; record the acting user and timestamp»). The list returns the **current (highest) version** and `version_count`; every version is downloadable by number. Max **25 versions** per document. Previous versions stay until the document is deleted; the business rules call this «subject to the retention/deletion policy, not an indefinite-storage guarantee» and no policy exists yet, so v1 only offers whole-document delete (Q2). |
| D8 | S5 | **Accepted formats: PDF, DOCX, XLSX, JPG, PNG; 10 MB = 10 485 760 bytes** per file. **Legacy `.doc` / `.xls` are rejected in v1** (Q1): their OLE2 magic `D0 CF 11 E0 A1 B1 1A E1` is shared by Word, Excel, PowerPoint, MSI and Outlook `.msg`; telling them apart means parsing the compound-file directory (a parser dependency or ~150 lines), and legacy formats carry macros. The content type is **derived from the bytes**, never from the client header; the extension must agree with the bytes (`document_content_mismatch`). |
| D9 | S5 | **Inspection is streaming.** The upload handler never holds the object in memory: it streams the part to storage while keeping the first 16 bytes and a **rolling tail of the last 2 MiB**; PDF/JPG/PNG are decided by the head, OOXML (DOCX/XLSX) by reading the ZIP central directory from the tail (end-of-central-directory record → directory, `zip.NewReader` over a sparse `ReaderAt` that only serves the tail; a directory outside the tail window is a mismatch). An invalid file is deleted from storage before the answer. Why: the S7 requirement is no whole-object buffering at 10 MB; the CV handler's `io.ReadAll` (5 MB) does not scale to concurrent 10 MB uploads. |
| D10 | S5 | **Images are stored exactly as uploaded** (no re-encoding, no EXIF stripping). Why: these are internal documents with the same audience as a contract (people who may read the scan may read its metadata); re-encoding adds a dependency and CPU and can degrade scans; the XSS/sniffing surface is closed by serving every document **only as `attachment`** with `nosniff`, never inline. Frontend must not render documents inline in v1. |
| D11 | S5 | **Names.** `name` is the display name, normalized with `cvs.NormalizeName` (NFC, ≤ 120 runes, no control characters); default = the uploaded file name's base. The download file name is `httpjson.AttachmentFilename(name, ext)` where `ext` follows the **stored content type of that version**. No uniqueness (two documents may share a name). |
| D12 | S6 | **No standalone rename in v1.** A name is set at upload and may be changed when replacing (`name` optional on the replace request). Why: S6 lists «subir, reemplazar, borrar», and a rename would need a sixth audit event (4-places cost) for little value; Q6 asks the product if it is wanted. |
| D13 | S6 | **Delete is a hard delete of the whole document (rows and every version's file), audited, and the audit event outlives it.** Rows are removed in the same transaction that writes `DocumentDeleted`; the files are deleted **after commit** (best effort, `context.WithoutCancel`), and a file whose deletion failed is an orphan that `Reconcile` removes. Why hard delete and not a tombstone: a tombstone keeps the display name (often a person's name: «CV Juan Pérez.pdf») and keys forever, contrary to «A document-removal event may remain without retaining the file forever»; the audit row (ids and enums only, no name) is the permanent record; a link to a deleted source needs no tombstone because it keeps its own row with `source_document_id = NULL` (D19). Why rows first, files after: the reverse order can leave a row whose file is gone (a download that fails); an orphan file is invisible and reconcilable. |
| D14 | S6 | **Same people who upload may delete** (S6: «Propietario y reclutadores; auditado»): the manage set of D4. The stakeholder only reads. |
| D15 | S2, S1 | **Limits per scope: 50 documents per vacancy, 20 per participation**, counting file documents **and links**; **25 versions** per document; a single file per request. Why: generous for contracts and scans, bounded for storage and for a list that is not paginated (Q5). Over the limit → 409 `document_limit_reached`. |
| D16 | S3 | **Linking = a reference to a source document version, no copy.** A link row stores `source_document_id` + `source_version_id` **pinned to the version current at link time** (or the `version` the request names); the link serves that pinned version forever and reports `has_newer_version` when the source moved on. It never copies bytes and never enters the target's own document count of versions. Why pinned: S3 says «preserving source and version references». |
| D17 | S3 | **Link targets.** A **vacancy-level link** is allowed only on a process that is a replacement (a `vacancy_replacements` row) and points to a vacancy document of an **earlier process of the same chain** (`sequence` lower than the target's; the original is 0). A **participation-level link** is allowed only on a **carried** participation (`carried_from_participation_id` not null) and points to a participation document of **one of its ancestors** (following `carried_from_participation_id`). Links of links are impossible: sources list only real files. Why no copy of anything else: S3 «do not automatically copy». |
| D18 | S3 | **Linking does not bypass source access.** To list or link a source document the caller must have **read access to the source** under the same rules as reading it directly (owner; recruiter with an active tramo on the source process; stakeholder read-only is not enough to link because linking is a manage action). A source the caller cannot read is **omitted** from the sources list and answers 404 `not_found` on link (no leak). **Downloading through an existing link also requires read access to the source** (and to the target); a viewer who has the target but not the source sees the link as `state: "inaccessible"` with no name, size or download (Q4). |
| D19 | S3, S6 | **A deleted source makes the link «removed».** Deleting a source document sets the links' `source_document_id`/`source_version_id` to `NULL` (`ON DELETE SET NULL`); the link stays listed with `state: "removed"` and answers 404 on download, so the team sees that a document existed and was deleted (not that it vanished), and the retention/deletion rules of the source are honored. A link can be removed (`DELETE …/document-links/{id}`) by the manage set; unlinking is audited as `DocumentDeleted` with `kind = link`. |
| D20 | S6, S4 | **Five audit events**: `DocumentUploaded`, `DocumentReplaced`, `DocumentDeleted`, `DocumentLinked`, `DocumentDownloaded`; one set for both scopes (metadata `scope`), entity type `document`. Metadata is ids and enums only; **never a file name**. Uploads and replacements after closure are audited exactly like before closure (S4: «audit the attachment»). Listing and version listing are not audited (no content leaves). |
| D21 | S1, S2 | **Downloads stream through the API, audited before the first byte** (board CV pattern): gates → open the object → append `DocumentDownloaded` → commit → stream. Nothing is recorded when the document is not found or storage is unavailable; a failed audit append closes the object and serves nothing. No presigned URLs: they would bypass the audit-before-stream rule and the gates. Headers: `Content-Type` from the stored type, `Content-Disposition: attachment; filename=…`, `X-Content-Type-Options: nosniff`, `Content-Length`, `Cache-Control: no-store` (the route group's `NoStore`). |
| D22 | S3 | **Source chain listing is its own read endpoint per scope** (`document-sources`), returning only real files of earlier processes/ancestors the caller may read, grouped by origin, with `already_linked`. Links are listed inside the normal list (`links[]`) next to `items[]` so the frontend decodes two homogeneous arrays. |
| D23 | S4 | **Writes take the draft row lock for a short transaction, never while streaming.** Upload = (1) cheap pre-flight authorization **before any byte is stored** (so an unauthorized caller cannot write objects), (2) stream and inspect into storage with **no DB transaction open**, (3) one short transaction: `lockGates`, `readDraft(lock=true)`, re-authorize, re-check eligibility and limits, insert rows, audit, commit; on any failure the stored object is deleted. The draft lock serializes uploads with team changes and Placement moves, so a revoked recruiter cannot land a write. `job_drafts.version`, `updated_at` and every lifecycle/metrics table stay untouched (S4). |
| D24 | S7 | **A dedicated documents storage port with two adapters (local, S3)** and its own namespace: `DOCUMENT_STORAGE=disk|s3`, a **separate root/prefix** from CVs and site media (§«Storage»). The port is streaming on `Put` and `Open`. S3 adapter keys are `<prefix>/<64 hex random>`; keys never contain company, vacancy, candidate or file-name data. |
| D25 | S7 | **Orphans are reconciled by age, not by lock.** `Reconcile` lists storage objects with their modification time and deletes those that no `placement_document_versions.storage_key` references **and are older than 1 hour**. The CV pattern (advisory lock held across `Put`) would keep a DB transaction open while a 10 MB body streams; the grace window gives the same safety without it. The existing `cvs` `Reconcile` keep-predicate also learns `placement_document_versions` (belt and braces if the two ever share a root) and config validation rejects equal roots (§«Storage»). |
| D26 | S1 | **Document access reads need no process lock and no idempotency key.** Uploads are not idempotent in v1 (a multipart body of 10 MB makes a frozen replay impractical; a double submit creates a second document, visible and deletable). The frontend must disable the submit while a request is in flight. Replace/delete do not use `If-Match`: concurrent replaces both succeed as consecutive versions (history keeps both; nothing is lost). |
| D27 | S1, S2 | **Error codes.** Reuse the existing catalog wherever a code exists (`not_found`, `team_access_ended`, `forbidden`, `validation_error`, `invalid_request`, `unsupported_media_type`, `payload_too_large`); add a small `document_*` family only where no code exists and the `cv_*` ones would carry CV wording and a 5 MB meaning (§«Error codes»). `process_finished` and `vacancy_not_published` are deliberately **not** used (S4). |

## Authorization

Roles come from `company_members.role` (owner, recruiter, stakeholder). Evaluated per request after `lockGates`; all lookups are scoped to the
session company so another company's draft is indistinguishable from a missing one.

| Actor | List / versions / download / `document-sources` (read) | Upload / replace / delete / link / unlink (manage) |
| --- | --- | --- |
| Company owner | every draft of the company | every draft of the company |
| Recruiter with an **active tramo** on `{id}`'s team | yes | yes |
| Recruiter whose tramo **ended** | 404 `team_access_ended` | 404 `team_access_ended` |
| Recruiter never on the team | 404 `not_found` | 404 `not_found` |
| Stakeholder | yes, only for vacancies with a process row (D6); never-published draft → 404 `not_found` | **403 `forbidden`** from the route group (`requireRecruiter` ladder) |
| Candidate, other company, unauthenticated | the usual gate answers (401/403) | same |
| Pool access (`/v2/me/company/candidates/*`) | **no route**, grants nothing (D5) | no |

Routing: read routes (GET) go in a **new group** `NoStore + requireAuth + requireDocumentReader` (owner, recruiter, stakeholder:
`requireCompanyMember` with `allowed = any of the three`); write routes (POST, DELETE) go in the existing recruiter group
(`cmd/api/router.go:388`, same `NoStore` + `requireAuth` + `requireRecruiter`). The store re-checks everything (the middleware is not the source
of truth): manage ⇒ `authorized(auth, record)`; read ⇒ the new `authorizedRead` = `authorized` OR (`role = stakeholder` AND the process row exists).
For `…/participations/{pid}/…` the participation must belong to `{id}` (404 otherwise, with the generic code).

## Data model (migration 00064, proposal)

The latest migration is `00063_replacement_processes.sql`; this one is `00064_placement_vacancy_documents.sql`. **Additive only**: three new tables,
no change to an existing table.

```sql
-- One row per file document. participation_id IS NULL = vacancy document (job_drafts.id), else participation document.
-- Same company is enforced by the writer (the FK graph cannot express it), as for placement_credits.
CREATE TABLE placement_documents (
  id               uuid PRIMARY KEY,
  company_id       uuid NOT NULL REFERENCES companies(id),
  draft_id         uuid NOT NULL REFERENCES job_drafts(id),            -- = process id for a participation document
  participation_id uuid NULL REFERENCES process_participations(id),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at       timestamptz NOT NULL,
  created_by       uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX placement_documents_vacancy_idx ON placement_documents (draft_id, created_at, id) WHERE participation_id IS NULL;
CREATE INDEX placement_documents_participation_idx ON placement_documents (participation_id, created_at, id) WHERE participation_id IS NOT NULL;

-- Versions: current = highest version. storage_key is the adapter key (64 hex), never a path or a name.
CREATE TABLE placement_document_versions (
  id           uuid PRIMARY KEY,
  document_id  uuid NOT NULL REFERENCES placement_documents(id) ON DELETE CASCADE,
  version      integer NOT NULL CHECK (version BETWEEN 1 AND 25),
  storage_key  text NOT NULL UNIQUE CHECK (storage_key ~ '^[0-9a-f]{64}$'),
  content_type text NOT NULL CHECK (content_type IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg', 'image/png')),
  size         bigint NOT NULL CHECK (size BETWEEN 1 AND 10485760),
  uploaded_at  timestamptz NOT NULL,
  uploaded_by  uuid NOT NULL REFERENCES users(id),
  UNIQUE (document_id, version)
);

-- A link from a replacement scope to a pinned source version (D16-D19). The source columns become NULL when the source is deleted
-- («removed»); there is deliberately no CHECK tying the two columns (the two SET NULL actions of one cascade are separate row updates).
CREATE TABLE placement_document_links (
  id                 uuid PRIMARY KEY,
  company_id         uuid NOT NULL REFERENCES companies(id),
  draft_id           uuid NOT NULL REFERENCES job_drafts(id),          -- target process
  participation_id   uuid NULL REFERENCES process_participations(id),  -- target participation, NULL = vacancy-level link
  source_document_id uuid NULL REFERENCES placement_documents(id) ON DELETE SET NULL,
  source_version_id  uuid NULL REFERENCES placement_document_versions(id) ON DELETE SET NULL,
  linked_at          timestamptz NOT NULL,
  linked_by          uuid NOT NULL REFERENCES users(id)
);
CREATE UNIQUE INDEX placement_document_links_vacancy_uq ON placement_document_links (draft_id, source_document_id)
  WHERE participation_id IS NULL AND source_document_id IS NOT NULL;
CREATE UNIQUE INDEX placement_document_links_participation_uq ON placement_document_links (participation_id, source_document_id)
  WHERE participation_id IS NOT NULL AND source_document_id IS NOT NULL;
CREATE INDEX placement_document_links_source_idx ON placement_document_links (source_document_id) WHERE source_document_id IS NOT NULL;
```

- **No FK from audit to documents.** `audit_events.entity_id` is a plain uuid with no FK (`00011:15,34`), so a `DocumentDeleted` row outlives the document by construction
  (the audit retention is its own policy, 24 months, `audit-log-v1.md` §7).
- **Counting** (D15): `count(documents in scope) + count(links in scope)`; versions per document by `max(version)`.
- **Down** is supported with the guard pattern of 00053/00054/00063: under `ACCESS EXCLUSIVE` locks it refuses with a clear message while any row
  exists in the three tables, otherwise it drops them. A migration test (pattern `db/migrations/migration_00063_integration_test.go`) covers Up,
  the constraints above, the `SET NULL` cascade (source deleted → link kept with NULLs) and the Down guard.

## Rules

### Scopes and where a document lives (D1, D2, D3, D5)

| Scope | Key | URL prefix `P` | Upload allowed when |
| --- | --- | --- | --- |
| Vacancy | `draft_id` | `V = /v2/me/company/job-drafts/{id}` | always (any lifecycle state, D2) |
| Participation | `draft_id` + `participation_id` | `V/participations/{pid}` | Placement eligibility (D3) |

**Placement eligibility** (evaluated inside the write transaction, after the draft lock, so a concurrent move serializes):

```
eligible ⇔ participation.process_id = {id}
        AND ( (participation.discarded_at IS NULL AND kind(pipeline stage of participation.stage_id) = 'placement')
           OR EXISTS (placement_credits c WHERE c.participation_id = pid AND c.status IN ('active','did_not_hold')) )
```

Not eligible → 409 `document_upload_not_allowed` (`data.reason = "not_in_placement"`). The participation list response carries `can_upload` and
`upload_blocked_reason` so the UI can disable the control instead of failing. A participation that left Placement keeps its documents readable; a
`voided` credit (moved by mistake) with the candidate out of Placement is not eligible for new uploads, existing documents stay.

### After closure (S4)

Vacancy and participation uploads, replaces and links are accepted on closed and finished processes. They never touch the process or its metrics
(D23). The 409 `process_finished` of the board is **not** raised. «This does not authorize other post-closure business edits»: the document routes
accept nothing but document operations. Integration tests assert that after an upload on a finished process `vacancy_processes`,
`vacancy_lifecycle_events`, `job_drafts.version/updated_at` and the metrics figures are byte-identical.

### Formats, size and inspection (D8-D11)

| Format (`format`) | Content type | Extensions | Decided by |
| --- | --- | --- | --- |
| `pdf` | `application/pdf` | `.pdf` | head `%PDF-` |
| `docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `.docx` | `PK\x03\x04` head + central directory has `[Content_Types].xml` and `word/document.xml` |
| `xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `.xlsx` | `PK\x03\x04` head + central directory has `[Content_Types].xml` and `xl/workbook.xml` |
| `jpg` | `image/jpeg` | `.jpg`, `.jpeg` | head `FF D8 FF` |
| `png` | `image/png` | `.png` | head `89 50 4E 47 0D 0A 1A 0A` |

- Maximum **10 485 760 bytes** per file; empty files are rejected (`size ≥ 1`). The request body is capped with `http.MaxBytesReader` at
  `10 485 760 + 65 536` (multipart overhead); a part longer than the limit is 413 `payload_too_large`, detected while streaming (the object stored so far is deleted).
- The client MIME type and the part's `Content-Type` are ignored. The extension must map to the detected format, otherwise 400
  `document_content_mismatch`; an extension outside the table (including `.doc`, `.xls`, `.zip`, no extension) is 415 `unsupported_media_type`.
- OOXML rules are those of `cvs.Inspect` generalized to the main part: ≤ 1024 central-directory entries, marker parts exactly once, not directories, non-empty,
  ≤ 8 MiB expanded size, encryption flag rejected; entries are never decompressed or extracted. A central directory that does not fit in the 2 MiB tail window is a mismatch.
- Reuse (no copy-paste): `cvs.NormalizeName`, `httpjson.AttachmentFilename`, the multipart discipline of `cvs/handler.go:57-149` (`NextRawPart`, no
  `Content-Transfer-Encoding`, unknown part names rejected, `file` once, `name` once ≤ 2048 bytes). The document inspector is a **new package** that
  imports `cvs.NormalizeName` and shares the OOXML marker rules; `cvs.Inspect` itself is not modified (it works on a `[]byte`).

### Versions (D7)

- **Upload** creates the document with version 1. **Replace** (`POST …/{doc}/versions`) adds `max(version)+1`, `uploaded_by` = caller, `uploaded_at` = now; the optional `name`
  renames the document. The replacement may have another format (PDF → DOCX).
- The list shows the current version's `format`, `size`, `version`, `updated_at`/`updated_by` plus `version_count`. `GET …/{doc}/versions` returns every
  version (≤ 25, no pagination). Download by number: `GET …/{doc}/versions/{n}/file`; the current one: `GET …/{doc}/file`.
- Version 26 → 409 `document_limit_reached` (`data.kind = "versions"`).

### Delete (D13, D14, D19)

`DELETE …/{doc}`: one transaction → `lockGates` + draft lock + authorize → select the version keys → delete the document (cascade removes versions; links to it
become `removed`) → `DocumentDeleted` → commit; then delete the files. 204. Unknown or foreign document → 404 `not_found`. Deleting a link:
`DELETE …/document-links/{link}` → `DocumentDeleted` with `kind = link`; the source is untouched.

### Replacement linking (S3; D16-D19, D22)

Applies to a process that is a replacement (vacancy-level) and to a carried participation (participation-level). Flow the frontend implements: open
«Documentos del proceso original» → `GET …/document-sources` → tick documents → `POST …/document-links` once per document.

- **Sources list** returns, grouped by origin, only real files the caller can read (D18). Vacancy-level: every earlier process of the chain
  (`sequence` lower), original first. Participation-level: the carried participation's ancestors, nearest first. Each document appears with its current
  version and `already_linked`. For a non-replacement process (or a participation that is not carried) the list is `200` with `sources: []` and `can_link: false`.
- **Link request** names the source document and optionally the version to pin (default: its current version). Validation order: manage on the target (404/403) → target is a
  replacement / carried participation (else 422 `document_link_invalid` `reason = "not_replacement"`) → target eligibility for participation scope (D3, 409
  `document_upload_not_allowed`) → source document exists, is in company, **and the caller can read the source** (else 404 `not_found`, no leak) → source belongs to an
  earlier process of the chain / an ancestor participation (else 422 `document_link_invalid` `reason = "source_not_in_chain"`) → pinned `version` exists (else 422
  `reason = "version_not_found"`) → not already linked (409 `document_already_linked`, `data.link_id`) → limit (409 `document_limit_reached`, links count).
- **Reading a link** (list, download) re-evaluates source access every time (D18) and reports `state` (`available | removed | inaccessible`).
- A link is also created on a **closed or finished** replacement (S4).

### Storage (D24, D25; S7)

Port (in the new documents application package; **not** the `cvs.Storage` interface, whose `Put([]byte)` and `Open` buffering do not fit 10 MB):

```go
type Storage interface {
    // Put streams r into a new random 64-hex key. It reads at most maxBytes+1 bytes (so the caller can report "too large") and
    // returns the number of bytes stored. A partial object is removed on error.
    Put(ctx context.Context, r io.Reader, maxBytes int64) (key string, size int64, err error)
    // Open returns a streaming reader (S3: the GetObject body, never buffered). Not-found is ErrNotFound.
    Open(ctx context.Context, key string) (io.ReadCloser, error)
    Delete(ctx context.Context, key string) error // idempotent: a missing key is nil
    // Objects lists every object of the adapter's namespace (local: the root; S3: the prefix) with its modification time, for Reconcile.
    Objects(ctx context.Context) ([]Object, error)
}
```

- **Local adapter**: `os.Root`, random 64-hex file names, `O_EXCL`, `fsync`, removal on error; same safety rules as `candidates/infrastructure/storage/local.go`, with the size
  limit as a parameter instead of `cvs.MaxBytes`.
- **S3 adapter**: new package next to the site-media one, same credential/endpoint discipline as `sites3.New` (SDK default chain, logging disabled, endpoint
  override forbidden in production). `Put` uploads from the reader without buffering the whole object (assumption A2: SDK upload of an unseekable body; fallback: a bounded buffer of ≤ 10 MiB behind a small semaphore); `Open` returns the `GetObject` body directly (no `ReadAll`).
  Keys are `<prefix>/<64 hex>`; no ACL (private bucket); `Objects` pages through `ListObjectsV2` under the prefix.
- **Configuration** (loader next to `site_media.go`, `LoadDocumentStorageConfig`, static error messages that never echo values):

  | Variable | Meaning |
  | --- | --- |
  | `DOCUMENT_STORAGE` | `disk` (default) or `s3` |
  | `DOCUMENT_STORAGE_ROOT` | `disk`: absolute private directory, **must differ from `CV_STORAGE_ROOT`**; unset ⇒ documents disabled |
  | `DOCUMENT_S3_BUCKET`, `DOCUMENT_S3_REGION` | `s3`: required, same patterns as `SITE_MEDIA_S3_*` |
  | `DOCUMENT_S3_PREFIX` | `s3`: relative key prefix, default `documents/v1` (a **different prefix from site media** if the bucket is shared) |
  | `DOCUMENT_S3_ENDPOINT` | `s3`: non-production only (MinIO), forbidden in production |
  | `DOCUMENT_S3_FORCE_PATH_STYLE` | `s3`: boolean, default false |

  `DOCUMENT_S3_*` with `DOCUMENT_STORAGE=disk` is a configuration error (as `SITE_MEDIA_S3_*`). With storage disabled (disk without root) every document route answers 503
  `document_storage_unavailable` after its usual gates and **the rest of the API is unaffected**.
- **Reconcile** (D25): `Reconcile(ctx)` keeps an object iff `placement_document_versions.storage_key` references it **or** it is younger than 1 hour; everything else is deleted; a failed
  lookup fails closed. The existing `cvs` `Reconcile` keep-predicate gains `OR EXISTS(placement_document_versions …)`. Scheduling is open (Q8); v1 ships the function and its integration test.

### Where the files go on a failure (D23)

| Failure | Result |
| --- | --- |
| Inspection fails (type, size, mismatch) | object deleted, 4xx, nothing in the database |
| Row insert / audit / commit fails | object deleted (`WithoutCancel`), 5xx |
| Commit outcome uncertain (connection lost) | object may remain: reconciled after the 1 hour grace |
| Authorization revoked between pre-flight and commit | object deleted, 404 `team_access_ended` / `not_found` |

## Endpoints

`V = /v2/me/company/job-drafts/{id}`; `P` is `V` (vacancy scope) or `V/participations/{pid}` (participation scope); both scopes share every shape below.
Reads are under the `requireDocumentReader` group, writes under the recruiter group (§«Authorization»). Errors are JSON `{error, code, data?}`; timestamps are
`YYYY-MM-DDTHH:MM:SS.ffffffZ`; users are `{ "id", "name" }` (as in `vacancy-team-v1`). No pagination: the scopes are capped (D15).

### `GET P/documents`

Read. Returns every file document and every link of the scope.

```json
{
  "items": [
    {
      "id": "0193a1c2-…",
      "participation_id": null,
      "name": "Contrato marco",
      "format": "pdf",
      "content_type": "application/pdf",
      "size": 183204,
      "version": 2,
      "version_count": 2,
      "created_at": "2026-11-20T15:02:11.482910Z",
      "created_by": { "id": "…", "name": "Ana López" },
      "updated_at": "2026-11-22T09:40:03.100200Z",
      "updated_by": { "id": "…", "name": "Luis Ortega" }
    }
  ],
  "links": [
    {
      "id": "0193b7e0-…",
      "state": "available",
      "linked_at": "2026-11-22T10:00:00.000000Z",
      "linked_by": { "id": "…", "name": "Ana López" },
      "source": {
        "document_id": "0192f0aa-…",
        "process_id": "…",
        "sequence": 0,
        "participation_id": null,
        "name": "Contrato original",
        "format": "docx",
        "size": 91200,
        "version": 1,
        "has_newer_version": true
      }
    },
    { "id": "0193b7e1-…", "state": "removed", "linked_at": "…", "linked_by": { "id": "…", "name": "Ana López" }, "source": null },
    { "id": "0193b7e2-…", "state": "inaccessible", "linked_at": "…", "linked_by": { "id": "…", "name": "Ana López" }, "source": null }
  ],
  "limits": { "max_bytes": 10485760, "max_documents": 50, "max_versions": 25, "formats": ["pdf", "docx", "xlsx", "jpg", "png"] },
  "can_manage": true,
  "can_upload": true,
  "upload_blocked_reason": null
}
```

- Order: `items` by `updated_at DESC, id DESC`; `links` by `linked_at DESC, id DESC`. `limits.max_documents` is 50 for the vacancy scope and 20 for a participation.
- `can_manage` = the caller passes the manage gate (false for a stakeholder). `can_upload` = `can_manage` ∧ limit not reached ∧ (vacancy scope, or Placement-eligible); when false because of
  eligibility `upload_blocked_reason = "not_in_placement"`, because of the limit `"limit_reached"`, otherwise `null`.
- `source.process_id` / `sequence` locate the origin (`sequence` 0 = original). `source.version` is the **pinned** version; `has_newer_version` is `source current version > pinned`.
- Errors: 404 `not_found` / `team_access_ended`. Listing reads only the database, so it never raises `document_storage_unavailable`.

### `POST P/documents`

Manage. `multipart/form-data`, parts: `file` (required, once) and `name` (optional, once, ≤ 2048 bytes before normalization). Example:

```http
POST /v2/me/company/job-drafts/{id}/documents
Content-Type: multipart/form-data; boundary=…

--…
Content-Disposition: form-data; name="name"

Contrato marco
--…
Content-Disposition: form-data; name="file"; filename="contrato.pdf"
Content-Type: application/pdf

%PDF-1.7 …
```

Response **201** with the document item of `GET P/documents` (`version: 1`, `version_count: 1`). Headers: `Location: P/documents/{doc}` is **not** sent (no per-document GET in v1; the list is the read model).

Errors:

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalid_request` | not multipart, missing/duplicate `file`, unknown part, `Content-Transfer-Encoding`, empty file |
| 400 | `validation_error` (`fields[{field:"name", code:"invalid"}]`) | `name` fails `NormalizeName` (control characters, empty, > 120 runes) |
| 400 | **`document_content_mismatch`** | extension and detected bytes disagree |
| 404 | `not_found`, `team_access_ended` | gate (§Authorization); `pid` not in `{id}` |
| 409 | **`document_upload_not_allowed`** | participation scope, not Placement-eligible |
| 409 | **`document_limit_reached`** | 50 / 20 documents (files + links) |
| 413 | `payload_too_large` (`data: { max_bytes }`) | file > 10 485 760 bytes |
| 415 | `unsupported_media_type` (`data: { formats }`) | extension not in the format table |
| 403 | `forbidden` | stakeholder (route group) |
| 503 | **`document_storage_unavailable`** | storage disabled or unreachable (nothing recorded) |

### `POST P/documents/{doc}/versions` (replace)

Manage. Same multipart as upload (`file` required, `name` optional: renames the document). Response **201** with the updated document item (`version: n+1`). Errors: those of upload,
plus 404 `not_found` when `{doc}` is not a document of this scope, and 409 `document_limit_reached` (`data.kind = "versions"`). The eligibility check of D3 is **not** applied.

### `GET P/documents/{doc}/versions`

Read.

```json
{
  "document_id": "0193a1c2-…",
  "name": "Contrato marco",
  "versions": [
    { "version": 2, "format": "pdf", "content_type": "application/pdf", "size": 183204,
      "uploaded_at": "2026-11-22T09:40:03.100200Z", "uploaded_by": { "id": "…", "name": "Luis Ortega" }, "is_current": true },
    { "version": 1, "format": "docx", "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "size": 90112,
      "uploaded_at": "2026-11-20T15:02:11.482910Z", "uploaded_by": { "id": "…", "name": "Ana López" }, "is_current": false }
  ]
}
```

Newest first. 404 `not_found` for a foreign document.

### `GET P/documents/{doc}/file` and `GET P/documents/{doc}/versions/{n}/file`

Read. Streams the current / the numbered version (D21). Order: gates → locate the version (404 `not_found`) → storage unavailable (503, nothing recorded) → `storage.Open` → **append `DocumentDownloaded`, commit** →
headers → `io.Copy`.

```
200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="Contrato marco.pdf"
X-Content-Type-Options: nosniff
Content-Length: 183204
Cache-Control: no-store
```

A failure after the 200 (the connection or storage drops mid-stream) leaves a truncated body against `Content-Length` and the audit row recorded, as for CVs.

### `DELETE P/documents/{doc}`

Manage. **204**, no body (D13). Errors: 404 `not_found` / `team_access_ended`, 403 `forbidden` (stakeholder).

### `GET P/document-sources`

Read. For a vacancy scope: documents of the earlier processes of the chain; for a participation scope: documents of the ancestors of the carried participation (D17, D18).

```json
{
  "can_link": true,
  "sources": [
    {
      "process_id": "…",
      "sequence": 0,
      "participation_id": null,
      "documents": [
        { "id": "0192f0aa-…", "name": "Contrato original", "format": "docx", "size": 91200, "version": 1, "version_count": 1,
          "updated_at": "2026-10-03T12:00:00.000000Z", "already_linked": false }
      ]
    }
  ]
}
```

`participation_id` is the ancestor participation for the participation scope and `null` for the vacancy scope. Processes/participations with no readable documents are omitted. `can_link` is false when
the target is not a replacement / not a carried participation (then `sources` is `[]`) or the caller cannot manage.

### `POST P/document-links`

Manage. Body `application/json`:

```json
{ "source_document_id": "0192f0aa-…", "version": 1 }
```

`version` is optional (default: the source's current version at that moment). Response **201** with the link item of `GET P/documents` (`links[]`). Errors:

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalid_request` | not JSON, unknown key, `source_document_id` not a uuid, `version` not an integer ≥ 1 |
| 404 | `not_found`, `team_access_ended` | target gate; source document missing, foreign company or **not readable by the caller** (no leak) |
| 409 | **`document_upload_not_allowed`** | participation scope, not Placement-eligible (D3) |
| 409 | **`document_already_linked`** (`data: { link_id }`) | same source document already linked in this scope |
| 409 | **`document_limit_reached`** | 50 / 20 (files + links) |
| 422 | **`document_link_invalid`** (`data: { reason }`) | `not_replacement`, `source_not_in_chain`, `version_not_found` |

### `DELETE P/document-links/{link}`

Manage. **204**; the source is untouched; audited as `DocumentDeleted` with `kind = link`.

### `GET P/document-links/{link}/file`

Read. Streams the **pinned** version through the same audited path as a normal download (the event's `document_id`/`version_id` name the source; `link_id` is added). 404 `not_found` when the link is
`removed` or `inaccessible` (D18, D19), when it is not in this scope, or when the caller cannot read the source.

### Route summary

| Method | Path under `P` | Gate | Event |
| --- | --- | --- | --- |
| GET | `/documents` | read | — |
| POST | `/documents` | manage | `DocumentUploaded` |
| POST | `/documents/{doc}/versions` | manage | `DocumentReplaced` |
| GET | `/documents/{doc}/versions` | read | — |
| GET | `/documents/{doc}/file`, `/documents/{doc}/versions/{n}/file` | read | `DocumentDownloaded` |
| DELETE | `/documents/{doc}` | manage | `DocumentDeleted` |
| GET | `/document-sources` | read | — |
| POST | `/document-links` | manage | `DocumentLinked` |
| DELETE | `/document-links/{link}` | manage | `DocumentDeleted` (`kind = link`) |
| GET | `/document-links/{link}/file` | read | `DocumentDownloaded` |

The `document-sources` / `document-links` segments are literal siblings of `documents`, so no UUID segment can collide with them in the router.

## Error codes

New codes live in a new `internal/shared/httpjson/document_errors.go` resolved from `Resolve` like `resolveReplacementError`, added to the catalog code tests. Where a generic code exists it is reused.

| Code | Status | `data` | Where |
| --- | --- | --- | --- |
| `document_content_mismatch` | 400 | — | upload, replace (extension vs bytes) |
| `document_upload_not_allowed` | 409 | `{ reason: "not_in_placement" }` | participation upload, replace is exempt, link |
| `document_limit_reached` | 409 | `{ kind: "documents" \| "versions", limit }` | upload, link (documents), replace (versions) |
| `document_already_linked` | 409 | `{ link_id }` | POST document-links |
| `document_link_invalid` | 422 | `{ reason: "not_replacement" \| "source_not_in_chain" \| "version_not_found" }` | POST document-links |
| `document_storage_unavailable` | 503 | — | upload, replace, download, link download (storage disabled or failing); the list never raises it |
| existing, reused as is | | | `not_found` 404, `team_access_ended` 404, `forbidden` 403, `validation_error` 400 + `fields[]`, `invalid_request` 400, `unsupported_media_type` 415 (`data.formats`), `payload_too_large` 413 (`data.max_bytes`), `unauthenticated` 401, `internal_error` 500 |
| **not used** | | | `process_finished`, `vacancy_not_published`, `cv_*` (S4 and D27) |

`unsupported_media_type` and `payload_too_large` exist as generic catalog codes (`site_errors.go`, `errors.go`); the document handlers add `data` through the same writer the replacement family uses, so the catalog tests must allow it for these two codes.

## Audit events

Same transaction as the change (fail-closed audit, as `Append` does today). `entity_type = "document"`, `entity_id` = the document id (the link id for a link), `VacancyID` = `{id}` (the vacancy the request ran against),
`CompanyID` = session company. Metadata is a closed set of **ids and enums**; file names never go in (they may contain personal names).

| Event (new) | Entity | Metadata | Category |
| --- | --- | --- | --- |
| `DocumentUploaded` | `document` (document id) | company_id, vacancy_id, scope (`vacancy`\|`participation`), participation_id (participation scope), document_id, version_id, version (1), format (`pdf`\|`docx`\|`xlsx`\|`jpg`\|`png`) | `vacancy` |
| `DocumentReplaced` | `document` | company_id, vacancy_id, scope, participation_id, document_id, version_id, version (n+1), previous_version_id, format, renamed (`true`\|`false`) | `vacancy` |
| `DocumentDeleted` | `document` (document id, or link id when `kind = link`) | company_id, vacancy_id, scope, participation_id, kind (`file`\|`link`), document_id (file) / link_id (link), version_count (file), linked_count (file: links that became `removed`) | `vacancy` |
| `DocumentLinked` | `document` (link id) | company_id, vacancy_id, scope, participation_id, link_id, source_document_id, source_version_id, source_vacancy_id, source_participation_id (participation scope) | `vacancy` |
| `DocumentDownloaded` | `document` (document id) | company_id, vacancy_id, scope, participation_id, document_id, version_id, version, link_id (download through a link) | `sensitive_read` |

Notes: `DocumentDownloaded` joins the sensitive-read table of `audit-log-v1.md` §2 (like `ParticipationCVDownloaded`); `vacancy_id` is the vacancy of the request, which for a link
download is the replacement, with `source_*` ids reachable through the link's metadata on `DocumentLinked`. After closure the same events are emitted unchanged (S4). Listings are not audited (D20).

**A catalog event lives in four places; each new type must be added to all four** (five types):

1. the constants in `internal/features/audit_events/domain/entities/catalog.go` (vacancy group; `EventDocumentDownloaded` in the sensitive-reads group next to `EventParticipationCVDownloaded`, line 47);
2. their `spec(Event…, CategoryVacancy|CategorySensitiveRead, <closed metadata keys>)` rows in the `catalog` slice (same file; keys as the table above);
3. their rows in the **Annex** of `docs/contracts/audit-log-v1.md` (update the «(70)» count to 75; `catalog_annex_test.go` fails without the rows) and the new sensitive-read row in §2;
4. their labels in the frontend annex copy `frontend/src/features/audit-log/model.ts` (`ANNEX`; `model.test.ts:75` pins the count and becomes 75). **The wording is the frontend's** (the backend proposes the labels below; an unknown type renders a generic label until then).

Proposed labels (es-MX): `DocumentUploaded` → «Subió un documento»; `DocumentReplaced` → «Reemplazó un documento por una nueva versión»; `DocumentDeleted` → «Eliminó un documento o un vínculo a documento»; `DocumentLinked` → «Vinculó un documento del proceso original»; `DocumentDownloaded` → «Descargó un documento».

## Deployment order

1. **Backend first.** The migration is **additive** (three new tables) and every endpoint is new: no existing response gains a key, so the frontend's `.strict()` schemas of existing screens are not affected
   and the frontend does **not** need an «optional keys first» step (unlike replacement-processes-v1). The new audit event types render with a generic label in the audit screen until the frontend annex gets them.
2. **Environment before routes are used.** Set the `DOCUMENT_*` variables per environment: local `DOCUMENT_STORAGE=disk` + `DOCUMENT_STORAGE_ROOT`; the AWS test environment (Fargate, ephemeral disk)
   `DOCUMENT_STORAGE=s3` + bucket/region/prefix, an IAM task role with `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on the prefix and `s3:ListBucket` for it, no static keys, and a lifecycle rule that
   aborts incomplete multipart uploads. Until configured, the document routes answer 503 `document_storage_unavailable` and nothing else changes.
3. **Frontend after**: BFF routes for upload (streaming multipart, 10 MiB + overhead), download (streaming, no buffering; pass through the `Content-Disposition`/`Content-Length`) and the JSON ones; the
   screens; the audit `ANNEX` labels. The frontend may start against the contract with mocks; it merges **after** the backend branch.

## Slices

Each ≤ ~400 changed lines where possible; every slice ships tests, the HTTP ones through the production router. Order matters.

1. **P1 · Migration and domain** (~300): `00064_placement_vacancy_documents.sql` (+ guarded down), migration integration test (constraints, `SET NULL` cascade, down guard); the new documents
   application package: limits, formats, `Inspect` over head + tail window (PDF/JPG/PNG/OOXML, mismatch, tail-window miss), name normalization via `cvs.NormalizeName`, unit tests. No routes.
2. **P2 · Storage and config** (~400): the streaming `Storage` port, local adapter, `LoadDocumentStorageConfig` (+ tests), the S3 adapter (+ MinIO integration test skipped without `DOCUMENT_S3_TEST_ENDPOINT`, like the
   site-media one), `Reconcile` with the grace window and the `cvs` keep-predicate extension, composition in `cmd/api/main.go`. May need `github.com/aws/aws-sdk-go-v2/feature/s3/manager`
   (not in `go.mod` today): **a dependency change the parent must authorize**; see A2. Split the S3 adapter into P2b if over budget.
3. **P3 · Vacancy documents: upload, list, download** (~450): error family `document_errors.go`, the new read gate and `authorizedRead` (D4, D6), `GET/POST V/documents`, `GET …/file`, the audited download before
   streaming, audit catalog (constants, specs, annex, `audit-log-v1.md` rows), routes, integration tests (gates matrix of §Authorization, draft state, finished state byte-identical, pool access grants nothing, failure table).
4. **P4 · Versions and delete** (~350): replace, version list, download by version, delete (rows first, files after), `DocumentReplaced` / `DocumentDeleted`, limits, tests (concurrent replaces, delete orphan on storage failure, audit outlives).
5. **P5 · Participation documents** (~350): the same endpoints under `V/participations/{pid}`, the Placement eligibility (D3), `can_upload`/`upload_blocked_reason`, tests (placement, credit `did_not_hold`/`voided`, discarded, after closure and finished, wrong `pid`).
6. **P6 · Replacement linking** (~400): `document-sources`, `document-links` (create, delete, file), chain/ancestor resolution, `state` rules, `DocumentLinked`, tests (source deleted → removed, source access lost → inaccessible, pinned version, limits, links of links impossible).
7. **P7 · Hardening and reconciliation** (~200): `Reconcile` wiring decision (Q8), configuration docs, end-to-end test through the router with the local and the S3 adapters, final run of the full backend suite.

## Open questions

Each with the contract's recommended answer; the draft implements the recommendation.

- **Q1 · Legacy `.doc` / `.xls`.** The user wrote «Word, Excel». Recommendation: **accept only `.docx` / `.xlsx`** in v1 and say so in the UI copy; accepting `.doc`/`.xls` needs an OLE2 directory parser (to tell Word from Excel, PowerPoint, MSI, `.msg`) and macros make them riskier. If product insists, add them in a later slice with a stream-name check (`WordDocument`, `Workbook`).
- **Q2 · Retention of previous versions.** The business rules say previous versions follow a retention/deletion policy that is not defined. Recommendation: keep up to 25 versions until the whole document is deleted (v1 offers no per-version delete); define a time-based policy before production.
- **Q3 · Stakeholder and unpublished drafts.** Recommendation: stakeholders read documents only of vacancies that were published at least once (D6); drafts stay with owner and team. The alternative (every draft of the organization) exposes working material the stakeholder cannot see anywhere else.
- **Q4 · Linked document whose source the viewer cannot read.** Recommendation: strict (D18): the link shows as `inaccessible` with no name/size/download. The alternative (the link grants access to the pinned version to everyone who can read the target) is simpler but turns «link» into a way around source access, which S3 forbids.
- **Q5 · Limits.** Recommendation: 50 documents per vacancy, 20 per participation, 25 versions per document, files + links counted together. Confirm the numbers or change them (they are constants, not schema).
- **Q6 · Rename.** Recommendation: not in v1 (name at upload/replace); add `PATCH …/{doc}` plus a sixth event `DocumentRenamed` only if the product wants it.
- **Q7 · Participation documents for a candidate who was never hired.** Recommendation: no uploads (D3 requires Placement), existing documents stay readable. If recruiters need to store CV annexes earlier, the rule would be «any participation of the process», a one-line change.
- **Q8 · Who runs `Reconcile` and when.** Recommendation: once at startup (after the 1 hour grace the in-flight uploads of the previous instance are safe to judge) plus a daily in-process ticker with a Postgres advisory lock so only one Fargate task runs it; decide in P7.
- **Q9 · Malware scanning.** Not requested and not in v1. Recommendation: decide before the first production tenant (there is no production today); documents are served only as downloads, never inline, which limits but does not remove the risk.

## Assumptions made in this draft (flag in review)

- **A1** The stakeholder UI hides every write control from `can_manage`, and a never-published draft is simply not reachable for a stakeholder (D6/Q3).
- **A2** The AWS SDK version in `go.mod` (`service/s3 v1.78.2`) can upload an unseekable body over TLS without buffering it (trailing checksums), or the `feature/s3/manager` uploader may be added; if neither works against MinIO in P2, the S3 `Put` falls back to a bounded ≤ 10 MiB buffer behind a semaphore (the local adapter and `Open` stay streaming).
- **A3** `job_drafts` rows are never hard-deleted by the application (only the metrics demo tool does), so the plain `REFERENCES job_drafts(id)` needs no cascade; if a draft delete is ever added it must delete documents and their files first.
- **A4** The documents of a draft with a v1 schema are not reachable (the shared v2 gate answers `not_found`), as every other v2 draft route.
- **A5** The BFF forwards uploads/downloads without buffering and applies the 10 MiB + overhead cap (frontend work, T3+).
- **A6** A recruiter who is a team member of a replacement but never of the source cannot read the source's documents (strict D18), even if they are the replacement's responsible.
- **A7** Document operations do not send notifications and are not shown in the vacancy event history, only in the audit log.

## Out of scope (v1)

Public or candidate-visible documents; automatic copying of documents into a replacement (S3 forbids); inline preview or thumbnails; standalone rename (D12); per-version delete and retention timers (Q2); folders, tags, descriptions, search or sorting
options; bulk upload (one file per request) and resumable uploads; presigned URLs; image re-encoding or EXIF stripping (D10); legacy `.doc` / `.xls` / `.ppt` (Q1); malware scanning (Q9); e-signature; stakeholder writes; notifications;
documents on the candidate-managed profile or the global talent pool; changes to the CV library, the manual intake CV or any existing response shape.
