# Vacancy Application Flow

## Goal

Create a rich, modern, shadcn-first public vacancy application wizard at `/vacantes/[jobId]/postular`, adapted from `design/screens/postulacion.html` and constrained to PeopleFlow's actual application/profile contracts.

## Product Decision

- Use the frozen Ximena Barrera profile as clearly labelled demonstration context.
- Collect only backend-supported application fields: `source` and optional `cover_letter`.
- Present profile identity and contact data read-only; never imply a live authenticated session.
- Exclude CV upload, availability, and editable experience because the current application DTO does not accept them and no CV upload transport exists.
- End with an honest `Iniciar sesión para enviar` gate linking to `/candidato/login`; no application is sent, persisted, or reported as successful.
- The user selected this boundary explicitly.

## References

- `design/screens/postulacion.html`
- `design/screens/vacante-detalle.html`
- `design/screens/assets/base.css`
- `docs/frontend-ui-design-rules.md`

## Scope

- Canonical route: `/vacantes/[jobId]/postular`.
- Three-step hierarchy adapted from the design:
  1. `Tus datos` — read-only demonstration profile summary.
  2. `Tu postulación` — closed-set source Select and optional cover-letter Textarea with a 2000-rune limit/counter.
  3. `Revisar` — vacancy/profile/application review and honest login gate.
- Public shell, breadcrumb back to the exact vacancy, main/aside responsive layout, sticky vacancy summary on desktop.
- Use installed shadcn Card, Field, Input/Select/Textarea, Badge, Button styling, Progress, Separator, Avatar, and Empty where appropriate.
- Build any missing stepper composition from installed primitives; do not install components or dependencies.
- Replace the job-detail `Postularme (solo demostración)` momentary button with a real semantic link to the canonical application route.
- Preserve the existing real job loader, not-found behavior, theme contract, public navigation, and canonical job identifiers.
- No fetch from client code, authenticated request, form POST, router mutation, storage, upload, timer, randomness, or fake success.

## Acceptance Criteria

- Source vocabulary is exactly `referral | linkedin | job_board | direct | other`; Spanish labels are truthful and deterministic.
- Cover letter is optional, trimmed for review, limited to 2000 Unicode code points, and validated without splitting surrogate pairs.
- Step navigation is keyboard accessible, ordered, and cannot skip invalid required state.
- Profile facts are visibly read-only demonstration data and match frozen Ximena fixtures.
- Review reproduces the selected source and letter exactly and clearly states that nothing has been sent.
- Final CTA is a real link to `/candidato/login`; no success screen claims receipt.
- Job-detail Postularme is a real link, not a button with navigation semantics.
- Desktop/mobile layouts have no document overflow, serious/critical Axe findings, console/page errors, mutation requests, or storage writes.
- No existing vacancy-detail, candidate, or employer behavior regresses.

## Tasks

- [x] VAF-01 — Define and implement the application draft model, Unicode validation, source labels, and canonical application href.
- [x] VAF-02 — Add the public application route, real job loading/not-found boundary, breadcrumb, and responsive vacancy summary shell.
- [x] VAF-03 — Implement the three-step shadcn wizard with read-only demo profile, source/letter inputs, review, and login gate.
- [x] VAF-04 — Replace the vacancy-detail demo control with a semantic Postularme link and update unit/E2E contracts.
- [x] VAF-05 — Verify focused/static/route tests, themes, responsive interaction, Axe, overflow, and no side effects; capture visual evidence for deferred user review.

## Evidence

- Backend exploration: `POST /jobs/{jobId}/applications` is real but authentication-gated; the frontend has no session/token transport.
- Backend exploration: the create DTO accepts only `source` and optional `cover_letter`; status/candidate/job/CV/timestamps are server-managed.
- UI exploration: the design's CV upload, availability, editable experience, and success receipt are unsupported and intentionally excluded.
- Inventory: required shadcn primitives are installed; no Form/Stepper/FileUpload primitive or new dependency is needed.
- Draft model RED/GREEN: the absent-module RED moved to 7/7 focused passes with exact source vocabulary/labels, strict parsing, blank-to-null normalization, Unicode code-point counting, a 2000-code-point limit, and `/vacantes/<jobId>/postular`; TypeScript, ESLint, and whitespace checks pass.
- Route/shell RED/GREEN: 7/7 route tests now pass for the dynamic Node boundary, shared request-scoped loader, not-found/unavailable split, noindex canonical metadata, exact-vacancy breadcrumb, demo disclosure, responsive shadcn shell, and semantic vacancy summary rail; TypeScript, ESLint, and whitespace checks pass.
- Wizard RED/GREEN: the absent-component/placeholder RED moved to 26/26 combined focused passes. The three-step client island shows the frozen Ximena profile read-only, collects the exact source and optional 2000-code-point letter, reviews normalized values, and ends at the honest candidate-login gate without requests or persistence. The source selector uses native shadcn SelectContent/SelectGroup/SelectItem; popup switching is deferred from jsdom to browser acceptance because Base UI floating-ui rAF starves that harness. TypeScript, ESLint, and whitespace checks pass.
- Detail-link RED/GREEN: the 3 expected failures for the old apply island moved to 47/47 combined passes. `Postularme` is now one semantic Next Link to the shared canonical application href; save/share demonstration islands and truthful feedback remain unchanged. TypeScript, ESLint, and whitespace checks pass.
- Final focused acceptance: 4 Vitest files/59 tests and 2 Chromium files/26 tests passed with 0 failures and 0 skipped; TypeScript, focused ESLint, LSP error diagnostics, and `git diff --check` found no errors (LSP confirmed 4 files clean and was silent/inconclusive on 7, with TypeScript/ESLint authoritative there).
- Browser acceptance covers real detail→application navigation, native Select source switching, preserved Back state, 2000/2001 Unicode boundaries, 44px used targets, desktop-light/mobile-dark Axe, no document overflow, no non-GET requests, and no storage writes.
- The first browser attempts remain separate evidence: stale preview 3100 blocked the run; then a broad alert selector matched Next's announcer, default 32px Buttons failed the mobile target gate, an immediate theme transition produced transient Axe contrast findings, and the full detail timeout case required the documented 1000ms fixture harness instead of the runtime 8000ms default. Each was corrected without touching the frozen fixture or protected 3001/4010 services.
- Final visual evidence: `/tmp/peopleflow-vacancy-application-flow/` contains light desktop profile/source/review and light/dark mobile captures plus `manifest.json`; all five report zero overflow, one h1, 44px form buttons, and no console/page errors or mutation requests. Final user visual approval remains deferred because the user is currently away from home.
- Native Gentle review remains unavailable because the package-local v3.4.0 binary is missing; RDD was not started.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

## Delivery Evidence

- Implementation commit: `0b94a4f` — `feat(frontend): complete workspace redesign and presentation cleanup` (verified product, tests, E2E, design guide, routes, and cleanup).
- Relevant to this record: `0b94a4f`.
- This task record and its documentation update remain untracked and are committed later by the parent, so no hash is claimed here.
- Push, PR creation, merge, deployment, release, install, remote operation, and protected-service mutation remain unauthorized and were not performed.
- Native Gentle review remained unavailable because the package-local binary is missing; the independent verification evidence above remains authoritative.
