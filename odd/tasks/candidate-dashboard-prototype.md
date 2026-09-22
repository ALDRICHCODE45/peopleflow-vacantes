# Candidate dashboard prototype

## Status
- Workflow: ODD
- Branch: `feature/candidate-dashboard-prototype`
- Base: completed employer workspace commit `febaf18`
- Current task: CDP-06B applications route integration
- Push/PR/merge/deploy: not authorized
- RDD: clone-local disabled; do not reactivate

## Goal
Build a coherent candidate-side PeopleFlow workspace with Dashboard, Postulaciones, Perfil, CVs, and Cuenta. Preserve the approved public and employer experiences while deriving a distinct candidate visual system from `login-candidato.html`: cyan accent, PeopleFlow surfaces, compact responsive information, and a dedicated route-aware sidebar.

## User decisions
- Visual authority: derive the candidate workspace from the cyan candidate-login language and the approved sidebar-shell architecture.
- First release: implement the complete five-route workspace.
- Profile: allow realistic local in-memory editing with an explicit non-persistence disclosure.
- CVs and account: show truthful local information; upload, email, and password actions remain visibly unavailable/disabled.

## Product and route decisions
- Canonical routes: `/candidato/dashboard`, `/candidato/postulaciones`, `/candidato/perfil`, `/candidato/cvs`, `/candidato/cuenta`.
- Candidate application stages remain exactly `submitted`, `in_review`, `hired`, and `rejected`.
- Candidate application sources remain exactly `referral`, `linkedin`, `job_board`, `direct`, and `other`.
- Profile education, salary-period, currency, and CEFR vocabularies mirror existing backend contracts without adding wire claims.
- All fixtures are local, fictional, validated, deterministic, and deeply frozen.
- No frontend route calls `/me/*`, uploads a CV, changes Cognito identity, writes storage, or reports fake success.
- The recruiter-facing `design/screens/candidato-detalle.html` is not a candidate dashboard reference.

## Constraints
- Strict RED → GREEN → REFACTOR; each implementation work unit stays at or below 400 authored additions+deletions.
- Node 22.23.2 and pnpm 10.34.5.
- Spanish UI; English code, tests, filenames, and repository documentation.
- Responsive at 375px and 1440px first, with 768px/1024px structural coverage.
- Reuse shared UI/sidebar/theme primitives; do not reuse employer content, user identity, fixtures, or navigation data.
- Do not edit the approved `(empresa)` routes, employer feature content, backend, package manifests, lockfiles, or committed design sources.
- Do not stop/reset/replace externally owned services on 3001/4010. Existing app preview 3100 may only be reused or restarted when explicitly needed.
- No real auth, fetch, persistence, upload, clipboard, generated-CV claims, notification system, or candidate/recruiter messaging.

## Tasks
- [x] **CDP-01 — Candidate identity and profile model:** Defined strict candidate identity/profile contracts and one deeply frozen fictional Mexican candidate fixture using backend-aligned vocabularies and normalization boundaries. Authored 381/400 lines; verification: 9/9 focused tests, TypeScript, ESLint, diff-check, and source readback PASS. Commit: `2637f5c`.
- [x] **CDP-02 — Applications and CV portfolio model:** Defined strict frozen application/CV metadata fixtures, exact status/source labels, derived summaries, two canonical public-job links plus two honest historical null links, and truthful no-upload boundaries. Authored 391/400 lines; verification: 20/20 candidate model tests, TypeScript, ESLint, diff-check, and source readback PASS. Commit: `dede71b`.
- [x] **CDP-03A — Candidate shell and navigation primitives:** Built the shared candidate shell/sidebar/header, route-aware five-destination navigation, cyan visual identity, mobile drawer, and fictional candidate footer without copying employer content. All brand/navigation/account targets stay at least 40px, with 48px expanded destination rows. Authored 398/400 lines; verification: 155/155 candidate+company tests, TypeScript, ESLint, diff-check, and LSP/source readback PASS. Commit: `717675c`.
- [x] **CDP-03B — Candidate route group and destination shells:** Added the `(candidato)` layout plus five honest real destination pages so every navigation link resolves before feature surfaces replace the previews. The layout owns one shell/main and mirrors exact sidebar-cookie semantics; pages own content only. Authored 392/400 lines; verification: 45/45 focused+shell tests, TypeScript, ESLint, diff-check, and LSP/source readback PASS. Commit: `aca9958`.
- [x] **CDP-04 — Candidate dashboard overview:** Built a props-only candidate overview with four derived metrics, transparent 13-field profile completeness, deterministic recent applications, exact four-status breakdown, truthful profile/CV guidance, neutral inventory copy, and local-demo disclosure. Authored 399/400 lines; verification: 34/34 overview+model tests, TypeScript, ESLint, diff-check, and LSP/source readback PASS. Commit: `86be189`.
- [x] **CDP-05 — Candidate dashboard route:** Replaced only the dashboard placeholder with CandidateHeader plus the verified props-only overview, supplying the four frozen fixtures at the route boundary while preserving the layout-owned shell and the other four previews. Authored 174/400 diff lines; verification: 86/86 candidate route/component/model tests, TypeScript, ESLint, diff-check, and LSP/source readback PASS. Commit: `c3cd1ba`.
- [x] **CDP-06A — Applications workspace surface:** Built a props-only searchable/status-filtered Postulaciones surface with exact counted filters, live result agreement, semantic non-clickable rows, canonical-or-historical job treatment, honest recovery/true-empty states, and no candidate-side mutation. Authored 339/400 lines; verification: 33/33 workspace+model tests, TypeScript, ESLint, diff-check, and LSP/source readback PASS. Commit: `b719f7a`.
- [ ] **CDP-06B — Applications route integration:** Replace only `/candidato/postulaciones` preview with CandidateHeader plus the verified workspace and frozen applications at the route boundary.
- [ ] **CDP-07 — Editable local profile and route:** Add `/candidato/perfil` with accessible backend-aligned sections, local validation, skills/languages controls, in-memory-only edits, reset behavior, and explicit no-save disclosure.
- [ ] **CDP-08 — CV workspace and route:** Add `/candidato/cvs` with frozen CV inventory, primary/current context, preview-safe metadata, disabled upload/replacement actions, and no generated-success claims.
- [ ] **CDP-09 — Account workspace and route:** Add `/candidato/cuenta` with fictional identity details, read-only provider/security context, and disabled email/password controls without auth/session claims.
- [ ] **CDP-10 — Integrated candidate acceptance:** Prove all routes, navigation, keyboard/focus, responsive overflow, candidate-scoped serious/critical Axe checks, and zero network/storage/business mutations in Chromium.

## Acceptance criteria
- The candidate workspace is visually related to the candidate login without copying the employer's user, organization, metrics, or recruiting operations.
- Sidebar active state follows nested candidate routes; every committed destination is a real Next route.
- Dashboard summaries and lists derive exclusively from validated frozen props.
- Applications use only the four existing application statuses and five existing sources, always with text labels.
- Profile edits remain local to the mounted page and never claim to save.
- CV upload/replacement and account credential changes are visibly unavailable and cannot fire hidden behavior.
- No horizontal document overflow at 375px or 1440px; focus remains visible; candidate-caused serious/critical Axe violations are zero.
- Public and employer routes remain unchanged and their focused regression contracts continue to pass.

## Evidence
- Exploration confirmed only `/candidato/login` exists on the frontend today; no candidate route group, shell, model, or dashboard is present.
- Backend evidence supports `/me/profile`, `/me/profile/languages`, `/me/applications`, and the closed profile/application vocabularies, but this prototype intentionally does not call those endpoints.
- `cv_s3_key` is reserved backend state and is absent from candidate wire responses; therefore CV uploads remain unavailable in this prototype.
- User approved the cyan derived visual direction, full five-route scope, locally editable profile, and honest disabled CV/account mutations.
- CDP-01 defines exact candidate identity plus backend-aligned profile, education, salary-period, CEFR, skills, language, date, and timestamp boundaries without modelling auth/session state or the reserved CV storage key.
- The fictional Ximena Barrera identity/profile graph and display dictionaries are deeply frozen. Independent verification: 9/9 focused tests, TypeScript, scoped ESLint, `git diff --check`, and source readback PASS; 381/400 authored lines.
- CDP-02 implementation: `dede71b`.
- Four application fixtures cover all existing stages and four representative sources. Only the two committed Acme jobs expose exact canonical detail links; hired/rejected historical jobs expose `null` instead of dead destinations.
- Two strictly local CV metadata entries expose one Spanish primary and one English secondary document with no URL, upload key/status, download state, generated/AI claim, storage handle, or callback. Independent verification: 20/20 candidate model tests, TypeScript, ESLint, diff-check, and source readback PASS; 391/400 authored lines.

## Next step
Implement CDP-06B by replacing only the Postulaciones placeholder with CandidateHeader plus the verified workspace and frozen application props, preserving every other route.
