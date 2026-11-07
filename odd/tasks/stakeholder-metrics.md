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
| T3 | S4, S8 | Design directions (gentle-design) for the metrics screen and the recruiter card; user picks (done, L7, L9: `01-tablero-y-tabla.html` chosen) | `7d77c4f0` |
| T4 | S1–S3 | Worker (background), slice 3a against contract v1 before the backend 3a runs: owner invitation screen (artboard 04), accept page, `role: "stakeholder"` and `can.view_metrics` parsing, members-list enum + picker/offboard filters, stakeholder sidebar and landing, Métricas nav entry (Risk: item 2, role gate and invitation token) (built, L16; browser integration pending) | `1b2b41d0`, `a98982bb`, `634c0878`, `8a0576a2`, `ad211096` |
| T5 | S4–S6 | Worker (background), slice 3c against contract v1: `/empresa/metricas` from artboard 01 plus recruiter detail and audited detail from 05, corrected by L8 (built, L12–L14; merge after T4) | `e357dc13`, `23713769`, `71912050`, `cf009b2c`, `47809220`, `d35b2079`, `166c51d3`, `5679b004` (branch `feat/stakeholder-metrics-t5`, merged `730877d0`, `5b6a6907`) |
| T7 | S6, S7 | Slice 3b frontend: apply sends `channel` (`careers_site` from the company careers site, `portal` from /vacantes; 400 `validation_error` on `channel`); optional «Fecha objetivo de cierre» (`targetCloseDate`, null clears) in the vacancy management configuration (done, L20) | `c389927a`, `20ef9cbe` |
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
- **L8** Backend contract `39669aa5` answers P1–P5: `not_configured` vacancies enter a period by a tramo overlapping it
  (configured ones by `commitment_date`, D12); delivery adds `configured`, `total`, `on_time_rate` (denominator
  on_time+late+overdue, pending not judged) and `configured_rate`; `did_not_hold` is a subset of direct/participant/
  shared, never added on top (artboards that add it must be corrected at implementation); dense `by_month
  {month, assigned, delivery {on_time, late, overdue}, placements}` (months do not sum to the period); no public
  invitation lookup.
- **L9** (user, 2026-11-07): «Si hermano, la 01 es tambien mi eleccion.» → `01-tablero-y-tabla.html` is the chosen
  artboard (handed off with gentle_design implement); 02 and 03 are alternatives; 04 and 05 accompany it. Slice
  boundary: commits up to here are tracking and design prototypes (≈1.8k generated HTML lines); code goes in separate
  slices per task (T4, T5), each about 400 authored lines.
- **L10** Backend 3b committed (`0e1c63ae`, branch `feat/stakeholder-metrics-backend-3b`, unmerged); contract diff
  `f978d783`: invalid apply `channel` → 400 `validation_error` with `fields:[{field:"channel",code:"invalid"}]`
  (not 422); `targetCloseDate` (YYYY-MM-DD, camelCase) in the management config, omitted on GET while unset, PUT
  missing keeps it, `null` clears it, bad format 400 `invalid_request`; «Mi rendimiento» `deadline_result` now uses the
  N-th `reached_at`, same fields and values. New task T7 for the frontend side of 3b.
- **L11** Backend 3a implemented (`30dcced7`), under independent verification before :8081; contract diff `280d75bf`:
  invitation list `created_by` is the owner's user id string; DELETE of an unknown/other-company invitation → 204,
  nothing written; accept checks account type first (candidate → 403 `candidate_account` even with a bad token); any
  PATCH involving the stakeholder role → 422 `stakeholder_role_change_not_supported`; POST members with role
  stakeholder is a test/script path only (409 `already_exists`, 400 candidate). Forwarded to the T4 worker.
- **L12** T5 worker done on branch `feat/stakeholder-metrics-t5` (worktree `peopleflow-vacantes-frontend-metrics`):
  `e357dc13`, `23713769`, `71912050`, `cf009b2c` (678 lines, over the slice target), `47809220`, `d35b2079`;
  company-metrics 59/59, typecheck clean, lint 0 errors. `/empresa/metricas` (toolbar, summary, recruiter table,
  vacancies/reassignments tabs) and `/empresa/metricas/reclutadores/[userId]` (card, monthly series, audited detail
  sheet, fail-closed). Departures from the artboard by contract: no closing-target or per-recruiter on-time %, counts
  only; `did_not_hold` shown inside the total. Shape assumptions M1–M7 (detail card at root, row field names,
  «sin solicitante» kind, `requester_id=none` without kind, 366-day reading, null rate objects) sent to the backend.
  Follow-up: unify the local role parser with employer-company after T4. Merge into the feature branch after T4.
- **L13** Backend answers M1–M7: M1–M4 confirmed (`delivered_by` person or null for organic direct entries; placements
  status `active | did_not_hold`, voided absent); M5 `by_requester` rows `{requester: {kind,id,name} | null, vacancies,
  filled}` (corrects the flat §3.1 example); M6 `requester_id=none` alone = sin solicitante,
  `requester_kind=X&requester_id=none` = X sin especificar, kind alone = all of that kind, real id without kind → 422;
  M7 366 days counting both ends (`to - from ≤ 365`); rate objects always present, `value` null without sample.
  Corrections sent to the T5 worker (continuation).
- **L14** T5 corrections `166c51d3` (M3, M5, M6, strict rate objects; M1/M7 pinned): RED 12 failing of 64, GREEN 64/64,
  typecheck clean, lint 0 errors.
- **L15** Backend 3a + 3b running on :8081 (`feat/stakeholder-metrics-backend` at `5f626571`, dev DB at migration 58):
  invitations CRUD, accept, `GET /me/company` role + `can.view_metrics`, members list with stakeholders, fail-closed
  gate, apply `channel`, `targetCloseDate`, «Mi rendimiento» on the N-th `reached_at`. Metrics routes arrive with 3c.
  M1–M7 in the contract (`b7476aa1`). T4 integration against :8081 can start when the T4 worker returns.
- **L16** T4 worker done and committed in five units (`1b2b41d0` role + pickers, `a98982bb` stakeholder shell and
  gate, `634c0878` invitation contract/client/actions, `8a0576a2` owner invitations card, `ad211096` accept page,
  `Referrer-Policy: no-referrer` + `no-store` on /empresa/invitacion). T5 merged (`730877d0`). Full checks: typecheck
  0, lint 0 errors; vitest 10006 passed, 3 failed in `features/jobs/requestPath.test.ts`, the request-path allowlist
  guard, which already failed on main since the audit-log merge (audit clients never listed). Fixed in `bfbdd2ab`:
  audit, invitation and metrics server-only clients and the audit export route listed, each with its guard
  assertions (34/34). Open from T4: «Mi cuenta» is the footer account menu (no account page exists); invitations card
  lists pending ones only (current stakeholders appear in the members list).
- **L17** Backend 3c (7 metrics routes) committed on `feat/stakeholder-metrics-backend-3c`, under independent
  verification; contract diff `c3907ef7` (§3.7): detail `candidate` is `{id, full_name}` (corrects M3); detail reads
  ignore the common filters; vacancies rows add `delivery.business_days_late` (only for `late`); 422 `invalid_filter`
  field `requester_kind` code `required` for a real id without kind, field `to` code `range` over 365; 400
  `invalid_cursor`; `summary.vacancies.closed` counts close events while `closed_by_month` counts distinct vacancies;
  `by_requester` order named A–Z, «sin especificar», «sin solicitante»; cards by lowercased name, null names last;
  medians may be x.5; `recruiter_id` semantics per route. T5 correction delegated.
- **L18** T5 §3.7 alignment `5679b004` (candidate `{id, full_name}`, «Tarde · N días hábiles», 422 field errors at the
  control, «Cierres» counts events vs distinct vacancies per month, backend order kept, x.5 medians, recruiter filter
  note): RED 14 of 69, GREEN 69/69, typecheck clean, lint 0 errors. Merged into the feature branch (`5b6a6907`).
- **L19** Backend feature 3 complete on :8081 (`feat/stakeholder-metrics-backend` at `48ff225f`, dev DB at 59): 3a, 3b
  and the 7 metrics routes; backend independent verification of 3c passed (owner/stakeholder gate, recruiter 403,
  company isolation, audited fail-closed detail, F3–F5/P1–P4/M1–M7/§3.7 shapes). T6 can start after T7.
- **L20** T7 done: `c389927a` optional «Fecha objetivo de cierre» (`targetCloseDate`, omitted when unchanged, `null`
  clears, 400 → field error), `20ef9cbe` apply `channel` (careers-site job links `/vacantes/<id>?origen=sitio`, read
  on the server in the detail and /postular pages, carried through sign-in, only «Postularme» carries it; no channel
  → field omitted; 400 `channel` invalid → generic apply failure). Focused related runs 319 + 1030 passed, typecheck
  0, lint 0 errors. Risks: old shared careers-site links count as portal; help copy and ±5-year calendar range are the
  worker's choices.
- **L21** Full checks on the integrated branch (T4 + T5 + T7): typecheck 0, lint 0 errors (12 pre-existing warnings),
  vitest 547 files / 10071 tests passed, 2 skipped. Next: independent verification of T4 (Risk item 2) with browser
  checks against :8081.
- **L22** Independent verification of T4/T5 (code review + unauthenticated curl against `pnpm dev` on :3100): S1–S3
  pass in code, no blocker or high finding; signed-in browser scenarios (a)–(e) unproven because employer sign-in is
  Cognito-only and the local bootstrap needs a human (needs the user's sessions). Invitation pages answer with
  `Referrer-Policy: no-referrer` and no-store. Findings: (M1) the stakeholder route gate fails open when
  `GET /me/company` or `/v2/me` fails (page mounts and calls the API, which answers 403: accepted, the API is the
  authority); (M2) after accepting, the invitee lands on the «Te uniste» card with «Ver métricas», as in artboard 04;
  (L1) a candidate opening a malformed link saw «enlace no válido» instead of «cuenta de candidato», fixed in
  `26911b17` by letting the API judge the token (RED 3 failing, GREEN 63/63, typecheck clean); info: Next's dev
  request log prints the token path; the middleware matcher covers one segment only. Backend confirmed
  `delivery.business_days_late` is always present (null when not late), so the strict decoder stays.
- **L23** Independent verification of `26911b17` (Risk item 2): passes; token only in the POST body to a fixed URL,
  never logged nor returned, other mappings unchanged; the login `callbackUrl` carries the encoded token, as §1.3
  allows. Dead `usableInvitationToken` removed in `293b2a3f` (62/62, typecheck and lint clean).
  Unproven live: candidate + malformed token → 403 against the real backend.
- **L24** (user, 2026-11-07): «abre el navegador con el mcp de playwhrite por favor, dejalo en la seccion de login, me
  loguego y despues haces las pruebas pertinentes de ui/funcionalidad». Browser run against :8081 (dev server needs
  `PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:8081`; `.env.local` does not set it). Owner (Test User · Trust People
  Company): Métricas entry for owner, summary, recruiter table, recruiter detail with monthly series, real data OK.
  Defect found: the audited detail sent no `from`/`to` → backend 422 `invalid_filter`, and the sheet showed the
  audit fail-closed copy for a filter error; fixed in `77605a14` (period sent as exactly `from`/`to`; 400/422 get
  their own non-audit message; 77/77). Re-run: «Candidatos entregados · 1» with name, reached time, delivered by, and
  «Consulta registrada en Auditoría». Invitations: create (link shown once, «Copiado»), pending «1 de 20» → «2 de 20»,
  revoke with confirm → «1 de 20». Mobile 390: layout stacks; «Por cliente o área» table clips its last column.
  Recruiter table headers truncate at 1440 («Mediana a la met», «Entregado:», «Días er»).
- **L25** (user, 2026-11-07): «no lo puedes hacer tu?? es que estoy ocupado, igualmente no importa que conozcas la
  contrasena, todo estoy es desarrollo y eventualmente se va a eliminar.» → the agent created the dev Cognito account
  `nocheblanca92+stakeholder@gmail.com` («Lucía Herrera»), confirmed it with `admin-confirm-sign-up`; the dev pool
  has no PostConfirmation trigger, so the backend session inserted its `users` row (employer, no company). Stakeholder
  run: no-session card → sign-in → accept → «Te uniste a Trust People Company» → reduced sidebar (Métricas + account
  «Stakeholder · Trust People Company»); /empresa/dashboard → /empresa/metricas; /empresa/vacantes → «Esta sección no
  está disponible para tu rol»; metrics load; audited deliveries detail as stakeholder shows the name and «Consulta
  registrada en Auditoría». Defects found and fixed: joined outcome stuck on «Confirmando tu invitación…» until a
  manual reload (`8de4372c`, re-verified live on the replay path); a Cognito-signed-in user unknown to the API looped
  back to the sign-in card (`03b2d13c`, new «Tu cuenta todavía no está lista» state). Minor: the blocked page header
  reads «Tu cuenta».
- **L26** Recruiter run: dev account `nocheblanca92+recruiter@gmail.com` («Diego Ramírez», created with
  `admin-create-user` + permanent password; backend inserted `users` + `company_members` recruiter of Trust People
  Company directly, so no `CompanyMemberAdded` audit row). Sidebar without Métricas or Auditoría; /empresa/metricas
  shows «Métricas restringidas» with «Ir al dashboard». Equipo lists Lucía Herrera with «Solo ve Métricas» (the
  members list now parses the stakeholder role). Not run: candidate + malformed link (f), the owner's members row
  actions for the stakeholder and the owner's audit screen entries (owner password not available to the agent).
