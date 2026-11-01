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
| T2 | S2, S5, S6 | Save control on listing card and detail (client island, ids endpoint) | see L8 |
| T3 | S3 | Visitor sign-in prompt and auto-save on return | see L9 |
| T4 | S2, S4, S6 | `/candidato/guardadas` on real data (groups, remove, undo, bulk remove, empty) | see L11 |
| T6 | S2 | `/candidato/postulaciones?postulacion=<id>` selects that application (link target of «Ver postulación») | see L12 |
| T5 | all | Integration against the real backend, verification | see L14 |

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
- **L8** T2 (worker mvxt6q2g): `features/saved-vacancies/{model,client,actions,queries,feedback,save-control}` with
  all five endpoints behind the CV-style server-action session boundary; footer bookmark on PublicVacancyCard and a
  joined bookmark with «Postularme» in the detail aside (legacy rows: bookmark below the note). Parent rerun: 72
  tests pass (46 new + 26 existing card/detail unchanged); tsc, eslint and diff check pass. T3 seam:
  `onVisitorSaveT3(jobId, returnTo)`; T4 API: `loadSavedJobsAction`, `removeSavedJobAction`,
  `removeClosedSavedJobsAction`, `saveJobAction`. Contract clarifications (fields envelope, job_id asc tie, messages)
  applied.
- **L9** T3 (workers mvxts9ca + mvxu6gg4): visitor popover `visitor/save-prompt.tsx` with candidate auth links whose
  `next` carries `?guardar=<jobId>`; on return as candidate one save runs (module-level in-flight set across
  controls), the param is cleared only after the save settles (a reload mid-request repeats the idempotent PUT, never
  a duplicate). The jsdom hang was the Base UI positioner; tests follow the psychometrics popover pattern (§13.7).
  Parent rerun: 55 saved-vacancies tests pass; tsc, eslint, diff check pass. Browser check of Escape/outside
  click/focus pending (T5).
- **L10** Backend candidate on `feat/saved-jobs-backend` (51ff88f4 migration 00053 + store, 2eed86a0 endpoints,
  `backend/docs/saved-jobs.md`); its verification and native review are still running. T5 recipe (disposable DB, never
  the user's dev DB): `docker run --rm -d --name pf-fe-int -e POSTGRES_USER=pf -e POSTGRES_PASSWORD=pf -e
  POSTGRES_DB=pf -p 127.0.0.1:<port>:5432 postgres:16`; `cd backend && DATABASE_URL='postgres://pf:pf@127.0.0.1:<port>/pf?sslmode=disable'
  go run ./cmd/migrate up`; local identity per `backend/docs/local-identity-bootstrap.md`; API with that
  DATABASE_URL and an isolated PORT; no seed: PUT a public id from GET /v2/jobs; close a vacancy from the employer
  side for a closed row; `docker stop pf-fe-int` afterwards.
- **L11** T4 (worker mvxufx8a): real `/candidato/guardadas` grouped Por postularte / Ya te postulaste / Ya no
  disponibles (bulk remove behind AlertDialog), remove + Deshacer, limit notice, loading/empty/error; «Ver
  postulación» → `applicationHref(id)` = `/candidato/postulaciones?postulacion=<id>` (parent decision; T6 makes the
  list honor it). Parent rerun found a regression from T3: the per-card control used useRouter/useSearchParams and
  broke existing card/detail suites (66/927 failing); layout.test.tsx mocked identity without `user` (test fix). Fix
  (workers mvxv8hc2, mvxvaawx, mvxwbv41, mvxwdsl8): one `SavedJobReturnIntent` per page (listing page + detail
  control), controls without router hooks and safe in isolated renders, the listing canonical redirect keeps
  `guardar`; guardrails: outline buttonVariants through cn, `saved-vacancies/client.ts` added to the requestPath fetch
  allowlist with its guards (shared `requestJson` untouched: it cannot represent bodyless 204, same as
  candidate-applications/vacancy-checklist). Evidence (Node 22): full suite `--no-file-parallelism` 9103 passed, 0
  failed, 1 skipped, two runner onTaskUpdate errors without a file; parent rerun 135/135 on guardrails + saved +
  layout + listing; tsc and eslint pass. The parallel batch timeout in profile-workspace.test.tsx passes alone and
  sequentially (known load-sensitive class).
- **L12** T6 (worker mvxxgtwj): page reads `searchParams.postulacion` → `initialApplicationId`; a matching application
  is the initial selection (mobile opens its detail; unread messages are marked read as on a manual open); unknown ids
  keep the default; the URL is left untouched (documented). RED 5 → GREEN; parent rerun 210/210 (workspace,
  postulaciones page, layout, candidate-applications); tsc and eslint pass; no visual change.
- **L13** Backend closed: `feat/saved-jobs-backend` final code commit 2eed86a0 (store 51ff88f4; tip adds docs only);
  independent verification PASS S1–S9; native assess medium, no review due. Not merged to main. T5 starts.
- **L14** T5 (workers mvy9k9en/mvy9p5de): backend native review APPROVED (risk, resilience, reliability; one
  non-blocking warning on the migration Down). Integration against 2eed86a0 on a disposable Postgres with the backend's
  local PEM JWT mode (no Cognito, no user .env): 65 HTTP exchanges match the contract (201/200 replay, every 404 case,
  job_unavailable, 204 idempotent DELETE, bulk with the `fields` envelope, ordering, availability incl. pause/resume,
  application, snapshots equal to the catalog, limit at 200 incl. closed, concurrent 199 → one 201 + one 409, 401/403,
  no-store). 22 real bodies committed as `fixtures/real-responses.json` (synthetic data, no tokens) and decoded through
  model.ts and the client mapping (24 tests; one live probe skipped without a token). No frontend or backend defect
  found. Cleanup confirmed (API, container, temp worktree, keys; ports free). NOT verified: browser flows (the Next
  session cannot carry a local token without code changes) — visual and interactive acceptance of S2–S6 and the S3
  sign-in return remain for the user.
- **L5** Exploration: no saved storage or endpoint exists in the backend; current Save controls are inert prototype
  placeholders; the real listing card and detail have none; `/candidato/guardadas` renders prototype fixtures.
