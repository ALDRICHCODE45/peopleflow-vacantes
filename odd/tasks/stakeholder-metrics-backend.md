# Stakeholder + metrics (feature 3) — backend

Backend side of feature 3: the backend session proposes the contract `docs/contracts/stakeholder-metrics-v1.md`; the
frontend session (worktree `peopleflow-vacantes-frontend`, `odd/tasks/stakeholder-metrics.md`) reviews it. Nothing is
built until the user approves the metrics catalog. Product source: `docs/product/next-three-features.md` §3.

## Specs

- S1 Stakeholder role: «Rol stakeholder: tipo de usuario propio, solo lectura, ve toda la empresa y puede ver datos personales de candidatos.» Propose how a stakeholder enters in local and dev without email («por ejemplo, un link de invitación que se pueda copiar, o un alta manual que haga el owner»). «Invitar y quitar stakeholders es solo del owner.» State which existing endpoints answer and which reject it, and how it is audited.
- S2 Metrics catalog: «cada una con su definición escrita (fórmula, fuente de datos, ventana de tiempo y casos borde)», for: «vacantes asignadas por reclutador; cuántas concluyen en el tiempo configurado; si entrega los candidatos en tiempo y forma, cuánto tarda y cuántos entrega; cuántas terminan en placement y cuántas no; de dónde se postulan los candidatos; vacantes cerradas por mes; por cliente o departamento interno; qué reclutador rinde mejor (como ficha por reclutador, no como ranking: compara el humano); analítica de reasignaciones.» Mark each as computable with current data (feature 1 tramos, audit) or missing data. «El canal de origen de la postulación hoy no distingue el portal del sitio de carreras: proponé cómo capturarlo y qué hacemos con los datos históricos.»
- S3 Read API: «endpoints para la vista de empresa y para la ficha por reclutador, con sus filtros (rango de fechas, reclutador, cliente o departamento), la forma del JSON y la paginación de las listas de detalle. Contame también si conviene precalcular o calcular en cada consulta.»
- S4 «Decisiones abiertas para el usuario, numeradas y cada una con tu recomendación.»

## Tasks

- [x] T1 S1-S4 — explore current data (roles/authz/audit; metric sources), write `docs/contracts/stakeholder-metrics-v1.md`, send to the frontend session — inline + 2 explorers — commit: a2914cde
- [x] T2 — user approved D1–D12 as recommended (L4) — commit: this docs slice
- [ ] T3 S1 slice 3a: stakeholder role, gate (fail closed), invitations, `GET /me/company` role/can, members list, audit events (contract §1) — worker in worktree `../peopleflow-vacantes-3a`, branch `feat/stakeholder-metrics-backend-3a`, migration 00057 — Risk: item 2 (permissions/guards) → independent verify — commit: —
- [x] T4 S2 slice 3b: `origin_channel` + apply `channel`, requester columns, `target_close_date` + change log, «Mi rendimiento» deadline_result from the N-th `reached_at` (contract §2.10) — worker in worktree `../peopleflow-vacantes-3b`, branch `feat/stakeholder-metrics-backend-3b`, migration 00058 — commit: 0e1c63ae
- [ ] T5 S2-S3 slice 3c: metrics read API (contract §3) after 3a and 3b merge — commit: —

Slice boundary: commits up to the approval (contract + tracking, ~450 doc lines) are slice 0 on
`feat/stakeholder-metrics-backend`; 3a and 3b are separate branches from it, 3c follows their merge.
Integration DB on this PC: disposable container `peopleflow-draft-test` at 127.0.0.1:55432 (`draft_test`).

## Log

- L1 (2026-11-07, frontend session relaying the user's approval to start feature 3): T1 written proposal, no code yet — S1 stakeholder role and entry without email, S2 metrics catalog with written definitions, S3 read API, S4 open decisions with recommendations. Reply via intercom or doc path.
- L2 (2026-11-07): T1 proposal written in docs/contracts/stakeholder-metrics-v1.md (a2914cde) and sent to the frontend session; D1–D12 await the user.
- L3 (2026-11-07, frontend review): F1–F8 applied to the contract — members list role, accept replay, dense series, people/requester objects, null rates with numerator/denominator, D8 keeps «Mi rendimiento» shape, channel field, can.view_metrics.
- L4 (2026-11-07, frontend session relaying the user): «si hermano, aprobado, adelante.» — D1–D12 approved as recommended; contract agreed with F1–F8; start slices 3a, 3b, 3c; notify the frontend when 3a runs on :8081; send any contract diff.
- L5 (2026-11-07, 3a worker finding): plain DELETE already writes CompanyMemberOffboarded, so CompanyMemberRemoved is dropped; offboard reassignment to a stakeholder answers 422 not_company_member. Contract §1.3/§1.4 updated.
- L6 (2026-11-07, integration baseline on feat/stakeholder-metrics-backend = main code, DRAFT_TEST_DATABASE_URL at :55432): 111 ok / 9 FAIL, all pre-existing and outside 3a/3b — legacy v1 tests in jobs/applications infrastructure/postgres need table `applications` in the DATABASE_URL dev DB (missing), identity migration_00007 drop jobs vs dev DB, cmd/api main_test picks IDENTITY_JWT_CLIENT_ID from .env. Slices are judged against this baseline.
- L7 (2026-11-07, frontend design questions): P1 not_configured vacancies enter by tramo overlap; P2 configured/total counts plus on_time_rate and configured_rate; P3 did_not_hold is a subset of direct/participant/shared; P4 card by_month shape. P5 (no public invitation lookup) acknowledged, no change.
- L8 (2026-11-07, 3b done, commit 0e1c63ae on feat/stakeholder-metrics-backend-3b): invalid apply channel is 400 validation_error (catalog status), wire key targetCloseDate (absent keeps, null clears), no DB check tying origin_channel to source (fixtures flip source). Contract and vacancy-team-v1 D8 note updated.
- L9 (2026-11-07, 3a done, commit 30dcced7 on feat/stakeholder-metrics-backend-3a, independent verify running): silent-contract choices accepted and written into §1.3 (revoke unknown id 204, created_by user id string, POST members keeps its own codes, PATCH stakeholder check before lookup, accept checks account type first). TestPublicGeoSearchIndexCapability fails on the :55432 test DB with main's code too (planner state after repeated runs; passed in L6 baseline), not a 3a defect.
