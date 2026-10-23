# Frontend backlog (open follow-ups)

Non-blocking items carried between units so none is lost. Each one moves into a feature document when it is
scheduled; remove it here when it ships.

## From native reviews (advisory)

- **CV stream timeout** — `frontend/src/features/org-candidates/detail/file-client.ts:33-35` (review-572522607232b87b, R3-stream-timeout).
- **Pagination history** — `frontend/src/features/org-candidates/list/use-candidates.ts:50-51` (review-05eba6194022ca5a, R3-pagination-history).
- **Table preferences: pinning invariant / fixed actions position** — `frontend/src/components/data-table/use-table-preferences.ts:64` (review-fdc950adfea8747d, R2-pinning-invariant, R3-fixed-actions-position).
- **Company lifetime in the team page state** — `frontend/src/features/employer-team/team-page.tsx:42` (review-126984d004c9992a, R3-company-lifetime).
- **Phone dial split for countries other than +52/+1** — `frontend/src/lib/phone.ts:30` uses a fixed 3-digit prefix (review-d83863c5296fa95e, R3-international-dial).

## Product gaps

- **Invite members by email** — no backend endpoint (AddMember takes an existing recruiter `user_id`).
- **Employer dashboard** — «Vacantes activas» and metrics still prototype (needs MET formula decisions §17.3/§17.7).
- **Pipeline page fallback** still uses `NEXO_VACANCIES` and `features/employer-talent` (prototype).
- **Legacy application form phone** stays free text (5–30) until it gets the dial + number control.
- **Talento PeopleFlow** (global opt-in search, Boolean CV search) — needs privacy decisions (PRIV-2/10/12) and SRCH-9 grammar.

## Deferred by the user

- Candidate «Crear cuenta» lands on the Cognito login.
- Cognito sign-out URLs missing.

## Older minor items

- Board state/municipality filters with a new application; candidate view of «Vacante cerrada»; flaky `draft-save-flow` test with the full suite; local bootstrap panel copy still in voseo (developer tool).
- **Toasts cover Sheet footer actions** (QA 2026-10-22, candidate edit sheet): the global Toaster at bottom-right overlaps «Cancelar»/«Guardar cambios» of a right-side Sheet while an error toast is visible. Changing the Toaster position/offset affects every screen → needs a design decision.
- **Skills casing** (QA 2026-10-22): the backend stores skills lowercased (`candidates/domain/valueobjects/normalize_skills.go`, manual validation too), so «React, TypeScript, SQL» shows as «react, typescript, sql» in the sheet, chips and history. Showing the typed casing needs a product decision (store display casing vs normalized key) and a backend change.
- **Outline links without border** (QA 2026-10-22): `buttonVariants({ variant: "outline", className })` on plain `<a>`/`<Link>` is not twMerged, so the base `border-transparent` overrides `border-border` (no visible border, mostly in dark). Seen and fixed in org-candidates CV card; same pattern remains in `features/candidate/applications-workspace.tsx:54`, `features/candidate/saved-vacancies-workspace.tsx:44`, `features/jobs/drafts/ui/draft-requester-field.tsx:159`, `app/(empresa)/empresa/vacantes/page.tsx:49` (default variant, check). Fix with `cn(buttonVariants(...), ...)` or `<Button nativeButton={false} render={<Link/>}>`, test-first, with a visual check.
- **Review advisories, candidate edits unit** (non-blocking, native review 2026-10-22): `edit/edit-model.ts:35-37` body schema transform/refine order (reliability); `edit/edit-draft.ts:48-78` preparation needs direct tests; `edit/candidate-edit-form.tsx:57-70` conflict rebase readability, `:98-107` a conflict refresh while the save confirmation is open could leave the confirmation bound to the pre-refresh body (reliability/resilience, three findings — decide whether to close the confirmation on refresh); `edit/candidate-edit-form.test.tsx:206-211`; `cv/upload.ts:13-14` the upload failure loses the HTTP status for the UI (reliability/resilience); `cv/participation-cv.tsx:38-41` readability; `detail/detail-sheet.tsx:38-40` session coverage; `detail/detail-edit-integration.test.tsx:50-53`; `detail/detail-cv.test.tsx:104-120, 147-159`; `list/list-workspace.test.tsx:71`; `app/api/company/candidates/.../cv/route.test.ts:18-20`; `app/api/company/vacancies/.../cv/original/route.ts:22-23` failure coverage. Two effect-cleanup ref warnings (`detail-sheet.tsx:61`, `change-history.tsx:52`) are intentional sequence counters.
- **«Agregar candidato» from Base de talento** (v0 redesign, 2026-10-22): user chose «Sin botón por ahora». Options when revisited: open the manual intake asking for the vacancy first (no backend), or create a candidate without a process (needs backend).
