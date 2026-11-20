# Remove birth date and cover letter

Closes the two partial 2 Oct agreements (`odd/discovery/recruitment-business-rules.md`). Frontend on branch
`feat/remove-birthdate-cover-letter`; backend on `feat/remove-birthdate-cover-letter-backend` (worktree
`peopleflow-vacantes-nobirth`, backend session). The frontend ships first so no client sends a field the backend rejects.

## Specs

- **S1** «Quitar fecha de nacimiento y edad» (status: «Quitado de la captura del reclutador; sigue en el perfil del
  candidato»): the candidate Perfil no longer captures, shows or sends the birth date: no form field, no read-only
  fact, no «¿Qué ve una empresa?» mention, `birth_date` absent from the PUT `/me/profile` body; reading a profile with or
  without `birth_date` keeps working. Manual intake keeps rejecting it.
- **S2** «Quitar la carta de presentación» (status: «Ya no se pide en pantalla (falta limpieza interna)»): no
  `coverLetter` in the frontend models, fixtures or tests; the guard tests that assert its absence stay.
- **S3** Backend (backend session; specs in `odd/tasks/remove-birthdate-cover-letter-backend.md` on its branch): GET `/me/profile` stops returning `birth_date`; PUT accepts and ignores the key
  during the transition; `cover_letter` leaves the legacy application routes; a separate migration drops
  `candidate_profiles.birth_date` and `applications.cover_letter` (user decision L2, backup before the production deploy).

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | S1, S2 | Frontend: remove birth date from Perfil (form, read view, visibility map, draft, adapter, schemas, errors) and cover letter from the prototype portfolio model, with tests (worker) | `807bc300` |
| T2 | S3 | Backend code + DROP migration on its own branch (backend session) | backend merge `689da412` |
| T3 | S1–S3 | Joint local merge into main after both suites and a browser check of Perfil | this merge |

## Log

- **L1** User (2026-11-19), choosing among the open 2 Oct agreements: «Cerrar los dos parciales primero (Recomendado)».
  Frontend map: birth date only on the candidate side (profile-adapter always sends `birth_date`, even null; read schema
  has it optional); cover letter only in `portfolio-model.ts` / `prototype-portfolio.ts` (not wired). Backend map: PUT
  `/me/profile` decoder is strict and the PUT is a full replacement; `cover_letter` only on legacy routes the frontend
  does not call (grep: no `/me/applications` or non-v2 `/jobs/{id}/applications`).
- **L2** User decision: birth date «Borrar la columna con una migración (Recomendado)»; cover letter «Borrar la columna
  con una migración (Recomendado)».
- **L3** T1 `807bc300` (worker, TDD: RED 14 tests in 8 files, GREEN related 261 files / 4905 tests, tsc and eslint clean):
  PUT body without `birth_date` (write schema rejects it), read schema tolerates it during the transition
  (`profile-api.ts:32`), form field, read fact, visibility entry and copy removed, unused `dateText` deleted; cover letter
  out of the prototype portfolio model. Backend swaps :8080 to its branch API in the same step as migration 00062.
- **L4** Backend verified S1–S3 (00062 up/down/up on an isolated DB), applied 00062 to the dev DB and swapped :8080 to its
  branch API in one step, then merged into main (`689da412`, `make test` exit 0). Browser check of this branch on :3000
  against it, 1440 light and 390 dark: no «Fecha de nacimiento» in any Perfil tab (read and edit) or in «¿Qué ve una
  empresa?»; a reversible portfolio change saved, re-read and restored, no ≥400, no console errors, no overflow; saves carry
  no `birth_date`. Full frontend suite: 582 files / 10525 tests passed (2 skipped), tsc 0, lint 0 errors (12 pre-existing
  warnings). Merged into local main; not pushed.
