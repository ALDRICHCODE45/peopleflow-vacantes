# Perfil psicométrico de la vacante

`VacancyPsychometricsModule({ draftId })` loads the agreed profile and current pipeline together. Existing actions/model/client own persistence and the opaque `If-Match` header. Only current progression stages are options; never exit/retired stages.

## Workspace (R8 / S4)

Reference: `design/psychometric-profile-config/03-lista-maestra-detalle.html` (chosen), mapped to installed primitives and semantic tokens, not copied HTML.

- Configuración general separates the enabled switch, compact stage multiselect (Popover + Checkbox) and 1–30 day link validity from competency requirements. Activation and confirmation remain independent.
- Perfil del puesto keeps seven selectable rows visible, each with importance, band and completeness (✓ / Pendiente / —). The selected row controls one detail card. Native buttons support Tab/Enter/Space and visible focus; mobile places the list before the detail.
- Detail uses segmented ToggleGroups for importance and desired band. No relevante disables the band, shows Sin banda and clears band/rationale/task to null. Relevant importance initializes the middle band and an empty rationale. Clave alone shows task. Fields have trimmed Unicode code-point counters (300 / 1000), matching validation.
- `requirements.ts` drives row completeness, progress segments, the summary and save/confirm validation. Confirm selects the first invalid competency, mounts its detail and focuses its first invalid field, with FieldError. Server field errors follow the same selection/focus path.
- The sticky action surface shows completeness and Guardar cambios / Confirmar perfil. Draft saves allow empty task/rationale. Editing requirements clears confirmation; general settings preserve it. Server confirmation dates use Mexico City time.
- Sugerir desde la vacante preserves the draft and explains that no inference rules exist; it never invents requirements. The hypothesis note stays in the page footnote; each competency's own hypothesis sentence lives in its help popover.

## Competency names and on-demand help

Reference: `design/psychometric-competency-help/` (names and copy approved, `odd/tasks/psychometric-competency-clarity.md` L5). `../competency-copy.ts` is the single source of competency names (ids unchanged), descriptions, the common footer and field help; `../labels.ts` derives names from it. `../help/info-popover.tsx` renders a visible ghost ⓘ trigger (≥40px, accessible name «¿Qué es …?» / «Ayuda: …») and the description only on demand; one help is open at a time inside `HelpProvider`. Row help is a separate button and never selects the row. Triggers sit next to each list row, the detail heading, Importancia en el puesto, Banda deseada, Tarea concreta, Justificación laboral and Confirmar perfil, and next to each competency in the candidate sheet.
- Errors preserve input. ETag conflicts/missing preconditions require Cargar versión actual; uncertain writes offer Comprobar and never automatically replay PUT. Process-finished rejection locks writes. Profile changes affect future evaluations, not earlier snapshots.

## Composition audit

References read: `docs/design/shadcn-reference/{card,field,toggle-group,popover}.md` plus installed component implementations.

| Primitive | Composition / adaptation |
| --- | --- |
| Card | Header → Title (semantic heading), Description, Action; Content; Footer. General settings, master and detail share this anatomy. |
| ToggleGroup | Group → Items, segmented variant. Uses installed Base UI value-array API; empty selection ignored. |
| Popover | Trigger rendered as Button; Content → Header / Title and FieldGroup of Checkbox fields. |
| Field | Set → Legend → Group → Field → Label, control, Description, Error. |
| InputGroup / Textarea | Existing task/expiry composition, ≥40px independent targets; rationale has room to write. |
| Badge / Switch / Checkbox / Button / Spinner | Installed semantic variants and actual pending state; no shared primitive edits. |
| Skeleton | Header, settings card, seven-row master, selected default detail and sticky actions; no assumptions about unloaded requirements. |

The standalone sticky form-action Card intentionally uses Content only (not a competency footer). Its two actions are the requested draft/confirm pair. Mobile stacks the summary/status/actions to avoid overflow. List buttons need multiline product layout; segmented controls retain their native compact geometry under UI rule §2. Feedback remains the global notifyActionResult plus persistent ActionBar/ActionStatus, with no local toaster.

## Verification boundary

Tests keep real product handlers, ToggleGroups, checkboxes and saved-body assertions. jsdom cannot position Base UI Popover portals reliably: profile/module tests replace only the popup shell, retaining the real trigger and product controls. Browser verification owns popup positioning, Escape/focus return, responsive layout and visual approval. No live save/confirmation is performed during browser QA.
