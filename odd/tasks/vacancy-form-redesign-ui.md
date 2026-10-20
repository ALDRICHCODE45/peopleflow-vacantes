# Vacancy form redesign (v0 ckk9xqMLQUp) — frontend

Branch `feat/vacancy-form-redesign-ui`, stacked on `feat/geo-search-ui`. Reference code:
`docs/design/v0/reference-ckk9xqMLQUp/` (components/vacancy/{workspace,sections,fields,editor,preview}.tsx.txt,
lib/vacancy.ts.txt, app/globals.css). Screenshots: /home/aldrich_coder45/Pictures/Screenshots/
Screenshot_2026-10-20-01-53-18 … 01-54-06 (9 files). Prompt sent to v0: docs/design/v0/prompts/vacancy-form-redesign.md.

## Specs

- S1. User (verbatim): «Mira hermano, este es el chat de v0 del rediseno: https://v0.app/bdps-projects/chat/ckk9xqMLQUp … muy probablemente en las capturas que pude tomar no se vean funcionalidades/comportamiento del formulario, por eso te paso el chat para que puedas revisar a fondo todo. … Lo unico que me queda duda es sobre la vista previa, sinceramenteo siento que no me gusta del todo esa "vista previa" que se da en todo el recorrido de la vacante... pero de todos modos dejala, hazlo lo mas fiel posible y recuerda siempre apegarte a las reglas de diseno por favor, y tambien recuerda priorizar componentes de shadcn, exploralos para ver cual te puede servir mas dependiendo del caso de uso, y explora los ejemplos que ponen en la documentacion oficial para corroborar su uso recomendado.»
- S2. Fidelity: reproduce the v0 layout, hierarchy, copy and interactions as faithfully as possible (live preview included), using OUR installed shadcn components with their official composition (docs/design/shadcn-reference/*; consult ui.shadcn.com/docs/components/base/<c> examples via the parent if a component is not documented there), our tokens/Inter, and all rules in docs/frontend-ui-design-rules.md. v0's `alert` → our `ActionStatus`/`StateCard`; v0's `sonner` → our Sileo `notifyActionResult` (approved exceptions). Exclusions (not real product): the header text «Espacio de Talento» and the «Explorar demostración» affordance.
- S3. Behavior: keep every hard rule of the current editor (data contracts, limits, normalization, ETag/412, idempotent create, uncertain results, server 422 mapping, publication readiness and confirmation, published-vacancy constraints, geography rules) — see the behavior inventory in docs/design/v0/prompts/vacancy-form-redesign.md. UX changes adopted from v0: free navigation between sections (no wizard gate), sticky bottom bar with save status + «Guardar cambios»/«Guardar borrador» + «Publicar vacante» reachable from any section, live public preview panel, «Lista para publicar» progress fed by the publication readiness items, per-section completeness marks, unsaved-changes guard on leaving.
- S4. Honesty: the progress and section marks are derived from real data (local form state for editor items; server readiness for request/delivery items when known); never invent values.

## Tasks

- T1 [pending] S1-S4 | writer | Shell: header (title, status badge, «Vista previa»), left section nav + «Lista para publicar» + «A tu ritmo», main section frame («N de 5»), right live preview, sticky bottom bar, free navigation, leave guard; mobile layout (preview in a Sheet). | commit: -
- T2 [pending] S1-S4 | writer | Sections content per v0 cards (Información básica … Preguntas de filtro), keeping all fields/behaviors. | commit: -
- T3 [pending] S1-S4 | writer | «Revisión y publicación» section: inline checklist with «Completar», «Configurar solicitud y entrega», «Revisión interna», «Revisar y publicar» → existing publish flow. | commit: -
- T4 [pending] | parent | Full suite, guide step, queue. | commit: -

## Log

- L1. Reference fetched from v0 chat ckk9xqMLQUp (2026-10-20).
