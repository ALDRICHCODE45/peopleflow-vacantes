# v0 prompt — Company careers-site builder (editor + public site)

Context: user request (2026-10-26, `odd/tasks/company-careers-builder.md` L1–L4): replace the current prototype careers
editor and public company page with a professional, block-based careers-site builder. Decisions: curated blocks with
variants; all block groups in v1; logo/cover/brand color/curated fonts; autosaved draft + explicit publish at
`/empresas/<slug>`; real image upload with crop; YouTube/Vimeo embeds; owner publishes, recruiters edit; company
identity comes from the company profile; editor layout is v0's creative proposal.

---

## Prompt (paste into v0)

Design a **careers-site builder** for **PeopleFlow**, a Spanish-language (Mexico) recruitment platform used by
companies and recruitment agencies. A company builds its own public careers website — the page candidates see before
applying — from **curated, predesigned blocks**, and publishes it at `peopleflow.mx/empresas/<slug>`. I need **two
surfaces in one project**:

1. **The editor** (inside the employer app), where recruiters build and preview the site.
2. **The public careers site** (what candidates see), rendered from the same blocks.

It must feel like a premium product on the level of Teamtailor, Workable or Greenhouse career sites: editorial,
confident, human, with strong photography and typography — not a generic template. **You have full creative freedom
over the editor's layout, navigation and interaction model, and over the visual design of every block and its
variants**, as long as you respect the hard rules below. Do not implement real data fetching or persistence: use
realistic local mock data and local state to demonstrate every behavior and state.

All visible UI text must be in **neutral Mexican Spanish** (tú). Use the exact Spanish labels given below when provided.
Mock company: **Nexo Labs**, a 120-person software company in Monterrey, Nuevo León (use tasteful placeholder photos of
offices and teams; never real logos of other brands).

### Visual language (must follow)

- Stack: Next.js App Router, React, TypeScript, Tailwind CSS v4, **shadcn/ui on Base UI** (`render` prop instead of
  `asChild`), lucide-react icons. Use shadcn components with their **official composition** (Card → CardHeader/
  CardTitle/CardDescription/CardAction/CardContent/CardFooter; Field → FieldLabel/control/FieldDescription/FieldError
  inside FieldGroup/FieldSet; Dialog/AlertDialog with header, body and footer; Sheet; Tabs; ToggleGroup; Accordion;
  Badge; Separator; Skeleton; Spinner; Tooltip; Empty for empty/error states; DropdownMenu). Never hand-roll what
  shadcn already provides.
- **Editor (app chrome):** Inter everywhere, calm dense-but-airy SaaS style (Linear / Framer / Webflow-lite feel),
  neutral surfaces with the PeopleFlow **purple primary** (around `#7835db` light / `#b28af0` dark), rounded-xl cards,
  soft rings instead of heavy borders, 4/8-pt spacing, controls **≥ 40 px tall**, light and dark mode. The app shell
  already exists (collapsible left sidebar, top header with breadcrumb «Sitio de empleo» and a theme toggle): design
  only the page content area — you may make the editor full-bleed inside it. Toasts bottom-right.
- **Public site (company-branded):** uses the **company's brand color** and **chosen font pairing** instead of the
  PeopleFlow purple, but the same component quality, spacing scale and accessibility. Must look right in light and dark
  mode and at 1440 px, 768 px and 390 px. A small, quiet «Sitio creado con PeopleFlow» in the footer.
- Product principles: design for the decision the user is making; comparable things look the same; correct Spanish
  pluralization («1 vacante», «3 vacantes»); plain language, no technical jargon; **never invent data** — empty
  content shows an honest editor placeholder and is omitted on the public site; images always have Spanish alt text;
  important irreversible actions are confirmed with an AlertDialog whose initial focus is «Cancelar».

### Editor — functional requirements (layout is yours)

- **Live preview** of the site as it is being edited, with a device switch: **Escritorio / Tableta / Móvil**.
- **Blocks list** in page order: add a block from a **library** (each entry with a thumbnail, name and one-line
  description), **reorder** (drag handle plus keyboard-accessible «Subir» / «Bajar»), **hide/show**, **duplicate**,
  **delete** (AlertDialog). «Portada» and «Vacantes abiertas» are always present: they can be reordered and edited but
  not deleted or hidden.
- **Select a block** from the list or by clicking it in the preview; its properties open for editing: content fields
  and a **variant picker** (2–3 visual variants per block, shown as small thumbnails).
- **Marca** (brand) settings: **color de marca** (preset swatches + custom hex) with an automatic **contrast check** —
  if the color is too light/dark to read, show «Este color no tiene suficiente contraste; usaremos un tono ajustado
  para textos y botones.» and preview the adjusted shade; **tipografía** with 3 curated pairings shown as live samples:
  «Clásica» (Inter), «Editorial» (Fraunces + Inter), «Moderna» (Plus Jakarta Sans).
- **Datos de la empresa** come from the company profile and are **read-only here**: name, logo, description, website
  and social links, with a link «Editar en Configuración». The cover photo used by «Portada» can be uploaded here.
- **Configuración del sitio**: **Dirección del sitio** (slug) with the live URL preview `peopleflow.mx/empresas/nexo-labs`,
  rules: 3–60 characters, lowercase letters, numbers and hyphens, unique («Esta dirección ya está en uso.»), reserved
  words rejected; **SEO**: título (≤ 60) and descripción (≤ 160) with a search-result preview; social image = cover.
- **Images**: upload (JPEG, PNG or WebP, ≤ 5 MB) with progress, then a **crop** dialog: cover 16:9, gallery 4:3,
  testimonial photo 1:1 (logo is managed in Configuración). Alt text is required for every image («Describe la imagen
  para quien no puede verla»). Errors: «El archivo pesa más de 5 MB.», «Usa una imagen JPEG, PNG o WebP.».
- **Autosave** of the draft with a persistent status: «Guardando…», «Guardado hace 2 min», «Sin conexión · tus cambios
  se guardarán al reconectar», and conflict «Alguien más editó este sitio» with «Ver la versión actual» (never merge
  silently). Validation errors appear in their field and the block shows an error marker in the blocks list.
- **Publication**: status badge always visible — **Sin publicar**, **Publicado**, or **Publicado · cambios sin
  publicar**. «Ver como visitante» opens the draft preview full screen. «Publicar» runs a **checklist** first (slug set;
  Portada has a title; at least one more visible block besides Portada and Vacantes; every visible block valid; company
  has name and logo — «Completa el logo en Configuración») with links to each issue, then an AlertDialog «¿Publicar el
  sitio de Nexo Labs?» — «Tu sitio quedará visible en peopleflow.mx/empresas/nexo-labs.» → «Publicar sitio»
  («Publicando…»). After publishing: toast «Sitio publicado» with «Ver sitio». «Despublicar» (AlertDialog) takes it
  offline. **Only the company owner can publish/unpublish**; a recruiter sees the button disabled with the reason «Solo
  la persona dueña de la empresa puede publicar. Tus cambios quedan guardados en el borrador.».
- Mobile editor (≤ 390 px) must stay usable: e.g. a preview-first view with editing panels in Sheets.

### Block library (hard rules — content and limits)

Every block: `variant` (2–3 options you design), `hidden` flag. Character limits are hard limits with a live counter.

1. **Portada** (hero, required): título (≤ 80), subtítulo (≤ 200), cover photo, two buttons «Ver vacantes» (scrolls to
   Vacantes abiertas) and «Conoce la empresa» (scrolls to the next block). Variants e.g. photo background with overlay,
   split text/photo, centered over a soft brand tint.
2. **Historia**: título (≤ 80), texto (rich text: paragraphs, bold, italic, bulleted lists, links; ≤ 5,000), optional
   photo.
3. **Misión y valores**: misión (≤ 300), 1–8 valores, each: icon (from a curated set of ~24 lucide icons), título (≤ 60),
   descripción (≤ 240).
4. **Beneficios**: 1–24 items, each icon, título (≤ 60), descripción (≤ 160); quick-add from the standard list:
   Seguro de gastos médicos, Equipo de cómputo, Horario flexible, Apoyo para trabajo remoto, Presupuesto de
   capacitación, Días libres adicionales, Bienestar, Bono anual.
5. **Cifras**: 1–6 items, each valor (≤ 12, e.g. «120+», «2015», «4.8/5») and etiqueta (≤ 60). Editor note: «Usa solo
   datos reales de tu empresa.».
6. **Proceso de selección**: 2–8 pasos, each título (≤ 60), descripción (≤ 200), duración opcional (≤ 30, e.g. «30 min»).
7. **Galería de cultura**: 2–12 photos, each with alt (≤ 160, required) and optional pie de foto (≤ 120). Variants e.g.
   grid, mosaic, carousel (carousel with keyboard controls).
8. **Testimonios**: 1–6, each cita (≤ 400), nombre (≤ 80), puesto (≤ 80), optional photo; checkbox required
   «Esta persona autorizó publicar su testimonio».
9. **Video**: YouTube or Vimeo URL («Pega un enlace de YouTube o Vimeo»; anything else is rejected), título (≤ 80),
   optional descripción (≤ 200). On the public site show a poster with a play button; the player loads **only on
   click**.
10. **Oficinas**: 1–20 locations, each nombre (≤ 80), ubicación (País; for México also Estado and Municipio, picked from
    lists — never free text), dirección opcional (≤ 200), optional «Ver en mapa» link. No embedded map.
11. **Vacantes abiertas** (required): título (≤ 80), introducción (≤ 200). Shows the company's **real published
    vacancies** (mock 7 of them): title, modalidad (Presencial / Remoto / Híbrido), ubicación or «Remoto · Desde
    cualquier lugar», jornada, published date; each links to the vacancy detail. Filters: search by title, modalidad,
    ubicación (estado). Empty state: «Por ahora no hay vacantes abiertas. Vuelve pronto.»; no results: «No encontramos
    vacantes con estos filtros.» + «Quitar filtros». Variants e.g. list, cards, grouped by área.
12. **Preguntas frecuentes**: 1–20, each pregunta (≤ 160) and respuesta (≤ 1,000); accordion on the public site.
13. **Cierre**: título (≤ 80), texto (≤ 240), button «Ver vacantes»; shows the company's social links from the profile.

Public site frame (not blocks): header with company logo + name and anchor navigation built from the visible blocks
(collapses to a menu on mobile), and the footer described above.

### Deliverables

1. **Editor** on desktop (≥ 1280 px) and mobile (≤ 390 px), light and dark, with these states: new site (only Portada +
   Vacantes, empty placeholders); site being built with several blocks; block library open; a block selected with its
   variant picker; image upload + crop dialog; brand settings with a low-contrast color warning; slug taken error;
   autosave states (saving, saved, offline, conflict); publish checklist with missing items; publish AlertDialog;
   published with unpublished changes; recruiter (cannot publish) view; loading skeleton.
2. **Public site** for Nexo Labs using every block (at least two different variants shown across blocks) at 1440, 768
   and 390 px, light and dark, in two brand configurations (e.g. deep green + «Editorial», orange + «Moderna»), plus the
   jobs empty state and «no results» state.
3. Short notes explaining the editor's layout/interaction model and the design system of the blocks (spacing, type
   scale, how brand color is applied, how variants differ).
