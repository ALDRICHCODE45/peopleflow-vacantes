# Audit log — backend (feature 2)

Backend half of the frontend `odd/tasks/audit-log.md` (worktree `peopleflow-vacantes-frontend`). Contract:
`docs/contracts/audit-log-v1.md` (draft). Branch `feat/audit-log-backend` from main 7be2becc.

## Specs

- S1 — Need (user, verbatim): «no se podia saber que hizo cada reclutador, no se podia saber si un reclutador descargo
  algo, que hizo ( cosas sencibles), cuando las hizo, que paso despues, que descargo, cuando lo descargo, cuando inicio
  sesion, cuando cerro sesion».
- S2 — Product source `docs/product/next-three-features.md` §2, verbatim: «Lecturas sensibles: detalle de candidato,
  descarga de CV, exportación de contactos (hoy solo se audita ver un resultado psicométrico).» «Sesión: inicio de
  sesión (Cognito o BFF de Next) y «cerró sesión» al hacer clic. Con JWT no hay un registro exacto de expiración; se
  dice así, sin prometer más.» «Miembros y roles: hoy no se auditan.» «IP y navegador: el BFF de Next reenvía la IP
  real del usuario (trabajo del frontend).» «`company_id` en cada evento, para filtrar por empresa.» «Inmutable de
  verdad: la base impide UPDATE/DELETE (hoy es solo convención); opcional, cadena de hashes.» «Datos personales
  (LFPDPPP): IDs, no datos personales, en la metadata; política de retención definida.» «Pantalla de auditoría:
  filtros por persona, acción, fecha y vacante; exportar (solo owner) también queda auditado.»
- S3 — Permission principle (verbatim): «las cosas que "solo pueda hacer el owner" se limiten a las acciones mas
  sencibles y especificas, no a cada cosa que consideremos "importante"»; «Exportar la auditoría completa» is owner only.
- S4 — Frontend request (verbatim, 2026-11-04): «te pido la PROPUESTA DE CONTRATO (borrador docs/contracts/audit-log-v1.md
  en una rama nueva tipo feat/audit-log-backend, sin implementar todavía), cubriendo: 1. Lecturas sensibles nuevas:
  detalle de candidato, descarga de CV, exportación de contactos (cuándo se registra: ¿cada GET o con deduplicación por
  ventana?). 2. Sesión: inicio de sesión y «cerró sesión» por clic (qué endpoint llama el BFF en cada caso; sin prometer
  expiración de JWT). 3. Altas/bajas de miembros y cambios de rol. 4. IP y navegador: qué header espera el backend del
  BFF (hoy el BFF NO reenvía ninguna IP; X-Forwarded-For no existe en frontend/), y cómo evitar que un cliente lo
  falsifique (confianza solo en el BFF). 5. company_id en cada evento. 6. Inmutabilidad real en la base
  (trigger/permiso que impide UPDATE/DELETE) y si proponés la cadena de hashes o la dejás para después. 7. LFPDPPP: solo
  IDs en metadata; propuesta concreta de política de retención (marcala como decisión abierta para el usuario). 8. API
  de lectura para la pantalla: listado paginado con filtros por persona, acción (catálogo de tipos con etiqueta), rango
  de fechas y vacante; quién puede verla (propuesta: owner; decime si ves que otro rol debería), y exportación solo
  owner, también auditada (formato y límite). 9. Si conviene cortarlo en slices (p. ej. 2a captura, 2b pantalla+export)
  para revisión. Listá al final las decisiones abiertas para el usuario con tu recomendación.»

## Tasks

- [ ] T1 — S1–S4: contract draft `docs/contracts/audit-log-v1.md`, frontend review, user decisions. Route: inline
  (after one explore map). Commit: —.

Later tasks are cut from the agreed contract.

## Log

- L1 — User (2026-11-03, verbatim): «HOla hermano, contiuemos donde nos quedamos por favor.» Then the frontend session
  sent the S4 request. Dev DB `peopleflow-vacancies` migrated 53 → 55 (the 1b pending step).
- L2 — Explore (task mw1ozgw8-1-67vy): no `company_id` column (only some metadata), no read API, no DB append-only
  guard (API connects as DB owner `admin`), no login/logout endpoint, no IP/User-Agent handling outside the assessment
  rate limiter (`TRUSTED_PROXY_CIDRS`), no BFF↔API secret, members add/role/plain-remove unaudited (only offboard),
  contacts is JSON ≤100 (no CSV anywhere), next migration 00056. Draft written with D1–D7 open for the user.
- L3 — Draft b85ff82e. Frontend review F1–F6 applied: session calls bound to the NextAuth `jwt` callback (sign-in) and a
  server action before `signOut()`; no central BFF (~52 call sites → frontend helper + test), `peer` shown as «IP no
  verificada»; no React Query on detail (no change); `entity.label` resolved at read (+ CSV `entity_label`); new
  `GET …/audit-events/vacancies`; export count before the first byte in one REPEATABLE READ tx. Frontend carries D1–D7
  to the user.
