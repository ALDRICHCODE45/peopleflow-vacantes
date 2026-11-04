# Talent base visibility — backend (unit 1b)

Backend half of the frontend `feat/talent-base-visibility`. Contract: `docs/contracts/talent-base-visibility-v1.md`
(agreed 2026-11-04). Branch `feat/talent-base-visibility-backend` from main aa270e5c.

## Specs

- S1 — Setting (user, verbatim): «Ajuste de empresa, solo owner, auditado: «Base de talento visible para» = «Todos los
  reclutadores» (por defecto, como hoy) o «Usuarios seleccionados» con selector de miembros.»
- S2 — «El owner siempre la ve; el stakeholder (funcionalidad 3) también.»
- S3 — «Un reclutador fuera de la lista sigue viendo, desde el tablero, a los candidatos de las vacantes donde tiene un
  tramo activo. Pierde la búsqueda global, el detalle fuera de una vacante, los CV de la base y la exportación de
  contactos.»
- S4 — Frontend needs (verbatim): «1. GET/PUT del ajuste (forma, ETag/If-Match, errores de validación: miembro
  inexistente, owner en la lista, lista vacía con modo seleccionados, etc.). 2. Un flag de capacidad en algo que ya
  leemos al entrar (sesión/empresa/miembro), tipo can.view_talent_base, para ocultar la entrada «Base de talento» sin
  pedir un 403 primero. 3. Qué devuelven exactamente las superficies cerradas (búsqueda, detalle, historia, ediciones,
  CV, export) para el reclutador fuera de la lista: código y error code (¿403 talent_base_restricted o 404?). 4.
  Confirmación de que el detalle/CV/historia desde el tablero (rutas de vacante) no cambian para quien tiene tramo
  activo. 5. Qué pasa con la lista al quitar un miembro de la empresa (se limpia sola) y si el modo «seleccionados» con
  lista vacía es válido (solo el owner la ve). 6. El evento de auditoría (tipo y metadata con IDs, sin datos
  personales).»

## Tasks

- [x] T1 — S1–S4: contract draft, frontend/user OK on D1–D3, commit. Route: inline. Commit: 8ea05adc (amend: next
  docs commit).
- [x] T2 — S1, S2, S4.1, S4.2, S4.6: migration 00055 + GET/PUT + `can.view_talent_base` + audit. Route: worker
  (context backstop). Commit: 013096fa.
- [x] T3 — S3, S4.3–S4.5: pool gate (9 routes), write re-check, duplicate-check redaction (incl. manual 409), role
  change + offboard cleanup. Route: same worker after T2. Commit: 18d830bc. Verify: pending (security).

## Log

- L1 — User via the frontend session (2026-11-04), authorization verbatim: «Sí, arrancá la 1b». Frontend request: the S4
  list above, plus «proponé el contrato (por ejemplo docs/contracts/talent-base-visibility-v1.md, mismo estilo que
  vacancy-team-v1.md) y avisame cuando esté para revisarlo.»
- L2 — Explore (task mw1ei04w-1-kvny): 9 pool routes in one group with no per-user check; manual-intake duplicate check
  is the one vacancy route that reads the pool company-wide; no `can` object exists; `GET /me/company` is the entry read.
  Contract drafted with decisions D1 (empty selection valid), D2 (redact `last_vacancy` in duplicate check), D3 (403).
- L3 — Frontend review «me cierra tal cual». User (verbatim, via frontend): D1 «Sí, es válido», D2 «Aviso sin la última
  vacante», D3 «Mensaje claro». «Podés commitear el contrato e implementar.» Frontend builds against fixtures; ping when
  ready to integrate.
- L4 — Contract amended while mapping the implementation (parent): `validation_error` keeps the shared 400; no backfill
  — an absent settings row means `all_recruiters` v1 and is created on demand by the first PUT or re-checking write
  (`updated_at`/`updated_by` null until saved); plain DELETE member emits no event (only POST offboard gains
  `talent_base_viewer_removed`). Frontend informed. Parent context hit the backstop → T2+T3 delegated to one worker.
  Implementation map for the worker (parent, from reads): pool routes `cmd/api/router.go:340-348`; writes that must
  re-check inside their tx: `postgres/pool/edits.go:19` (Edit), `corrections.go:21` (EditOrganic), `cv.go:17`
  (CorrectCV); duplicates `postgres/board/duplicates.go` (`readManualDuplicates`, null `LastVacancy`/`LastAddedAt`);
  role change `companies/infrastructure/postgres/companyMemberRepository.go:126` (`UpdateRole` → `mutateMember`, the
  write callback only gets `*db.Queries`); offboard `jobs/infrastructure/postgres/draftstore/offboard.go:348-353`;
  entry flag `companies/infrastructure/http/memberHandler.go:177,382` (`myMembershipResponse`); ETag pattern
  `companysites/infrastructure/http/handler.go:19,62-111`; error catalog `internal/shared/httpjson/errors.go` +
  `team_errors.go`; audit `audit_events/domain/entities/auditEvent.go` (`EntityCompany`); route inventory test
  `cmd/api/main_test.go` (~1645); integration harness `cmd/api/draft_flow_integration_test.go:257` (also wire there);
  manual intake fixture `cmd/api/manual_create_flow_integration_test.go`. No `sqlc` binary: raw SQL on the tx.
- L5 — Worker found the manual-intake 409 `possible_duplicates` leaks the same matches; parent widened its surface
  (D2 applies) and amended the contract (984cc378); frontend tolerates nulls (its b95c68e4).
- L6 — Worker mw1flnah-2-rk8w done (tree left uncommitted by rule; parent split and committed T2 013096fa — compiled,
  vetted and unit-tested alone in a scratch worktree — and T3 18d830bc). Worker checks: gofmt/build/vet clean; unit 105
  ok, 1 FAIL (known scripts/closure); integration 98 ok, 2 FAIL (TestPublicGeoSearchIndexCapability, passes alone =
  L19 geo; TestDisposablePostgresBootstrap needs a loopback DATABASE_URL). Deviations recorded in the contract (412
  body keys + error/code, field codes, check order, sorted audit ids, cleanups do not bump the version). Slice is
  ~2.2k lines over 2 feature commits (T2/T3 separate; T3 is the high-risk security unit).
- L7 — Frontend fixed its strict 412 schema (its 352eeac2) and asked for QA. API :8081 from detached worktree
  `.scratch/api-tb` @ 7c788d72 (binaries `.scratch/qa-api-tb-bin`, `.scratch/qa-migrate-tb-bin`; PID
  `.scratch/qa-api-tb/api.pid`, log `.scratch/qa-api-tb/api.log`), DB `peopleflow_vacancies_team` migrated 54 → 55, usual
  .env (Cognito). :8080 not running. Only the owner (Test User) can sign in; Ana López (1 active tramo) and Diego
  Hernández are QA seeds without login → a recruiter-side 403 check needs a second real Cognito account (user's call).
  Teardown: kill the PID, `git worktree remove .scratch/api-tb`, delete the two binaries.
