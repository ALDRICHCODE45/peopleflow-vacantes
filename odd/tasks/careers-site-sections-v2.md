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
| T1 | S1–S5 | Design directions in `design/careers-site-sections-v2/` (writer, gentle-design) | |
| T2 | S1–S4 | Backend contract proposal for the chosen direction (coordinate with the backend session) | |
| T3 | S1–S4 | Frontend implementation of the chosen direction | |
| T4 | S1–S4 | Browser check, full suite, merge to main | |

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
