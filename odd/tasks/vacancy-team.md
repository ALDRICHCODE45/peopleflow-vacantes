# Vacancy team and assignment («Asignación de la vacante»)

A vacancy is worked by a team of 1..N recruiters with assignment periods (tramos); the owner reassigns the responsible,
the responsible manages collaborators, and placement credit follows the team mode. Frontend over
`docs/contracts/vacancy-team-v1.md` (backend session, worktree `peopleflow-vacantes`); product source
`docs/product/next-three-features.md` §1. Feature 1 of 3 (then 1b talent-pool visibility, 2 audit, 3 stakeholder).

## Specs

- **S1** Team of 1..N recruiters per vacancy: «una vacante este asignada a mas de un reclutador, por vacante, y que
  puedan trabajar en conjunto para llegar a las metas, y aqui, importa mas que nunca la auditoria». Each member holds a
  tramo (continuous stay) with functions inside it; the vacancy workspace shows the team and its history.
- **S2** Electable mode per vacancy: «considero que es interesante que esto sea elegible, que pueda o no haber un
  responsabe mas colaboradores». Credit: «si hay un responsable asignado mas colaboradores, entonces el credito directo
  del placemente es del responsable y los demas son participantes en el placement", y si no se asigno un responsable,
  entonces el credito es de todos». Default at creation: with responsible, the creator is the responsible (Q2).
- **S3** Permissions: «las cosas que "solo pueda hacer el owner" se limiten a las acciones mas sencibles y especificas,
  no a cada cosa que consideremos "importante"»; «Sumar o sacar colaboradores los puede hacer el responsable». Owner
  only: reassign the responsible, change the mode, remove another member in a team without responsible («1. estoy de
  acuerdo, que el owner saque. 2. si, el owner.»). The responsible cannot leave on their own; a collaborator can
  («3. estoy de acuerdo tambien con lo que dices.»). The UI never derives permissions: it renders `viewer.can.*`.
- **S4** Reassignment: «el motivo es obligatorio de una lista y la opcion de otro con nota»; state snapshot at the change
  («si, eso es lo que quiero»); «asi es, solo el owner». The owner chooses whether the previous responsible stays as a
  collaborator; default «sale de la vacante» (Q10).
- **S5** Deadlines: the recruiter deadline is optional; when unset it falls back to the client commitment date (Q7).
  After publication the commitment date changes only by renegotiation with a reason from the list (pedido del cliente,
  cambio de alcance, retraso interno, otro con nota), done by the team (Q8).
- **S6** Leaving placement (move or discard) asks for the credit's fate: «Lo moví por error» voids the credit; «El
  candidato renunció / no se presentó / se cayó después» keeps it as «placement que no se sostuvo». Discard asks for
  both its own reason and this one. The owner can void / restore a credit afterwards (Q6).
- **S7** Removing a company member who is the responsible of non-finished vacancies runs «Reasignar sus vacantes a…»
  (one person for all, or per vacancy), reason «baja del reclutador», as one operation (Q5).
- **S8** The recruiter who leaves loses the vacancy; their work stays attributed; they see their own tramo summary
  without candidate data («Vacante X, tu tramo del 1 al 12, entregaste 8»). A request after losing access shows that
  access ended, not «la vacante no existe» (`team_access_ended`).
- **S9** All remaining decisions: «si hermano, voy con esas.» (Q2–Q4, Q7–Q12; no team size limit; no notifications in
  v1).

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1–S9 | Contract review with the backend session (done, L4) | — |
| T2 | S1–S8 | Design directions (gentle-design) for team panel, reassign dialog, offboard flow, placement exit, own history; user picks | — |
| T3 | S2, S5, S6 | Breaking changes: `team` in draft list/read, `placement_exit_reason` in move/discard, commitment 409 on delivery PUT | — |
| T4 | S1–S5 | Team panel in the vacancy workspace: read, add, remove, leave, deadline, mode, reassign responsible, history | — |
| T5 | S6 | Placement credit in participation detail + owner void/restore | — |
| T6 | S5 | Commitment renegotiation dialog | — |
| T7 | S7 | Offboard flow in Equipo (preview + reassign + remove) | — |
| T8 | S8 | Own tramo history view and `team_access_ended` handling | — |
| T9 | all | Integration against the real backend, verification | — |

## Log

- **L1** (user, 2026-11-02, original request): «Bien hermano, quisiera discutir contigo la siguiente funcionalidad de
  este sistema, ... 3 Y lo tercero es sobre la reasignacion de una vacante, no se si eso ya lo habiamos platicado o no,
  pero es importante, hay muchas veces que el reclutador ya no puede, o esta quedamo sobre la vacante, y se decide
  hacer el cambio, y puede a priori, parecer algo sencillo, pero hay muchas cosas que considerar, es decir, el primer
  reclutador ya tenia avance, ya habia subido candidatos, YA HABIA USADO TIEMPO de su fecha de entrega de candidatos,
  hay que tener todo eso bien capturado, es decir, hay que pensar bien, en la reasignacion, se va a cambiar tambien el
  tiempo maximo de entrga, que tiempos se van a cambiar, el tema de la auditoria, que se quede guardado, cuando cambio,
  a quien se reasigno, quien la tenia, el estado de la vacante antes de cambiar de reclutador, y tambien deberia de
  tener un apartado propio para analiticas/dashboard que sirve igualmente para la vista del stake holder, que pueda ver
  no se... un promedio de cuantas veces un reclutador tiene que dejar su vacante y reasignarla a otro reclutador, que
  vacantes se han reasignado, cuantas veces, a que reclutador, me sigues??» (full text: product doc and Engram
  `product/next-three-features-2026-11`). Order agreed: assignment → audit → stakeholder.
- **L2** (user): placement credit to the recruiter assigned at placement; multiple recruiters per vacancy; mandatory
  reason; snapshot; owner only reassigns; «este sistema aun no esta en produccion, no tiene datos reales ... toda la
  data que hay ahora, es data de desarrollo, no es data real de produccion, es desechable».
- **L3** (user): modes electable, credit by mode, responsible manages collaborators, owner-only list approved. Q1/Q5/Q6
  decided directly with the backend session; Q2–Q4, Q7–Q12: «si hermano, voy con esas.»
- **L4** Backend wrote `docs/contracts/vacancy-team-v1.md` (branch `docs/vacancy-team-contract`, uncommitted pending
  user authorization). Frontend review points 1–7 answered: members list is recruiter-readable (membership id ≠ user
  id); participation detail gains `placement_credit` + `can.void_credit/restore_credit` and a credits list; discard
  out of placement asks for both reasons; tramo = continuous stay with `functions[]` (mode change no longer splits);
  `GET /company/members/{id}/offboard-preview`; 404 `team_access_ended`; ETags stated. T1 done.
- **L5** Data is disposable; the contract's backfill keeps dev data usable. Talent-pool visibility (1b) and
  notifications (Q12) are out of scope, recorded in the backlog/roadmap.
- **L6** T2 design proposals under `design/vacancy-team/`: `01-equipo-configuracion.html` (S1–S5, list/detail),
  `02-franja-y-panel.html` (S1–S5, pipeline strip + sheet), `03-equipo-e-historia.html` (S1–S5, team + timeline),
  `04-reasignar-responsable.html` (S3–S5), `05-placement-y-credito.html` (S6),
  `06-renegociar-compromiso.html` (S5), `07-baja-y-mis-tramos.html` (S7–S8). Manifest `design.json` links this feature;
  per-artboard token self-check and limitations are in `self-check.md`. 01–03 are alternatives awaiting the user's
  choice; 04–07 complement any direction. No production implementation. Canvas `list`/`open` and rendered visual
  verification remain pending because this worker does not expose `gentle_design`; the parent must open slug
  `vacancy-team` and report the returned URL.
