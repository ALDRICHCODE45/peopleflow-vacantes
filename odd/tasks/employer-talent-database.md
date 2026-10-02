# Employer talent database (`/empresa/talento`)

## Approved direction
Replace the inert `Candidatos` sidebar placeholder with a real employer route,
`/empresa/talento`, whose "Base de talento" is one row per stable unique person
holding multiple separate application records across the company vacancies.
Rich, local, memory-only table: real search, facet filters with OR inside a
facet and AND across facets, removable active filters and reset, empty state,
sorting, pagination, column visibility, pinning and reordering (native
drag-and-drop plus accessible move alternatives), and one polished detail Sheet
mounted outside the row loop.

No person-level universal status and no match score: status only ever lives on a
single application record. No fake successful contact/download/export, no API or
storage writes, no dependency installs.

## Constraints
- Neutral Mexican Spanish product copy.
- Reuse existing `(empresa)` shell, `SiteHeader`, `DashboardPageContent` (single
  page inset) and installed Base UI/shadcn primitives only.
- Progressive detail: not every column is visible by default.
- One pixel sizing source for pinned sticky offsets; stable ids; visible pinned
  order; no percentage sticky geometry and no hidden pinned offsets.
- Deterministic fictional fixture (30-50 people), validated at the module
  boundary; reuses the existing Nexo vacancy ids/vocabulary.
- No API, storage, credential, transport or publication concern. Memory only.
- Preserve all pre-existing uncommitted work; never revert unrelated changes.

## Research
- Read `docs/frontend-ui-design-rules.md` (semantic tokens, shadcn-first,
  composition rules, target sizes, presence/quality criteria).
- Read the `shadcn` skill (use installed components, `render` instead of
  `asChild`, `FieldGroup`/`Field`, `InputGroup`, semantic variants).
- Read-only reference `peopleflow2` `docs/DataTable-Guide.md` and
  `src/features/vacancy/frontend/components/tableConfig` for feature/config
  separation. That project is TanStack Table **v8** plus `@dnd-kit`; this project
  is **v9.2.4**, so no API was ported. v9 declares features with `tableFeatures`
  and `useTable`, and exposes `columnPinningFeature`, `columnOrderingFeature`,
  `columnSizingFeature`, `columnVisibilityFeature`, `rowSortingFeature`,
  `rowPaginationFeature`. Pinned cell/header order is already
  start → center → end, and `column.getStart("start")` / `column.getAfter("end")`
  return pixel offsets (single sizing source).
- Avoided the reference defects: index identities, stale body memoization,
  percentage sticky geometry, hidden pinned offsets, unvalidated localStorage,
  pointer-only DnD, and detail filtering by the selected id.

## Work units
- [x] TAL-01 writer: model + deterministic fixture + unit tests for facet
      matching (OR within facet, AND across facets, same-application rule),
      chip descriptors/removal, column metadata and reorder helpers.
- [x] TAL-02 writer: rich table (search, facets, chips, reset, empty, sorting,
      pagination, visibility, pinning, drag + accessible reorder, single Sheet).
- [x] TAL-03 writer: route `/empresa/talento`, sidebar rename to
      `Base de talento`, focused Playwright spec (authored, not run).
- [x] FIXUP-01: parent authorized the collateral update of
      `src/app/(empresa)/empresa/dashboard/page.test.tsx`; only the stale nav
      assertions were updated (`Candidatos` -> resolved `Base de talento` link)
      and the previous edits in that file were preserved.
- [x] FIXUP-02: verifier-confirmed E2E spec defects corrected (`location`
      revealed again before the pin/reorder steps; synthetic in-page drag
      replaced by real pointer-driven `dragTo` plus awaited observable header
      assertions). Browser run still pending.
- [x] TAL-04 writer (bounded acceptance-test correction, spec + this doc only):
      the axe scan test now carries the `@a11y` tag so `pnpm test:a11y`
      (`playwright test --grep @a11y`) picks it up, and the spec gained real
      coverage for sorted row order, keyboard-only column reorder, the mobile
      Sheet viewport/focus-trap/focus-return contract, the dark Sheet surface
      and axe scans over the OPEN filter, column and portalled Sheet panels.
      Authored, not run: browser execution is still pending human preview.
- [x] TAL-05 writer (user-approved visual refinement, feature surface + spec +
      this doc only): the toolbar `Filtros` control now opens a polished lateral
      `Sheet` (heading, description, scrolling body, footer close/reset) instead
      of the huge inline checkbox grid; every facet is a searchable shadcn
      `Combobox` multi-select rendered as chips with the domain value ids kept
      separate from their Spanish labels; the two date fields use the installed
      `DatePickerField` with `allowPast`; the giant column configuration panel is
      gone and visibility is one compact toolbar `DropdownMenu` of native
      checkbox items that keeps the menu open; every column header now carries a
      dedicated drag handle, the sortable label and a three-dot menu with the
      pin/unpin and accessible move alternatives; native pointer drag starts on
      the handle while the header cell stays the drop target; table/detail badges
      use the existing semantic variants with `dot` reserved for lifecycle
      states only. No model rewrite, no dependency, no new palette.
- [x] VERIFY-01: independent verification (unit/type/lint evidence recorded
      below; browser execution remains unrun).
- [x] FIXUP-03 writer (two verifier-confirmed refinement defects, feature
      surface + focused tests + spec + this doc only):
      (1) the facet `Combobox` mapped raw `options` as static children and never
      passed `items`, so the installed Base UI 1.7 filtering never ran: every
      option always rendered, the typed query did not narrow anything and
      `ComboboxEmpty` never showed. The root now receives `items={options}` and
      `ComboboxList` renders the filtered slice through a function child,
      keeping the domain value ids and their Spanish labels;
      (2) the header move menu computed neighbours and boundaries from the full
      region list, hidden columns included, so moving a column past a hidden
      neighbour was an invisible no-op and the visible edge controls stayed
      enabled. Neighbour and boundary logic now run over the visible columns of
      the same pinned region while hidden ids keep their hidden state and
      relative order. Tests added: typed facet query (match, non-match,
      no-result empty), one-click visible movement past a hidden column,
      disabled visible leading/trailing edges, and a real-browser date-range
      acceptance that opens both calendars.
- [x] TAL-06 writer (user-approved refinement: airy talent table + global total
      cards + default floating Sheet system). Scope: the four talent feature
      files, the new summary component and its test, `components/ui/sheet.tsx`
      and its new test, the mobile sidebar edge opt-out, the JobsNavigationIsland
      scroll-body fix, the focused employer-shell/JobsNavigationIsland tests, the
      E2E spec and this doc. No fixture rewrite, no dependency, no service.

## Verification evidence

TAL-01/02/03 writer, TDD:
- RED: `model.test.ts` + `prototype-talent.test.ts` failed with
  `Cannot find module './model'` before the model existed; `talent-workspace.test.tsx`
  failed with `Cannot find module './talent-workspace'` before the components
  existed. Both are collected-and-failed runs, not passing runs.
- GREEN (targeted):
  `pnpm exec vitest run src/features/employer-talent/ src/app/(empresa)/empresa/talento/page.test.tsx src/components/company-dashboard/app-sidebar.test.tsx`
  → 5 files, **102 tests passed**.
- GREEN (shared-shell regression, targeted):
  `pnpm exec vitest run "src/app/(empresa)/layout.test.tsx" "src/app/(empresa)/empresa/equipo/page.test.tsx" "src/app/(empresa)/empresa/sitio/page.test.tsx" "src/app/(empresa)/empresa/vacantes/page.test.tsx" "src/app/(empresa)/empresa/vacantes/nueva/page.test.tsx" "src/app/(empresa)/empresa/vacantes/[jobId]/pipeline/page.test.tsx"`
  → 6 files, **65 tests passed**.
- GREEN (authorized collateral):
  `pnpm exec vitest run "src/app/(empresa)/empresa/dashboard/page.test.tsx"`
  → 1 file, **72 tests passed** after the stale nav assertions were updated to
  the resolved `Base de talento` link.
- `pnpm exec tsc --noEmit` → clean.
- `pnpm exec eslint src/features/employer-talent src/app/(empresa)/empresa/talento src/components/company-dashboard/app-sidebar.tsx src/components/company-dashboard/app-sidebar.test.tsx tests/e2e/employer-talent.spec.ts` → clean.
- E2E `tests/e2e/employer-talent.spec.ts` authored; **not run** because the
  Playwright config uses an external origin (`PLAYWRIGHT_APP_ORIGIN`, default
  3100) with no `webServer`, and no service was started.

### FIXUP-02 — verifier-confirmed E2E spec defects (static correction only)

The independent verifier confirmed two defects in
`tests/e2e/employer-talent.spec.ts` by static reading:
1. the `location` column was hidden with the visibility toggle and never
   re-enabled before the pin step, so the `data-pinned="start"` assertion
   targeted a header that was no longer rendered, and the later accessible
   reorder and drag steps had no `location` header to move onto;
2. `dragColumn` built a `DataTransfer` and dispatched
   `dragstart`/`dragover`/`drop`/`dragend` inside a single `page.evaluate`,
   which runs in one task: React never commits `draggingId`, `dragover` is
   never cancelled and the drop is rejected.

Corrections applied (scope limited to the spec and this task doc):
- `location` is revealed again immediately after the hidden assertion, guarded
  by `await expect(...).toHaveCount(1)` on `[data-pf-talento-th="location"]`,
  so the pin, reorder and drag steps operate on a real header.
- the synthetic helper is replaced by browser-owned input,
  `source.dragTo(target)`: a real pointer press/move/release, so Chromium emits
  genuine HTML5 drag events in separate tasks and React state commits between
  them. Both endpoints are guarded with `toHaveCount(1)`.
- every header-order claim is now an awaited observable assertion,
  `await expect.poll(() => firstHeaders(page)).toEqual([...])`, replacing the
  synchronous `expect((await headingIds(page)).slice(0, 4))` snapshots.
- the file header records that nothing in the spec is evidence until it is run
  against the preview origin, and that a synthetic in-page dispatch is never a
  substitute for real browser input.
- `pnpm exec eslint tests/e2e/employer-talent.spec.ts` -> exit 0, clean.

Still not verified: no browser was launched for this correction. The Playwright
config still declares no `webServer` and reads `PLAYWRIGHT_APP_ORIGIN`
(default `3100`), and no service may be started, so the E2E spec remains
**authored, not run**. No drag-and-drop, pinning, reorder, responsive or axe
result is claimed as executed.

Not verified: visual appearance, responsive pixels, real drag-and-drop in a
browser, dark-mode rendering and axe results, because the E2E spec was not run.
No dependency was installed and no `data-table.tsx` behavior was changed.

### TAL-04 — bounded acceptance-test expansion (static correction only)

Scope was limited to `tests/e2e/employer-talent.spec.ts` and this task doc.
No product source was refactored. The FIXUP-02 corrections were preserved
unchanged: the `location` hide/reveal guard, the real pointer-driven
`dragColumn` helper and every awaited `expect.poll` header-order assertion.

Added:

1. `@a11y` on the axe scan test
   (`talent route stays visible, overflow-clean and axe-clean at both widths
   @a11y`) and on the new open-panel scan test, so both are selected by the
   existing `test:a11y` script (`playwright test --grep @a11y`).
2. `sorting reorders the rendered page rows, not only the aria-sort attribute`:
   asserts the real rendered row ids and the real cell text of the experience
   column for both sort directions, resolves the cell index from the rendered
   header order instead of a hardcoded position, and checks the sorted window
   continues on page 2 instead of restarting from an unsorted block. The
   expected order is derived from the fixture (32 people) plus two documented
   library facts: a numeric accessor starts on `descending`, and
   `sortedRowModel` breaks ties with `rowA.index - rowB.index` (stable).
3. `the accessible column reorder is operable from the keyboard alone`: opens
   the column panel with `Enter` on the focused trigger, proves the first
   column of a region keeps its move control disabled, moves a column with
   `Enter` and moves it back with `Space`, asserting the rendered header order
   after each activation.
4. `the detail sheet opens inside the mobile viewport, traps focus and returns
   it`: at 375px the portalled dialog must stay inside the viewport and the page
   must not overflow; ten real `Tab` presses plus four `Shift+Tab` presses must
   each settle with `document.activeElement` inside `[data-pf-talento-sheet]`
   (at least two distinct stops reached), and `Escape` must hide the dialog and
   return focus to the row control. Focus is asserted as *settled* inside the
   dialog, not as a one-frame snapshot: Base UI's focus guards (one of which
   lives in the page DOM beside the portal) can own focus for a frame while
   handing it back inside, so a snapshot assertion would be flaky while a broken
   trap would never settle and would time out.
5. `dark color scheme › the portalled detail sheet scans axe-clean over dark
   surfaces`: opens the Sheet under `colorScheme: dark`, then scans the
   portalled dialog subtree itself with WCAG A/AA tags.
6. `open filter, column and portalled sheet panels scan axe-clean @a11y`: for
   each open state (filter panel, column settings panel, portalled Sheet)
   reloads the route, guards that the panel under test is actually visible
   before scanning (no vacuous scan), and scans the correct axe roots - the
   workspace plus the panel, and the portalled dialog on its own because it is
   mounted in a body portal outside `[data-pf-talento-workspace]`.

### Independent verification evidence

Reported by the independent verifier (recorded here, **not re-run in this
slice**):

- `pnpm exec vitest run` over the affected set -> **7 files, 180 tests passed**.
- `pnpm exec tsc --noEmit --incremental false` -> clean.
- focused `eslint` on the touched surface -> clean.
- known noisy output during the unit runs: chart dimension warnings from the
  dashboard chart test surface. Harmless render-time warnings, not failures;
  out of scope for this bounded slice.
- browser execution: **unrun** - no service may be started and the Playwright
  config declares no `webServer`, so no drag-and-drop, pinning, reorder,
  responsive, dark-mode or axe result is claimed as executed.

Re-run in this slice (spec + doc only, no browser, no service, no install):

- `pnpm exec eslint tests/e2e/employer-talent.spec.ts` -> exit 0, clean.
- `pnpm exec tsc --noEmit --incremental false` -> exit 0, clean.
- `pnpm exec playwright test tests/e2e/employer-talent.spec.ts --list` ->
  **11 tests in 1 file** collected (collection only, no browser launched).
- `pnpm exec playwright test tests/e2e/employer-talent.spec.ts --grep @a11y
  --list` -> **2 tests** collected, proving the `@a11y` tag wiring that
  `pnpm test:a11y` relies on.

Honest limitations of this slice: the added assertions are static
corrections - they are collection-clean and type/lint-clean, but nothing was
executed against a browser, so no handler, focus, viewport, ordering or axe
outcome is proven. The exact sorted-id expectation assumes the tie order and
first-direction behaviour documented above; if a future library upgrade changes
`column_getFirstSortDir` or the tiebreak, the test fails loudly instead of
silently passing. `--list` does not start the app: the preview server on
`PLAYWRIGHT_APP_ORIGIN` (default `3100`) is still required before any run.

## TAL-05 — user-approved visual refinement

Scope was limited to the four feature files, the focused component test, the
E2E spec and this doc. The pure model (`model.ts`), the workspace orchestrator
(`talent-workspace.tsx`) and every shared primitive were left untouched: the
same-application AND / OR-within-facet semantics, the pixel visible pin offsets
and the memory-only state are unchanged.

What changed:

1. **Filter surface is one lateral Sheet, not an inline grid.**
   `TalentFilterBar` keeps the toolbar search and the removable active chips and
   moves the full criteria into `Sheet` + `SheetHeader`/`SheetContent`, with a
   scrolling body and a footer that carries reset (`[data-pf-talento-clear]`) and
   close (`[data-pf-talento-filters-close]`). The background is inert while the
   Sheet is open, so reset lives inside it. The trigger composes through
   `SheetTrigger render={<Button/>}` (Base UI, never `asChild`).
2. **Facets are searchable shadcn multi-select chips.**
   Every facet is a Base UI `Combobox multiple` with `ComboboxChips` /
   `ComboboxValue` / `ComboboxChip` / `ComboboxChipsInput` and
   `ComboboxContent` / `ComboboxEmpty` / `ComboboxList` / `ComboboxItem`,
   following `strategy-section.tsx:103`. The option value is the domain id
   (or the vocabulary string) and the chip renders the Spanish label from a
   lookup, so value and label stay separate. Each chip's remove control is named
   `Quitar <label>` by the primitive's own Spanish default.
3. **Installed date fields.** The application range uses `DatePickerField`
   (`id`, civil `YYYY-MM-DD` `value`, `onChange`, `aria-labelledby`,
   `allowPast`) wrapped in `[data-pf-talento-applied-from]` /
   `[data-pf-talento-applied-to]` test markers, because the field has no generic
   prop spread. `allowPast` opens the historical window; the future upper bound
   is correct for an application history.
4. **Compact column visibility, no giant panel.** The configuration panel is
   gone. The toolbar `Columnas` `DropdownMenu` holds native
   `DropdownMenuCheckboxItem` rows (`[data-pf-talento-column-toggle]`) that keep
   the menu open, so several columns can be toggled in one visit. The identity
   column stays visible (`enableHiding: false`, rendered disabled-checked).
5. **Per-header handle, label and menu.** Each header renders a dedicated drag
   handle (`[data-pf-talento-column-handle]`, `draggable`, `aria-hidden`, with
   the menu as the accessible alternative), the sortable label and a three-dot
   menu (`[data-pf-talento-column-menu]`) that groups the accessible move items
   (`move-start/left/right/end`, disabled at the region edges) and the pin
   items (`pin-start/pin-end`, toggling). The `th` keeps `aria-sort`, the pinned
   data attribute, the pixel sticky style and the `dragover`/`drop` handlers, so
   native pointer drag starts on the handle while the header cell stays the drop
   target.
6. **Meaningful existing badge variants.** Availability
   (`success`/`info`/`review`/`neutral`), modality (`info`/`accent`/`neutral`)
   and application count (`secondary`) reuse the shared semantic variants with
   **no** dot; only the application lifecycle stage keeps `dot`
   (`submitted`→`info`, `in_review`→`review`, `hired`→`success`,
   `rejected`→`danger`). Skills stay `outline` metadata. No person-level
   aggregate status is introduced, and no raw color or new palette is added.

### TAL-05 evidence (re-run in this slice)

- `pnpm exec vitest run src/features/employer-talent/ "src/app/(empresa)/empresa/talento/page.test.tsx"`
  -> **4 files, 74 tests passed** (the component suite grew from 16 to 23
tests: Sheet open/close/focus-return, multi-select chip selection and removal,
header handle/menu assertions, toolbar visibility menu, identity column lock,
menu-driven pin/unpin and reorder, native drag from the handle, and the mocked
date-range filter).
- Shared-shell regression:
  `pnpm exec vitest run "src/app/(empresa)/layout.test.tsx" "src/app/(empresa)/empresa/equipo/page.test.tsx" "src/components/company-dashboard/app-sidebar.test.tsx"`
  -> **3 files, 55 tests passed**.
- `pnpm exec tsc --noEmit --incremental false` -> exit 0, clean.
- `pnpm exec eslint src/features/employer-talent tests/e2e/employer-talent.spec.ts`
  -> exit 0, clean.
- `pnpm exec playwright test tests/e2e/employer-talent.spec.ts --list` ->
  **11 tests in 1 file** collected.
- `pnpm exec playwright test tests/e2e/employer-talent.spec.ts --grep @a11y --list`
  -> **2 tests** collected.

### TAL-05 jsdom boundaries (explicit, not browser evidence)

The component suite replaces three environment-level behaviours that the
committed suites already document as unworkable under jsdom; none of them is a
product change and none is browser proof:

- **DatePickerField popover/calendar** -> a controlled harness (per-field open
  state in a context, so the two date fields stay independent). Real browser
  open/select/close/focus must be proven in Playwright.
- **Combobox portal** -> `ComboboxContent` renders its list inline; the real
  Base UI root, chips, items, filtering and selection stay exercised. The
  committed `combobox.test.tsx` covers the portal composition.
- **DropdownMenu positioner** -> a small menu implementation that preserves the
  observable contract (`aria-haspopup`/`aria-expanded`, `role=menu`,
  `role=menuitem`/`menuitemcheckbox` with `aria-checked`, `aria-disabled`,
  close-on-item, stay-open-on-checkbox, Escape). Anchor/positioning is not
  exercised here.

### TAL-05 honest limitations

No browser was launched. The Sheet scroll/focus trap in a real viewport, the
real combobox popup inside the Sheet, the real Base UI menu positioning and
keyboard navigation, the native pointer drag from the handle, dark surfaces and
the axe results are all **authored, not run**. The E2E spec was updated to the
new handle/menu/Sheet selectors and is collection-clean only. Pending human
preview remains the source of truth for the visual result.

## FIXUP-03 — verifier-confirmed talent refinement defects

Scope was limited to `talent-filters.tsx`, `talent-table.tsx`,
`talent-workspace.test.tsx`, `tests/e2e/employer-talent.spec.ts` and this doc.
The pure model (`model.ts`) and the workspace orchestrator were untouched.

### Defect 1 — facet combobox bypassed filtering

`FacetMultiSelect` rendered `options.map(...)` as `ComboboxList` children and
never passed `items` to the `Combobox` root. In Base UI 1.7 the list derives its
filtered slice from the root's `items` (or a `filteredItems` override); with
static children the filter had nothing to filter, so every option always
rendered, a typed query changed nothing and `ComboboxEmpty` never appeared.

Fix: the root receives `items={options}` and `ComboboxList` uses the documented
function-child form `{(item: Option) => ...}`, which renders the filtered items
while `value={item.value}` keeps the domain id and `{item.label}` stays the
visible, filterable text. The default Base UI collator filter matches the label
(case- and accent-insensitive), so `ComboboxEmpty` shows only on a true zero
result.

### Defect 2 — header menu moves used hidden columns as neighbours

`regionIds` returns every id of a region, hidden ones included, and the move
callbacks and the header's `index`/`regionLength` boundaries were computed from
that full list. With `currentCompany` hidden by default, moving `industry` left
swapped it with the hidden `currentCompany` (no visible change) and the visible
trailing column still reported an enabled move toward the end.

Fix: two local helpers, `moveIdToVisibleNeighbor` and `moveIdToVisibleEdge`,
run the neighbour search and the edge insertion over the *visible* columns of
the region while the hidden ids stay in the array untouched. The header now
receives the visible index and visible region length, so the leading/trailing
controls disable against what the user actually sees. `isColumnVisible` reads
the same `columnVisibility` state TanStack already owns; no model function was
changed and the pure reorder helpers stay covered by `model.test.ts`.

### Regression tests (authored test-first, RED observed before the fix)

- `filters a facet's options by the typed query and reports the empty result`
  in `talent-workspace.test.tsx`:
  RED — `expected <div role="option" …> to be null` because the static map kept
  rendering `Data Analyst` after typing `front`;
  GREEN — the matching option survives, `Data Analyst` is gone, `zzz-no-option`
  renders zero options plus `Sin resultados`, and clearing restores the list.
- `moves columns past visible neighbors and disables the visible edges` in
  `talent-workspace.test.tsx`:
  RED — `expect(element).toHaveAttribute("aria-disabled", "true")` failed with
  `Received: null` on the trailing visible column;
  GREEN — leading `professionalTitle` and trailing `lastApplicationAt` disable
  both start/end moves with `currentCompany` hidden, and one click moves
  `industry` before `professionalTitle` while `Empresa actual` stays hidden.
- `the applied date range filters through the real calendars at both bounds` in
  `tests/e2e/employer-talent.spec.ts`: pins a fixed 2026-03-15 clock, opens each
  real `DatePickerField` calendar (visibility guard against a vacuous click),
  picks 2026-03-10 and 2026-03-12, and asserts the chips plus the closed-window
  row set (Ricardo/Sergio/Héctor out, Gabriela in, five rows total). The three
  existing date-range component tests are preserved unchanged.

### FIXUP-03 evidence (re-run in this slice)

- `npx vitest run --no-file-parallelism src/features/employer-talent/ "src/app/(empresa)/empresa/talento/page.test.tsx"`
  -> **4 files, 76 tests passed** (component suite grew from 23 to 25 tests).
- RED captured before the fix by temporarily restoring the pre-fix source on the
  same working tree: the two new component tests failed exactly as quoted above.
- `npx tsc --noEmit --incremental false` -> exit 0, clean.
- `npx eslint src/features/employer-talent tests/e2e/employer-talent.spec.ts`
  -> exit 0, clean.
- `npx playwright test tests/e2e/employer-talent.spec.ts --list` ->
  **12 tests in 1 file** collected (was 11; collection only, no browser).

### FIXUP-03 honest limitations

No browser was launched and no service was started: the new date-range E2E test
is collection-clean only, so its calendar open, day activation, chip text and
row-count assertions are **authored, not executed**. The exact five-row window
and the `data-day="10/3/2026"` / `"12/3/2026"` selectors follow the fixture
and `react-day-picker`'s `es` short-date rendering; if either changes, the test
fails loudly rather than passing vacuously. The jsdom component suite keeps the
committed mock boundaries (portal-less combobox content, menu contract stub,
DatePickerField harness), so real Base UI filtering is exercised in the
component test while popup positioning, real calendar navigation and the real
menu geometry remain Playwright-only concerns. Query filtering is asserted for
the `position` facet only; the other facets share the same component path.

## TAL-06 — floating Sheets, global summary cards and airy table

User-approved refinement. No dependency was installed, no fixture was rewritten
and no service was started.

1. **Default floating `Sheet` system (`components/ui/sheet.tsx`).**
   `SheetContent` gains `presentation?: "floating" | "edge"` and defaults to
   `floating`: an 8px mobile / 16px desktop inset (`--sheet-inset`), rounded
   corners, a `shadow-lg` surface, and `overflow-hidden` so children never paint
   outside the radius. Opposing insets (`inset-y-(--sheet-inset)` for the lateral
   sides) determine the side height, so `h-full` is gone from the floating path,
   and both axes clamp to the inset-adjusted dynamic viewport with
   `max-w`/`max-h` `calc(100dvw|100dvh - 2 * var(--sheet-inset))`. The clamp is
   `max-width`/`max-height`, a different property from a consumer `w-full`/
   `h-full`, so it still constrains them; it is **not** the last `max-width` on
   the width axis, because at `>=40rem` the responsive
   `data-[side]:sm:max-w-sm` default is emitted later and wins, so the width
   settles at 24rem (which fits any normal viewport). A consumer `sm:max-w-*`
   does not win for the same preexisting specificity/order reason (equal
   specificity, emitted earlier). Below 40rem the clamp is the only `max-width`
   that applies. The overlay, transitions and translate animations are unchanged;
   `SheetHeader`/`SheetFooter` are now `shrink-0` and the panel is `min-h-0`, so
   a `min-h-0 flex-1 overflow-y-auto` body (the talent detail sheet, the talent
   filter sheet) scrolls under fixed chrome. `presentation="edge"` reproduces
   the previous full-bleed geometry verbatim (kept as `EDGE_PRESENTATION`).
2. **Mobile sidebar opt-out.** The navigation drawer in
   `components/company-dashboard/ui/sidebar.tsx` passes `presentation="edge"`,
   preserving the prior full-bleed CSS (`EDGE_PRESENTATION` is verbatim) and the
   full-height rail; the desktop `sidebar-container` (`inset-y-0 h-svh`) was not
   touched. The effective mobile width is **not** 18rem: the edge path keeps the
   prior `data-[side=left]:w-3/4`, which (class+attribute) overrides the
   unprefixed `w-(--sidebar-width)` class, so the drawer renders at 75% of the
   viewport while `--sidebar-width: 18rem` is set but unused. That is preexisting
   CSS preserved as-is, not a TAL-06 change.
3. **JobsNavigationIsland body fix.** The mobile filters `<form>` body gained
   `min-h-0` (`flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto`) so it shrinks
   inside the floating panel and keeps the header/footer fixed.
4. **Global total cards (`talent-summary.tsx`, new).** Four installed `Card`s in
   a responsive grid (`grid-cols-2 lg:grid-cols-4`) read `computeTalentTotals`
   over the complete `people` set: people, applications, immediately available
   people, distinct represented vacancy ids. `TalentWorkspace` passes the full
   set, never `filteredPeople`, so filtering, an empty result, reset and
   pagination never move a counter. Counts only: no trend, growth or percentage
   copy.
5. **Pure totals model (`model.ts`).** `computeTalentTotals` counts people and
   their applications, counts an immediate person once regardless of application
   count, and de-duplicates vacancy ids with a `Set`.
6. **Airy table (`talent-table.tsx`).** Data rows are `h-[70px]`, cells
   `px-4 py-3`, header cells `px-4`; the enclosure is a lighter
   `rounded-2xl shadow-sm ring-1 ring-foreground/5` (Card-like elevation, no
   uniform thin border) with `border-border/60` row separators. The identity cell
   now renders a decorative (`aria-hidden`) initials `Avatar` plus a secondary
   professional-title line, while the name button keeps its **exact** accessible
   name (the avatar initials and the secondary line never join it). Pixel pinned
   geometry is untouched: `pinStyle` still reads `column.getStart("start")`/
   `getAfter("end")`, pinned headers stay opaque `bg-muted`, pinned cells opaque
   `bg-background`, and the canonical `screen-2xl` width was not changed.

### TAL-06 evidence (re-run in this slice)

- RED (pure totals): `model.test.ts` failed to collect with `Module '"./model"'
  has no exported member 'computeTalentTotals'` before the function existed;
  GREEN `computeTalentTotals` suite passes and the visible summary uses it.
- RED (summary): `talent-summary.test.tsx` failed with `Cannot find module
  './talent-summary'` before the component existed; GREEN after implementation.
- RED (summary wiring):
  `talent-workspace.test.tsx > employer talent global totals > keeps the
  whole-base totals untouched by filters, empty results, reset and pagination`
  failed with `stat people: expected null not to be null` before the workspace
  mounted `TalentSummary`; GREEN after wiring.
- RED (floating Sheet): `sheet.test.tsx` failed to type-check
  (`Property 'presentation' does not exist`) and then failed the inset/clamp/
  `h-full` assertions against the pre-change primitive; GREEN after the floating/
  edge split.
- RED (sidebar edge opt-out): `employer-shell.test.tsx > keeps the mobile
  drawer on the edge presentation with its 18rem width` failed with
  `data-presentation="floating"` before the prop was passed; GREEN after. The
  case name is loose: the assertion checks the `--sidebar-width` custom
  property, not the computed width, which the edge `data-[side=left]:w-3/4`
  overrides (see the corrected item 2 wording and the specificity note below).
- RED (island scroll body): `JobsNavigationIsland.test.tsx > gives the mobile
  filters sheet a shrinking body that owns the scroll` failed the `min-h-0`
  source contract; GREEN after the class was added.
- RED (table density/hierarchy):
  `talent-workspace.test.tsx > employer talent table density` failed with the
  row missing `h-[70px]` and the identity cell missing the decorative avatar;
  the pinned-geometry assertions passed before and after, proving preservation.
- Focused GREEN:
  `npx vitest run --no-file-parallelism src/features/employer-talent/
  "src/app/(empresa)/empresa/talento/page.test.tsx" src/components/ui/sheet.test.tsx
  src/components/company-dashboard/employer-shell.test.tsx
  src/features/jobs/components/JobsNavigationIsland.test.tsx`
  -> **8 files, 108 tests passed** (the committed employer-talent set grew from
  76 to 108: model 29->33, workspace 25->29, summary 0->5, sheet 0->9, shell
  6->7, island 2->3).
- Shared-surface regression:
  `npx vitest run --no-file-parallelism "src/app/(empresa)/"
  src/components/company-dashboard/ src/features/jobs/ src/components/ui/`
  -> **63 files, 865 tests passed**.
- `npx tsc --noEmit --incremental false` -> exit 0, clean.
- `npx eslint src/components/ui/sheet.tsx src/components/ui/sheet.test.tsx
  src/components/company-dashboard/ui/sidebar.tsx
  src/components/company-dashboard/employer-shell.test.tsx
  src/features/employer-talent src/features/jobs/components/JobsNavigationIsland.tsx
  src/features/jobs/components/JobsNavigationIsland.test.tsx
  tests/e2e/employer-talent.spec.ts` -> exit 0, clean.
- `npx playwright test tests/e2e/employer-talent.spec.ts --list` -> **14 tests
  in 1 file** collected (was 12; collection only, no browser launched).

### TAL-06 honest limitations

No browser was launched and no service was started. The E2E additions (16px/
8px viewport inset, 70px row height, global-card invariance, and the sheet body
scrolling under fixed chrome) are **collection-clean only** - authored,
not executed. (The TAL-07 responsive fixup later replaced the fixed header in
that assertion with a fixed footer.) The unit suites prove the shipped class
contract and the computed
totals; they cannot prove real pixel geometry, because jsdom has no layout. Two
committed jsdom boundaries were preserved: the talent suite keeps its combobox/
menu/date-field mocks, and the JobsNavigationIsland scroll-body assertion reads
the shipped source instead of opening the mobile Sheet, because mounting the
island's Base UI `Select` positioner under jsdom never settles (the same
boundary the committed combobox/menu suites document). Tailwind class strings
(`inset-y-(--sheet-inset)`, the `calc` clamps, `[--sheet-inset:...]`) are not
validated by tsc/eslint; only the browser run can confirm they compile and
resolve. Fixture totals are 32 people / 41 applications / 12 immediate / 6
represented vacancies, asserted computed from the frozen fixture.

**Preexisting specificity limitation (recorded, not changed).** The built
stylesheet shows the primitive's responsive default
`.data-\[side\=right\]\:sm\:max-w-sm[data-side="right"]` (specificity
class+attribute) emitted after the consumer's `.sm\:max-w-2xl`, so it wins on
desktop: the talent detail and filter sheets render at the primitive default
24rem, and their own `sm:max-w-2xl`/`sm:max-w-md` never apply. That predates
TAL-06 (the edge presentation had the same `data-[side=right]:sm:max-w-sm`) and
was preserved, so no desktop geometry changed and consumers do **not** win.

The same rule governs the inset clamp on the width axis: at `>=40rem` the clamp
and `sm:max-w-sm` are both `max-width` on the same element with equal
specificity, and the responsive variant is emitted later, so the 24rem default
caps the width instead of the `calc(100dvw - 2 * var(--sheet-inset))` clamp.
24rem is smaller than the clamp at every `>=40rem` viewport, so the clamp never
binds there and the panel fits a normal viewport; the width clamp only governs
below 40rem. The clamp is **not** defeated for a consumer `w-full`/`h-full`
because it is a `max-width`/`max-height` and those are different properties, and
the `max-height` clamp is unaffected on either axis. If a future slice wants
consumer widths to win, drop the responsive `sm:max-w-sm` from
`FLOATING_PRESENTATION` - at that point the clamp still applies because every
clamp is data-prefixed (class+attribute).

**Preexisting mobile-drawer width limitation (recorded, not changed).** The edge
`EDGE_PRESENTATION` carries `data-[side=left]:w-3/4` (class+attribute), which
overrides the mobile drawer's unprefixed `w-(--sidebar-width)` class (bare
class). The `--sidebar-width: 18rem` variable is still set on the element but is
not the effective width: the drawer renders at 75% of the viewport. This too
predates TAL-06 (same edge string) and was preserved; it is why the
`employer-shell.test.tsx` case name says "18rem" while its assertion checks the
custom property rather than the computed width.

### TAL-06 independent verification (recorded, not re-run in this slice)

Reported by the independent verifier on this TAL-06 working tree; not executed in
this documentation-only correction:

- focused suite (8 files, the committed employer-talent + shared-surface set) ->
  **108 tests passed**.
- `npx tsc --noEmit --incremental false` -> exit 0, clean.
- `next build` -> passed.
- compiled CSS: the floating `[--sheet-inset:...]` custom property, the
  `max-w`/`max-h` `calc(100dvw|100dvh - 2 * var(--sheet-inset))` clamps and the
  `h-[70px]` data rows are present in the emitted stylesheet, so those Tailwind
  utility strings compile and resolve (tsc/eslint alone cannot validate them).
- browser execution: **unrun** - no service was started; no pixel, focus, drag,
  responsive or axe result is claimed.

That verification found two over-claims in the original TAL-06 write-up, both
preexisting-CSS facts rather than TAL-06 regressions: the width clamp is
overridden by the responsive default at `>=40rem`, and the mobile drawer's
effective width is `w-3/4`, not 18rem. Both are corrected above and in the
`FLOATING_PRESENTATION` comment; no runtime code changed.

## TAL-07 — user-approved faithful detail Sheet interior redesign

User approved a faithful redesign of the **interior** of the talent detail
`Sheet` from two reference screenshots (current Gabriela detail and the desired
candidate detail). Scope was limited to the talent detail surface
(`talent-detail-sheet.tsx`), its new focused component test, the E2E spec and
this doc. The shared floating `Sheet` geometry, inset, radius, native focus/
close semantics, the workspace orchestrator, the pure model, the table and every
shared primitive were left untouched. No dependency, service, backend, commit or
new palette was added; the dirty tree was preserved.

### What changed in the interior

1. **Full-width primary cover + overlapping avatar.** `SheetHeader` holds a
   `bg-primary` cover at the top of the panel, flush to the inner panel width,
   with a subtle on-primary dot texture built only from `currentColor`
   (`text-primary-foreground`) at ~14% opacity. The identity `Avatar` is a
   rounded square (`rounded-2xl`) with a `ring-popover` surface ring, pulled up
   with `-mt-7` so it overlaps the cover. The `SheetTitle` (exact accessible
   dialog name) and the `accent` industry `Badge` sit on one row, and the
   `SheetDescription` keeps the `Puesto · Empresa` subtitle. The native close
   button stays visible over the cover and the panel still scrolls its body. The
   responsive fixup below moves the cover and identity **into** that scroll body
   so short viewports stay usable.
2. **Section order.** `Habilidades` → `Preferencias laborales` →
   `Datos de contacto` → `Perfil profesional` → `Historial de postulaciones`.
   Each section is a real named `h3` group; the giant separators between every
   section are gone.
3. **Skills** stay `Badge variant="outline"` metadata, no geometry override.
4. **Work preferences** are inline badges: modality from
   `TALENT_MODALITY_VARIANT` and availability from `TALENT_AVAILABILITY_VARIANT`,
   both without a lifecycle dot. Availability carries a small decorative
   `IconClock` (the Spanish label still carries the meaning). The exported maps
   are unchanged and still consumed by `talent-table.tsx`.
5. **Contact and professional info** are muted `bg-muted` tiles inside a `dl`
   (`dt` label + icon, `dd` value): email full-width, phone/location two columns;
   industry/experience two columns, education/languages full-width. On small
   widths the grid collapses to one column so no tile gets cramped.
6. **History** rows are compact (initials `Avatar` media, job name, lifecycle
   `Badge` with `dot`, `Origen · Fecha` line) instead of giant bordered cards;
   the section heading carries the truthful application count (`Badge
   variant="secondary"`, no dot). The vacancy-title fallback (`vacancyTitleById[id]
   ?? id`) is preserved, as are the `data-pf-talento-history`,
   `data-pf-talento-history-item` and `data-pf-talento-history-vacancy` hooks.
7. **Footer** keeps the native `SheetClose` composed with an outline `Button`
   named `Cerrar`, now full-width.

The shared `Sheet` primitive, the default native close button and the dialog
accessibility (title/description) were not edited.

### TAL-07 evidence

- RED (authored test-first in the new `talent-detail-sheet.test.tsx`):
  `pnpm exec vitest run src/features/employer-talent/talent-detail-sheet.test.tsx`
  → **4 failed | 6 passed** against the pre-change interior. The four failures
  were the intended behavior changes: missing `[data-pf-talento-sheet-cover]`,
  the old section order (started with `Datos de contacto`), the old history line
  (`Origen: … · Postulada el …` instead of `Origen · Fecha`), and the close
  callback shape (Base UI appends a close-reason object after the boolean — the
  assertion now checks `onOpenChange.mock.calls[0][0]`, not an exact-argument
  match). The field-preservation case passed before and after, guarding against
  information loss.
- GREEN: same command → **10 tests passed**.
- Focused GREEN (feature + route):
  `pnpm exec vitest run src/features/employer-talent/
  "src/app/(empresa)/empresa/talento/page.test.tsx"` → **6 files, 99 tests
  passed** (the committed employer-talent set grew from 89 to 99).
- `pnpm exec tsc --noEmit --incremental false` → exit 0, clean.
- `pnpm exec eslint src/features/employer-talent/talent-detail-sheet.tsx
  src/features/employer-talent/talent-detail-sheet.test.tsx
  tests/e2e/employer-talent.spec.ts` → exit 0, clean.
- `pnpm exec playwright test tests/e2e/employer-talent.spec.ts --list` →
  **14 tests in 1 file** collected (unchanged count; collection only, no
  browser launched, no service started).
- Static token audit of the new file: no `#hex`/`rgb()`/`hsl()`/`oklch()`/
  `color-mix()`, no manual `dark:` color, no `space-x-*`/`space-y-*`.
- E2E narrow update (corrected by the responsive fixup below): the existing
  detail-sheet test asserts the cover is a **descendant** of the scrolling body
  (`[data-pf-talento-sheet-body] [data-pf-talento-sheet-cover]`), not the first
  child of a fixed header, plus the exact five-section order. No focus, mobile,
  dark, AXE or drag assertion was weakened.

### TAL-07 honest limitations

No browser and no service were started, and no build was run (out of the
authorized command set), so nothing here is pixel, viewport or AXE evidence.
The new component cases use the real Base UI `Sheet` under jsdom with the
committed `matchMedia`/`ResizeObserver` stubs. jsdom has no layout, so those
cases are **class-string and DOM-nesting contracts only**: they prove the
intended utilities are emitted and the elements are nested as intended, **not**
that the avatar overlaps the cover, that the ring renders, or that the
responsive two-column grid resolves. Class-string membership is not overlap,
geometry or pixel proof. The Tailwind v4 arbitrary utilities used for the
cover texture (`bg-[image:radial-gradient(currentColor_1px,transparent_1.5px)]`,
`[background-size:12px_12px]`), `ring-popover` and `after:rounded-2xl` are not
validated by `tsc`/`eslint`; only a compiled build or a real browser confirms
they resolve. If the texture class did not compile, the cover would still render
as a solid `bg-primary` surface, so the failure mode is cosmetic. The reference
screenshots show the availability badge as `Disponible: en un mes`; this slice
keeps the exported Spanish label (`En un mes`) and adds the clock icon instead of
inventing prefix copy. The E2E additions (`--list`-clean only) remain authored,
not executed.

### TAL-07 responsive fixup — short-viewport fixed chrome and long-text clipping

Verifier finding: the fixed cover (112px `h-28`) plus the identity block and the
fixed footer measured ~297px, taller than the 288px inner panel height of a
320px-tall desktop viewport. The body could not scroll and the footer/close
could be pushed out of the panel. A second static finding was that long unbroken
free text (a 120-char name/title/email/job label, the schema maximum) had no
`overflow-wrap`/`min-w-0` guard in several spots.

Fix (feature surface + focused test + spec + this doc only; the shared `Sheet`
primitive was **not** edited, and no dependency/service/commit was added):

1. The single scroll container `[data-pf-talento-sheet-body]` now owns the cover
   and the identity as well as every section. `SheetHeader` sits inside the body
   with `-mx-6` (cancelling the body's `px-6`) so the cover still bleeds full
   width and stays flush to the rounded top, while the body keeps `min-h-0
   flex-1 overflow-y-auto`. On a short viewport the tall cover/identity scroll
   away instead of pinning the panel; the footer and the primitive close button
   stay outside the scroll body and so remain reachable.
2. Long-text hygiene: `min-w-0` / `break-words` / `[overflow-wrap:anywhere]` on
   the identity row, the `SheetTitle` name, the `SheetDescription`, every
   `InfoTile` `dd` (email/location/education/languages) and the history vacancy
   title, so an unbroken 120-char token cannot force horizontal overflow. The
   exported variant maps (`TALENT_MODALITY_VARIANT`,
   `TALENT_AVAILABILITY_VARIANT`), the semantic badge variants, the data hooks
   and the outer floating panel geometry are unchanged.

RED (captured before the fix on the same tree):
`pnpm exec vitest run src/features/employer-talent/talent-detail-sheet.test.tsx`
→ **2 failed | 11 passed**. `renders the cover and identity inside the single
scrolling body` failed with `expect(body).toContainElement(cover)` because the
cover was a sibling of the body, and `wraps long unbroken identity, contact and
history text instead of clipping it` failed with `expected 'font-heading
[…text-xl…]' to contain 'min-w-0'`.

GREEN (same command) → **13 tests passed** (the fixed-header assumption was
replaced by the descendant-body case, plus the footer/close-outside-body case,
the content-accessibility case and the long-text case).

Focused GREEN:
`pnpm exec vitest run src/features/employer-talent/
"src/app/(empresa)/empresa/talento/page.test.tsx"` → **6 files, 102 tests
passed** (was 99; +3 in `talent-detail-sheet.test.tsx`).

- `pnpm exec tsc --noEmit --incremental false` → exit 0, clean.
- `pnpm exec eslint src/features/employer-talent/talent-detail-sheet.tsx
  src/features/employer-talent/talent-detail-sheet.test.tsx
  tests/e2e/employer-talent.spec.ts` → exit 0, clean.
- `pnpm exec playwright test tests/e2e/employer-talent.spec.ts --list` →
  **15 tests in 1 file** collected (was 14; collection only, no browser).
- `pnpm exec playwright test tests/e2e/employer-talent.spec.ts --grep @a11y
  --list` → **2 tests** collected.

Honest limitations of this fixup: the 102 unit cases still prove class-string and
DOM-nesting contracts only — jsdom has no layout, so the 320px fit is a
structural contract (cover inside the single scroll body; footer and both close
controls outside it) rather than a measured pixel result. The authored browser
cases that open the sheet at 320px tall and assert the footer box stays inside
the inset-adjusted viewport, that the cover scrolls while the footer does not,
and that the close control still closes are `--list`-clean, **not run**: no
service was started and no pixels, focus or axe outcome is claimed for them.

## TAL-08 — demo Currículum section in the talent detail Sheet (canonical compliance)

**Correction (retracted claim).** The first version of this section stated that
"the user explicitly superseded the earlier 'no CV surface' decision" and had
approved **disabled** `Ver CV`/`Descargar` controls. No such user authorization
exists in the record: the disabled semantics came from a parent instruction
presented as an approved deviation, never from a user request. That claim is
withdrawn. The durable rule (`docs/frontend-ui-design-rules.md` §6, `### Card`)
reserves `disabled` for real data/state restrictions and requires presentation
placeholders to stay **enabled and inert**, so the placeholders are now enabled,
visible, reachable by focus, clickable and free of any product effect, with the
visible demo note as their accessible explanation. Scope was limited to
`talent-detail-sheet.tsx`, `talent-detail-sheet.test.tsx`,
`talent-workspace.test.tsx`, `tests/e2e/employer-talent.spec.ts` and this doc.
No model, fixture, API, dependency, service or commit was added; the dirty tree
was preserved.

### What changed

1. **New section order.** A `Currículum` section sits between `Perfil
   profesional` and `Historial de postulaciones` (the exact order tests and the
   E2E order assertion were updated). The purple cover, floating geometry,
   single scrolling body, fixed footer, info tiles and history were left
   untouched.
2. **Demo PDF file card.** A muted card (same `bg-muted` surface as the other
   info tiles, so it does not dominate the sheet) with a circular primary
   medallion (`IconFileTypePdf`), the document name and one secondary line.
3. **Candidate-derived filename.** `talentCvDemoFileName(fullName)` returns
   `CV-<Nombre-...>.pdf` from the candidate's `fullName` only. No file size and
   no upload date are shown, so no metadata is invented.
4. **Explicit demo label.** The visible line `Archivo de ejemplo · Solo
   demostración` (`id="talento-detalle-curriculum-demo"`) is the nearby,
   readable explanation for the inert placeholders.
5. **Visible enabled inert affordances.** `Ver CV` (`IconEye`) and `Descargar`
   (`IconDownload`) are standard `Button`s at `h-10` (the project's >=40px
   independent-action target), `type="button"`, **enabled** and focusable, with
   no handler at all, referencing the note through `aria-describedby`. There is
   **no** real file, link, `href`, `download`, `target`, network call, storage
   write, window open or sheet-state change, and no fake success feedback.
6. **Neutral Mexican Spanish** copy only; no model/fixture/API change.

### Canonical compliance (replaces the earlier recorded deviation)

The earlier write-up recorded a deliberate deviation: it kept the placeholders
`disabled` and argued that an enabled inert control is indistinguishable from a
broken one. That argument is rejected. The durable rule is explicit —
`disabled` is reserved for real data/state restrictions such as a historic
vacancy without a public link, and a presentation placeholder is never rendered
`disabled`; it stays visible, focusable and clickable with no navigation,
request, storage write, mutation, toast or success message. The demo label plus
`aria-describedby` carry the explanation without disabling anything, so the
surface is now canonical rather than a flagged exception.

### No-fabricated-action tests updated to the canonical contract

The blanket `/descargar/i` prohibition stays replaced by a targeted one, but the
target is now the canonical shape: the demo `Descargar`/`Ver CV` must exist **as
enabled, focusable buttons** that reference the demo note, with no `link`, no
`href`/`download` and no real file. Because the controls are enabled, the suites
now also click them and prove inertness in the DOM: in
`talent-detail-sheet.test.tsx` the Currículum section text is identical before
and after both clicks, the sheet stays open on the same person and the close
callback was never invoked; in `talent-workspace.test.tsx` the same clicks leave
the dialog instance in place; in the E2E spec a real focus lands on `Ver CV`,
both clicks leave the sheet open on `Gabriela Soto`, the URL is unchanged and no
success copy appears. The `contactar`, `exportar`, `enviar`, `guardar` and
`match|score|compatibilidad` prohibitions are unchanged in both suites.

### TAL-08 evidence — first slice (superseded by the correction below)

The numbers in this block belong to the original, retracted slice: they prove
that the disabled implementation once existed, not that it is correct.

- RED (captured before that implementation, tests authored first on the same
  tree):
  `pnpm exec vitest run src/features/employer-talent/talent-detail-sheet.test.tsx`
  -> **4 failed | 10 passed (14)**. The four failures were the intended behavior
  changes: the two exact section-order cases (missing `Currículum`), the new
  `renders the demo Currículum file card with a candidate-derived name and
  disabled actions` case (`Unable to find an accessible element with the role
  "heading" and name "Currículum"`), and the adapted
  `offers no fabricated action ...` case (`getByRole("button", { name: "Ver
  CV" })` not found).
- GREEN: same command -> **14 tests passed**. Always with the `disabled`
  attributes that the correction removed.

### TAL-08 evidence — canonical-compliance correction (current)

- RED (tests edited first, observed against the previous `disabled` markup):
  `pnpm exec vitest run src/features/employer-talent/talent-detail-sheet.test.tsx`
  -> **3 failed | 12 passed (15)**. The three failures are exactly the intended
  behavior change: the renamed
  `renders the demo Currículum file card with a candidate-derived name and
  enabled inert actions`, the new
  `keeps the demo Currículum placeholders inert: clicking neither changes the
  sheet nor reports success`, and the adapted
  `offers no fabricated action beyond the enabled inert demo Currículum ...`;
  every one failed with `expect(element).toBeEnabled()` receiving a `<button
  disabled="" ...>`.
- RED (`talent-workspace.test.tsx`, observed by temporarily restoring the two
  `disabled` attributes after the test edit and then reverting them): same
  `toBeEnabled()` failure in
  `offers no fake contact or export action and only enabled inert demo Currículum
  controls` -> **1 failed | 28 passed (29)**.
- GREEN: `pnpm exec vitest run
  src/features/employer-talent/talent-detail-sheet.test.tsx` -> **15 tests
  passed**.
- Focused GREEN (feature + route):
  `pnpm exec vitest run src/features/employer-talent/ "src/app/(empresa)/empresa/talento/page.test.tsx"`
  -> **6 files, 104 tests passed** (`talent-detail-sheet.test.tsx` 14 -> 15 with
  the new inert-click case; the workspace suite stays at 29 tests).
- `pnpm exec tsc --noEmit --incremental false` -> exit 0, clean.
- `pnpm exec eslint src/features/employer-talent/talent-detail-sheet.tsx
  src/features/employer-talent/talent-detail-sheet.test.tsx
  src/features/employer-talent/talent-workspace.test.tsx
  tests/e2e/employer-talent.spec.ts` -> exit 0, clean.
- `pnpm exec playwright test tests/e2e/employer-talent.spec.ts --list` ->
  **15 tests collected in 1 file**, `--list` only: no service was started and no
  browser case was executed.
- Static token audit of the corrected CV block: no `#hex`/`rgb()`/`hsl()`/
  `oklch()`/`color-mix()`, no manual `dark:` color, no `space-x-*`/`space-y-*`,
  and no `href`, `download`, `target`, `window.`, `fetch(` or `disabled` (the
  only `disabled` matches in the file are none; the CV block references the demo
  note through `aria-describedby` only).

### TAL-08 honest limitations

No browser was launched and no service was started: the E2E additions are
static assertions, not executed. The E2E test count is unchanged from TAL-07
(15 collected) and was **not** re-listed here beyond the `--list` acknowledgement
above. The placeholders are enabled and reachable by Tab, so the real-browser
focus and inert-click assertions exist only as authored, `--list`-clean cases
until a human preview runs them. The component cases still prove DOM/class
contracts only (jsdom has no layout or pixels), so the enabled-button click
tests prove the absence of handlers, navigation and success copy in the DOM,
never that no pixels moved. `talentCvDemoFileName` is display text only, never a
filesystem path: a name containing `/` would simply render verbatim in the
filename line (`[overflow-wrap:anywhere]` keeps it from overflowing) and cannot
traverse or create anything.

## TAL-09 — Currículum demo card layout regression in the narrow Sheet panel

**Bug (reported from a real screenshot, not a test).** In the talent detail
Sheet the demo Currículum card rendered icon, filename and the two buttons in
**one horizontal row**. The buttons kept their intrinsic width, so the flexible
text column collapsed: the filename broke into a few-letters vertical column
(`CV` / `-` / `Ga` / `bri` / ...) and the demo note wrapped the same way, while
`Ver CV` / `Descargar` stayed on a single line beside them.

**Root cause.** The card used a **viewport** breakpoint
(`flex-col ... sm:flex-row sm:items-center`) while the action group was
`shrink-0` with intrinsic-width buttons. The floating Sheet panel is capped at
`24rem` (384px) on a wide desktop viewport (`data-[side=right]:sm:max-w-sm` in
`src/components/ui/sheet.tsx`; the consumer's `sm:max-w-2xl` loses per the
primitive's documented clamp caveat). At a desktop viewport the `sm:` row
applied against a 384px panel, so the buttons owned the row and the
`min-w-0 flex-1` filename column was squeezed to its minimum. The breakpoint was
viewport-based while the constraint was panel-local.

**Fix (local composition, no shared primitive touched).** The card now composes
from its own local width:

1. **Text row** (`data-pf-talento-curriculum-text`): the decorative
   `IconFileTypePdf` medallion plus a `min-w-0 flex-1` column that owns the
   flexible width.
2. **Filename** (`data-pf-talento-curriculum-filename`): `min-w-0 truncate`
   with the full demo name repeated in `title`, so a long or unbroken name
   ellipsizes instead of overflowing and the complete text stays available.
   The demo note (`id="talento-detalle-curriculum-demo"`) sits beneath it in the
   same flexible column.
3. **Action row** (`data-pf-talento-curriculum-actions`): a **separate second
   row**, `grid min-w-0 grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2`.
   Equal columns fill the card width; the grid tracks shrink (`1fr`) and the
   whole row wraps to one safe column below two 7rem targets plus the gap. No
   viewport breakpoint is involved anywhere in the card.

**Considered and not used.** The installed `Card` and `Item` primitives were
considered: `Card` would need paint overrides (`bg-card`/shadow/ring) to keep the
muted inset surface the sibling `InfoTile`s use, and `ItemTitle` carries
`w-fit line-clamp-1`, which conflicts with the required flexible `min-w-0`
truncation contract. The change is therefore local composition on the existing
muted surface (`bg-muted`, `rounded-xl`, `p-3`), consistent with the rest of the
sheet; no shared primitive or global width was edited.

**Preserved.** `Ver CV` (`IconEye`) and `Descargar` (`IconDownload`) stay enabled
inert `Button`s (`type="button"`, >=40px via `h-10`, no handler, no navigation,
no `href`, no `download`, no storage write, no success copy) with
`aria-describedby="talento-detalle-curriculum-demo"` on both. The demo note text
and id are unchanged, and the rest of the sheet (cover, identity, sections,
history, footer) is untouched.

### TAL-09 evidence

- RED (new unit cases authored first, observed against the old `sm:flex-row`
  markup): `pnpm exec vitest run
  src/features/employer-talent/talent-detail-sheet.test.tsx` -> **2 failed |
  15 passed (17)**. Both failures are the intended behavior change and fail on
  the missing local-composition hooks (`curriculum card: expected null not to be
  null`, `curriculum filename: expected null not to be null`).
- GREEN: same command -> **17 tests passed**.
- Focused feature suite: `pnpm exec vitest run src/features/employer-talent/` ->
  **5 files, 95 tests passed** (`talent-detail-sheet.test.tsx` 15 -> 17 with the
  new separate-row and unbroken-name cases; the workspace suite stays at 29).
- `pnpm exec tsc --noEmit --incremental false` -> exit 0, clean.
- `pnpm exec eslint src/features/employer-talent/talent-detail-sheet.tsx
  src/features/employer-talent/talent-detail-sheet.test.tsx
  tests/e2e/employer-talent.spec.ts` -> exit 0, clean.
- `pnpm exec playwright test tests/e2e/employer-talent.spec.ts --list` ->
  **16 tests collected in 1 file** (15 -> 16 with the new browser geometry case),
  `--list` only: no service was started and no browser case was executed.

### TAL-09 authored browser geometry case (not executed)

The new case `the demo Currículum card gives the filename usable width and moves
its actions to their own row at the narrow floating panel` measures on the real
portalled panel at 1440x900 (where the panel is capped at 384px, the reported
condition) that: the panel is <=384px, the card class has no `sm:flex-row`, the
card `scrollWidth - clientWidth` is <=1px, the filename box is wider than 120px
and no wider than its text row, both action buttons start at or below the note's
bottom edge and share one row, and both button boxes stay inside the card box.
It then resizes to 375x812 and repeats the no-overflow, usable-filename and
below-the-note checks with a safe wrap boundary. These are **authored, not run**.

### TAL-09 honest limitations (pending visual validation)

No browser was launched, no service was started and no pixels were measured: jsdom
the unit cases prove class-string and DOM-nesting contracts only (a separate text
row and action row, `min-w-0`/`truncate` width styles, no `sm:` breakpoint on the
card). The browser geometry case exists only as an authored, `--list`-clean case.
The regression itself came from a screenshot, so it is closed only when a human
preview re-renders the Sheet and confirms the filename and note read normally and
the two actions sit on their own row at the narrow panel. Nothing in this section
claims a measured pixel result.

## Changed surface (line counts)

- `frontend/src/features/employer-talent/model.ts` (662 + TAL-06
  `computeTalentTotals`/`TalentGlobalTotals`) + `model.test.ts` (554 -> 33 tests)
- `prototype-talent.ts` (423, unchanged) + `prototype-talent.test.ts` (160,
  unchanged)
- `talent-summary.tsx` (new, TAL-06) + `talent-summary.test.tsx` (new, 5 tests)
- `talent-table.tsx` (987, TAL-06 row density + identity hierarchy + lighter
  enclosure)
- `talent-filters.tsx` (466, FIXUP-03)
- `talent-detail-sheet.tsx` (357 -> redesigned interior: primary cover, overlapping
  avatar, ordered sections, muted data tiles, compact history, single scroll body
  carrying cover+identity under a fixed footer, long-text wrapping; TAL-07 +
  responsive fixup; TAL-08 demo Currículum file card with candidate-derived
  filename and enabled inert `Ver CV`/`Descargar`)
  + `talent-detail-sheet.test.tsx` (new, TAL-07 + responsive fixup + TAL-08, 15 tests)
- `talent-detail-sheet.tsx` (TAL-09 local composition of the demo Currículum
  card: no `sm:` viewport row, `min-w-0 truncate` filename with `title`, note in
  the flexible column, separate equal-column wrapping action row)
  + `talent-detail-sheet.test.tsx` (TAL-09, 17 tests)
- `talent-workspace.tsx` (78 + TAL-06 summary mount)
- `talent-workspace.test.tsx` (1018 -> 29 tests, FIXUP-03 + TAL-06)
- `src/components/ui/sheet.tsx` (137 -> floating/edge `presentation`)
  + `sheet.test.tsx` (new, 9 tests)
- `src/components/company-dashboard/ui/sidebar.tsx` (TAL-06 mobile drawer
  `presentation="edge"`)
- `src/components/company-dashboard/employer-shell.test.tsx` (6 -> 7 tests)
- `src/features/jobs/components/JobsNavigationIsland.tsx` (TAL-06 `min-h-0` on
  the mobile filters body) + `JobsNavigationIsland.test.tsx` (2 -> 3 tests)
- `src/app/(empresa)/empresa/talento/page.tsx` (58) + `page.test.tsx` (195)
- `src/components/company-dashboard/app-sidebar.tsx` (+3/-4) and
  `app-sidebar.test.tsx` (nav array + one active case)
- `src/app/(empresa)/empresa/dashboard/page.test.tsx` (nav assertions only)
- `tests/e2e/employer-talent.spec.ts` (TAL-04/TAL-05/FIXUP-03 + TAL-06 inset,
  density, global-total and internal-scroll assertions + TAL-07 responsive
  fixed-footer/320px assertions + TAL-08 `Currículum` in the section order and
  the enabled inert demo `Ver CV`/`Descargar` focus/click-inertness guard + TAL-09
  narrow-panel filename/action-row geometry case; 12 -> 16 collected)

## Rollback
- New feature surface is additive under `frontend/src/features/employer-talent/**`
  and `frontend/src/app/(empresa)/empresa/talento/**`; deleting those plus
  reverting the narrow `app-sidebar.tsx` rename returns the tree to its prior
  state. The shared `data-table.tsx` is not touched.
- TAL-06 rollback: restore the single geometry string in
  `src/components/ui/sheet.tsx` (drop `presentation`/`EDGE_PRESENTATION`/
  `FLOATING_PRESENTATION`), drop `presentation="edge"` from the mobile sidebar,
  drop `min-h-0` from the island form, delete `talent-summary.tsx` and its test,
  unmount `TalentSummary` from the workspace, and revert the table density/
  identity/enclosure classes. The pure `computeTalentTotals` in `model.ts` is
  additive and safe to keep or remove independently.
