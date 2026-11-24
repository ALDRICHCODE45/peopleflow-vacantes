# Overnight audit A — vacancy creation, team and lifecycle (2026-11-24)

Production :3000 vs dev :8080, owner/recruiter/stakeholder; screenshots `/tmp/audit-A/shots/`. Lifecycle (publish,
pause, resume, close with each reason, reopen, finish, late departure, replacement private → public) works end to end
with confirmations and clear toasts.

| id | sev | where | finding | fix |
| --- | --- | --- | --- | --- |
| F1 | blocker | `/configuracion/equipo`, `/empresa/mi-historial` | team page (responsible, members, shared team, history) is dev-only (`vacancy-team/model.ts:3`); production has no way to assign/change the responsible | user decision pending since `vacancy-team.md` L37; prepared on a branch, not merged |
| F2 | major | editor / publish | no responsible or team mode at creation (creator becomes recruiter) | frontend + backend (after F1) |
| F3 | major | active vacancy | no way back to the editor after publishing (`employer-vacancies/model.ts:20-27`) | frontend |
| F4 | major | employer share | share menu unreachable for an active public vacancy; no «Ver página pública» | frontend (after audit C share menu) |
| F5 | major | draft compensation (`draft-compensation-field.tsx:249`) | visible salary with basis «Sin definir» never shows publicly while review says «Visible públicamente» | frontend (+ confirm backend rule) |
| F6 | major | post-publish editor (`publish-dialog.tsx:71`, `draft-editor-shell.tsx:78`) | still «Editar borrador / Construye tu próxima oportunidad», disabled «Activa», toast «llega en el siguiente paso» | frontend |
| F7 | minor | pipeline URL for a recruiter outside the team (`reopen/error-state.tsx:7`) | «No encontramos este borrador» | frontend copy |
| F8 | minor | close dialog reason (`lifecycle-action-dialog.tsx:133`) | segmented ToggleGroup for a form choice; axe aria-allowed-attr | ChoiceList single |
| F9 | minor | pipeline (`board.tsx:177`) | axe aria-prohibited-attr on `<p aria-label>` | frontend |
| F10 | minor | draft review (`components/ui/item.tsx:9`) | axe aria-required-children (list without listitems) | frontend |
| F11 | minor | vacancy list badges, dark «Ver qué falta» | contrast | design-system |
| F12 | minor | draft requester | value shown twice; «Quitar selección» looks like text | frontend |
| F13 | minor | draft tabs | ticks don't reflect validity | frontend |
| F14 | minor | copy | «Reclutador» vs «Reclutador responsable» vs «Responsable» | one term «Responsable» |
| F15 | minor | «No se sostuvo» dialog (`departure-confirm.tsx:21`) | uses the first word of the name | full name |
| F16 | polish | replacement step 2 | «Yo, quien inicia…» and the same person listed twice | frontend |
| F17 | polish | replacement step 3 | filter «En proceso» clashes with the stage name | «Activos» |
| F18 | polish | breadcrumbs | no vacancy title | frontend |
| F19 | polish | toasts | cover config footer buttons | design-system |
| F20 | polish | 390 | editor sticky bar ~190 px; clipped step tabs; 5 stat cards before the list | frontend |
| F21 | missing | list menu | no «Duplicar como borrador» / templates | backend + frontend |
| F22 | missing | vacancy | no per-vacancy history | frontend (+ API filter) |
| F23 | polish | audit log | «Sobre» repeats the vacancy title | frontend |

Data: «Auditoría A — Coordinador(a) de Ciclo de Vida» `01a20c72-…` and its replacement `01a20c81-…`; «Auditoría A —
Vacante creada por reclutador» `01a20c82-…`; requester «Auditoría A Área Compras»; candidates «Auditoría A Candidata Uno»,
«… Candidato Dos», «… Candidata Tres».
