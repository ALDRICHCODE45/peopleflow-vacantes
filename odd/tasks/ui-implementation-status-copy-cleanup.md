# UI Implementation-Status Copy Cleanup

## Objective

Remove user-visible implementation-status language across the frontend while keeping placeholder controls visible, enabled, focusable, clickable, and intentionally inert for partner presentation.

## Product Decision

- The presentation audience already knows incomplete features are illustrative; the UI must not repeat that status.
- Keep placeholder actions visible. Do not remove them.
- Remove visible and accessible copy such as demo, prototype, fictitious, temporary, local-only, unavailable, unimplemented, test, no-save/no-send, and close equivalents when they expose implementation status.
- Placeholder controls must be enabled and activatable with pointer and keyboard, but perform no product side effect: no navigation, submit, request, storage, toast, mutation, success message, or persistence claim.
- An inert dropdown item may close its primitive-owned menu when selected.
- Preserve real local behavior already implemented: navigation, filters, tabs, theme, notification preferences, profile draft/review/reset, validation, and the application wizard.
- Preserve legitimate disabled states caused by data/state constraints: validation gates, loading, pagination boundaries, date constraints, limits, authorization, or missing historical links.

## Non-goals

- No backend implementation or API write.
- No authentication, upload, download, password, 2FA, invitation, save, publish, or mutation capability.
- No route/data/fixture/status-vocabulary changes.
- No dependency, lockfile, shared primitive, global style, or protected-service change unless separately justified and authorized.
- No commit, push, PR, merge, deployment, install, or remote operation without explicit authorization.

## Tasks

- [x] UISC-01 — Clean Candidate implementation-status copy and enable inert placeholder controls.
  - Scope: Dashboard, Postulaciones, Perfil, CVs, Configuración plus focused, route, and candidate E2E contracts.
  - Acceptance: no implementation-status copy; CV and Security placeholders enabled/inert; legitimate dirty/historical states preserved.
- [x] UISC-02 — Clean Auth implementation-status copy and enable inert login placeholders.
  - Scope: LoginScreen and login browser/focused contracts.
  - Acceptance: controls visible/enabled/inert; no auth/navigation/storage/network/success claim.
- [x] UISC-03 — Clean public jobs, vacancy detail, company careers, and application flow copy.
  - Scope: public job/company/application sources and coupled tests/E2E.
  - Acceptance: product-facing labels only; existing local interactions preserved; no backend behavior invented.
- [x] UISC-04 — Clean employer and create-vacancy implementation-status copy.
  - Scope: employer pages/team/pipeline and create-vacancy form sources with coupled tests/E2E.
  - Acceptance: presentation copy is product-facing; real validation/state gates preserved; placeholder actions remain inert.
- [x] UISC-05 — Reconcile the durable UI rule and verify the complete frontend.
  - Scope: design guide, exhaustive source scan, focused/type/lint/browser/Axe/responsive checks.
  - Acceptance: zero prohibited visible/accessibility copy outside explicitly legitimate product terms; placeholder controls enabled/inert; legitimate disabled controls unchanged; no unexpected writes/traffic.

## Legitimate Disabled States to Preserve

- Add-language and add-question maximum limits.
- Data-table pagination boundaries.
- Historical vacancy without a public link.
- Profile reset while the draft is pristine.
- Calendar/date constraints.
- Loading and in-flight submission states.
- Any real authorization or validation gate whose state is part of current product behavior.

## Verification Notes

- Tests and comments may retain technical words when they do not render to users, but stale UI-copy expectations must be updated.
- Source scans must distinguish sales language such as “Agendar demo” from implementation-status disclosures.
- Failed and successful verification attempts remain distinct.

## Progress

- User clarified that placeholder controls must remain visible and clickable; only their implementation-status copy and disabled presentation must be removed.
- Read-only audit mapped affected Candidate, Auth, Public/Jobs/Company, Employer, and Create-vacancy surfaces plus coupled contracts.
- Candidate cleanup is complete: implementation-status disclosures and suffixes are gone; CV upload/actions and Settings security controls remain visible, enabled, focusable, clickable, and inert.
- Candidate profile keeps real draft/validation/reset behavior with product-facing pending-state copy; historical missing-link and pristine-reset disabled states remain legitimate.
- Initial verification failed 157/160 focused tests plus preview connection refusal; after two assertion corrections and authorized 3100 restart, focused tests passed 160/160.
- A second browser attempt exposed a transient 38.443px menu measurement during its opening transform; the E2E now polls until animation settles without lowering the 40px requirement.
- Final Candidate evidence: focused Vitest 160/160, TypeScript exit 0, scoped ESLint exit 0, candidate Chromium 9/9 including the ten-case responsive/Axe matrix.

- Auth cleanup is complete: disclosure/suffix copy removed; main/provider/forgot/register actions and remember checkbox remain visible and enabled; auth Buttons are inert and inputs remain read-only.
- Auth verification: focused Vitest 17/17, TypeScript exit 0, scoped ESLint exit 0, combined login Chromium 24/24.
- Two timeout attempts remain distinct: 22/23 before route splitting and 22/24 before giving the exhaustive per-route inertness cases a bounded 60s budget; no assertions were removed.

- UISC-03A public jobs/company cleanup is complete: shared disclosure copy, heading prefixes, demo-only feedback, company disclosure data, empty-state status copy, and prototype not-found wording are gone.
- Public save/copy/share/mail controls remain visible, enabled, focusable, clickable, and inert through a server-safe native button renderer; Acme facts, reserved-domain URL, vacancy counts, and real application/company links remain unchanged.
- UISC-03A verification: nine focused files passed 111/111, the two tightened source-boundary files passed 51/51, TypeScript and scoped ESLint exited 0, and the no-reset browser inspector passed 4/4 cases with 61 Axe rules per case, zero violations, zero overflow, no storage writes, and GET-only traffic to the 3100 app origin.
- The exact three-spec Playwright command remains intentionally unexecuted because two specs directly reset protected port 4010. A first custom-inspector attempt remains separately failed because the verifier asserted invented `Ingeniería` copy against the frozen `Plataforma` fixture; the corrected fresh inspector passed without changing product code.
- UISC-03B application-flow cleanup is complete: the shell disclosure, demonstration profile copy/badge, and no-send/no-save review sentence are gone; the product-facing login gate remains.
- The three-step wizard, frozen source vocabulary, 2000-code-point validation, local draft normalization, Back behavior, profile facts, portrait, and real login link remain functional. No submit, success, network, or persistence behavior was added.
- UISC-03B verification: focused Vitest 26/26, TypeScript and scoped ESLint exit 0, and the fresh no-reset browser inspector passed all five audited steps at desktop/light and mobile/system-dark with zero overflow, 44px minimum in-scope action targets, zero serious/critical Axe findings, GET/HEAD-only 3100 traffic, and no storage/runtime errors.
- The first UISC-03B browser attempt remains separately failed because it applied the 40px rule to the unrelated shared navbar and found `Publicar vacante` at 36px. The corrected slice-scoped run passed; the shared-navbar hit-area issue remains explicit work for UISC-05.
- The standard application Playwright spec remains intentionally unexecuted because its `beforeEach` directly resets protected port 4011. Fresh browser evidence is stored at `/tmp/peopleflow-ui-copy-cleanup-application/`.

- UISC-04A employer route disclosures are complete: Equipo, Vacantes, and Pipeline no longer render page-level local-demo/no-save notes. Focused route verification passed 41/41 with TypeScript and scoped ESLint clean.
- UISC-04B team/pipeline cleanup is complete: the invitation keeps real email validation but a valid `Enviar invitación` attempt is inert and preserves its fields; the pipeline candidate-count copy retains facts without the demonstration suffix. Focused verification passed 72/72 with TypeScript and scoped ESLint clean.
- UISC-04C create-vacancy cleanup is complete: rich-text and complementary-detail prototype labels/disclosures are gone; the progress copy is product-facing; `Guardar borrador` keeps validation/focus behavior but produces no valid-submit outcome, traffic, storage, or success. Focused verification passed 130/130, with a fresh 31/31 hit-area recheck after the save control was raised from 32px to 40px; TypeScript and scoped ESLint remained clean.
- Employer Chromium first failed 1/5 at a transient native navigation URL assertion and skipped four serial cases; a fresh retry passed 5/5 in 27.7s. The failed attempt remains distinct.
- The first custom employer inspector passed Team/Pipeline but failed both create cases because its conditional-dossier and post-validation inertness assumptions were wrong and it measured the save action at 32px. After the product hit-area correction and verifier-spec fixes, the fresh inspector passed 4/4: Axe rules 26/26/30/27 with zero serious/critical findings, zero overflow/banned copy/storage/disallowed requests/runtime errors, and 344×40px save geometry.
- Full-page sticky capture distortion remains a separate superseded visual artifact. Fresh viewport captures at `/tmp/peopleflow-ui-copy-cleanup-employer/create-desktop-top.png` and `create-desktop-bottom.png`, plus team, pipeline, and mobile-dark captures, received visual sign-off.

- UISC-05 is complete. `docs/frontend-ui-design-rules.md` now records the durable product rule: presentation placeholders remain enabled and intentionally inert, while disabled controls are reserved for real data or state constraints.
- The final source reconciliation raised the public `Publicar vacante` action to the 40px target, replaced unresolved employer `href="#"` destinations with enabled inert native buttons, preserved real links and the GET create-vacancy form, and removed the last dormant candidate destination disclosure from shipping source.
- The final no-reset matrix measured a shared cross-product accessibility defect: candidate and employer sidebar destinations were 32px, shell triggers were 28px, default theme controls were 32px, and the destructive 12px badge had 3.71:1 contrast. The shared Sidebar, ThemeToggle, and Badge primitives were therefore separately justified and corrected for both products; coupled contracts were updated.
- Exhaustive shipping-source and rendered/accessibility scans found zero prohibited implementation-status copy. Surviving matches are technical identifiers/comments or legitimate product language such as `Agendar demo`, `Prueba técnica`, draft state, search, and empty results.
- Final non-browser evidence: UISC-05 focused reconciliation 146/146; dormant destination focused 3/3; shared accessibility focused 118/118; employer assertion focused 69/69; TypeScript exit 0; full lint exit 0 before the final bounded changes plus scoped ESLint exit 0 for every final changed file; fresh full Vitest 102/102 files and 1356/1356 tests in 60.84s.
- Full-suite failures remain separate: an earlier 1352/1352 run exited 1 on one worker `onTaskUpdate` timeout; a later post-primitive run passed 1342/1356 with 13 timeouts, one stale `size-8` assertion, and five worker timeouts. The stale assertion was corrected and its fresh full retry passed; neither failed run was reclassified.
- Safe browser evidence remains distinct: the aggregate public/candidate/employer suite passed 61 and failed one transient root Vacantes navigation; fresh root retry passed 19/19. After final shared changes, candidate passed 9/9; the combined shell run then failed the first employer navigation and left four cases unrun; fresh employer retry passed 5/5.
- The first final custom matrix remains failed at 4/8 because it exposed the 40px and contrast blockers. The second produced an 8/8 manifest but failed visual inspection because its desktop marketing capture did not reveal the middle sections. The corrected fresh matrix passed 8/8 with complete visuals, zero overflow, zero Axe violations, no prohibited copy, 40×40px minimum header and collapsed-rail targets, 256×48px account targets, inert pointer/keyboard behavior, no storage writes, no runtime errors, and browser traffic confined to the 3100 app origin. Evidence: `/tmp/peopleflow-ui-copy-cleanup-final/`.
- At the time of this verification, no package, lockfile, backend, protected service, commit, push, pull request, merge, deployment, or remote operation had been performed; delivery status is recorded under Delivery Evidence.

## Delivery Evidence

- Implementation commit: `0b94a4f` — `feat(frontend): complete workspace redesign and presentation cleanup` (verified product, tests, E2E, design guide, routes, and cleanup).
- Relevant to this record: `0b94a4f`.
- This task record and its documentation update remain untracked and are committed later by the parent, so no hash is claimed here.
- Push, PR creation, merge, deployment, release, install, remote operation, and protected-service mutation remain unauthorized and were not performed.
- Native Gentle review remained unavailable because the package-local binary is missing; the independent verification evidence above remains authoritative.

## Next Step

Merge of this verified slice into the user-selected target worktree is pending. Push, PR creation, merge, publication, deployment, and remote operations remain unauthorized. Native Gentle review remains unavailable because the package-local binary is missing.
