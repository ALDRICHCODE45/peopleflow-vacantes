# Dashboard redesign — research

Spec: `odd/tasks/dashboard-redesign.md` (S1, S2). Scope: `/empresa/dashboard` and `/empresa/metricas` (+ recruiter detail).

## 1. What the user's references do (FlowMail, ShipNow)

| Pattern | FlowMail | ShipNow | Why it reads as "order" |
| --- | --- | --- | --- |
| Page opens with a voice | «Welcome back, Be!» + one line + 2 actions | «Analytics» + breadcrumb + search | The first thing read is a sentence, not a number grid |
| KPI strip | 4 equal cards: icon + label, big number, delta pill | 1 dark hero tile + 4 small cards with delta | One row, one job: "how are we doing"; the number is the largest type on the page |
| Rows with one job each | Row 2 = trend + share + ranking; row 3 = growth + recent + insights | Row 2 = rankings + heatmap; row 3 = full table | Each card answers one question and is titled with that question |
| Asymmetric sizes | Wide chart card, narrower donut and list | Chart 2× wide, heatmap tall | Size says importance before any label is read |
| Space | ~24 px gutters between cards, ~24 px inner padding, 1 card level | Same; no card inside card except list items | Groups separate by air, not by borders |
| Color | Grey canvas, white cards, one accent (violet) used on the selected/top data point only | Grey canvas, red accent on one series, black for the hero | The accent marks "look here"; everything else stays neutral |
| Charts | Line, donut, bars with one highlighted bar | Bar+line combo, heatmap, progress bars in lists | The eye gets shapes first, numbers second |
| Tables | Last row of the page, 4 columns, «View All» | Last block, filter tabs on top, status badges | Detail is at the bottom and opt-in |

## 2. Principles from research

Sources: PatternFly dashboard guidelines; Lukas Reese, *Power BI dashboard best practices* (2025); SimpleFi, *10 essentials
for better dashboards* (2025); Dexxy, *SaaS dashboard design guide* (2025); raw.studio, *1 hero metric, 4–6 KPIs* (2026);
Orbix, *Bento grid dashboard design* (2026); Pure Admin KPI bento; recruiting case studies (Darwinbox by P. Samudrala,
Teamtailor analytics on UX Planet, Deloitte hiring analytics by N. D'Souza).

1. **One decision per screen, one hero metric, 4–6 supporting KPIs.** More is a report, not a dashboard (raw.studio).
2. **Size = importance.** Hero tiles span more columns/rows; if the user must read labels to know what matters most,
   the sizing is wrong (Orbix bento).
3. **Reading path top-left → bottom-right: context → analysis → action** (Power BI, PatternFly). Summary first,
   detail on demand (progressive disclosure, Darwinbox).
4. **Whitespace does the grouping, not borders.** Inconsistent spacing feels chaotic even when the data is right;
   remove lines and add space; one container level (SimpleFi, gentle-ui-design composition guidance).
5. **8-point rhythm:** 16 px inside related groups, 24 px between cards, 32–40 px between sections (Power BI).
6. **Show change, not only state:** every KPI has a delta and a period; a sparkline answers "is it getting better?"
   (raw.studio, Darwinbox).
7. **Saturated color only for exceptions.** Neutral for normal, accent for the one thing to look at, status colors for
   health (raw.studio, Dexxy).
8. **Bars and lines over pies and gauges**; sorted bars beat unsorted ones for comparison (raw.studio, SimpleFi).
9. **Rule of 6** per visual group: cards in a row, series in a chart, columns in a table (raw.studio).
10. **Recruiting-specific:** full funnel on load, stage health (on target / slowing / stalled) instead of raw counts,
    source-of-hire conversion not just volume, filters as the primary navigation (Darwinbox); group by the objects
    people think in — vacancies, clients/areas, recruiters (Teamtailor).
11. **Mobile is rebuilt, not shrunk:** stack by priority order, charts become summary + sparkline, freshness stamp visible.

## 3. Current screens vs references

From the T1 exploration map (no rendered screenshot exists; the read is from code). Both surfaces stack one column
of `Card`s (20 px padding, 24 px radius, shadow + ring) inside `max-w-screen-2xl`.

| Topic | References | `/empresa/dashboard` today | `/empresa/metricas` today |
| --- | --- | --- | --- |
| Opening | Sentence + period + actions | «Tu dashboard» 22 px, subtitle, **no actions** | Title + badge «Definiciones vX» + 12 px freshness line, then a 6-field filter form in a card **before any number** |
| KPI strip | 4 cards or hero + 4, value is the biggest type, delta pill | 3–4 identical cards; icon repeated in the footer; no delta (no previous-period data) | **No strip.** 7 equal-weight cards in 3 columns, one spans 2 → ragged rows |
| One job per card | Yes | Mostly | No: Vacantes/Entregas cards hold 2–4 sub-blocks split by `border-t` lines, bars, legends, notes |
| Main visual | A wide chart leads row 2 | One area chart (organic vs manual, 90 days) | **No chart**: 8 px hand-made bars; «Cerradas por mes» shows bars **and** the same data as a table |
| Spacing | ~24 px gutters, 24 px padding, 40 px between rows | `gap-4` everywhere, `md:gap-6` between sections | Same `gap-4` at section, grid and card-content levels → nothing separates groups from contents |
| Help | None on the surface | — | ⓘ on every card **and** every stat: 3–5 per card; plus many 12 px muted captions |
| Detail | Short table at the bottom, «View all» | Vacancy list uncapped (up to 500 rows) **above** a 10-row table with checkboxes, tabs, column menu, pagination | Recruiter table with 10 two-line columns (~1676 px) + footnote; then a tabbed list with 7 more columns |
| Color | One accent on the data that matters | Area chart in 2 tones | Many tones per card (segmented bars + legends) |
| Story | What happened → why → who | KPI → chart → lists | No order: everything weighs the same; no "what needs attention" |

**Diagnosis in one line:** the content is right, but every element has the same weight, the same distance and the
same frame, so the eye has no entry point and no path. The references feel ordered because size, space and color
rank the content *before* anything is read.

## 4. Data — what exists and what a redesign would ask for

Exists (contract `docs/contracts/stakeholder-metrics-v1.md`, `features/employer-dashboard/model.ts`): vacancies
assigned/closed by reason, median business days to close, closing target on time/late/no target, delivery
on time/late/overdue/pending, on-time and configured rates, placements and positions covered, origin by channel,
closed by month, reassignments by reason, by client/area, full per-recruiter card and monthly series per recruiter;
dashboard: published vacancies, in process, pool added 7 days, positions, 90 daily origin points, 10 recent rows.

**New data (backend decision, marked «Dato nuevo» in the artboards):**

- **N1** Previous-period comparison for every summary figure (deltas). Same queries over the previous window.
- **N2** Company-wide monthly series for delivery on time / late and placements (today only per recruiter).
- **N3** Pipeline stage health: candidates per stage with time-in-stage and a stalled count.
- **N4** Dashboard «needs attention» list: deliveries overdue or due this week per vacancy (the overdue count already
  exists in metrics; the per-vacancy list with due dates is new for the dashboard).
