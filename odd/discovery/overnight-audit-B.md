# Overnight audit B — pipeline and candidates (2026-11-24)

Production :3000 vs dev :8080, owner and recruiter; screenshots `/tmp/audit-B/shots/`. Moving candidates (menu, sheet,
mouse and keyboard drag with announcements), discard/recover, substates, filters, checklist, compare, placement and «No se
sostuvo», talent base and documents work.

| id | sev | where | finding | fix |
| --- | --- | --- | --- | --- |
| F0 | blocker | Config → Columnas (`features/jobs/drafts/pipeline/client.ts:105`) | any structure change on a vacancy with candidates → POST …/pipeline/preview HTTP 500; nothing saved (substates save fine) | backend (sent) |
| F1 | major | talent base | can't add an existing person to another vacancy | frontend + backend |
| F2 | major | board | no bulk select / move / discard / export | frontend + backend |
| F3 | major | board | no search by name/email | frontend |
| F4 | major | discard for a manual candidate (`disposition-dialog.tsx:95`, `board-toast-copy.ts`) | says the candidate will see the message; manual candidates have no account | frontend |
| F5 | major product | whole area | no notes/comments, mentions, notifications or candidate emails | product decision + backend |
| F6 | minor | add candidate | wrong type/size only flagged on submit; stale counter | frontend (FileField error) |
| F7 | minor | talent base (`candidate-results.tsx:93`) | select-all = loaded 20 of 127; export only selection | frontend (+ backend) |
| F8 | minor | substate menu (`substate-controls.tsx`) | only «Sin subestado» when none configured | frontend (link to config) |
| F9 | minor | candidate sheet | no CV preview; no documents block | frontend |
| F10 | minor | psychometrics copy | «Enviar/Enviado» though nothing is emailed | frontend copy |
| F11 | minor | psychometrics «Copiar enlace» | every copy rotates the shared link; button hidden in «⋯» | product/backend |
| F12 | major | recruiter → talent ficha → vacancy without access | «No encontramos este borrador»; recruiter can edit candidates outside their vacancies | frontend + product decision |
| F13 | minor a11y | board/compare (`board.tsx:177`, `compare/report.tsx:43`) | aria-prohibited-attr | frontend |
| F14 | minor a11y | sheet «Descartar» (`candidate-sheet.tsx:125`) | contrast | frontend/design-system |
| F15 | minor | board/talent filters (`board-filters.tsx:90`) | bare option checkboxes vs «Choice and file controls» | design-system decision |
| F16 | polish | sheet tabs at 390/1440 (`candidate-sheet.tsx:135`) | tabs overflow without hint | frontend |
| F17 | polish | compare at 390 | candidate columns cut | frontend |
| F18 | polish | «No se sostuvo» (`departure-confirm.tsx:21`) | first word of the name | frontend (also audit A F15) |
| F19 | polish | various | doubled labels, vague errors, «Cambios sin guardar» on load, checklist note save, etc. | frontend |

Data: «Auditoría B — Analista de pruebas de pipeline» `01a20c74-ee53-7325-9aea-b86a36255ba0` (published, remote) with
candidates «Auditoría B Uno/Dos/Tres …», document «CV Auditoría B Cuatro» (v1, v2).
