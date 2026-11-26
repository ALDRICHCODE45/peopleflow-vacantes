# Careers site: modern section designs and per-section style (Phase 3)

Phase 3 of the «Sitio de empleo» proposal (see `odd/tasks/careers-editor-undo-dnd.md` L1–L2): more modern section
layouts, new sections, per-section style and a visual section library. Design directions first on the canvas; the
backend contract (layout/theme enums validated in `model.ts` and backend `document.go`) changes only after the user
picks a direction, coordinated with the backend session.

## Specs

- **S1** User, verbatim: «no es que no me guste, la verdad es que siento que esta bien, es bastante funcional, pero me
  gustaria mejorarlo, hay algo que no me termina de encajar, me gustaria llevarlo al siguiente nivel ... evidentemenet no
  quiero algo como webflow, eso seria delirante para nosotros, no nos dedicamos a eso, pero si quiero que se sienta mas
  premium, por ejemplo, creo que mas "disenos" de secciones un poco mas modernas estarian bien, mas personalizacion» →
  the public careers site (`/empresas/<slug>`) gets more modern, premium section layouts while staying a curated,
  section-based builder (no free canvas, no arbitrary positioning).
- **S2** From the Phase 3 proposal the user accepted to continue with («seguimos con la siguiente fase de "sitio de
  empresa"»): new layouts — Portada: background video/loop, split with photo collage, overlay intensity, editable text
  for both buttons; Beneficios/Valores: bento grid (mixed card sizes, fixes the lone half-width card) and large-icon
  layout with accent; Cifras: animated count-up and big numbers on a brand band; Testimonios: carousel with large photo
  and video testimonial. New sections: «Equipo / Líderes», «Logos / Reconocimientos», «Áreas de trabajo» (cards that
  filter vacancies by area), «Llamado a talento» (leave your CV when no vacancy fits).
- **S3** Per-section style (proposal): background (normal, soft tint, brand colour, image), spacing (compact / airy),
  alignment (centered / left) — a small curated set per section, never free values.
- **S4** Visual section library (proposal): adding a section shows a thumbnail of each section and of each of its
  layouts, and the preview shows where it will be inserted.
- **S5** Design first (agreed workflow, as with the recruiter table): 2–3 clearly different directions on the canvas at
  1440 and 390, grounded in `design/system.md` (public careers-site `--site-*` tokens) and the existing presentation
  (`frontend/src/features/company-site/public/`), visually reviewed before showing them; the user picks before any
  implementation or backend contract change.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1–S5 | Design directions in `design/careers-site-sections-v2/` (writer, gentle-design) | `8b8c50db` |
| T2 | S1–S4 | Backend contract proposal for the chosen direction (coordinate with the backend session) | `af6a6140` (backend `64e2e379`) |
| T3 | S1–S4 | Frontend implementation of the chosen direction (slice A) | `616b3934`…`105dd1bd` |
| T4 | S1–S4 | Browser check, full suite, merge to main (slice A) | this log + merge; slices B/C pending |
| T5 | S2 | Slice B backend: hero video media (migration, MP4 validation, Range/206 serving) — backend session | |
| T6 | S2 | Slice B frontend: video upload, «Fondo en movimiento» offered, `<video>` hero, proxy Range | |
| T7 | S2 | Slice B browser check, full suite, merge to main | |

## Log

- **L1** (2026-11-25) User, verbatim: «Perfecto hermano, me parece bien, yo hago pus y seguimos con la siguiente fase de
  "sitio de empresa"??» → Phase 3 starts with the design round recommended in the proposal. Branch
  `feat/careers-site-sections-v2` from main `6da82608`. Original request quoted in `odd/tasks/careers-editor-undo-dnd.md` L1.
- **L2** (2026-11-25) T1 design round written to `design/careers-site-sections-v2/` (gentle-design; `design.json` links
  this feature): `01-editorial.html`, `02-bento-moderno.html`, `03-humano-fotografico.html` (public site at 1440, light/dark
  and Grupo Altavista/Terracota palette switch, per-section style notes for S3), `04-editorial-movil.html`,
  `05-bento-moderno-movil.html`, `06-humano-fotografico-movil.html` (same three at 390) and
  `07-editor-biblioteca-y-estilo.html` (visual «Agregar sección» library with insertion preview, and the «Estilo de
  sección» group in Propiedades, S4). Browser review in Chromium: axe wcag2a/aa 0 violations in every artboard and every
  theme/palette combination, no horizontal overflow at the declared widths, visible keyboard focus, reduced motion
  shows final figures and stops the loops. Deviations from `design/system.md` are listed in `self-check.md`. No direction
  is chosen yet; the user picks before T2/T3.
- **L3** (2026-11-25) User, verbatim: «Me gustan los estilos de las 2 y las 3.y me gusta la opcion para editar "Estilo de
  seccion" (1440), pero siempre y cuando se mantenga el hecho de poder redimencionar la seccion de la edicion y la seccion
  de la vista previa y se pueda seguir escondiendo el "editor" me sigues?? que sea todo muy organico y pueda esconder o
  redimencionar las secciones.» → directions 02 (Bento moderno) and 03 (Humano y fotográfico) both kept: their section
  designs become layout options per section (proposed by the agent; e.g. Portada «Fondo en movimiento» from 02 and
  «Foto con vacantes recientes» from 03), and 07's «Estilo de sección» group is adopted inside the current editor whose
  side panels stay resizable and collapsible (list, preview, properties; preview focus mode), properties scrolling on
  their own with collapsible groups. Open: hero video source, «Dejar mi CV» destination.
- **L4** (2026-11-25) User answers: mix «Sí, así (recomendado)» (02 and 03 designs are layout options per section, each
  company picks); hero background video «La empresa sube un video corto» (short MP4 upload with a size limit → backend
  video media); «Llamado a talento» → «Entra a la Base de talento» (unsolicited candidate with CV in the talent base).
- **L5** (2026-11-25) T2 draft: `odd/tasks/careers-site-sections-v2-contract.md` — slice A document additions (new
  variants from 02/03, sections team/logos/areas/talent_cta, per-block `style`, hero button texts; additive v1 amendment,
  no document migration, backend first), slice B hero video upload (media migration, Range serving, proxy), slice C public
  «Dejar mi CV» (anonymous endpoint, talent-base schema, consent, rate limit). B and C are high risk (data/security).
- **L6** (2026-11-25) User answers: order «Sí, A primero (recomendado)» (slice A shipped and merged first; B and C as
  next deliveries, each with its own review); duplicates «Crear y marcar duplicado»; team notice, verbatim: «contador y
  correo» (counter in Base de talento + email to the owner). Slice A goes to the backend session first.
- **L7** (2026-11-25) Backend session took slice A with six adjustments (recorded at the end of the contract file).
  Frontend slice A starts: T3a model/schema first, then editor and presentation in parallel.
- **L8** (2026-11-25) Backend slice A merged into local main `64e2e379` (migration 00066, dev DB v66, :8080 runs it;
  stored documents read byte-identical). The frontend may switch to the v2 model and enable the flag when ready.
- **L9** (2026-11-25) Slice A frontend commits: `b9936898` public presentation, `455a71ce` editor (flag
  `NEXT_PUBLIC_CAREERS_SECTIONS_V2`), `e37a1eb9` §2.3 model reconciliation; main merged `c33b1ee5`. Full suite 662 files /
  12264 passed, tsc 0, lint 0 errors. :3000 rebuilt with the flag on (BUILD_ID `ggeymYA_PAuFXHVWMuFg4`). Browser check
  (Chromium + Firefox): S2 and S4 pass; S1/S3 pass with defects; L3 passes at 1440 but fails at 1024/1280 with the app
  sidebar open (panels can't be shown again: list 224 + preview 448 + properties 288 minimums don't fit). Defects: hidden
  file input in ImageField makes the properties panel scroll sideways; «Tinte suave» = «Normal» on banded sections; Cierre
  ignores alignment; library Vacantes card describedby id collision; phone Sheet truncates «Insertar después de»;
  pre-existing axe aria-required-children (separator in the jobs list). Visual gaps: light headings, heavy empty-photo
  fallbacks, «Íconos grandes» not centred, plain «Banda de marca», slash eyebrows. Phase B persisted round-trip restored
  the draft content exactly (draft_version 33 → 35, published 33 untouched; editor now shows «Cambios sin publicar»).
  Fix round launched.
- **L10** (2026-11-25) Fix round `ea5b6c28` (panels always reachable: fold the other side or open as Sheets below 608 px of
  panel space; distinct «Tinte suave» surface; fixed alignment stated per layout; library ids + phone select; v2 headings
  semibold; light photo placeholders; centred «Íconos grandes» and «Banda de marca»; jobs list separators a11y) and
  `1bca628c` + `87f1e37c` (hidden file input and sr-only helpers no longer overflow the properties scroll area). Full suite
  on `ea5b6c28`: 662 files / 12323 passed, tsc 0, lint 0 errors. Browser re-check (Chromium + Firefox): 11/12 then the
  properties panel measured clean at 1440/1280/1024 (no sideways scroll, single scrollbar); axe 0 violations everywhere.
  :3000 serves BUILD_ID `aZjt_CmVbkudSA5EqNLKC` with the flag on. Waiting for the user's review before merging.
- **L11** (2026-11-25) User review, verbatim: «Bien hermano, estoy revisando y hay algunos problemas: [Image#5] [Image#6] el
  primero es que creo que hay un error (a menos que yo lo este usando mal), pero cuando presiono "Completar seccion" no
  pasa nada, no abre nada, no me dice uqe tengo que completar, no me dice nada.. y si abro el panel izquierdo, hay doss
  cosas que no me gustan, la primera es que para seleccionar el "Diseno de la seccion" como que se corta el borde morado,
  si lo vez? se corta, y parece que no hay borde arriba del diseno seelccionado, y tambien, cuando estoy escribiento el
  titulo nuevo junto con la descrpcion noueva, no se pone en ningun lado, y cuando se pone, en la vista previa sale "Este
  titulo de la seccion. todavia no tiene contenido" y en la introduccion ya directamente no se pone nada, no se si lo
  estoy haciendo algo mal, pero bueno, revisalo a detalle por favor, revisa si hay mas errores de estos o algo parecido,
  a detalle por favor.» → fix round: «Completar sección» selects the section, opens properties and focuses what's
  missing; partial sections render their heading/intro with an editor-only placeholder; selected rings never clipped;
  audit of every type × state, preview buttons, pickers and «Incompleta» hints.
- **L12** (2026-11-25) User-review fix round `12903f0a`: the section's click capture swallowed every preview button (so
  «Completar sección», carousel arrows, FAQ and pause did nothing); «Completar sección» now selects, reveals properties
  (fold/Sheet rules) and focuses the first missing control; partial sections render heading/intro with an editor-only
  slot (15 types / 38 layouts); inset selection rings; «Incompleta» hints («Falta: …») on rows and in a properties note.
  Browser re-check (Chromium + Firefox, 1440/1280/1024/390): the user's flow and the sweep pass, axe 0. Full suite on
  `12903f0a`: 665 files / 12410 passed, tsc 0, lint 0 errors. Follow-up `fce67854`: slots keep the page card/ink on brand,
  image and tint surfaces; both «Completar sección» buttons use the editor colour.
- **L13** (2026-11-25) User, verbatim: «Si hermnao, merge, solamente una cosa: [Image#7] dale un poco mas de espacio a la
  izquierda del icono para hacer el "drag" de la seccion, esta muy pgado al icono y al titulo del contenido.» → `3f5bd60a`
  (row padding 28 px, handle 2–26 px, clear of the icon tile); `105dd1bd` flag ON by default
  (`NEXT_PUBLIC_CAREERS_SECTIONS_V2=false` is the kill switch; vitest runs with it off to keep the pre-v2 mode pinned).
  Default-on build `jRNJKnPQDm6--yRC1Rr5e` serves the v2 library; full suite 665 files / 12411 passed, tsc 0, lint 0
  errors. Native review assess unassessable (untracked canvas files); plan required no extra verifier. Merged slice A to
  local main; the user pushes. Next: slice B (hero video), slice C («Dejar mi CV»).
- **L14** (2026-11-26) User, verbatim: «ya esta pusheado todo, adelante con los siguientes pasos recomendados.» → slice B
  (hero background video) on branch `feat/careers-hero-video` from main `97f2c28a`; slice C waits for two user decisions
  (CV retention period, owner email per CV vs daily digest). Agent decision for slice B: no ffmpeg (deploy image
  unchanged; structural MP4 validation; always muted, looped, playsinline, paused under reduced motion).

