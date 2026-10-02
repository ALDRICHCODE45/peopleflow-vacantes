# Application CV local step (VAF-07)

## Scope

- Add an optional penultimate **CV** step to the public `/vacantes/[jobId]/postular`
  wizard, between `Tu postulación` and `Revisar`. New order: `Tus datos` →
  `Tu postulación` → `Tu CV` → `Revisar`.
- The CV is local-only: `File | null` held in wizard React state, never read,
  serialized, stored or uploaded. No transport, progress, `FileReader`,
  `objectURL`, storage or network.
- The CV stays optional because no prior requirement or user request asked for
  mandatory upload; the UI says so. The final `Iniciar sesión para enviar` link,
  the absence of a submit affordance and the no-fake-success posture are unchanged.
- All existing personal/application validation and Back state are preserved.
- No installs, no shared-primitive changes, no API changes.

## References

- `docs/frontend-ui-design-rules.md`
- `frontend/src/features/jobs/application/vacancy-application-flow` behaviour (existing)
- `frontend/src/features/candidate/cv-workspace.tsx` (CV metadata presentation)

## Tasks

- [x] VAF-07A — Pure local-CV model (`application-cv.ts`): accepted `pdf|doc|docx`
      case-insensitive extension, inclusive `10*1024*1024`-byte limit, exactly one
      file, MIME hint tolerated (blank/variant allowed), KB/MB size formatting.
- [x] VAF-07B — Focused step component (`application-cv-step.tsx`) composed from
      installed `Card` + `Field` + native `Input type="file"` + `Button` (keyboard
      equivalent, ≥40px) with a polished drag area that prevents the browser from
      opening the dropped file.
- [x] VAF-07C — Wizard integration: fourth step, responsive rail, CV state,
      validation on picker and drop, review metadata, remount clears.
- [x] VERIFY-01 — Focused tests, TypeScript, scoped ESLint and Playwright collection.

## Evidence

- Test-first: the new `application-cv.test.ts` / `application-cv-step.test.tsx`
  were written against the absent `application-cv.ts` / `application-cv-step.tsx`
  and observed RED (`Cannot find module './application-cv'` /
  `Cannot find module './application-cv-step'`) before implementation. The model
  test's single wrong expectation (`1536 → 1.5 KB`) was corrected to the existing
  cv-workspace `Math.round` convention (`2 KB`), then GREEN.
- Focused suite: 82 tests across 6 files passed —
  `application-cv.test.ts` (9), `application-cv-step.test.tsx` (14),
  `application-draft.test.ts` (7), `application-candidate-draft.test.ts` (13),
  `vacancy-application-wizard.test.tsx` (31), route `postular/page.test.tsx` (8).
- `tsc --noEmit --incremental false`: clean (no output).
- Scoped ESLint on the changed/added product, test and route files: clean (no output).
- `playwright test tests/e2e/vacante-postular.spec.ts --list`: 4 tests listed
  (desktop end-to-end, mobile Unicode boundary, new CV long-name/rejection test,
  responsive/theme matrix); full suite collection = 182 tests in 13 files.
- Behaviour covered: model boundary size+1, case-insensitive type, blank/variant
  MIME, multi/empty count; step picker/drop parity, cancel, same-file reselection,
  invalid replacement keeps the last valid file, remove + focus, optional skip,
  Back retention of raw profile/source/letter + `File`, review name/format/size,
  remount clears, and no fetch/storage/`createObjectURL`/`FileReader`.
- Design: selected document carries one 40px named `Quitar <name>` icon action
  (a button tray would be wrong; replacement is the always-visible drop area),
  so no contextual menu is warranted. Drop area is a plain `div` with a real
  native input, never a fake button card.
- Limits: no browser/E2E execution was performed (collection only); no servers
  were started. Production build and full repository suite were not run.

## Independent review fixes

- **Finding 1 — step changes dropped focus.** Every real transition unmounted the
  control the visitor activated, so focus fell back to `document.body` with no
  announcement. Fix: all real navigation goes through `goToStep`, which flags a
  pending focus; a `useEffect` keyed on `step` then moves focus to the incoming
  step title (`tabIndex={-1}`, `role="heading"`, `aria-level={2}`). The flag
  keeps the initial mount and every validation-blocked Continue untouched — those
  keep focus on the offending field. Covers CV in both directions and the other
  three steps. Tests: `VAF-07 wizard focus management` (forward and backward
  focus, mount never steals, invalid email and 2001-code-point letter keep their
  field focus) plus CV-step title attribute regression.
- **Finding 2 — a long CV file name could be clipped.** The selected document's
  `ItemTitle` inherited the shared primitive's `line-clamp-1`, so an arbitrary
  long name was truncated to one line. Fix (local override only, no shared
  primitive change): `line-clamp-none w-full max-w-full break-words` on the
  title and `min-w-0` on its `ItemContent`, so the full name stays readable and
  wraps. Regression: `application-cv-step.test.tsx` asserts the full long name,
  the `line-clamp-none`/`break-words` classes and the `min-w-0` parent; browser
  E2E asserts `scrollWidth - clientWidth <= 0` (real wrapping, no hidden
  overflow).
- **Finding 3 — the wizard exact-limit test was misleading.** It claimed to
  accept the exact limit while selecting a tiny file. Fix: a `cvFileWithSize`
  metadata helper now rejects `10 MiB + 1` and accepts a file declaring exactly
  `10 MiB` at the wizard level (the pure model keeps the boundary authority).
  E2E gained focus constraints on every transition and a full-name wrap
  constraint; E2E edits are authored only and were not executed (no browser).

## Focus-fix validation

- Focused suite: 86 tests across 6 files passed.
- `tsc --noEmit --incremental false`: clean (no output).
- Scoped ESLint on the five changed files: clean (no output).
- `playwright test tests/e2e/vacante-postular.spec.ts --list`: 4 tests collected.
- Limits: no browser/E2E execution and no servers were started.

## Native picker presentation correction

- User approved the CV surface except the native “Browse / No file selected” chrome.
- The native input is now hidden and removed from tab order; the visible Spanish
  `Elegir archivo` button opens it and carries the help/error description.
  Removing a file returns focus to that visible button. Drop handling is unchanged.
- Recovered incomplete worker edits directly; observed RED on the missing hidden
  attribute (1 failed / 16 passed) before correction. Updated the obsolete wizard
  assertion that expected focus on the input and the E2E visible-input assertion.
- Final direct checks: 87 tests across 6 application/route files passed;
  `tsc --noEmit --incremental false` and scoped ESLint passed.
- Real Chromium check on an isolated temporary Next preview (`127.0.0.1:4317`,
  fixture `127.0.0.1:4110`): `playwright test tests/e2e/vacante-postular.spec.ts
  --project=chromium --workers=1` passed all 4 tests. Covers desktop flow,
  mobile Unicode boundaries, local CV/long filename/rejected drop, light/dark
  overflow and axe. The native input is hidden; the visible picker remains usable.
  Browser evidence: `/tmp/pf-cv-browser.log`. The user's port 3000 was untouched.
- Additional real Chromium check at 375px: focus `Elegir archivo`, press Enter,
  observe the native `filechooser` event, select a local PDF, remove it and verify
  focus returns to the visible picker while the native input stays hidden: passed.

## Rollback

- Revert this task's edits to `vacancy-application-wizard.tsx`,
  `vacancy-application-wizard.test.tsx`, `postular/page.tsx` and
  `tests/e2e/vacante-postular.spec.ts`, and delete the new
  `application-cv.ts`, `application-cv.test.ts`, `application-cv-step.tsx` and
  `application-cv-step.test.tsx`. The wizard returns to three steps; no data,
  schema or backend change exists to undo.
