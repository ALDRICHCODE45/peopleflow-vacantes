# Base de talento redesign from the approved v0 proposal

Branch `feat/talent-base-redesign`, on top of `feat/design-cards-dialogs` (blur fix kept; its process-card design was rejected by the user and is replaced here). Design source: v0 chat https://v0.app/bdps-projects/chat/propuesta-visual-peopleflow-jTE2ffEMVrb, code in `docs/design/v0/base-de-talento/` (`components/peopleflow/workspace.tsx.txt` = page/table, `panel.tsx.txt` = candidate sheet, `globals.css.txt`, `data.ts.txt`), screenshots in `docs/design/v0/base-de-talento/screenshots/`. Scope: Base de talento only (table page + candidate sheet). The pipeline candidate sheet is out of scope (user still deciding). App shell (sidebar, topbar) from v0 is out of scope.

## Specs

- **S1.** «No me gusta el resultado, voy a hacer un rediseno con v0» … «por ahora solo redisena lo que tiene que ver con la base de talento, el sheet del candidato del pipeline de la vacante lo sigo pensando.» → the talent table page and the talent candidate sheet follow the v0 proposal visually (shadcn components, our tokens), keeping all existing behaviour.
- **S2.** Metrics band «Total de candidatos», «En procesos activos», «Agregados esta semana» (user: «Pedir al backend las 3 métricas»).
- **S3.** Tabs «Todos los candidatos» and «Agregados por mi equipo» (= origin manual) with counters (user: «Sí, con contador»).
- **S4.** No «Agregar candidato» button in this unit (user: «Sin botón por ahora») → backlog.
- **S5.** Row selection with «Exportar seleccionados» (CSV of the selected rows) (user: «Con casillas y exportar»).
- **S6.** Candidate sheet in tabs «Resumen» (contact, professional profile, skills, corrections note, active processes summary with «Ver todos»), «Procesos N» (all opportunities: vacancy link, vacancy/process status, stage · substate, source/date/actor, discard info, CV block with current/original downloads and «Subir CV corregido», «PDF o DOCX · Máximo 5 MB»), «Historial N» (timeline with actor, date, relative, change lines, «Ver más»); header with avatar, name, title · company, origin + «Corregido» badges, «Agregado por … · fecha», full-width «Editar datos». Edit mode keeps its behaviour, restyled to the new sheet.

## Tasks

- T1 Backend contract: summary counts (total, with active process, added in last 7 days, manual vs organic) — S2, S3
- T2 Page header, metrics band and origin tabs — S2, S3
- T3 Table and toolbar per v0 (search with shortcut hint, inline filters panel, columns menu, reset, view toggle, result line, rich rows) — S1
- T4 Row selection + «Exportar seleccionados» CSV — S5
- T5 Candidate sheet tabs + header per v0 (read view) — S6
- T6 Edit mode restyle inside the new sheet — S6
- T7 Browser QA (dark/light/390), suite, native review in pieces, handoff (merge only with user OK)

## Log

- **L1.** User (2026-10-22): «mira estas son las capturas que pude tomar del rediseno: […13 capturas…] este es el chat: https://v0.app/bdps-projects/chat/propuesta-visual-peopleflow-jTE2ffEMVrb por ahora solo redisena lo que tiene que ver con la base de talento, el sheet del candidato del pipeline de la vacante lo sigo pensando.»
- **L2.** Decisions (ask_user_question): metrics → «Pedir al backend las 3 métricas»; tabs → «Sí, con contador»; add button → «Sin botón por ahora»; selection → «Con casillas y exportar». CV file size shown by v0 («248 KB») is not in our data → omitted unless the backend adds it.
- **L3.** T2 (worker mvk8jvbo-r-7vgv): `features/org-candidates/summary/` (strict model, server-only client + action, `useCandidatesSummary` with refresh and stale protection, `SummaryBand` heading + 3 metrics + skeleton + inline error/retry, controlled `OriginTabs` with optional counters), requestPath allowlist. RED 38 → GREEN 67, tsc OK. Integration (parent, after T3): band replaces the heading; tabs value from `filters.origin` («manual» ↔ «Agregados por mi equipo»), change via `changeFilters(state, { origin })`; counts `{ all: total, manual: by_kind.manual }` only with data; `summary.refresh()` after a confirmed save.
- **L4.** Backend summary endpoint done on feat/org-candidates-summary (contract as proposed). Decision asked to the user (backend found the list `participations.active` counts non-discarded participations even in vacancies with a finished process): user chose «Excluir procesos terminados en ambos» → both the summary `with_active_process` and the list `participations.active` exclude finished processes (backend follow-up, same branch).
- **L5.** T5 (worker mvk8j9ki-q-8n78): sheet redesigned (header, tabs Resumen/Procesos/Historial, CV block via optional `DocumentItem` panel presentation, timeline, footer). RED 7(+1) → GREEN 11 new; 117 files / 1478 tests green, tsc OK. Not reproduced: CV file size and history count (not in the contract). Browser QA pending.
- **L6.** Backend final: feat/org-candidates-summary @ a5c3dfe0 (da8f1d97 endpoint, a5c3dfe0 rule B in list `participations.active` + summary `with_active_process`; finished processes stay in `participations.total`). Contract identical to the one our summary client implements. Backend native review approved; not merged (waits for user OK with the redesign).
- **L7.** T3+T4 (worker mvk8j9kd-p-jboi): single surface, toolbar (⌘K/Ctrl K, inline filters, columns, reset, view toggle), result line with relative update, rich rows, selection + «Exportar seleccionados» CSV (BOM), cards. RED 12 → GREEN; 422 tests green, tsc OK. Not reproduced: País and «Solo procesos activos» filters (backend does not support them); list does not return corrected_fields, so the row check only appears after an in-session edit (backend follow-up candidate).
- **L8.** T2 integration (parent): `SummaryBand` replaces the list heading; `OriginTabs` first in the results Card, value from `filters.origin`, change via `changeFilters` (other filters kept), counters from the summary; summary refreshes after a confirmed sheet save. RED 5 → GREEN; org-candidates 32 files / 409 tests, tsc OK. One redesign test changed from findBy to waitFor (row re-renders on summary refresh).
- **L9.** T6 (worker mvk9a9r6-s-dc0x): edit mode in the new sheet («Editando datos» context line, tabs hidden, sections Contacto → Perfil profesional → Enlaces → Habilidades, muted correction blocks, sticky Cancelar/Guardar footer, 390 single column). RED 6 → GREEN 140, tsc OK.
