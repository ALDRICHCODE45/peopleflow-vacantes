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

- [ ] **BADGE-01 — Establish the primitive contract:** Add semantic variants, tokenized destructive styling, optional decorative status dot, reduced radius, and focused primitive tests.
- [ ] **BADGE-02 — Migrate product status badges:** Replace duplicated application/pipeline/publication/member tone maps and raw status spans with semantic variants while preserving labels and facts.
- [ ] **BADGE-03 — Reconcile remaining badge consumers and guidance:** Migrate divergent dashboard/featured/role treatments where semantic pastel styling is intended, keep neutral chips/counters distinct, update affected tests, and record the durable design rule.
- [ ] **BADGE-04 — Verify and close:** Run focused/full unit, TypeScript, ESLint, production build, LSP diagnostics, and isolated light/dark responsive visual acceptance; record exact evidence and residual risks.

## Initial Audit

- Duplicated four-state color maps exist in candidate applications, candidate overview, and employer pipeline.
- The company dashboard table maps the same states to generic `secondary/outline/default/destructive` variants.
- Employer vacancy/member states duplicate manual class and dot maps.
- The employer pipeline route and public job detail contain raw span-based badge treatments.
- Neutral metadata chips and interactive filters are separate concepts and must not be forced into status variants.
- Existing status tokens meet the established contrast contract and remain the color source of truth.

## Delivery Boundary

Local implementation commits are authorized under the ongoing Badge request. Push, pull request, deployment, release, further package installation, remote operation, and protected-service mutation remain unauthorized.
