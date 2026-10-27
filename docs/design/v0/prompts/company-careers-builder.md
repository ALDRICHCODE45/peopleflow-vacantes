# v0 prompt — Company careers-site builder (editor + public site)

Context: user request (2026-10-26, `odd/tasks/company-careers-builder.md` L1–L4): replace the current prototype careers
editor and public company page with a professional, block-based careers-site builder. Decisions: curated blocks with
variants; all block groups in v1; logo/cover/brand color/curated fonts; autosaved draft + explicit publish at
`/empresas/<slug>`; real image upload with crop; YouTube/Vimeo embeds; owner publishes, recruiters edit; company
identity comes from the company profile; editor layout is v0's creative proposal.

Revision 2026-10-27 (user): v0 has no access to the repository — no stack or component names, only the system's
visual line (palette, type, shape, tone); full creative freedom, modern, UX/UI first. Values below are the real tokens
of `frontend/src/app/globals.css` (light/dark).

---

## Prompt (paste into v0)

Design a **careers-site builder** for **PeopleFlow**, a recruitment platform in Spanish (Mexico) used by companies and
recruitment agencies to publish vacancies and manage candidates. With this builder a company creates its own public
careers website — the page candidates see before applying — and publishes it at `peopleflow.mx/empresas/<slug>`.

I need **two experiences in one project**:

1. **The editor**, inside the company's PeopleFlow workspace, where recruiters build, preview and publish the site.
2. **The public careers site**, what candidates see, built from the same content.

**You have complete creative freedom.** I am not giving you a layout, a navigation model or a visual composition: design
the editor and every section of the site the way you think works best. The only requirements are that it feels
**modern and premium** — on the level of the best careers sites and site builders you know — and that **UX/UI comes
first**: clear hierarchy, obvious next steps, honest states, fast to understand, comfortable on desktop and mobile,
accessible. Use realistic mock data and local state to demonstrate every behavior and state below; nothing needs a real
backend. Briefly explain the decisions you make.

All visible text must be in **neutral Mexican Spanish** (tú). When an exact Spanish label is given below, use it.
Mock company: **Nexo Labs**, a 120-person software company in Monterrey, Nuevo León. Use tasteful placeholder photos of
offices and teams; never real logos of other brands.

### PeopleFlow's visual line (the editor must belong to it)

- **Personality:** calm, confident, human SaaS. Dense where people work, airy where they read. No decorative gradients,
  no emoji, no gimmicks; quality comes from hierarchy, spacing and typography.
- **Typography:** **Inter** for everything (headings and body), with a clear scale: one page title, section titles,
  labels, and helper text in a muted tone.
- **Color — light theme:** page background `#F7F5FB` (a very soft lavender-tinted neutral), surfaces `#FFFFFF`, text
  `#1A1626`, secondary surfaces `#F1EEF7`, muted text `#6B6480`, hairline borders `#E4DFF0`, and a **vivid violet
  primary** (around `#7C3AED`) for primary actions, selection and focus.
- **Color — dark theme:** background `#0C0912`, surfaces `#15121F`, text `#F6F2FF`, secondary surfaces `#171226`, muted
  text `#A79FBF`, borders `#262233`, and a slightly deeper violet primary (around `#6D28D9`). Both themes are first-class.
- **Errors and destructive actions** use a clear red; everything else stays neutral and violet. Status is never
  communicated by color alone.
- **Shape:** soft, rounded geometry (about 10 px on controls, more on large surfaces), hairline borders or very soft
  shadows instead of heavy ones; consistent 4/8-pt spacing.
- **Comfort:** every interactive target at least **40 px** tall; visible keyboard focus; WCAG AA contrast.
- **Feedback conventions:** notifications appear at the **bottom-right**; loading placeholders mirror the final layout;
  important irreversible actions ask for confirmation with «Cancelar» as the safe default; plain language, never error
  codes; correct Spanish plurals («1 vacante», «3 vacantes»); **never invent data** — empty content shows an honest
  placeholder in the editor and is simply omitted on the public site.
- The editor lives inside the existing PeopleFlow workspace (a left navigation and a top bar with the page title
  «Sitio de empleo» already exist); you design the content area and may use all of it.

### The public site's visual line

The public site belongs to **the company, not to PeopleFlow**: it uses the company's **brand color** and its chosen
**font pairing** instead of the PeopleFlow violet, with the same level of craft, spacing discipline and accessibility.
It must look excellent in light and dark mode and at 1440, 768 and 390 px wide. Only a small, quiet «Sitio creado con
PeopleFlow» in the footer.

### What the editor must let people do (how it looks and is organized is up to you)

- See a **live preview** of the site while editing, and switch it between **Escritorio / Tableta / Móvil**.
- Build the page from a **library of predesigned sections** (each with a name and a one-line description): add,
  reorder (also by keyboard), hide/show, duplicate and delete sections (delete asks for confirmation). «Portada» and
  «Vacantes abiertas» are always present: they can be edited and moved but not deleted or hidden.
- Select a section — from the section list or directly in the preview — to edit its content and choose among **2–3
  visual variants** of that section (you design the variants).
- **Marca:** choose the **color de marca** (suggested swatches plus a custom color) with an automatic readability
  check; when a color is too light or too dark to read, explain «Este color no tiene suficiente contraste; usaremos un
  tono ajustado para textos y botones.» and show the adjusted shade. Choose one of three **font pairings**, shown as
  live samples: «Clásica» (Inter), «Editorial» (Fraunces + Inter), «Moderna» (Plus Jakarta Sans).
- **Datos de la empresa** (name, logo, description, website, social links) come from the company profile and are
  **read-only here**, with a way to go «Editar en Configuración».
- **Configuración del sitio:** the **Dirección del sitio** (slug) with a live preview of the URL
  `peopleflow.mx/empresas/nexo-labs` — 3–60 characters, lowercase letters, numbers and hyphens, unique («Esta dirección
  ya está en uso.»), some words reserved; and **SEO**: título (≤ 60) and descripción (≤ 160) with a preview of how the
  site appears in search results.
- **Images:** upload JPEG, PNG or WebP up to 5 MB with visible progress, then **crop** to the right shape (cover 16:9,
  gallery 4:3, testimonial photo 1:1). Every image needs a description for people who can't see it («Describe la imagen
  para quien no puede verla»). Errors: «El archivo pesa más de 5 MB.», «Usa una imagen JPEG, PNG o WebP.»
- **Automatic saving** with a status that is always visible: «Guardando…», «Guardado hace 2 min», «Sin conexión · tus
  cambios se guardarán al reconectar», and «Alguien más editó este sitio» with «Ver la versión actual» (changes are
  never merged silently). Invalid fields are explained next to the field and the affected section is flagged.
- **Publishing:** a status that is always visible — **Sin publicar**, **Publicado**, **Publicado · cambios sin
  publicar**. «Ver como visitante» shows the draft as candidates would see it. «Publicar» first shows what is missing
  (address chosen; Portada has a title; at least one more visible section besides Portada and Vacantes; every visible
  section complete; the company has a name and a logo — «Completa el logo en Configuración»), each item leading to the
  place where it is fixed; then a confirmation «¿Publicar el sitio de Nexo Labs?» — «Tu sitio quedará visible en
  peopleflow.mx/empresas/nexo-labs.» → «Publicar sitio» («Publicando…»). After publishing: «Sitio publicado» with «Ver
  sitio». «Despublicar» (confirmed) takes it offline.
- **Roles:** only the company **owner** can publish or unpublish. A recruiter can edit everything but sees publishing
  unavailable with the reason «Solo la persona dueña de la empresa puede publicar. Tus cambios quedan guardados en el
  borrador.»
- The editor must stay genuinely usable on a phone (≤ 390 px).

### Sections and their content (hard limits — they are product rules, not design)

Character limits are hard limits; show remaining characters where it helps.

1. **Portada** (always present): título (≤ 80), subtítulo (≤ 200), cover photo, and two actions «Ver vacantes» (goes to
   Vacantes abiertas) and «Conoce la empresa» (goes to the next section).
2. **Historia**: título (≤ 80), formatted text (paragraphs, bold, italic, bulleted lists, links; ≤ 5,000 characters),
   optional photo.
3. **Misión y valores**: misión (≤ 300) and 1–8 values, each with an icon (from a curated set of about 24), título
   (≤ 60) and descripción (≤ 240).
4. **Beneficios**: 1–24 benefits, each with icon, título (≤ 60), descripción (≤ 160); quick-add from: Seguro de gastos
   médicos, Equipo de cómputo, Horario flexible, Apoyo para trabajo remoto, Presupuesto de capacitación, Días libres
   adicionales, Bienestar, Bono anual.
5. **Cifras**: 1–6 figures, each valor (≤ 12, e.g. «120+», «2015», «4.8/5») and etiqueta (≤ 60), with the reminder
   «Usa solo datos reales de tu empresa.»
6. **Proceso de selección**: 2–8 steps, each título (≤ 60), descripción (≤ 200) and optional duración (≤ 30, e.g.
   «30 min»).
7. **Galería de cultura**: 2–12 photos, each with a required description (≤ 160) and optional caption (≤ 120).
8. **Testimonios**: 1–6, each cita (≤ 400), nombre (≤ 80), puesto (≤ 80), optional photo, and a required confirmation
   «Esta persona autorizó publicar su testimonio».
9. **Video**: a YouTube or Vimeo link («Pega un enlace de YouTube o Vimeo»; anything else is rejected), título (≤ 80),
   optional descripción (≤ 200). On the public site the video loads only when the visitor chooses to play it.
10. **Oficinas**: 1–20 locations, each nombre (≤ 80), ubicación (country; in Mexico also state and municipality, chosen
    from lists, never typed freely), optional dirección (≤ 200) and an optional «Ver en mapa» link. No embedded map.
11. **Vacantes abiertas** (always present): título (≤ 80), introducción (≤ 200). Shows the company's **real published
    vacancies** (mock 7): title, modalidad (Presencial / Remoto / Híbrido), location or «Remoto · Desde cualquier
    lugar», jornada and publication date, each leading to its detail. Visitors can search by title and filter by
    modalidad and estado. Empty: «Por ahora no hay vacantes abiertas. Vuelve pronto.»; no results: «No encontramos
    vacantes con estos filtros.» with «Quitar filtros».
12. **Preguntas frecuentes**: 1–20 questions (≤ 160) with answers (≤ 1,000).
13. **Cierre**: título (≤ 80), texto (≤ 240), action «Ver vacantes», and the company's social links.

The public site also has a header with the company's logo and name and navigation to its visible sections, and the
footer mentioned above.

### Deliverables

1. **The editor** on desktop (≥ 1280 px) and mobile (≤ 390 px), light and dark, showing: a brand-new site (only
   Portada and Vacantes, with placeholders); a site with several sections; the section library; a selected section with
   its variants; image upload and crop; brand settings with the low-contrast warning; a taken address; every saving
   state (saving, saved, offline, someone else edited); the publish checklist with missing items; the publish
   confirmation; published with unpublished changes; the recruiter (cannot publish) view; loading.
2. **The public site** for Nexo Labs using every section (showing different variants across sections) at 1440, 768 and
   390 px, light and dark, in two brand configurations (e.g. deep green with «Editorial», orange with «Moderna»), plus the
   empty and no-results states of Vacantes abiertas.
3. Short notes on the editor's interaction model and on the design system you created for the sections (spacing, type
   scale, how the brand color is applied, how the variants differ).
