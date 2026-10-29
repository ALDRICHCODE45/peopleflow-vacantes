# Psychometric content artifact

Backend-only, unreleased v1 catalog for S1/B1. Wording approval, legal review and
pilot remain release prerequisites. There is no scoring, HTTP or database code.

## Use

`Load(Version)` returns a validated immutable artifact; unknown versions fail.
`Snapshot()` returns a deep detached `Document`, including nested slices and
threshold pointers. `Decode` applies the same structural validation to serialized
artifacts. No exported mutable global or filesystem lookup is used at runtime.
**Never expose the document to candidates:** it contains keys, facet links and
attention expectations. Candidate DTO projection belongs to a later slice.

## Regenerate and verify

From `backend/`:

```sh
go test ./internal/features/psychometrics/content -run '^TestDocumentationDrift$' -update-content
go test ./internal/features/psychometrics/...
go vet ./... && go test ./internal/features/psychometrics/...
go run ./cmd/archguard
```

The opt-in test helper reads repository `docs/psychometrics/` relative to the test
package and writes only `content.v1.json`. Ordinary tests never update fixtures.
Review the resulting JSON diff, then rerun without the update flag. The drift
guard compares every parsed field, preserving catalog/link/question order, and
reports the canonical id and field on differences. Structural rejection tests
exercise the public decoder. No git history, dependencies, temporary state or
external services are needed.

## Text bytes and canonicalization

- Item text is **Corrected Spanish**, not either provenance column. Keys are the
  literal ASCII `+` / `-` signs from the canonical item table.
- Facet labels are the right-hand side of the facet map's `→` column.
- Interpretation cells replace each literal `<br>` with one LF, preserving the
  two authored lines. The prepend, three section headings and hypothesis sentence
  are separate required data; consumers must retain them in resolved snapshots.
- Question text and STAR are separate data. Append the fixed STAR to **every**
  selected question when resolving the later scoring/guide snapshot.
- Notice v1 is the text strictly between the `## Inicio del aviso` and
  `## Fin del aviso` heading lines in `consent-notice-v1.md`. Remove only LF bytes
  at the two outer edges (the blank separator lines). Keep all paragraph breaks,
  bullet markers, punctuation and internal whitespace verbatim. There is **no
  trailing LF**, heading, review metadata, BOM or Unicode normalization in the
  hashed text. SHA-256 is lowercase hexadecimal over these exact UTF-8 bytes.
  The authoring parser rejects CR bytes; it does not silently normalize CRLF.

Integer thresholds are parsed from the current canonical quality table, not the
historical scaling rationale. `strong_min: null` means the changes signal cannot
be strong alone; zero denominator for long-string means it reports a run, not a
fraction. Fast requires all 60 timings. The updated semantics explicitly retain
that the server-observed changes stream is always known in v1. Tier thresholds
and block limits are integers; the complete authored selection/telemetry prose
is also retained as data so rule edits cannot silently drift.

Released versions must not be regenerated in place. These versions are still
unreleased drafts; follow the source README's content/scoring bump rules before
freezing or changing a released artifact.
