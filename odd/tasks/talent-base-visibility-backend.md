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

- [ ] T1 — S1–S4: contract draft, frontend/user OK on D1–D3, commit. Route: inline. Commit: —
- [ ] T2 — S1, S2, S4.1, S4.2, S4.6: migration 00055 + GET/PUT + `can.view_talent_base` + audit. Route: TBD. Commit: —
- [ ] T3 — S3, S4.3–S4.5: pool gate (9 routes), write re-check, duplicate-check redaction, role change + offboard
  cleanup. Route: TBD. Commit: —

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
