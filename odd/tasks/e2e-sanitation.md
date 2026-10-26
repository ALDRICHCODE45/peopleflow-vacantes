# E2E sanitation: vacancy and candidate specs green against a production build

Branch `fix/e2e-sanitation` from `main` @ 99b6fa7e. Goal: the e2e specs protect again — a new failure must not hide
among old ones. Run against `next build` + `next start` with the jobs fixture, not `next dev`.

## Specs

- **S1. Production build locally.** User decision (L2): «Extender PEOPLEFLOW_LOCAL_PREVIEW a auth» — `NEXTAUTH_URL`
  accepts `http` in production only with `PEOPLEFLOW_LOCAL_PREVIEW=true` and a loopback origin, like the rest of the
  environment already does. Without the flag, production still requires `https`. The Cognito domain stays https-only.
- **S2. Honest baseline.** The five specs (`vacantes`, `vacantes-a11y`, `vacante-detalle`, `vacante-postular`,
  `candidate-workspace`) run against the production build with the fixtures they need (`:4010` jobs fixture, the
  `:4011` apply fixture) and every test runs — none hidden behind a serial failure.
- **S3. Each remaining failure gets a cause.** Stale assertion → update the spec to the approved current UI; real
  defect (e.g. axe violations) → fix the product; environment-only → document how to run it. No test is deleted or
  skipped to go green without the user's decision.
- **S4. Repeatable.** One documented command sequence (docs) starts fixtures, builds, starts and runs the specs.

## Tasks

- [x] T1. S1 — auth env honours `PEOPLEFLOW_LOCAL_PREVIEW` for loopback `NEXTAUTH_URL` · inline · high risk (auth config) ·
  own commit (`fix(auth)` after this line) · independent verify (L4).
- T2. S2 — production build + both fixtures + full run of the five specs; classify every failure · inline.
- T3. S3 — fix per class (stale specs, product a11y defects, environment) · routed after T2.
- T4. S4 — document the e2e run in `docs/local-production-preview.md` · inline.

## Log

- **L1 (2026-10-25, user):** «no hermano, lo dejamos asi, sin revision. Adelante con los siguientes pasos recomendados
  por favor.» (step 4 of the recommendation: sanitize e2e — stale `vacantes.spec.ts`, `:4011` fixture for
  postular, `NEXTAUTH_URL` blocking the production build).
- **L2 (user choice):** «Extender PEOPLEFLOW_LOCAL_PREVIEW a auth».
- **L3 (evidence, dev mode):** last run of the five specs on `next dev`: 22 failed / 72 did not run / 7 passed, titles
  identical to the abe6a9f9 baseline. Classes seen: env (postular ECONNREFUSED :4011; canonical 307 got 200;
  malformed UUID 404 got 200), stale/fixture (rich detail `article`, detail error boundary, list «Listado de
  vacantes», mobile filters Sheet name, `[data-pf-candidate-overview]`), axe list matrix (4). `src/lib/env/validate.ts`
  already allows loopback http in production with the flag; `src/lib/auth/env.ts:97-103` does not.
- **L4 (T1 evidence):** RED 1 → GREEN; `vitest src/lib/auth src/lib/env src/app/api/auth` 361/361, tsc clean.
  Independent verify: parity with `validate.ts` (224 combinations, zero divergences), zero non-loopback http accepted,
  Cognito domain/issuer https-only (16 combinations), NextAuth Secure cookies follow the URL scheme (non-Secure only
  for the opt-in loopback preview), redirects stay same-origin. NEEDS DECISION item, decided by parent: both
  validators check the normalized URL, so `http://localhost/foo/..` or `http://@localhost` normalize to
  `http://localhost`; accepted as intended (operator-written config, only the normalized origin is used, no
  external redirect shown); hardening both validators is out of scope. Error message updated to mention the flag.
