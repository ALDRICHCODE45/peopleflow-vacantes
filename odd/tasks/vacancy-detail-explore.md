# Below the vacancy detail («Empresa primero»)

Adds a region below the public vacancy detail `/vacantes/[jobId]` so people keep exploring: the company block with its
other vacancies, similar vacancies and related-search chips. No backend changes. Approved design:
`design/vacancy-detail-explore/03-empresa-primero.html` (01 and 02 are alternatives).

## Specs

- **S1** «debajo de el detalle suelen aparecer cosas como "Vacantes relacionadas" o cosas asi»; «en "Debajo del detalle"
  de igual forma me gusta mucho el diseno 3»: implement artboard 03 «Empresa primero» as drawn, in the existing
  detail. Everything already on the detail page (`PublicJobDetailView`) stays as it is (UI rules §21); only the new
  region and the mobile bar are added.
- **S2** Under the left content column (the sticky aside stays beside it): a «Sobre {Empresa}» card with the data the
  company publishes and compact rows of the company's other open vacancies (excluding the current one), with a link
  to all of them (careers site `/empresas/[id]` when published, else `/vacantes` filtered by company).
- **S3** «Mostrar solo sus otras vacantes»: when the company published no careers site or description, the block shows
  only name, logo and the list of its other vacancies; with no other vacancies and no published profile, it is omitted.
- **S4** Full-width «Vacantes similares»: up to 3 compact cards with the same `professional_area`, preferring the same
  `state`, excluding the current vacancy and the company's own; when fewer than 3 match in the state, fill from the
  area without the state; no area or no results → section omitted.
- **S5** «Sigue buscando» chips linking to `/vacantes` with canonical filters derived from the vacancy (area + state,
  area + remote, area + seniority, state); only chips whose filters exist on the vacancy.
- **S6** States: skeleton while the region loads (UI rules §11) without blocking the detail; a failed related read
  omits that section and never breaks the detail; optional public content may be omitted (design/system.md).
- **S7** Mobile (< lg): sticky bottom bar with «Postularme» (same apply link and same session rules as the aside:
  company accounts see «Las postulaciones son para cuentas de candidato»; legacy rows have no bar).
- **S8** Exact catalog parameters (confirmed in `backend/internal/features/jobs/application/publicjobs/catalog.go`
  `ParseQuery`): `company_id` (uuid), `limit` (1–50), `state` (repeatable), `professional_area` (single),
  `seniority`, `work_mode`. The frontend query type and adapter must forward `company_id` and `limit` for these reads
  without changing the `/vacantes` URL grammar.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S2–S6, S8 | Related reads (company, similar, company profile) + chip derivation, tests | — |
| T2 | S1–S3, S6, S7 | Region UI per artboard 03, streaming skeleton, mobile bar, tests | — |
| T3 | all | Verification: unit, types, lint, browser at 375/1440 light/dark | — |

## Log

- **L1** (user, 2026-11-01): «Listo hermano, todo pusheado, ahora quiero tocar dos cosas/features que me pareces
  detalles importantes, la primera es la features de guardar vacantes a "Favoritas" y despues quiero revisar el tema
  del detalle de una vacante, ya que actualmente no aparece nada abajo, y debajo de el detalle suelen aparecer cosas
  como "Vacantes relacionadas" o cosas asi.. ( investiga por favor) por el momento solo eso.. me sigues? quiero
  propuestas de diseno de las dos cosas antes de implementarlo. recuerda tu system design y las reglas especificas de
  las que hemos hablaso.»
- **L2** Design `design/vacancy-detail-explore/` with 01 Dos carriles, 02 Sigue explorando, 03 Empresa primero.
- **L3** (user): «en "Debajo del detalle" de igual forma me gusta mucho el diseno 3.» Chosen artboard:
  03-empresa-primero.html; 01 and 02 are alternatives.
- **L4** (user answers): «Sí, el detalle primero»; company block without published profile: «Mostrar solo sus otras
  vacantes»; merges: «No, dejalo en ramas» (branch `feat/vacancy-detail-explore`, no merge to main); local services:
  «Sí, levantalos y apagalos al terminar».
- **L5** (user): «me ire a dormir hermano, los dejo implementando, por favor, si me tienen que hacer preguntas de
  producto o de otra cosa, por favor haganlas ahora, no se detengan, implementenlo todo lo que puedan, mas vale que
  cuando regrese haga correcciones a que se paren toda la noche por una pregunta que no respondi por que estaba
  dormido.» Open choices are decided reasonably and recorded here.
- **L6** Evidence: `listJobs.ts` forwards `buildJobsUrl`, whose `JobsQuery` drops `company_id` and `limit` (worker
  finding during design); the backend accepts both (S8).
