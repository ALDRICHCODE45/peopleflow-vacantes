# Candidate detail and confirmed pipeline movement

## Approved scope

Employer vacancy pipeline UI only: open the existing candidate detail Sheet from a card, move a card between the four existing stages, and confirm with an optional message. Kanban and list share visit-local state.

The user explicitly selected a **local prototype** and **optional notification**, authorized the official shadcn Dialog plus `@dnd-kit/core`, and requested commits and integration into local `main` without an agent push.

No real email, candidate-dashboard delivery, API mutation or persistence is part of this work. The message UI previews the intended email and application-process channels; it must not claim delivery. Candidate identity must come from the selected pipeline record, not a similarly named talent fixture. Unavailable contact/profile fields remain unavailable.

## Interaction contract

- Clicking a card opens the existing detail composition; keyboard access is equivalent.
- A dedicated drag handle separates moving from opening a candidate.
- A non-drag stage action provides a keyboard/mobile alternative.
- A drop creates a pending change. Confirmation alone applies it.
- Cancel, Escape, dismissal, dropping outside and dropping in the same stage leave the stage untouched.
- The dialog shows candidate, vacancy, previous stage and destination.
- Notification is optional. If selected, the message must be nonblank and bounded; validation is accessible.
- A fresh movement starts with a fresh draft, never another candidate's text.
- Confirmed state is shared by both views and existing filters; stage counts remain derived.
- Focus has a valid destination even when a moved card no longer matches the current filter.

## Work units

1. **Approved interaction foundation** (`b22fb8e`): official Base UI Dialog, localized close controls with 40px hit areas, pinned `@dnd-kit/core@6.3.1`, and updated primitive inventory. Existing Button was not overwritten. RED: two localization/target tests failed; GREEN: 12 Dialog/Sheet tests and scoped ESLint passed.
2. **Pipeline interaction**: completed local movement model, pointer/keyboard board, confirmation dialog, optional message preview/history and truthful partial candidate detail. Existing rich talent profiles remain compatible.
3. **Visible prototype copy cleanup**: removed every visible demo/local-session notice. The dialog omits the recipient row instead of showing "No disponible en este prototipo local" and no longer renders its demo note; the activity list no longer emits `PIPELINE_LOCAL_ONLY_NOTE`; the activity label is now "Mensaje:"; the activity empty state no longer says "en esta sesión"; and the talent Sheet dropped "Archivo de ejemplo · Solo demostración" plus its `aria-describedby`. No fake send/save success and no invented recipient were introduced, and unavailable data still reads as unavailable. `docs/frontend-ui-design-rules.md` records the override so presentation placeholders carry no demo/prototype copy.

## Verification plan

Exercise pointer drag, non-drag keyboard/mobile moves, detail opening, cancellation, invalid/same-stage drops, all four stages, message validation and local preview, filter consistency, focus restoration, both views and reload reset. Check desktop/mobile modal layout, serious/critical axe findings and no request/storage mutations.

Real email delivery and cross-session candidate dashboard synchronization are deliberately unimplemented, not unverified capabilities.

Dependency audit: `pnpm audit --prod` reports 21 advisories (6 high, 12 moderate, 3 low) through the existing Next/PostCSS and shadcn CLI dependency chains, not the added dnd-kit packages. Existing dependency versions were not upgraded; this audit is not clean and remediation remains a separate task. Evidence: `/tmp/pf-pipeline-dependency-audit.log`.

## Verification evidence

- 109 focused unit tests passed (71 workspace, 21 movement model, 17 talent detail); TypeScript, scoped ESLint and final production build passed.
- All 10 new pipeline Chromium scenarios passed: detail, confirmation/cancellation/outside/same-stage drops, all stages and shared list, optional message validation/reset/history, keyboard drag, pen, touch, keyboard menus, filtered focus restoration, and modal accessibility/overflow.
- The broader browser run reached 33 passes before a detail initial-focus/scrolling failure; 5 remaining cases did not run. The Sheet now initially focuses the candidate heading instead of jumping to CV actions. That exact regression passed against the final production build. The entire matrix was deliberately not rerun; no full-suite pass is claimed.
- The existing talent facet scenario was corrected to assert total results (11 → 14 → 11), not the constant 10-row paginated page. A read-only subagent confirmed the fixture/pagination mismatch.
- Independent review identified stale next-step text after round trips, a missing process-channel message preview and pen input support; all were corrected with focused coverage.
- Coordinate gestures wait for actual hit-test readiness and drag-overlay disposal; keyboard checks wait for the sensor/frame lifecycle rather than racing immediate follow-up events.
- No manual visual smoke or visual acceptance gates this commit. The user will inspect after their own push. At the user's request, checks remain proportional to custom behavior rather than repeatedly testing shadcn primitives.
- Temporary preview processes started for these checks were stopped; existing user services were left running.

## Rollback boundary

The foundation can be removed independently before its pipeline consumer is applied. After integration, revert the pipeline movement/detail changes and their tests/docs before removing Dialog or dnd-kit. Preserve existing pipeline filters, unrelated talent behavior, backend documents and private environment configuration.
