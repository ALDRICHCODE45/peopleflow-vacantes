# Employer Pipeline Width and Filters

## Goal

Widen the employer vacancy pipeline body to the shared `screen-2xl` measure and
add the Base de talento filter language — a floating Sheet with stage, source and
skill multi-selects, experience buckets and a received-date range — while
preserving the frozen four-stage vocabulary, the existing diacritic-insensitive
search, the truthful read-only prototype behavior, and both board/list modes.

## Scope

- Route `/empresa/vacantes/[jobId]/pipeline` mounts its `DashboardPageContent`
  with `width="screen-2xl"` as the single measure of the whole body in both views;
  the shell is untouched.
- Core filters: **Etapa** (`status`), **Origen** (`source`) and **Habilidades**
  (`skills`) as searchable multi-select comboboxes; **Experiencia** as the four
  closed buckets `0-2 / 3-5 / 6-9 / 10+`; **Fecha de recepción** as an inclusive
  civil-day range through the installed `DatePickerField` with `allowPast`.
- Values OR inside one facet and AND across facets plus the search. Options are
  derived from the unfiltered vacancy-scoped input, so filtering never removes an
  option.
- The received range compares `receivedAt.slice(0, 10)`, preserving the supplied
  offset's local civil day and staying inclusive on both bounds. Reversed bounds
  are reported, never silently swapped.
- The floating Sheet carries a title, description, scroll body and a
  reset + "Ver resultados" footer. The toolbar shows a live filter count and one
  removable button chip per active value or bound.
- Both modes share one filtered array and persistent state; the four board
  columns, empty labels, scroll regions and list min-width are preserved.
- Only the available pipeline data is used: no location, industry, or
  talent-base join is invented. No extra metrics or unasked redesign.
- No dependency, API, backend, fixture, schema, or shared-primitive change.

## Acceptance Criteria

- [x] `DashboardPageContent` renders `mx-auto w-full max-w-screen-2xl` on the
  route body, and both Tablero and Lista live inside that one measure.
- [x] The pipeline filter model is pure and covers OR/AND, accent search
  coexistence, inclusive/offset/reversed dates, chip removal, reset and stable
  options.
- [x] The floating filter Sheet exposes Etapa, Origen, Habilidades, Experiencia
  and Fecha de recepción, with the reset + "Ver resultados" footer.
- [x] The toolbar exposes a filter count and one removable chip per active
  value/bound; removing one preserves the others.
- [x] The received range filters by the supplied local civil day, inclusive on
  both bounds, and flags reversed bounds without swapping them.
- [x] Input-empty ("Sin candidatos en esta vacante") stays distinct from
  filtered-zero ("No hay candidatos que coincidan …").
- [x] Existing search semantics (name, title, skill; accent- and case-insensitive
  substring) and the historical count denominator are preserved.
- [x] The workspace test import allowlist intentionally includes the new own
  modules and keeps the transport/storage/fixture bans.

## Tasks

- [x] EPW-01 — RED/GREEN the pure `pipeline-filter-model` (filters, options,
  chips, empty copy, reversed bounds).
- [x] EPW-02 — RED/GREEN the interactive workspace regression (Sheet, facets,
  chips, reset, date range, view parity, counters).
- [x] EPW-03 — Author the floating filter surface and wire it into the workspace.
- [x] EPW-04 — Add the `screen-2xl` route measure and its route-level regression.
- [x] EPW-05 — Typecheck, scoped lint and the focused employer-vacancies suite.
- [x] EPW-06 — Author the browser acceptance spec (not run: no server start is
  authorized).
- [x] EPW-07 — RED/GREEN the open-ended `10+` experience bucket and its
  above-validator-ceiling regression.
- [x] EPW-08 — RED/GREEN the facet combobox primitive-id identity, its
  reopen/search/navigation regressions and the browser facet-query case.

## Corrections (independent review)

Two independently confirmed defects in the shipped filter surface were corrected
with test-first changes. No other feature or shared primitive was touched.

### EPW-07 — `10+` experience bucket was capped at 60

- **Defect:** `PIPELINE_EXPERIENCE_BUCKETS` gave the `10+` bucket
  `max: 60`, so the predicate applied an upper bound the request never asked
  for and could drop a more senior candidate.
- **Correction:** `10+` now carries `max: undefined` and the predicate remains
  lower-bound only. The shared `pipeline-model` zod schema still caps
  `yearsOfExperience` at 60; it was **not** broadened.
- **Regression:** a structurally typed `PipelineCandidate` above the validator
  ceiling (`yearsOfExperience: 72`) is now asserted to survive the `10+` bucket
  at both the pure-model and workspace levels, while the closed `6-9` bucket
  still rejects it. `experienceBucketValue` round-trips the open-ended bounds.

### EPW-08 — facet combobox `items`/value identity mismatch

- **Defect:** `FacetMultiSelect` passed option objects as the Combobox `items`
  while the controlled `value` and every `ComboboxItem` used domain ids. The
  installed Base UI root resolves `selectedIndex` from `items` with
  `Object.is`, so it compared an object against a string and always missed:
  the reopened popup never anchored (and scrolled) to its selection, and
  arrow-key navigation started from the first option instead of the selection.
- **Correction:** the root now receives the primitive domain ids as `items` and
  maps them to their Spanish labels through the installed `itemToStringLabel`
  prop. `onValueChange`, chips and every `ComboboxItem` therefore share one
  primitive identity.
- **Regression:** the reopened popup must highlight and scroll-anchor on the
  selected option, the first `ArrowDown` must land on its neighbour, a Spanish
  label query (`contrat`) must filter the options, a keyboard `ArrowDown` +
  `Enter` must store the domain id and filter by it, and toggling the same
  option must clear it. Chips keep the domain key with the Spanish label
  (`status:hired` → `Etapa: Contratados`).
- **Browser:** the `employer-pipeline-filters.spec.ts` spec gained a facet-query
  and `10+` experience acceptance case; it is listed but not executed.

## Evidence

- Exploration: the installed `Combobox` (Base UI 1.7 `items` API), `Sheet`
  (floating default), `DatePickerField` (`allowPast`), `Field*`, `ToggleGroup`,
  `Badge`, `Button` and `Empty` primitives already cover every pattern; no
  registry install and no direct dependency change was made.
- RED (pure): `pnpm exec vitest run .../pipeline-filter-model.test.ts` failed
  with `Failed to resolve import "./pipeline-filter-model"` — no tests ran.
- GREEN (pure): the same command passed `23 passed (23)`.
- RED (interactive): after adding the workspace regression block,
  `pnpm exec vitest run .../pipeline-workspace.test.tsx` reported
  `13 failed | 36 passed (49)`; the 13 failures were the new Sheet/facet/date
  contracts, and all 36 legacy contracts stayed green.
- GREEN (interactive): after the filter surface and workspace wiring, the same
  file passed `49 passed (49)`.
- Route: `page.test.tsx` + `pipeline-workspace.test.tsx` +
  `pipeline-filter-model.test.ts` passed `89 passed (89)` across 3 files,
  including the new `screen-2xl` both-views regression.
- Package: `pnpm exec vitest run src/features/employer-vacancies` passed
  `104 passed (104)` across 5 files.
- Static: `pnpm exec tsc --noEmit --incremental false` exited 0;
  `pnpm exec eslint` on all changed files plus the new browser spec exited 0.
- Browser: `frontend/tests/e2e/employer-pipeline-filters.spec.ts` is authored and
  typechecks/lints, but was **not executed**: no preview server was started, and
  this record claims no browser, axe or max-width result.

### Correction evidence

- Independent 121-test baseline (feature suite + route page):
  `pnpm exec vitest run src/features/employer-vacancies "src/app/(empresa)/empresa/vacantes/[jobId]/pipeline"`
  passed `121 passed (121)` (`104` feature + `17` route) before the corrections.
- RED (corrections): the same scoped run over the two touched test files
  (`pipeline-filter-model.test.ts` + `pipeline-workspace.test.tsx`) reported
  `4 failed | 73 passed (77)`. The four failures were exactly the new
  lower-bound `10+` contracts (pure and workspace, both with a 72-year
  candidate) and the reopened combobox anchor (`data-highlighted` missing and
  the first `ArrowDown` landing on `status:submitted` instead of
  `status:rejected`). All pre-existing contracts stayed green.
- GREEN (corrections): after the `pipeline-filter-model.ts` and
  `pipeline-filters.tsx` edits, the same two files passed `77 passed (77)`.
- GREEN (independent 121 scope grown to 126):
  `pnpm exec vitest run src/features/employer-vacancies "src/app/(empresa)/empresa/vacantes/[jobId]/pipeline"`
  passed `126 passed (126)` across 6 files (`109` feature incl. the 5 new
  regressions + `17` route).
- Static (corrections): `pnpm exec tsc --noEmit --incremental false` exited 0;
  `pnpm exec eslint` on the five touched files exited 0.
- Browser list (corrections): `pnpm exec playwright test tests/e2e/employer-pipeline-filters.spec.ts --list`
  lists `7` tests in 1 file, including the new
  `a facet query matches the Spanish label and 10+ experience filters without a ceiling`.
  Still **not executed**.

## Limitations

- The browser acceptance spec is unrun. Every browser-level claim (Sheet
  geometry, calendar selection, axe, max-width at 1920px, overflow) remains to
  be proven by the parent or CI against a live preview origin. The new
  facet-query and `10+` experience cases are listed by Playwright (7 tests) and
  typecheck/lint, but are **not** browser-verified here.
- The combobox identity correction is proven through the installed Base UI
  selected-index/navigation path in jsdom; the browser run remains the authority
  for portal geometry and real pointer/keyboard composition.
- `frases`/labels reuse the committed Spanish vocabulary; no new copy beyond the
  sheet description, empty-state and reversed-range feedback was introduced.

## Rollback

Revert the four modified files and delete the three new source/spec files plus
this record:

- `frontend/src/features/employer-vacancies/pipeline-filter-model.ts` (new)
- `frontend/src/features/employer-vacancies/pipeline-filter-model.test.ts` (new)
- `frontend/src/features/employer-vacancies/pipeline-filters.tsx` (new)
- `frontend/src/features/employer-vacancies/pipeline-workspace.tsx` (modified)
- `frontend/src/features/employer-vacancies/pipeline-workspace.test.tsx` (modified)
- `frontend/src/app/(empresa)/empresa/vacantes/[jobId]/pipeline/page.tsx` (modified)
- `frontend/src/app/(empresa)/empresa/vacantes/[jobId]/pipeline/page.test.tsx` (modified)
- `frontend/tests/e2e/employer-pipeline-filters.spec.ts` (new)
- `odd/tasks/employer-pipeline-width-and-filters.md` (new)
