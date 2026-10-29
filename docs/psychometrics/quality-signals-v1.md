# Quality signals v1 — provisional pilot rules

Signals describe response patterns, not truthfulness or job suitability. They never alter personality scores, fit, pipeline status or access to an interview. All numeric thresholds below are product hypotheses **provisional until a pilot**, not validated cutoffs. Show the grouped tier with its reasons and denominators, not a suspicion score.

## Attention insertions

Use the same five response options as the personality bank. Insert these three items after the 29th, 58th and 87th **retained personality item** in ascending original-number order (original numbers 30, 60, 90). They occupy administered positions 30, 60 and 90 of 119. Never shuffle in v1; do not insert consecutively or include them in facet sums or long-string calculations. Finishing requires an answer to all three; a wrong answer does not block finishing or require correction.

| Attention id | Candidate text | Expected response |
|---|---|---|
| attention.1 | Para esta frase, elige «Algo inexacto». | 2 |
| attention.2 | Para esta frase, elige «Muy exacto». | 5 |
| attention.3 | Para esta frase, elige «Ni exacto ni inexacto». | 3 |

Only final answers count toward missed checks; earlier answers and changes remain telemetry. Do not coach the expected answer after submission.

## Signal definitions

One signal id per row; severity is none, mild or strong. Any unavailable telemetry is unknown, never silently counted as zero. Only completed results receive a tier. Personality answers alone suffice for pattern calculations; telemetry is optional.

| Signal id | Calculation / boundary | Mild | Strong |
|---|---|---|---|
| signal.attention | Number of final instructed responses not matching the expected value, denominator 3 | Exactly 1 miss | 2 or 3 misses |
| signal.long_string | Longest consecutive run of identical raw 1–5 personality answers, in fixed retained-item order. Ignore attention insertions; do not reverse-key here. | Run length 12–19 | Run length ≥20 |
| signal.fast | Count personality items with measured cumulative active viewing time strictly below 2000 ms; divide by 116. Require valid time for all 116 or mark unknown. | Count 24–57 (at least 20%, below 50%) | Count ≥58 (at least 50%) |
| signal.changes | Sum of value changes + clearing events + re-answer-after-clearing events across 116 personality items. First answer excluded; same-value saves, replayed events and retries excluded. | Count ≥58 | Never strong on its own |

None = below mild threshold. A run spanning an attention insertion remains a run because the rule explicitly measures only the personality sequence. This can reflect genuine shared responses, not inconsistency. There is no v1 synonym-pair contradiction score: no calibrated pairs exist in this edited battery. “Consistency” is an umbrella for attention, repetition and response-process observations, not a claim to measure deception.

### Time and answer-change semantics

- Start active time when the item is visibly presented in the active tab; pause on hidden tab, navigation away or suspended session. Sum visible intervals over revisits. Time is cumulative per item, not just time to its last click. No negative, non-finite or missing duration is usable. Keep milliseconds; exactly 2000 ms is not fast. Do not infer time for an offline gap from server timestamps.
- Client time is forgeable. Retain server receipt timestamps for audit, but never treat client or server timing as proof. The <2 s/item boundary is a heuristic; reading style, device and accessibility can affect it. No time limit, lockout or penalty follows.
- Record separately: value-to-different-value, nonempty-to-empty, and empty-to-value after a prior answer. Example: empty → 2 → 4 → empty → 3 gives one value change, one clear, one re-answer: total 3. A clearing followed by re-answering is intentionally two interactions, not two value changes.
- Count accepted transitions using ordered, deduplicated event ids; repeated network delivery is not another edit. Track per-item subtotals, aggregate counts and whether collection was complete. Never infer unseen edits from final answers. A resumed or partially missing stream makes `signal.changes` unknown, not none. Attention-item edit counts may be stored separately, but never added to this denominator or threshold.

## Deterministic tiers

Evaluate all available signal severities first. Strong counts as one signal, not both mild and strong. Unknown contributes no severity, but must be disclosed separately.

| Tier id | Recruiter label | Exact rule, in priority order |
|---|---|---|
| tier.relevantes | Señales relevantes | Any strong signal OR at least 2 mild signals |
| tier.algunas | Algunas señales | Exactly 1 mild signal and no strong signals |
| tier.sin | Sin señales | No observed mild or strong signals |

`Sin señales` means no signals detected in available data, never certified validity. If telemetry is missing, display the tier with «Información parcial: no se registraron todos los tiempos o cambios de respuesta.» If both telemetry streams are unavailable, attention and long-string still determine the observed tier. Store the per-signal availability alongside the tier. Do not change thresholds for an individual result or treat unavailability as a focus area by itself.

## Recruiter wording

Display one tier message plus reason messages in the table order above. Interpolate only the computed integer counts, not generated judgments. For long-string show run length; for timing show count out of 116; for attention show count out of 3; for changes show all three subtotals and their sum. Signal reasons are visible only when triggered, with the stronger variant taking precedence.

| Id / condition | Exact Spanish text |
|---|---|
| tier.sin | No se detectaron patrones que requieran seguimiento con la información disponible. Esto no confirma por sí solo la calidad de las respuestas. |
| tier.algunas | Hay un patrón que conviene aclarar. Pregunta cómo fue la experiencia al responder y confirma ejemplos de trabajo antes de sacar conclusiones. |
| tier.relevantes | Hay patrones que requieren más contexto. Confirma cómo se respondió y contrasta lo declarado con ejemplos de trabajo; no los uses como motivo de descarte. |
| signal.attention | No coincidieron {misses} de 3 instrucciones de respuesta. Pregunta si las instrucciones fueron claras. |
| signal.long_string | Se repitió la misma opción en {run} frases seguidas. Confirma con ejemplos si las frases describen situaciones distintas. |
| signal.fast | Se registraron menos de 2 segundos en {fast_count} de 116 frases. El tiempo registrado puede ser incompleto o modificable; pregunta cómo se respondió. |
| signal.changes | Se registraron {value_changes} cambios de opción, {clears} borrados y {reanswers} respuestas después de borrar: {total} interacciones. Cambiar una respuesta puede ser una reconsideración; pregunta qué motivó los ajustes. |

For `tier.algunas` or `tier.relevantes`, create one `focus.quality` as specified in [bands and competencies](bands-and-competencies-v1.md), carrying all triggered signal ids. Do not create one focus per event or modify any band. Wording avoids attributing intent; interview questions ask about response conditions without requesting private explanations.

## Evidence boundary and pilot

Background only: instructed-response, long-string and response-time methods, https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2023.1197324/full; IPIP validity suggestions, https://ipip.ori.org/newValidity.htm. Telemetry limits: https://doi.org/10.3758/s13428-014-0524-5 and https://pmc.ncbi.nlm.nih.gov/articles/PMC8863730/ (all recorded in discovery). These sources do not validate our thresholds, item wording or tier aggregation.

Before launch, pilot comprehension, timing coverage, distributions and combinations of signals, device/accessibility effects, completion rates and recruiter interpretation. Review false alarms against voluntarily supplied response context, not against an assumed honesty label. Publish any changed thresholds as a new scoring version; never silently recompute old tiers. Answer-change thresholds are operational review prompts without an empirical calibration claim.
