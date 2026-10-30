# Empty-state inventory (E1, explore, 2026-10-30)

Paths relative to `frontend/src/`; F = `features/`, C = `components/`. SC = StateCard, E = Empty, T = plain text,
Ø = nothing. Not certified exhaustive (silent `.map()` branches need reachability checks). Errors / forbidden /
not-found excluded.

## Employer

| Screen | file:line | Trigger | Form | Current copy | Action | Verdict |
|---|---|---|---|---|---|---|
| Dashboard / active vacancies | C/company-dashboard/active-vacancies.tsx:67 | No active vacancies | SC | No hay vacantes activas | unverified | ok structure; action unverified |
| Dashboard / applicants | C/company-dashboard/data-table.tsx:162 | Empty list / origin filter | SC | Sin candidatos | view/clear | ok |
| Vacancies list | F/employer-vacancies/vacancy-portfolio.tsx:182 | Empty portfolio / draft filter / search | SC | Todavía no hay vacantes / No hay borradores que mostrar / Sin resultados | filtered only | weak: initial state lacks creation CTA |
| Draft pipeline (reference) | F/employer-vacancies/draft-pipeline-state.tsx:83 | Unpublished draft | E in Card | Esta vacante todavía no tiene pipeline | publish/edit | ok — reference |
| Board columns | F/pipeline-movement/board-columns.tsx:136–142 | Zero candidates (filtered/unfiltered) | E / T | Sin coincidencias / Sin candidatos en esta etapa | clear in toolbar | ok (compact exception) |
| Candidate sheet / answers | F/pipeline-movement/candidate-sheet.tsx:170 | No screening answers | T | No hay respuestas a preguntas de filtro. | no | weak: tab reduced to text |
| Candidate sheet / history | F/pipeline-movement/candidate-sheet.tsx:184 | No events | T | No hay movimientos registrados. | no | weak |
| Candidate sheet / checklist | F/vacancy-checklist/board/ui.tsx:102; F/pipeline-movement/candidate-sheet.tsx:134 | No criteria | Ø | — | no | missing: panel omitted |
| Psychometric invitation | F/psychometrics/sheet/invitations.tsx:125 | No invitation | E | Aún no hay evaluación | yes | weak: bespoke composition |
| Psychometric result | F/psychometrics/sheet/result.tsx:81,149 | No focus areas / guide questions | T | No hay focos almacenados en esta comparación. / No hay preguntas almacenadas para esta comparación. | no | weak |
| Comparison | F/vacancy-checklist/compare/ui.tsx:58,60 | No criteria / selection outside 2–5 | SC | Todavía no hay criterios / Elige entre 2 y 5 candidatos | configure/back | ok |
| Config / checklist | F/vacancy-checklist/editor/editor.tsx:154 | Zero criteria | E | Todavía no tienes criterios | suggest/add | ok; detail panel has no empty |
| Config / delivery | F/employer-vacancies/delivery-config/fulfillment-view.tsx:20 | Empty candidate array | Ø | — | no | missing if reachable |
| Talent base | F/org-candidates/list/list-workspace.tsx:75 | No candidates / no matches | SC | Todavía no hay candidatos en tu organización / Sin resultados | filtered only | weak: no initial CTA |
| Talent table fallback | F/org-candidates/list/candidate-results.tsx:94 | Empty table | T | Sin candidatos | no | weak standalone |
| Talent sheet / processes | F/org-candidates/detail/detail-sheet.tsx:207,213 | No active / any processes | T | Sin procesos activos / Sin procesos | «Ver todos» | weak |
| Talent sheet / history | F/org-candidates/history/change-history.tsx:58 | Empty history | SC | Sin cambios todavía | no | weak: no next step |
| Team | F/employer-team/team-workspace.tsx:82 | No members / no matches | SC | Todavía no hay miembros del equipo / Sin resultados | search only | weak initial |
| Careers editor / properties | F/company-site/editor/careers-site-editor.tsx:194 | Nothing selected | E | Selecciona una sección | no | weak |
| Careers editor / collections | F/company-site/editor/forms/item-list.tsx:64 | Zero items | E | Cuenta más sobre tu empresa | add outside | weak: no media/action |
| Careers editor / blank section | F/company-site/public/company-site-presentation.tsx:73 | Empty block in preview | E | dynamic block label | select | weak: incomplete composition |

## Candidate

| Screen | file:line | Trigger | Form | Current copy | Action | Verdict |
|---|---|---|---|---|---|---|
| Dashboard / applications | C/candidate-dashboard/candidate-dashboard-overview.tsx:228 | No recent applications | SC | Sin postulaciones | explore | ok |
| Dashboard / CVs | same:314,318 | No CVs / no primary CV | SC / T | Sin CVs / Tienes N CV, pero ninguno está marcado como principal. | library | ok / weak secondary |
| Applications | F/candidate/applications-workspace.tsx:84 | No applications | SC | Todavía no te postulaste a ninguna vacante | explore | ok |
| Applications / search | F/candidate/applications-workspace.tsx:96 | No matches | E | Ninguna postulación coincide con «…» | clear | weak: can quote an empty query |
| Saved vacancies | F/candidate/saved-vacancies-workspace.tsx:130 | Empty | SC | Todavía no tienes vacantes guardadas | explore | ok |
| Profile / education | F/candidate/education-fields.tsx:20,47 | No studies | Ø | — | add | weak |
| CV picker (apply) | F/candidate-applications/cv-picker.tsx:76,81 | Zero CVs | Ø + count | 0 de N CVs en tu biblioteca. | upload | weak |
| Assessments | F/psychometrics/workspace/assessments.tsx:45,56 | No pending / standalone | Ø | — | no | intentional omission (verify) |

## Public and editor surfaces

| Screen | file:line | Trigger | Form | Current copy | Action | Verdict |
|---|---|---|---|---|---|---|
| Careers site / vacancies | F/company-site/public/company-jobs.tsx:92 | No jobs | SC | Por ahora no hay vacantes abiertas. Vuelve pronto. | no | weak: no alternative |
| Careers site / search | same:109 | No matches | SC | No encontramos vacantes con estos filtros. | clear | ok |
| Public vacancies | F/jobs/components/JobsResults.tsx:23 | Zero results | SC | No hay vacantes | clear | weak when catalog empty |
| Questionnaire preview | F/jobs/drafts/ui/draft-questionnaire-preview.tsx:106 | No questions | E | Todavía no hay preguntas | optional edit | weak: no media |

Compact exceptions kept as text: board filter options, field-level «Sin dato», combobox «Sin coincidencias.», form
notices (languages, draft lists, substates), vacancy-row metadata, optional public job-detail sections.
