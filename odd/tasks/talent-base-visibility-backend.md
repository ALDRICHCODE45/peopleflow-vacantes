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
- [ ] T2 — S1, S2, S4.1, S4.2, S4.6: migration 00055 + GET/PUT + `can.view_talent_base` + audit. Route: worker
  (context backstop). Commit: —
- [ ] T3 — S3, S4.3–S4.5: pool gate (9 routes), write re-check, duplicate-check redaction, role change + offboard
  cleanup. Route: same worker after T2 (depends on its tables). Commit: —

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
