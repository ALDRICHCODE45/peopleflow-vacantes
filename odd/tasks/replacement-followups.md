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
- **S7** Backend: «el PUT /me/profile ahora lo rechaza con 400 invalid_request (ff3b7888). El GET ya no lo devolvía desde
  00062, así que podés sacar la lectura tolerante cuando quieras.» → `profileReadSchema` no longer accepts `birth_date`.
- **S6** «the publish dialog plural «1 candidato» is checked only by a unit test» → verified in the browser.

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | S1 | Discard reason on carry rows (`discard_reason`) | `a3d147fb` |
| T2 | S2 | Dialog header icon tile and company name | |
| T3 | S3 | «Acciones» on the finished original | |
| T4 | S4 | 390 breadcrumb | |
| T5 | S5, S7 | «Retomado» mark (`carried_from_participation_id`) and drop the tolerant `birth_date` read | |
| T6 | S1–S6 | Browser check, full suite, local merge to main | |

## Log

- **L1** (2026-11-22) User: «Si hermano, adelante, avisame cuando todo este mergeado a main para poder hacer push, por
  favor.» Backend session relayed the user's request to do all pending items (backend there, frontend here); the user
  confirmed here: «Sí, arrancá con los follow-ups del frontend». Decisions relayed: no prod yet (no deploy); documents
  (PDF, Word, Excel, JPG/PNG, max 10 MB) follow a contract the backend writes first; owners and authorized recruiters
  delete with audit, stakeholders read only.
- **L2** `birth_date`: the profile write schema is strict and never sends it (`profile-api.ts:39`); the read keeps a
  tolerant `birth_date: z.unknown().optional()` until the GET stops returning it.
- **L3** Backend `feat/replacement-followups-backend` (not merged yet), verbatim: «1) Items del tablero (lista, detalle,
  original, respuestas de mover/descartar/recuperar/subestado, créditos y alta manual): `carried_from_participation_id` es un
  string UUID de la participación de origen, o `null`. Siempre viene. 2) … cada item de `carry_candidates[]` trae
  `discard_reason`. Si `discarded` es true, con la misma forma y los mismos nombres que `discard.reason` del tablero
  ({group, key}); si no, `null`. Siempre viene.» Frontend reads both optional first (deployment order: the strict board
  schemas must accept the key before the backend merges). User, relayed: «nadie TOQUE NADA DE AWS TODAVIA».
- **L4** Exploration (T2–T4): artboard `04-tarjeta-y-dialogo.html:321` header = 40×40 tile (`rounded-[14px]`, primary/10,
  lucide `Repeat` 20px) + «Iniciar reemplazo» + meta «<título> · <empresa>»; company name from
  `useCompanyMembershipState()` (`state.kind === "exists"` → `company.name`). «Acciones» hidden by `board.tsx:145` when
  `allowed_actions` is empty and `can_start_replacement` is false (finished original with an active replacement); the
  artboard keeps the button with «Iniciar reemplazo». Breadcrumb: `components/company-dashboard/site-header.tsx` truncates
  the only copy of the title at 390; precedent `candidate-dashboard/candidate-header.tsx:28-34`.
