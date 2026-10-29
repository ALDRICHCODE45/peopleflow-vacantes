# Psychometric tests inside PeopleFlow — discovery record

This document records market and evidence research for in-product psychometric assessment. It is not an
implementation plan or a contract; no feature implementation is authorized by this record. Research date: 2026-10-28.

## Status

- Discovery is ongoing. Inputs pending from an experienced recruiter (large companies) contacted by the user.
- Decisions so far are the user's answers in L1–L2; everything under «Proposals» is the agent's, not agreed.

## What the user told us

- Clients are open to instruments other than the classic ones if the result is more useful.
- There is no psychologist in the clients' flow. Today they use separate software, and mostly when a client asks
  for it on C-level or highly specialized positions.
- What the user saw in those tools: tests of every kind (including math), questions to profile the candidate, and
  recording of response times, answer changes, and erase-and-answer-again.
- The user wants both directions: a job psychometric profile with an interview guide, and company-authored
  situational tests, taking the best of existing software and of the recruiter. «no hay que quedarnos solo en una
  funcionalidad que haga bulto, realmente hay que conseguir que aporte valor real».

## Market: what existing software does

### PsicoSmart (Mexico and Colombia; the closest reference for our clients)

Sources: user manual (updated 2020-06-12) http://humansmart1.mex.tl/uploads/s/h/f/d/hfdsgbhl10to/file/bOBVZwlv.pdf,
https://vorecol.com/es/software-pruebas-psicometricas-en-linea.php, https://psico-smart.com/.

- Catalog: «31+ evaluaciones validadas» plus «+2,715 exámenes técnicos». Named tests: Terman, Raven, Dominos, Barsit
  (intelligence); Cleaver, Gordon, LIFO, Moss, Allport (personality and behavior); Zavic, HonestiValues (values).
  Durations: Cleaver about 15–20 min, Terman about 40 min.
- «Puestos y perfiles»: a job lists competencies with a «nivel de actuación deseado»; tests can be attached to the job
  and assigned automatically when a candidate is added; the system recommends tests for the chosen competencies.
- Reports: individual per test (with every answer), «Reporte comparativo competencias» (desired vs obtained level,
  difference in colors, overall grade), «Reporte integrativo» (all tests in one document), «Comparativo candidatos»
  (up to 5 per job). Output is Word or PDF.
- Anti-fraud: a test locks if the candidate abandons it once started (Terman, Raven, Dominos, Barsit, Moss); the
  recruiter unlocks it. Custom exams can set a per-question time limit. Recording of answer changes or response times
  was not found in the sources read.
- Candidate: email with a link, user and password, then a list of tests with status; company logo; privacy notice.
- Pricing models: per test, per candidate (at most 10 tests per candidate), unlimited (one user). Amounts not public
  in the sources read (pricing page returned 403).
- Integrations with an ATS: none found; CSV bulk upload and Word/PDF export only.

### Evaluatest IA (Brivé, Latin America)

Source: https://brivesoluciones.com/evaluatest-ia-funcionalidades/.

- Situational, competency-based tests instead of classic personality inventories: ESIC (simulated work challenges,
  20–30 min, competency families such as team leadership, execution, commercial skills, integrity tendency) and
  Etegrity (gamified integrity situational test, 20–30 min).
- Video evaluation with AI transcription and «identifica las emociones de la persona»; open questions.
- Facial biometric authentication with random screenshots and an «incidencias» report.
- Candidate ranking, «cartera de finalistas» to share the shortlist, API to HCM/ERP, multiposting.
- Pricing not public in the sources read.

### TestGorilla (global, volume hiring)

Sources: https://www.testgorilla.com/pricing/, https://www.testgorilla.com/test-library/, TestGorilla help center
search snippet on behavior tiers.

- 350+ tests in categories: personality and culture (Big 5, DISC, Enneagram, 16 types, Motivation, Culture Add, about
  10 min each), cognitive ability (problem solving, numerical, verbal, abstract, spatial, attention to detail, 9–13
  min each), role skills, software, programming, situational judgment, language (CEFR), typing.
- Anti-cheating: webcam snapshots, disabled copy/paste, full-screen mode, large question pools, timed tests, honesty
  agreement, ID verification, tab-switch monitoring against AI tools. Flags are grouped into «Behavioral Tiers»: No
  Issues, Some Issues, Major Issues, because «cheating is a spectrum».
- Custom questions, AI job builder that drafts an assessment from a job description, AI-scored video questions.
- Pricing (billed annually): Free with 10 credits per month; Core from $215/mo; Plus from $520/mo; most premium tests
  cost 1 credit per candidate.

### Executive segment: Hogan, SHL, Thomas

Sources: https://www.hoganassessments.com/assessment/hogan-development-survey/,
https://www.hoganassessments.com/reports/summary-report/, https://service.shl.com/docs/OPQ_Leadership_Report_Fact_Sheet.pdf,
https://www.thomas.co/assessments/personal-profile-analysis-ppa.

- Hogan: «bright side» personality (HPI), «dark side» derailers under pressure (HDS), values and drivers (MVPI);
  Leadership Forecast reports for selection. Hogan's own study reports HDS scales predicting leader ratings beyond HPI.
- SHL: OPQ32 personality with role reports (Leadership, Sales, Universal Competency) and Verify ability tests with a
  verification stage; the Leadership report «should be interpreted by individuals who have been trained in the use of
  the OPQ».
- Thomas: PPA (DISC-based, about 8 min) and GIA (five cognitive abilities, 30–45 min).
- Pattern for C-level: derailers under pressure, values and motivation, and a narrative report; interpretation by
  trained people. We could not verify, in the sources read, which of these offer an interview guide generated from the
  results.

## Evidence that should shape the design

### Validity (Sackett, Zhang, Berry & Lievens, 2022, Journal of Applied Psychology 107(11))

Revised operational validity for job performance (https://pubmed.ncbi.nlm.nih.gov/34968080/, table 3 via
https://gwern.net/doc/statistics/meta-analysis/2021-sackett.pdf):

| Procedure | Revised validity |
|---|---|
| Structured interview | .42 |
| Job knowledge test | .40 |
| Work sample | .33 |
| Cognitive ability | .31 |
| Integrity test | .31 |
| Situational judgment test | .26 |
| Conscientiousness, contextualized to work | .25 |
| Conscientiousness, generic | .19 |
| Unstructured interview | .19 |
| Emotional stability, generic | .09 |
| Years of experience | .07 |

Implications:

1. The structured interview is the best single predictor and the unstructured interview is far weaker. A test that
   turns the interview into a structured one adds more than the test alone.
2. Personality measured «at work» (contextualized items) predicts better than generic personality.
3. Cognitive ability is useful but shows the largest group difference in that table (Black–White d .79); use it only
   when the job needs it, not by default.

### Telemetry: response times and answer changes

- Response latencies can help identify faking on self-report personality inventories: one study classified fakers at
  60% against a 33% chance rate (Holden & Lambert 2014, https://doi.org/10.3758/s13428-014-0524-5). Other research
  finds weak results with few items and no warnings (https://pmc.ncbi.nlm.nih.gov/articles/PMC8863730/).
- Answer changes show how someone answered, not that they lied: misreading, reconsidering or a wrong click produce the
  same signal.
- Conclusion: telemetry is a consistency signal to explore in the interview, grouped like TestGorilla's tiers, never a
  verdict about honesty.

### Situational judgment tests written by the company

- SJTs predict performance on average (meta-analysis of 302 studies, https://pubmed.ncbi.nlm.nih.gov/42804245/), but
  validity belongs to each specific test. A company test needs real work situations, an expert-reviewed answer key,
  and a pilot (https://www.opm.gov/policy-data-oversight/assessment-and-selection/other-assessment-methods/situational-judgment-tests).

## Licensing

- Classic tests are protected by copyright; a Spanish-language consultancy survey (516 LinkedIn users, 2023) found 66%
  think most companies use selection tests without paying licenses (https://vya.consulting/uso-de-pruebas-sin-licencia-en-seleccion-de-personal/).
  Do not ship Cleaver, Terman, Raven, 16PF, Moss or similar without a license from the rights holder.
- IPIP (International Personality Item Pool): public domain, «any purpose, including commercial use», may be copied,
  edited, translated and adapted (https://ipip.ori.org/newPermission.htm). IPIP warns its scales are preliminary, so
  public domain does not prove validity for a given use.
- ICAR (International Cognitive Ability Resource): described as «a public-domain assessment tool» aimed at research
  (https://icar-project.com/). Item bank published 2026-06-02 (https://www.psycharchives.org/en/item/be35b8b4-2bc7-4691-964d-52cfc1cf17a9).
  Commercial-use terms of that release still to confirm before use.
- HEXACO-PI-R: free only for non-profit research and teaching; selection use costs C$2 per administration, 50
  minimum (https://hexaco.org/nonacademicuse.htm).

### Is IPIP at the level of commercial inventories?

- IPIP proxy scales correlate .73 on average with the 30 NEO-PI-R facets (.94 corrected for unreliability), and
  their reliabilities «generally match or exceed» the originals (Goldberg et al. 2006,
  https://ipip.ori.org/Goldberg_etal_2006_IPIP_JRP.pdf). Same paper warns the overlap does not guarantee identical
  constructs (3 of 30 facets loaded on an unexpected factor in one sample).
- Grucza & Goldberg 2007 compared 11 personality inventories predicting behavior, informant reports and clinical
  indicators: «most inventories exhibited quite similar cross-validities when averaged» (https://pubmed.ncbi.nlm.nih.gov/17764394/).
- Mexican Spanish translation of IPIP-NEO-120 exists (https://ipip.ori.org/MexicanIPIP-NEO-120.htm); Spanish-language
  adaptation studies exist for Argentina (https://doi.org/10.32870/rmip.vi.303).
- What IPIP does not give: selection norms, faking scales, job reports, interpretation texts. IPIP literature
  recommends local norms; scores are one piece of evidence, never a pass/fail by themselves.

### Prices of licensed instruments

- 16PF (Pearson): Basic Interpretive Report $38.60, Basic Score report $33.10 per administration, through Pearson's
  Q Local software (https://www.pearsonassessments.com/store/usd/p/100000483.html).
- Hogan: «Reports can range from $15 to $200 for off-the-shelf selection reports»
  (https://www.hoganassessments.com/science/academic-collaborations/, 2018); a 2026 buyer's guide estimates $300–$900
  per candidate for the full suite and $3,050–$5,450 to certify an in-house practitioner
  (https://www.compono.com/articles/hogan-assessment-pricing-buyers-guide-2026).
- Raven's 2 (Pearson TalentLens): quote-based, no public price.
- US market overview (2026): about $10–$300 per candidate, or $5,000–$20,000+ per year by subscription; Caliper about
  $265 per profile, PXT Select $175–$295, Predictive Index from $10,000 per year
  (https://assessing.ai/blog/personality-test-for-hiring-employees-cost).
- Cleaver in Mexico: sold by many resellers (for example an «ilimitado» Cleaver package at $140.19 USD on a web store,
  https://psicotest.mitiendanube.com/mx/productos/test-cleaver-version-basica/); the rights holder behind those copies
  was not identified. Treat as unverified licensing.

### Instrument content research (T2, explore mvt1oeg1-1-l0tm, 2026-10-28)

- IPIP-NEO-120 (Johnson 2014): 30 facets × 4 items, official +/− key and facet alphas (.63–.88, 619,150 internet
  respondents) at https://ipip.ori.org/30FacetNEO-PI-RItems.htm; scale 1–5, reverse with `6 − response`, facet
  4–20 (https://ipip.ori.org/newScoringInstructions.htm). Mexican page has all 120 items; facet j of a domain starts
  at `domainStart + 5×(j−1)` (N/E/O/A/C start 1/2/3/4/5), other items +30/+60/+90.
- Reverse-keyed ids: N 51,81,96,101,106,111,116; E 62,67,92,97,102,107; O 48,53,68,73,78,83,88,98,103,108,113,118;
  A 9,19,24,39,49,54,69,74,79,84,89,94,99,104,109,114,119; C 30,40,60,70,75,80,85,90,100,105,110,115,120. To
  re-verify against the official key when the item bank is built.
- Mexican translation by David R. Frez Puente and Leticia Ortega Luque (https://ipip.ori.org/newItemTranslations.htm);
  no Mexican validation or norms report. Verified errors (parent spot check): facet C3 Dutifulness labelled
  «Debilidad»; item 73 «Rarely notice my emotional reactions» → «relaciones emocionales»; item 60 «Make rush
  decisions» → «Tomo decisiones rápidas» (rash ≠ fast). IPIP allows editing and translating; no separate
  translator-specific declaration found.
- Facet O6 Liberalism asks political and moral positions: 28 «Tiendo a votar por políticos liberales», 88 «Tiendo a
  votar por candidatos políticos conservadores», 58, 118. Political opinions and moral beliefs are sensitive data
  (LFPDPPP art. 2 fr. VI) and not job-relevant.
- Norms: Kajonius & Johnson 2019 Table A1, all 30 facets, US online volunteers N=320,128, «likely not nationally
  representative» (https://pmc.ncbi.nlm.nih.gov/articles/PMC7871748/). IPIP: «Most 'norms' are misleading, and
  therefore they should not be used», recommends local reference samples (https://ipip.ori.org/newNorms.htm). No
  Mexican norms for the 120/300 versions found; Argentina IPIP-NEO-300 study N=499 (facet α .59–.88) not transferable.
- Attention/consistency: option overuse, infrequent responses, psychometric synonym/antonym pairs
  (https://ipip.ori.org/newValidity.htm); instructed-response checks, long-string, response time (< 2 s/item is a
  heuristic, not a validated threshold, https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2023.1197324/full).
  Signals detect possible insufficient effort, not lying; calibrate in a pilot.
- Bartram 2005 Great Eight (https://doi.org/10.1037/0021-9010.90.6.1185): competency titles are SHL copyright, free
  for research with acknowledgment only. Observed Big Five–competency correlations are small (.07–.18), and no
  validated facet → competency weights exist. Narrow conscientiousness facets add prediction depending on occupation
  (Dudley et al. 2006, https://pubmed.ncbi.nlm.nih.gov/16435937/). IPIP gives no interpretation manual and cautions
  against sorting people into categories (https://ipip.ori.org/InterpretingIndividualIPIPScaleScores.htm).

## Mexican data protection (LFPDPPP, new law DOF 2025-03-20, last reform 2025-11-14)

Source: http://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf.

- Art. 2 fr. VI, sensitive data: «Aquellos datos personales que afecten a la esfera más íntima de la persona titular,
  o cuya utilización indebida pueda dar origen a discriminación o conlleve un riesgo grave para esta», including
  «creencias religiosas, filosóficas y morales». A personality and values profile used to select people very likely
  falls here; the user should confirm with legal advice.
- Art. 8: sensitive data needs «consentimiento expreso y por escrito … a través de su firma autógrafa, firma
  electrónica, o cualquier mecanismo de autenticación»; databases of sensitive data only for «finalidades legítimas,
  concretas y acordes».
- Art. 12: limit the processing period of sensitive data to «el mínimo indispensable» (retention policy needed).
- Art. 26 fr. II: right to oppose automated processing that evaluates «sin intervención humana» aspects such as
  «rendimiento profesional … fiabilidad o comportamiento». The design must keep a human decision in the loop.

## Proposals (agent, not agreed)

1. Start from the hiring decision: a psychometric profile on the vacancy (what matters for this role), suggested from
   the vacancy like the checklist suggestion.
2. Proportional battery: none, short screening, or full battery, triggered by a pipeline stage, never by default.
3. Results as fit to the job profile on the card and sheet, feeding the vacancy checklist as automatic criteria.
4. Interview guide generated from gaps and inconsistencies: what to ask to confirm each one (structured interview, the
   strongest predictor).
5. Telemetry in tiers (sin señales, algunas señales, señales relevantes) with plain explanations, never «mintió».
6. Company-authored situational tests, assisted by the system, with the recruiter's «best answer».
7. Instruments: work-contextualized IPIP personality first; cognitive (ICAR) only when the job needs it; licensed
   classics only through a partner, if ever.
8. Consent screen with electronic acceptance, privacy notice, retention period, and visibility rules; a human always
   decides.

## Open questions for the recruiter

1. Who requests the tests (the client or the recruiter), at which stage, how long they take, how many candidates drop.
2. Which tests they use by name; same battery for every role or per role; cost per evaluation or license.
3. Which part of the report they really read and which they ignore; whether they hand it to the client as is or
   rewrite it; an example report without personal data.
4. Has a result ever changed a hiring decision; when yes and when no.
5. What they hate about the current software; what they copy by hand between it and their ATS.
6. How they detect today that someone answered with help or «para quedar bien».

## Log

- **L1** (user, verbatim): «quisiera retomar la idea de los examenes psicometricos dentro de este sistema.. y lo
  considero una feature grande porque no quiero que sea algo generico/comun o simplemente una feature de un examen
  donde se responden las preguntas y ya, quiero algo mas alla, realmente quiero que sea una feature con mucho valor
  para el proceso de reclutamiento (en caso de necesitarse) porque realmente no en todos los procesos de seleccion van
  a necesitar un examen psicometrico completo, etc.. pero quiero platicarlo contigo.. que piensas?»
- **L2** (user, verbatim): «1. estan abiertos a instrumentos distintos si el resultado les sirve mas. 2. No, no hay
  ningun psicologo, de hecho me parece que usan un software aparte, es decir, un cliente los contacta y les pide que
  hay que hacer examenes psicometricos, esto pasa cuando las posiciones son muy c-level y muy especialidades, el tema
  aqui es que yo he visto muy por encima como ocupan estos sistemas (pero aun asi le pregunte a un reclutador para que
  me diga mas en detalle el proceso que se ocupaba y poder orientarnos mas sobre que funcionalidades ayudarian) y si
  recuerdo que lo que vi, eran examenes de todo tipo, median muchas cosas, tiempos de respuesta, si cambias de
  respuesta, si borras y luego vuelves a ponerlo, etc.. las preguntas eran de todo tipo, matematicas inclso, y
  preguntas mas especificas para perfilar al candidato "psicometricamente".. entonces, no se cual sera el camino,
  porque no conozco la verdad los otros softwares de los que hablas, no se si tu los conozcas a profundidad. 3 me
  atraen las dos cosas, pero creo que podemos tomar muchas cosas de otros softwares y tambien de la personas a la que
  le pregunte, que es reclutador experimentado de empresas grandes, no hay que quedarnos solo en una funcionalidad que
  haga bulto, realmente hay que conseguir que aporte valor real. me sigues?»
- **L3** User authorized the market research («si hermano, seria de mucha ayuda»); this record is its result.
- **L4** (user, verbatim): «y eso de ipip, esta realmente al nivel?? y donde se pagan las otras licencias? cuanto
  cuestan??» — answered with the IPIP level and price sections above.
- **L5** User leans to IPIP («creo que lo mejor es usar ipip, pero lo platicamos») and relays the recruiter's answer
  (verbatim): «En Trust pues solo hacemos las de psicotest que la neta están bien pinches (trust es la empresa donde el
  trabajaba). El tema es que nunca tuvimos como tal control, solo mandábamos la liga pero jamás entrábamos. Mira, como
  reclutador, creo que esperaría principalmente que una prueba psicométrica me diera información que realmente pueda
  utilizar para tomar decisiones, más allá de solo darme gráficas o porcentajes. Por ejemplo, me ayudaría mucho que el
  software pudiera: Traducir los resultados en información práctica: no solo decirme que alguien tiene liderazgo, sino
  explicarme cómo podría reflejarlo en el trabajo, cuáles son sus fortalezas y qué áreas tendría que desarrollar.
  Comparar el perfil con la vacante: que me ayude a identificar qué tan alineado está el candidato con las competencias
  que realmente requiere la posición, sin limitarse a decirme si es apto o no apto. Identificar focos de atención:
  posibles áreas de riesgo, incompatibilidades con las exigencias del puesto o aspectos que valdría la pena profundizar
  durante la entrevista, sin convertirlos automáticamente en motivos de descarte. Ahorrar tiempo: que el reporte sea
  claro, visual, fácil de interpretar y que no tenga que ser especialista en psicometría para entender qué significan
  los resultados. Generar preguntas de entrevista personalizadas: que, con base en los resultados, me sugiera qué
  preguntarle al candidato para validar o profundizar en ciertas competencias. Dar resultados confiables y objetivos:
  que las pruebas estén validadas, tengan criterios claros y reduzcan los sesgos, en lugar de etiquetar a las personas
  con base en un resultado aislado. Al final, para mí el mayor valor sería que el software conectara la evaluación
  psicométrica con la realidad del puesto y me ayudara a tomar decisiones más informadas, rápidas y sustentadas.»
  User: «el aqui esta hablando de una herramienta EXTERN pero nosotros podriamos llevarlo al siguiente nivel agregando
  aparte la incorporacion directa enel sistema». Agent reading: the six asks match proposals 1–5 and 7; the new pain is
  no control after sending the link (status, reminders, telemetry belong in the pipeline).
