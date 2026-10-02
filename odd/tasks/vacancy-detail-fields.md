# Vacancy detail creation-field parity

## Intent
Expand candidate-facing public vacancy detail with useful creation fields and a small layout refinement. Exploration found languages/proficiency and screening prompts missing, and seniority obscured by fixture experience. Existing requirements, skills, benefits, pay frequency and deadline already exist. No speculative fields or employer pipeline changes.

## Scope and constraints
Frontend only. Follow docs/frontend-ui-design-rules.md and design/shadcn skills, Mexican Spanish UI, installed primitives and semantic tokens. Preserve header, application/company/share actions and responsive content/rail geometry. Group candidate profile, languages and read-only application questions; distinguish level from years of experience. Exact known fixture IDs may receive intentionally authored fictional language/questions for demonstration; never enrich unknown jobs or inject HTML. Hide absent fields. No demo/unavailable copy, dependencies, backend, public wire schema changes. User in hurry; no visual/a11y/smoke/build/full-suite runs. Focused unit tests, typecheck, scoped lint only. No push. Previous user delivery instruction: commit and integrate local main.

## Delivery and tasks
Branch feat/vacancy-detail-fields from854bd43. Forecast240–390 authored lines; single coherent work-unit commit for enrichment+rendering+tests, so no unused intermediate model. Delegated writer required (4 nontrivial files); parent owns tracking/commits. RDD off; assess returned diff and follow verification plan.
- [x] VDF-1: Typed languages/questions on exact fixtures, conditional grouped detail sections, separate seniority/experience, shared Badge. Commit c127d92 integrated into local main. Actual commit373 additions+85 deletions including tracking (458 diff lines); worker insertion-only estimate understated review size, no artificial split.

## Acceptance and verification
Known fixtures display languages/proficiency and question prompts. Unknown/wire-only jobs receive no fabricated extras, empty sections absent, escaped text remains safe. Existing metadata/actions unaffected. Observe actual test RED before implementation, then GREEN: from frontend Node22 `pnpm test src/features/jobs/enrich.test.ts src/features/jobs/components/JobDetailView.test.tsx`; tsc and scoped eslint. No visual claims. Rollback is this unit's four code/test files. Runtime external harness N/A, user owns visual acceptance.

## Evidence / next step
Complete: observed13 failing tests before implementation, then51/51 GREEN; TypeScript and scoped ESLint pass. Independent bounded review and51-test rerun PASS. Assessment unavailable due untracked task doc; independent verification completed, RDD off. No build/browser/a11y/smoke/full suite. User owns visual acceptance and push. Backend docs preserved; no servers started. Added examples only to two exact fixture IDs; no real-job data fabrication.
