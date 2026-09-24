# Semantic Badge System

## Objective

Replace the fragmented badge styling with one shadcn-first semantic variant system: compact pastel surfaces, reduced rounding, consistent leading status dots, token-safe dark mode, and no changes to frozen status facts or Spanish labels.

## Visual Direction

The current references show two mismatched treatments: thin outlined application statuses and a saturated full-violet primary-CV badge. The preferred references use compact softly filled rectangles, modest corner radius, semantic text/background pairs, and a small leading dot for state/category meaning.

## Decisions

- Use `rounded-md` instead of the current near-pill `rounded-2xl` geometry.
- Add shared `accent`, `info`, `review`, `success`, `danger`, and `neutral` Badge variants.
- Status badges opt into one decorative leading dot through the shared Badge API; the Spanish label remains the accessible source of meaning.
- Application states map without changing vocabulary: `submitted → info`, `in_review → review`, `hired → success`, `rejected → danger`.
- Active publication/member states use `accent` or `success`; paused/invited states use `review`; closed states use `neutral`.
- Completeness, primary-role, featured, metadata, skills, counters, sources, and read-only labels remain non-status badges and therefore do not receive a status dot. They may use a semantic pastel variant where appropriate.
- Keep `destructive` for API compatibility, but express it through the semantic danger tokens rather than raw red palette classes.
- Keep filters, toggles, tabs, and other interactive controls outside the Badge primitive.

## Constraints

- Preserve every domain status value and Spanish label.
- Preserve the existing `--status-*` light, dark, and system-dark token values.
- Use shared Badge variants instead of repeated feature-local color recipes.
- Do not change candidate/employer behavior, persistence, routes, fixtures, or protected services.
- Maintain truthful enabled/inert placeholder semantics and accessible text labels.
- Do not push, open a pull request, deploy, release, or mutate remote/protected services.

## Tasks

- [x] **BADGE-01 — Establish the primitive contract:** Added semantic variants, tokenized destructive styling, optional decorative status dot, reduced radius, and focused primitive tests in `b9b67e5`.
- [x] **BADGE-02 — Migrate product status badges:** Replaced duplicated application/pipeline/publication/member tone maps and the raw pipeline-route status span with semantic variants while preserving labels and facts in `f7e76fa`.
- [ ] **BADGE-03 — Reconcile remaining badge consumers and guidance:** Migrate divergent dashboard/featured/role treatments where semantic pastel styling is intended, keep neutral chips/counters distinct, update affected tests, and record the durable design rule.
- [ ] **BADGE-04 — Verify and close:** Run focused/full unit, TypeScript, ESLint, production build, LSP diagnostics, and isolated light/dark responsive visual acceptance; record exact evidence and residual risks.

## Initial Audit

- Duplicated four-state color maps exist in candidate applications, candidate overview, and employer pipeline.
- The company dashboard table maps the same states to generic `secondary/outline/default/destructive` variants.
- Employer vacancy/member states duplicate manual class and dot maps.
- The employer pipeline route and public job detail contain raw span-based badge treatments.
- Neutral metadata chips and interactive filters are separate concepts and must not be forced into status variants.
- Existing status tokens meet the established contrast contract and remain the color source of truth.

## Evidence

- `b9b67e5 feat(ui): add semantic badge variants`
- Focused Badge tests: 1/1 file, 17/17 tests passed under Node 22.23.2.
- TypeScript and focused ESLint passed with no warnings.
- `badge.tsx` contains no raw `red-*` palette class and no conflict marker.
- Pi Lens still reports unresolved installed `@base-ui/react/*` subpaths on both the changed Badge and unchanged shadcn primitives such as `button.tsx`; project `tsc --noEmit` resolves them successfully, so this is retained as a workspace-LSP limitation rather than a source error.
- `f7e76fa feat(ui): unify product status badges`
- BADGE-02 focused verification: 7/7 files and 146/146 tests passed; TypeScript and focused ESLint passed under Node 22.23.2.
- Final callback-annotation verification: 2/2 files and 61/61 tests passed; TypeScript and focused ESLint passed with zero warnings.
- Product status badges now expose exact semantic `data-variant` and `data-dot` contracts; counters, match scores, skills, filters, metadata, and completeness remain dotless.

## Delivery Boundary

Local implementation commits are authorized under the ongoing Badge request. Push, pull request, deployment, release, further package installation, remote operation, and protected-service mutation remain unauthorized.
