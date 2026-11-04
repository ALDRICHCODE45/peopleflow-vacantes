# Talent base visibility («Base de talento visible para»)

Owner-configurable visibility of the company talent pool (unit 1b, right after feature 1). Frontend over a contract the
backend session proposes (worktree `peopleflow-vacantes`); product source `docs/product/next-three-features.md` §1, Q1.

## Specs

- **S1** Configurable by the owner: «condiero que esto debe de ser configurable por el owner ... que se pueda configurar
  la visibilidad, para "Todos los reclutadores" o para "ciertos usuarios" y poder elegir a esos ciertos usuarios».
  Company setting, owner only, audited: «Base de talento visible para» = «Todos los reclutadores» (default, as today) or
  «Usuarios seleccionados» with a member picker.
- **S2** The owner always sees it; the stakeholder (feature 3) too.
- **S3** A recruiter outside the list still sees, from the board, the candidates of the vacancies where they hold an
  active tramo. They lose the global search, the detail outside a vacancy, the base CVs and the contacts export.
- **S4** Delivered as a small separate unit, right after feature 1.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1–S3 | Contract proposal from the backend session, frontend review (done, L2–L3) | `746e13f7` |
| T2 | S1, S2 | Worker (background): owner setting in Configuración: mode + member picker, save, audit noted (done, L5) | `c61c41de` |
| T3 | S3 | Worker (background): restricted recruiter: Base de talento entry hidden/denied state, board detail stays, no CV/export outside a vacancy, duplicates-check without last vacancy (done inline, L6) | `cb3cf014` |
| T4 | all | Integration against the real backend, verification, partner doc update | — |

## Log

- **L1** (user, 2026-11-03, original request): «Hola hermano, continuemos donde nos quedamos por favor.» → asked
  which next; answer: «Sí, arrancá la 1b» (Le pido el contrato al backend y armo odd/tasks/talent-base-visibility.md).
  Specs S1–S4 quote the agreed decision Q1 (`docs/product/next-three-features.md`, 2026-11-02).
- **L2** Backend proposed `docs/contracts/talent-base-visibility-v1.md` (branch `feat/talent-base-visibility-backend`,
  uncommitted): GET/PUT `/v2/me/company/talent-base-visibility` (mode all_recruiters|selected_users, viewers, ETag,
  If-Match; errors version_conflict, validation_error, users_not_applicable, viewer_not_member, viewer_is_owner);
  `GET /me/company` gains `can.view_talent_base`; the 9 `/v2/me/company/candidates/**` routes → 403
  `talent_base_restricted` before lookup; vacancy routes unchanged; offboard/promotion clears the viewer row; audit
  `TalentBaseVisibilityChanged` with IDs only; migration 00055.
- **L3** (user, 2026-11-03): D1 «Sí, es válido (Recomendado)» — selected_users with an empty list is valid (only the
  owner sees it; the screen warns before saving). D2 «Aviso sin la última vacante (Recomendado)» — manual-intake
  duplicates-check keeps working with last_vacancy/last_added_at null for recruiters without access. D3 «Mensaje claro
  (Recomendado)» — 403 `talent_base_restricted` shows «El owner limitó el acceso a la Base de talento» and the menu
  entry is hidden. T1 done.
- **L4** Backend delta (contract commit after `8ea05adc`): `validation_error` is 400 with {error, code, fields}; the
  three talent_base_* codes stay 422; GET `updated_at` may be null before the first save (all_recruiters, version 1,
  ETag "1"); only POST offboard adds `talent_base_viewer_removed`.
- **L5** T2 (background worker): owner-only card «Base de talento visible para» in Configuración after «Tu empresa»;
  recruiters get nothing rendered and no request; empty selection shows a permanent inline warning; every contract
  error has copy; version conflict keeps the draft. 45 tests. Follow-up noted: the page reads `/me/company` twice.
- **L6** T3 inline (the parallel-writer launch was rejected by the surface overlap check over `(empresa)` paths):
  `can.view_talent_base` read from `GET /me/company` (missing → true, today's open base, since the backend enforces);
  sidebar hides «Base de talento» only when it is false; `talent_base_restricted` kept in list, summary, detail,
  history, edit and CV failures; the talento page and the detail sheet show «Base de talento restringida» with no
  retry; edit and CV uploads explain the same; manual intake decodes `last_added_at: null`. Tests run on Node 22
  (`engines`); Node 25 breaks jsdom `localStorage`.
- **L7** Full suite on Node 22: 9633 passed, 7 failed. One real failure: the transport allowlist in
  `jobs/requestPath.test.ts` did not list `talent-base-visibility/client.ts` (registered; 30/30). The other 6 (combobox,
  manual-intake sheet, draft editor shell, local draft form) pass alone (170/170): timeouts under suite load. Commits
  `746e13f7` (docs), `cb3cf014` (T3), `c61c41de` (T2); slices are separate units (T2 ~620 lines with its tests).
  Browser review and the real backend remain in T4.
- **L8** Native review (risk + reliability) of `746e13f7..32fb8ca1`: approved and acknowledged
  (`review-924ca82bcb63dbcf`). Advisory findings closed in the follow-up commit: the history tab now shows «Base de
  talento restringida» without a retry; a duplicate with `last_vacancy`/`last_added_at` null is pinned in the intake
  sheet; the contract copy refreshed to the backend's `984cc378` (validation_error 400, setting created on demand, 409
  possible_duplicates redacted the same way — already decoded by the shared match schema). 583 tests, tsc clean.
- **L9** Backend implemented (`feat/talent-base-visibility-backend` tip `7c788d72`; T2 `013096fa`, T3 `18d830bc`).
  Final contract: the 412 body is the GET keys plus `error` and `code` at the top level, with the current ETag; field
  codes required | invalid | duplicate (400) and not_applicable | not_member | is_owner (422); PUT checks shape, then
  all_recruiters with ids, then version, then members; offboard/promotion clean-up does not bump the version. Integration
  defect fixed test-first in `352eeac2`: the strict document schema rejected the 412 body, losing the current setting.
  T4 QA requested: branch API on :8081 with its own DB; :8080 stays on main.
- **L10** T4 owner side verified in the browser (Playwright, user signed in as Test User, owner of «Trust People
  Company»; Next :3000 with `PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:8081`, backend `7c788d72`, then `32d831e2` after
  the backend's verifier fixed a PUT/edit deadlock): real GET loads «Todos los reclutadores»; the picker lists the real
  recruiters (Diego Hernández, Ana López) without the owner; «Usuarios seleccionados» + Ana saves and survives a reload;
  the empty list shows the warning, saves and survives a reload; back to «Todos los reclutadores» hides the picker and
  saves; the owner keeps «Base de talento» in the sidebar; console clean. Mobile 390px dark readable. The setting was
  left on «Todos los reclutadores». The one «No pudimos cargar…» seen was the QA API restarting. Recruiter side pending:
  the user creates a second Cognito recruiter account (QA seeds cannot sign in).
- **L11** (user, 2026-11-04) on the dashboard count `pool_added_last_7_days` for a recruiter without access: «Ocultarla
  (Recomendado)». Backend sends null for them; the dashboard drops «Nuevos en la base» and uses three columns.
  Frontend done test-first (216 tests, tsc and ESLint clean); backend SHA pending. Partner doc updated.
