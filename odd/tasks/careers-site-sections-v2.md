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
