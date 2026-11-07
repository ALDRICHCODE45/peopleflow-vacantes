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

- [ ] T1 S1-S4 — explore current data (roles/authz/audit; metric sources), write `docs/contracts/stakeholder-metrics-v1.md`, send to the frontend session — inline + 2 explorers — commit: —
- [ ] T2 — user approves the catalog and decisions (blocked on user)
- [ ] T3+ — implementation slices, planned after approval

## Log

- L1 (2026-11-07, frontend session relaying the user's approval to start feature 3): T1 written proposal, no code yet — S1 stakeholder role and entry without email, S2 metrics catalog with written definitions, S3 read API, S4 open decisions with recommendations. Reply via intercom or doc path.
