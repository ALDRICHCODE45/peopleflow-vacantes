# Careers site editor: undo/redo and a section list with real drag feedback (frontend)

Phases 1 and 2 of the «Sitio de empleo» editor proposal: confidence while editing (undo/redo, undo after delete, discard
draft, keep-my-changes on conflict) and a redesigned section list with drag-and-drop that shows where a section lands.

## Specs

- **S1** User, verbatim: «tambien note que no puedo desacer los cambios que ya hice, no puedo volver atras, me sigues??»
  → undo/redo in the editor at `/empresa/sitio`: Ctrl/⌘+Z undoes, Ctrl/⌘+Shift+Z and Ctrl+Y redo, plus «Deshacer» and
  «Rehacer» icon buttons (with tooltips naming the shortcut) in the editor header, disabled when there is nothing to undo/redo.
  It covers every draft change: section content, layout (variant), visibility, add, duplicate, delete, order, brand
  (palette, colors, fonts) and Ajustes (slug, SEO). A burst of typing in one field is one step (coalesced while the same
  field keeps changing; a pause ≥ 1 s, a blur or a different field starts a new step); a drag is one step. Undo/redo
  re-selects the affected section so the person sees what changed, and the result autosaves like any edit. While focus
  is in a text field the field's native undo applies (Ctrl+Z inside an input/textarea/rich text stays native). History
  is per page session (lost on reload), capped (≥ 100 steps), and cleared when the draft is replaced from the server
  (reload, «Cargar la versión más reciente»).
- **S2** From the proposal accepted by the user («Fases 1 y 2 (recomendado)»): deleting a section no longer opens the
  «Esta acción no se puede deshacer» dialog; it deletes at once and shows a toast «Sección eliminada» with a «Deshacer»
  action that restores it in its place (selected). «Descartar borrador» (header ⋯ menu, only when the site is published
  and the draft differs from it) returns the draft to the published version after a confirmation, and is itself undoable.
  On a save conflict the person can choose «Conservar mis cambios» (overwrite with the local draft) besides «Cargar la
  versión más reciente».
- **S3** User, verbatim: «en este apartado, las secciones tienen el icono en un lugar incomodo de ver, no me gusta para
  nada» → section rows redesigned: the section type icon is a clearly visible tile at the start of the row (≈32 px, tinted),
  title on one line with the layout name below; status (oculta, incompleta, fija) as small, legible indicators that don't
  cut the title so short; the drag grip is quieter (visible on hover/focus/touch) and the ⋯ menu stays reachable. Every
  section type has its own icon (Portada and Cierre no longer share one).
- **S4** User, verbatim: «y tambien ,cuando arrastro una seccion, no tengo feedback, no se a donde la estoy moviendo,
  donde va a "caer" la seccion, me explico?» → while dragging: a floating copy of the row follows the pointer, the other
  rows move apart (animated, reduced-motion respected) so the gap shows exactly where it will land, the original slot is
  shown as a placeholder, and dropping places it there as one undo step. Portada stays first and Vacantes can't be
  placed above it (or the rules in `model.ts`); a forbidden position is shown as such instead of silently snapping.
  Keyboard: Space/Enter on the grip picks up, ↑/↓ move, Space/Enter drops, Esc cancels and restores; screen-reader
  announcements state the correct final position. The preview shows the insertion line between sections while dragging.
  Item lists inside the forms (beneficios, valores, FAQ, cifras, pasos, galería, testimonios, oficinas) get the same
  drag feedback.
- **S5** User, verbatim: «quiero que seas muy detallista en esto, ve cada posible detalle, cada posible cosa que pueda
  intentar un usuario, etc..» → edge cases are part of done: drag cancelled with Esc or dropped outside, dropping in the
  same place (no-op, no history step), auto-scroll of the list while dragging near its edges, touch drag on phones
  (long-press, page scroll still works), undo after autosave and after a conflict, undo while a section is hidden or
  deleted, rapid Ctrl+Z repeat, shortcuts not firing inside dialogs/menus, the selected section after undo of an add.
  Browser-verified in Chromium and Firefox at 1440 and 390 before merge.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1, S2, S5 | History in the editor store + shortcuts/buttons, delete toast, discard draft, keep-mine conflict (writer A) | |
| T2 | S3, S4, S5 | Section row redesign + sortable drag in the list and in form item lists (writer B) | |
| T3 | S4 | Preview insertion line while dragging + wiring (inline after T1/T2) | |
| T4 | S1–S5 | Browser check (Chromium/Firefox, 1440/390), full suite, merge to main | |

Shared contract between T1 and T2: `editor-state.ts` gets one action `{ type: "reorder"; id: string; toIndex: number }`
(T1 owns it; one dispatch = one history step, a no-op when the index doesn't change, rejected when it breaks the Portada /
Vacantes rules); the list drag (T2) dispatches only that action on drop. No new dependencies: `@dnd-kit/core` 6.3.1
(DragOverlay, sensors, keyboard sensor, autoscroll) is enough.

## Log

- **L1** (2026-11-25) User, verbatim (with screenshots of `/empresa/sitio` and the section list): «Y despues pasamos con
  algo que he estado pensando desde hace tiempo... me gustaria hacer algo especifico con el apartado de "sitio de empleo":
  [Image#1] y es uqe no es que no me guste, la verdad es que siento que esta bien, es bastante funcional, pero me gustaria
  mejorarlo, hay algo que no me termina de encajar, me gustaria llevarlo al siguiente nivel, quiero que lo revises, quiero
  que te metas, quiero que lo veas, analices su estado actual, que funcionalidades tiene, que funcionalidades no tiene
  para ser un creador de sitios de buen nivel, evidentemenet no quiero algo como webflow, eso seria delirante para
  nosotros, no nos dedicamos a eso, pero si quiero que se sienta mas premium, por ejemplo, creo que mas "disenos" de
  secciones un poco mas modernas estarian bien, mas personalizacion, tambien note que no puedo desacer los cambios que ya
  hice, no puedo volver atras, me sigues?? quisiera que investigues a fondo, y me des una propuesta de
  funcionalidades/implementeaciones nuevas para llevar nuestro creador de sitios al siguiente nivel, me sigues? y algo que
  no me gusta de paso te lo digo, es esto: [Image#2] en este apartado, las secciones tienen el icono en un lugar incomodo
  de ver, no me gusta para nada, y tambien ,cuando arrastro una seccion, no tengo feedback, no se a donde la estoy
  moviendo, donde va a "caer" la seccion, me explico? y bueno, quiero que seas muy detallista en esto, ve cada posible
  detalle, cada posible cosa que pueda intentar un usuario, etc..»
- **L2** (2026-11-25) Review (code map + browser walk with saves blocked): no undo anywhere (Ctrl+Z after a reorder does
  nothing; delete dialog says «no se puede deshacer»); drag only fades the row and rings the hovered row, no overlay, no
  gap, no keyboard; drop on a row inserts before it; 14 px icon inline before the title, Portada/Cierre share
  `LayoutTemplate`; titles cut («Misión y…», «Vacan…»). Proposal in 4 phases given in chat; phases 3 (new section
  layouts, per-section style — backend contract change) and 4 (brand, templates, version history) stay as backlog.
- **L3** (2026-11-25) User chose «Fases 1 y 2 (recomendado)» → S1–S5. Branch `feat/careers-editor-undo-dnd` from main
  `d1caab57`.
- **L4** (2026-11-25) T1 `697a5b22` (writer A: history module, reorder/insert actions, shortcuts, header buttons, delete
  toast with «Deshacer», «Conservar mis cambios» behind a confirmation; related 350/350, tsc 0, lint 0 errors) and T2
  `d1667d04` (writer B: icon tiles + status chips, drag overlay/parting rows/placeholder/forbidden state/keyboard/
  announcements in the section list and item lists; related 234/234). Deviations: icons stay lucide (components.json
  library and existing tests), not Tabler. «Descartar borrador» (S2) **not done**: GET `/v2/me/company/site` returns only
  `published: {version, slug, published_at}`, not the published document — needs the backend to expose it (backlog,
  coordinate with the backend session). `697a5b22` alone doesn't typecheck (passes `onReorder` before `d1667d04` declares
  it); the pair does. T3 launched (writer C): one placement rule, Subir/Bajar via reorder, preview insertion line.
- **L5** (2026-11-25) T3 `2a7ab17a` (writer C: single placement rule `placementError`, Subir/Bajar/Alt+arrows via
  reorder with disabled reason, preview «Soltar aquí» line + dimmed dragged section + reveal scroll; related 610/610).
  :3000 was serving a 00:36 production build (pre-branch); rebuilt from `2a7ab17a` and restarted `pnpm start --port 3000`
  (BUILD_ID `EUparV4qBN8zVXiBrRJti`). Independent browser check (Chromium + Firefox, 1440 light/dark, 390 touch; saves
  aborted, persisted order unchanged): S1, S3, S4, S5 pass, S2 delete/undo passes (conflict flow not reachable without the
  server; discard draft not built). Defects for a fix round: auto-scroll overshoot makes a drop near the bottom count as
  outside (cancel); a forbidden slot still parts the rows; «Misión y valores» / «Vacantes abiertas» truncated (~92 px
  title); dimmed dragged section (opacity .4) fails axe color-contrast mid-drag. Pre-existing axe items (not this branch):
  aria-required-children on preview groups with separators and on the ⋯ menu with a switch; nested-interactive on toasts.
  Swipe-to-scroll at 390 verified in Chromium only (Firefox can't emulate mobile touch scrolling).
