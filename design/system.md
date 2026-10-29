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
