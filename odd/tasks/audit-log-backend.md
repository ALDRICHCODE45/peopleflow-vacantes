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

- [x] T1 — S1–S4: contract draft `docs/contracts/audit-log-v1.md`, frontend review, user decisions. Route: inline
  (after one explore map). Commit: b85ff82e, b592a04a, agreed in the next docs commit.

Slice 2a — capture (contract §1–§7, §9). High risk (append-only trigger, shared secret, every emitter): own commits.

- [x] T2 — S2, S4.5–S4.7: migration 00056 (columns `company_id`, `vacancy_id`, `ip`, `user_agent`, `ip_source`,
  indexes, backfill, append-only trigger with the purge exception), test helper for audit cleanup. Route: parent
  (migration + RED/GREEN) + worker mw1pf97d (28 test cleanups). Commit: next feat commit.
- [x] T3 — S2, S4.4: request-context middleware + `AUDIT_PROXY_SECRET`, shared IP helper (out of the rate limiter),
  adapter writes `ip`/`user_agent`/`ip_source`. Route: worker mw1r96q7 (context backstop). Commit: next feat commit.
- [x] T4 — S2, S4.5, S4.7: `CompanyID`/`VacancyID` on every emitter (incl. raw SQL ones), event catalog constants +
  categories, test: no employer-side type with null `company_id`, allowed metadata keys per type. Route: worker
  mw1rxaxp. Commit: next feat commit.
- [x] T5 — S1, S2, S4.1–S4.3: sensitive reads (§2), `POST /v2/me/session/start|end` (§3), member events (§5), route
  inventory. Route: worker mw1tpt8l. Commit: next feat commit.
- [x] T6 — verify 2a (independent, security) + full integration. Route: gentle-ai-verify mw1vk451; MINOR 1 fixed
  inline (RED/GREEN), probes committed. Commit: next fix commit.
- [ ] T7 — QA :8081 with the frontend end-to-end (its T4), then the user's merge decision.

Slice 2b (§8 read API, export, retention purge) is cut after 2a merges.

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
- L4 — User decisions via the frontend (2026-11-04, verbatim): D2 «24 meses (Recomendado)»; D5 «Solo el owner
  (Recomendado)»; D1, D3, D4, D6 y D7: «Sí, todas como recomiendan (Recomendado)». Contract → agreed. Frontend
  starts its 2a on `feat/audit-log`. `AUDIT_PROXY_SECRET` (random 32 bytes hex) appended to `backend/.env`
  (gitignored); the frontend reads the value from that file.
- L5 — T2: RED `TestMigration00056AuditLog` (column company_id missing) → GREEN. Test cleanups use
  `audittest.Delete` (SET LOCAL session_replication_role = replica, superuser test roles only); two legacy tests that
  recreate audit_events with the 00011 DDL now append `audittest.RestoreAppendOnlyDDL` (hand copy of 00056 — keep in
  sync). Worker checks: gofmt/build/vet (+integration tag) clean; unit 105 ok, 1 FAIL scripts/closure (known);
  integration (DATABASE_URL = disposable `draft_test_legacy` in pf-draft-test) 105 ok, 3 FAIL: scripts/closure,
  identity/postgres `TestUsersMigrationDownDropsTable` and the cascading jobs/postgres failures — both reproduced on the
  base commit by the worker (pre-existing, not audit). Recreate `draft_test_legacy` before reuse. Frontend 2a done
  (40a4a825, 1b39c7a4), secret in frontend/.env.local.
- L6 — Slice boundary: 2a is delivered as one commit per task on this branch (T2 schema/trigger, T3 request context,
  T4 emitters, T5 new events), each reviewable alone; the branch merges after T6. Frontend 2b screen built on fixtures;
  export validation pinned in the contract (b9a0d07b).
- L7 — T3 (worker mw1r96q7): `internal/runtime/clientip` (shared, full addr; limiter keeps /64 + "invalid" bucket,
  PRESERVE test added), `internal/runtime/requestmeta` (sha256 + subtle compare, unset secret = never trusted, UA →
  valid UTF-8 ≤512 bytes, IPv4-mapped → IPv4, zone dropped), mounted 2nd in the root `r.Use` (AST pin now 4 args +
  `TestProductionComposition_RequestMetaWired`); adapter writes the five columns; sqlc output hand-edited (no binary).
  Checks: gofmt/build/vet clean; unit 107 ok, 1 FAIL scripts/closure (known); integration audit_events, runtime,
  cmd/api ok. Gotcha: goose CLI auto-loads backend/.env (dev DB) — pass `-env=none` with an explicit DSN.
- L8 — T4 (worker mw1rxaxp): catalog of 63 types (53 emitted + 10 pre-registered for T5/2b), `Append` validates
  (unknown type, company-scoped without company, metadata key outside the set) before any SQL. Raw-SQL pool emitters now
  use the port (`pool.NewStore(pool, audit, stageNames)`). §7 findings: VacancyDeliveryFulfilled embedded candidates'
  full_name, ParticipationChecklistMarked the note text — both reduced to IDs/enums. Parent decision: keep the config
  snapshots (company configuration, not personal data); contract §7 amended with that exception. Checks: gofmt/build/vet
  clean; unit 107 ok, 1 FAIL scripts/closure; full integration 107 ok, 3 FAIL = the known scripts/closure,
  identity/postgres down-test and its jobs/postgres cascade. archguard: 2 violations in files unchanged vs main
  (pre-existing). One flaky `TestPublicGeoSearchIndexCapability` on the first run, green on rerun.
- L9 — T5 (worker mw1tpt8l): RED 0 rows/404 → GREEN through HTTP for §2, §3, §5. Findings folded into the contract:
  no 304 path exists (every read is 200 + row); session body not read; contacts writes only revealed candidates and no
  row when none; pool CV rows carry vacancy_id; `DELETE /me/company/members/{id}` wrote no audit before (now
  `CompanyMemberOffboarded`); plain `removeMember` unreachable in production but audits too. Changed tests on purpose:
  `TestTalentBaseVisibility_RemovingAMemberDropsTheViewerAndAuditsIt`, three `*AtomicRollback`, `TestManualCreateHTTPFlow`
  snapshot. Checks: gofmt/build/vet clean; unit 108 ok, 1 FAIL scripts/closure; full integration 108 ok, 3 FAIL = the
  known three; archguard same 2 pre-existing.
- L10 — Verify (mw1vk451) on 00ddbe97: §1–§7 and §9 met, S1/S2/S4.1–S4.7 met for 2a, no BLOCKER/MAJOR; checks equal to
  L9 (108 ok, 3 known FAIL). MINOR 1 — the purge flag also opened on a session-level SET. Parent: RED (session-level
  'on' deleted the row) → flag bound to `txid_current()` (00056 edited in place, unmerged) → GREEN; contract §6 updated.
  MINOR 2 (audittest importable by production code; none does) and MINOR 3 (requestmeta before Recoverer, cosmetic)
  left as follow-ups. Verifier probes committed: `requestmeta/verify_probe_test.go`,
  `cmd/api/verify_probe_audit_integration_test.go` (both pass). Scratch to drop: DBs `verify2a_legacy`,
  `verify2a_probe`, `verify2a_mig`, `draft_test_legacy` in pf-draft-test; the shared `draft_test` DB still carries the
  pre-fix trigger body (migrated before the edit) — recreate it or re-run 00056 down/up before relying on the purge there.
- L11 — Cleanup: dropped `verify2a_*` and `draft_test_legacy`; `draft_test` function body replaced with the fixed one
  (CREATE OR REPLACE). QA: API :8081 from the main worktree's backend/ (binary `.scratch/qa-api-al-bin` built at
  94b54553, log `.scratch/qa-api-al/api.log`, background job job-2), `backend/.env` + DATABASE_URL =
  `peopleflow_vacancies_team` (migrated 55 → 56 with `.scratch/qa-migrate-al-bin`). Dev DB still at 55. Teardown: stop
  job-2, delete both binaries.
- L12 — 2026-11-04: the QA process died with the session restart (log ends with no error). Restarted the same binary on
  :8081 (background job job-1 of the new session, log appended); readyz 200, DB at 56. :8080 holds another `api`
  process not started by this session, left untouched. The user runs the frontend's T4 against the production build.
- L13 — Frontend T4 on :8081 (prod build): 8 rows, parent confirmed in the DB — all `ip_source=bff`, ip `::1`
  (local loopback, expected), real browser UA, company_id set; vacancy_id on pool CV, ParticipationViewed and both
  ParticipationCVDownloaded, null on pool detail/contacts (as §1/§2). Pending: SessionStarted (the session was
  already alive, no sign-in callback) and SessionEnded (frontend bug: the employer sidebar hid «Cerrar sesión», being
  fixed) — to be repeated with a real login/logout.
- L14 — Frontend fixed the sidebar sign-out; parent confirmed in the DB: SessionEnded 16:39:30 and SessionStarted
  16:39:57 (Mexico City), entity `user`, `bff`, `::1`, company_id set, metadata `{}`. Slice 2a verified end to end.
  Next: the user's merge decision for 2a; then slice 2b (list, types, actors, vacancies, export, purge).
