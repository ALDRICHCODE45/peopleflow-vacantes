# Company dashboard v2 (internal, employer-only)

Status: **agreed (2026-11-08)**: frontend review approved it without additions and the user approved DD1–DD6 as
recommended. Frontend needs: `docs/product/company-dashboard-v2-needs.md` (frontend repo),
artboard `design/dashboard-redesign/09-dashboard-empresa.html`. Builds on `stakeholder-metrics-v2.md` (snapshot, list
grammar, pipeline rules, DV1) and replaces `GET /v2/me/company/dashboard` (`backend/docs/dashboard.md`) once the
frontend moves. Backend tracking: `odd/tasks/stakeholder-metrics-v2-backend.md` T7.

User (verbatim, for both sessions): «se lo tomen con calma, no hay prisa, hay tiempo, si hay que redisenar algo, si
hay que cambiar algo, adelante, no hay tema, pero algo que si quiero es que se haga bien, quiero tener buena
performance en el cargado de la data, tecnicas de lazy loading o tecnicas para merjorar la ux del usuario».

## 0. In one screen

1. **Same engine as metrics, different audience.** The dashboard is for the people who run the vacancies (owner and
   recruiters); metrics is for owner and stakeholder. Both read the same per-company snapshots and formulas, so a
   number means the same thing on both screens. The dashboard routes live in the metrics feature behind the existing
   recruiter gate and are wired in `cmd/api` (no cross-feature import, archguard unchanged).
2. **Scope by role, enforced on the server:** owner = whole company; recruiter = vacancies where they have an open
   assignment today (DD1, today's dashboard rule). A recruiter can never widen it with filters.
3. **Sections load on their own** (summary first), each figure opens a server-paginated, sortable list with an exact
   total, like metrics §5.
4. **New data:** deltas vs the previous window, daily series of candidates in process, «Necesita atención» (overdue,
   due this week, stalled), pipeline per stage, positions per vacancy.
5. The current `GET /v2/me/company/dashboard` stays unchanged until the frontend switches, then is removed in a later
   slice.

## 1. What exists today (facts)

- `GET /v2/me/company/dashboard`, gate `requireRecruiter` (owner and recruiter; stakeholder 403). Six fields:
  `published_vacancies`, `in_process`, `pool_added_last_7_days` (null without talent-base access), `positions`
  `{covered, required}`, `origin_by_day` (90 dense days, organic/manual), `recent` (10 newest participations).
- Scope: `visibleV2Drafts` — owner sees every vacancy, a recruiter only those with an open `vacancy_assignments` row
  (`ended_at IS NULL`). The pool count is company-wide and needs talent-base access.
- `in_process` today = active participations in progression stages other than `new` (placement included).
  `positions.covered` = people currently in the placement stage; `required` = sum of `hiring_headcount`.
- Nothing is daily except `origin_by_day`; no deltas; no top vacancies. The talent-base list has no added-date filter.

## 2. Common rules

- Prefix `GET /v2/me/company/dashboard/…`, gate `requireRecruiter` (owner, recruiter). Stakeholders keep 403: they
  have metrics (DD5).
- Query: `window` = `7 | 30 | 90` (default 30). The window is the last `window` local days ending today
  (`America/Mexico_City`); the previous window is the `window` days before it. No `from`/`to`, no recruiter or
  requester filters on sections (the frontend's period switch is 7 / 30 / 90 días). Unknown parameters are 422
  `invalid_filter`, as in metrics.
- Every response: `definitions_version: "d2"`, `window {days, from, to, previous_from, previous_to}`, `as_of`,
  `scope: "company" | "own_vacancies"`.
- **Scope (DD1):** owner → every published vacancy of the company; recruiter → published vacancies where the caller
  has an open assignment at `as_of`. Applied in Go over the shared company snapshot (the snapshot never depends on
  the caller, so it is shared safely; only the output is narrowed).
- **«En proceso» (DD2), one definition for dashboard and metrics:** active participations (not discarded) in any
  stage except `new` and `placement` — reviewed and not yet hired. This changes today's hero number (placement
  leaves it) and metrics §4.4 `top_vacancies.in_process` (`new` leaves it); both are still unmerged on the metrics
  side, so we align them now.
- **Positions:** covered = active placement credits of the vacancy (as metrics §2.4), required = `hiring_headcount`
  (unset → 0). Today's dashboard counts people sitting in the placement stage; credits are the hire record and do
  not drop when a candidate moves. (DD3.)
- Lists follow metrics §5 (sort, order, limit, cursor, total, facets, applied_filters, CSV export). Scope is forced
  by role; `total` equals the figure for the same snapshot.
- **Audit (DD4):** dashboard lists are not audited: they show owners and recruiters the candidates of vacancies they
  already see on the boards, as today's `recent` does. Metrics lists stay audited because the stakeholder is outside
  operations.

## 3. Sections

### 3.1 `GET …/dashboard/summary` (Resumen)

```json
{
  "in_process": { "current": 48, "previous": 41,
                  "series": [ { "date": "2026-10-10", "value": 39 } ] },
  "published_vacancies": { "current": 12, "previous": 10 },
  "pool_added": { "current": 9, "previous": 14 },
  "positions": { "covered": 7, "required": 15 }
}
```

- `in_process.series`: one point per day of the window **plus** the last day of the previous window (oldest first),
  value at the end of each local day; `previous` = that first point. Rebuilt from `participation_stage_history`
  intervals (§4).
- `published_vacancies`: vacancies published and not paused, closed or finished at the end of the window's last day
  vs the previous window's last day, rebuilt from `vacancy_lifecycle_events`.
- `pool_added`: company candidates added to the talent base in the window vs the previous window (company-wide, as
  today); the whole object is `null` without talent-base access. The 7-day hero keeps working with `window=7`.
- `positions`: over the vacancies in scope that are published at `as_of`.

| Figure | Opens |
| --- | --- |
| in process (and each series point) | `dashboard/candidates?in_process=true` (point: `&on=YYYY-MM-DD`) |
| published vacancies | `dashboard/vacancies?status=published` |
| pool added | talent base `GET /v2/me/company/candidates?added_from=…&added_to=…` (new filter, §5) |
| positions | `dashboard/vacancies?status=published&sort=positions_open` |

### 3.2 `GET …/dashboard/attention` (Necesita atención)

```json
{
  "overdue": { "total": 3, "top": [ { "vacancy": { "draft_id": "…", "title": "…" }, "requester": null,
               "responsible": null, "commitment_date": "2026-10-28", "business_days_overdue": 8,
               "delivered": 2, "target": 5 } ] },
  "due_this_week": { "total": 2, "top": [ { "vacancy": {…}, "requester": null, "responsible": null,
                     "commitment_date": "2026-11-12", "delivered": 1, "target": 4 } ] },
  "stalled": { "total": 6, "threshold_business_days": 7,
               "top": [ { "participation_id": "…", "candidate": { "id": "…", "full_name": "…" },
                          "vacancy": {…}, "stage": { "kind": "screening", "name": "…" },
                          "business_days_in_stage": 12 } ] }
}
```

- State **now**, not window-bound. Vacancies in scope that are open (not closed, not finished).
- `overdue`: delivery configured, not fulfilled, `commitment_date` < today; most business days first, ties by title.
- `due_this_week` (DD6): delivery configured, not fulfilled, `commitment_date` between today and **Sunday of the
  current Monday–Sunday week** in Mexico City time; soonest first. On Sunday it covers only Sunday.
- `stalled`: metrics DV1 (≥ 7 business days in the current stage, never placement), most days first.
- `top` holds up to 5 rows; `responsible` is the open responsible function (person or null).
- Opens: `dashboard/deliveries?state=overdue` / `state=due_this_week`; `dashboard/candidates?stalled=true`.

### 3.3 `GET …/dashboard/pipeline` (Pipeline por etapa)

Metrics §4.4 `stages` (same kinds, order, `custom` folding, `retired`, stalled rule), scoped by role; no
`top_vacancies` here (they are §3.4). Opens `dashboard/candidates?stage_kind=K` (`&stalled=true`).

### 3.4 `GET …/dashboard/vacancies` section (Vacantes activas)

```json
{ "top": [ { "vacancy": { "draft_id": "…", "title": "…" }, "requester": null, "responsible": null,
             "in_process": 18, "positions": { "covered": 1, "required": 3 } } ] }
```

Top 5 published vacancies in scope by `in_process` (DD2), ties by title. Opens
`dashboard/candidates?vacancy_id=V&in_process=true`; the title links to the board (owner and recruiter both reach
it).

### 3.5 `GET …/dashboard/recent` and `GET …/dashboard/origin`

- `recent`: the 5 newest participations in scope (today's `recent` shape, unchanged fields). Each row links to the
  candidate and the vacancy as today.
- `origin`: `{ "by_day": [ { "date", "organic", "manual" } ] }`, one point per day of the window (organic = portal,
  careers site and unknown channels; manual = manual), participations in scope. A day opens
  `dashboard/applications?from=D&to=D`.

## 4. Data and performance

- **Snapshots reused:** the metrics period snapshot keyed `(company, window period)` and the pipeline snapshot keyed
  `(company)`. Scope is a Go filter, so an owner and their recruiters share loads.
- **New history snapshot** keyed `(company)`: for published vacancies, every participation with its stage intervals
  (`intake | move | recovery | discard` rows → `[entered, left)` per stage, `substate` and `not_applicable` ignored)
  and vacancy publication intervals from lifecycle events; covers at least 181 days (90-day window + previous end).
  Stage ids map to kinds with **today's** pipeline configuration (approximation: a stage retyped later rewrites its
  history; disposable data, documented).
- Series computed in Go from the intervals: O(participations × days) on company-scale data, cached 60 s. If the
  benchmark (metrics T6) shows it over budget, fall back to a nightly per-day rollup table without changing shapes.
- Index to evaluate in the slice with `EXPLAIN`: `participation_stage_history (created_at)` is not needed when the
  load goes by participation ids (existing `(participation_id, created_at, id)` index).
- Budgets as metrics §2: cold `summary` p95 ≤ 400 ms, warm section ≤ 50 ms.

## 5. Lists

Same grammar as metrics §5; scope forced by role; period = the window unless stated; not audited (DD4).

| Route | Rows | Filters |
| --- | --- | --- |
| `dashboard/candidates` | metrics §5.5 row | `in_process`, `on` (a series day: candidates in process at the end of that day), `stage_kind`, `stalled`, `vacancy_id` |
| `dashboard/deliveries` | metrics §5.1 row | `state` (`overdue`, `due_this_week`), `vacancy_id` |
| `dashboard/vacancies` | vacancy, requester, responsible, status, published_at, in_process, positions | `status` (`published`), `vacancy_id`; sort adds `positions_open`, `in_process` |
| `dashboard/applications` | metrics §5.6 row | `from`, `to` (inside the window), `channel` |
| `…/{kind}/export` | CSV as metrics §8 | same |

- Talent base: `GET /v2/me/company/candidates` (applications feature, talent-base gate unchanged) gains
  `added_from` / `added_to` (dates, local, inclusive) so «Nuevos en la base» opens its records; the count in
  §3.1 uses the same rule.

## 6. Answers to the frontend's open questions

1. **Scope per role?** DD1: owner whole company, recruiter only vacancies with an open assignment, enforced on the
   server — the rule today's dashboard and vacancy list already use. Alternative: recruiters see the whole company
   (they would then see candidates of vacancies they cannot open).
2. **Reuse the metrics snapshot and lists for recruiters?** Yes for the engine (snapshots and formulas), no for the
   routes: dashboard routes behind the recruiter gate with forced scope. The metrics routes stay owner/stakeholder.
3. **«Vencen esta semana»?** DD6: Monday–Sunday of the current week in Mexico City time, from today to Sunday.

## 7. Slices (after agreement)

1. **d2a:** history snapshot, scope filter, DD2/DD3 alignment in metrics, `summary`, `attention`, `pipeline`,
   `vacancies` section, `recent`, `origin`.
2. **d2b:** dashboard lists and exports, talent-base `added_from/added_to`, figure = total tests per role.
3. **d2c:** remove `GET /v2/me/company/dashboard` once the frontend no longer calls it.

## Decisions (approved 2026-11-08, all as recommended)

1. **DD1 Recruiter scope.** Recommendation: own vacancies (open assignment); owner whole company.
2. **DD2 «En proceso».** Recommendation: one definition everywhere: active, not in `new`, not in `placement`.
   Alternative: keep today's dashboard rule (placement counts) and change metrics to it.
3. **DD3 Positions covered.** Recommendation: active placement credits (as metrics). Alternative: people in the
   placement stage (today's dashboard).
4. **DD4 Audit.** Recommendation: dashboard lists not audited (operators already see these candidates on boards).
   Alternative: audit like metrics.
5. **DD5 Stakeholder.** Recommendation: no dashboard for stakeholders (403 as today); metrics is their screen.
6. **DD6 Due this week.** Recommendation: Monday–Sunday, today through Sunday, Mexico City time.
