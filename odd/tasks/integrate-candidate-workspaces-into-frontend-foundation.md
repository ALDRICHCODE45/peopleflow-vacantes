# Integrate Candidate Workspaces into Frontend Foundation

## Objective

Merge the completed `feature/candidate-dashboard-prototype` product work into `feat/frontend-foundation` without losing the verified post-Verify vacancy remediation already present in the target branch.

## Constraints

- Preserve both committed histories and every verified target-branch remediation.
- Resolve conflicts from product intent and tests, never by choosing one branch wholesale.
- Do not modify backend, dependencies, lockfiles, protected services, or remote state.
- Do not push, open a pull request, deploy, or release without separate authorization.
- Keep prior failed and successful verification attempts distinct.

## Tasks

- [x] **INT-01 — Preserve target remediation:** Audited the dirty target worktree and confirmed the changes were unique verified post-Verify work, not stale artifacts. Committed them as `5f567ac`, `7ce4a7d`, `9aa5c31`, and `76c7045` before integration.
- [ ] **INT-02 — Merge and resolve:** Merge `feature/candidate-dashboard-prototype` into `feat/frontend-foundation` and resolve every committed-history conflict while preserving both public-job foundation behavior and the completed candidate/employer/public presentation work.
- [ ] **INT-03 — Verify integrated tree:** Run focused conflict-area tests, TypeScript, ESLint, full unit tests, and safe browser acceptance without contacting protected fixtures.
- [ ] **INT-04 — Close integration evidence:** Record the merge commit, exact verification results, residual risks, and delivery boundary.

## Evidence

- Source implementation commits: `bf1cef9`, `0b94a4f`, `2676691`.
- Target remediation commits: `5f567ac`, `7ce4a7d`, `9aa5c31`, `76c7045`.
- Pre-merge target and source worktrees were clean.
- A read-only merge-tree simulation predicted conflicts in public vacancy routes, shared layout/styles, PublicShell, job components, browser tests, fixture infrastructure, and historical OpenSpec evidence.

## Delivery Boundary

Commit and local merge are authorized. Push, pull request, deployment, release, package installation, remote operation, and protected-service mutation remain unauthorized.
