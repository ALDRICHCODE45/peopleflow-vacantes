# Mi historial de vacantes

Development-only route: `/empresa/mi-historial`. `NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE=1`
uses fixtures; `api` uses the authenticated server action and guarded server-only
transport. Unset/other values and production keep the route and account entry hidden.
Fixture states: `?fixture=empty`, `?state=loading`, `?state=error` (ignored in API mode).

## History table (T10, S8/S10)

Eight columns: Vacante (client/area), Tu función (latest and previous), Periodo
(Mexico City business-day count), Estado (own and vacancy), Plazo (server result and
delta), Entregas (own contribution against the team target), Placements, Acción.
The strict decoder requires every own-history field in `vacancy-team-v1.md`, accepts
nullable title/requester/draft id/target/delta and offset microsecond timestamps,
and rejects candidate data. Results are never computed in the browser.

`RichDataTable` provides §26 column ordering, hiding, pinning and versioned local
preferences at `pf.table.own-vacancy-history`. Identity uses Equipo's lg initials
Avatar, 14.5px semibold title and muted secondary line; table rows use Equipo's
12px horizontal/16px vertical inset and uppercase 12px headers. The eight default
widths sum to 1280px (230/140/170/145/180/120/155/140); identity absorbs spare width.
Below that width the canonical scroll region owns horizontal overflow and sticky
offsets still come from the same sizing model. The action cell uses a 4px inset
to fit its native small ghost navigation link and ArrowUpRight icon.

Browser-review correction: all body copy wraps within its own cell; vacancy titles
wrap up to two lines. This intentionally supersedes §26.1 truncation for this page
at the user's request. No `TruncatedText`/`TwoLineCell` observer remains in history:
the previous nowrap cells plus intrinsic-width `items-start` secondary copy could
feed alternating overflow measurements as plain text became a tooltip trigger and
back. A bounded, simulated geometry regression reproduces that old effect loop;
wrapping text does not measure or swap DOM branches. Real-browser revalidation is
still required; jsdom cannot establish the exact original layout measurements. The explicit approved ghost “Abrir vacante”
link replaces §26's generic ellipsis action, only for non-null `draft_id` (no
navigation is offered for ended assignments). Its column is fixed and non-hideable;
its width accommodates the approved label. No row-click Sheet exists.

Ahora / Antes segmented Tabs filter the loaded backend pages; `period=now|before`
is stored in the URL, independently of column preferences. Below md, cards show
the same data, omitting absent requester and all-zero placements. The table and
column controls are hidden. Only one responsive presentation is visible.

“Cargar más” at the foot appends backend cursor pages, without a Sheet or a
five-row preview cap. Summary cards still preload up to ten pages; beyond that,
“al menos” marks lower bounds. Paging beyond preloaded cursors adds each page
once and removes the qualifier at the end. Direct + shared count toward placement
totals; participation is separate. Invalid cursor re-reads from the first page
once; 401 retains session-expired handling; read errors preserve loaded rows and
offer read-only retry. API/fixture switching is unchanged.

Plazo's on-demand InfoPopover explains the shared-team target, same-day boundary
and Mexico City business days, following the partner product document. Its visible
trigger is in the desktop column header (above the cards on mobile). Each server
result has its semantic Badge: success, danger, info or neutral. Positive deltas
are days before, negative days late; pending shows days left; null is omitted.
The `none` result renders only the “Sin plazo” badge, with no date placeholder.
Zero placement figures never appear. Zero deliveries read “Sin entregas”.

## Component audit

| Surface | Reference | Composition |
| --- | --- | --- |
| Summary/table/cards | card.md; Equipo members | Header → Title/Description, Content, optional mobile Footer |
| Desktop | table.md; canonical RichDataTable (§26) | Table → Header/Row/Head, Body/Row/Cell; native column controls/preferences |
| Identity | Existing Equipo lg Avatar | Avatar → AvatarFallback initials, no invented image |
| Function/result | badge.md | Semantic category variants; no paint overrides |
| Delivery | progress.md | Basic Progress, real capped proportion, accessible label |
| Grouping | tabs.md | Tabs → List/Triggers, current Content |
| Help | popover.md; existing InfoPopover | Trigger + portalled Content, Title/Description, muted footer |
| Loading | skeleton.md | Same summary/table/mobile regions with skeleton cells |
| Empty/error | empty.md; SectionEmpty/StateCard | Shared Empty composition and read-only retry |
| Links/buttons | button.md | buttonVariants ghost Link; outline pagination Button + Spinner |

Browser review is parent-owned: desktop/mobile, light/dark, overflow/sticky widths,
column menus/drag/persistence, help Escape/outside-click/focus return. jsdom tests
reuse the existing table menu/tooltip doubles and help-positioner-only shell;
real help Root/Trigger and application open/close logic remain under test.
No shared primitive, dependencies, notifications or mutations changed.
