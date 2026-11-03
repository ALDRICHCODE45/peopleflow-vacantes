# Mi historial de vacantes

Development-only route: `http://localhost:3000/empresa/mi-historial`.
Start the existing frontend with `NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE=1` (or `api`).
Both values use contract-shaped fixtures until the own-history endpoint exists.
Unset/other values and production return notFound and omit the account-menu entry.
Only an authenticated employer sees the menu item; the existing employer layout guards the route.

Review states: `?fixture=empty`, `?state=loading`, `?state=error`. The default has 14
assignments, all three functions, function changes and all four end reasons.
No candidate records or vacancy access links are exposed.

The last chronological function is the Badge. Rows have two identity lines: title
and function, then period/end reason/“antes Colaborador” in one muted size.
Active and ended assignments are grouped under AHORA and ANTES, with success/muted
BriefcaseBusiness medallions matching the approved Equipo movements reference.
Only non-zero figures appear at right; all-zero rows say “Sin entregas”.
The Card is capped at five rows in total, current first. The outline “Ver todo”
opens a floating Sheet with the same rows, cursor pagination and a fixed “Cerrar”
footer. The preview does not grow after loading more in the Sheet.

“Candidatos entregados” counts only the person's own delivery-stage moves/manual
intake during each stay (`delivered_in_tramo`). Placement totals count direct + shared;
participant credits are separate “participaste en N” figures. The summary reads every history page,
not just the preview, so it remains complete and does not change while paging.

## Component audit

| Surface | Installed primitive/reference | Composition |
| --- | --- | --- |
| Summary | Card, card.md small size; company Equipo reference | Header → Title + Description |
| History | Card, Item; card.md/item.md | Header (title only) → Content with AHORA/ANTES sections; ItemMedia + two-line ItemContent + ItemActions figures → Footer |
| Function | Badge, badge.md | Native accent/secondary category, no dot or paint overrides |
| Full history | Sheet, sheet.md; approved team history | Trigger + Content → Header, one scroll body, Footer with ActionBar/Close |
| Actions | Button, button.md | outline, native targets |
| Waiting | Skeleton, skeleton.md | Same summary and three Item rows; decorative blocks hidden |
| Empty/error | SectionEmpty/StateCard, empty.md | Shared Empty composition; retry reads only |
| Account entry | DropdownMenu, dropdown-menu.md | Existing group; one Link item, History icon, one-line label |

Browser review (desktop/mobile, light/dark) is parent-owned. No new primitives,
notifications, mutations, dependencies or backend calls are introduced.
