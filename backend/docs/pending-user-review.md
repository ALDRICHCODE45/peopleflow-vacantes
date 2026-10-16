# Backend work pending the user's browser review

The user is away from a browser and asked both agents to keep implementing and to
accumulate what needs review (L28 in `odd/tasks/pipeline-customization.md`). Nothing
listed here is merged into `main`. Branches are stacked; review and merge them **in
order, bottom first**. Each backend branch is paired with the frontend branch that
implements its UI.

| Order | Backend branch | Frontend branch | Scope | How to test | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | `feat/vacancy-publication` (from `main` 79cda65) | `feat/vacancy-publication-ui` | Publication P1: «Solicitud» (request date, headcount), readiness checklist, publish, portfolio status | Frontend `docs/employer-manual-test.md` steps 29–33; backend `make db-migrate` applies 00018 and 00019 | Backend verified (L27); awaiting browser test |
| 2 | `feat/vacancy-public` (stacked on 1) | `feat/vacancy-public-ui` (stacked on its P1 branch) | P2a: published vacancies in the public listing/detail (`/v2/jobs`), guard that keeps published content complete | Frontend `docs/employer-manual-test.md` steps 34–36; backend `make db-migrate` applies 00020 | Backend verified and native review approved (L34, L36); awaiting browser test |
| 3 | `feat/candidate-identity` (stacked on 2) | candidate identity frontend branch | P2b0: candidate sign-up/sign-in, explicit onboarding, candidate-only routes | To be added; Cognito console checks in design §11.4 | Contract agreed; implementation starting |
| 4 | P2b branch (stacked) | P2b frontend branch | P2b: CV library and applying with CV and screening answers into `Nuevos` | To be added when implemented | Contract agreed; blocked on P2b0 |

Per branch, before merging after approval: merge into `main` locally (no PR), keep the
frontend tree from the frontend merge and the backend tree from the backend branch,
and the user pushes.

Housekeeping awaiting the user: the git stash `p1-rest` (backup from splitting the P1
commits, fully committed since) can be dropped once P1 is approved.

Open decisions awaiting the user:

- Reversal of a mistaken candidate onboarding (support/admin tool or none) — design §11.3.
- AWS console checks for candidate sign-up — design §11.4 (self sign-up with email
  verification, sign-out URL `http://localhost:3000/candidato/login`).
