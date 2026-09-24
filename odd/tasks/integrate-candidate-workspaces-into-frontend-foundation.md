# Integrate Candidate Workspaces into Frontend Foundation

## Objective

Merge the completed `feature/candidate-dashboard-prototype` product work into `feat/frontend-foundation` without losing the verified post-Verify vacancy remediation already present in the target branch.

## Constraints

- Preserve both committed histories and every verified target-branch remediation.
- Resolve conflicts from product intent and tests, never by choosing one branch wholesale.
- Do not modify backend, protected services, or remote state. Dependency installation is limited to the user-authorized offline frozen synchronization of the already-merged lockfile.
- Do not push, open a pull request, deploy, or release without separate authorization.
- Keep prior failed and successful verification attempts distinct.

## Tasks

- [x] **INT-01 — Preserve target remediation:** Audited the dirty target worktree and confirmed the changes were unique verified post-Verify work, not stale artifacts. Committed them as `5f567ac`, `7ce4a7d`, `9aa5c31`, and `76c7045` before integration.
- [x] **INT-02 — Merge and resolve:** Merged `feature/candidate-dashboard-prototype` into `feat/frontend-foundation`; resolved and staged every frontend and OpenSpec conflict while preserving the target API/filter/freshness contracts and the source product composition.
- [x] **INT-03 — Verify integrated tree:** Focused conflict tests, TypeScript, ESLint, full unit tests, production build, and isolated safe browser acceptance passed without contacting protected fixture services.
- [ ] **INT-04 — Close integration evidence:** Record the merge commit, exact verification results, residual risks, and delivery boundary.

## Evidence

- Source implementation commits: `bf1cef9`, `0b94a4f`, `2676691`.
- Target remediation commits: `5f567ac`, `7ce4a7d`, `9aa5c31`, `76c7045`.
- Pre-merge target and source worktrees were clean.
- A read-only merge-tree simulation predicted conflicts in public vacancy routes, shared layout/styles, PublicShell, job components, browser tests, fixture infrastructure, and historical OpenSpec evidence.
- Conflict resolution preserved request-scoped public job reads and metadata, attached prototype enrichment only at the route boundary, kept the approved self-hosted font/theme/public shell, combined both fixture control contracts, and retained both OpenSpec evidence chronologies without changing their historical verdicts.
- Focused Vitest: 7/7 files and 89/89 tests passed. An earlier 89/91 run failed only on two stale duplicate PublicShell tests introduced by the merge; those tests were removed because the approved source suite already covered the same behavior with the required browser API stubs.
- TypeScript and ESLint passed.
- Full Vitest: 102/102 files and 1358/1358 tests passed in 65.28s. Existing jsdom canvas/WebGL, zero-size chart, and root-layout nesting warnings remained non-failing.
- Production build passed under the Node 22.23.2 command environment: 15 static pages generated, 18 routes reported, no build warning or blocker.
- Isolated Chromium acceptance on port 3120: 30/30 tests passed in 4.4m (candidate 9, employer 5, login 16), with no Axe or prohibited-traffic assertion failures. The owned server was stopped and port 3120 was confirmed free. Public-job browser specs remained intentionally skipped because they require protected fixture services.
- Browser command shell reported Node 22.23.2; the pnpm launcher path belonged to a Node 24 installation, so the exact server/Playwright interpreter could not be confirmed retrospectively. Non-browser verification and build used the required Node 22.23.2 environment.
- Final LSP cleanup added explicit Base UI callback types in the chart and table integrations. Focused verification passed 2/2 files and 57/57 tests; TypeScript and focused ESLint passed. Existing zero-size chart warnings remained non-failing.

## Delivery Boundary

Commit and local merge are authorized. Push, pull request, deployment, release, package installation, remote operation, and protected-service mutation remain unauthorized.
