# PeopleFlow design system (synced)

Synced read-only from the project sources on 2026-10-28; re-synced on **2026-11-22** from exactly these sources:

| Source | What it gave |
|---|---|
| `frontend/src/app/globals.css` | every colour, radius, font and ambient token; the selection tokens (2026-11-23); scheme blocks `:root`, `.dark`, `@media (prefers-color-scheme: dark)`; dashboard tokens, `.pf-hero`, pipeline `--stage`, Sileo toast tokens |
| `frontend/src/features/company-site/public/theme-tokens.ts` | the public careers-site surfaces and the generated `--site-*` token roles |
| `frontend/components.json` | shadcn style `base-rhea`, base colour `neutral`, `cssVariables: true`, icon library `lucide`, aliases (`@/components/ui`); no Tailwind config file (Tailwind v4, CSS-first) |
| `frontend/src/components/ui/**` | component rules (badge, button, card, dialog, alert-dialog, sheet, drawer, popover, tooltip, dropdown-menu, select, input, textarea, input-group, field, tabs, toggle-group, table, progress, switch, checkbox, avatar, item, empty, skeleton, spinner, separator, label); primitives come from `@base-ui/react` |

Values are copied as authored; nothing here is invented. The token **values** of `globals.css` did not change since the
2026-11-18 sync; what this sync added is the public-site tokens, the careers hero and toast tokens, the `@theme`
mapping, spacing, and the full component recipes from `components/ui`. The sections «Dashboards and metrics», «Espacio
del candidato» and «Superficie oscura (hero)» record product rules from earlier reviews of the implemented screens and
the design research; they were **carried over unchanged** and not re-read against product code in this sync.
Product rules (composition, density, states) live in `docs/frontend-ui-design-rules.md`; this file only records tokens
and the component recipes the canvas needs.

## Colors — light (`frontend/src/app/globals.css` `:root`)

| Token | Value | Usage |
|---|---|---|
| `--background` | `#F7F5FB` | page foundation |
| `--foreground` | `#1A1626` | body text, `*-foreground` roles |
| `--card-foreground` / `--popover-foreground` | `#1A1626` | text on cards and popovers |
| `--card` / `--popover` | `#FFFFFF` | cards, popovers |
| `--primary` | `oklch(0.491 0.27 292.581)` | violet accent, primary buttons |
| `--primary-foreground` | `oklch(0.969 0.016 293.756)` | text on primary |
| `--secondary` / `--muted` / `--accent` | `#F1EEF7` | quiet surfaces, avatar fill |
| `--secondary-foreground` / `--accent-foreground` | `#1A1626` | text on quiet surfaces |
| `--muted-foreground` | `#6B6480` | metadata text |
| `--border` / `--input` | `#E4DFF0` | borders, separators |
| `--destructive` | `oklch(0.577 0.245 27.325)` | destructive actions |
| `--ring` | `oklch(0.708 0 0)` | focus ring |
| `--brand-decorative-strong` | `oklch(0.54 0.15 292.581)` | accent text |
| `--status-info` | `oklch(0.45 0.16 250)` | info tone (badge text/border) |
| `--status-review` | `oklch(0.47 0.12 70)` | review/warning tone |
| `--status-success` | `oklch(0.46 0.13 152)` | success tone |
| `--status-danger` | `oklch(0.45 0.2 25)` | danger tone |
| `--chart-1` | `oklch(0.87 0 0)` | neutral chart preset (unused by dashboards, rule 8) |
| `--chart-2` | `oklch(0.556 0 0)` | neutral chart preset |
| `--chart-3` | `oklch(0.439 0 0)` | neutral chart preset |
| `--chart-4` | `oklch(0.371 0 0)` | neutral chart preset |
| `--chart-5` | `oklch(0.269 0 0)` | neutral chart preset |
| `--pf-glow-alpha` | `0.12` | `/vacantes` top glow intensity (`.pf-top-glow`) |
| `--pf-grid-dot-alpha` | `0.07` | `/vacantes` dot grid intensity (`.pf-dot-grid`) |

## Colors — dashboard tokens (`frontend/src/app/globals.css`, «Dashboards» block)

Derived tokens for rules 6 and 9 and for violet text. Light values below; dark values in the dark table.

| Token | Value | Usage |
|---|---|---|
| `--primary-text` | `var(--primary)` | violet text (`text-primary-text`): links, breadcrumbs, selected tab or period |
| `--pf-tint-base` | `var(--card)` | base that light tints mix toward |
| `--pf-tone-on-time` | `var(--primary)` | «A tiempo» segment and dot (rule 9) |
| `--pf-tone-late` | `color-mix(in oklab, var(--primary) 45%, var(--pf-tint-base))` | «Tarde» segment and dot (rule 9) |
| `--pf-tone-none` | `var(--border)` | «Sin meta» / «Por cubrir» segment (rule 9) |

## Colors — selection tokens (`frontend/src/app/globals.css`, «Selection tokens» block; artboard `design/choice-and-file-controls/03-lista-con-palomita-y-tarjeta.html`)

Added 2026-11-23 for the choice and file controls («Component rules» → Choice controls). They are derived from existing
tokens, so no earlier token changed value. Tailwind utilities: `bg-selection`, `text-selection-foreground`,
`shadow-[inset_0_0_0_1.5px_var(--control-edge)]` (colours `selection`, `selection-foreground`, `control-edge` in `@theme inline`).

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--selection` | `var(--primary)` | `var(--primary-text)` | 3 px selection bar, filled trailing mark, checked table checkbox, drag-over ring; dark `--primary` is a deep fill, so dark takes the violet text tone |
| `--selection-foreground` | `var(--primary-foreground)` | `var(--card)` | check glyph on `--selection` |
| `--control-edge` | `color-mix(in oklab, var(--foreground) 50%, var(--card))` | same expression | 1.5 px outline of an empty trailing mark and of an empty table checkbox (≥ 3:1 on the card) |

`.pf-kpi-hero` (inverted hero KPI tile, `bg-foreground text-background`) swaps its tokens in dark mode:
`--foreground: color-mix(in oklab, var(--primary) 30%, var(--card))`, `--background: var(--card-foreground)`.
Where it may be used is ruled by «Superficie oscura (hero)» at the end of this file.

## Colors — sidebar (`frontend/src/app/globals.css` `:root` / `.dark`)

The candidate and employer shells use the shadcn `inset` sidebar on `--sidebar`; the inset panel is `--background`
with `rounded-3xl`, `ring-1 ring-primary/15`, `shadow-md` (`components/dashboard-frame/frame-classes.ts`).

| Token | Value | Dark value |
|---|---|---|
| `--sidebar` | `oklch(0.985 0 0)` | `oklch(0.205 0 0)` |
| `--sidebar-foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| `--sidebar-primary` | `oklch(0.541 0.281 293.009)` | `oklch(0.606 0.25 292.717)` |
| `--sidebar-primary-foreground` | `oklch(0.969 0.016 293.756)` | `oklch(0.969 0.016 293.756)` |
| `--sidebar-accent` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` |
| `--sidebar-accent-foreground` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` |
| `--sidebar-border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` |
| `--sidebar-ring` | `oklch(0.708 0 0)` | `oklch(0.556 0 0)` |

## Colors — dark (`frontend/src/app/globals.css` `.dark`)

| Token | Value |
|---|---|
| `--background` | `#0C0912` |
| `--foreground` | `#F6F2FF` |
| `--card-foreground` / `--popover-foreground` | `#F6F2FF` |
| `--card` | `#15121F` |
| `--popover` | `#1A1626` |
| `--primary` | `oklch(0.432 0.232 292.759)` |
| `--primary-foreground` | `oklch(0.969 0.016 293.756)` |
| `--secondary` / `--muted` / `--accent` | `#171226` |
| `--secondary-foreground` / `--accent-foreground` | `#F6F2FF` |
| `--muted-foreground` | `#A79FBF` |
| `--border` / `--input` | `#262233` |
| `--destructive` | `oklch(0.704 0.191 22.216)` |
| `--ring` | `oklch(0.556 0 0)` |
| `--brand-decorative-strong` | `oklch(0.70 0.14 292.759)` |
| `--status-info` | `oklch(0.78 0.12 245)` |
| `--status-review` | `oklch(0.82 0.12 78)` |
| `--status-success` | `oklch(0.78 0.14 155)` |
| `--status-danger` | `oklch(0.75 0.15 22)` |
| `--pf-glow-alpha` | `0.22` |
| `--pf-grid-dot-alpha` | `0.11` |
| `--primary-text` | `var(--brand-decorative-strong)` |
| `--pf-tint-base` | `color-mix(in oklab, var(--foreground) 40%, var(--card))` |
| `--pf-tone-on-time` | `var(--brand-decorative-strong)` (≥ 3:1 on the dark card) |
| `--pf-tone-late` | `color-mix(in oklab, var(--brand-decorative-strong) 70%, var(--card))` |
| `--pf-tone-none` | `color-mix(in oklab, var(--muted-foreground) 28%, var(--card))` |

The same dark values also apply under `@media (prefers-color-scheme: dark)` with `:root:not([data-theme])`. The
`--chart-*` tokens are identical in both themes. Pipeline `.stage-process` uses
`color-mix(in oklch, var(--primary) 60%, var(--foreground))` in dark mode.

## Tailwind theme mapping (`frontend/src/app/globals.css` `@theme inline`)

The `@theme inline` block (48 entries: 39 colours, 7 radii, 2 fonts) only aliases the semantic tokens to Tailwind
utilities: `--color-<name>: var(--<name>)` for `background`, `foreground`, `card`, `card-foreground`, `popover`,
`popover-foreground`, `primary`, `primary-foreground`, `primary-text`, `selection`, `selection-foreground`, `control-edge`, `secondary`, `secondary-foreground`, `muted`,
`muted-foreground`, `accent`, `accent-foreground`, `destructive`, `border`, `input`, `ring`, `chart-1…5`, the eight
`sidebar*` tokens and the four `status-info|review|success|danger` tones. Product code uses the utilities
(`bg-card`, `text-muted-foreground`, `border-status-info/40`), never raw colours.

## Fonts (`frontend/src/app/globals.css` `@theme inline`)

| Token | Value |
|---|---|
| `--font-sans` | `var(--font-sans)` (Inter, set by `next/font` in `app/layout.tsx`) |
| `--font-heading` | `var(--font-sans)` |

## Colors — careers hero (`frontend/src/app/globals.css` `.pf-hero`)

The company careers hero paints from hero-scoped slots. Without a cover they follow the page tokens; with a cover
(`data-pf-hero-cover="true"`) a fixed dark scrim and light copy, identical in light and dark.

| Token | Value (no cover) | Value (cover) |
|---|---|---|
| `--pf-hero-fg` | `var(--foreground)` | `oklch(0.99 0 0)` |
| `--pf-hero-muted` | `var(--muted-foreground)` | `oklch(0.99 0 0 / 0.88)` |
| `--pf-hero-scrim` | `transparent` | `oklch(0.14 0.02 292 / 0.66)` |
| `--pf-hero-cta-bg` | `var(--primary)` | `oklch(0.99 0 0)` |
| `--pf-hero-cta-fg` | `var(--primary-foreground)` | `oklch(0.2 0.03 292)` |
| `--pf-hero-cta-hover-bg` | `color-mix(in oklab, var(--primary) 85%, var(--foreground))` | `oklch(0.93 0.01 292)` |
| `--pf-hero-outline-fg` | `var(--foreground)` | `oklch(0.99 0 0)` |
| `--pf-hero-outline-border` | `var(--border)` | `oklch(0.99 0 0 / 0.75)` |
| `--pf-hero-outline-hover-bg` | `var(--muted)` | `oklch(0.99 0 0 / 0.1)` |

## Colors — public careers site (`frontend/src/features/company-site/public/theme-tokens.ts`)

`SITE_THEME_SURFACES` mirrors the app surfaces (a test pins the drift): light page `#F7F5FB`, card `#FFFFFF`; dark page
`#0C0912`, card `#15121F`. `siteBrandTokens(brand, accent, background)` generates, per theme (`light`, `dark`), the
roles below as `--site-<role>-<theme>`; brand, accent and page colours come from the company, so only the fixed
literals are values here, the rest are computed to keep AA contrast.

| Token | Value |
|---|---|
| `--site-page-light` / `--site-page-dark` | `#F7F5FB` / `#0C0912` (default; a custom page colour replaces it) |
| `--site-card-light` / `--site-card-dark` | `#FFFFFF` / `#15121F` (swaps to the opposite pole when the custom page is too dark or light for AA) |
| `--site-muted-light` / `--site-muted-dark` | `#F1EEF7` / `#171226` (equals the card when a custom page colour is set) |
| `--site-foreground-light` / `--site-foreground-dark` | `#1A1626` / `#F6F2FF`, adjusted for contrast |
| `--site-secondary-light` / `--site-secondary-dark` | `#6B6480` / `#A79FBF`, adjusted for contrast |
| `--site-brand-*`, `--site-on-brand-*`, `--site-brand-text-*` | computed from the company brand colour (fill, readable ink on it, small-text ink) |
| `--site-band-*` | the brand fill at 7 % over the page, materialised as sRGB |
| `--site-accent-*`, `--site-on-accent-*`, `--site-banner-accent-*`, `--site-on-banner-accent-*`, `--site-ring-*` | computed from the optional accent colour (default: the brand fill); only emitted once an accent or page colour is set |

14 roles × 2 themes = 28 generated tokens (the base set without accent or page is 4 roles × 2 = 8).

## Colors — toasts (`frontend/src/app/globals.css`, `[data-pf-toaster]`)

Sileo is the approved toast exception; its tokens are scoped to `[data-pf-toaster] [data-sileo-viewport]`.

| Token | Value |
|---|---|
| `--sileo-state-success` | `var(--status-success)` |
| `--sileo-state-error` | `var(--status-danger)` |
| `--sileo-state-warning` | `var(--status-review)` |
| `--sileo-state-info` | `var(--status-info)` |
| `--sileo-state-loading` | `var(--muted-foreground)` |
| `--sileo-state-action` | `var(--foreground)` |
| `--sileo-width` | `min(350px, calc(100vw - 3rem))` |

Toasts use `z-index: 100` (above modal backdrops, `z-50`), sit at the bottom right, and lift 6.5 rem above the vacancy
editor's floating save bar. Below 400 px or with reduced motion the animated canvas is hidden and the toast is a static
`--popover` surface with `--radius-xl` and `0 0 0 1px var(--border)`.

## Typography (`frontend/src/app/globals.css` `@theme inline`, `frontend/src/components/ui/**`)

- Family: Inter through `--font-sans`, loaded by `next/font` (`globals.css` header comment: «see app/layout.tsx»); it is
  the only app face and `--font-heading` resolves to it too. Canvas fallback: system UI stack.
- Roles in `components/ui` (Tailwind sizes): `Card`, `Dialog`, `Sheet`, `Popover` titles `text-base` (16) 500; `AlertDialog`
  and `Empty` titles `text-lg` (18) 500 (`Empty`: `tracking-tight`); body `text-sm` (14); `Label`, `Button`, `Tabs`
  trigger, `Progress` label `text-sm` 500; `Badge` and `Tooltip` `text-xs` (12) (badge 500); `Input` `text-base` (16) below
  `md`, `md:text-sm` (14) from `md`; `Progress` value `text-sm` muted `tabular-nums`; dropdown group labels `text-xs`
  muted; `Table` text `text-sm`, header 500.
- Pipeline scale (`docs/frontend-ui-design-rules.md` §14.3): page title 20/600, card name 14/500 (2 lines),
  card metadata 12/400 muted, column counters 11.
- Company overview scale: «Dashboards and metrics» rule 10 (page title 24/600, `text-2xl`).
- Candidate workspace scale: «Espacio del candidato» below (page title 24/32, 28/36 from `sm`).

## Spacing (`frontend/src/app/globals.css`, `frontend/src/components/ui/**`)

`globals.css` declares no spacing token: spacing is Tailwind's 4 px step (`--spacing(n)` = n × 4 px). Recipes found in
`components/ui`:

| Where | Value | Source |
|---|---|---|
| Card inner spacing (`--card-spacing`) | 20 px (`size="sm"`: 16 px); vertical padding and gap between card parts | `card.tsx` |
| Dialog / AlertDialog | `p-6` (24), `gap-6` (24); footer `gap-2`, stacked reverse below `sm` | `dialog.tsx`, `alert-dialog.tsx` |
| Sheet | header `p-6`, `gap-1.5`; footer `px-6 py-3`, `gap-2`; floating inset `--sheet-inset` 8 px (16 px from `md`) | `sheet.tsx` |
| Popover | `p-4` (16), `gap-4`, width `w-72` (288 px) | `popover.tsx` |
| Dropdown menu | content `p-1`; item `px-2 py-1.5`, `gap-2`, min height 28 px | `dropdown-menu.tsx` |
| Item | default `px-4 py-3.5` `gap-3.5`; `sm` `px-3.5 py-3`; `xs` `px-2.5 py-2` `gap-2` | `item.tsx` |
| Field | field `gap-3`, field group `gap-6` (checkbox group `gap-3`), content `gap-1` | `field.tsx` |
| Empty | `p-12`, `gap-4`; header `gap-2`, `max-w-sm` | `empty.tsx` |
| Table | header cell `h-10 px-2`; body cell `p-2` | `table.tsx` |
| Chart / dashboard rhythm | see «Dashboards and metrics» rule 3 (card 24 px, gaps 24 / 40 px) | carried over |

## Radius (`frontend/src/app/globals.css`)

`--radius: 0.625rem`; sm ×0.6, md ×0.8, lg ×1, xl ×1.4, 2xl ×1.8, 3xl ×2.2, 4xl ×2.6
(6 · 8 · 10 · 14 · 18 · 22 · 26 px).

| Element | Radius | Source |
|---|---|---|
| Card (shared, every product card, tile, section card and the dark hero) | `rounded-[min(var(--radius-4xl),24px)]` = **24 px** | `components/ui/card.tsx`, `features/company-metrics/sections/summary-strip.tsx` `CARD`, `features/candidate/saved/queue.tsx` `CARD` |
| Dashboard inset panel | `rounded-3xl` = 22 px | `components/dashboard-frame/frame-classes.ts` |
| Button, input, input group | `rounded-2xl` = 18 px | `components/ui/button.tsx`, `input.tsx`, `input-group.tsx` |
| Segmented control, list row, company logo tile 48 px, empty-state icon tile | `rounded-xl` = 14 px | `toggle-group.tsx`, `saved/queue.tsx`, `PublicCompanyAvatar.tsx`, `empty.tsx` |
| Pipeline candidate card (`.pf-candidate-card`) | `var(--radius-xl)` = 14 px | `globals.css` |
| Badge | `rounded-md` = 8 px | `components/ui/badge.tsx` |
| Chip (reason, section, salary) | `rounded-full` | `saved/queue.tsx`, `candidate-dashboard-overview.tsx` |
| Removable filter chip (may wrap over several lines) | `rounded-xl` = 14 px, 40 px high at least | `features/audit-log/audit-filters.tsx` `FilterChip` |
| Dialog, AlertDialog | `rounded-[min(var(--radius-4xl),24px)]` = 24 px | `dialog.tsx`, `alert-dialog.tsx` |
| Popover | `rounded-3xl` = 22 px | `popover.tsx` |
| Dropdown / select content, sheet (floating) | `rounded-2xl` = 18 px | `dropdown-menu.tsx`, `select.tsx`, `sheet.tsx` |
| Dropdown item, tooltip | `rounded-xl` = 14 px | `dropdown-menu.tsx`, `tooltip.tsx` |
| Select trigger, textarea, item, progress track, skeleton | `rounded-2xl` = 18 px | `select.tsx`, `textarea.tsx`, `item.tsx`, `progress.tsx`, `skeleton.tsx` |
| Tabs list | `rounded-xl` = 14 px; trigger `rounded-lg` = 10 px | `tabs.tsx` |
| Empty (dashed frame) | `rounded-3xl` = 22 px; icon tile `rounded-xl` | `empty.tsx` |
| Checkbox | 5 px; switch, avatar `rounded-full` | `checkbox.tsx`, `switch.tsx`, `avatar.tsx` |

The 14 px card corner in older artboards (`calc(var(--radius)*1.4)`) is the pipeline card, not the shared card.

## Shadows

- Shared card (`components/ui/card.tsx`): Tailwind `shadow-sm` plus `ring-1 ring-foreground/5`
  (`dark:ring-foreground/10`). Tiles, section cards and list cards use the same pair.
- Dashboard inset panel: `shadow-md` plus `ring-1 ring-primary/15`.
- Tinted cards («Siguiente paso», first-use empty state): `0 0 0 1px color-mix(in srgb, var(--primary) 14–16%,
  var(--border))` plus the glow `0 10px 24px -18px color-mix(in srgb, var(--primary) 55%, transparent)`
  (`features/candidate/dashboard/dashboard.module.css` `.next`, `features/candidate/saved/saved.module.css` `.empty`).
- Dialog / AlertDialog: `shadow-xl` plus `ring-1 ring-foreground/5` (`dark:ring-foreground/10`) on `--popover`; scrim
  `bg-black/30` with `backdrop-blur-sm` (`dialog.tsx`, `alert-dialog.tsx`).
- Popover, dropdown and select content: `shadow-lg` plus `ring-1 ring-foreground/5` on `--popover`; tooltip has none
  (`popover.tsx`, `dropdown-menu.tsx`, `select.tsx`, `tooltip.tsx`).
- Sheet: floating presentation `shadow-lg` with `border border-border/60`; edge presentation `shadow-xl`
  (`sheet.tsx`).
- Dark surface: see «Superficie oscura (hero)».
- Pipeline candidate card (`globals.css` `.pf-candidate-card`): `0 2px 3px color-mix(in srgb, var(--foreground) 4%, transparent), 0 0 0 1px color-mix(in srgb, var(--border) 50%, transparent)`;
  hover `0 4px 8px … 8%`, ring `… 70%`.

## Component rules

- **Badge** (`frontend/src/components/ui/badge.tsx`): h-5, radius-md, 12/500, px-2, 12 px icons. Variants: `default`
  (primary fill), `secondary`, `outline`, `ghost`, `link`, and the semantic ones that paint text and a 40 % border with
  the token over a 10 % fill of the same token: `info`, `review`, `success`, `danger` (`destructive` is the same
  recipe on `--status-danger`), `accent` (primary/40 border, primary/12 fill, text `--foreground`) and `neutral` (muted
  fill, muted-foreground text, border). `dot` adds a 6 px leading dot in `currentColor`. Never status by colour alone:
  the label always says the state.
- **Stage tints** (`globals.css` «Pipeline presentation»): `--stage` per kind (neutral = muted-foreground, info,
  review, process = primary, success, danger); column `color-mix(--stage 4%, --background)`, heading/badge
  `color-mix(--stage 10%, --card)` with `--stage` text, dot `--stage`.
- **Candidate card** (§14.3): `Card size="sm"`, radius-xl, p-3, gap-3, avatar 32 (secondary fill, 12/500 initials),
  name 14/500 with tooltip, metadata lines with 14px icons, `Separator`, file row (icon + truncated name), drag handle
  40px revealed on hover/focus. Menu: allowed stages → «Ver ficha» → «Descartar».
- **Button** (`components/ui/button.tsx`): `rounded-2xl` (18 px, not a full pill), 14/500, 16 px icons, disabled
  `opacity-50`, `active` nudges 1 px down, focus `ring-3 ring-ring/30`. Sizes `default` `h-8 px-3`, `xs` h-6, `sm` h-7,
  `lg` h-9 px-4, icons `icon` size-8, `icon-xs` 6, `icon-sm` 7, `icon-lg` 9; product call sites set `min-h-10` (40 px)
  and `min-h-11` (44 px) for the main action of a card or any button below `sm`. Variants `default` (primary,
  hover `primary/80`), `outline` (border, `--background` fill), `secondary`, `ghost` (muted-foreground text for header
  and card-head links), `destructive` (`destructive/10` fill, destructive text), `link` (text `--primary-text`, never `--primary`: dark
  `--primary` is a ~2:1 fill; underline on hover, and a link inside running text is underlined at rest).
- **Input / textarea / select / input group** (`input.tsx`, `textarea.tsx`, `select.tsx`, `input-group.tsx`):
  `rounded-2xl`, fill `bg-input/50`, no border at rest, `ring-3 ring-ring/30` on focus, `aria-invalid` paints
  `border-destructive` + `ring-destructive/20`; default `h-8`, text 16 below `md` and 14 from `md`; textarea `min-h-16`;
  forms use `min-h-10`; search fields `h-11`.
- **Field** (`field.tsx`): vertical field `gap-3`; group `gap-6`; label 14/500; an invalid field turns its text
  `--destructive`; legend 16/500 (`label` variant 14).
- **Dialog** (`dialog.tsx`): centred, `max-w-[calc(100%-2rem)]`, `sm:max-w-md` (448 px), `--popover`, 24 px radius, `p-6
  gap-6`; close button 40 px `bg-secondary` top right with `sr-only` «Cerrar»; footer reversed column below `sm`, row
  right-aligned from `sm`. Title 16/500.
- **AlertDialog** (`alert-dialog.tsx`): same surface, `max-w-xs`, `sm:max-w-md`; title 18/500; optional 64 px round
  media; the `sm` size makes the footer a two-column grid. Use for destructive confirmations.
- **Sheet** (`sheet.tsx`): right/left/top/bottom, default floating presentation (`rounded-2xl`, 8 px inset, 16 px from
  `md`, width 3/4, `sm:max-w-sm` = 384 px, max height the dynamic viewport minus the insets); `bg-popover`; header
  `p-6`, footer `px-6 py-3`; title 16/500; description 14 muted; 40 px close button; slides 2.5 rem and fades in
  200 ms. `edge` presentation is full-bleed (mobile navigation). **Drawer** (`drawer.tsx`) is the swipe-to-dismiss bottom
  sheet (scrim `bg-black/30`, header `p-4`, footer `p-4 pt-0`).
- **Popover** (`popover.tsx`): 288 px, `p-4 gap-4`, 22 px radius, title 16/500, description muted. **Tooltip**: `bg-foreground
  text-background`, 12 px, `rounded-xl`, `px-3 py-1.5`, max 320 px. **Exception:** the audit log's filter panels are 360–460 px wide
  (see «Audit log: documented exceptions»).
- **Dropdown menu** (`dropdown-menu.tsx`): `rounded-2xl p-1`, items `rounded-xl`, 14 px, focus `bg-accent`, destructive
  items in `--destructive`, separators `bg-border/50`, labels 12 muted. A ⋯ menu behind a 40 px icon-only trigger holds
  actions only (no explanatory text); its content is `w-auto` (not the trigger's width) and items `whitespace-nowrap`, so
  every item (icon + label) stays on one line. The vacancy header's actions (editar, página pública, compartir) live in one
  such ⋯ menu («Acciones de la publicación») at the identity row's right end, never as a row of buttons.
- **Share menu** (`frontend/src/features/jobs/components/share-menu.tsx`, `share-links.ts`): one `DropdownMenu` behind a «Compartir …» button (detail card: ghost, `min-h-11`, full width, copy outcome in a visible `role="status"` line below; headers: icon-only 40 px with the label as its accessible name, outcome as toast + `sr-only` status; inside another menu — the vacancy list row, the vacancy header's ⋯ — it is the «Compartir» submenu (`ShareSubmenu`), outcome as toast, plus the host's `sr-only` status in the header). Items `min-h-10`: **Copiar enlace**, **WhatsApp** (`https://wa.me/?text=<título — empresa — url>`), **Correo** (`mailto:?subject=&body=`), **LinkedIn** (`/sharing/share-offsite/?url=`), and **Más opciones…** only where `navigator.share` exists. External links open in a new tab with `rel="noopener noreferrer"`. The shared URL is absolute, hash-free and ends in `origen=compartido`. Use the same menu on the public vacancy detail, the careers-site header (live page only, never the editor preview) and the employer's published public vacancy; never for a private or unpublished one.
- **Tabs** (`tabs.tsx`): default list `h-9 rounded-xl bg-muted p-1`, trigger `rounded-lg px-3` 14/500 in `foreground/70`, the
  active one on `--background` with `shadow-sm` (dark `foreground/10`); counts in a trigger are `rounded-full` badges that
  turn `primary/10` when active; `line` variant: transparent list, 2 px `--foreground` underline.
- **Table** (`table.tsx`): `text-sm`; header cells `h-10 px-2` 500, rows `border-b` with `hover:bg-muted/50`, selected
  `bg-muted`, cells `p-2`, no wrapping; wrapper scrolls horizontally. **Exception:** the audit table's cells wrap up to 3 lines
  (see «Audit log: documented exceptions»).
- **Progress** (`progress.tsx`): track `h-2 rounded-2xl bg-muted`, indicator `bg-primary` with `transition-all`;
  label 14/500, value 14 muted `tabular-nums` right-aligned.
- **Switch** (`switch.tsx`): `h-10 w-14 rounded-full p-1`, `bg-primary` on, `bg-input` off. **Checkbox**: 16 px, 5 px
  radius, `bg-input/90`, hit area extended 12 × 8 px. **Avatar**: 32 px (`sm` 24, `lg` 40), `rounded-full`, fallback
  `bg-muted` 14 muted.
- **Item** (`item.tsx`): list item `rounded-2xl`, variants `default` (transparent border), `outline` (`--border`),
  `muted` (`bg-muted/50`); sizes `default`, `sm`, `xs`; media `icon` (16 px) or `image` (40 px `rounded-xl`).
- **Spinner** (`spinner.tsx`): lucide `Loader2` 16 px, `animate-spin`, `role="status"`. **Separator**: 1 px `--border`.
  **Label**: 14/500.
- **Segmented control** (`toggle-group.tsx` `variant="segmented"`): `h-9 rounded-xl bg-muted p-1`, items `rounded-lg px-3`
  14/500 in `foreground/70`, the pressed item on `--background` with `shadow-sm` (dark: `foreground/10`, no shadow). Candidate page headers use it at `h-11` (44 px). Use it for one choice among 2–4
  views or sorts; a count sits after the label in a quiet badge.
- **Skeleton** (`components/ui/skeleton.tsx`): `rounded-2xl bg-muted animate-pulse`.
- **Choice and file controls** (binding since 2026-11-23, S1–S3; artboard `design/choice-and-file-controls/03-lista-con-palomita-y-tarjeta.html`;
  `frontend/src/components/ui/choice-list.tsx`, `frontend/src/components/ui/file-field.tsx`; tokens in «Colors — selection tokens»).
  Never show a bare radio, an option checkbox or a native `<input type="file">` («Browse… No file selected.») to choose something.
  - **Choose one or several options → `ChoiceList`.** Rows of a `divide-y` list in a 18 px frame (`bg-card`, 1 px `--border`), min 56 px
    tall, **the whole row is the target**; title 14/500, optional description / meta 12 muted, optional icon or avatar before the text,
    a 3 px `--selection` bar on the left edge (inset 14 px, `rounded-full`) and `bg-primary/7` when chosen, and a trailing 24 px check
    (circle = single, square 7 px = multiple) that fills with `--selection`. Single = `role="radiogroup"`, arrow keys move and select;
    multiple = checkboxes in a labelled group (Tab and Space). Lists of **3 or more selectable options** in multiple mode start with a
    **«Seleccionar todo»** row (muted fill): indeterminate when some are chosen, with a count («2 de 3 elegidas», announced politely).
    A disabled option stays visible, muted, with its **reason shown in the row** and linked with `aria-describedby`; an error is a
    destructive frame plus a `role="alert"` line (per option or for the group). Keyboard focus is a 2 px `--primary-text` outline
    inside the row, never the bar or the tint, so focus and selection never look alike.
  - **A single on/off setting → `Switch`** (never a lone checkbox).
  - **A styled `Checkbox`** only for **data-table row selection** (16 px, 5 px radius, `bg-input/90` with a `--control-edge` edge,
    40 px hit area, header checkbox indeterminate, chosen row `bg-muted`) and for **consent** («Acepto…»).
  - **Choose a file → `FileField`.** An input-group field (`bg-input/50`, `rounded-2xl`, 56 px) with a file glyph, the prompt («Arrastra un
    archivo o elígelo»; phones «Elige un archivo»), the formats and maximum size as a visible hint, and an outline **«Elegir archivo»**
    button (full width, 44 px on phones). Chosen, it becomes a **document card**: a format-coloured badge, the name (wraps), «PDF · 179 KB»
    and the ghost buttons **«Cambiar»** and **«Quitar»**. The native input stays in the DOM, labelled and described, only visually
    hidden. Dropping a file on the field chooses it (drag-over tints the field and ring in `--selection`). Disabled dims it; an error
    paints the destructive frame and a `role="alert"` message that says what failed and what is allowed. The field never validates:
    the caller checks format and size and passes `error`.
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
| First use (candidate page) | A candidate page whose whole list is empty (no saved vacancies, no applications) | Tinted card (`saved/queue.tsx` `EmptySaved`): eyebrow, title, description, primary + outline actions and a fan of three mini cards; see «Espacio del candidato» → Empty states |
| Compact (exception) | Board columns (dashed 96px placeholder, §13.12/14), field-level «Sin dato», combobox «Sin coincidencias.», form notices | Text allowed; these are the only plain-text empties |

## Audit log: documented exceptions and «Filter bar with chips» (binding since 2026-11-24, S4)

Chosen artboard: `design/audit-log-redesign/01-barra-de-filtros-en-linea-con-chips.html` (`odd/tasks/settings-and-audit-redesign.md` S2, S4;
self-check `design/audit-log-redesign/self-check.md`). Implementation: `frontend/src/features/audit-log/**`.

**Exceptions accepted for the owner's audit log (and nowhere else without a new review).**

1. **Multi-line cells in the audit table.** The «Table» rule says no wrapping; here every text cell (`Quién`, `Acción`, `Sobre`,
   `Vacante`, `IP y navegador`) wraps up to 3 lines (`line-clamp-3 whitespace-normal [overflow-wrap:anywhere]`) and carries the full text in `title`; the
   complete text, with all metadata, is always in the event detail sheet. Rows grow with their content (the table's `h-[100px]` is a minimum).
   `Cuándo` stays on two non-wrapping lines. The reason: a person's full name, a vacancy title or an action label must never be cut (S2).
2. **Filter popovers 360–460 px wide** (the system's `Popover` is 288 px): Persona 420, Acción 460, Vacante 460, Rango personalizado 360, Exportar 420;
   always `min(<width>, 100vw − 2rem)`. Their lists show full values that wrap; they scroll inside the popover (`max-h min(24rem, 50dvh)`).
3. **Removable chips with several lines** (`rounded-xl` 14 px, not `rounded-full`): a chip holds the whole value, so it wraps; its «Quitar» button stays 40 × 40 px.
4. **«Exportar CSV» is always enabled** and opens a panel that requires the range (previously: a disabled button plus a notice). Mono (`font-mono`) is used
   for IPs, event codes, ids and metadata keys only.
5. **The recruiter table (`/empresa/metricas/reclutadores`) extends exceptions 1 and 3 to itself and nowhere else** (`odd/tasks/recruiter-table-redesign.md`
   S1–S2; artboard `design/recruiter-table-redesign/01-pagina-propia-de-tabla.html`; implementation `frontend/src/features/company-metrics/recruiter-table.tsx`).
   Its cells wrap (`whitespace-normal [overflow-wrap:anywhere]`, up to 3–4 lines in «Placements»); nothing is cut with an ellipsis or `title`, so the eight columns
   fit at 1440 without a horizontal scroll (the region still scrolls and is focusable below that). Headers are grouped (Carga de trabajo · Entrega de candidatos ·
   Contratación), the person column and both header rows are `sticky`, and the inherited board filters (Reclutador, Cliente o área) show as the same multi-line
   chips as the audit log. Below `md` each person is one card with the same three groups (rule 14: no sideways scroll); sorting there is a labelled «Orden» selector.
   Its column headers are `text-xs font-medium` (not the table rule's `text-sm`) so every header word fits its column in ≤ 2 lines; the table's
   min-width budget is ≤ 1050 px (1440 − 288 sidebar − page padding − a 15 px classic scrollbar), and from that width up the region does not scroll
   vertically: the page scrolls and the header sticks to the viewport, so a classic-scrollbar browser never shows two scrollbars.
   «Entregas a tiempo» always shows the percentage and «N de M»; the order uses the percentage, then the count. This is the one recruiter table: the board's
   «Ver tabla completa» is a link to it (no narrow sheet).

**Recipe: Filter bar with chips** (a table or list filtered by several, sometimes long, values).

- **Toolbar** (one row, wraps below `sm`, `gap-2.5`): one outline button per multi-value filter (`min-h-10`: icon, name, a primary count pill when it holds values, a chevron;
  `aria-haspopup="dialog"`), a 1 px vertical separator, the date range as a **segmented control** (`Hoy · 7 días · 30 días · Personalizado`, `h-11`;
  «Personalizado» opens a 360 px popover with two date pickers, validated), and the table view controls at the end (`ml-auto`). No «Filtros» toggle, no form bar.
- **Selectors show the name and a count, never the value.** The value lives in the panel and in its chip, so nothing is truncated.
- **Panel** (`Popover`, `p-3 gap-3`): a search field first (`type="search"`, accent- and case-insensitive, «Sin coincidencias para «…»»), then the options as a `ChoiceList`.
  Single choice (person, vacancy): the row commits and closes the panel; the first row is «Todas …». Many choices (actions): one `ChoiceList` per category, its legend
  `Category n de m`, the «Seleccionar todo» row choosing the category, the panel stays open and a footer says «N acciones elegidas» with «Limpiar».
  Quiet secondary text for what only qualifies the value: email as description, **«Ex miembro» as a neutral `Badge`** (inside a chip it is written «(ex miembro)»),
  an identifier for an untitled or deleted vacancy («Identificador #xxxxxxxx»).
- **Chips** under the toolbar (`role="group"` «Filtros activos», `gap-2`): `Name: value` (name muted, value 500, full text, wraps), a 40 px «Quitar» icon button
  (`aria-label` «Quitar filtro Name: value», `title` «Quitar») and a ghost **«Limpiar filtros»** at the end, shown only while something is active.
  A whole category chosen collapses into one chip («Sesiones (2 acciones)»); the range is one chip («Fecha: Últimos 7 días (…)»).
- **Result line** under the chips: «**N** eventos registrados en tu empresa» (or «con estos filtros») · «Más recientes primero», `role="status"`, and a ghost ⓘ for what is and is not recorded.
- **States:** loading = the real headers over skeleton rows and a skeleton count (the bar is already there); no results = `SectionEmpty` with the chips kept and «Limpiar filtros»;
  first use = `SectionEmpty` without a button; error = `StateCard` with «Reintentar»; a failed catalog = one muted line with «Reintentar opciones» while the known actions still filter.
- **Row detail:** clicking a row, or Enter on it, opens a right `Sheet` with the full action, the Mexico City date and time, who, about what, the whole vacancy title, IP and
  browser, metadata and id, with «Copiar ID» and «Cerrar».
- **Export panel** (`Popover`, `align="end"`): the same four range choices, two date pickers for «Personalizado», the validation message and the filters that apply, then
  «Cancelar» / «Descargar CSV» (disabled while the range is invalid or the request runs). The button keeps a one-line hint under it («Requiere un rango de fechas · máx. 366 días»)
  so the toolbar never shifts. The range is required, both days, at most 366 days inclusive (what `exportRangeError` and the export route enforce).

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
    status or bar column at most once; «Ver todos» leads to the full table (for recruiters, its own page: audit exception 5). No checkboxes, column menus or pagination
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

## Espacio del candidato (binding since 2026-11-18)

Applies to `/candidato/*`. Reference implementations: `/candidato/dashboard`
(`design/candidate-dashboard-modern/04-bento-con-siguiente-paso.html` →
`components/candidate-dashboard/candidate-dashboard-overview.tsx`, `features/candidate/dashboard/`) and
`/candidato/guardadas` (`design/candidate-saved-modern/02-postulate-primero.html` →
`features/candidate/saved-vacancies-workspace.tsx`, `features/candidate/saved/`). Values come from that code; where the
artboards differ (card radius 14 px, logo tile 36–44 px, dividers between queue rows), the code wins. The goal is one
recognisable language across the candidate screens: other candidate pages *align* to these patterns and keep their own
structure, content and flows.

**Page frame.** `DashboardPageContent width="screen-2xl"` (max 1536 px): inset 16 px, 24 px from `md` vertically and
from `lg` horizontally. Header → content 24 px (`gap-6`); between page sections 24 px. The dashboard uses 32/40 px
under its greeting because its header carries no controls.

**1. Page header.** `header.flex.flex-wrap.items-end.justify-between.gap-x-6.gap-y-4`.
- Title `h2` 24/32 600 `tracking-tight`, 28/36 from `sm` (`text-2xl sm:text-[28px] sm:leading-9`); focusable
  (`tabIndex=-1`) when actions move focus back to it.
- Summary line under it (gap 4 px): 14/20 muted, `tabular-nums`, counts joined by « · », the key counts in
  `--foreground` 600 («**3** guardadas · **2** por postularte · todas siguen abiertas»). It states facts, never a
  slogan; the dashboard uses the long date instead.
- Controls on the right, bottom-aligned with the summary, in one row: the page's view or sort segmented control
  (h-11) with its ⓘ help trigger, a search field (h-11, 240 px) and/or the page's primary actions (a form's
  «Guardar» last, on the far right). Nothing else lives there; filters beyond one segmented control go in a
  «Filtros» popover (rule 11). Below `sm` the controls take the full width
  (segmented items share it equally: `grid grid-cols-3`, four items as a 2×2 grid).

**2. Section card.** The shared card (24 px, `bg-card`, `shadow-sm ring-1 ring-foreground/5`) holding one group.
- List section: padding `px-1.5 pt-4 pb-1.5`, `sm:px-3 sm:pt-5 sm:pb-2`, so rows run almost edge to edge while the
  head text sits 24 px in (head `px-2.5 pb-2 sm:px-3`).
- Head: title 18/28 600 + count `Badge variant="neutral"` (no dot) after it; optional caption 12/16 muted under it
  (gap 2 px) saying how the list is ordered or scoped; optional action on the right as a ghost button `min-h-10`
  in muted-foreground («Ver postulaciones», «Ver todas →»), pulled up by `-mt-1.5` so it aligns with the title.
- Content sections (forms, side panels): padding 16 px, 24 px from `sm`; head then content 16 px apart; no
  `border-b` under the head and no card inside a card.
- Bento cards on the dashboard use the card title 15/22 600 (rule 10); page sections use 18/28.

**3. Tile** (`features/candidate/dashboard/charts.tsx` `Tile`): shared card, `gap-3 p-4 sm:p-6`.
- Label: 14/500 muted with one 16 px icon in `--primary-text` (`flex items-center gap-2`).
- Figure: 26/32 600 `tracking-tight tabular-nums`, 32/40 from `sm`; unit after it 14/500 muted (`de 10`, `semanas`).
  Worded figure («El mismo día») 28/34 → 32/40; a figure that is a sentence («Sin respuestas aún») 20/28.
- Context line: 12/16 muted, one line; may end in an inline link («1 en uso · Subir otro»).
- Foot link: 12/500 `--primary-text`, `mt-auto min-h-10`, underline on hover; one per tile.
- Bento grid: 2 columns, 12 from `xl`, gap 12 → 24 px from `sm`, rows `minmax(176px, auto)`. A summary that already
  exists on a screen (capacity, completeness, counts) may become a tile; never invent figures to fill one.

**4. List row** (`features/candidate/saved/queue.tsx` `QueueRow`). The whole row is one button (selection) or one
link; secondary actions live in the detail.
- Grid: `[rank 28] [logo 48] [text 1fr] [value auto] [chevron 16]`, gap 10 → 14 px from `sm`, padding `py-3 px-2.5`
  (`sm:px-3`), `rounded-xl`, min height 76 px (64 px without chips). Rows are 4 px apart (`gap-1`), no dividers.
- Logo tile: `PublicCompanyAvatar` 48 px `rounded-xl` (64 px `rounded-2xl` in a detail), the company logo or its
  initials on `--background` with a 1 px `--border`; a file uses the same tile tinted by type (PDF danger, Word info).
- Title: 15/22 600, up to 2 lines (`line-clamp-2 break-words`). Meta: 12/16 muted, facts joined by « · ».
- Chips under the meta (6 px gap, `mt-1.5`): reasons or status, see 6.
- Value: right-aligned 15/22 600 `tabular-nums` with a 12/16 muted note under it (salary «$22k–26k / bruto»), or the
  status badge for a record whose state is the point. Then a 16 px chevron, muted (`--primary-text` when selected).
- Hover `bg-muted/70`; focus `ring-3 ring-ring/40`; colour transitions 150 ms. Arrow keys move between rows.
- Rows that are not selectable (a file in a library) end in their own actions (ghost button + ⋯ menu) instead of a
  value and a chevron.
- A compact list inside a bento card (dashboard «Postulaciones recientes») uses `divide-y` rows of 60 px with the
  title 14/500 and no logo.

**5. Selected row.** `bg-primary/7` plus a 3 px bar `bg-primary` on the left edge, inset 14 px top and bottom,
`rounded-full`; `aria-current="true"` (wide) and the chevron in `--primary-text`. Narrow: the whole `li` gets
`bg-primary/6`, the row expands in place (`aria-expanded`) and the chevron turns 90°. Never an outline ring as the
selection cue: the ring is the focus cue.

**6. Status and reason chips.**
- Application status = `Badge` with `dot`, one mapping everywhere (`features/candidate/saved/application-status.ts`,
  same as the inbox): Enviada `info` · En proceso `review` · Cerrada / Vacante cerrada `neutral`. On the dark surface
  the same words re-tint: info `oklch(0.78 0.12 245)`, review `--hero-accent` at 22%, neutral `background/10`.
  Known drift: the dashboard «Postulaciones recientes» paints En proceso with `accent`; align it to `review`.
- Reason chip (why a row is where it is, or what is pending on it): `rounded-full px-2 py-[3px]` 12/16 500; the lead
  reason `bg-primary/9 text-primary-text`, the others `bg-muted text-muted-foreground`, at most 2 per row; a value
  folded in on narrow screens `ring-1 ring-border ring-inset tabular-nums`.
- Section chip (what companies see, what is missing): `h-5 rounded-full px-2` 11/16 500; complete
  `color-mix(in oklab, var(--primary) 8%, var(--card))` + `ring-1 ring-primary/15` + 12 px check; missing
  `border border-dashed border-border text-muted-foreground`; at most 3 plus «+N más».
- Chips state facts from the data; never a judgement the data cannot support.

**7. Thin brand ring** (`charts.tsx` `Ring`): one SVG, 56 px with a 5 px stroke (48/5 in «Siguiente paso»), track
`--muted` (`--border` in dark), arc `--primary-text` with round caps; with `brand` it stays violet at 100 % and shows a
20 px check (stroke 2.5) instead of «100%»; below 100 % the centre shows the percentage 13/600 `tabular-nums`. Only for a
part of a whole with a goal (profile completeness, assessment n/63). Accessible name «Perfil completo al 100 %».

**8. Empty states.** Three levels, all with the anatomy in «Empty states» above:
- First use of a whole candidate page: the tinted card (`EmptySaved`): `color-mix(in oklab, var(--primary) 5%,
  var(--card))` (11 % dark), tinted ring + glow, two radial washes; eyebrow 12/16 600 uppercase `tracking-wider`
  `--primary-text` with a 6 px dot; title 20/28 → 24/32 (`sm`); description 14/22 → 15/24 muted; primary + outline
  actions `min-h-11`, full width below `sm`; a fan of three 170–220 px mini cards (150 / 180 / 220 px tall art) that
  sits above the copy until `xl` and beside it from `xl` (`1fr 420px`). Padding 24/20 → 32 → 48/40 px.
- A group or bento card with nothing in it: `SectionEmpty` inside that card.
- Filters or search with no match: `SectionEmpty` «Sin resultados» quoting the query, with «Limpiar filtros».

**9. Skeletons.** Same footprint as the loaded layout, card by card: the header summary as a 14 px bar, list rows with
the row grid (48 px `rounded-xl` logo, title `h-3.5 w-3/5`, meta `h-3 w-2/5`, a value bar from `sm`), a tile as label
+ 32 px figure + context bar, the dark surface as a light card with skeleton blocks. Real counts are never shown as
`0` while loading. Skeletons pulse (`animate-pulse`) but never play the entrance; an `sr-only` `role="status"` says
what is loading.

**10. Motion.** Once, when a part first shows its loaded content (`dashboard.module.css`, `saved.module.css`):
- Entrance `rise`: opacity 0 → 1 and `translateY(6px)` → 0, 320 ms `cubic-bezier(0.22, 1, 0.36, 1)`, stagger 40 ms per
  card (`--d`), at most 4 staggered cards.
- Charts: ring arc 400 ms (`stroke-dashoffset`), bars 320–360 ms (`scaleX`/`scaleY`), sparkline draw 400 ms, all with
  an 80–100 ms delay.
- Content arriving more than 600 ms after mount only fades in (150 ms), without inner chart motion.
- Sorting, filtering, selecting, switching tabs or removing never replays the entrance (`.enter` lives 700 ms on the
  workspace). Hover and chevron transitions 150 ms.
- Only `transform`, `opacity` and `stroke-dashoffset`; everything inside `prefers-reduced-motion: no-preference`, and
  `motion-reduce:transition-none` on transitions.

**11. 390 px rules** (checked at 390 × 844 in a real browser):
- No horizontal page scroll and no clipped text; long titles wrap (2 lines) and long names break (`break-words`,
  `overflow-wrap:anywhere` for e-mails and URLs).
- Inset 16 px; cards 16 px padding (list cards 6 px); bento 2 columns with 12 px gaps; the dark hero 20 px padding.
- Header controls full width; four segmented options as a 2×2 grid; tab rows wrap to a second line instead of
  clipping.
- List rows: the value column folds into the chips (salary chip, status badge), the chevron stays; a master-detail
  side panel is not shown: the row expands in place, or opens the screen's existing full-screen detail.
- Buttons that are the main action of a card are full width and 44 px tall; icon-only buttons 40 × 40.
- Secondary columns (timestamps) hide below `sm`; nothing the person needs to decide is hidden.

## Superficie oscura (hero) (binding since 2026-11-18)

The dark violet/black surface (`.pf-kpi-hero`: `bg-foreground text-background`) is the strongest accent in the
product. Used sparingly it marks «this is the one thing on this screen»; used often it turns PeopleFlow into a different,
dark brand. Treat it as a scarce resource.

**Do**
- Use it for **one focal item per screen at most**: the headline figure of an overview («Este mes», «Candidatos en
  proceso», «Entregas a tiempo») or the single item the person is about to act on, with one primary action
  (the saved vacancy preview, «Postularme»).
- Keep it a card among light cards: same 24 px radius, at most half of the content width from `sm` (6 of 12 columns,
  or a 400 px side panel); full width only in the single-column layout below `sm`.
- Inside, use the dark-surface tokens: text `text-background`, secondary text `text-background/65–75`, accent
  `--hero-accent: oklch(0.70 0.14 292.759)`, status re-tints (see Espacio del candidato → 6), skeleton blocks on
  `background/14%`. Optional glow: two radial washes of `--hero-accent` (34 % / 14 %) and, in light mode, the shadow
  `0 12px 32px -12px color-mix(in srgb, var(--primary) 45%, transparent)`.
- Give it **one** primary button, the light one (`bg-background text-foreground`, 44 px); secondary actions
  `outline` on `border-background/25` or `ghost` in `text-background/70`.
- In dark mode it stays a distinct violet tile: `.pf-kpi-hero` swaps `--foreground` to
  `color-mix(in oklab, var(--primary) 30%, var(--card))` and `--background` to `--card-foreground`, with a
  `ring-1 primary/40` instead of the shadow. It is never a lighter block on a dark page.

**Don't**
- Two dark surfaces on one screen, or two side by side.
- Lists, tables, sections, side navigation, headers, banners, full-width bands, dialogs, sheets, popovers, toasts in
  product code, or forms.
- Form and settings screens (Perfil, CVs, Configuración, the vacancy editor): they have no focal figure.
- A record the person reads rather than decides on (an application detail with its activity and the company's
  message): long text on the dark surface reads worse and the panel would be dark on every visit.
- As decoration, for emphasis of a warning (that is `--destructive` / the review tone), or to fill an empty state.
- It is optional: most screens have none. Adding one to a screen that has none needs a design review.

**Inventory (2026-11-18).** Every current use complies (one per screen, focal, half width or less from `sm`):

| Screen | Item | Why it qualifies | Source |
|---|---|---|---|
| `/candidato/dashboard` | «Este mes» hero (6 of 12 columns, 2 rows) | Headline figure of the overview | `features/candidate/dashboard/charts.tsx` `MonthHero` |
| `/candidato/guardadas` | Preview of the selected vacancy (400 px sticky panel, from 1280 px) | The item to act on, one primary action «Postularme»; below 1280 px the row expands light | `features/candidate/saved/queue.tsx` `VacancyPreview` |
| `/empresa/dashboard` | «Candidatos en proceso» hero KPI (4 of 12, 2 rows) | Headline figure | `features/employer-dashboard/sections/summary-section.tsx` → `kpi.tsx` `KpiCard hero` |
| `/empresa/metricas` | «Entregas a tiempo» hero KPI (4 of 12, 2 rows) | Headline figure | `features/company-metrics/sections/summary-strip.tsx` |

Not dark surfaces: modal scrims (`bg-black/30` in `dialog.tsx`, `sheet.tsx`, `drawer.tsx`); the marketing landing and
public careers sites keep their own art direction and are outside this rule. The candidate Postulaciones, CVs and
Perfil screens have none (`design/candidate-align/`).
