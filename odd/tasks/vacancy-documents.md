# Placement and vacancy documents (frontend)

Frontend for `docs/contracts/placement-vacancy-documents-v1.md` (backend branch `feat/placement-vacancy-documents-backend`,
slices P1–P8) and rules DOC-1…DOC-9 / REP-13 in `docs/recruitment-business-rules.md`. Design first, then implementation.

## Specs

- **S1** Formats and size (relayed user decision): «documentos de placement y de vacante: PDF, Word, Excel y JPG/PNG,
  máximo 10 MB»; Q1: «solo .docx/.xlsx».
- **S2** Permissions (relayed): «borran el Propietario y los reclutadores autorizados, con auditoría; el Stakeholder solo
  consulta»; Q3: «el Stakeholder ve también los documentos de borradores nunca publicados». The UI shows only the actions in
  the backend's `allowed_actions` (item, link and scope).
- **S3** Q7 (relayed): «los documentos de una participación se pueden subir o vincular en CUALQUIER etapa»; user here:
  «Sí, también descartados».
- **S4** Q5/Q6 (relayed): «50, 20 y 25, sin renombrar» (limits from `limits` in the responses; no rename action).
- **S5** Versions: replacing uploads a new version (`expected_version`), history visible; delete with confirmation.
- **S6** Replacements (REP-13): a replacement links documents of the original explicitly, pinned to a version, with
  «Proceso original / Reemplazo n» and «hay una versión más nueva».
- **S7** Audit catalog 70 → 75: `["DocumentDownloaded", "sensitive_read", "Descargó un documento"]` after
  `MetricsDetailExported`; after `VacancyReplacementStarted`: `["DocumentUploaded", "vacancy", "Subió un documento"]`,
  `["DocumentReplaced", "vacancy", "Reemplazó un documento por una nueva versión"]`, `["DocumentDeleted", "vacancy",
  "Eliminó un documento o un vínculo a documento"]`, `["DocumentLinked", "vacancy", "Vinculó un documento del proceso
  original"]`.
- **S8** User (L3): «me ire con la tercer opcion, con los filtros por "vacante", candidatos" y tambien para filtrar los
  documentos por cierto candidato» → artboard `03-expediente-tabla-unica.html`, filters Todos / Vacante / Candidatos plus
  a filter for one candidate.
- **S9** User (L3): «me gustaria mantener esa ui de tabs, "pipeline" "documentos" y "configuracion" asi quitamos el boton
  de configuracion dentro del pipeline y bueno, en general revisa que se mejora con esto, para darle mas "aire" a la ui
  actual del pipeline» → vacancy-level tabs Pipeline / Documentos / Configuración; the settings button leaves the
  pipeline header; the pipeline header is re-laid out with more room.
- **S10** User: delete uses the darker red (`--status-danger`, ~6.5:1) «Usar el rojo más oscuro (Recomendado)», in
  documents only.
- **S11** User: «Pestaña Documentos de solo lectura» → the stakeholder enters the vacancy and sees only the Documentos
  tab (no Pipeline, no Configuración), with download as the only action.
- **S12** User: stakeholder entry point «Lista de vacantes propia» → a read-only «Vacantes» list in the stakeholder menu
  leads to the vacancy's Documentos tab (needs a new backend stakeholder vacancy list).
- **S13** Filter rule and search wording as designed in 03 (user L6): choosing a candidate sets the scope to «Candidatos»;
  with «Vacante» the selector is disabled («No aplica a la vacante») and switching to «Vacante» clears it; the text search
  reads «Buscar documento».

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | — | Re-sync `design/system.md` (stale vs `frontend/src/app/globals.css`) | |
| T2 | S1–S6 | Design directions `design/vacancy-documents/` (vacancy and placement together) | |
| T2b | S8, S9 | Iterate: 03 with the candidate filter + new artboard for the tabbed pipeline header with more room | |
| T3a | S9 | Vacancy tabs Pipeline / Documentos / Configuración and the pipeline header with more room (artboard 04) | |
| T3b | S1–S7 | Documents data layer: schemas, BFF upload/download routes, actions (list, overview, upload, replace, delete, link, unlink); audit ANNEX 70 → 75 | |
| T3c | S1–S6, S8, S10 | Documentos tab UI from artboard 03 (table, filters, upload, versions, delete, links) | |
| T3d | S11, S12 | Stakeholder: «Vacantes» list and read-only Documentos tab (waits for backend P7c) | |
| T3e | S1–S12 | Browser check, full suite, merge to main | |

## Log

- **L1** (2026-11-22) User: «Primero propuestas de diseño» and «Las dos juntas» (vacancy and placement documents in one
  design slice). Design system stale: user «Sí, re-sincronizar primero». Backend P3 (list GET with scope and
  `allowed_actions`) and P4 (multipart POST with optional Idempotency-Key → `{item, scope}`; GET `…/documents/{doc}/file`
  audited, `filename*` RFC 5987; `unsupported_media_type.data.formats` = `limits.formats`; missing file 404; malformed
  `{doc}` 400) committed; P5 versions and delete next.
- **L2** (2026-11-22) Design (T1, T2). `design/system.md` and `design/system.html` re-synced from `globals.css`,
  `theme-tokens.ts`, `components.json` and `components/ui/**` (colour token values unchanged; added public-site, hero and
  toast tokens, spacing and the full component recipes). Directions in `design/vacancy-documents/` for S1–S6, vacancy and
  placement documents together, each at 1440×900 plus a 390×844 frame, 11 states (con documentos, cargando, vacío,
  subiendo, errores, límite, versiones, eliminar, vínculos, vincular, solo lectura): `01-modulo-lista-y-panel.html`
  («Documentos» module in the vacancy configuration, list and panel, scope switch and candidate picker),
  `02-en-contexto-hoja-y-ficha.html` (vacancy sheet from the pipeline plus a «Documentos» tab in the candidate sheet),
  `03-expediente-tabla-unica.html` (one table of everything with «Pertenece a», filter and side panel). None chosen yet.
  Open: Stakeholder has no vacancy route today (contract «Backend facts»), so where it reads documents needs a decision;
  02 and 03 cannot show per-person counts because the board and participation list carry no document keys, and 03 needs
  one read per candidate or an aggregate endpoint.
- **L3** (2026-11-22) User, verbatim: «Bua, la verdad es que me gusta demasiado la 3er propuesta hermano, de verdad, me gusta
  mucho en general la ui de la tercer propuesta, que haya "pipeline" "documentos" y "configuracion" pero tambien me encantaa
  la segunda propuesta, me gustan mucho las dos... pero yo creo que me ire con la tercer opcion, con los filtros por
  "vacante", candidatos" y tambien para filtrar los documentos por cierto candidato.. me sigues? y me gustaria mantener esa
  ui de tabs, "pipeline" "documentos" y "configuracion" asi quitamos el boton de configuracion dentro del pipeline y bueno,
  en general revisa que se mejora con esto, para darle mas "aire" a la ui actual del pipeline, por favor.» Chosen:
  `03-expediente-tabla-unica.html`; 01 and 02 are alternatives. Then: «Usar el rojo más oscuro (Recomendado)» and
  «Pestaña Documentos de solo lectura». Backend asked for an aggregate documents GET (all scopes, owner per item,
  participations that accept uploads, optional `participation_id` filter).
- **L4** (2026-11-22) Design iteration (T2b, S8–S11), `design/vacancy-documents/`. Changed `03-expediente-tabla-unica.html`
  (the chosen direction): a searchable «Candidato» selector listing the vacancy's participations (stage, document count,
  «Descartado» on the discarded ones) combined with Todos · Vacante · Candidatos, a «Quitar filtro» chip, the empty result
  of a person without documents, the 390 sheet version, the planned `GET …/document-overview` shape (`items`/`links` with
  `owner`, `participations[]` with `stage`, `discarded`, `scope_allowed_actions`, `upload_blocked_reason`, `truncated`)
  the header fed by the new `vacancy` block of that read, and the Stakeholder read-only state (only the Documentos tab, «Descargar» as the only action); states 2–4 are new, 14 in
  total. New `04-pestanas-y-pipeline-con-aire.html` (S9): tabs Pipeline · Documentos · Configuración, identity row above
  them, one toolbar in the pipeline (Filtros left; Agregar candidato and Acciones right; coverage and delivery as one
  progress line), a «Hoy» sketch of the current header and the list of what moved where; `design.json` has 04 appended and
  03's tradeoff updated. 03 stays the chosen artboard; 01 and 02 are alternatives. Open: the vacancy-scope fields and the
  action names of `document-overview` are illustrative until the backend contract exists; whether `participation_id`
  returns the full list of a person when `truncated`; whether the title leaves the shared `SiteHeader` for the identity
  row.
- **L5** Backend: `document-overview` adds `vacancy: {id, title, publication, process, kind, visibility}` (stakeholder has no
  other vacancy read; GET draft/lifecycle/publication are recruiter-only); truncation keeps the most recent. User on the
  stakeholder entry point: «Lista de vacantes propia»; backend asked for a stakeholder vacancy list.
- **L6** (2026-11-22) User on 03 and 04: «no quiero cambiar nada, me encanta.» Handoff: `03-expediente-tabla-unica.html` is
  the chosen artboard (01 and 02 are alternatives); `04-pestanas-y-pipeline-con-aire.html` specifies the tabbed layout.
  Backend status: P3 list, P4 upload/download, P5 versions/delete (pending confirmation), P7 links (`c4fcb712`) committed on
  `feat/placement-vacancy-documents-backend`; P7b `document-overview` and P7c `stakeholder/vacancies` in progress.
- **L7** Backend P7b `d002c0c1`: `GET …/document-overview` documented in the contract («GET V/document-overview»). Decided
  there: `participation_id` narrows only `items`/`links` (`vacancy`, `scope`, `participations[]` stay whole);
  `participations[]` ordered by candidate name then id, no cap; `vacancy.title` may be null; `scope.counts` are the real
  vacancy counts; secondary order id DESC. P7c (stakeholder vacancies) next.
- **L8** Backend P7c `58900c66`, verbatim envelope: `GET /v2/me/company/stakeholder/vacancies` (owner + stakeholder; recruiter
  403) → `{"items":[{"id":"…","title":"Analista contable","publication":"closed","process":"finished","kind":"original",
  "visibility":"public","close_reason":"filled","coverage":{"covered":2,"required":2},"documents_count":7},{"id":"…",
  "title":null,"publication":null,"process":null,"kind":"original","visibility":null,"close_reason":null,"coverage":null,
  "documents_count":1}],"next_cursor":null}`; `limit` 1..50 (default 20), `cursor`; order updated_at DESC, id DESC; empty →
  `items: []`. `publication` is null for a never-published draft (lifecycle semantics, unlike the job-drafts list's
  `draft`). P8 (closure), stakeholder permission verification and local merge next. T3d unblocked.
- **L9** Backend documents merged to local main `b8964e32` (not pushed); dev DB v64 (00064); :8080 runs it with disk storage
  `/tmp/pf-documents-storage`. Upload and download have a 2-minute server deadline («Tu BFF y cualquier proxy tienen que
  permitir al menos eso»); contract §Storage: with storage off only byte-moving routes return 503. Audit ANNEX 70 → 75 is
  already on this branch (`8a9946f4`).
