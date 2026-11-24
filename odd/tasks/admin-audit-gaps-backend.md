# Administration audit gaps (backend, low-risk subset)

Additive backend fields requested by the frontend's overnight audit D. Branch `feat/admin-audit-gaps-backend`
(worktree `../peopleflow-vacantes-admingaps`). Only the low-risk read/metadata items run tonight; D2 (invite
recruiters), D3 (company edit + logo upload) and D15 (audit CSV headers/labels) wait for the user's decisions.

## Specs

- **S1** D5 (verbatim): «En Equipo, la «Carga» de cada miembro se calcula con los borradores de quien mira; un
  reclutador ve «Sin vacantes asignadas» en colegas que sí tienen. Propuesta: `workload: {active_vacancies}` por
  miembro en el GET del equipo.» Backend: each member of the company team GET carries
  `workload: {"active_vacancies": int}` = vacancies of the company where that member holds an open team assignment
  and whose process is active (not finished), independent of who is looking. Always present. It reveals only a count,
  never titles.
- **S2** D20 (verbatim): «Las pestañas de la lista de vacantes del stakeholder muestran «20+». Si sumás
  `counts_by_status` (exactos o con tope) en la primera página, muestro números exactos.» Backend: the first page
  (no cursor) of `GET /v2/me/company/stakeholder/vacancies` carries `counts_by_status`: exact counts over the same
  scope for the tabs the frontend uses (Todas/Borradores/Activas/Pausadas/Cerradas — derive the buckets from the
  publication/process values the rows already use and document the mapping); pages with a cursor omit it or send
  `null` (document which).
- **S3** D11 (verbatim): «Las invitaciones pendientes no se distinguen entre sí. Propuesta: `note` opcional (≤80) al
  crear el enlace, devuelto en la lista y en el «Sobre» de la auditoría.» Backend: optional `note` (trimmed, 1..80
  runes, NFC, no control characters; empty/absent = null) on stakeholder invitation creation, stored, returned in the
  invitation list and creation response. NOT copied into audit metadata (the audit catalog allows only ids/enums;
  the frontend can show the note from the invitation list) — record as a deviation from the proposal.
- **S4** Everything additive: existing responses, gates and tests unchanged except key-count pins.

## Tasks

- T1 S1, S2, S3 — writer — pending
- T2 — suite, merge, notify frontend — pending

## Log

- **L1** 2026-11-22, user: «Bien hermano, vamos a realizar todos los pendientes que mencionas por favor, coordinate con
  el frontend para realizar lo que se tenga que realizar (tu haciendo el backend y el haciendo el frontend)».
- **L2** 2026-11-24, frontend overnight audit D (relays that the user, asleep, authorized coordinating backend gaps):
  items D2, D3, D5, D11, D15, D20. Tonight: D5, D20, D11 (additive, low risk). Waiting for the user: D2 (new way to
  grant recruiter membership: security), D3 (company edit + logo upload; SVG is a script vector), D15 (changes CSV
  headers users already consume).
