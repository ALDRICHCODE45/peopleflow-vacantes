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
| T5 | S6, S8–S10 | 2b, worker (background), built against the agreed contract before the backend 2b exists (L10): owner-only audit screen (filters person, action, date, vacancy; labels; «IP no verificada»; entity labels) and CSV export through a streaming route handler (done, L10–L12) | `46baad77`, `f54637d9`, `6122d776`, `5bab0cce` |
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
- **L8** Native review (RDD) of the 2a slice, base `7be2becc`, lenses risk/resilience/reliability, tier high (auth hot
  path): **approved**, lineage `review-819a9620e7e50336`, acknowledged (authority burned). 12 non-blocking advisories,
  kept as follow-ups (separate later work, never a re-review of this candidate):
  - Config: an empty `AUDIT_TRUSTED_PROXY_HOPS=""` fails startup (treat empty as the default); hops=0 records the
    nearest proxy's IP behind CloudFront/Amplify until it is measured on the first deploy (already in hosting §7).
  - Observability: session start/end and forwarding failures are swallowed silently; add a credential-free server log.
  - Redirects: decorated calls now force `redirect: "error"`; any future API redirect surfaces as a network error.
  - Sign-in latency: the start call is awaited in the jwt callback (bounded to 2 s).
  - `install.ts` uses `serverEnv.apiBaseUrl` as the origin (validated bare origin today); `options.ts` now loads the
    server env in the NextAuth route; the structural sign-out test does not catch an aliased import.
- **L9** (user, 2026-11-04): «Si, adelante. ok» — authorized reading `AUDIT_PROXY_SECRET` from
  `../peopleflow-vacantes/backend/.env`. Copied to `frontend/.env.local` (gitignored) without printing it (64 chars).
  Backend notified; T4 waits for the backend 2a on :8081.
- **L10** Backend 2a in progress (migration 00056 + trigger GREEN). While T4 waits, T5 starts against the agreed
  contract (§8.1–§8.5 at `9aeea3bd` plus F4 `entity.label`, F5 `/audit-events/vacancies`), with client and UI tests
  on fixtures; wiring to the real API is checked in T6.
- **L11** T5 worker done (27 files, ~1989 lines, uncommitted): model/url-state, client/actions/export route, workspace
  UI, owner-gated page and sidebar entry; 288 focused tests, tsc and eslint clean (worker report). Contract gaps
  confirmed by the backend at `b9a0d07b` (§8.5): 422 `audit_export_too_large` is `{error, code, row_count, limit}`;
  missing from/to → 422 `invalid_filter` `{field, code: "required"}`, malformed → `invalid`, from>to or >366 days →
  `range` on `to`; 366 days inclusive; responses are closed (new fields are announced first). Commits split in four
  layer units.
- **L12** T5 commits: `46baad77` model/url-state, `f54637d9` client/actions/export route, `6122d776` workspace UI,
  `5bab0cce` owner page and sidebar. Parent re-ran the checks: 20 files, 313 tests, tsc 0 errors, eslint clean.
  Slice boundary: the 2b screen slice is these four commits (~1989 lines, split by layer; the workspace commit is ~730
  because its 356-line test travels with it). T6 wires it to the real backend 2b.
- **L13** Native review (RDD) of the 2b screen slice, base `0fe9bc91` (offered by inspect), lenses risk/readability/
  reliability, tier medium: **approved**, lineage `review-e99aa1aebe889d88`, acknowledged (authority burned). 12
  non-blocking advisories, follow-ups for T6:
  - Fix in T6: `download.ts:17-19` revokes the blob URL before the download may start (R3-revoke-before-download);
    `model.ts:185` local range errors use a field other than the backend's `range` on `to` (R3-range-field-drift).
  - Check in T6: `client.ts:60-74` export header/stream timeouts are untested and one risk warning sits there (R1-001);
    the stale «Cargar más» guard after a filter change (`use-audit-events.ts:51-54`).
  - Readability suggestions in `client.ts`, `actions.ts`, `url-state.ts`, `use-audit-events.ts` and the export route.
- **L14** Backend 2a implemented (tip `00ddbe97`), independent verify running, then :8081. Contract deltas: session
  start/end ignore the body and answer 500 on audit failure (frontend already sends none and ignores failures); no 304
  path; contacts row lists only returned candidates; member DELETE also emits `CompanyMemberOffboarded`; Annex now has
  the 63 labels. Frontend adopted the 63 labels (RED first, 111/111 audit tests, tsc 0) in `d71401e9`.
