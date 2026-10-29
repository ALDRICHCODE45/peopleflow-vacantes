# Pure psychometric scoring (B2 / S2)

`Score(artifact, Input)` returns detached result and initial comparison snapshots.
Pass the invitation's pinned `content.Artifact`, not a latest-content lookup.
There is no HTTP, database, clock, UUID generation or persistence in this package.
The later adapter adds invitation/comparison ids, timestamps and snapshot history.
Do not expose these backend-only results or the artifact to candidates.

## Inputs and errors

- `Answers` maps administered positions 1..63 to final integers 1..5. All are
  required, including attention positions. `MissingPositions` returns absent or
  invalid positions in presentation order. `Score` returns `*IncompleteError`
  for absent answers; invalid supplied values/extra positions are validation errors.
  Any error returns a zero result and never modifies inputs.
- `Events` contains **ordered, accepted, already deduplicated** server writes.
  `Value != nil` is PUT; `Value == nil` is DELETE. The accepting endpoint owns UUID
  replay suppression and order. Pass the whole history from the initially empty
  state, not only writes containing changes. Final answers and history must come
  from the same transaction snapshot; scoring does not reconstruct missing history
  from the final answers. Normal v1 history is complete, even if no edits occurred.
- `ElapsedMS` is the PUT's cumulative visible milliseconds, not a delta. The latest
  PUT supplies the current measurement, including same-value saves. DELETE clears
  the current measurement. Nil or values outside 0..3,600,000 are unavailable, not
  completion errors. All 60 personality positions need valid measurements for fast
  counts; attention timing is irrelevant. Exactly 2000 ms is not fast.
- `EventsIncomplete` is false for server-observed v1 writes. Set it only for an
  unavailable/incomplete imported stream: changes then has unknown severity and
  null counts. Missing timing independently makes fast unknown. Known signals
  alone determine the tier; partial information alone never creates a focus.
- `Profile` is nil without a confirmed profile. Otherwise supply its decimal version
  string and exactly seven unique canonical competency requirements. The profile
  writer owns rationale/task/confirmation validation; scoring checks ids,
  importance and the desired-band/null relationship. Enabled is not a scoring input.

## Outputs and ordering

Facets and competencies follow artifact order; contributing facets follow link
order. Negative items use `6-value`, negative links `24-sum`. Bands use integer
thresholds; the half-up one-decimal index string is display-only.

Interpretation snapshots preserve all three library sections verbatim, including
line breaks. Render `prepend`, the sections under their `headings`, then `hypothesis`;
these mandatory framing texts are stored separately, not silently dropped or
inserted into a bank section. Every guide question stores authored text followed by
one space and the fixed STAR text, plus the original checklist and selection metadata.
`question_ids` records guide order; profile/content/scoring versions are on comparison.
Focus identity can be derived later from comparison id + type + competency id.
Quality questions include `tier`, triggering signals and the `Contexto de respuesta`
label; routing is context, not a competency gap.

Gap focuses sort by importance, distance descending and id; quality is last.
Ordinary guide blocks sort by importance, focus priority and id. Without relevant
requirements, exploratory blocks have null importance/fit. Quality reserves the last
block, with at most three ordinary blocks; otherwise at most four. Questions are
always selected in pairs, ordinal 1 then 2, at most eight. No padding with irrelevant
competencies, randomization or live text lookup is performed by consumers.

Quality counts are exported typed structs (or nil for unknown), never unordered
maps. Empty arrays serialize as `[]`, nullable fit/direction as `null`. Identical
inputs produce byte-identical JSON with the standard encoder; input map insertion
order and profile entry order do not affect output. Result and comparison nested
slices are independent, and neither retains caller profile pointers.

## Verification

From `backend/`:

```sh
go vet ./... && go test ./internal/features/psychometrics/...
```

Public-API table tests pin facet and competency arithmetic boundaries, quality
thresholds and tiers, accepted transitions, optional telemetry, fit/direction,
focus/guide order and routing, STAR/checklist snapshots, missing positions,
validation, nonmutation and deterministic serialization. No external services,
scratch directories, repository history or fixture regeneration are needed.
