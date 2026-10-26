# Public vacancies inside the candidate app shell

Branch `feat/vacancies-in-app-shell` from `feat/qa-details-2` @ abe6a9f9 (the uncommitted segmented-tabs QA fix
travels in the worktree and is not part of these commits). `/vacantes`, `/vacantes/[jobId]` and
`/vacantes/[jobId]/postular` stay public and move into the candidate shell; `/empresas/[companyId]` stays outside.

## Specs

- **S1. Public listing inside the app layout.** «el listado de vacantes esta fuera del layout del sistema (el que tiene
  el sidebar, etc..) y me gustaria que este dentro del layout del sistema» — and it stays public: «se puede ver sin
  necesidad de tener una sesion». URLs do not change; server rendering, metadata and canonical/noindex rules of the
  three routes do not change.
- **S2. Scope.** «Si, hay que incluir los dos» — the vacancy detail and the apply flow move with the listing.
  «Si hermano, queda fuera» — `/empresas/[companyId]` keeps `PublicShell` (it grows later, out of scope).
- **S3. Adapt sidebar and navbar to the session.** «hay que adaptar el sidebar, el navbar, etc.. para que no muestre
  contenido que solo se debe mostrar cuando hay una sesion activa». Visitor decision (L3): «Ocultarlas + tarjeta de
  valor» — only «Vacantes» in the menu, and a footer card «Guarda tu búsqueda y sigue tus postulaciones» with
  «Crear cuenta», «Iniciar sesión» and «¿Eres empresa? Publica vacantes». While the session loads, no private item
  is shown even briefly (footer skeleton). On mobile the header carries «Ingresar» because the footer card is
  off-canvas.
- **S4. Candidate with session.** Sees «Vacantes» plus the full candidate menu and account menu of today; the shell
  stays mounted when moving between «Vacantes» and `/candidato/*` (no flash, same collapsed state).
- **S5. Employer/recruiter.** «ve lo mismo que veria el candidato, peroo no puede hacer las acciones que haria un
  candidadto porque es un reclutador/empleador» and «la ui/ux hay que hacerla muy bien aqui, piensa en tdos los
  detalles y sigue tu system design». Decision (L3): «Vista de candidato + «Ir a mi panel»» — only «Vacantes» in the
  menu, footer notice «Estás viendo las vacantes como las ve un candidato» with «Ir a mi panel», and the account menu
  (company label, sign out). On the detail, «Postularme» is replaced by the note «Las postulaciones son para cuentas
  de candidato» with «Ir a mi panel»; the apply route shows the same message.
- **S6. App header.** «Vacantes» routes use the app header (sidebar trigger, breadcrumb, theme) with exactly one `h1`
  per page. The `PublicShell` floating navbar, glow, dot grid and footer no longer apply to vacancy routes.
- **S7. Return to origin after login.** Decision (L3): «Sí, incluirlo» — «Iniciar sesión o crear cuenta desde vacantes
  te devuelve al mismo lugar» (filters kept, vacancy open). Only internal relative paths are accepted; anything else
  falls back to today's destination. Sign-out and the existing apply-wizard callback keep working.

## Tasks

- [x] T1. S7 — return-to after candidate login/sign-up (safe internal paths, guard keeps destination) · worker B ·
  high risk (security) · own commit 159a04e4 · independent verify (L5).
- [x] T1b. S1 S4 — session subtree remount fix found by e2e (L7) · parent · high risk (privacy) · own commit d969ec33
  · independent verify PASS.
- [x] T2. S1 S2 S4 S6 — move vacancy routes under `(candidato)`, guard into `/candidato/*` layout, app header without a
  second `h1` · worker A.
- [x] T3. S3 S5 — sidebar viewer modes (loading, visitor, candidate, recruiter), footer cards, mobile «Ingresar» · worker A.
- [x] T4. S5 S7 — detail CTA by role and apply-route recruiter message; visitor CTA links to login with return · worker A.
- [x] T5. S1–S7 — update unit/e2e tests pinning the old public shell, docs (§ sidebar/shell in
  `docs/frontend-ui-design-rules.md`), browser check in light/dark, desktop/mobile · parent.

## Log

- **L1 (2026-10-25, user):** «Y ya que estamos de paso... me gustaria de una vez platicar contigo sobre una desicion
  especifica que quiero tomar, actualmente el listado de vacantes de publico, cierto? es decir, se puede ver sin
  necesidad de tener una sesion, sin embargo, el listado de vacantes esta fuera del layout del sistema (el que tiene el
  sidebar, etc..) y me gustaria que este dentro del layout del sistema, pero que, evidentemente hay que adaptar el
  sidebar, el navbar, etc.. para que no muestre contenido que solo se debe mostrar cuando hay una sesion activa, y
  cuando se quieran ejecutar ciertas acciones que requieran sesion, se mande al inicio de sesion pertinente. me
  sigues?»
- **L2 (user):** «1. YO digo que ve lo mismo que veria lo mismo que ve el candidato, peroo no puede hacer las acciones
  que haria un candidadto porque es un reclutador/empleador, me explico?? (la ui/ux hay que hacerla muy bien aqui,
  piensa en tdos los detalles y sigue tu system design) igualmente si tienes una propuesta para esto, la escucho. 2.
  Si, hay que incluir los dos. 3. Si hermano, queda fuera, y de hecho, eso es algo de lo que sigue, porque quiero hacer
  bastante mas grande este sitio de empresa. pero eso lo vemos despues.»
- **L3 (user choices):** visitor «Ocultarlas + tarjeta de valor»; employer «Vista de candidato + «Ir a mi panel»»;
  return to origin «Sí, incluirlo».
- **L4 (exploration):** session is client-only (`IdentitySessionProvider`, roles candidate/recruiter/null); the RSC
  layout never resolves identity. `CandidateGuard` redirects anonymous users and drops the destination. Candidate
  login/ingresar have no return-to; the real apply wizard already calls Cognito with callback
  `/vacantes/{id}/postular`. Public listing has no save action; identity carries no company id (own-vacancy
  «Gestionar» is out of scope). Old e2e `tests/e2e/vacantes.spec.ts` already partly stale.
- **L5 (T1 evidence):** worker B RED 11 → GREEN 116. Independent verify: FAIL — `/vacantes?q=software%20engineer`
  was rejected (whitespace check ran on decoded levels) and `/..//evil.com`, `/./%2e%2e//evil.com` were kept
  (normalized pathname `//evil.com`, same origin, not a proven redirect). Parent fix: whitespace refused only in the
  raw value; normalized pathname starting with `//` rejected; RED 4 → GREEN in `return-to.test.ts`. Final:
  `vitest src/features/identity src/components/auth` 233/233, `tsc --noEmit` clean, eslint clean. Not run: live
  Cognito round-trip, apply-wizard callback.
- **L6 (T2–T4 evidence):** worker A could not `git mv` (no staging); parent moved `(public)/vacantes` →
  `(candidato)/vacantes` with plain `mv`. Worker A RED for each viewer mode, recruiter CTA, guard placement, header;
  GREEN `vitest src/app src/components/candidate-dashboard src/features/jobs src/features/candidate-applications`
  3928 tests, tsc and eslint clean. Parent browser check (dev, visitor, 1440/390, light/dark): one h1, no page
  errors, mobile «Ingresar»; found duplicated breadcrumb (header «Vacantes» + content «← Vacantes / Detalle»)
  → S6 fix: contextual header crumbs (employer editor precedent), content breadcrumbs removed (worker A, 418
  focused tests). Parent: on phones the crumb collapses to «← parent» (RED 1 → GREEN, 169 tests). Pre-existing,
  out of scope: ~70px gap from the `{status}` slot in `JobsNavigationIsland` between search and quick filters.
  Not browser-checked: candidate and recruiter modes (need real sessions; covered by unit tests).
- **L7 (T5 evidence):** e2e of the 5 vacancy/candidate specs in `next dev` + `jobs-server.mjs` fixture (a production
  build is blocked locally: `NEXTAUTH_URL` must be https in production). Baseline of the same specs on abe6a9f9
  (`git archive` copy, same mode): 22 failed / 72 not run / 7 passed. Branch: 24 failed; the 2 extra (reduced-motion
  detail return link, mobile filters Sheet) traced to `IdentitySessionProvider` keying its subtree by session status
  → the public page remounted on loading→visitor and lost focus. Fixed (T1b). Final branch run: 22 / 72 / 7, failure
  titles identical to the baseline (pre-existing, environment or stale). Full suite caught 4 more T3 regressions
  outside worker A's run scope (outline `buttonVariants` without `cn`, candidate rail tests pinning the removed
  «Explorar vacantes» button) → fixed by worker A; `vitest` full 7073/7073, `tsc` clean. Not verified: Enter on
  the header link within ~0 ms of `load` in dev (pre-hydration) does not navigate; after 1 s it does, and the e2e
  passes 3/3.
