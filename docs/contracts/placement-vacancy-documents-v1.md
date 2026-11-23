# Placement and vacancy documents v1 (internal, employer-only)

Status: **Draft — frontend review applied, pending final OK** (2026-11-22). Nothing is implemented; nothing is agreed beyond the user decisions quoted in
§«Decisions» and §«Decisions status». Revision 2 applies the user's answers to the open questions (feature doc L5) and the frontend's review, accepted in full (L6, 11 points). Product source: the 2 Oct 2026 agreement «Documentos de placement y de vacante».
Tracking: `odd/tasks/placement-vacancy-documents-backend.md` (branch `feat/placement-vacancy-documents-backend`). The backend session wrote
this contract; the frontend session reviewed it (L6) and gives a final OK before any implementation slice starts (T2). Style follows `replacement-processes-v1.md` and
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
   process, **at any stage** of the participation (not only Placement).

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
- **Participations**: `process_participations` (`00022`, `00038`, `00024` `discarded_at`, `00063` `carried_from_participation_id`); `process_id` ties a participation to its process. The stage and the hire credit (`placement_credits`, `00054`) play **no role** in documents (D3).
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
- **Idempotency-Key** (drafts, team, publication, replacements): a UUID header (exactly one non-empty line, else `invalid_idempotency_key`), canonicalized, stored per `(company, actor, operation, key)` in `job_draft_idempotency` with no TTL and a SHA-256 fingerprint; same key + same fingerprint replays the frozen response with `Idempotency-Replayed: true`, a different fingerprint is 409 `idempotency_conflict`; a transaction-scoped advisory lock serializes racing requests and the replay re-authorizes first (`draftHandler.go:190`, `draftstore/store.go:133-190,561`, `team_write.go`, `drafts.go`).
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
| D3 | S1, S4 | **Participation documents (upload, replace, link) are allowed at ANY stage of a participation of the process** (Q7, user: «En cualquier etapa del proceso»). The only rule is that the participation belongs to process `{id}` (404 otherwise). **No Placement eligibility**: no stage-kind check, no credit check, no `not_in_placement` blocked reason and no `document_upload_not_allowed` code. This holds on closed and finished processes (S4) and for discarded participations. Why: recruiters need to keep a candidate's CV annexes, offers and scans from the first stage on; S1 speaks of «candidate participation/process» documents without tying them to Placement. Reading, replacing and deleting follow the same gates as uploading. |
| D4 | S1, S2 | **Manage = owner + active vacancy team members; read = those + every stakeholder of the organization (drafts included, D6).** Manage (upload, replace, delete, link, unlink) is `authorized` (§«Authorization»); read (list, versions, download, sources list) adds stakeholders through a **new read gate**; a former team member gets `team_access_ended` (404) and a recruiter who was never on the team gets `not_found`. Why the recruiter gate for writes: it is the gate every vacancy write already uses; stakeholders are rejected by it with the existing 403. |
| D5 | S1 | **Candidate-pool access grants nothing.** Participation documents live only under `…/job-drafts/{id}/participations/{pid}/documents`; no route under `/v2/me/company/candidates/*` serves them, and `pid` must belong to process `{id}` or the answer is 404. |
| D6 | S1, S2 | **A stakeholder reads the documents of EVERY vacancy of the organization, never-published drafts included** (Q3, user: «También de borradores»). The read gate does **not** require a process row: `authorizedRead` = `authorized` OR `role = stakeholder`, always scoped to the session company, so a stakeholder's reach is the whole organization and never another company. Writes stay with owner and team (403 for a stakeholder). Why: the user wants stakeholders to consult any vacancy's documents, working drafts included; the stakeholder still has no draft surface, so the document list is reached by draft id. |
| D7 | S1 | **Versions: replace = new version, never an overwrite.** `POST …/{doc}/versions` adds version `n+1` (actor and timestamp recorded per version, as the business rules require: «Replacing … creates a new version rather than silently overwriting it; record the acting user and timestamp»). The list returns the **current (highest) version** and `version_count`; every version is downloadable by number. Max **25 versions** per document. Previous versions stay until the document is deleted; the business rules call this «subject to the retention/deletion policy, not an indefinite-storage guarantee» and no policy exists yet, so v1 only offers whole-document delete (Q2, accepted default). |
| D8 | S5 | **Accepted formats: PDF, DOCX, XLSX, JPG, PNG; 10 MB = 10 485 760 bytes** per file. **Legacy `.doc` / `.xls` are rejected in v1** (Q1, closed by the user: «Solo .docx y .xlsx (Recomendado)»): their OLE2 magic `D0 CF 11 E0 A1 B1 1A E1` is shared by Word, Excel, PowerPoint, MSI and Outlook `.msg`; telling them apart means parsing the compound-file directory (a parser dependency or ~150 lines), and legacy formats carry macros. The content type is **derived from the bytes**, never from the client header; the extension must agree with the bytes (`document_content_mismatch`, `data: { detected_format, extension }`). Adding a format later changes the `format` enum and needs the frontend to accept it first (§Deployment order). |
| D9 | S5 | **Inspection is streaming.** The upload handler never holds the object in memory: it streams the part to storage while keeping the first 16 bytes and a **rolling tail of the last 2 MiB**; PDF/JPG/PNG are decided by the head, OOXML (DOCX/XLSX) by reading the ZIP central directory from the tail (end-of-central-directory record → directory, `zip.NewReader` over a sparse `ReaderAt` that only serves the tail; a directory outside the tail window is a mismatch). An invalid file is deleted from storage before the answer. Why: the S7 requirement is no whole-object buffering at 10 MB; the CV handler's `io.ReadAll` (5 MB) does not scale to concurrent 10 MB uploads. |
| D10 | S5 | **Images are stored exactly as uploaded** (no re-encoding, no EXIF stripping). Why: these are internal documents with the same audience as a contract (people who may read the scan may read its metadata); re-encoding adds a dependency and CPU and can degrade scans; the XSS/sniffing surface is closed by serving every document **only as `attachment`** with `nosniff`, never inline. Frontend must not render documents inline in v1. |
| D11 | S5 | **Names.** `name` is the display name, normalized with `cvs.NormalizeName` (NFC, ≤ 120 runes, no control characters); default = the uploaded file name's base. **At upload and replace one trailing known extension is stripped** (`.pdf`, `.docx`, `.xlsx`, `.jpg`, `.jpeg`, `.png`, case-insensitive, before normalization; nothing left → `validation_error` for a given `name`, `Documento` for a defaulted one), so `contrato.pdf` is stored as `contrato` and the UI icon comes from `format` (L6 point 7). The **download file name is `name` + the extension of the stored format of that version** (`.pdf`, `.docx`, `.xlsx`, `.jpg`, `.png`) by plain concatenation, so a PDF replaced by a DOCX downloads as `contrato.docx`, never `contrato.pdf.docx`. No uniqueness (two documents may share a name). |
| D12 | S6 | **No standalone rename in v1.** A name is set at upload and may be changed when replacing (`name` optional on the replace request). Why: S6 lists «subir, reemplazar, borrar», and a rename would need a sixth audit event (4-places cost) for little value. Closed by the user (Q6: «Esos límites, sin renombrar (Recomendado)»). |
| D13 | S6 | **Delete is a hard delete of the whole document (rows and every version's file), audited, and the audit event outlives it.** Rows are removed in the same transaction that writes `DocumentDeleted`; the files are deleted **after commit** (best effort, `context.WithoutCancel`), and a file whose deletion failed is an orphan that `Reconcile` removes. Why hard delete and not a tombstone: a tombstone keeps the display name (often a person's name: «CV Juan Pérez.pdf») and keys forever, contrary to «A document-removal event may remain without retaining the file forever»; the audit row (ids and enums only, no name) is the permanent record; a link to a deleted source needs no tombstone because it keeps its own row with `source_document_id = NULL` (D19). Why rows first, files after: the reverse order can leave a row whose file is gone (a download that fails); an orphan file is invisible and reconcilable. |
| D14 | S6 | **Same people who upload may delete** (S6: «Propietario y reclutadores; auditado»): the manage set of D4. The stakeholder only reads. |
| D15 | S2, S1 | **Limits per scope: 50 documents per vacancy, 20 per participation**, counting file documents **and links**; **25 versions** per document; a single file per request. Why: generous for contracts and scans, bounded for storage and for a list that is not paginated (Q5, confirmed by the user: «Esos límites, sin renombrar (Recomendado)»). Over the limit → 409 `document_limit_reached`. |
| D16 | S3 | **Linking = a reference to a source document version, no copy.** A link row stores `source_document_id` + `source_version_id` **pinned to the version current at link time** (or the `version` the request names); the link serves that pinned version forever and reports `has_newer_version` when the source moved on. It never copies bytes and never enters the target's own document count of versions. Why pinned: S3 says «preserving source and version references». |
| D17 | S3 | **Link targets.** A **vacancy-level link** is allowed only on a process that is a replacement (a `vacancy_replacements` row) and points to a vacancy document of an **earlier process of the same chain** (`sequence` lower than the target's; the original is 0). A **participation-level link** is allowed only on a **carried** participation (`carried_from_participation_id` not null) and points to a participation document of **one of its ancestors** (following `carried_from_participation_id`). Links of links are impossible: sources list only real files. Why no copy of anything else: S3 «do not automatically copy». |
| D18 | S3 | **Linking does not bypass source access.** To list or link a source document the caller must have **read access to the source** under the same rules as reading it directly (owner; recruiter with an active tramo on the source process; a stakeholder reads every source of the organization but cannot link, because linking is a manage action). A source the caller cannot read is **omitted** from the sources list and answers 404 `not_found` on link (no leak). **Downloading through an existing link also requires read access to the source** (and to the target); a viewer who has the target but not the source sees the link as `state: "inaccessible"` with no name, size or download (Q4, accepted default). |
| D19 | S3, S6 | **A deleted source makes the link «removed».** Deleting a source document sets the links' `source_document_id`/`source_version_id` to `NULL` (`ON DELETE SET NULL`); the link stays listed with `state: "removed"` and answers 404 on download, so the team sees that a document existed and was deleted (not that it vanished), and the retention/deletion rules of the source are honored. A link can be removed (`DELETE …/document-links/{id}`) by the manage set; unlinking is audited as `DocumentDeleted` with `kind = link`. |
| D20 | S6, S4 | **Five audit events**: `DocumentUploaded`, `DocumentReplaced`, `DocumentDeleted`, `DocumentLinked`, `DocumentDownloaded`; one set for both scopes (metadata `scope`), entity type `document`. Metadata is ids and enums only; **never a file name**. Uploads and replacements after closure are audited exactly like before closure (S4: «audit the attachment»). An idempotent replay of an upload (D26) emits no second event. Listing and version listing are not audited (no content leaves). |
| D21 | S1, S2 | **Downloads stream through the API, audited before the first byte** (board CV pattern): gates → open the object → append `DocumentDownloaded` → commit → stream. Nothing is recorded when the document is not found or storage is unavailable; a failed audit append closes the object and serves nothing. No presigned URLs: they would bypass the audit-before-stream rule and the gates. Headers: `Content-Type` from the stored type, `Content-Disposition: attachment` built with `mime.FormatMediaType` (RFC 5987 `filename*=utf-8''…` for non-ASCII names; file name = `name` + stored format extension, D11), `X-Content-Type-Options: nosniff`, `Content-Length`, `Cache-Control: no-store` (the route group's `NoStore`). |
| D22 | S3 | **Source chain listing is its own read endpoint per scope** (`document-sources`), returning only real files of earlier processes/ancestors the caller may read, grouped by origin, with `already_linked`. Links are listed inside the normal list (`links[]`) next to `items[]` so the frontend decodes two homogeneous arrays. |
| D23 | S4 | **Writes take the draft row lock for a short transaction, never while streaming.** Upload = (1) `Idempotency-Key` header check and cheap pre-flight authorization **before any byte is stored** (so an unauthorized caller cannot write objects), (2) stream and inspect into storage with **no DB transaction open** (hashing the bytes for the idempotency fingerprint), (3) one short transaction: `lockGates`, `readDraft(lock=true)`, re-authorize, idempotency lookup, check `expected_version` (replace) and limits, insert rows, audit, commit; on any failure the stored object is deleted. The draft lock serializes uploads with team changes and lifecycle moves, so a revoked recruiter cannot land a write. `job_drafts.version`, `updated_at` and every lifecycle/metrics table stay untouched (S4). |
| D24 | S7 | **A dedicated documents storage port with two adapters (local, S3)** and its own namespace: `DOCUMENT_STORAGE=disk|s3`, a **separate root/prefix** from CVs and site media (§«Storage»). The port is streaming on `Put` and `Open`. S3 adapter keys are `<prefix>/<64 hex random>`; keys never contain company, vacancy, candidate or file-name data. |
| D25 | S7 | **Orphans are reconciled by age, not by lock.** `Reconcile` lists storage objects with their modification time and deletes those that no `placement_document_versions.storage_key` references **and are older than 1 hour**. The CV pattern (advisory lock held across `Put`) would keep a DB transaction open while a 10 MB body streams; the grace window gives the same safety without it. The existing `cvs` `Reconcile` keep-predicate also learns `placement_document_versions` (belt and braces if the two ever share a root) and config validation rejects equal roots (§«Storage»). |
| D26 | S1 | **Idempotency and concurrency (L6 point 9).** Document reads need no process lock. **Upload takes an optional `Idempotency-Key`** with the semantics of drafts/team/replacements: a UUID (one non-empty header line, else 400 `invalid_idempotency_key`), stored in `job_draft_idempotency` per `(company, actor, operation, key)` with no TTL (operation `placement-document-upload:r1`), fingerprint = SHA-256 of scope + ids + normalized name + SHA-256 of the file bytes, same key + same fingerprint replays the frozen 201 with `Idempotency-Replayed: true`, a different fingerprint is 409 `idempotency_conflict`, replay re-authorizes first and creates nothing (details at `POST P/documents`). The key is optional: without it a double submit creates a second document (visible and deletable), so the frontend should send one and disable the submit while a request is in flight. **Replace takes a required `expected_version` multipart part**: a stale value is 409 `document_version_conflict` (`data.current_version`), so concurrent replaces no longer both succeed silently. **Delete takes no `If-Match`** (a repeated delete is a 404) and **link needs nothing beyond `document_already_linked`**. |
| D27 | S1, S2 | **Error codes.** Reuse the existing catalog wherever a code exists (`not_found`, `team_access_ended`, `forbidden`, `validation_error` incl. `file`/`empty`, `invalid_request`, `unsupported_media_type`, `payload_too_large`, `invalid_idempotency_key`, `idempotency_conflict`); add a small `document_*` family only where no code exists and the `cv_*` ones would carry CV wording and a 5 MB meaning (§«Error codes»): `document_content_mismatch`, `document_limit_reached`, `document_version_conflict`, `document_already_linked`, `document_link_invalid`, `document_storage_unavailable`. Every enum the frontend decodes is closed in that section. `process_finished` and `vacancy_not_published` are deliberately **not** used (S4). |

## Authorization

Roles come from `company_members.role` (owner, recruiter, stakeholder). Evaluated per request after `lockGates`; all lookups are scoped to the
session company so another company's draft is indistinguishable from a missing one.

| Actor | List / versions / download / `document-sources` (read) | Upload / replace / delete / link / unlink (manage) |
| --- | --- | --- |
| Company owner | every draft of the company | every draft of the company |
| Recruiter with an **active tramo** on `{id}`'s team | yes | yes |
| Recruiter whose tramo **ended** | 404 `team_access_ended` | 404 `team_access_ended` |
| Recruiter never on the team | 404 `not_found` | 404 `not_found` |
| Stakeholder | **yes, every vacancy of the company, never-published drafts included** (D6, Q3); no process row required | **403 `forbidden`** from the route group (`requireRecruiter` ladder) |
| Candidate, other company, unauthenticated | the usual gate answers (401/403) | same |
| Pool access (`/v2/me/company/candidates/*`) | **no route**, grants nothing (D5) | no |

Routing: read routes (GET) go in a **new group** `NoStore + requireAuth + requireDocumentReader` (owner, recruiter, stakeholder:
`requireCompanyMember` with `allowed = any of the three`); write routes (POST, DELETE) go in the existing recruiter group
(`cmd/api/router.go:388`, same `NoStore` + `requireAuth` + `requireRecruiter`). The store re-checks everything (the middleware is not the source
of truth): manage ⇒ `authorized(auth, record)`; read ⇒ the new `authorizedRead` = `authorized` OR `role = stakeholder` (the draft is read scoped to the session company, so no other company's draft is reachable; **no process row is required**, D6). Neither gate looks at the participation's stage (D3).
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
| Participation | `draft_id` + `participation_id` | `V/participations/{pid}` | always: any participation of process `{id}`, **at any stage** (D3, Q7) |

**The only participation rule** (evaluated inside the write transaction, after the draft lock): `participation.process_id = {id}`; otherwise 404 with the generic code. There is no stage check, no Placement check and no credit check: a participation in
Applied, Interview, Placement or any other stage, and a participation that was discarded, accepts uploads, replaces and links like any other. Nothing in the answers or in the flags (`allowed_actions`, `upload_blocked_reason`) depends on the stage;
the only reason an upload is not offered is the limit (`limit_reached`) or the caller's role.

### After closure (S4)

Vacancy and participation uploads, replaces and links are accepted on closed and finished processes, at every stage of the participation. They never touch the process or its metrics
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

- Maximum **10 485 760 bytes** per file; empty files are rejected (`size ≥ 1`) as **400 `validation_error` `fields[{field:"file", code:"empty"}]`**, not `invalid_request` (L6). The request body is capped with `http.MaxBytesReader` at
  **`10 485 760 + 65 536 = 10 551 296` bytes** (multipart overhead; the number the BFF applies too); a part longer than the limit is 413 `payload_too_large`, detected while streaming (the object stored so far is deleted).
- The client MIME type and the part's `Content-Type` are ignored. The file name's extension must map to the detected format, otherwise 400
  `document_content_mismatch` with `data: { detected_format, extension }` (the format the bytes decide, `null` if none; the extension lower-cased with its dot); an extension outside the table (including `.doc`, `.xls`, `.zip`, no extension) is 415 `unsupported_media_type`.
- **Name and extension** (D11): at upload and replace one trailing known extension is stripped from the display name; the download name is `name` + the extension of the stored format.
- OOXML rules are those of `cvs.Inspect` generalized to the main part: ≤ 1024 central-directory entries, marker parts exactly once, not directories, non-empty,
  ≤ 8 MiB expanded size, encryption flag rejected; entries are never decompressed or extracted. A central directory that does not fit in the 2 MiB tail window is a mismatch.
- Reuse (no copy-paste): `cvs.NormalizeName`, `httpjson.AttachmentFilename`, the multipart discipline of `cvs/handler.go:57-149` (`NextRawPart`, no
  `Content-Transfer-Encoding`, unknown part names rejected, `file` once, `name` once ≤ 2048 bytes). The document inspector is a **new package** that
  imports `cvs.NormalizeName` and shares the OOXML marker rules; `cvs.Inspect` itself is not modified (it works on a `[]byte`).

### Versions (D7)

- **Upload** creates the document with version 1. **Replace** (`POST …/{doc}/versions`) requires `expected_version` = the current version the client saw (otherwise 409 `document_version_conflict`), then adds `max(version)+1`, `uploaded_by` = caller, `uploaded_at` = now; the optional `name`
  renames the document. The replacement may have another format (PDF → DOCX).
- The list shows the current version's `format`, `size`, `version`, `updated_at`/`updated_by` plus `version_count` and `allowed_actions` (`replace` disappears at 25 versions). `GET …/{doc}/versions` returns every
  version (≤ 25, no pagination). Download by number: `GET …/{doc}/versions/{n}/file`; the current one: `GET …/{doc}/file`.
- Version 26 → 409 `document_limit_reached` (`data.kind = "versions"`); a stale `expected_version` is answered first, with 409 `document_version_conflict`.

### Delete (D13, D14, D19)

`DELETE …/{doc}`: one transaction → `lockGates` + draft lock + authorize → select the version keys → delete the document (cascade removes versions; links to it
become `removed`) → `DocumentDeleted` → commit; then delete the files. 200 `{ scope }`. Unknown or foreign document → 404 `not_found`. Deleting a link:
`DELETE …/document-links/{link}` → `DocumentDeleted` with `kind = link`; the source is untouched.

### Replacement linking (S3; D16-D19, D22)

Applies to a process that is a replacement (vacancy-level) and to a carried participation (participation-level). Flow the frontend implements: open
«Documentos del proceso original» → `GET …/document-sources` → tick documents → `POST …/document-links` once per document.

- **Sources list** returns, grouped by origin, only real files the caller can read (D18). Vacancy-level: every earlier process of the chain
  (`sequence` lower), original first. Participation-level: the carried participation's ancestors, nearest first. Each document appears with its current
  version and `already_linked`. For a non-replacement process (or a participation that is not carried) the list is `200` with `sources: []` and `can_link: false`.
- **Link request** names the source document and optionally the version to pin (default: its current version). Validation order: manage on the target (404/403) → target is a
  replacement / carried participation (else 422 `document_link_invalid` `reason = "not_replacement"`; there is no stage check on the target participation, D3) → source document exists, is in company, **and the caller can read the source** (else 404 `not_found`, no leak) → source belongs to an
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
  lookup fails closed. The existing `cvs` `Reconcile` keep-predicate gains `OR EXISTS(placement_document_versions …)`. Scheduling is the accepted default of Q8, decided in P8; v1 ships the function and its integration test.

### Where the files go on a failure (D23)

| Failure | Result |
| --- | --- |
| Inspection fails (type, size, mismatch) | object deleted, 4xx, nothing in the database |
| Row insert / audit / commit fails | object deleted (`WithoutCancel`), 5xx |
| Commit outcome uncertain (connection lost) | object may remain: reconciled after the 1 hour grace |
| Authorization revoked between pre-flight and commit | object deleted, 404 `team_access_ended` / `not_found` |
| `Idempotency-Key` replay or conflict (found in the short transaction) | object deleted, frozen 201 (`Idempotency-Replayed: true`) / 409 `idempotency_conflict` |
| Stale `expected_version` (replace) | object deleted, 409 `document_version_conflict` |

## Endpoints

`V = /v2/me/company/job-drafts/{id}`; `P` is `V` (vacancy scope) or `V/participations/{pid}` (participation scope); both scopes share every shape below.
Reads are under the `requireDocumentReader` group, writes under the recruiter group (§«Authorization»). Errors are JSON `{error, code, data?}`; timestamps are
`YYYY-MM-DDTHH:MM:SS.ffffffZ`; users are `{ "id", "name" }` (as in `vacancy-team-v1`). No pagination: the scopes are capped (D15).

**Conventions the frontend can rely on** (L6):

- **`participation_id` is always present and never omitted**: in `items[]` (`null` for the vacancy scope, the participation id for a participation scope), in `links[].source` (`null` when the source is a vacancy document) and in `document-sources` groups. Zod can declare it `z.string().uuid().nullable()`, not optional.
- **The server says what can be done** (as `allowed_actions` in the lifecycle contract): items, links and the scope carry `allowed_actions`; the UI never derives permissions from role, state or counts.
- **Every write answers with the updated scope flags**, so the frontend does not re-read the list. Upload and replace answer 201 `{ "item", "scope" }`, link creation 201 `{ "link", "scope" }`, deleting a document or a link answers **200 `{ "scope" }`**
  (not 204: a delete frees a slot and the `upload` action may come back). `scope` is computed inside the write transaction, after the change.

**The `scope` object** (same shape in `GET P/documents` and in every write response):

```json
{
  "can_manage": true,
  "allowed_actions": ["upload", "link"],
  "upload_blocked_reason": null,
  "limits": {
    "max_bytes": 10485760, "max_documents": 50, "max_versions": 25,
    "formats": [
      { "format": "pdf",  "extensions": [".pdf"],           "content_type": "application/pdf" },
      { "format": "docx", "extensions": [".docx"],          "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      { "format": "xlsx", "extensions": [".xlsx"],          "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { "format": "jpg",  "extensions": [".jpg", ".jpeg"],  "content_type": "image/jpeg" },
      { "format": "png",  "extensions": [".png"],           "content_type": "image/png" }
    ]
  },
  "counts": { "documents": 3, "links": 1 }
}
```

- `can_manage` = the caller passes the manage gate (false for a stakeholder).
- `allowed_actions` ⊆ `upload`, `link`. `upload` ⇔ `can_manage` ∧ `documents + links < max_documents`. **`link`** ⇔ `can_manage` ∧ the scope can receive links (a replacement process / a carried participation, D17) ∧ `documents + links < max_documents`. A scope that is not a replacement never lists `link`.
- `upload_blocked_reason` is `"limit_reached"` when the caller can manage and the scope is full, otherwise `null` (enum closed in §«Error codes»). There is no eligibility reason (Q7, D3).
- `limits.max_documents` is 50 for the vacancy scope and 20 for a participation; `limits.formats` is the descriptor list the UI uses for `accept` and the copy (the extension list includes the dot, lower-case); `counts` are the files and links in the scope (the limit applies to their **sum**, D15).
- **Answer to the frontend's question (L6 point 3).** The sentence «the participation list response carries `can_upload`» of the first draft meant the **document list** of the scope (`GET P/documents`), never the board / participation payload. With Q7 there is no eligibility, so `can_upload` is **removed**: `scope.allowed_actions` and `upload_blocked_reason` replace it. The board and the participation list gain **no** document keys.

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
      "updated_by": { "id": "…", "name": "Luis Ortega" },
      "allowed_actions": ["download", "replace", "delete"]
    }
  ],
  "links": [
    {
      "id": "0193b7e0-…",
      "state": "available",
      "linked_at": "2026-11-22T10:00:00.000000Z",
      "linked_by": { "id": "…", "name": "Ana López" },
      "allowed_actions": ["download", "unlink"],
      "source": {
        "document_id": "0192f0aa-…",
        "process_id": "…",
        "sequence": 0,
        "participation_id": null,
        "name": "Contrato original",
        "format": "docx",
        "size": 91200,
        "version": 1,
        "version_count": 3,
        "uploaded_at": "2026-10-03T12:00:00.000000Z",
        "uploaded_by": { "id": "…", "name": "Ana López" },
        "has_newer_version": true
      }
    },
    { "id": "0193b7e1-…", "state": "removed", "linked_at": "…", "linked_by": { "id": "…", "name": "Ana López" }, "allowed_actions": ["unlink"], "source": null },
    { "id": "0193b7e2-…", "state": "inaccessible", "linked_at": "…", "linked_by": { "id": "…", "name": "Ana López" }, "allowed_actions": ["unlink"], "source": null }
  ],
  "scope": { "can_manage": true, "allowed_actions": ["upload", "link"], "upload_blocked_reason": null, "limits": { "…": "as above" }, "counts": { "documents": 1, "links": 3 } }
}
```

- Order: `items` by `updated_at DESC, id DESC`; `links` by `linked_at DESC, id DESC`.
- **`items[].allowed_actions`** ⊆ `download`, `replace`, `delete`: a manager gets all three, **except `replace` is omitted when `version_count` equals `limits.max_versions`**; a stakeholder gets `["download"]`.
- **`links[].allowed_actions`** ⊆ `download`, `unlink`: `available` → `["download", "unlink"]` for a manager and `["download"]` for a stakeholder; **`removed` and `inaccessible` → `["unlink"]`** for a manager and `[]` for a stakeholder (nothing to download, nothing to remove).
- `source` describes the **pinned** version: `source.version` is the pinned version number, `uploaded_at` / `uploaded_by` are that version's, `version_count` is the source document's current number of versions, and `has_newer_version` is `source current version > pinned`. `process_id` / `sequence` locate the origin (`sequence` 0 = original). `source` is `null` for `removed` and `inaccessible`.
- Errors: 404 `not_found` / `team_access_ended`. Listing reads only the database, so it never raises `document_storage_unavailable`.

### `POST P/documents`

Manage. `multipart/form-data`, parts: `file` (required, once) and `name` (optional, once, ≤ 2048 bytes before normalization). Optional header `Idempotency-Key` (below). Example:

```http
POST /v2/me/company/job-drafts/{id}/documents
Content-Type: multipart/form-data; boundary=…
Idempotency-Key: 6f1c1a56-0f3e-4a8e-9d5b-3b5d2f0c9a11

--…
Content-Disposition: form-data; name="name"

Contrato marco
--…
Content-Disposition: form-data; name="file"; filename="contrato.pdf"
Content-Type: application/pdf

%PDF-1.7 …
```

- **Request cap**: the body is limited to **10 485 760 + 65 536 = 10 551 296 bytes** (`http.MaxBytesReader`); the BFF applies the same number. A `file` part over 10 485 760 bytes is 413 `payload_too_large`, detected while streaming.
- **Empty file** (a `file` part of zero bytes) is **400 `validation_error`** with `fields: [{ "field": "file", "code": "empty" }]`, not `invalid_request`.
- **Name**: `name` (or, when absent, the file name's base) loses **one trailing known extension** (`.pdf`, `.docx`, `.xlsx`, `.jpg`, `.jpeg`, `.png`, case-insensitive) before `cvs.NormalizeName` (D11). `contrato.pdf` is stored as `contrato`. If nothing is left, a given `name` is `validation_error` `name`/`invalid`, and a defaulted one becomes `Documento`.
- Response **201** `{ "item": <document item of GET P/documents, version 1, version_count 1>, "scope": <scope object> }`. `Location` is **not** sent (no per-document GET in v1; the list is the read model).

**`Idempotency-Key` (optional)**, mirroring the draft/team/replacement semantics (`draftHandler.go` `requireIdempotencyKey`, `draftstore` `findIdempotency` / `lockIdempotencyKey`, table `job_draft_idempotency`):

- Absent → the upload is not idempotent (a double submit creates a second document) and no `Idempotency-Replayed` header is sent. `idempotency_key_required` is never raised.
- Present → exactly **one** header line, non-empty and a **UUID** in any spelling (canonicalized to lower-case hyphenated, so spellings share one lock, one row and one replay); otherwise 400 `invalid_idempotency_key`, answered **before the body is read**.
- Stored per `(company, actor, operation, key)` with operation `placement-document-upload:r1`, **no TTL**, no new table (`response_etag` is `""`); the insert is in the **same transaction** as the document rows and the audit event. A transaction-scoped advisory lock on the key serializes two racing requests.
- **Fingerprint** = SHA-256 over the canonical request: scope, `{id}`, `pid` (or none), the normalized name, and the SHA-256 of the file bytes (computed while streaming; the 10 MB body is never frozen). Same key + same fingerprint → **replay**; same key + different fingerprint → **409 `idempotency_conflict`**.
- Order: header check → pre-flight authorization → stream and inspect → short transaction (`lockGates`, `readDraft(lock=true)`, re-authorize) → **idempotency lookup, after re-authorization and before the limit check** (a revoked recruiter cannot replay; a replay does not re-check the limit) → limits → insert. On a replay or a conflict the object just stored is deleted.
- A replay answers **201 with the frozen `{item, scope}` body** and `Idempotency-Replayed: true`; it creates no row and **no second audit event**, and it works even if the document was deleted afterwards (it creates nothing). The scope flags in a replay are those of the first answer. A first execution answers `Idempotency-Replayed: false`. The header is projected only when a key was sent.

Errors:

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalid_request` | not multipart, missing/duplicate `file`, unknown part, `Content-Transfer-Encoding` |
| 400 | `validation_error` (`fields[{field:"file", code:"empty"}]`) | empty file |
| 400 | `validation_error` (`fields[{field:"name", code:"invalid"}]`) | `name` fails `NormalizeName` (control characters, empty, > 120 runes) |
| 400 | **`document_content_mismatch`** (`data: { detected_format, extension }`) | extension and detected bytes disagree |
| 400 | `invalid_idempotency_key` | `Idempotency-Key` repeated, empty or not a UUID |
| 404 | `not_found`, `team_access_ended` | gate (§Authorization); `pid` not in `{id}` |
| 409 | **`document_limit_reached`** (`data: { kind: "documents", limit }`) | 50 / 20 documents (files + links) |
| 409 | `idempotency_conflict` | same `Idempotency-Key`, different request |
| 413 | `payload_too_large` (`data: { max_bytes }`) | file > 10 485 760 bytes (or body over the request cap) |
| 415 | `unsupported_media_type` (`data: { formats }`, the same descriptors as `limits.formats`: `[{format, extensions[], content_type}]`) | extension not in the format table |
| 403 | `forbidden` | stakeholder (route group) |
| 503 | **`document_storage_unavailable`** | storage disabled or unreachable (nothing recorded) |

### `POST P/documents/{doc}/versions` (replace)

Manage. `multipart/form-data`, parts: `file` (required, once), `name` (optional, once: renames the document; same extension strip as upload) and **`expected_version`** (required, once, a decimal integer ≥ 1: the document's `version` the client saw).
The client should send `expected_version` and `name` before `file` so a stale replace is answered before the body is streamed; parts after `file` are still honored.

- If `expected_version` differs from the document's current (highest) version, the answer is **409 `document_version_conflict`** `data: { current_version }` and nothing is stored. The check runs as a cheap pre-flight before streaming and again under the draft lock before the insert, and **before** the version-limit check. A missing part is `validation_error` `expected_version`/`required`, a non-integer or < 1 value `expected_version`/`invalid`. Two replaces racing from the same `expected_version`: one wins, the other gets `document_version_conflict` (history never loses a version silently, unlike the first draft's last-writer-wins).
- Response **201** `{ "item": <updated document item, version n+1>, "scope": <scope object> }`. No `Idempotency-Key` (the version check makes a retry after a lost answer a visible 409, never a duplicate).
- Errors: those of upload (without the idempotency codes), plus 404 `not_found` when `{doc}` is not a document of this scope, 409 `document_version_conflict`, and 409 `document_limit_reached` (`data.kind = "versions"`). There is no eligibility check (D3).

**P5 notes (implemented).**

- **`expected_version` syntax**: ASCII digits only, 1 to 9 of them, value ≥ 1 (no sign, no space, no decimal point; `007` is 7). Anything else, including an empty part, is `validation_error` `expected_version`/`invalid`; only a missing part is `required`. A repeated `expected_version` part, or one that carries a file name, is 400 `invalid_request` (as a repeated `name`). With the file missing too, `invalid_request` wins (the structure is wrong before the value is).
- **Order of answers**: gates → `{doc}` is a vacancy document of this draft (404) → storage disabled (503) → the stream. An `expected_version` that arrives **before** the file is compared with the current version at once: stale → 409 `document_version_conflict`, then at the cap → 409 `document_limit_reached`, both without reading the file (an invalid file after a stale value is never inspected). One that arrives after the file is checked under the draft lock, after the object was stored (the object is then deleted). The check under the lock is the authority in both cases; the stale value always wins over the cap.
- **`renamed`** in `DocumentReplaced` is `true` only when a `name` was sent **and** differs from the stored name (the same name sent again is `false`). The name itself never goes in the audit row.
- A document deleted while its replacement streamed answers 404 `not_found` and the object is removed. The draft lock serializes a replace with every other write on the vacancy (another replace, a delete, an upload, a team change, a lifecycle move).

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

**P5 notes (implemented).** Read gate (stakeholders included); it reads only the database, so it works with the storage disabled; it is not audited. Ordered by version **number**, not by time (`is_current` is the highest number). A document of another vacancy or company, a participation document, or an unknown id is 404 `not_found`; a malformed `{id}`/`{doc}` is 400 `invalid_request`.

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

**Download file name** = the stored `name` + the extension of the **stored format of that version** (`.pdf`, `.docx`, `.xlsx`, `.jpg`, `.png`), by plain concatenation: a document uploaded as `contrato.pdf` (stored `contrato`) and replaced by a DOCX downloads as `contrato.docx`, never `contrato.pdf.docx` (D11).

**`Content-Disposition` is built with `mime.FormatMediaType("attachment", {"filename": …})`** (as the CV download, `cvs/handler.go:260`). For an ASCII name it emits `filename="…"` (quoted, `"` and `\` escaped) when the name is not a bare token (a space, a quote or a backslash), and the unquoted `filename=Oferta.docx` when it is one (both forms are RFC 6266 valid, and the CV download behaves the same; implemented in P4 and pinned by `documents_download_integration_test.go`). For a name with accents or `ñ` (any non-ASCII) it emits the RFC 5987 / 2231 form
`filename*=utf-8''Informe%20a%C3%B1o%202026.pdf` **instead of** `filename=` (there is no ASCII fallback parameter; the charset token is lower-case `utf-8`, which RFC 5987 treats case-insensitively). A client or BFF must prefer `filename*` and percent-decode it as UTF-8, and pass the header through unchanged.

A failure after the 200 (the connection or storage drops mid-stream) leaves a truncated body against `Content-Length` and the audit row recorded, as for CVs.

**P5 notes (implemented).** `GET …/{doc}/versions/{n}/file` follows exactly the same order, headers and audit as the current-version download; `DocumentDownloaded` carries the `version_id` and `version` it served. `{n}` must be a positive decimal integer of at most 9 digits (otherwise 400 `invalid_request`, nothing recorded); a version the document does not have, however high, is 404 `not_found` (nothing recorded). The download name uses the format of **that** version (a PDF that was replaced by a DOCX downloads as `….pdf` for version 1 and `….docx` for version 2).

**P4 notes (implemented).** `{doc}` that is not a uuid is 400 `invalid_request` (as a malformed `{id}`); a document that is not in this vacancy scope (another vacancy, another company, a participation document) is 404 `not_found`; a document whose file is **missing from storage** is 404 `not_found` (nothing recorded); storage disabled or failing is 503 `document_storage_unavailable` after the gates (nothing recorded); a failed audit append serves nothing, closes the opened stream and answers the generic 500.

### `DELETE P/documents/{doc}`

Manage. **200** `{ "scope": <scope object> }` (D13). Errors: 404 `not_found` / `team_access_ended`, 403 `forbidden` (stakeholder). No `If-Match`: a delete of an already deleted document is a plain 404 (no precondition needed).

**P5 notes (implemented).** One transaction: gates, draft lock, authorization, the storage keys of every version and the number of links that will lose their source, `DELETE` of the document row (versions cascade, links keep their row with `NULL` sources and become `removed`), the scope after the change, `DocumentDeleted` (`kind = file`, `version_count`, `linked_count`, ids only), commit. **Only after the commit** the service deletes each file (best effort, `context.WithoutCancel`); a file that cannot be deleted is logged and left as an orphan for `Reconcile` (after the 1 hour grace) and the answer is still `200 {scope}`: the delete is final and the audit row outlives the file. A failed audit append rolls the whole delete back (rows and files stay). Delete works with the **storage disabled** (the rows go; nothing to remove), unlike the routes that move a file: S6 must always be possible. The scope in the answer reflects the freed slot (`upload` returns, `upload_blocked_reason` becomes `null`). Racing deletes: one 200, the others 404, one audit event.

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

`participation_id` is the ancestor participation for the participation scope and `null` for the vacancy scope (always present). Processes/participations with no readable documents are omitted. `can_link` equals `"link" ∈ scope.allowed_actions`: false when
the target is not a replacement / not a carried participation (then `sources` is `[]`), the caller cannot manage, or the scope is full.

### `POST P/document-links`

Manage. Body `application/json`:

```json
{ "source_document_id": "0192f0aa-…", "version": 1 }
```

`version` is optional (default: the source's current version at that moment). Response **201** `{ "link": <link item of GET P/documents, links[]>, "scope": <scope object> }`. No `Idempotency-Key` and no `If-Match`: a repeated request is `document_already_linked`. Errors:

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalid_request` | not JSON, unknown key, `source_document_id` not a uuid, `version` not an integer ≥ 1 |
| 404 | `not_found`, `team_access_ended` | target gate; source document missing, foreign company or **not readable by the caller** (no leak) |
| 409 | **`document_already_linked`** (`data: { link_id }`) | same source document already linked in this scope |
| 409 | **`document_limit_reached`** (`data: { kind: "documents", limit }`) | 50 / 20 (files + links) |
| 422 | **`document_link_invalid`** (`data: { reason }`) | `not_replacement`, `source_not_in_chain`, `version_not_found` |

### `DELETE P/document-links/{link}`

Manage. **200** `{ "scope": <scope object> }`; the source is untouched; audited as `DocumentDeleted` with `kind = link`.

### `GET P/document-links/{link}/file`

Read. Streams the **pinned** version through the same audited path as a normal download (the event's `document_id`/`version_id` name the source; `link_id` is added; the download file name follows the same rule, built from the source's name and the pinned version's format). 404 `not_found` when the link is
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

Success bodies: upload and replace 201 `{item, scope}`; link 201 `{link, scope}`; both deletes 200 `{scope}`; lists and downloads as above. Upload alone takes the optional `Idempotency-Key`; replace takes the required `expected_version` part.

The `document-sources` / `document-links` segments are literal siblings of `documents`, so no UUID segment can collide with them in the router.

**P6 notes (implemented): participation scope.** `documents`, `documents/{doc}`, `…/{doc}/versions`, `…/{doc}/file` and `…/{doc}/versions/{n}/file` are registered under both prefixes (14 routes: 7 per scope), the same handlers, the same gates and the same `NoStore` groups (writes in the recruiter group, reads in the reader group); the `{pid}` URL parameter is the only thing that makes the scope a participation. `document-sources` / `document-links` are P7 (see «P7 notes»).

- **The only participation rule** is `process_participations.id = {pid} AND process_id = {id}` (and the process in the session company). It is evaluated **after** the vacancy authorization (so a caller who may not touch the vacancy never learns whether a `pid` exists: 404/`team_access_ended`/403 come first), **inside** every transaction (read snapshot, download, and under the draft lock for upload, replace and delete) and in the pre-flights, so a wrong `pid` is refused before one byte is stored. Anything else is 404 `not_found` with the generic envelope: a `pid` that does not exist, of another vacancy, of another company, or any `pid` of a never-published draft (it has no process, hence no participations). Stage, hire credit and discarded state play no role; the process may be closed or finished (S4).
- A malformed `{pid}` is 400 `invalid_request` (as a malformed `{id}` or `{doc}`); a `pid` that is not the process's is never judged before the vacancy gates.
- **The scopes never mix.** Every query filters `participation_id IS NOT DISTINCT FROM {pid}` (NULL for the vacancy scope): the vacancy list never shows a participation document, a participation list shows only its own, and a document answers (download, versions, replace, delete) only through its own scope; through any other scope it is 404 `not_found` and nothing changes. Counts and limits are per scope: **20** documents per participation (files **plus** links, `limits.max_documents = 20`), **50** per vacancy, 25 versions per document; a replace at the limit still works, a delete frees one slot.
- `items[].participation_id` is the `pid`; `scope.allowed_actions` lists `link` only on a **carried** participation (`carried_from_participation_id` set, D17) and only for a manager; the stage never changes any flag. Participation-level link rows (P7) are listed in `links[]` of their own participation only.
- **Audit.** The same five events with `scope = "participation"` and `participation_id` set (ids and enums only, no file name); the event's `VacancyID` stays `{id}` and the entity is the document. A vacancy document's events keep `scope = "vacancy"` and no `participation_id` key.
- **Idempotency.** The fingerprint already includes the scope and the participation id: the same key and file under another participation or under the vacancy is 409 `idempotency_conflict`, never a replay.
- Pool access (`/v2/me/company/candidates/*`) has no document route and grants nothing (D5); a test walks the production route table and fails if any route containing `/documents` sits outside the two prefixes.

**P7 notes (implemented): replacement linking.** The four routes (`document-sources`, `document-links`, `document-links/{link}`, `document-links/{link}/file`) are registered under both prefixes (8 routes; 22 `/document…` routes in all), `POST` and `DELETE` in the recruiter group (a stakeholder is the ladder's 403) and the two `GET` in the reader group, all `NoStore`. The same handlers serve both scopes; the `{pid}` URL parameter makes the scope a participation, and the P6 pid rule runs first (404 for a wrong `pid`).

- **Chain and ancestry** are read straight from `vacancy_replacements` (vacancy scope: the processes of the same `root_process_id` with a lower `sequence`, original = 0) and from `process_participations.carried_from_participation_id` (participation scope: a recursive walk, nearest ancestor first, bounded at 64 hops). Vacancy documents are never sources of a participation and participation documents are never sources of a vacancy-level link (both are `source_not_in_chain`). The list orders groups by `sequence` ascending (original first) or by ancestry depth, and the documents of a group by the pinned-version time (`updated_at`) descending.
- **Source access (D18)** is the vacancy read rule applied to the SOURCE's vacancy: the owner and every stakeholder read every source of the company; a recruiter reads only the vacancies they hold an **active tramo** on (`vacancy_assignments.ended_at IS NULL`). It is evaluated in SQL on every list, link and download, so losing the source team makes the link `inaccessible` at once. `can_link` is computed from the scope's own `link` action; a stakeholder still lists sources (`can_link: false`).
- **`POST` body**: one JSON object, no unknown key, nothing after it, at most 4 096 bytes; `source_document_id` a non-nil uuid; `version`, when present, a decimal integer 1-999 999 999 (an explicit `null`, a string, a decimal or an exponent is invalid). Every violation is 400 `invalid_request`, answered before anything is looked up. No `Content-Type` check.
- **Validation order** is the one above (target → source exists and readable → chain → version → already linked → limit) and runs inside one transaction under the target's draft lock; the source document row is held `FOR SHARE` until the commit, so a concurrent delete of the source waits and then leaves the new link `removed`, and a source deleted first is a plain 404. **Already linked wins over the limit.** A `removed` link still counts toward the 50/20 limit until it is unlinked.
- **No storage needed** to list sources, link, unlink or list: they only touch rows. `GET …/file` is 404 (unknown, other scope, `removed`, `inaccessible`) first, then 503 `document_storage_unavailable` when the storage is disabled or failing, then 404 when the file is gone.
- **Audit.** `DocumentLinked` (entity = the link id; `source_document_id`, `source_version_id`, `source_vacancy_id` and, for a participation document, `source_participation_id`), `DocumentDeleted` `kind = link` (entity = the link id; only `link_id`, no document id) and `DocumentDownloaded` through a link (entity = the SOURCE document; `document_id`/`version_id` are the source's, `link_id` is added, `scope`/`participation_id` are the target's) are written in the same transaction as the change; a failed append rolls the link, the unlink or the download back. Linking and unlinking after closure are audited the same way and leave the vacancy byte-identical (S4).
- **Unlink** is `DELETE …/document-links/{link}` → 200 `{ "scope": … }` (the freed slot brings `upload` and `link` back); a link of another scope, another vacancy or another company, a malformed-but-unknown id and a repeated unlink are 404 `not_found` (a malformed id is 400 `invalid_request`). The source, its versions and its files are never touched.

## Error codes

New codes live in a new `internal/shared/httpjson/document_errors.go` resolved from `Resolve` like `resolveReplacementError`, added to the catalog code tests. Where a generic code exists it is reused.

| Code | Status | `data` | Where |
| --- | --- | --- | --- |
| `document_content_mismatch` | 400 | `{ detected_format: "pdf" \| "docx" \| "xlsx" \| "jpg" \| "png" \| null, extension: ".pdf" }` | upload, replace (extension vs bytes). `detected_format` is the format the bytes decide, `null` when they match no accepted format; `extension` is the file name's extension, lower-cased, with the dot, `""` when there is none |
| `document_limit_reached` | 409 | `{ kind: "documents" \| "versions", limit }` | upload, link (documents), replace (versions) |
| `document_version_conflict` | 409 | `{ current_version }` | replace: `expected_version` differs from the document's current version |
| `document_already_linked` | 409 | `{ link_id }` | POST document-links |
| `document_link_invalid` | 422 | `{ reason: "not_replacement" \| "source_not_in_chain" \| "version_not_found" }` | POST document-links |
| `document_storage_unavailable` | 503 | — | upload, replace, download, link download (storage disabled or failing); the list never raises it |
| existing, reused as is | | | `not_found` 404, `team_access_ended` 404, `forbidden` 403, `validation_error` 400 + `fields[]`, `invalid_request` 400, `unsupported_media_type` 415 (`data.formats`), `payload_too_large` 413 (`data.max_bytes`), `unauthenticated` 401, `internal_error` 500; for the upload's optional `Idempotency-Key`: `invalid_idempotency_key` 400 and `idempotency_conflict` 409 (`httpjson.CodeInvalidIdempotencyKey`, `CodeIdempotencyConflict`, same semantics as drafts; `idempotency_key_required` is **never** raised, the key is optional) |
| **not used** | | | `process_finished`, `vacancy_not_published`, `cv_*` (S4 and D27); `document_upload_not_allowed` and the `not_in_placement` reason do not exist (D3, Q7) |

`unsupported_media_type` and `payload_too_large` exist as generic catalog codes (`site_errors.go`, `errors.go`); the document handlers add `data` through the same writer the replacement family uses, so the catalog tests must allow it for these two codes.

**Closed enums** (every enum the frontend decodes; an unlisted value is a contract violation):

| Where | Values |
| --- | --- |
| `items[].format`, `versions[].format`, `source.format`, `limits.formats[].format`, `data.detected_format` | `pdf`, `docx`, `xlsx`, `jpg`, `png` (`detected_format` also `null`) |
| `links[].state` | `available`, `removed`, `inaccessible` |
| `items[].allowed_actions[]` | `download`, `replace`, `delete` |
| `links[].allowed_actions[]` | `download`, `unlink` |
| `scope.allowed_actions[]` | `upload`, `link` |
| `scope.upload_blocked_reason` | `limit_reached` or `null` (`null` when the caller cannot manage: the missing `upload` action is then explained by `can_manage = false`) |
| `document_limit_reached` `data.kind` | `documents`, `versions` |
| `document_link_invalid` `data.reason` | `not_replacement`, `source_not_in_chain`, `version_not_found` |
| `validation_error` `fields[].field` / `code` | `name` / `invalid`; `file` / `empty`; `expected_version` / `required` \| `invalid` |

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
3. **Frontend after**: BFF routes for upload (streaming multipart, request cap exactly 10 485 760 + 65 536 = 10 551 296 bytes), download (streaming, no buffering; pass through `Content-Disposition`, which carries `filename*` for
   non-ASCII names, and `Content-Length`) and the JSON ones; the screens; the audit `ANNEX` labels. The frontend may start against the contract with mocks; it merges **after** the backend branch.
4. **Deployment note: adding a `format` value requires the frontend to accept it first.** The enum `format` (`pdf | docx | xlsx | jpg | png`) is closed in v1 (Q1). If `.doc`/`.xls` or any other format is ever added, the frontend schema must
   accept the new value **before** the backend starts returning it (an unknown enum value in a `.strict()` / `z.enum` schema fails the whole list). The «backend first, nothing to coordinate» of step 1 holds only for the v1 enum.

## Slices

Each ≤ ~400 changed lines where possible; every slice ships tests, the HTTP ones through the production router. Order matters. Revised after the frontend review (L6): the participation rule shrank (no eligibility, D3) while the
write responses grew (scope object, `allowed_actions`, idempotency, `expected_version`), so the old P3 was split.

1. **P1 · Migration and domain** (~300): `00064_placement_vacancy_documents.sql` (+ guarded down), migration integration test (constraints, `SET NULL` cascade, down guard); the new documents
   application package: limits, formats, `Inspect` over head + tail window (PDF/JPG/PNG/OOXML, mismatch, tail-window miss), name normalization via `cvs.NormalizeName` plus the known-extension strip and the download-name rule (D11), the `limits.formats` descriptors, unit tests. No routes.
2. **P2 · Storage and config** (~400): the streaming `Storage` port, local adapter, `LoadDocumentStorageConfig` (+ tests), the S3 adapter (+ MinIO integration test skipped without `DOCUMENT_S3_TEST_ENDPOINT`, like the
   site-media one), `Reconcile` with the grace window and the `cvs` keep-predicate extension, composition in `cmd/api/main.go`. May need `github.com/aws/aws-sdk-go-v2/feature/s3/manager`
   (not in `go.mod` today): **a dependency change the parent must authorize**; see A2. Split the S3 adapter into P2b if over budget.
3. **P3 · Foundations and list** (~350): error family `document_errors.go` (§«Error codes», closed enums), the new read gate and `authorizedRead` (D4, D6: no process row), the audit catalog in its four places for the five events (constants, specs,
   Annex rows and `audit-log-v1.md`, frontend note), the `scope` builder (`can_manage`, `allowed_actions`, `upload_blocked_reason`, `limits.formats`, `counts`) and the item/link `allowed_actions`, `GET V/documents`, tests (gates matrix of §Authorization
   including a stakeholder on a never-published draft, draft state, pool access grants nothing, `allowed_actions` per role/state, `participation_id` always present).
4. **P4 · Upload and download** (~400): `POST V/documents` (multipart, request cap 10 485 760 + 65 536, empty file → `validation_error`, extension strip, optional `Idempotency-Key` with frozen replay in `job_draft_idempotency`, `{item, scope}` response,
   `DocumentUploaded`), `GET …/file` with the audited download before streaming and the `mime.FormatMediaType` headers, tests (finished state byte-identical, failure table, replay/conflict/invalid key, `document_content_mismatch` data, non-ASCII `filename*`).
5. **P5 · Versions and delete** (~400): replace with the required `expected_version` part → 409 `document_version_conflict`, version list, download by version, delete (rows first, files after, `200 {scope}`), `DocumentReplaced` / `DocumentDeleted`, limits,
   tests (stale `expected_version`, concurrent replaces, `replace` absent from `allowed_actions` at 25 versions, delete orphan on storage failure, audit outlives).
6. **P6 · Participation documents** (~250; implemented, see «P6 notes» under the route summary): the same endpoints under `V/participations/{pid}`, the «`pid` belongs to `{id}`» rule (no stage check, D3), tests (every stage including discarded, after closure and finished, wrong `pid` → 404, stakeholder read, pool grants nothing).
7. **P7 · Replacement linking** (~400; implemented, see «P7 notes» above «Error codes»): `document-sources`, `document-links` (create, delete, file) with `{link, scope}` / `{scope}` responses, chain/ancestor resolution, `state` rules and link `allowed_actions`, `links[].source` with `uploaded_at`, `uploaded_by`, `version_count`,
   `DocumentLinked`, tests (source deleted → removed, source access lost → inaccessible, pinned version, limits, links of links impossible, `link` in the scope `allowed_actions`).
8. **P8 · Hardening and reconciliation** (~200): `Reconcile` wiring decision (Q8), configuration docs, end-to-end test through the router with the local and the S3 adapters, final run of the full backend suite.

## Decisions status

The nine open questions of the first draft. The user answered Q1, Q3, Q5, Q6, Q7 and Q9 on 2026-11-22 (L5); those are **closed** and applied in the
decisions above. Q2, Q4 and Q8 were not contested: their recommendation stands as an **accepted default**.

**Closed (user answers, verbatim)**

- **Q1 · Legacy `.doc` / `.xls`.** «Solo .docx y .xlsx (Recomendado)». Applied in D8: only PDF, DOCX, XLSX, JPG, PNG. Adding `.doc`/`.xls` later is a new decision and, because it adds
  values to the `format` enum, the frontend must accept them first (§«Deployment order»).
- **Q3 · Stakeholder and unpublished drafts.** «También de borradores». Applied in D6 and §«Authorization»: a stakeholder reads the documents of **every vacancy of the organization**,
  never-published drafts included; the read gate does not require a process row.
- **Q5 · Limits.** «Esos límites, sin renombrar (Recomendado)». Applied in D15: 50 documents per vacancy, 20 per participation (files + links), 25 versions per document.
- **Q6 · Rename.** Same answer, «Esos límites, sin renombrar (Recomendado)». Applied in D12: no standalone rename, no `DocumentRenamed` event.
- **Q7 · Participation documents and stage.** «En cualquier etapa del proceso». Applied in D3: a participation document (or link) can be added at **any stage** of a participation of that process;
  there is no Placement eligibility, no `not_in_placement` reason and no `document_upload_not_allowed` code.
- **Q9 · Malware scanning.** Decided by the user (L5): the antivirus decision is taken **before the first real customer**; not in v1. (The feature doc records the decision, not a quoted phrase.)
  Documents are served only as downloads, never inline, which limits but does not remove the risk.

**Accepted defaults (recommendation stands)**

- **Q2 · Retention of previous versions.** The business rules say previous versions follow a retention/deletion policy that is not defined. Recommendation (D7): keep up to 25 versions until the whole document is deleted (v1 offers no per-version delete); define a time-based policy before production.
- **Q4 · Linked document whose source the viewer cannot read.** Recommendation (D18): strict: the link shows as `inaccessible` with no name/size/download. The alternative (the link grants access to the pinned version to everyone who can read the target) is simpler but turns «link» into a way around source access, which S3 forbids.
- **Q8 · Who runs `Reconcile` and when.** Recommendation (D25): once at startup (after the 1 hour grace the in-flight uploads of the previous instance are safe to judge) plus a daily in-process ticker with a Postgres advisory lock so only one Fargate task runs it; decide in P8.

## Assumptions made in this draft (flag in review)

- **A1** The stakeholder UI hides every write control from `can_manage` / `allowed_actions`; a stakeholder reaches the documents of a never-published draft only if it knows the draft id (there is still no stakeholder draft surface) (D6).

- **A2** The AWS SDK version in `go.mod` (`service/s3 v1.78.2`) can upload an unseekable body over TLS without buffering it (trailing checksums), or the `feature/s3/manager` uploader may be added; if neither works against MinIO in P2, the S3 `Put` falls back to a bounded ≤ 10 MiB buffer behind a semaphore (the local adapter and `Open` stay streaming).
- **A3** `job_drafts` rows are never hard-deleted by the application (only the metrics demo tool does), so the plain `REFERENCES job_drafts(id)` needs no cascade; if a draft delete is ever added it must delete documents and their files first.
- **A4** The documents of a draft with a v1 schema are not reachable (the shared v2 gate answers `not_found`), as every other v2 draft route.
- **A5** The BFF forwards uploads/downloads without buffering and applies the exact request cap of §«Formats, size and inspection» (10 485 760 + 65 536 = 10 551 296 bytes) (frontend work, T3+).
- **A6** A recruiter who is a team member of a replacement but never of the source cannot read the source's documents (strict D18), even if they are the replacement's responsible.
- **A7** Document operations do not send notifications and are not shown in the vacancy event history, only in the audit log.

## Out of scope (v1)

Public or candidate-visible documents; automatic copying of documents into a replacement (S3 forbids); inline preview or thumbnails; standalone rename (D12); per-version delete and retention timers (Q2); folders, tags, descriptions, search or sorting
options; bulk upload (one file per request) and resumable uploads; presigned URLs; image re-encoding or EXIF stripping (D10); legacy `.doc` / `.xls` / `.ppt` (Q1, closed); malware scanning (Q9, decided before the first real customer); e-signature; stakeholder writes; notifications;
documents on the candidate-managed profile or the global talent pool; changes to the CV library, the manual intake CV or any existing response shape.
