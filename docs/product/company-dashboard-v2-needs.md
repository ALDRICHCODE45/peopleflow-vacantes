# Company dashboard v2 — frontend needs

From the approved artboard `design/dashboard-redesign/09-dashboard-empresa.html` (feature
`odd/tasks/dashboard-redesign.md`, L12, L15). Same principles as `stakeholder-metrics-v2-needs.md`: every figure opens
its records, sections load on their own, performance first. The backend proposes the contract; this only lists what
the screen shows. Today the screen reads `GET /v2/me/company/dashboard` (`frontend/src/features/employer-dashboard/model.ts`).

User (verbatim, for both sessions): «se lo tomen con calma, no hay prisa, hay tiempo, si hay que redisenar algo, si
hay que cambiar algo, adelante, no hay tema, pero algo que si quiero es que se haga bien, quiero tener buena
performance en el cargado de la data, tecnicas de lazy loading o tecnicas para merjorar la ux del usuario».

## Sections and figures (✓ = exists today)

| Section | Figure | Data | Opens |
| --- | --- | --- | --- |
| Resumen | Candidatos en proceso (hero) + 90-day sparkline | ✓ value · **new** delta vs previous window · **new** daily series | Candidates in process |
| Resumen | Vacantes publicadas, Nuevos en la base (7 días) | ✓ values · **new** deltas | Published vacancies · talent pool filtered by added date |
| Resumen | Posiciones cubiertas N de M | ✓ | Vacancies with positions |
| Necesita atención | Entregas vencidas: per vacancy, client/area, responsible, delivered of target, days overdue (top 5 + total) | **new** | Deliveries overdue (same list as metrics `deliveries?result=overdue` if the viewer may see it) |
| Necesita atención | Vencen esta semana: per vacancy, commitment date, delivered of target (top 5 + total) | **new** | Deliveries pending with commitment ≤ end of week |
| Necesita atención | Candidatos detenidos: candidate, vacancy, stage, business days in stage (top 5 + total) | **new** (same DV1 rule: 7 business days, not placement) | Candidates stalled |
| Pipeline por etapa | Per stage kind: candidates, stalled | **new** (same as metrics `pipeline`) | Candidates in stage / stalled |
| Vacantes activas | Top 5 by candidates in process, positions N de M | ✓ partly (positions per vacancy is new) | Vacancy pipeline |
| Candidatos recientes | Last 5 (name, vacancy, stage, source/added by, date) | ✓ | Candidate / vacancy |
| Postulaciones | 90 daily points organic vs manual | ✓ | Applications of that window |

## Loading

Header + Resumen first; Necesita atención and Pipeline next; the lower sections lazily. Independently fetchable pieces,
period switch 7 / 30 / 90 días without layout jumps.

## Open questions for the backend proposal

1. **Scope per role.** Today every company member sees the same dashboard. Should «Necesita atención» and the pipeline
   show the whole company for a recruiter, or only the vacancies where they have an open tramo (with the owner seeing
   all)? Propose a default; the user decides.
2. Can the dashboard reuse the metrics snapshot (and its list routes) for recruiters, who are not metrics viewers, or
   does it need its own gated routes?
3. Is «vencen esta semana» Monday–Sunday in Mexico City time, or the next 7 days?
