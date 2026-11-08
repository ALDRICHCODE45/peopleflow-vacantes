# PeopleFlow design system (synced)

Synced read-only from the project sources on 2026-10-28. Values are copied as authored; nothing here is invented.
Product rules (composition, density, states) live in `docs/frontend-ui-design-rules.md`; this file only records tokens
and the component recipes the canvas needs.

## Colors — light (`frontend/src/app/globals.css` `:root`)

| Token | Value | Usage |
|---|---|---|
| `--background` | `#F7F5FB` | page foundation |
| `--foreground` | `#1A1626` | body text, `*-foreground` roles |
| `--card` / `--popover` | `#FFFFFF` | cards, popovers |
| `--primary` | `oklch(0.491 0.27 292.581)` | violet accent, primary buttons |
| `--primary-foreground` | `oklch(0.969 0.016 293.756)` | text on primary |
| `--secondary` / `--muted` / `--accent` | `#F1EEF7` | quiet surfaces, avatar fill |
| `--muted-foreground` | `#6B6480` | metadata text |
| `--border` / `--input` | `#E4DFF0` | borders, separators |
| `--destructive` | `oklch(0.577 0.245 27.325)` | destructive actions |
| `--ring` | `oklch(0.708 0 0)` | focus ring |
| `--brand-decorative-strong` | `oklch(0.54 0.15 292.581)` | accent text |
| `--status-info` | `oklch(0.45 0.16 250)` | info tone (badge text/border) |
| `--status-review` | `oklch(0.47 0.12 70)` | review/warning tone |
| `--status-success` | `oklch(0.46 0.13 152)` | success tone |
| `--status-danger` | `oklch(0.45 0.2 25)` | danger tone |

## Colors — dark (`frontend/src/app/globals.css` `.dark`)

| Token | Value |
|---|---|
| `--background` | `#0C0912` |
| `--foreground` | `#F6F2FF` |
| `--card` | `#15121F` |
| `--popover` | `#1A1626` |
| `--primary` | `oklch(0.432 0.232 292.759)` |
| `--secondary` / `--muted` / `--accent` | `#171226` |
| `--muted-foreground` | `#A79FBF` |
| `--border` / `--input` | `#262233` |
| `--destructive` | `oklch(0.704 0.191 22.216)` |
| `--brand-decorative-strong` | `oklch(0.70 0.14 292.759)` |
| `--status-info` | `oklch(0.78 0.12 245)` |
| `--status-review` | `oklch(0.82 0.12 78)` |
| `--status-success` | `oklch(0.78 0.14 155)` |
| `--status-danger` | `oklch(0.75 0.15 22)` |

## Typography (`frontend/src/app/globals.css` `@theme inline`, `app/layout.tsx`)

- Family: Inter through `--font-sans` (headings share it). Canvas fallback: system UI stack.
- Pipeline scale (`docs/frontend-ui-design-rules.md` §14.3): page title 20/600, card name 14/500 (2 lines),
  card metadata 12/400 muted, column counters 11.

## Radius (`frontend/src/app/globals.css`)

`--radius: 0.625rem`; sm ×0.6, md ×0.8, lg ×1, xl ×1.4, 2xl ×1.8, 3xl ×2.2, 4xl ×2.6.

## Shadows (`frontend/src/app/globals.css` `.pf-candidate-card`)

- Candidate card: `0 2px 3px color-mix(in srgb, var(--foreground) 4%, transparent), 0 0 0 1px color-mix(in srgb, var(--border) 50%, transparent)`;
  hover `0 4px 8px … 8%`, ring `… 70%`.

## Component rules

- **Badge** (`frontend/src/components/ui/badge.tsx`): h-5, radius-md, 12/500, px-2. Semantic variants paint text and
  border with the token over a 10–12% fill of the same token: `accent` (primary/12, text foreground), `info`, `review`,
  `success`, `danger`, `neutral` (muted fill, muted-foreground text, border).
- **Stage tints** (`globals.css` «Pipeline presentation»): `--stage` per kind (neutral = muted-foreground, info,
  review, process = primary, success, danger); column `color-mix(--stage 4%, --background)`, heading/badge
  `color-mix(--stage 10%, --card)` with `--stage` text, dot `--stage`.
- **Candidate card** (§14.3): `Card size="sm"`, radius-xl, p-3, gap-3, avatar 32 (secondary fill, 12/500 initials),
  name 14/500 with tooltip, metadata lines with 14px icons, `Separator`, file row (icon + truncated name), drag handle
  40px revealed on hover/focus. Menu: allowed stages → «Ver ficha» → «Descartar».
- **Targets** ≥ 40px for independent controls; semantic tokens only, no raw colors in product code (§3).

## Empty states (`frontend/src/components/feedback/state-card.tsx`, `components/ui/empty.tsx`, rules §22)

Reference: the draft vacancy pipeline («Esta vacante todavía no tiene pipeline»,
`features/employer-vacancies/draft-pipeline-state.tsx`). New users land on empty states first, so every screen,
section, tab and panel that can be empty designs that state explicitly; loading (skeleton), content and empty are
three separate states and none is skipped.

**Anatomy (shadcn `empty-demo`).** `EmptyHeader` → `EmptyMedia variant="icon"` (40px rounded tile, 20px icon of the
subject, never a generic one) + `EmptyTitle` + `EmptyDescription` (max-w-md, centered) → `EmptyContent` with one
primary `Button` and optionally one secondary `outline` on the same row (stacked below `sm`) → optional discreet
`variant="link"` alternative. Buttons are ≥ 40px. Icon tile tone: `muted` for empty / no results, `primary/10` for
informational «not yet» (draft, pending, not configured), `destructive/10` only for errors and permissions.

**Copy.** Title says what is (not) there in plain words, from the person's side: «Todavía no hay vacantes»,
«Aún no hay evaluación». Description says why it is empty and what happens next or what to do, in one or two
sentences; for first-time states it also says what the thing is for. Never jargon, never «0 items», never blame.

**Actions.** The primary action creates or starts the missing thing (Crear vacante, Agregar criterio, Subir CV,
Invitar a evaluación); the secondary is the next useful path (Explorar vacantes, Ver configuración). A state with
nothing the person can do says so and offers where to go. Filter recovery (Limpiar filtros) appears only when a
filter or search is actually active, never on a truly empty catalog.

**Variants.**

| Variant | When | Composition |
| --- | --- | --- |
| Page / section | A whole screen or a page section has no data yet | `StateCard` (Card + Empty, py-10), tone `empty` or `info` |
| In a card | A card, tab or sheet section is empty while the rest of the page has content | `SectionEmpty` (same file as `StateCard`): `Empty` inside the card body (py-8), same anatomy, smaller title (16/600, heading level 3); never a bare paragraph |
| No results | Filter or search returns nothing | `SectionEmpty` (or `StateCard` for a whole page) with `SearchX`/`FilterX` icon, title «Sin resultados», description quotes the non-empty query or names the filters, action «Limpiar filtros» |
| Nothing selected | Master-detail with no selection | `SectionEmpty` in the detail panel: icon of the list subject, instruction «Selecciona … para verlo aquí», no button |
| Compact (exception) | Board columns (dashed 96px placeholder, §13.12/14), field-level «Sin dato», combobox «Sin coincidencias.», form notices | Text allowed; these are the only plain-text empties |

## On-demand help (`frontend/src/features/psychometrics/help/info-popover.tsx`)

Explanations that would crowd a dense screen live behind a visible ghost ⓘ trigger (16px glyph, ≥40px target,
accessible name «¿Qué es …?» or «Ayuda: …») that opens a shadcn `Popover` with title, one or two sentences and an
optional muted footer. Never shown by default; one open at a time; Escape / outside click close it and focus returns to
the trigger. A trigger inside a selectable row is its own button and never selects the row.

## Dashboards and metrics (binding since 2026-11-08, `design/dashboard-redesign/research.md`)

Applies to overview surfaces: `/empresa/dashboard`, `/empresa/metricas` and their detail pages. Values use the tokens
above; spacing is in Tailwind steps (4 px). Status: binding; approved with artboards `07-metricas-combinada.html` and
`08-detalle-indagacion.html` (the reference implementation for these rules).

1. **Reading order.** Header → KPI strip → main analysis row → attention / rankings → detail tables. Each step answers
   one question: *how are we doing → why → who or what → the rows*. Detail is always last and opt-in. Section titles
   are short professional nouns («Cumplimiento de entregas», «Pipeline por etapa», «Desempeño por reclutador»), never
   colloquial questions, and carry no explanatory sentence under them.
2. **Header.** Page title 24/600, one sentence of context (14 muted), period selector and at most one primary action
   on the right. Freshness («Actualizado hoy 10:42») lives here, once, 12 muted.
3. **Spacing scale (three levels, never the same value twice).** Inside a card: 8–12 px between label/value/meta,
   16 px between groups. Card padding 24 px (`p-6`). Between cards 24 px (`gap-6`). Between sections 40 px (`gap-10`).
   Page inset 24 px, 32 px from `xl`.
4. **One container level.** A card holds one job. No `border-t` subdivisions, no card or tinted figure inside a card;
   lists inside a card separate rows with `divide-y` only. Two jobs → two cards.
5. **Size is importance (12-column grid).** Main chart 8 columns + side card 4; pairs 6 + 6; tables 12. At most one
   hero element per screen (a hero KPI tile or the main chart); rows keep equal card heights.
6. **KPI card.** Label 14/500 muted-foreground with at most one 16 px icon; value 32/600 `tabular-nums` (hero 44/600);
   one line below: delta pill (12/500, success/danger tint over 10% fill, arrow + sign + «vs periodo anterior») *or*
   a context fraction («de 12 posiciones»); optional sparkline. No ⓘ, no footer, no second number block.
   Strip: 4 cards, or hero + 3–4. Rule of 6 for any group.
7. **Help.** Explanations are never shown by default. One «Cómo se calcula» ghost trigger per section heading opens
   the definitions and any reading of the data (popover or sheet); never an ⓘ per card or per stat. At most one
   muted caption line per card, and only for scope («146 vacantes asignadas»), never for prose.
8. **Charts (recharts, already installed).** Line/area for time; horizontal bars sorted descending for comparison;
   stacked bar for composition of one total. Pies/donuts only with ≤ 3 parts. One accent series in `--primary`, others
   `--muted-foreground` at 30–60% or `--primary` tints; gridlines `--border` dashed, no chart border. The same data is
   never shown as chart and table at once: table behind a «Ver como tabla» toggle.
9. **Color.** Canvas `--background`, cards `--card`. `--primary` only for the primary action, the selected control and
   the one series or bar that matters. **Delivery / deadline palette** (one hue family plus one alarm, no brown, no
   green): a tiempo `--primary`; tarde `color-mix(in oklab, var(--primary) 45%, var(--card))`; pendiente
   `color-mix(in oklab, var(--muted-foreground) 35%, var(--card))`; vencida `--destructive`; sin meta
   `--border`. Every segment always carries its word and count; color never stands alone. `--status-success` and
   `--status-review` stay for badges elsewhere, not for chart segments.
10. **Typography roles.** Page 24/600 · section 18/600 · card title 15/600 · label 14/500 · body 14 · meta 12 muted.
    Numbers `tabular-nums`, right-aligned in tables.
11. **Filters.** Period as a segmented control in the header (30 días · 90 días · Año · Personalizado). Other filters
    (reclutador, cliente o área) in one «Filtros» popover; active filters show as removable chips under the header.
    Never a full form bar above the data.
12. **Tables in an overview.** ≤ 6 visible columns, one-line cells, avatar + name first, numbers right-aligned, a
    status or bar column at most once; «Ver todos» leads to the full table. No checkboxes, column menus or pagination
    for ≤ 10 rows.
13. **Attention list.** When a surface has actionable exceptions (vencidas, por vencer), a card «Necesita atención»
    with ≤ 5 rows, each naming the consequence and a link; empty state «Todo al día».
14. **Narrow screens.** Stack in reading order; KPI strip 2×2; main chart full width with fewer ticks; tables become
    list rows (name + the one number that matters + chevron).
15. **States.** Skeleton mirrors the layout card by card; each card has its own empty state (`SectionEmpty`); a real
    `0` shows as 0, missing data as «Sin dato».
16. **Every figure is drillable.** Each count, percentage, bar segment, chart point and table cell that counts records
    is a link (underline on hover/focus, accessible name «Ver las 5 entregas tarde») to the filtered detail page
    `/empresa/metricas/detalle?…` with the same period and filters plus the figure's own filter. The detail page:
    breadcrumb back to Métricas, title naming the figure («Entregas tarde · Diego Ramírez»), removable filter chips,
    one summary line (count and the figure it came from), a full sortable table of the records with a link to each
    vacancy or candidate, export, and server pagination. A `0` is not a link.
17. **Loading.** Header and filters render first; each section loads on its own (skeleton of its exact shape), sections
    below the fold load when they approach the viewport; changing the period keeps the old numbers dimmed until the new
    ones arrive (no layout jump); detail pages paginate on the server.

A section never disappears silently when its emptiness is meaningful to the person (a tab, a panel, a list the
person manages); optional public content (job detail sections, careers-site blocks) may be omitted.
