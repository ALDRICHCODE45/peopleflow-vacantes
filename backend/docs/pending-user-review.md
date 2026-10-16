# Backend work pending the user's browser review

The user is away from a browser and asked both agents to keep implementing and to
accumulate what needs review (L28 in `odd/tasks/pipeline-customization.md`). Nothing
listed here is merged into `main`. Branches are stacked; review and merge them **in
order, bottom first**. Each backend branch is paired with the frontend branch that
implements its UI.

| Order | Backend branch | Frontend branch | Scope | How to test | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | `feat/vacancy-publication` (from `main` 79cda65) | `feat/vacancy-publication-ui` | Publication P1: «Solicitud» (request date, headcount), readiness checklist, publish, portfolio status | Frontend `docs/employer-manual-test.md` steps 29–33; backend `make db-migrate` applies 00018 and 00019 | Backend verified (L27); awaiting browser test |
| 2 | `feat/vacancy-public` (stacked on 1) | `feat/vacancy-public-ui` (stacked on its P1 branch) | P2a: published vacancies in the public listing/detail (`/v2/jobs`), guard that keeps published content complete | Frontend `docs/employer-manual-test.md` steps 34–36; backend `make db-migrate` applies 00020 | Backend implemented and integration-tested (L34); verification running; awaiting browser test |
| 3 | `feat/vacancy-public` (P2b, same branch) | P2b frontend branch | P2b: CV library and applying with CV and screening answers into `Nuevos` | To be added when implemented | Contract in progress |

Per branch, before merging after approval: merge into `main` locally (no PR), keep the
frontend tree from the frontend merge and the backend tree from the backend branch,
and the user pushes.

Housekeeping awaiting the user: the git stash `p1-rest` (backup from splitting the P1
commits, fully committed since) can be dropped once P1 is approved.
