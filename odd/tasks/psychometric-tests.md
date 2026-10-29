# Psychometric tests F1 (job-linked assessment inside PeopleFlow)

In-product psychometric assessment linked to the vacancy: job psychometric profile, IPIP-NEO-120 with telemetry,
tracking in the pipeline, consent, practical result with focus areas and an AI interview guide. Branch
`feat/psychometric-tests` (from main 40002dfb). Discovery and sources: `odd/discovery/psychometric-tests.md`.
Rules: UI follows `docs/frontend-ui-design-rules.md` (shadcn first, §2 decision order, §3 tokens, §10 visual
presence, §16 design for the decision, §21 validated design is not changed while implementing) and `design/system.md`;
artboards under `design/<slug>/` on the gentle-design canvas before any UI code. Contract owned by the frontend
(`docs/contracts/psychometric-tests-v1.md`), reviewed by the backend session (worktree `peopleflow-vacantes`) before
implementation; the user pushes.

## Specs

- **S1 Value beyond a quiz.** «no quiero que sea algo generico/comun o simplemente una feature de un examen donde se
  responden las preguntas y ya, quiero algo mas alla, realmente quiero que sea una feature con mucho valor para el
  proceso de reclutamiento (en caso de necesitarse) porque realmente no en todos los procesos de seleccion van a
  necesitar un examen psicometrico completo». Assessment is optional per vacancy, never on by default.
- **S2 Job psychometric profile.** Recruiter (L5): «Comparar el perfil con la vacante: que me ayude a identificar qué
  tan alineado está el candidato con las competencias que realmente requiere la posición, sin limitarse a decirme si es
  apto o no apto.» Employer-only module in the vacancy configuration: competencies with importance, suggested from the
  vacancy; the result shows fit per competency, never «apto / no apto».
- **S3 Instrument.** User: «creo que lo mejor es usar ipip», then chose «Corregir traducción + quitar Liberalismo»
  (L10). IPIP-NEO-120 without facet O6 Liberalism (29 facets, 116 items), in our corrected Mexican Spanish version
  reviewed by the user or the recruiter, plus attention and consistency items scored apart from personality. Recruiter: «Dar resultados confiables y objetivos: que las pruebas
  estén validadas, tengan criterios claros y reduzcan los sesgos, en lugar de etiquetar a las personas con base en un
  resultado aislado.»
- **S4 Telemetry as signals, not verdicts.** User: «median muchas cosas, tiempos de respuesta, si cambias de respuesta,
  si borras y luego vuelves a ponerlo». Response times and answer changes are recorded and shown as grouped consistency
  signals to explore in the interview, never as «mintió».
- **S5 Practical interpretation.** Recruiter: «Traducir los resultados en información práctica: no solo decirme que
  alguien tiene liderazgo, sino explicarme cómo podría reflejarlo en el trabajo, cuáles son sus fortalezas y qué áreas
  tendría que desarrollar.» Texts come from an authored library per competency and level (user chose «a) como base»):
  the same scores always give the same text. Levels are bands by meaning of what the candidate stated (user chose
  «Bandas por significado», L10), never percentiles against foreign norms. Competencies are our own catalog; the
  link between traits and competencies is presented as a hypothesis to explore in the interview.
- **S6 Focus areas.** Recruiter: «Identificar focos de atención: posibles áreas de riesgo, incompatibilidades con las
  exigencias del puesto o aspectos que valdría la pena profundizar durante la entrevista, sin convertirlos
  automáticamente en motivos de descarte.» The assessment never rejects, discards or moves a candidate.
- **S7 Clear for non-specialists.** Recruiter: «Ahorrar tiempo: que el reporte sea claro, visual, fácil de interpretar
  y que no tenga que ser especialista en psicometría para entender qué significan los resultados.» Result lives in the
  candidate sheet, not only in a document.
- **S8 Interview guide.** Recruiter: «Generar preguntas de entrevista personalizadas: que, con base en los
  resultados, me sugiera qué preguntarle al candidato para validar o profundizar en ciertas competencias.» User chose
  «Banco redactado en F1, IA en F2» (L10): F1 picks questions from an authored bank by competency, band and focus
  area (deterministic, no AI); each question cites the competency and band that originates it. AI wording is D10.
- **S9 Tracked in the pipeline.** Recruiter: «nunca tuvimos como tal control, solo mandábamos la liga pero jamás
  entrábamos». User: «nosotros podriamos llevarlo al siguiente nivel agregando aparte la incorporacion directa enel
  sistema». Status on the card and sheet (sent, in progress, finished, expired); «Recordar» is a recruiter action
  that records the reminder and copies the link again.
- **S10 Sending.** User chose «Ambos»: manual from the card or sheet always available, and optional automatic sending
  when a candidate enters a stage configured in the vacancy. Without email (L9, L10) «sending» creates the invitation
  (idempotent: one active per participation and test); the recruiter delivers it with «Copiar enlace». Email
  delivery comes last in this feature (E1).
- **S11 Candidate access.** User chose «Ambos»: unique expiring link with a token (no account needed), and candidates
  with a PeopleFlow account also see it in their workspace. Mobile, progress saved.
- **S12 Consent and privacy.** Express electronic consent before the first item (LFPDPPP art. 8), privacy notice,
  stated retention period (art. 12), and a human always decides (art. 26).

## Out of F1 (deferred, recorded on request)

User: «es importante que anotes todo lo que dejamos para despues, o fuera del f1, como lo del checklist o terna».

- **D1** Integration with the vacancy checklist: psychometric competencies as automatic checklist criteria.
- **D2** Psychometric section in the terna report (comparison, PDF/CSV) for the client.
- **D3** Cognitive ability tests (ICAR; confirm commercial terms of the 2026 item release first).
- **D4** Company-authored situational judgment tests (SJT), assisted by the system, with the recruiter's best answer.
- **D5** Local norms built from PeopleFlow data (F1 uses bands by meaning, S5).
- **D6** Short screening battery for volume roles (F1 has one battery: IPIP-NEO-120).
- **D7** Candidate feedback report (an optional summary returned to the candidate).
- **D8** Licensed classic tests (Cleaver, Terman, 16PF, Raven) only through a licensed partner, if ever.
- **D9** Legal review of sensitive-data handling before launch (user-owned).
- **D10** AI-personalized interview questions (Bedrock by IAM role, only competency levels + job profile, stored with
  model id and prompt version) — F2 (L10).

## Last in this feature (needs AWS infrastructure)

User: «van a haber cosas que hay que dejar para al ultimo de esta feature porque ahora aun no hay configuracion de
infra de aws».

- **E1** Email delivery of the invitation link (SES; blocked on a registered domain, `docs/decision-email-provider.md`).
- **E2** Automatic reminders (needs a scheduler and E1).
- **E3** Scheduled run of the retention purge (F1 ships the one-shot purge command and read-time hiding).

## Tasks

| ID | Specs | Route | Commit |
|----|-------|-------|--------|
| T1 | — | inline — discovery record + feature document | 2d56f109 |
| T2 | S3, S5 | research — instrument content: IPIP-NEO-120 Mexican items, scoring keys, norms, license text; facet → competency mapping | 50fcf5f3 |
| T3 | S2–S6, S8 | worker — content spec: corrected 116-item bank, keys, bands, competency catalog, interpretation library, question bank, signal rules | |
| T4 | S2, S7, S9–S12 | design — artboards: vacancy profile module, candidate test flow + consent, card status, sheet result | |
| T5 | all | inline — contract `docs/contracts/psychometric-tests-v1.md`, backend review | |
| T6+ | — | implementation tasks split after the contract | |

## Log

- **L1** (user, verbatim): «quisiera retomar la idea de los examenes psicometricos dentro de este sistema.. y lo
  considero una feature grande porque no quiero que sea algo generico/comun o simplemente una feature de un examen
  donde se responden las preguntas y ya, quiero algo mas alla, realmente quiero que sea una feature con mucho valor
  para el proceso de reclutamiento (en caso de necesitarse) porque realmente no en todos los procesos de seleccion van
  a necesitar un examen psicometrico completo, etc.. pero quiero platicarlo contigo.. que piensas?»
- **L2–L5** Discovery conversation, market research and the recruiter's answer: verbatim in
  `odd/discovery/psychometric-tests.md` Log L2–L5.
- **L6** (user, verbatim): «Si hermano, y tambien estoy de acuerdo con tu recomendacion, a) como base y b solo para
  redactar las preguntas de entrevista, lo cual me dice que realmente el gasto de ia sera muy poco no? eligiendo un
  modelo correcto/apto para esto 10 dolares durarian bastante.. solo seria texto. o no». Estimate given: about 3k input
  + 1k output tokens per candidate, under one US cent with a small model at the rates assumed (to confirm at selection).
- **L7** User choices (question): candidate access «Ambos»; sending «Ambos»; scope: «Si me cierra el alcanze pero es
  importante que anotes todo lo que dejamos para despues, o fuera del f1, como lo del checklist o terna, me explico?»
  → section «Out of F1».
- **L8** T2 (explore mvt1oeg1-1-l0tm; parent spot-checked items 28/58/88/118/60/73 and the C3 label): findings in the
  discovery record «Instrument content research». Plan corrections: the Mexican translation has errors (C3
  «Debilidad», item 73 «relaciones», item 60 «rápidas»); facet O6 asks votes and moral positions (sensitive data);
  IPIP advises against published norms; Great Eight titles are SHL copyright (research only) and no validated facet →
  competency weights exist, so the competency catalog is our own and the mapping is presented as a hypothesis to
  explore in the interview.
- **L9** Backend capability evidence (msg 693de502, session 01a1857a-48e5, main 40002dfb): no public token mechanism,
  scheduler, email, LLM or app-level encryption exist; stage entry happens inside one pgx tx (board Move
  `board/store.go:276`, recovery `board/discard.go:121`, manual intake `board/manual_create.go:132`, apply
  `v2/store.go:182`) and append-only `audit_events` exist. Backend proposals: opaque 256-bit token stored as SHA-256
  with expires_at/revoked_at and one subject, identical 404/410 for unknown/expired/revoked, `/v2/me/assessments` for
  account holders; expiration computed at read time (no job); delivery by «Copiar enlace», manual «Recordar»;
  automatic send = auto-create the invitation (idempotent, one active per participation and test) on move + recovery,
  apply/manual only when the first stage is configured, never on pipeline relocation; Bedrock by IAM role behind an
  interface with a fake, explicit recruiter action, only competency levels + job profile (possible F2); separate tables
  for invitation, consent (notice version + text hash), responses/telemetry, result; audit on send, consent, finish
  and recruiter views; purge_after + one-shot purge command, hidden at read time after retention; backend scores,
  keys never reach the client, scoring_version stored; client timings only for quality flags, server stamps
  received_at. High-risk slices: public token (security) and sensitive data/retention.
- **L10** User choices (question): instrument «Corregir traducción + quitar Liberalismo (Recomendado)»; scores «Bandas
  por significado (Recomendado)»; delivery (verbatim) «si, pero van a haber cosas que hay que dejar para al ultimo de
  esta feature porque ahora aun no hay configuracion de infra de aws.» → section «Last in this feature»; interview
  guide «Banco redactado en F1, IA en F2 (Recomendado)» → D10. Slice note: 50fcf5f3 closed the first ~400-line slice
  (docs only).
- **L11** T5: draft contract cde6f026 → backend review (msg 7266fb75, 16 adjustments) folded in: revoke-on-mint
  hash-only token returned as `{token, expires_at}` (frontend composes the URL), in-process rate limits on the public
  prefix, `{error, code, data}` envelope with a codes table, account path lists closed invitations (identical 404 is
  public-only), expiry checked in every write tx, content pinned per invitation with fixed presentation order, exact
  answer body, at most one finished invitation per participation (re-takes out of scope), stage validation and retired
  stages ignored, board move response unchanged, fit + questions recomputed on read for a newer profile (snapshot kept),
  consent text authored in docs and served by the backend, ARCO handled manually, purge_after anchored at finished_at or
  expires_at, audited result reads fail without audit. Agent decisions (for the user's review): presentation order fixed
  per content version; manual send on a discarded or exited participation → `409 participation_inactive`. Slices:
  public token endpoints and retention/purge each get their own commit for independent verification.
- **L12** User choices (question): U1 retention «12 meses (Recomendado)», U2 link expiry «7 días (Recomendado)».
  Backend agreed with the contract (msg de24c12b) after 3 nits (total_count from the pinned version, revoked_at anchor
  for purge_after, no automatic invitation for discarded/exited participations), folded in; agreement is subject to
  the cut points and ids of `docs/psychometrics/*-v1.md`.
- **L13** T4 (worker mvt23dsx-4-jgtj): `design/psychometric-result/` — 01 «Resumen por competencia», 02 «Matriz
  deseado vs obtenido», 03 «Guía primero» (sheet tab «Psicometría», 1440×900, 560 px sheet). Parent screenshots at 1440:
  all three render; «Por explorar» and «Foco de atención» share the review tone (worker choice so a focus never reads
  as rejection) and differ only by text; the heading shows a focus outline on load. Pending the user's choice.
- **L14** T3 (worker mvt1zrj8 → mvt2239g-3-4gtf, after the parent clarified that the health prohibition covers our
  authored text, not source provenance): `docs/psychometrics/` README, item-bank (116 items, 29 facets, official key
  audited 116/116, 53 reversed), quality-signals (3 attention items at positions 30/60/90 → 119 positions), bands (4–9
  / 10–14 / 15–20) and 6 competencies, interpretation library (18 entries), interview bank (72 questions). Parent
  review: no competency uses an N facet (the worker kept borderline facets out pending the user), while the artboards
  show «Manejo de la presión»; items 11 and 71 got the same Spanish wording. Contract follow-ups: `total_count` 119
  and `DELETE {base}/answers/{position}` for clear events (signal.changes). Pending user review: 23 corrections,
  facet labels, borderline facets N1–N6, E6, O3.
