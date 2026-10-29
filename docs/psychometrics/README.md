# Psychometric content v1 — F1 review package

**Status: authored draft, pending user review and pilot; not launch approval.** This package covers T3, S2–S6 and S8 from `odd/tasks/psychometric-tests.md`, including the L8–L10 decisions. It specifies content, not UI or an API contract. Assessment is optional; evidence supports a human interview, never automatic rejection or pipeline movement.

## Read in this order

| File | Purpose | Coverage |
|---|---|---|
| [Item bank](item-bank-v1.md) | 116 items, bilingual provenance, corrected Spanish, official keys, response scale and scoring | S3 |
| [Quality signals](quality-signals-v1.md) | Three attention items, separate telemetry, provisional signal thresholds and tier wording | S3, S4, S6 |
| [Bands and competencies](bands-and-competencies-v1.md) | 29 facet explanations, six original competencies, fixed cut points, vacancy profile, fit and focus | S2, S3, S5, S6 |
| [Interpretation library](interpretation-library-v1.md) | 18 deterministic competency × band entries | S5 |
| [Interview bank](interview-bank-v1.md) | 72 backend-owned questions, fixed selection and result snapshots | S8 |

User-facing content is Mexican Spanish using tú when addressing the reader; specifications and rationale are English. Original English names and hosted wording are provenance, not PeopleFlow diagnostic terminology. We author no clinical interpretations or questions about private beliefs or intimate life. Excluded O6 content is not reproduced.

## Non-negotiable computation boundaries

- 29 retained facets × 4 personality items = 116, plus 3 attention items = 119 administered prompts. Preserve original numbers; exclude 28, 58, 88 and 118.
- Finish only when every personality and attention item has a valid final response. No prorating or partial result. Attention correctness never blocks finishing.
- Reverse key = `6 − response`; facet sums = 4–20. No domain scores in v1, especially no full Openness score from five facets. No personality total, foreign percentiles, ranking or overall fit.
- Facet bands have fixed integer cut points: 4–9 low, 10–14 medium, 15–20 high. Competency indices use the exact mean of their two oriented facets with fixed thresholds <10 / 10–<15 / ≥15, without rounding. A negative facet link is `24 − facet_sum`.
- Bands describe self-report meaning. Competency links, equal weights and thresholds are authored hypotheses, not validated performance estimates. All interpretations remain conditional until supported by work examples.
- Quality tiers never change personality scores, competency bands or fit. Their only derived action is one interview focus. No outcome automatically discards, moves, blocks or approves a candidate.
- The backend scores and selects questions deterministically. Store the selected ordered question ids **and resolved text**, interpretation ids/text and comparison snapshot with the result. Keys stay off the candidate client. No AI in F1.

## Stable ids and versioning

Initial release identifiers: `scoring_version = psychometrics.scoring.v1`; `content_version = psychometrics.content.v1`. These are proposal values for the contract, not migrations. Freeze approved content before production use. A result always stores both versions and its profile version (nullable); results cannot depend on a mutable “latest” lookup.

Canonical definitions, as opposed to references:

| Namespace | Definition owner | Count |
|---|---|---|
| item.ipip.N | Item rows in item-bank-v1.md | 116 |
| facet.code | Facet label map in item-bank-v1.md | 29 |
| attention.N | Attention insertions in quality-signals-v1.md | 3 |
| signal.name | Signal definitions in quality-signals-v1.md | 4 |
| tier.name | Tier table in quality-signals-v1.md | 3 |
| band.name | Fixed semantic bands in bands-and-competencies-v1.md | 3 |
| comp.name | Catalog in bands-and-competencies-v1.md | 6 |
| importance.name | Vacancy importance table in bands-and-competencies-v1.md | 3 |
| fit.name | Fit table in bands-and-competencies-v1.md | 3 |
| focus.name | Focus rules in bands-and-competencies-v1.md | 3 |
| lib.competency.band | Interpretation-library rows | 18 |
| q.competency.selector.N | Interview-bank rows | 72 |

Do not reuse retired ids for a different meaning. References intentionally repeat ids across files; each canonical definition is unique. Dynamic focus identity uses result id + focus type + competency id (null for global quality); no counter or new registry is needed.

Increment scoring_version for keys, membership, reversal, aggregation, cut points, mapping weights/directions, quality thresholds, fit/focus logic or question-selection changes. Increment content_version for any text, label, translation, question, checklist or library change. An administered item edit, response-option change, item order or attention change increments **both**, even when arithmetic is unchanged, because response meaning or process may change. A mapping or selection change also increments content_version if its displayed explanation changes. Store the exact administered content version from the start of the attempt; finishing must use that pinned pair, not a version released midway through the attempt.

Keep old versions available for audit and reproducible rendering. Never silently rescore, relabel or regenerate old reports. If comparison against a revised vacancy profile is requested, create an explicitly new comparison/guide snapshot with its own versions and preserve the original result. Do not compare candidates across differing versions as though scores were interchangeable. Released content is immutable; corrections require a new version and review.

## Sources, attribution and license

Attribution to retain with the bank and in product credits:

> IPIP (ipip.ori.org), public domain; translation by David R. Frez Puente and Leticia Ortega Luque, edited by PeopleFlow.

IPIP allows copying, adaptation and commercial use: https://ipip.ori.org/newPermission.htm. Translation credits: https://ipip.ori.org/newItemTranslations.htm. The bilingual source is https://ipip.ori.org/MexicanIPIP-NEO-120.htm; official keys are https://ipip.ori.org/30FacetNEO-PI-RItems.htm. The latter two pages were fetched during this task. Other cited sources are already recorded in `odd/discovery/psychometric-tests.md`; no additional validation claims are inferred from them.

Public-domain permission does not confer validation, local norms or endorsement. No separate translator-specific declaration was found in the discovery; preserve named credit. The competency catalog, thresholds, library, attention wording and questions are original PeopleFlow editorial content, not a third-party licensed competency framework. Bartram (2005), https://doi.org/10.1037/0021-9010.90.6.1185, is research background only; proprietary framework titles are not reproduced. No license to a proprietary inventory is implied.

## Open items — user decisions before release

1. **Approve or revise every correction and every facet display label.** The item-bank summary is marked «pendiente de revisión del usuario». C3 is Cumplimiento de compromisos, not its hosted mistranslation. Pay special attention to 26's non-clinical approximation, 43's English source discrepancy, 60's rash/rush discrepancy, 71's meaning, and 73's reactions correction. This is translation editing, not evidence of equivalence; obtain a qualified content review and pilot comprehension.
2. **Decide whether to retain the following borderline facets for recruitment.** The exact retained item ids and final proposed administered wording appear below. These everyday-worded items can still approach mood, self-appraisal or private response states. A neutral display label does not remove that concern. N1–N6 and E6 currently contribute to no competency or job fit; O3 is also unmapped. Keeping or removing them is a user decision, not permission for an interviewer to probe private causes. Until decided, this draft retains the agreed 116-item scope. Removing anything requires a new scope, count, scoring/content versions and contract review; do not silently delete rows.
3. **Approve the six competency definitions and hypotheses**, including the equal-weight mean and inverse E5 link. Review whether combining two facets obscures important differences. No performance validation or job-specific weighting is established.
4. **Approve fixed semantic boundaries and fit terminology** as editorial summaries, not norms. Desired bands must follow actual tasks; do not assume high is always preferred. Confirm a recruiter can justify importance and desired band per vacancy.
5. **Pilot the response scale, three attention instructions and provisional signal rules.** Decide whether the scale is clear, whether flags are useful, and whether device/accessibility conditions produce false alarms. Threshold revisions must be versioned. Answer changes alone are not a verdict.
6. **Review all 18 library entries and 72 questions**, including the global quality routing fallback, maximum eight-question guide and STAR follow-up. Confirm that work/study examples are sufficient and no private explanations are requested.
7. **Confirm retention, consent, access and legal review through the parent feature work.** This package specifies neither the notice nor a retention duration, encryption or delivery implementation. It is not a substitute for S12 or the user-owned pre-launch review.

### Borderline facet inventory — exact proposed administered items

These are source-derived assessment quotations for review, not recruiter-facing interpretations. Original English and hosted Spanish provenance remain in the item bank. Review the entire listed facet, including reverse-keyed items, rather than cherry-picking a single prompt.

| Facet reference | Exact items: original number / stable id / proposed Spanish |
|---|---|
| N1 / facet.n1 | 1 / item.ipip.1: «Me preocupo por las cosas.»; 31 / item.ipip.31: «Temo lo peor.»; 61 / item.ipip.61: «Tengo miedo a muchas cosas.»; 91 / item.ipip.91: «Me estreso fácilmente.» |
| N2 / facet.n2 | 6 / item.ipip.6: «Me enojo fácilmente.»; 36 / item.ipip.36: «Me irrito fácilmente.»; 66 / item.ipip.66: «Pierdo los estribos.»; 96 / item.ipip.96: «No me molestan fácilmente.» |
| N3 / facet.n3 | 11 / item.ipip.11: «A menudo me siento desanimado.»; 41 / item.ipip.41: «No me agrado.»; 71 / item.ipip.71: «A menudo me siento desanimado.»; 101 / item.ipip.101: «Me siento cómodo conmigo mismo.» |
| N4 / facet.n4 | 16 / item.ipip.16: «Me resulta difícil acercarme a otros.»; 46 / item.ipip.46: «Tengo miedo de llamar la atención.»; 76 / item.ipip.76: «Solo me siento cómodo con mis amigos.»; 106 / item.ipip.106: «No me molestan las situaciones sociales difíciles.» |
| N5 / facet.n5 | 21 / item.ipip.21: «Tiendo a excederme.»; 51 / item.ipip.51: «Rara vez cedo a los excesos.»; 81 / item.ipip.81: «Resisto sin dificultad a las tentaciones.»; 111 / item.ipip.111: «Soy capaz de controlar mis antojos.» |
| N6 / facet.n6 | 26 / item.ipip.26: «Pierdo la calma fácilmente.»; 56 / item.ipip.56: «Me abrumo por acontecimientos.»; 86 / item.ipip.86: «Siento que no puedo hacer frente a las cosas.»; 116 / item.ipip.116: «Mantengo la calma bajo presión.» |
| E6 / facet.e6 | 27 / item.ipip.27: «Irradio alegría.»; 57 / item.ipip.57: «Me divierto mucho.»; 87 / item.ipip.87: «Amo la vida.»; 117 / item.ipip.117: «Veo el lado positivo de la vida.» |
| O3 / facet.o3 | 13 / item.ipip.13: «Experimento mis emociones intensamente.»; 43 / item.ipip.43: «Siento las emociones de los demás.»; 73 / item.ipip.73: «Rara vez noto mis reacciones emocionales.»; 103 / item.ipip.103: «No comprendo a la gente que se pone muy emocional.» |

N3's original English facet name is recorded in the provenance map; its label must not be treated as a diagnosis. The duplicated proposed wording for 11 and 71 reflects overlapping source meanings and is an explicit pilot/review concern, not an intentional attention check. Broader relevance review should also consider unmapped leisure or self-appraisal facets O1/O2/A5; no unreviewed mapping should be invented to make them seem job-relevant.

## Structural verification contract

Count only canonical item rows (second column is `item.ipip.N`), not correction tables or README references. Check 116 unique original numbers, 29 facets × 4, excluded numbers absent, and every sign against official facet/text groups (not within-group ordinal position). Validate canonical id uniqueness by namespace, six complete competency sets in both dependent banks, three band entries per competency and two questions per competency/selector. References are not duplicate definitions. Checks are structural, not a pilot, content approval or proof of validity.
