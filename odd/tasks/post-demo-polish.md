# Post-demo polish

Small follow-ups left open by the metrics redesign (`odd/tasks/dashboard-redesign.md`, L58) and the candidate redesign
(`odd/tasks/candidate-dashboard-modern.md`, L32, L39, L40). Worked on branch `fix/post-demo-polish` in a separate
worktree so the demo build on :3000 and `main` stay untouched until the user approves.

## Specs

- **S1** Company Métricas polish from L58: dark «A tiempo» legend dot contrast ≥ 3:1; monthly drill-down summaries name
  the month instead of «en el periodo»; the late-bucket summary does not compare the bucket with itself; at 390 px the
  Métricas recruiter names are not cut by «Sin datos suficientes»; «Desempeño por reclutador» header actions in the same
  order as the rest («Cómo se calcula» first); dashboard «Vacantes activas» becomes stacked rows at 390 px.
- **S2** Candidate polish: the Perfil «Experiencia» tile does not break «Semi-senior» at the hyphen; long professional
  titles on narrow pipeline cards stay readable (tooltip or title attribute with the full title); the audit log does not
  label a candidate actor «Ex miembro».
- **S3** Third-party license notice for pdfjs-dist (Apache-2.0), since minification strips its header.
- **S4** Backend: the CV download name «… .pdf.pdf» (backend session).

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | S1 | Métricas and company dashboard polish (worker) | `fe7ed6db` |
| T2 | S2, S3 | Candidate polish and the pdf.js license notice (worker) | `f7414012` |
| T3 | S4 | Backend fixes the double extension on its own branch (backend session) | backend `fix/cv-download-filename` 112699b5 |
| T4 | — | Remove the dead legacy `components/company-dashboard/section-cards.tsx` (backend finding while removing the old endpoint) | `6d38d254` |

## Log

- **L1** User (2026-11-18, before sleeping): «necesito dejarte haciendo algo para la reunion de manana, que falta? me
  parece que nada, pero no se tu. si no falta nada, hay que retomar lo que estabamos haciendo antes del plan de la
  reunion hermano.» Nothing is missing for the meeting (main merged, demo data reset, :3000 warm). Resuming the open
  follow-ups on a separate branch; nothing reaches :3000 or main without the user's approval.
- **L2** T1 done at `fe7ed6db` (S1, all six items): dark «A tiempo» token `--pf-tone-on-time` (brand strong, ≥ 3:1;
  light stays `--primary`); monthly summaries name the month; late buckets counted without a %; narrow recruiter names
  wrap; «Cómo se calcula» first; dashboard «Vacantes activas» stacked below `sm`. Related tests 341/341, tsc and eslint
  clean; not browser-checked (screenshots under `/tmp/pf-review/s10d/` are gone). `design/system.md` does not list the
  new token yet.
- **L3** T2 `f7414012` (worker; related 57 files / 870 tests, tsc/eslint 0): Experiencia tile keeps «Semi-senior» whole; narrow
  pipeline cards expose the full title (`title` and the name hint «Nombre · Título»); audit log no longer shows «Ex miembro»
  for candidate self-events (CandidateAccountCreated, VacancyApplicationSubmitted, ApplicationSubmitted,
  PsychometricConsentGiven, PsychometricAssessmentFinished) because the actor payload has no kind — the «Persona» filter
  still says «(ex miembro)»; `frontend/THIRD_PARTY_NOTICES.md` and `/third-party-notices.txt` (pdfjs-dist 6.5.438,
  Apache-2.0, «Copyright 2024 Mozilla Foundation»), no footer link yet.
- **L4** Backend branches ready, not merged or deployed: `fix/cv-download-filename` @ 112699b5 (single «.pdf» in every CV
  download), `feat/remove-legacy-dashboard` @ 7037525f (old GET /v2/me/company/dashboard removed, 404). T4 `6d38d254` removes
  the dead `section-cards.tsx` and its test row; tsc 0, card-composition 7/7.
- **L5** Full suite on `fix/post-demo-polish`: 582 files / 10521 tests passed (2 skipped), tsc 0, lint 0 errors (12 pre-existing warnings). Pending: browser check at 390 and dark on a separate build (not :3000), then the user's review after the meeting.
