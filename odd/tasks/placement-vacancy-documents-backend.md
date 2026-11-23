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

- T1 S1–S7 — contract draft `docs/contracts/placement-vacancy-documents-v1.md` (writer) — done 377c06d8
- T2 — contract agreed with the frontend session — done (L8)
- T3 P1 — migration 00064 and documents domain (writer) — pending
- T4 P2 — storage port, adapters, config (writer; S3 manager dependency needs user OK) — pending
- T5 P3 — errors, read gate, audit catalog, scope, GET list — pending
- T6 P4 — upload and download — pending
- T7 P5 — versions and delete — pending
- T8 P6 — participation documents — pending
- T9 P7 — replacement linking — pending
- T10 P8 — hardening, reconcile, full suite — pending

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
- **L6** 2026-11-22, frontend review (verbatim, «aprobado con cambios»): «1) Acciones por item, como en lifecycle
  `allowed_actions` [...] Item: `allowed_actions: ("download"|"replace"|"delete")[]`; si `version_count` llega a
  `max_versions`, que no venga replace. Link: `("download"|"unlink")[]`; un link removed o inaccessible solo trae
  ["unlink"]. Scope: `allowed_actions: ("upload"|"link")[]`, y se mantiene `upload_blocked_reason`. 2) El GET de la lista
  tiene que decir si se puede vincular [...] 3) El link valida Placement (D3) sobre la participación destino [...]
  Aclarame también si «The participation list response carries `can_upload`» se refiere a la lista de documentos o al
  payload del tablero. 4) A `links[].source` le faltan `uploaded_at`, `uploaded_by` y `version_count` [...] los 201 dejan
  `can_upload` y `limit_reached` desactualizados: que devuelvan los flags del scope o que el contrato diga que el
  frontend re-lee la lista. 5) La cadena de reemplazos con links explícitos y `has_newer_version` está bien, sin
  cambios. 6) Upload: OK multipart directo [...] tope de 10_485_760 + 65_536 bytes. 7) D11, nombre por defecto: ¿se quita
  la extensión? Propongo quitar la extensión conocida al subir y que el ícono salga de `format`. [...] 8) Descarga:
  confirmá `filename*=UTF-8''…` (RFC 5987) para acentos y ñ. 9) D26 saca Idempotency-Key e If-Match [...] Propuesta:
  Idempotency-Key opcional en el upload; en replace, una parte `expected_version` que devuelva 409
  `document_version_conflict`; delete sin If-Match está bien; para link alcanza `document_already_linked`. 10) Errores:
  (a) el archivo vacío que sea `validation_error fields[{field:"file",code:"empty"}]`, no invalid_request; (b)
  `document_content_mismatch` con `data:{detected_format, extension}`; (c) `limits.formats: [{format, extensions[],
  content_type}]` [...]; (d) cerrá en la tabla de errores los enums de `upload_blocked_reason` y `data.reason`. 11) Zod:
  confirmá que `participation_id` siempre viene (null en el scope de vacante) y nunca se omite. Si después se suman .doc
  o .xls (Q1), el enum `format` necesita que el frontend acepte los valores nuevos primero, pese a lo que dice
  §Deployment.» Backend decision: accept all 11. Point 3 is moot after L5 Q7 (any stage; D3 eligibility removed, the
  only participation rule left is "a participation of this process"). Point 7: strip a known extension from the name at
  upload/replace, download name = name + extension of the stored format (fixes x.pdf.docx). Point 8: yes, RFC 5987 via
  `mime.FormatMediaType`. Point 9: optional Idempotency-Key on upload (same semantics as drafts), `expected_version` part
  on replace → 409 `document_version_conflict`.
- **L7** 2026-11-22, T2: contract `docs/contracts/placement-vacancy-documents-v1.md` revised for L5 and L6 (uncommitted; status «Draft — frontend
  review applied, pending final OK»). Changes:
  - L5: Q1 closed (only .docx/.xlsx); Q3 → D6 and the authorization matrix rewritten (stakeholder reads every vacancy of the organization, never-published
    drafts included; `authorizedRead` needs no process row); Q7 → D3 rewritten (participation documents at any stage, only «`pid` belongs to `{id}`»;
    `not_in_placement`, `document_upload_not_allowed` and the Placement eligibility removed, discarded participations included); Q5/Q6 closed (50/20/25, no rename);
    Q9 recorded (antivirus before the first real customer). «Open questions» became «Decisions status» (closed answers verbatim; Q2, Q4, Q8 accepted defaults).
  - L6 1-2: `allowed_actions` on items (`download|replace|delete`, no `replace` at max versions), links (`download|unlink`, removed/inaccessible → `unlink`) and scope
    (`upload|link`); `upload_blocked_reason` kept (`limit_reached | null`). L6 3: `can_upload` was the document list's flag; removed (replaced by `allowed_actions`), the board gets no document keys.
  - L6 4: `links[].source` gains `uploaded_at`, `uploaded_by`, `version_count`; every write answers with the `scope` object (`can_manage`, `allowed_actions`,
    `upload_blocked_reason`, `limits`, `counts`): upload/replace 201 `{item, scope}`, link 201 `{link, scope}`, both deletes 200 `{scope}` (were 204).
  - L6 6-8: request cap 10 485 760 + 65 536 stated everywhere; strip one known extension at upload/replace, download name = name + stored format extension; `Content-Disposition`
    via `mime.FormatMediaType` (`filename*=utf-8''…` for non-ASCII, no ASCII fallback parameter).
  - L6 9: optional `Idempotency-Key` on upload mirroring drafts (`job_draft_idempotency`, no TTL, SHA-256 fingerprint incl. file bytes, replay `Idempotency-Replayed: true`,
    `invalid_idempotency_key` 400, `idempotency_conflict` 409); required `expected_version` part on replace → 409 `document_version_conflict` `data.current_version` (new row in the error table).
  - L6 10-11: empty file → `validation_error` `file`/`empty`; `document_content_mismatch` `data {detected_format, extension}`; `limits.formats: [{format, extensions[], content_type}]`;
    a «Closed enums» table (`upload_blocked_reason`, `data.reason`, `data.kind`, actions, state, format); `participation_id` always present (null for vacancy scope); Deployment note 4
    (adding a `format` value needs the frontend to accept it first).
  - Slices re-cut to P1-P8 (old P3 split into P3 foundations/list and P4 upload/download; P5 versions/delete; P6 participation documents shrank to ~250; P7 linking; P8 hardening).
  Decisions taken by the backend where L5/L6 left a gap: `expected_version` is required (not optional); deletes answer 200 `{scope}`; `can_upload` dropped; no `link_blocked_reason`.
- **L8** 2026-11-22, frontend final OK on the revised contract: (a) «`expected_version` obligatorio en el replace: OK»;
  (b) «`{item, scope}` / `{link, scope}` y los deletes 200 `{scope}`: OK»; (c) «Sin `can_upload` ni
  `link_blocked_reason` [...]: OK»; (d) user, relayed verbatim: «Sí, también descartados». Contract agreed; T2 done.
