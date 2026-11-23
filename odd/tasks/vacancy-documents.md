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

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | — | Re-sync `design/system.md` (stale vs `frontend/src/app/globals.css`) | |
| T2 | S1–S6 | Design directions `design/vacancy-documents/` (vacancy and placement together) | |
| T3 | S1–S7 | Implementation slices (after the user picks an artboard) | |

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
