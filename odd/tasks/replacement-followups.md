# Replacement processes follow-ups (frontend)

Frontend follow-ups of `replacement-processes.md` (L12–L13) listed in `frontend-backlog.md` «Replacement processes
follow-ups». Branch `feat/replacement-followups` from `main` `c2fde6bd`. Backend counterpart (separate session):
`feat/replacement-followups-backend` (board-item `carried_from_participation_id`, dashboard charts without carried
participations, `birth_date` rejected again).

## Specs

- **S1** «carry rows do not show the discard reason» → the carry candidate rows (step 3 «Candidatos que retomas») show
  the discard reason of a discarded candidate.
- **S2** «the dialog header has no icon tile or company name» → the «Iniciar reemplazo» dialog header shows the icon
  tile and the company name, as in artboard `design/replacement-processes/04-tarjeta-y-dialogo.html`.
- **S3** «the finished original has no «Acciones» button» → a finished original shows the «Acciones» button.
- **S4** «the 390 breadcrumb ellipsis for long titles comes from the sidebar top bar» → at 390 px a long vacancy title
  in the top-bar breadcrumb stays readable (no premature ellipsis).
- **S5** «Retomado» mark on carried cards (needs `carried_from_participation_id` on board items; same optional-first
  deployment order) → board cards of carried candidates show «Retomado», reading the optional backend field.
- **S6** «the publish dialog plural «1 candidato» is checked only by a unit test» → verified in the browser.

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | S1 | Discard reason on carry rows | |
| T2 | S2 | Dialog header icon tile and company name | |
| T3 | S3 | «Acciones» on the finished original | |
| T4 | S4 | 390 breadcrumb | |
| T5 | S5 | «Retomado» mark (waits for the backend field name) | |
| T6 | S1–S6 | Browser check, full suite, local merge to main | |

## Log

- **L1** (2026-11-22) User: «Si hermano, adelante, avisame cuando todo este mergeado a main para poder hacer push, por
  favor.» Backend session relayed the user's request to do all pending items (backend there, frontend here); the user
  confirmed here: «Sí, arrancá con los follow-ups del frontend». Decisions relayed: no prod yet (no deploy); documents
  (PDF, Word, Excel, JPG/PNG, max 10 MB) follow a contract the backend writes first; owners and authorized recruiters
  delete with audit, stakeholders read only.
- **L2** `birth_date`: the profile write schema is strict and never sends it (`profile-api.ts:39`); the read keeps a
  tolerant `birth_date: z.unknown().optional()` until the GET stops returning it.
