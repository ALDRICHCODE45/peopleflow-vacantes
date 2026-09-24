# Candidate Workspace Redesign

## Goal

Apply the centered readable-width treatment from Mi perfil across every candidate workspace and redesign Postulaciones as a denser, modern shadcn-first surface with compact list and rich stacked-card presentations.

## References

- Employer Kanban direction for the later pipeline phase: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-22-13-39-37_5360x2520.png`.
- Current sparse candidate Postulaciones: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-22-23-55-24_5360x2520.png`.
- Approved candidate profile content width/alignment: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-22-23-58-44_5360x2520.png`.

## Scope

- Candidate Dashboard, Postulaciones, Perfil, CVs, and Cuenta use one centered `max-w-screen-2xl` content measure with their existing responsive padding.
- Postulaciones provides two explicit local views: `Lista` and `Tarjetas`.
- `Lista` is a true compact list; `Tarjetas` uses redesigned stacked horizontal shadcn Cards.
- Reuse installed shadcn primitives before custom markup: ToggleGroup, Card hierarchy, Badge, Button, Empty, Input/InputGroup, Separator where applicable.
- Preserve frozen fixtures, local filtering/search/sort, stage vocabulary (`submitted`, `in_review`, `hired`, `rejected`), real vacancy links, historical no-link copy, and truthful read-only behavior.
- Use PeopleFlow violet for primary interaction and semantic secondary status accents (information blue, review amber, hired green, rejected destructive) through central tokens rather than raw colors in feature code.
- Keep the separate Kanban reference for the subsequent employer pipeline redesign; candidate Postulaciones is not a Kanban in this phase.
- No dependency, API, backend, auth/session, storage, or mutation changes.
- The user explicitly opted out of RDD for this work. Native review must not be started for this candidate.

## Acceptance Criteria

- All five candidate route workspaces align to the profile's centered readable measure without nested/double padding.
- At wide desktop, Postulaciones no longer stretches edge-to-edge or leaves oversized empty row interiors.
- The view switch is keyboard accessible, single-select, and local-only.
- Search and status filters work identically in both views.
- Both views preserve newest-first ordering, counts, all four statuses, presentation letter, source, dates, and link/no-link truthfulness.
- Cards use `CardHeader`, `CardTitle`, `CardContent`, and `CardFooter`; list mode stays compact and scannable.
- Status accents pass WCAG contrast in light and dark themes; no raw colors appear in candidate feature code.
- Desktop/mobile layouts have no document horizontal overflow, serious/critical Axe findings, mutation requests, or local/session storage writes.

## Tasks

- [x] CWR-01 — Define RED contracts for one candidate workspace measure and the Postulaciones view switch.
- [x] CWR-02 — Apply the shared centered width across Dashboard, Postulaciones, Perfil, CVs, and Cuenta.
- [x] CWR-03 — Implement the local Lista/Tarjetas switch while preserving search, filters, ordering, and empty states.
- [x] CWR-04 — Recompose application rows into compact list items and rich horizontal shadcn Cards with semantic status accents.
- [x] CWR-05 — Verify all candidate routes, interactions, themes, responsive layout, accessibility, and side effects.

## Evidence

- Exploration: profile already uses `mx-auto w-full max-w-screen-2xl px-4 py-4 lg:px-6`; the other four workspaces own equivalent padding but have no centered max-width.
- Exploration: ApplicationsWorkspace is props-only and already preserves immutable newest-first search/filter behavior; its source-contract test currently forbids shadcn imports and must be intentionally replaced.
- Width RED/GREEN: 5 workspace files / 102 tests moved from 4 intentional missing-measure failures and 98 passes to 102/102 passes; each route root now owns exactly one `mx-auto w-full max-w-screen-2xl px-4 ... lg:px-6` frame without nested padding.
- View-switch RED/GREEN: ApplicationsWorkspace moved from 6 intentional failures / 11 passes to 17/17 passes with a controlled shadcn ToggleGroup, default `cards`, an empty-selection guard, and preserved search/filter/order/count behavior; TypeScript and diff checks pass.
- Presentation RED/GREEN: 10 intentional failures / 9 passes moved to 19/19 focused passes and 26/26 with the route contract. Cards now use Card hierarchy, list mode uses semantic list items, controls use installed shadcn primitives, and text-labelled status Badges consume four theme-safe semantic tokens. TypeScript, ESLint, and diff checks pass.
- Runtime visual correction: the first browser pass exposed a non-compact list (268.94px median versus 140.69px cards on desktop). A bounded follow-up moved the list to a responsive grid, four-column desktop facts, one-line letter preview, and a single scrollable mobile filter rail.
- Final visual evidence: `/tmp/peopleflow-candidate-applications-redesign/manifest.json` plus six light/dark desktop and light mobile PNGs. Final median card/list heights are 140.69/106.25px on desktop and 406.22/262.94px on mobile; all measured document overflow is 0px, with no console/page errors, non-GET requests, or storage writes.
- Final static acceptance: 17 candidate test files / 242 tests pass; TypeScript, focused ESLint, and `git diff --check` pass.
- Final Chromium acceptance: 6/6 candidate workspace tests pass in 23.2s, including two-viewport keyboard view switching, density, whole-body Axe, overflow, route matrix, and mutation/storage checks.
- Registry inventory: ToggleGroup, Card, Badge, Button, Empty, InputGroup, Separator, Tooltip, and related primitives are installed; no dependency addition is needed.
- RDD remained explicitly disabled for this candidate. No native review transaction was started.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

## Delivery Evidence

- Implementation commit: `0b94a4f` — `feat(frontend): complete workspace redesign and presentation cleanup` (verified product, tests, E2E, design guide, routes, and cleanup).
- Relevant to this record: `0b94a4f`.
- This task record and its documentation update remain untracked and are committed later by the parent, so no hash is claimed here.
- Push, PR creation, merge, deployment, release, install, remote operation, and protected-service mutation remain unauthorized and were not performed.
- Native Gentle review remained unavailable because the package-local binary is missing; the independent verification evidence above remains authoritative.
