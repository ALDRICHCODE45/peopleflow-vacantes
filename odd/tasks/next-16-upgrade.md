# /vacantes lost client navigations: fix within Next 15 (Next 16 blocked by Amplify)

Branch `fix/vacantes-lost-navigation` (was `chore/next-upgrade`). Next stays pinned at 15.5.25 (design D1).

## Specs

- **S1** (L1, L4). The backlog known issue «Client navigation between `/vacantes` search variants is sometimes not
  applied» is fixed on Next 15.5.25: after «Remoto», «Todas» lands on `/vacantes` every time — probe
  `frontend/test-results/nav-probe/run.sh 40` reports `secondLost=0` (and `firstLost=0`), against 13/40 on `main`.
- **S2** (L4). No behavior change beyond S1: the quick filters, the search form, «Limpiar filtros» and pagination keep
  their URLs, pressed states and pending feedback; Vitest, typecheck, lint and the production-build e2e suite
  (83 tests, `docs/local-production-preview.md`) pass, and «renders the approved hero…» passes 10/10.
- **S3** (L3, L4). Backlog, `docs/local-production-preview.md` and this document record the Next 16 finding: Next 16
  fixes the router bug but Amplify Hosting supports Next 12–15 only, so the D1 pin stays.

## Tasks

- [x] T1 — S1, S2: remove the list `loading.tsx` (cause) and its now-unused skeleton — route: worker (search) + inline — commit: 70bbb463
- [x] T2 — S3: backlog, docs — route: inline — commit: closing docs commit after 70bbb463

## Log

- **L1.** User (verbatim): «Si hermano, adelante» — reply to the recommendation to start with the `/vacantes`
  navigation known issue by upgrading Next on its own branch.
- **L2.** Probe (`frontend/test-results/nav-probe/`, gitignored; production build on :3100, fixture on :4010; 40 fresh
  contexts; «Remoto» then «Todas»): Next 15.5.25 → second navigation lost 13/40 (first 1/40); 15.5.28 → 10/40;
  16.4.3 → every matched `/vacantes` request a plain 500 until `middleware.ts` became `proxy.ts`; then 0/40.
  On 16: tsc OK, Vitest 7105/7105, lint 67 errors from the new React Compiler rules (eslint-plugin-react-hooks 7),
  production e2e 3/83 passed.
- **L3.** User (verbatim): «Espera.. me estoy acordando que decidimos usar Next.js en la version especifica y no en la
  ultima porque segun nuestro plan de infraestructura, era la mejor opcion ya que las ultimas versiones de next.js no
  eran compatibles, no recuerdo por que razon fue que llegamos a la conclusion de actualizar next.js y tampoco recuerdo
  si lo tomamos en cuenta. (si me equivoco, dimelo)». Confirmed: `openspec/changes/archive/2026-09-15-frontend-public-job-discovery/design.md`
  D1 «Next 16 is outside the accepted hosting policy» and risk row «explicit compatibility gate for major upgrades»;
  `docs/decision-frontend-hosting.md` (Amplify). AWS docs (`ssr-amplify-support`): Amplify Hosting supports Next 12
  through 15; aws-amplify/amplify-js#14600 reports Next 16 builds failing on `.next/server/proxy.js`. The upgrade
  recommendation had not checked D1.
- **L4.** User decision: «Volver a 15.5.25 y workaround en 15». Upgrade reverted (package.json, lockfile, tsconfig,
  next-env.d.ts, eslint config, middleware) — none of it was committed.
- **L5.** Worker (mvpqqnzu-1-njpu), each measured with 40 runs and reverted: keyed page subtree 15/40 (worse), middleware
  excluded from RSC requests 13/40, unkeyed navigation island 10/40. Parent: without `(listado)/loading.tsx`, 0/40.
- **L6.** User (verbatim): «Ya investigaste todo sobre esto? investiga en fuentes oficiales, antes de quitar el
  login.tsx, por favor.» Sources: vercel/next.js#83386 (production-only, intermittent `router.push`/`<Link>`
  search-param navigations; RSC 200, navigation never applied) closed as fixed by facebook/react#35839 (a Suspense
  boundary that suspends on initial mount stays stuck); v15.5.28 release notes are security-only; #49297 (closed
  2026-08-31): search-param-only navigation keeps page state by design, use `useTransition`/`useLinkStatus` for
  pending feedback. Inferred, not proven: in Next 15 the page segment key includes the search string, so each
  filter navigation mounts a new loading Suspense boundary — the bug's trigger; the keyed-subtree result supports it.
- **L7.** User decision: «Quitarlo sin reemplazo». Removed `(listado)/loading.tsx`, its test and `PublicJobSkeleton`
  (only the loading file used it) with its four skeleton test cases; the detail route test now asserts the list has
  no loading boundary either (RED 1 failed → GREEN). Rule added to `docs/frontend-ui-design-rules.md`. Checks:
  tsc OK; lint 0 errors (13 warnings, none in touched files); Vitest 7094/7094; probe 0/40 and 0/40 (first and
  second); production e2e 83/83; «renders the approved hero…» 10/10. Follow-ups in the backlog: Next 16 when Amplify
  supports it; feedback when entering `/vacantes` from another screen.
- **L8.** User (verbatim): «quiero algo mejor que :"cargando", no me gusta eso, si queremos algo discreto y no un
  skeleton en este apartado, revisaria el componente loader (creo que se llama asi) y lo centraria en la card o en el
  contenido que se este cargando, mwe explico?? y ya sabes que hacer hermano, sigue siempre tu system design, revisa
  shadcn siempre, basate en la doc oficial, ocupa los ejemplos de shadcn, y ya que tienes ojos, revisa siempre el
  resultado con el mcp, me sigues?» Done: installed shadcn `Spinner` (examples spinner-demo/-empty/-size), design
  rule «Spinner puntual». Filter/search navigations dim the results and center a sticky, non-blocking spinner on a
  card-like surface over them; the next-page link shows the spinner inside itself (an overlay covered that button in
  the first visual check); the visible «Cargando…» became one sr-only status «Cargando vacantes». Browser check
  (Playwright MCP, fixture delay 2.5 s): light/dark desktop, mobile 390, scrolled pagination. RED 4+2 → GREEN;
  Vitest 7096/7096; lint 0 errors; probe 0/40; e2e 83/83 after updating the reduced-motion test that pinned the old
  text (now also asserts the spinner) — 5/5 repeated; hero 10/10.
