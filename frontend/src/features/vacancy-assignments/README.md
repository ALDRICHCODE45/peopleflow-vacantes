# Mi historial de vacantes

Development-only route: `http://localhost:3000/empresa/mi-historial`.
Start the existing frontend with `NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE=1` (or `api`).
`1` uses contract-shaped fixtures; `api` reads the real own-history endpoint through
an authenticated server action and the server-only guarded transport. For branch QA,
configure `PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:8081`.
Unset/other values and production return notFound and omit the account-menu entry.
Only an authenticated employer sees the menu item; the existing employer layout guards the route.

Fixture-only review states: `?fixture=empty`, `?state=loading`, `?state=error`.
API mode ignores these query parameters. The default has 14
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
participant credits are separate “participaste en N” figures. There is no aggregate
endpoint: the summary preloads up to 10 history pages (20 items per API page), not
just the preview. If more pages exist, every card says “al menos”. Paging the Sheet
past those preloaded pages adds each new page once to the summary; reaching the end
removes “al menos”. This bounds initial work without presenting partial totals as complete.
The Sheet still paginates independently; preloaded pages never inflate its visible list.

The strict decoder uses only the contract's own-history fields (no candidate data)
and accepts offset timestamps with microseconds. A 401 uses the existing session-expired
state. An invalid cursor restarts from the first page once; a failed restart shows the
existing error StateCard. Other read failures offer “Reintentar”, including inside the
Sheet, where already loaded rows remain available. All retries are read-only.

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
notifications, mutations or dependencies are introduced. The only new backend call is
`GET /v2/me/vacancy-assignments/history?cursor=`; the bearer stays in the server session.
