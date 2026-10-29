# Psychometric content v1 — F1 review package

**Status: unreleased authored draft, pending user wording approval, legal review and pilot; not launch approval.** Covers T3 + T5, S2–S6, S8 and S12 from `odd/tasks/psychometric-tests.md`, including L15: administer only competency-linked facets. Assessment is optional; evidence supports a human interview, never automatic rejection or pipeline movement. The content documents and [contract](../contracts/psychometric-tests-v1.md) use one vocabulary.

## Read in this order

| File | Purpose | Coverage |
|---|---|---|
| [Item bank](item-bank-v1.md) | 60 items, 15 facets, bilingual provenance, corrected Spanish, keys, scale and full 63-position order | S3 |
| [Quality signals](quality-signals-v1.md) | 3 attention items at 16/32/48, telemetry and provisional integer thresholds | S3, S4, S6 |
| [Bands and competencies](bands-and-competencies-v1.md) | 15 facet explanations, 7 competencies, exact band rules, confirmed vacancy profile, fit/focus | S2, S3, S5, S6 |
| [Interpretation library](interpretation-library-v1.md) | 21 deterministic competency × band entries | S5 |
| [Interview bank](interview-bank-v1.md) | 84 backend-owned questions, fixed selection, max 8 per guide, stored text | S8 |
| [Consent notice](consent-notice-v1.md) | Mexican Spanish notice v1; pendiente de revisión legal (D9) | S12 |

User-facing content is Mexican Spanish using tú; specifications and rationale are English. Original English/hosted wording is provenance, not diagnostic terminology. No clinical interpretations or questions about private causes, health, mood, beliefs or intimate life. Excluded content is not reproduced.

## L15 scope and computation boundaries

- 15 facets × 4 = 60 personality items, plus 3 attention = 63 prompts. Retain C2/C5, C3/C4, E3/E1, A3/A4, O4/O5, C6/E5 and N1/N2/N6. The first six pairs feed six competencies; the last three feed comp.presion («Manejo de la presión»), all negative direction. No other facet is administered. Excluded-facet provenance and minimization rationale (LFPDPPP arts. 8/12) are in the item bank.
- Fixed ascending original-number order per content version; insert attention after retained items 15/30/45, exactly positions 16/32/48. Never shuffle. Keep surviving item/facet ids and keys stable.
- Finish requires all 63 valid final answers; no prorating or partial result. Attention correctness never blocks finishing.
- Reverse item = `6 − response`; facet sum = 4–20. No domain scores, personality total, foreign percentiles, ranking or overall fit.
- Facet bands: 4–9 / 10–14 / 15–20. Orient negative facet links as `24 − facet_sum`. For n linked facets, integer sum S gives low if S < 10n, medium if S < 15n, else high. Six competencies have n=2; pressure n=3. Store all oriented sums, S and n. `index` is display-only S/n rounded half-up to one decimal string; never classify on it.
- Bands, equal weights, competency links and thresholds are authored hypotheses, not validated performance estimates. Always contrast with work examples. No band is intrinsically preferable.
- Fast: <2000 ms on 12–29 of 60 mild, ≥30 strong, unknown without all 60 valid elapsed values. Changes: ≥30 interactions mild, never strong alone. Long-string: 7–11 mild, ≥12 strong; proportional scaling rationale and pilot caveat in quality signals. Attention: 1 miss mild, 2–3 strong out of 3.
- Quality never changes scores, bands or fit. Its only derived action is one interview focus. No automatic discard, move, block or approval.
- Exactly seven profile entries. Confirmation requires per-entry job rationale (1..1000 characters after trim), plus task (1..300) for Clave; confirmed_at is distinct from enabled. Unconfirmed → null fit, bands/exploratory guide, never completion blocking.
- Profile edits affect future results only. Explicit comparison POST creates a new stored fit/focus/guide against the current confirmed profile; no recompute-on-read. Bands and interpretation selection remain immutable.
- Backend scores and deterministically selects. Store ordered question ids **and resolved text with STAR**, checklists, interpretation ids/text and every comparison snapshot. Frontend renders stored bank text; band/fit/tier labels stay frontend-mapped. Keys stay off the candidate client. No AI in F1.
- Server derives changes/clears/reanswers from ordered accepted writes with required UUID event_id. Replay is a no-op; same-value PUT updates cumulative visible elapsed time but is not a change. No client change counter.

## Stable ids and versioning

`content_version = psychometrics.content.v1`; `scoring_version = psychometrics.scoring.v1`. The same v1 files remain unreleased; L15 is a draft revision, not a released-version mutation. Nothing ships until user wording approval. Freeze approved content before production use. Pin both versions when creating the invitation; never finish against a mutable latest lookup.

Canonical definitions, not references:

| Namespace | Definition owner | Count |
|---|---|---|
| item.ipip.N | Item rows in item-bank-v1.md | 60 |
| facet.code | Facet label map in item-bank-v1.md | 15 |
| attention.N | Attention insertions in quality-signals-v1.md | 3 |
| signal.name | Signal definitions in quality-signals-v1.md | 4 |
| tier.name | Tier rule table in quality-signals-v1.md | 3 |
| band.name | Fixed semantic bands in bands-and-competencies-v1.md | 3 |
| comp.name | Competency catalog in bands-and-competencies-v1.md | 7 |
| importance.name | Vacancy importance table in bands-and-competencies-v1.md | 3 |
| fit.name | Fit table in bands-and-competencies-v1.md | 3 |
| focus.name | Focus rules in bands-and-competencies-v1.md | 3 |
| lib.competency.band | Interpretation-library rows | 21 |
| q.competency.selector.N | Interview-bank rows | 84 |

Do not reuse retired ids. References intentionally repeat across files (including the order table); each canonical definition is unique. Dynamic focus identity is comparison id + focus type + competency id (null for global quality); no new registry is needed. Each comparison is immutable, so a later one never replaces the original instance.

Increment scoring_version for keys, membership, reversal, aggregation, cut points, mapping weights/directions, quality thresholds, fit/focus logic or question-selection changes. Increment content_version for text, labels, translations, questions, checklists or library changes. An administered item edit, response-option change, order or attention change bumps **both**, even without arithmetic changes. Mapping/selection edits also bump content_version if the displayed explanation changes. Released content is immutable; corrections require a new version and review.

Keep old versions for audit and reproducible rendering. Never silently rescore, relabel or regenerate old reports. New explicit comparisons preserve the original result and all prior comparisons and use that invitation's pinned content/scoring pair with the newly confirmed profile. Never compare differing versions as interchangeable.

## Sources, attribution and license

Attribution to retain with the bank and product credits:

> IPIP (ipip.ori.org), public domain; translation by David R. Frez Puente and Leticia Ortega Luque, edited by PeopleFlow.

IPIP allows copying, adaptation and commercial use: https://ipip.ori.org/newPermission.htm. Translation credits: https://ipip.ori.org/newItemTranslations.htm. Bilingual source: https://ipip.ori.org/MexicanIPIP-NEO-120.htm; official keys: https://ipip.ori.org/30FacetNEO-PI-RItems.htm. The prior content task audited the keys against those pages; this revision preserves surviving keys. Other sources are recorded in `odd/discovery/psychometric-tests.md`; no additional validation is inferred.

Public-domain permission does not confer validation, local norms or endorsement. No separate translator-specific declaration was found in discovery; preserve credit. Competency catalog, thresholds, library, attention wording and questions are original PeopleFlow editorial content, not a licensed third-party framework. Bartram (2005), https://doi.org/10.1037/0021-9010.90.6.1185, is research background only; proprietary framework titles are not reproduced. No proprietary inventory license is implied.

## Open items — before release

1. **Approve every surviving correction and facet display label**, especially item 26's non-clinical approximation and item 60's rash/rush discrepancy. C3 means Cumplimiento de compromisos, not Debilidad. Obtain qualified content review and pilot comprehension; editing is not equivalence evidence.
2. **Approve the seven competency definitions and hypotheses**, including equal weights, inverse E5 and three inverse pressure facets. No performance validation or job-specific weighting is established. The borderline-facet scope decision is resolved by L15, not reopened here.
3. **Approve fixed boundaries and fit terminology.** Recruiter-confirmed desired bands and importance must follow actual tasks, not a high-is-always-best default.
4. **Pilot scale, attention and provisional signal rules**, including timing coverage, accessibility/device effects and false alarms. Answer changes alone are not a verdict; threshold revisions must be versioned.
5. **Review all 21 interpretations and 84 questions**, quality routing, max-eight guide and fixed STAR. Work/study examples must suffice without private explanations.
6. **Complete D9 legal review before launch**, including consent/notice, company contact channels and sensitive-data handling. Contract retention is 12 months, with finish/expiry/revocation anchors; consent is express electronic, company recruiters only, no candidate result in v1, manual ARCO/opposition.

## Structural verification contract

Count only canonical item rows (second column item.ipip.N and a facet column), not the fixed-order reference table. Require 60 unique original numbers, 15 allowed facets × 4, ascending fixed order, exactly 3 attention insertions at 16/32/48, and no excluded item rows. Verify unique canonical ids by namespace; repeated references and rendering-message tables are not duplicate definitions. Require seven complete dependent competency sets: 3 library entries and 12 questions (2 per six selectors) each. Cross-check all concrete contract content ids against the package. These checks are structural, not a pilot, content approval or proof of validity.
