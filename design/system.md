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
| In a card | A card, tab or sheet section is empty while the rest of the page has content | `Empty` inside the card body (py-8), same anatomy, smaller title (16/600); never a bare paragraph |
| No results | Filter or search returns nothing | `Empty` with `SearchX`/`FilterX` icon, title «Sin resultados», description quotes the non-empty query or names the filters, action «Limpiar filtros» |
| Nothing selected | Master-detail with no selection | `Empty` in the detail panel: icon of the list subject, instruction «Selecciona … para verlo aquí», no button |
| Compact (exception) | Board columns (dashed 96px placeholder, §13.12/14), field-level «Sin dato», combobox «Sin coincidencias.», form notices | Text allowed; these are the only plain-text empties |

A section never disappears silently when its emptiness is meaningful to the person (a tab, a panel, a list the
person manages); optional public content (job detail sections, careers-site blocks) may be omitted.
