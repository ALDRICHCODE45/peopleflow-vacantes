# Placement and vacancy documents (backend)

Backend half of the 2 Oct 2026 agreement «Documentos de placement y de vacante». Branch
`feat/placement-vacancy-documents-backend` (worktree `../peopleflow-vacantes-documents`). Frontend in its own session.
Contract: `docs/contracts/placement-vacancy-documents-v1.md` (draft first, reviewed by the frontend before implementation).

## Specs

- **S1** Business rules (verbatim, `odd/discovery/recruitment-business-rules.md` «Personal data and documents»):
  «Placement supports multiple user-chosen documents per candidate participation/process, such as contracts or CVs
  [...] These are internal process documents, not public attachments or automatic additions to the candidate-managed
  profile.» «Propietario and recruiters authorized for the vacancy may manage candidate process documents; Stakeholder
  may consult them read-only within the organization. General shared candidate-pool access does not grant access to
  another process's documents.»
- **S2** Vacancy-level documents (verbatim): «Also support multiple internal documents at vacancy level (for example,
  vacancy-related contracts) for convenient team access, separate from candidate-specific attachments. Apply the same
  access model [...] They must not become public vacancy attachments. Vacancy-level documents can be uploaded starting
  in draft and throughout the process, without waiting for Placement.»
- **S3** Replacements (verbatim): «Replacement processes do not automatically copy original-process documents.
  Authorized users can consult source documents and explicitly choose which to link to the replacement, preserving
  source and version references. Linking does not bypass source access or retention/deletion rules.»
- **S4** After closure (verbatim): «Authorized users may attach vacancy-level and candidate-process documents after
  closure without reopening the process or changing its metrics. Preserve the same access permissions and audit the
  attachment. This does not authorize other post-closure business edits.»
- **S5** Formats and size — user 2026-11-22: «PDF, Word, Excel, JPG/PNG · 10 MB (Recomendado)» («Cubre contratos, CVs,
  escaneos y hojas de cálculo; 10 MB por archivo.»). Content is checked by magic bytes, never by the client MIME type.
- **S6** Delete — user 2026-11-22: «Propietario y reclutadores; auditado (Recomendado)» («Los mismos que lo pueden
  subir. El borrado queda en la auditoría y el Stakeholder solo consulta.»).
- **S7** Storage works on local disk and on S3 (the AWS test environment runs on Fargate, whose disk is ephemeral).

## Tasks

- T1 S1–S7 — contract draft `docs/contracts/placement-vacancy-documents-v1.md` (writer) — done (uncommitted)
- T2 — contract agreed with the frontend session — pending
- T3+ — implementation slices from the contract's «Slices» — pending

## Log

- **L1** 2026-11-22, user: «Bien hermano, vamos a realizar todos los pendientes que mencionas por favor, coordinate con
  el frontend para realizar lo que se tenga que realizar (tu haciendo el backend y el haciendo el frontend)».
- **L2** 2026-11-22, user decisions: documents «PDF, Word, Excel, JPG/PNG · 10 MB (Recomendado)»; delete «Propietario y
  reclutadores; auditado (Recomendado)»; production «No, todavía no hay prod»; AWS «Sí, ya está la cuenta».
- **L3** 2026-11-22, exploration map (reuse):
  - Storage port `candidates/application/cvs/library.go:37-44`; local adapter `candidates/infrastructure/storage/local.go`
    (`os.Root`, 64-hex keys, `Put` caps at `cvs.MaxBytes` 5 MB `:48`); S3 adapter only for site media
    `companysites/infrastructure/storage/s3/storage.go` (buffers whole object on Open, 5 MiB cap `:95-110`).
  - Magic-byte inspection `cvs/content.go:32-62`, `NormalizeName` `:63-80`; streaming multipart upload
    `cvs/handler.go:57-149`; file-then-row with deferred delete `candidates/infrastructure/postgres/cvs/library.go:81-133`.
    `Reconcile` (`library.go:211-225`, tests only) would delete unknown keys if ever wired: must learn document keys.
  - Download headers `cvs/handler.go:250-265` + `httpjson.AttachmentFilename`; audited download commits the audit row
    before streaming `board/store.go:534-585`.
  - Authorization: `draftstore/store.go:466-468` (`owner || activeTeamMember`), `lockGates` `:421-462`,
    `draftAccessError` `team.go:19-32`. Stakeholders have NO vacancy route today (only `RequireMetricsViewer`,
    `requireCompanyRole.go:78-86`); a read gate owner+recruiter+stakeholder is new (`requireCompanyMember(…, allowed)`
    `:89`). Board `beginTx` needs a process row (`board/store.go:62-66`) and `beginMutation` rejects finished processes
    (`:77-85`): vacancy documents key on `job_drafts.id`, and post-closure uploads must not use `beginMutation`.
    Document routes must not live under `/v2/me/company/candidates` (pool access ≠ process documents).
  - Audit: new event = constant + `spec` row in `audit_events/domain/entities/catalog.go`, Annex row in
    `docs/contracts/audit-log-v1.md`, frontend `ANNEX` (`frontend/src/features/audit-log/model.ts`, count 70 pinned in
    `model.test.ts:75`); metadata keys are ids/enums only (no filenames). No audited file delete exists yet.
  - Placement = stage kind `placement`; credits `board/credits.go:23`; replacements `00063` (`process_id` = draft id);
    next migration `00064`; migration test pattern `db/migrations/migration_00063_integration_test.go`; contract layout
    `docs/contracts/replacement-processes-v1.md`.
- **L4** 2026-11-22, T1 done (uncommitted): contract `docs/contracts/placement-vacancy-documents-v1.md`, status «Draft — pending frontend
  review», covers S1–S7. 27 decisions (D1–D27) marked for challenge; key ones: one model for both scopes, migration `00064` additive
  (`placement_documents`, `placement_document_versions`, `placement_document_links`); participation upload allowed when the participation sits in
  Placement or holds a credit `active`/`did_not_hold`, also after closure, replace/delete exempt (D3); manage = owner + active team, read adds
  stakeholders via a new read gate, stakeholders only for vacancies with a process row (D4, D6); versions kept until the document is deleted,
  max 25 (D7); PDF/DOCX/XLSX/JPG/PNG, 10 485 760 bytes, legacy `.doc`/`.xls` rejected (D8), streaming inspection with head + 2 MiB tail window (D9),
  images stored as uploaded (D10); no standalone rename (D12); hard delete, rows first then files, audit outlives (D13); limits 50/20 documents
  (files + links) and 25 versions (D15); links pinned to a source version, strict source access, deleted source → link `removed` (D16–D19);
  5 audit events `DocumentUploaded/Replaced/Deleted/Linked/Downloaded`, download audited before streaming (D20, D21); new `document_*` error codes
  only where no generic one exists (D27); separate storage port streaming on `Put`/`Open`, `DOCUMENT_STORAGE=disk|s3` + `DOCUMENT_*` vars, reconcile
  by age 1 h instead of advisory lock (D24, D25). Deployment: backend first (no existing response changes). Slices P1–P7.
  Open questions (with recommendation in the contract): Q1 legacy .doc/.xls, Q2 version retention, Q3 stakeholder on unpublished drafts, Q4 linked
  doc with unreadable source, Q5 limits, Q6 rename, Q7 uploads for never-hired participations, Q8 who schedules Reconcile, Q9 malware scanning.
  Risk: S3 `Put` of an unseekable body may need `feature/s3/manager` (new dependency, parent must authorize) — assumption A2. Next: T2 frontend review.
- **L5** 2026-11-22, user answers to the contract's open questions: Q1 «Solo .docx y .xlsx (Recomendado)»; Q3
  stakeholder «También de borradores» (reads documents of every vacancy of the organization, drafts included —
  overrides D6); Q7 «En cualquier etapa del proceso» (participation documents can be uploaded at any stage, not only
  Placement — overrides D3); Q5/Q6 «Esos límites, sin renombrar (Recomendado)» (50 per vacancy, 20 per participation,
  25 versions, no rename; antivirus decided before the first real customer, Q9). Q2, Q4, Q8 keep the recommendation.
