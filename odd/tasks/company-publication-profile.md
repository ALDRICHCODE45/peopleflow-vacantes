# Company profile publication prerequisite

## Objective and scope
Frontend-only employer UI: require a confirmed company name and existing About field before publishing a vacancy. Permit drafts independently and preserve vacancy input across employer navigation. Rich company fields remain optional. No backend, browser storage, API integration, public fixtures, portfolio changes, dependencies, or visible demo/unavailable disclaimers.

## User constraints
Follow docs/frontend-ui-design-rules.md and existing primitives; Mexican Spanish UI. Only focused custom-behavior unit checks and scoped type/lint checks. No visual smoke/accessibility/browser suites: user performs visual acceptance. Commit and integrate completed feature into local main; never push. Preserve main's three dirty backend-go-closure documents.

## Delivery and routing
Feature branch: feat/company-publication-profile, base 82ff2e7. Strategy: feature-branch-chain, approved by user; three sequential local work-unit slices, no remote PR creation. Forecast 700–950 authored diff lines; approximately 400 per slice is advisory, never a reason to omit tests. Single writer. All tasks delegated due multi-file writes. RDD off; assess writer diff and follow returned verification plan. Parent owns task updates and commits.

## Tasks
- [ ] CPP-1 (in progress): Shared employer session state and minimum-profile readiness, layout integration, focused lifecycle/model tests. Route: delegated writer. Commit: pending.
- [ ] CPP-2 (pending): Company editor consumes shared profile, confirms name, requires About for publication, leaves rich sections optional. Route: delegated writer. Commit: pending.
- [ ] CPP-3 (pending): Review publication action and profile gate, independent draft action, preserve both vacancy value sets and wizard position; focused tests, local main integration. Route: delegated writer + delivery parent. Commit: pending.

## Acceptance and checks
Seeded fallback name alone never establishes confirmed identity; whitespace fails readiness; changing name invalidates confirmation. Missing About blocks publication, not drafting. Navigation to company site and back retains vacancy description, complementary values and step. Publication outcome remains in-memory in creation surface, with no public URL or backend claim. Applicable deterministic tests use observed RED then GREEN; no full suites or visual checks. Rollback each slice with its corresponding work-unit changes; CPP-2/3 depend on CPP-1. Runtime external harness N/A: frontend React unit behavior only, visual checks user-owned.

## Evidence and progress
Exploration complete; no source edits yet. Current feature worktree initially clean. Main 59a7247 has only unstaged openspec/changes/backend-go-closure/{apply-progress,design,tasks}.md. Preserve SHA256 respectively: 74a526152b3b4e3d1a04cf12605459bf03e75e5d378db6303fbcef94758ed48e; 5e45c2f2ad86ba7dec277aafa30a64f505a67656dacc1124c4fba8736e4986b1; f5d8942dd734c762699b64a2bdb320191f8b5d5a2b9d166b6744d01d8b4e0da7.

## Next step
Implement CPP-1 only, report focused test evidence and actual diff; do not commit from worker.
