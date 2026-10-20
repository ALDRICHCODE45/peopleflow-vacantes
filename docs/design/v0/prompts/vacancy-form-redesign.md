# v0 prompt — Vacancy creation form redesign

Context: user request (2026-10-20): «quiero hacer un rediseno del formulario mas importante de este
sistema … el formulario de creacion de la vacante … dame por favor, el prompt, pero el prompt debe
contener todos los detalles de comportamiento del formulario … pasale el estilo que ocupamos, el
system design … QUE QUEREMOS O COMO QUEREMOS EL RESULTADO FINAL, pero dejarlo libre para que el haga
su propia propuesta de diseno». Behavior inventory taken from the current editor on
`feat/geo-search-ui` (frontend/src/features/jobs/drafts/**, employer-vacancies/publication/**).

---

## Prompt (paste into v0)

Design a redesigned **vacancy creation and editing form** for **PeopleFlow**, a Spanish-language
(Mexico) recruitment platform used by companies and recruitment agencies to publish vacancies and
manage candidates in a hiring pipeline. This is one of the most important screens of the product:
recruiters spend a lot of time here, they often build a vacancy over several sessions, and a
vacancy can only be published when it is complete. The current form works well; I want a clearly
better UX/UI. **You have full creative freedom over layout, navigation, hierarchy and visual
treatment**, as long as you respect the hard rules below and the visual language of the product.
Do not implement real data fetching or persistence: use realistic local mock data and local state
to demonstrate every behavior and state described here.

All visible UI text must be in **neutral Mexican Spanish** (tú). Use the exact Spanish labels and
messages given below when provided.

### Visual language (must follow)

- Stack: Next.js App Router, React, TypeScript, Tailwind CSS v4, **shadcn/ui on Base UI**
  (`render` prop instead of `asChild`), lucide-react icons. Use shadcn components with their
  **official composition** (Card → CardHeader/CardTitle/CardDescription/CardAction/CardContent/
  CardFooter; Field → FieldLabel/control/FieldDescription/FieldError inside FieldGroup/FieldSet;
  Dialog → DialogHeader(Title, Description)/body/DialogFooter(DialogClose «Cancelar» + primary);
  AlertDialog for confirmations with AlertDialogMedia icon; Combobox for searchable lists;
  InputGroup for inputs with addons; Empty for empty/error states; Tabs; Badge; Separator;
  Skeleton; Spinner; Tooltip; Sheet). Never hand-roll what shadcn already provides.
- Typography: **Inter** everywhere. Calm, dense-but-airy SaaS style (Linear / Stripe dashboard
  feel), not marketing. Clear hierarchy: one page title, section titles, field labels, helper text
  in muted foreground. No decorative gradients, no emoji.
- Color: neutral surfaces with a **purple primary** (around `#7835db` light / `#b28af0` dark),
  `muted` backgrounds for secondary areas, `destructive` only for errors/destructive actions.
  Must look right in **light and dark mode**.
- Shape and spacing: rounded-xl cards, soft rings instead of heavy borders, consistent 4/8-pt
  spacing, controls **at least 40 px tall** (touch targets ≥ 40 px).
- App shell already exists: collapsible left sidebar, top header with breadcrumb «Vacantes /
  Nuevo borrador» (or «Editar borrador») and a theme toggle at the top right. Design only the page
  content area. Toasts appear **bottom-right** (Sonner-like), never top-right.
- Product principles: design for the decision the user is making; comparable things look the
  same; every count is correctly pluralized («1 habilidad», «2 habilidades»); plain language, no
  technical jargon or error codes in the UI; never invent data (if something is not published,
  say so: «Salario no publicado»); loading skeletons mirror the final layout; full-screen
  error/empty states use a centered Card with the shadcn Empty composition (icon tile, title,
  description, primary + secondary action); important irreversible actions are confirmed with an
  AlertDialog whose initial focus is «Cancelar».

### What the form must contain (hard rules — data and contract)

The vacancy is a **draft** that can be saved incomplete at any time; completeness is only
enforced when **publishing**. Every value that IS entered must be valid to save.

**1. Información básica**
- **Título** (text, ≤ 200 characters).
- **Modalidad**: Presencial / Remoto / Híbrido.
- **Jornada**: Tiempo completo / Medio tiempo.
- **Tipo de contrato**: Por proyecto / Indefinido / Servicios profesionales / Temporal / Becas.
- **Nivel**: Prácticas / Junior / Intermedio / Senior / Líder.
- **Área profesional** (16 options): Tecnología y sistemas; Ingeniería; Producto; Diseño y
  creatividad; Ventas y desarrollo de negocio; Marketing y comunicación; Administración y
  finanzas; Recursos humanos; Operaciones y producción; Logística y transporte; Atención a
  clientes; Salud; Educación y formación; Legal; Construcción y mantenimiento; Turismo y
  gastronomía.
- **Ubicación** (structured, never free text): searchable **País** (world list; defaults to
  México), and for México: optional **Código postal** (exactly 5 digits) plus searchable
  **Estado** and **Municipio**. Municipio is disabled until a state is chosen. Changing the
  country clears state, municipality and postal code; changing the state clears the
  municipality. A postal code that resolves to one place **pre-fills** state and municipality but
  they stay editable; if it matches several municipalities, the user picks one from a short list
  («Este código postal corresponde a varios municipios»). If the user then picks a municipality
  the postal code does not belong to, the postal code is removed with the note «Quitamos el
  código postal porque no corresponde al municipio elegido.». Unknown postal code: «No
  encontramos ese código postal.». Non-Mexican countries only store the country, with «Por ahora
  solo detallamos ubicaciones en México.». Typing only filters; it never creates a location.
- Modalidad rules: **Presencial and Híbrido** require a complete location to publish (country;
  for México also state and municipality). **Remoto** makes the location optional («Ubicación
  (opcional)», with «Quitar ubicación») and adds the required question **«¿Desde dónde pueden
  postular?»** with two choices: **«Desde cualquier lugar»** or **«Solo desde estos países»**;
  the second needs a searchable multi-select of countries shown as removable chips, in the order
  chosen, 1–50, no duplicates. Switching modalidad keeps (hides) the remote settings rather than
  deleting them.
- **Solicitante** (who asked for the vacancy): **Tipo de solicitante**: Área interna / Cliente,
  then **Área o cliente** picked from a searchable, paginated catalog («Cargar más», «Quitar
  selección»). Changing the type clears the selection and says why. If the name does not exist,
  the user can create it inline: «Crear “{nombre}”» → «Crear y seleccionar» / «Cancelar»
  (creation is immediate and independent of saving the draft; a duplicate offers «Seleccionar
  existente»). Names ≤ 160 characters.

**2. Descripción y perfil**
- **Descripción**: rich text editor — paragraphs, line breaks, bulleted and numbered lists
  (nestable), **Negrita**, **Cursiva**, text size (pequeño / normal / grande), links («Dirección
  del enlace» → «Aplicar enlace», only http/https), undo/redo. No headings, images or tables.
- **Requisitos obligatorios** and **Requisitos deseables**: two long plain-text areas.
- **Habilidades**: list of short entries (≤ 200 characters each, up to 100, no duplicates),
  add/remove.
- **Idiomas**: up to 100 rows; each row: **Idioma** (Español / Inglés / Otro — «Otro» reveals
  **Nombre del idioma**) and optional **Nivel** (Básico / Intermedio / Avanzado / Nativo).

**3. Compensación y beneficios**
- **Modo de compensación**: Monto fijo (one **Monto**) or Rango (**Mínimo** / **Máximo**,
  máximo ≥ mínimo). Amounts: 0 – 999,999,999,999.99, up to 2 decimals, numeric keyboard.
- **Moneda**: Peso mexicano (MXN) / Dólar estadounidense (USD). **Periodo de pago**: Por hora /
  Semanal / Quincenal / Mensual / Anual. **Base**: Bruto / Neto.
- Checkbox **«Mostrar la compensación cuando se publique la vacante»** (when off, the public page
  says «Salario no publicado»).
- **Prestaciones**: 8 standard checkboxes — Seguro de gastos médicos, Equipo de cómputo, Horario
  flexible, Apoyo para trabajo remoto, Presupuesto de capacitación, Días libres adicionales,
  Bienestar, Bono anual — plus **Prestaciones adicionales**: free entries (≤ 200 characters, up
  to 100, no duplicates).

**4. Preguntas de filtro** (screening questionnaire, optional)
- Up to 100 questions. Each: **Enunciado** (≤ 2,000 characters) and **Tipo**: «Abierta (respuesta
  libre)», «Opción única (informativa)», «Opción única (con respuesta correcta)». Choice types need
  2–8 distinct options; the evaluated type needs exactly one **Respuesta correcta**. Add/remove
  questions and options. Candidates never see the correct answer.
- **«Probar cuestionario»**: a simulation of what the candidate will see (Anterior / Omitir /
  Siguiente / Finalizar simulación), nothing saved, no score.

**5. Revisión y publicación**
- **Vista previa pública**: exactly how candidates will see the vacancy (title, location or
  «Remoto · Desde cualquier lugar» / «Remoto · Solo desde México, Colombia y 2 más», facts,
  description, requirements, skills, languages, benefits, salary or «Salario no publicado»). It
  must never show the requester or a hidden salary.
- **Revisión interna**: requester, questionnaire, salary visibility.

### Saving (hard rules)

- Save is **explicit**: «Guardar borrador» (first time) / «Guardar cambios» (later), pending
  «Guardando…». No autosave. Toasts: «Borrador guardado» / «Cambios guardados».
- A persistent save status is always clear: «Guardado · versión 3 · hace 2 min», «Cambios sin
  guardar», «No se guardó · …», «Resultado sin confirmar».
- **Conflict**: if someone else changed the draft meanwhile, the save is rejected without losing
  the user's edits: «Esto cambió en otro lugar» with a way to review/reload; never auto-merge,
  never auto-retry.
- **Uncertain result** (no response): never retry automatically; offer an explicit read-only
  «Comprobar».
- Validation: invalid entered values block saving; each error appears **in its field** with a
  short message, the user is taken to the first error and focus moves there; fixing a field
  clears its error. Server-side location errors also land on the exact field (País / Estado /
  Municipio / Código postal / Países).

### Publishing (hard rules)

- Publishing requires the latest changes to be saved («Guarda los cambios antes de publicar»).
- A **readiness checklist** lists what is missing, grouped by where it is fixed, each item with a
  «Completar» link that takes the user to the exact field: in this form — Título, Descripción,
  «Agrega la ubicación de la vacante.», «Completa estado y municipio.», «Indica desde dónde
  pueden postular.», Modalidad, Jornada, Tipo de contrato, Área profesional, Solicitante; in the
  vacancy's request settings — Fecha de solicitud, Plazas a cubrir; in its delivery settings —
  Columna de corte, Objetivo de entrega, Fecha compromiso, «La fecha compromiso ya pasó.».
- When ready: AlertDialog «¿Publicar {título}?» — «Empieza a contar el tiempo de entrega y la
  vacante queda activa. No se puede deshacer.» with a summary (Vacante, Columna de corte,
  Objetivo de entrega, Fecha compromiso) and «Cancelar» / «Publicar vacante» («Publicando…»).
- After publishing the status becomes **Activa**; the vacancy stays editable, but the user cannot
  remove data required for publication («La vacante está publicada · No puedes dejarla sin: …
  Tus cambios siguen aquí.»).
- Status badge always visible: **Borrador**, **Activa**, or **Estado por confirmar**.

### Current UX decisions you MAY rethink (propose something better)

- Today it is a 5-step wizard with a numbered rail that is **not clickable**; «Atrás /
  Continuar» move between steps without validating; everything is saved only from the last step.
- The preview exists **only on the last step**; there is no live preview while editing.
- There is no overview of how complete the vacancy is for publishing until the final step.
- Errors are discovered only when saving; there is no error summary.
- There is no warning when leaving the page with unsaved changes (only a static notice that
  unsaved changes are lost).
- Long lists (skills, languages, benefits, questions) have no reordering.
Ideas welcome: free navigation between sections, a sticky save/publish bar, a live preview panel
(desktop) or preview sheet (mobile), a «lista para publicar» progress indicator fed by the same
checklist, inline section completeness, smarter grouping, keyboard-friendly list editing,
unsaved-changes guard. Justify your choices briefly in the design.

### Deliverables

1. The full form on **desktop (≥1280 px)** and **mobile (≤390 px)**, light and dark.
2. Interactive states with mock data: empty new draft; partially filled draft; field errors after
   «Guardar»; saving; saved; conflict «Esto cambió en otro lugar»; uncertain result with
   «Comprobar»; remote vacancy with «Solo desde estos países»; postal code with several
   municipalities; publish checklist with missing items; publish confirmation AlertDialog;
   published («Activa») state; loading skeleton.
3. Short notes explaining the navigation model and why it improves on the current wizard.
