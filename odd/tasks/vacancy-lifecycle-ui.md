# Vacancy lifecycle: pause, close, finish process, reopen — frontend

Branch `feat/vacancy-lifecycle-ui` (from main 96caec9). Backend `feat/vacancy-lifecycle`; contract §21 in `docs/vacancy-lifecycle-design.md` (backend branch).
Rules: `docs/frontend-ui-design-rules.md` (§13.8 dialogs, §18 ConfirmActionDialog, §19 shadcn composition, §22 StateCard, §25 verify before delivering).

## Specs

- **S1.** Pause (user): «Se oculta y no recibe postulaciones (Recomendado)» — «Sale del listado y de la búsqueda; su enlace muestra «Vacante pausada». El tablero sigue funcionando normal.»
- **S2.** Close (user, custom): «Yo creo que la segunda opcion es la mejor, pero realmente estaria bien que se pueda elegir entre cerrar el proceso interno de la vacante (mover candidatos, plazas, entregas, etc..) al momento de cerrar o pausar una vacante.. me explico? que opinas?» Approved proposal «Sí, así (Recomendado)»: «Pausar: oculta y no recibe postulaciones, el proceso sigue. Cerrar: elegís seguir o finalizar el proceso; si seguís, lo finalizás después.» Close dialog offers «Seguir con el proceso» or «Finalizar el proceso» (board read-only; active candidates see «Vacante cerrada»); a closed vacancy with an ongoing process can later «Finalizar proceso».
- **S3.** Reopen (user): «Todo: pipeline, candidatos e historial (Recomendado)» — «Vuelve a estar publicada tal como quedó; el historial registra el cierre y la reapertura.»
- **S4.** Automatic close (user): «No, solo manual por ahora (Recomendado)».
- **S5.** Who acts (user): «Los mismos que pueden publicar (Recomendado)» — owner or principal of the vacancy; others see the state without the actions.
- **S6.** Contract (§21, agreed with backend): states Borrador / Publicada / Pausada / Cerrada · proceso en curso / Cerrada · proceso finalizado; actions come from `allowed_actions`; lifecycle ETag `"vl-<id>-v<N>"` with `If-Match` + `Idempotency-Key`; `lifecycle` root key on board, pipeline and editor GETs; 409 `lifecycle_transition_invalid` / `process_finished` carry the current lifecycle; resume/reopen 422 `publication_incomplete` with root `missing` like publish; public detail and screening 410 `vacancy_unavailable` `{id,title,company,availability}`; apply 409 `vacancy_not_accepting_applications`; candidate items `vacancy.state` open|closed; company list `status` draft|published|paused|closed + `process`.

## Tasks

- [x] T1 — S6: lifecycle model, strict decoders, server actions (view, pause, resume, close{process}, finish-process, reopen), error mapping (409/412/428/422 missing) | route: writer | commit: b1deace
- [x] T2 — S1–S5: company vacancy list badges and per-state actions with ConfirmActionDialog (close dialog with the process choice) | route: writer | commit: 1f1a843
- [x] T3 — S2, S5, S6: pipeline/board header state badge + last transition date + actions; read-only board when process finished; 409 refresh (published keeps the validated «Publicada el …» line) | route: writer + parent fix | commit: d6d8276
- [x] T4 — S1, S6: public detail/apply for paused/closed: «Vacante pausada»/«Vacante cerrada» StateCard with noindex; apply 409 message | route: writer | commit: 358a6ad
- [x] T3b — S2, S6: configuration screens (pipeline, substates, delivery, management) read-only when the process is finished; 409 `process_finished` handling; `lifecycle` in shared v2 read + reopen seed | route: writer | commit: (this)
- [x] T5 — S2: candidate applications show «Vacante cerrada» when `vacancy.state` is closed (a discard keeps «Finalizada») | route: inline | commit: 6e240c5
- [ ] T6 — guide steps, review queue, rules learnings; browser verification against backend L1/L2 | commit: —

## Log

- **L1** (user, 2026-10-20): «Mmmm mejor lo dejamos para despues hermano, son temas menores, por favor sigue con los pasos siguientes recomendados, si es que ya no tienes mas temas atrasados, coordinate con el backend para poder continuar con las siguientes unidades, la ultima que se implemento fue la 7 no?»
- **L2** Backend recommended lifecycle next (no unpublish/close route exists; SEO depends on it); user answered S1–S5.
- **L3** (user): «pero eso ya lo revisaste tu no? y la mayoria tambien ya lo revise. adelante, integrar todo y yo hago push.» — geo + vacancy-form stack integrated to main 96caec9 (tsc OK, 5897/5897 vitest, backend build/vet/test + -race green).
- **L4** Contract §21 agreed with four frontend clarifications (lifecycle on board/pipeline/editor GETs, 422 `missing` like publish, no saved vacancies in backend, no history view this cut).
- **L5** Close-process choice uses the vertical outline `ToggleGroup` (same single-choice composition as the CV picker and screening questions); `RadioGroup` is not installed and `components/ui/*` stays untouched.
- **L6** Backend confirmed (msg 170343f9): `lifecycle` always embedded in editor v2 and pipeline GETs (drafts: publication/process null, version "0", allowed_actions ["publish"]); create/PATCH/pipeline PUT and replays never carry it. Found before browser QA that create/save decoded with the read schema (would reject every save under L2): fixed test-first with a write schema (commit below).
