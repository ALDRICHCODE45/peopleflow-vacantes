# QA details reported by the user (collection, implemented later in one batch)

Branch `feat/qa-details` from `main` @ 7b3372e5. The user is collecting details while using the product («por ahora
solamente detalles que encuentro»); each one is recorded here with its investigation, and implemented later in a batch.

## Specs

- **S1. Dial select.** «en el formulario para ingresar un candidato manualmente dentro de una vacante, en los datos de
  contacto, "Lada de pais" es un texto libre, considero que debe ser un select grande de muchas ladas disponibles..
  porque actualmente hay mas probabilidad de error» — agreed approach: searchable combobox like País/Estado, options
  «México +52», searchable by name or number, default +52, static ITU calling-code catalog in the frontend (backend
  keeps receiving `+52XXXXXXXXXX`), shared codes (+1 US/CA…) as separate country options. Same free-text field exists
  in `features/manual-intake/fields.tsx:50`, `features/candidate/profile-form-fields.tsx:162` and
  `features/org-candidates/edit/candidate-edit-form.tsx:164` → change all three. Also fixes the backlog item
  `lib/phone.ts` `phoneToDraft` (only +52/+1 known; other dials split at a blind 3 digits).
- **S2. Publish does nothing.** «estaba llenando una vacante, y le di a "revisar y publicar vacante" y no hacia nada,
  literalmente nada, y yo recargue la pagina, y se borro todo lo que tenia, y ahi cai en cuenta que no hacia nada
  porque tenia que 1. guardar los cambios y 2. configurar/llenar mas cosas . pero el problema fue ese, que no hacia
  nada, ni el boton de "publicar vacante" no me aparecia ningun mensaje de advertencia, nada de nada. eso hay que
  revisarlo tambien, muy importante.»
- **S3. Talent table cut.** «mira como se ve la tabla de "Base de talento" […] esta cortada, no ocupa toda la pantalla
  como deberia.» (screenshot `Screenshot_2026-10-23-03-43-21`: at a wide viewport the table ends ~190 px before the
  card edge).
- **S4. More primary color.** «falta el color principal, falta, lo veo muy poco, no digo que lo llenes ahora del color
  principal purpura de pf, pero si lo veria por ejemplo en el estado "active" […] de las tabs de "todos los candidatos"
  y "agregados por mi equipo" y tambien en algunos detalles de la tabla en si, me gustaria verlo mas, tambien en
  detallitos del sheet del candidato de aqui mismo.. incluso en detalles de los datos que aparecen hasta arriba,
  (total de candidatos, etc.. )»
- **S5. Skewed popovers.** «el "pop over" del select, no sale exactamente deabjo del input […] sale como "sezgado" […]
  eso pasa en esta pantalla en todos los inputs asi, en todos excepto en los que son solo de pocas opciones y no hay
  buscador, es decir, nivel de estudios y origen» (screenshot `Screenshot_2026-10-23-03-47-12`).

## Findings

- **S2 (reproduced 2026-10-23, `.playwright-mcp/qa/publish-unsaved.png`).** New unsaved draft, last step, click
  «Revisar y publicar» (`jobs/drafts/ui/local-draft-form.tsx:944`) or «Publicar vacante» (`:965`): without a saved
  draft id the button only sets `publishNotice`, which renders one muted line «Guarda los cambios antes de publicar»
  in the sticky save bar status column (`:956`) — same gray style as «Cambios sin guardar», far from the button, no
  `role=status`/alert, no toast, no focus move; both buttons look enabled and primary. Clicking again changes nothing.
  Proposal: make the blocked action explicit (dialog or prominent inline alert next to the button with «Guardar
  borrador» as the action, then open the publish review that lists what is missing). Reload loss: the leave guard
  (`draft-leave-guard.tsx`, `beforeunload`) did intercept a reload after typing a title in this repro; open question
  for the user whether the browser showed «¿Salir del sitio?» on that reload (accepting it discards the draft; there
  is no autosave — «Sin guardado automático»).
- **S3.** `components/data-table/rich-data-table.tsx:179` sets the table `width`/`minWidth` to `getTotalSize()` (sum of
  fixed column sizes, ~1300 px for the talent table); the `grow: true` meta on «Última vacante» does not absorb extra
  width. Fix in the shared table: width 100% with the column sum as minimum and the grow column taking the rest —
  shared component, so check every RichDataTable consumer.
- **S4.** Design decision to agree on with the user before coding; candidates: active tab underline/text and counter
  in primary (v0 also uses `--primary` for `.section-tabs>button.selected`), metric icons tinted primary, sort/selected
  states and focused row accents in the table, primary accents in the sheet (tab underline, section icons, links).
- **S5.** Root cause: the multi-select combobox with chips is anchored to the inner `ComboboxChipsInput` instead of the
  chips box; Base UI needs `useComboboxAnchor()` passed as `ref` to `ComboboxChips` and `anchor` to
  `ComboboxContent` (done right in `jobs/drafts/ui/draft-geography-field.tsx:32,59`). Missing in
  `org-candidates/list/candidate-filters.tsx:28` (every MultiFilter: País, Estado, Municipio, Años, Seniority, Idiomas,
  Vacante); same pattern without anchor in `employer-vacancies/pipeline-filters.tsx:109` and
  `employer-talent/talent-filters.tsx:109` → fix all three.

## Tasks

- T1 S1 dial combobox in the three forms + `phoneToDraft` with the catalog — pending
- T2 S2 explicit blocked-publish feedback (+ answer on the reload prompt) — pending
- T3 S3 shared table fills the container — pending
- T4 S4 primary color accents (after agreeing the list with the user) — pending
- T5 S5 combobox anchors in the three filter bars — pending

## Log

- **L1.** User (2026-10-23): «Creo que ahora te voy a pasar detalles que he encontrado hermano, por ahora solamente
  detalles que encuentro […] "Lada de pais" es un texto libre […]». Then: «si hermano, estoy de acuerdo, ve anotando si,
  por favor.» plus S2–S5 and «pero bueno, eso es todo por ahora.. pero seguire buscando mas detalles. revisalo por
  favor.»
