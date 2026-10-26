# Frontend backlog (open follow-ups)

Non-blocking items carried between units so none is lost. Each one moves into a feature document when it is
scheduled; remove it here when it ships. Shipped in `feat/employer-real-data` (see `employer-real-data.md`): CV stream
timeout, pagination history, table pinning invariant, team company lifetime, international dial split, employer
dashboard on real data, pipeline prototype fallback, legacy application phone, candidate «Crear cuenta», toasts over
Sheet footers, skills casing, outline links, candidate-edit advisories with a defect, draft-save-flow flake, bootstrap
panel voseo.

## Product gaps

- **Invite members by email** — no backend endpoint (AddMember takes an existing recruiter `user_id`). Deferred by the
  user (2026-10-23). Email decision recorded in `docs/decision-email-provider.md` (2026-10-24: Amazon SES, sending
  through EventBridge → SQS → Go worker, Terraform; no domain registered yet) — on the radar, not to be built yet.
- **Talento PeopleFlow** (global opt-in search, Boolean CV search) — needs privacy decisions (PRIV-2/10/12) and SRCH-9
  grammar. Deferred by the user (2026-10-23).
- **Legacy application phone persistence** — the legacy wizard now validates the phone with the dial control, but it
  submits nothing (it ends at a login link) and `POST /jobs/{jobId}/applications` has no phone field.

## Known issues

- **Client navigation between `/vacantes` search variants is sometimes not applied** (diagnosed 2026-10-26, no fix).
  After «Remoto» (`/vacantes?work_mode=remote`), going back to `/vacantes` leaves the URL and UI unchanged in ~25% of
  runs; the user has to click again. Evidence (production build, Playwright probes in a fresh context per run): the
  router sends the RSC request, the server answers 200 in ~40 ms and the response completes, the fixture logs the list
  read, no console error — yet the navigation never commits. Same rate with the quick filter «Todas» (`router.push`
  inside the island), with `window.next.router.push("/vacantes")` called directly (7/30) and with the
  «Limpiar filtros» `<Link>` (9/30). **Pre-existing:** the pre-shell build (abe6a9f9) fails the same way (second
  navigation 7/28, even the first one 2/30); the current build 5/30. Refuted, each measured and reverted: the island's
  own `useTransition` around `router.push` (9/40 without it), prefetch of `/vacantes` (never prefetched; 10/40 with
  `prefetch={false}`), a race with the previous navigation's stream (9/30 after waiting 1.5 s), the middleware
  mangling `?_rsc=` (Next strips it; 200). The list and detail retry buttons already reload the document because of
  the same class of failure. Next steps: try a newer Next 15.x/16 release (dependency decision for the user), then
  reduce to a minimal repro (same page, search-param-only navigations, `loading.tsx` in the segment) and report it.
  The e2e «renders the approved hero…» fails at the same rate because of this.

## Waiting on the user

- **Browser checks without a recorded defect** — board Estado/Municipio filters with a new application from a located
  profile; candidate view of «Vacante cerrada» (closing the process vs closing only the publication).

## Older minor items

- **Review advisories without a defect** (candidate edits unit): `edit/edit-model.ts:35-37` transform/refine order
  (Zod skips refinements on failed input, no acceptance defect); `edit/candidate-edit-form.tsx:57-70` rebase
  readability; `cv/participation-cv.tsx:38-41` readability; extra session coverage in `detail/detail-sheet.test.tsx`,
  `detail/detail-edit-integration.test.tsx`, `detail/detail-cv.test.tsx`. Two effect-cleanup ref warnings
  (`detail-sheet.tsx:61`, `change-history.tsx:52`) are intentional sequence counters.
- **«Agregar candidato» from Base de talento** (v0 redesign, 2026-10-22): user chose «Sin botón por ahora». Options
  when revisited: open the manual intake asking for the vacancy first (no backend), or create a candidate without a
  process (needs backend).
