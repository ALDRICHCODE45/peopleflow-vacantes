# Saved vacancies («Vacantes guardadas»)

Candidates save public vacancies from the listing and the detail and manage them in `/candidato/guardadas`, grouped by
next step. Frontend in parallel with the backend session over `docs/contracts/saved-vacancies-v1.md`.
Approved design: `design/saved-vacancies/03-pendientes-primero.html` (01 and 02 are alternatives).

## Specs

- **S1** «la primera es la features de guardar vacantes a "Favoritas"»: the product name stays «Vacantes guardadas»;
  verb «Guardar» / «Guardada».
- **S2** «en "Vacantes guardadas" me gusta mucho el diseno numero 3»: implement artboard 03 «Guardadas como
  pendientes»: bookmark icon button joined to «Postularme» in the detail aside; bookmark at the end of the listing card
  footer; `/candidato/guardadas` grouped «Por postularte», «Ya te postulaste», «Ya no disponibles» (collapsed) with
  «Quitar las que ya no están disponibles» behind a confirmation, and the header summary «N guardadas · M por
  postularte».
- **S3** Visitor: tapping «Guardar» asks to sign in; «Sí, se guarda al volver»: on return to the same vacancy it is saved
  automatically.
- **S4** «Sí, 200»: at most 200 saved per candidate, validated by the backend; the UI explains the limit.
- **S5** Company accounts cannot save.
- **S6** Feedback per UI rules §12: busy state until the backend confirms; success toast only after confirmation;
  error toast fixed with «Reintentar» and the reference line; removal offers «Deshacer».
- **S7** «hay que coordinarse con el agente del backend para trabajar paralelamente tu en el frontend y el otro agente en
  el backend»; «Sin aprobación mía»: the agents agree the contract directly.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1–S7 | Contract draft + negotiation with the backend session (done, L7) | see branch |
| T2 | S2, S5, S6 | Save control on listing card and detail (client island, ids endpoint) | — |
| T3 | S3 | Visitor sign-in prompt and auto-save on return | — |
| T4 | S2, S4, S6 | `/candidato/guardadas` on real data (groups, remove, undo, bulk remove, empty) | — |
| T5 | all | Integration against the real backend, verification | — |

## Log

- **L1** (user, 2026-11-01): «Listo hermano, todo pusheado, ahora quiero tocar dos cosas/features que me pareces
  detalles importantes, la primera es la features de guardar vacantes a "Favoritas" y despues quiero revisar el tema
  del detalle de una vacante, ya que actualmente no aparece nada abajo, y debajo de el detalle suelen aparecer cosas
  como "Vacantes relacionadas" o cosas asi.. ( investiga por favor) por el momento solo eso.. me sigues? quiero
  propuestas de diseno de las dos cosas antes de implementarlo. recuerda tu system design y las reglas especificas de
  las que hemos hablaso.»
- **L2** Design `design/saved-vacancies/` with 01 Marcador discreto, 02 Botón con etiqueta, 03 Guardadas como
  pendientes.
- **L3** (user): «Bien, te doy mi respuesta, en "Vacantes guardadas" me gusta mucho el diseno numero 3, y en "Debajo del
  detalle" de igual forma me gusta mucho el diseno 3. estoy consiente de que debe incluir backend nuevo, hay que
  coordinarse con el agente del backend para trabajar paralelamente tu en el frontend y el otro agente en el backend,
  por favor. alguna duda?» Chosen artboard: 03-pendientes-primero.html; 01 and 02 are alternatives.
- **L4** (user answers): process «Sin aprobación mía»; visitor «Sí, se guarda al volver»; limit «Sí, 200»; order «Sí, el
  detalle primero» (vacancy-detail-explore goes first; this feature starts after the contract is agreed).
- **L6** (user): «me ire a dormir hermano, los dejo implementando, por favor, si me tienen que hacer preguntas de
  producto o de otra cosa, por favor haganlas ahora, no se detengan, implementenlo todo lo que puedan, mas vale que
  cuando regrese haga correcciones a que se paren toda la noche por una pregunta que no respondi por que estaba
  dormido.» Also: merges «No, dejalo en ramas»; local services «Sí, levantalos y apagalos al terminar». Contract draft
  sent to the backend session (01a196fa) by intercom.
- **L7** Backend session (01a196fa) agreed the contract with changes C1–C6 (legacy_salary in the snapshot, exact
  availability mapping, PUT evaluation order, limit counts closed rows, application id = participation id, strict
  bulk query) and answered Q1–Q3 (one table with a generated job_id, advisory lock, stable legacy published_at). The
  frontend accepted all; contract marked agreed. Backend implements on `feat/saved-jobs-backend`. T1 done.
- **L5** Exploration: no saved storage or endpoint exists in the backend; current Save controls are inert prototype
  placeholders; the real listing card and detail have none; `/candidato/guardadas` renders prototype fixtures.
