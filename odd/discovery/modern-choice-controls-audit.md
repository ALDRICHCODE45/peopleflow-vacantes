# Audit: bare choice controls and native file inputs (2026-11-23)

Read-only audit for `odd/tasks/modern-choice-controls.md` T1. Paths under `frontend/src`.

## Bare-looking today (replace)

- `features/vacancy-documents/ui/upload-dialog.tsx:56-60` — «¿A quién pertenece?» bare `RadioGroupItem` (2, single).
- `features/vacancy-documents/ui/file-field.tsx:13` (used in `upload-dialog.tsx:65`, `versions-sheet.tsx:74`) — visible
  native `<Input type="file">` («Browse… / No file selected»).
- `features/candidate-applications/cv-picker.tsx:86` — `/vacantes/[jobId]/postular`, native file input visible when the
  library has CVs.
- `features/jobs/drafts/ui/draft-benefits-field.tsx:22-36` — benefits (8, multi) bare checkbox grid.
- `features/talent-base-visibility/talent-base-visibility-section.tsx:178` — recruiters with access (multi) bare list.
- `components/auth/LoginScreen.tsx:126` — «Recordarme» raw `<input type="checkbox">` without state.

## Hybrid / could improve

- Single on/off as checkbox (→ Switch): `draft-compensation-field.tsx:240`, `local-draft-form.tsx:758`,
  `vacancy-checklist/editor/criterion-dialog.tsx:65`, `org-candidates/list/candidate-filters.tsx:105,110,120`,
  `pipeline-movement/board-filters.tsx:73`.
- Multi option lists already card-like: `vacancy-replacement/steps.tsx:61,78,178`, `vacancy-documents/ui/link-sheet.tsx:123`,
  `vacancy-checklist/editor/editor.tsx:148` (pill), `psychometrics/profile/editor.tsx:143` (popover list),
  `vacancy-checklist/board/ui.tsx:154` (compare, max 5).

## Keep (convention)

- Table row selection: `org-candidates/list/candidate-columns.tsx:66,106`, `candidate-results.tsx:42,93`,
  `components/company-dashboard/data-table.tsx:55,58` (possibly unused).
- Consent: `psychometrics/candidate/assessment-flow.tsx:215`. Filter menus: `pipeline-movement/board-filters.tsx:59`.

## Already modern (reuse)

- RadioGroup choice cards: `talent-base-visibility-section.tsx:163`, `company-site/editor/site-settings.tsx:75`,
  `psychometrics/candidate/assessment-flow.tsx:228`.
- Outline ToggleGroup as option cards: `cv-picker.tsx:78`, `draft-geography-field.tsx:43`, `lifecycle-action-dialog.tsx:133`.
- Segmented ToggleGroup: `vacancy-documents/ui/documents-filters.tsx:25` and five more.
- Multi chips: `jobs/components/JobsNavigationIsland.tsx:133` (`ToggleGroup multiple`).
- Dropzones: `candidate/cv-workspace.tsx:157-159`, `company-site/editor/media/ImageField.tsx:176-186`.
- Styled hidden file inputs: `manual-intake/fields.tsx:73`, `org-candidates/cv/participation-cv.tsx:91`.

## Suggested slices

1. Documentos (upload dialog choice + FileField → also fixes versions sheet). 2. Apply flow cv-picker. 3. Draft form
(benefits chips, single toggles → Switch). 4. Login «Recordarme». 5. Configuración recruiter list (+ psychometrics stages
as pills). 6. Talento/pipeline single toggles (low priority).
