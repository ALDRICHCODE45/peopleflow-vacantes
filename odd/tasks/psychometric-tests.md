# Psychometric tests F1 (job-linked assessment inside PeopleFlow)

In-product psychometric assessment linked to the vacancy: job psychometric profile, IPIP-NEO-120 with telemetry,
tracking in the pipeline, consent, practical result with focus areas and an AI interview guide. Branch
`feat/psychometric-tests` (from main 40002dfb). Discovery and sources: `odd/discovery/psychometric-tests.md`.

## Specs

- **S1 Value beyond a quiz.** «no quiero que sea algo generico/comun o simplemente una feature de un examen donde se
  responden las preguntas y ya, quiero algo mas alla, realmente quiero que sea una feature con mucho valor para el
  proceso de reclutamiento (en caso de necesitarse) porque realmente no en todos los procesos de seleccion van a
  necesitar un examen psicometrico completo». Assessment is optional per vacancy, never on by default.
- **S2 Job psychometric profile.** Recruiter (L5): «Comparar el perfil con la vacante: que me ayude a identificar qué
  tan alineado está el candidato con las competencias que realmente requiere la posición, sin limitarse a decirme si es
  apto o no apto.» Employer-only module in the vacancy configuration: competencies with importance, suggested from the
  vacancy; the result shows fit per competency, never «apto / no apto».
- **S3 Instrument.** User: «creo que lo mejor es usar ipip». IPIP-NEO-120 in its Mexican Spanish translation (30
  facets), plus attention and consistency items. Recruiter: «Dar resultados confiables y objetivos: que las pruebas
  estén validadas, tengan criterios claros y reduzcan los sesgos, en lugar de etiquetar a las personas con base en un
  resultado aislado.»
- **S4 Telemetry as signals, not verdicts.** User: «median muchas cosas, tiempos de respuesta, si cambias de respuesta,
  si borras y luego vuelves a ponerlo». Response times and answer changes are recorded and shown as grouped consistency
  signals to explore in the interview, never as «mintió».
- **S5 Practical interpretation.** Recruiter: «Traducir los resultados en información práctica: no solo decirme que
  alguien tiene liderazgo, sino explicarme cómo podría reflejarlo en el trabajo, cuáles son sus fortalezas y qué áreas
  tendría que desarrollar.» Texts come from an authored library per competency and level (user chose «a) como base»):
  the same scores always give the same text.
- **S6 Focus areas.** Recruiter: «Identificar focos de atención: posibles áreas de riesgo, incompatibilidades con las
  exigencias del puesto o aspectos que valdría la pena profundizar durante la entrevista, sin convertirlos
  automáticamente en motivos de descarte.» The assessment never rejects, discards or moves a candidate.
- **S7 Clear for non-specialists.** Recruiter: «Ahorrar tiempo: que el reporte sea claro, visual, fácil de interpretar
  y que no tenga que ser especialista en psicometría para entender qué significan los resultados.» Result lives in the
  candidate sheet, not only in a document.
- **S8 AI interview guide.** Recruiter: «Generar preguntas de entrevista personalizadas: que, con base en los
  resultados, me sugiera qué preguntarle al candidato para validar o profundizar en ciertas competencias.» User: «b
  solo para redactar las preguntas de entrevista». Generated once per candidate and vacancy and stored; each question
  cites the competency and level that originates it; the model receives competency levels and the job profile only,
  never name, contact data or individual answers.
- **S9 Tracked in the pipeline.** Recruiter: «nunca tuvimos como tal control, solo mandábamos la liga pero jamás
  entrábamos». User: «nosotros podriamos llevarlo al siguiente nivel agregando aparte la incorporacion directa enel
  sistema». Status on the card and sheet (sent, in progress, finished, expired) and reminders.
- **S10 Sending.** User chose «Ambos»: manual from the card or sheet always available, and optional automatic sending
  when a candidate enters a stage configured in the vacancy.
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
- **D5** Local norms built from PeopleFlow data (F1 uses published IPIP norms with their caveat).
- **D6** Short screening battery for volume roles (F1 has one battery: IPIP-NEO-120).
- **D7** Candidate feedback report (an optional summary returned to the candidate).
- **D8** Licensed classic tests (Cleaver, Terman, 16PF, Raven) only through a licensed partner, if ever.
- **D9** Legal review of sensitive-data handling before launch (user-owned).

## Tasks

| ID | Specs | Route | Commit |
|----|-------|-------|--------|
| T1 | — | inline — discovery record + feature document | |
| T2 | S3, S5 | research — instrument content: IPIP-NEO-120 Mexican items, scoring keys, norms, license text; facet → competency mapping (Bartram «Great Eight» to confirm) | |
| T3 | S2, S5, S6, S8 | inline — competency catalog, interpretation library structure, focus-area and telemetry-signal rules | |
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
