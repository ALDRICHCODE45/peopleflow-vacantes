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
| T1 | S1 | Métricas and company dashboard polish (worker) | — |
| T2 | S2, S3 | Candidate polish and the pdf.js license notice (worker) | — |
| T3 | S4 | Backend fixes the double extension on its own branch (backend session) | — |

## Log

- **L1** User (2026-11-18, before sleeping): «necesito dejarte haciendo algo para la reunion de manana, que falta? me
  parece que nada, pero no se tu. si no falta nada, hay que retomar lo que estabamos haciendo antes del plan de la
  reunion hermano.» Nothing is missing for the meeting (main merged, demo data reset, :3000 warm). Resuming the open
  follow-ups on a separate branch; nothing reaches :3000 or main without the user's approval.
