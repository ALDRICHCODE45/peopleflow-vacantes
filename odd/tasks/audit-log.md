# Audit log («Auditoría»)

Feature 2 of 3: record who did what, including sensitive reads and sessions, and give the owner an audit screen with
filters and export. Frontend over a contract the backend session proposes (worktree `peopleflow-vacantes`); product
source `docs/product/next-three-features.md` §2.

## Specs

- **S1** The need, verbatim: «no se podia saber que hizo cada reclutador, no se podia saber si un reclutador descargo
  algo, que hizo ( cosas sencibles), cuando las hizo, que paso despues, que descargo, cuando lo descargo, cuando inicio
  sesion, cuando cerro sesion».
- **S2** Sensitive reads: «detalle de candidato, descarga de CV, exportación de contactos (hoy solo se audita ver un
  resultado psicométrico)».
- **S3** Session: «inicio de sesión (Cognito o BFF de Next) y "cerró sesión" al hacer clic. Con JWT no hay un registro
  exacto de expiración; se dice así, sin prometer más.»
- **S4** «Miembros y roles: hoy no se auditan.» They become audited.
- **S5** «IP y navegador: el BFF de Next reenvía la IP real del usuario (trabajo del frontend).»
- **S6** «`company_id` en cada evento, para filtrar por empresa.»
- **S7** «Inmutable de verdad: la base impide UPDATE/DELETE (hoy es solo convención); opcional, cadena de hashes.»
- **S8** «Datos personales (LFPDPPP): IDs, no datos personales, en la metadata; política de retención definida.»
- **S9** «Pantalla de auditoría: filtros por persona, acción, fecha y vacante; exportar (solo owner) también queda
  auditado.»
- **S10** Permission principle: «las cosas que "solo pueda hacer el owner" se limiten a las acciones mas sencibles y
  especificas, no a cada cosa que consideremos "importante"»; «Exportar la auditoría completa» is owner only.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1–S10 | Contract proposal from the backend session, frontend review, open decisions to the user (done, L3–L4) | — |
| T2 | S5 | 2a, inline: server-only helper sending X-PF-Proxy-Secret / X-PF-Client-IP / X-PF-Client-User-Agent on every server call to the API, plus a test that fails when a call site skips it (Risk: item 2, a shared secret) (done, L5–L7) | `40a4a825` |
| T3 | S3 | 2a, inline: session start in the NextAuth jwt callback on sign-in only; «end session» server action called before every signOut(); short timeout, failures never block (done, L5–L7) | `1b39c7a4` |
| T4 | S2–S9 | 2a integration against the backend 2a on :8081 (rows with ip_source=bff, session rows, sensitive reads) | |
| T5 | S6, S8–S10 | 2b: owner-only audit screen (filters person, action, date, vacancy; labels; «IP no verificada»; entity labels) and CSV export through a streaming route handler | |
| T6 | all | 2b integration, verification, partner doc update | |

## Log

- **L1** (user, 2026-11-03, original request): «Hola hermano, continuemos donde nos quedamos por favor.» Resumed from
  `talent-base-visibility.md` L14 («Next: feature 2 (Auditoría)»). Specs quote `docs/product/next-three-features.md`
  §2 verbatim. Finding: the Next BFF forwards no client IP today (no `X-Forwarded-For` in `frontend/`).
- **L2** Backend acknowledged (2026-11-04): working on branch `feat/audit-log-backend` (from main), mapping the current
  audit code, then drafting `docs/contracts/audit-log-v1.md` with the 9 points and open decisions. Dev DB migrated
  53→55.
- **L3** Backend draft `docs/contracts/audit-log-v1.md` at `b85ff82e` (`feat/audit-log-backend`): new columns company_id,
  vacancy_id, ip, user_agent, ip_source; one row per sensitive read (CompanyCandidateViewed, CompanyCandidateCVDownloaded,
  CompanyCandidateContactsRevealed, ParticipationViewed, ParticipationCVDownloaded); POST `/v2/me/session/start|end`
  (204); member events; BFF headers X-PF-Proxy-Secret / X-PF-Client-IP / X-PF-Client-User-Agent; append-only trigger;
  owner-only list/types/actors/export (CSV, ≤50k rows, ≤366 days); slices 2a capture, 2b screen; open D1–D7.
  Frontend review sent (F1–F6): F1 signOut() clears the NextAuth session client-side before
  `/api/auth/cognito/logout`, so the frontend adds its own server "end session" action called before signOut(); start
  in the NextAuth jwt callback when `account` is present. F2 no central BFF: ~52 server call sites (41 requestJson, 11
  raw fetch) → one server-only header helper plus a test; ip_source=peer shown as «IP no verificada». F3 detail reads
  are server actions/RSC with no polling, so staleTime advice does not apply. F4 ask `entity.label` resolved at read
  time (and `entity_label` in CSV). F5 ask `/audit-events/vacancies` for the vacancy filter. F6 confirm the export 422
  is decided before the first byte.
- **L4** Backend applied F1–F6 at `b592a04a` (entity.label, `/audit-events/vacancies`, count before the first byte in
  one REPEATABLE READ tx). User decisions (2026-11-04): D2 «24 meses (Recomendado)»; D5 «Solo el owner
  (Recomendado)»; D1, D3, D4, D6, D7 «Sí, todas como recomiendan (Recomendado)». T1 done; branch `feat/audit-log`.
- **L5** T2 design: one fetch wrapper installed from `src/instrumentation.ts` (Node runtime) instead of editing ~52 call
  sites; it decorates only calls to the API origin that carry `authorization`. Runtime probe under `next dev` with an
  echo API: the authenticated call carried x-pf-proxy-secret, x-pf-client-ip `::ffff:127.0.0.1` and the browser UA; the
  public call none. The probe caught `node:net` breaking the build (instrumentation is also compiled for edge); fixed
  with edge-safe validation. Next appends the socket peer to X-Forwarded-For, so hops=0 is right locally; Amplify hops
  are measured on the first deploy (`docs/decision-frontend-hosting.md` §7). T3: `onSignIn` hook in the jwt callback,
  `signOutWithAudit` for the 4 buttons plus a structural test.
- **L6** Independent verify (gentle-ai-verify): S3 met, S5 met with one advisory, fixed: fetch follows a cross-origin
  redirect keeping x-pf-proxy-secret (undici strips only Authorization), so decorated calls now force
  `redirect: "error"` (RED observed first). Full suite on Node 22: 9611 passed, 5 failed + 1 file; the 5 pass alone
  (load flakiness, as in talent-base L13); `wizard.test.tsx` was a real regression (partial next-auth mock vs the new
  sign-out import), fixed by loading next-auth lazily in `sign-out.ts`.
- **L7** Commits: T2 `40a4a825` (alone, high-risk item 2), T3 `1b39c7a4`. The 4 load-timeout tests pass alone (120/120),
  `tsc` 0 errors. Slice boundary: the frontend 2a slice is these two commits (519 authored lines, each under ~400);
  the 2b screen starts a new slice. Next: T4 when the backend 2a is ready.
