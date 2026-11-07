# Stakeholder + métricas

Feature 3 of 3: a read-only stakeholder role that sees company-wide performance metrics, with a per-recruiter card.
Frontend over a contract the backend session proposes (worktree `peopleflow-vacantes`); product source
`docs/product/next-three-features.md` §3. Branch `feat/stakeholder-metrics`.

## Specs

- **S1** The role, verbatim: «ese rol que solamente va a meterse a ver metricas de la empresa ... este rol no va a
  poder hacer nada, porque lo unico que va a tener son metricas de rendimiento».
- **S2** «**Solo lectura**, ve **toda la empresa** y **puede ver datos personales** de candidatos.»
- **S3** «Necesita su propio **tipo de usuario** y una **invitación** (hoy agregar un miembro exige una cuenta de
  reclutador, y no hay invitación por correo; ver `decision-email-provider.md`).» Inviting stakeholders is owner only:
  «Invitar y quitar miembros de la empresa y cambiar roles (incluido invitar stakeholders).»
- **S4** «**Ficha por reclutador**, no un ranking único: puntualidad, volumen, conversión a placement,
  reasignaciones. El humano compara.»
- **S5** «**Cada métrica lleva su definición escrita** antes de construirse. Ejemplo de por qué: hoy la fecha de
  cumplimiento de la entrega puede ser el momento en que se guardó la configuración, no el de la entrada del
  candidato N.»
- **S6** Requested metrics, verbatim: «vacantes asignadas por reclutador; cuántas concluyen en el tiempo configurado;
  si entrega los candidatos en tiempo y forma, cuánto tarda y cuántos entrega; cuántas terminan en placement y
  cuántas no; de dónde se postulan los candidatos; vacantes cerradas por mes; por cliente o departamento interno; qué
  reclutador rinde mejor; analítica de reasignaciones.»
- **S7** «Datos que faltan para algunas: el **canal de origen** de la postulación (hoy no se distingue el portal del
  sitio de carreras) y los **tramos de asignación** (funcionalidad 1).» «El catálogo de métricas con definiciones se
  trabaja al llegar a esta funcionalidad.»
- **S8** The UI follows `docs/frontend-ui-design-rules.md` and the gentle-design / gentle-ui-design flow (L1).

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1–S7 | Contract + data model proposal and metric catalog draft from the backend session; frontend review; open decisions to the user | — |
| T2 | S5, S6 | Metric catalog with written definitions approved by the user before any metric is built | — |
| T3 | S4, S8 | Design directions (gentle-design) for the metrics screen and the recruiter card; user picks | — |
| T4 | S1–S3 | Stakeholder role: invitation flow (owner), stakeholder sign-in landing, read-only navigation | — |
| T5 | S4, S6 | Metrics screen and per-recruiter card over the agreed contract | — |
| T6 | all | Integration against the real backend, verification, partner doc update | — |

## Log

- **L1** (user, 2026-11-07): «Bien heramno, si, por favor, coordinate con el backend y ya sabes tus reglas de ux/ui
  para implementar la interfaz, por favor.» (answer to «¿Arranco la feature 3? … pedirle al backend su propuesta y
  armar el catálogo de métricas con sus definiciones, para que lo revises antes de construir nada.»)
- **L2** Branch `feat/stakeholder-metrics` starts at `a9ac06ef` (run-tests queue, not yet merged to main). Backend asked
  for the T1 proposal.
- **L3** Backend proposal `docs/contracts/stakeholder-metrics-v1.md` (backend branch `feat/stakeholder-metrics-backend`,
  `a2914cde`): membership role `stakeholder`, fail-closed gate, copyable single-use invitation link, catalog 2.1–2.10
  with formula/source/window/edge cases, `GET /v2/me/company/metrics/*` computed on request, slices 3a/3b/3c,
  decisions D1–D12. Frontend review sent (F1–F8): members-list role enum widens in 3a (`vacancy-team/model.ts:16`),
  token-in-URL handling and accept idempotency, dense monthly series, names and former-member labels, zero vs null
  with denominators, «Mi rendimiento» shape unchanged under D8, apply `channel`, stakeholder `can.*` flags. D1–D12
  go to the user.
- **L4** Backend applied F1–F8 on top of `a2914cde`: members list returns `role: "stakeholder"` and pickers filter on
  the frontend (team writes naming a stakeholder → 422 `not_company_member`); accept idempotent for the same user
  (200, no rewrite), 404 `invitation_invalid` otherwise, 409 `already_company_member`; dense ascending monthly series;
  persons `{user_id, name, former_member}`, requester `{kind, id, name}` or null; counts never null, medians/rates null
  without sample, rates `{value, numerator, denominator}`, card adds `closed_assigned`; «Mi rendimiento» shape
  unchanged; apply `channel` optional `portal | careers_site` (default `portal`, other → 422); `can.view_metrics`,
  sidebar keyed on `role === "stakeholder"`.
- **L5** (user, 2026-11-07): «si hermano, aprobado, adelante.» → D1–D12 approved as recommended (membership role,
  owner + stakeholder see company metrics, metrics only in v1, copyable single-use 7-day link, no role conversion,
  published-at-least-once universe, optional `target_close_date`, N-th `reached_at`, historical origin `unknown`,
  distinct vacancies per month, no score/rank, delivery period by `commitment_date`). T2 done; T3 starts.
- **L6** Backend contract diff `a21afe0c`: `CompanyMemberRemoved` withdrawn; removing a stakeholder writes the existing
  `CompanyMemberOffboarded` with empty assignment/reassignment lists (no new audit label). Recruiter offboard with a
  stakeholder `to_user_id` → 422 `not_company_member`; the frontend offboard target picker filters stakeholders out
  (T4, with the members-list role enum).
- **L7** T3 design directions in `design/stakeholder-metrics/` (gentle-design, `design.json` → this feature), over
  contract v1 with F1–F8 and D1–D12: `01-tablero-y-tabla.html` (summary dashboard + comparison table sortable by
  column), `02-riel-y-fichas.html` (filter rail, Empresa/Fichas/Definiciones tabs, grid of cards),
  `03-informe-y-definiciones.html` (report by questions, persistent definitions panel, recruiter list + card) — three
  alternatives for the metrics screen and the per-recruiter card, none chosen yet; plus `04-invitacion-stakeholder.html`
  (copyable single-use 7-day link, pending list with revoke, accept-page states, stakeholder sidebar) and
  `05-detalle-reclutador.html` (recruiter card + monthly series, audited delivered-candidates detail with a notice step
  and fail-closed state). No score or rank, alphabetical by default; every metric shows its definition; rates «N de M»;
  null medians «Sin datos suficientes»; «Ex miembro». Open points sent to the backend before T5: frontend-derived
  delivery share needs a catalog definition, how `not_configured` enters a period under D12, whether `did_not_hold`
  adds to the credit kinds, the card's `by_month` delivery breakdown. User picks a direction.
