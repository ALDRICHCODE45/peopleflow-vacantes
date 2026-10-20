# Vacancy lifecycle (pause, close, finish process, reopen)

Backend side of the vacancy lifecycle, delivered with the frontend agent. Design: `docs/vacancy-lifecycle-design.md` (§21).
Branch `feat/vacancy-lifecycle` from `feat/geo-search` a64689f. Same delivery rules as pipeline customization (S3 there).

## Specs

- **S1.** «por favor sigue con los pasos siguientes recomendados, si es que ya no tienes mas temas atrasados, coordinate con el backend para poder continuar con las siguientes unidades, la ultima que se implemento fue la 7 no?» (user, relayed by the frontend)
- **S2.** PAUSAR: «Se oculta y no recibe postulaciones (Recomendado)» — out of listing and search, its link shows «Vacante pausada», the board keeps working.
- **S3.** CERRAR (user's own answer): «Yo creo que la segunda opcion es la mejor, pero realmente estaria bien que se pueda elegir entre cerrar el proceso interno de la vacante (mover candidatos, plazas, entregas, etc..) al momento de cerrar o pausar una vacante.. me explico? que opinas?» — two axes proposal approved: «Sí, así (Recomendado)»: publication (receives applications / public) and internal process (move, discard, fill positions, deliveries); pausing always keeps the process active; closing asks «Seguir con el proceso» or «Finalizar el proceso»; finishing leaves the board read-only and active candidates see «Vacante cerrada»; after closing with the process ongoing, «Finalizar proceso» is available separately.
- **S4.** REABRIR: «Todo: pipeline, candidatos e historial (Recomendado)» — returns published as it was; history records closing and reopening.
- **S5.** CIERRE AUTOMÁTICO: «No, solo manual por ahora (Recomendado)».
- **S6.** Who can act: open; recommended «los mismos que pueden publicar» (owner or principal recruiter).
- **S7.** Design document first, no code; the frontend reviews the contract before implementation.

## Tasks

- [ ] T1 — S1–S7: §21 design + frontend review + S6 user answer (parent) — in progress
- [ ] T2 — L1: migration 00034, lifecycle GET/actions/history, transitions, ETag, idempotency, audit (worker)
- [ ] T3 — L2: effects on public detail, screening/apply, board/configuration, candidate list, company list (worker)

## Log

- **L1.** Frontend relay of the user's answers (S1–S6, verbatim above). The geo stack was approved for integration into main («pero eso ya lo revisaste tu no? y la mayoria tambien ya lo revise. adelante, integrar todo y yo hago push.»); the frontend integrates it as `integrate/geo-stack` 81a4f83.
- **L2.** Code map (explore mvhax1s3-1-ouhc): publication lives in `vacancy_processes` (CHECK `status='published'` only, 00019); publish = owner or principal recruiter, Idempotency-Key + draft If-Match, 201/409 already_published (draftstore/publication.go:70–205); public list/detail/screening/apply require process `published` + live company, otherwise 404 `not_found` (public_jobs.sql.go:75–83, candidate_screening.sql.go:14–19, applications v2 store.go:41–87 — publication checked before replay); board mutations require `published` → 409 `vacancy_not_published` (draftstore/pipeline.go:133–146); fulfillment blocks only delivery PUT/preview with 409 `delivery_fulfilled` (draftstore/delivery.go:61–72); candidate list item `{id,vacancy{id,title},company{id,name},applied_at,status,message}` with no vacancy state (applications v2 status.go); company list `status = COALESCE(process.status,'draft')`; participation history is per participation (00022), event kinds intake|move|discard|recovery|substate|not_applicable (00028); no pause/close/reopen exists; latest migration 00033.
- **L3.** Frontend review of §21: approved in general (two axes, allowed_actions, own ETag, public 410 without content, apply replay). Precisions applied: lifecycle view embedded in board, pipeline and v2 draft editor GETs; 409 `process_finished` and `lifecycle_transition_invalid` carry the current view; resume/reopen 422 uses the publish writer (`missing`, same keys); no saved vacancies exist in the backend; history not shown on the board in this cut (endpoint kept); badge copy «Cerrada · proceso en curso». S6 pending the user.
