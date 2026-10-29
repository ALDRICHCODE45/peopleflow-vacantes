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
  (L10), then «Solo las que sirven» (L15). The IPIP-NEO-120 facets that feed a competency (15 facets, 60 items), in our corrected Mexican Spanish version
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
- **E4** Deployment hardening of the public link (L32): redact `/evaluacion/{token}` from hosting, proxy and load
  balancer logs; trust only known proxy hosts for the redirect origin; a stable Server Actions encryption key across
  instances; a production-browser inspection of the Flight payload.

## Tasks

| ID | Specs | Route | Commit |
|----|-------|-------|--------|
| T1 | — | inline — discovery record + feature document | 2d56f109 |
| T2 | S3, S5 | research — instrument content: IPIP-NEO-120 Mexican items, scoring keys, norms, license text; facet → competency mapping | 50fcf5f3 |
| T3 | S2–S6, S8 | worker — content spec: corrected 116-item bank, keys, bands, competency catalog, interpretation library, question bank, signal rules | |
| T4 | S2, S7, S9–S12 | design — artboards: vacancy profile module, candidate test flow + consent, card status, sheet result | |
| T5 | all | inline — contract `docs/contracts/psychometric-tests-v1.md`, backend review | |
| T6 | S2–S12 | worker — `features/psychometrics/` model, codec, client, server actions, guarded transport inventory, agreed-contract test (mocks of the contract) | e6c9c5e5 |
| T7 | S1, S2, S10 | worker — vacancy configuration module «Psicometría» `/configuracion/psicometria` (artboard flows/01) | a5c657c6 |
fe4cfc6 |
| T9 | S4–S8 | worker — sheet result: guide first + band matrix (chosen result/03 + 02), comparisons | a28ee619 |
| T10 | S4, S11, S12 | worker — public candidate flow `/evaluacion/[token]`: consent, one item per screen, telemetry (event_id, cumulative visible time), final and unavailable (flows/02–04). Risk item 2 (public token route) | 01cd8bb6 |
| T11 | S11 | worker — candidate workspace list of assessments (account path) | |
| T12 | all | inline — browser QA against the backend, guide step, review queue, delivery | |
| T13 | E1–E3 | later — email delivery, automatic reminders, scheduled purge once AWS infrastructure exists | |

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
- **L15** User choices (question): facets «Solo las que sirven (Recomendado)» — the 12 facets that feed competencies +
  N1/N2/N6 for a new competency «Manejo de la presión»: 15 facets, 60 items (data minimization, LFPDPPP arts. 8 and
  12); design «03 + matriz de la 02 (Recomendado)» — chosen direction: interview guide first (artboard 03) with the
  desired-vs-obtained band matrix of artboard 02 in the competencies section; 01 and plain 02/03 stay as alternatives.
  Backend content check (msg adc5dfb0): bands and ids OK; round 2 (R2-1…R2-10) makes the contract adopt the content
  model (content ids on the wire, README version names, confirmed profile with rationale and task, explicit comparisons
  instead of recompute-on-read, richer result/focus/quality shapes, server-derived changes with client event_id,
  stored guide text, consent notice in docs). Backend slicing B1–B10 proposed (content artifact + drift guard, pure
  scoring, profile, invitations, link mint, auto-trigger, candidate endpoints, limiter, result + comparisons,
  retention; security and deletion slices in their own commits).
- **L16** T4b (worker mvt2lfem-6-fldz): `design/psychometric-flows/` — 01 perfil del puesto (1440), 02 consentimiento,
  03 preguntas, 04 final + no disponible (390 mobile), 05 card and sheet states (1440). Parent screenshots: all render.
  Mismatch found: artboard 03 uses an agreement scale («Muy en desacuerdo … Muy de acuerdo») while the item bank and
  the attention items use the IPIP accuracy scale («Muy inexacto …»); pending the user's choice of wording.
- **L17** User choice (question): scale ««Me describe…» (Recomendado)» — No me describe nada / Me describe poco / Me
  describe a medias / Me describe bastante / Me describe totalmente, applied to the item bank, the attention items and
  artboard 03. T3 + T5 v-next (worker mvt2kwap-5-6qyw): 60 items, 15 facets, 63 positions (attention at 16/32/48),
  7 competencies (comp.presion, N1/N2/N6 negative), 21 library entries, 84 questions, consent-notice-v1.md (pending D9),
  contract R2-1…R2-10 + backend additions (integer band rule S < 10n / S < 15n, display index half-up to 1 place;
  thresholds of 60: fast 12–29 / ≥30, changes ≥30, long_string 7–11 / ≥12). Parent renamed the test id
  `ipip116-mx` → `ipip60-mx` (unreleased). Worker checks: 209 unique ids, all 32 contract ids exist, diff-check clean.
- **L18** Backend final check (msg 6f33243b): contract AGREED @fc9f00ce; nits folded (PUT profile body without
  version/confirmed_at, `confirmed` writable; changes stream always known in v1; estimated_minutes 10). Backend branch
  `feat/psychometric-tests-backend` from fc9f00ce, starting B1 (content artifact + drift guard) and B2 (pure scoring);
  tell the backend the commit of every content change. Frontend implementation split into T6–T13; T6 does not depend
  on the user's wording or design review, T7–T11 follow the chosen artboards.
- **L19** (user, verbatim): «Si hermano, si lo recomiendas si.» — frontend implementation starts with T6 (worker
  mvt3pd5f-7-sqbo), then T9 on its model, while the user reviews the flow artboards and the content wording.
- **L20** Backend progress (msg 38dea3f1, `feat/psychometric-tests-backend`): B1 43d48088 embedded content artifact
  `psychometrics.content.v1` + docs drift guard (regenerate: `go test ./internal/features/psychometrics/content -run
  '^TestDocumentationDrift$' -update-content`); B2 9a8d330d pure scoring/quality/fit/guide with the docs examples as
  table tests; 938a265c merged; B3 (migration + profile GET/PUT) started. Every docs/psychometrics change → send the
  commit to the backend.
- **L21** T6 (worker mvt3pd5f-7-sqbo): `features/psychometrics/` model (strict Zod, wire ids), client (employer 1–9,
  both candidate prefixes, typed errors incl. 412/428/429 Retry-After, token never logged), actions, link, contract
  and boundary tests; registered in the guarded transport inventory. RED → GREEN reported per suite; parent re-ran
  vitest 8 files / 611 passed, tsc clean, eslint clean. Commit e6c9c5e5. T9 launched (worker mvt49edv-8-k2g5) with
  the design handoff of the chosen artboard `psychometric-result/03-guia-primero.html` (+ band matrix of 02); 01 and
  02 stay as alternatives. Constraint: the result GET writes an audit view, so it is fetched only when the tab opens.
- **L22** (user, canvas comment w9ifyg2t on flows/05, verbatim): «noto que usas en algunos lados estse color cafe y
  sinceramente no me gusta nada. se que lo ocupas como resaltado pero considero que no embona para nada en la paleta
  de colores de peopleflow, en general, el uso de este color no me gusta nada.» Applied to flows/05 only (skill:
  iterate the targeted artboard): `review` badge → primary accent, notice border → primary on a primary 6% surface;
  resolved. T9 worker told: no `review` tone in the psychometric UI («Por explorar» / «Foco de atención» = accent,
  focus distinguished by an icon). `--status-review` still appears in flows/01, flows/02 and result/01–03 and is a
  product-wide token; pending the user's decision on its scope.
- **L23** User choice (question): «Psicometría completa (Recomendado)» — `--status-review` replaced by the primary
  accent in flows/01, flows/02 and result/01–03 (0 occurrences left in both designs); the product-wide change is a
  backlog item in `odd/tasks/frontend-backlog.md` (Known issues).
- **L24** (user, verbatim): «perfecto, me gusta mucho.», then (question) «Sí, apruebo las 5» — flows/01–05 validated
  (§21: not changed while implementing). T7 and T10 launch in parallel (disjoint surfaces); T8 waits for T9 because
  both change `candidate-sheet.tsx` and `board.tsx`.
- **L25** T7 worker found the contract (R2-3 as written) required a rationale on all 7 entries, while the approved
  artboard had one general rationale. User choice (question): «Solo en las relevantes (Recomendado)» — rationale
  required for Clave and Importante, task for Clave, No relevante asks for nothing (null rationale/task/band). Contract
  and bands-and-competencies updated; backend told.
- **L26** Parent applied L25 to the data layer test-first (model.test RED 4 → GREEN 570 in psychometrics; commit
  8d0e134a). T7 (worker mvt4vqn3 → mvt5t62f): `features/psychometrics/profile/` editor, module, loading + the
  «Psicometría» nav entry; no suggestion rules exist in the content, so «Sugerir desde la vacante» keeps defaults;
  the skipped Select test was restored with the Entrega Select mock pattern. Parent wrote the route page
  `configuracion/psicometria/page.tsx` test-first (missing module RED → GREEN). Parent re-ran profile + vacancy-config
  + route: 9 files / 98 passed; worker: 382 passed, tsc and eslint clean. Commit a5c657c6. Combined runs under
  parallel workers time out (load), so the delivery gate runs alone.
- **L27** T10 (worker mvt4wyu7-b-46rn) + parent route page `(public)/evaluacion/[token]/page.tsx` (test-first). Independent
  verify (mvt5pukb-c-xz6d): FAIL on token containment — Next 15.5.25 encrypts Server Action captures, but the dynamic
  `[token]` segment is also serialized in clear in the Flight router state
  (`create-flight-router-state-from-loader-tree.js:25–30`, `app-render.js:573,643–648`; probe output
  `[["token","private-assessment-token","d"],{}]`). Metadata/routing, error states, telemetry PASS; 18/18 + probes.
  Parent assessment: the router state reaches the same browser that already holds the URL, so it adds no new
  recipient, but the URL itself keeps the bearer in history and request logs. Pending the user's decision on the
  routing (exchange the link for an httpOnly cookie and redirect, or accept).
- **L28** Backend L25 implemented (msg e7311fac, 800dd86f on B3 base ac17f5e7). Agreed one representation: relevant
  entries always carry a string rationale ("" in drafts, null invalid); task on importante → not_allowed. Parent
  mirrored it in the model test-first (RED 1 → GREEN 584 in psychometrics) and in the contract. Backend aligned
  (msg f12ff95f, 03d5b922): null rationale on a relevant entry → invalid, clave task nullable while drafting; B4 started.
- **L29** User choice (question): «Canjear por cookie y redirigir (Recomendado)» — `/evaluacion/{token}` stores the token
  in an httpOnly cookie (Secure in production, SameSite=Lax so the cross-site link from email/WhatsApp still carries it
  after the redirect, path `/evaluacion`, session lifetime: reopening the link resumes) and answers 303 to
  `/evaluacion`; the page reads the cookie server-side. One assessment per browser at a time (the last link opened
  wins). The exchange never calls the backend (no oracle) and rejects malformed tokens without setting a cookie.
  Worker mvt6hfw7-f-pf9t implements it.
- **L30** T9 (worker mvt49edv → mvt4aksl → mvt5t62k): `features/psychometrics/sheet/` provider (board-scoped invitations,
  mounted in `board.tsx`), result tab (guide first, band matrix, focus areas, quality tier, facets, comparisons with
  history and no automatic replay), labels; result GET only on tab open; scrollable tab rail at 390 px; accent/info
  tones, no review. The failing «uncertain comparison» test had stale fixtures (pre-L25 rationale), fixed RED → GREEN.
  `board.tsx:54` exhaustive-deps warning predates T9. Solo delivery gate (nothing else running): 78 files / 1451
  passed, tsc 0 errors. Commit a28ee619. Browser QA and the canvas handoff «implemented» remain for T12.
- **L31** T10b (worker mvt6hfw7-f-pf9t): Route Handler `evaluacion/[token]/route.ts` (shape check `^[A-Za-z0-9_-]{32,128}$`,
  cookie `pf_assessment` httpOnly / Secure in production / SameSite=Lax / Path=/evaluacion / session, 303 to
  `/evaluacion`, no-store, no-referrer, no backend call; malformed link sets no cookie and keeps an existing one),
  static `evaluacion/page.tsx` reading the cookie server-side, router-state probe test. Parent removed the obsolete
  `[token]/page.tsx` + test. Parent re-ran candidate + evaluacion: 3 files / 33 passed, tsc clean. Commit 01cd8bb6
  (own commit, risk item 2). Independent re-verify mvt6qq3h-h-mjzi launched. T8 worker mvt6pkht-g-8qe5 launched.
- **L32** Independent re-verify (mvt6qq3h-h-mjzi): PASS for 01cd8bb6 — no token in the static Flight router state, the
  five Server Action captures encrypted (SWC `encryptActionBoundArgs`), cookie attributes and malformed-link
  preservation, 303 + no-store + no-referrer without backend call, neutral missing-cookie screen, previous behavior;
  33/33 and 39/39 with its probes; tsc 0. S4, S11 (public path), S12 (this slice) PASS. Residual deployment checks
  recorded as E4.
- **L33** T8 (worker mvt6pkht-g-8qe5): card status rows (`features/psychometrics/card/`), sheet management (send, copy
  link with revoke-previous confirmation, remind, revoke; token only in the clipboard write), refetch after moves,
  shared provider. Delivery gate (alone): 81 files, 1 failure — the route-handler inventory in
  `jobs/requestPath.test.ts` did not list T10's `evaluacion/[token]/route.ts` (a real guard, same class as the checklist
  L15); parent registered it (555d6c4b, risk item 2: transport guard allowlist; the handler makes no backend call).
  Then 1486 + inventory green, tsc 0. T8 commit 5fe4cfc6. T11 artboards (worker mvt71zi9-i-8b6u)
  `design/psychometric-candidate-workspace/` 01 «En la postulación», 02 «Bandeja de pendientes», 03 mobile of 01;
  parent screenshots render; commit 3bf38c73; pending the user's choice.
- **L34** (user, verbatim): «si hermano estoy de acuerdo con tu recomendaqcion» — T11 = artboard 01 «En la
  postulación» (chosen, handed off; 03 is its mobile view) + only the «Pendientes» block of 02 on the candidate
  dashboard; the rest of 02 stays an alternative. The account path answers inside the candidate shell at
  `/candidato/evaluaciones/[iid]` (the iid is not a credential: access is by session and candidate match).
