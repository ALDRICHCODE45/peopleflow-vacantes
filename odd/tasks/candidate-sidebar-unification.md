# Candidate Sidebar Unification

## Goal

Make the candidate dashboard chrome behave like the employer dashboard chrome while preserving candidate routes, labels, fictional identity, and truthful prototype boundaries.

## Scope

- Reuse the installed shared shadcn Sidebar primitives and the existing account-menu composition.
- Restore native `collapsible="icon"` behavior so candidate navigation collapses to icons without clipped label fragments.
- Replace the candidate-only plain footer link with the same Avatar + DropdownMenu + SidebarMenuButton composition used by the employer.
- Keep candidate menu destinations limited to real candidate routes.
- Preserve employer behavior and styling.
- Do not add authentication, session/logout behavior, persistence, network calls, dependencies, or unresolved candidate actions.

## Acceptance Criteria

- Expanded candidate navigation keeps the five current destinations, groups, order, labels, and active-route behavior.
- Collapsed desktop navigation shows centered icons without candidate-specific `size-10!` or `size="lg"` overrides on destination rows.
- Every collapsed destination remains accessible through its tooltip and accessible name.
- Candidate footer uses shadcn `Avatar`, `AvatarFallback`, `DropdownMenu`, and `SidebarMenuButton` through the shared account component.
- Candidate account summary shows Ximena Barrera and truthful candidate context; its menu exposes only real candidate routes.
- Employer footer retains Tomás Ríos, Talent Lead · Nexo Labs, its existing menu labels, initials, and responsive menu placement.
- Mobile candidate navigation remains an accessible off-canvas dialog.
- No mutation requests, storage writes beyond the established sidebar preference cookie, or fake auth/session behavior are introduced.

## Tasks

- [x] CSU-01 — Define RED contracts for native icon collapse and shared candidate account-menu composition.
- [x] CSU-02 — Parameterize the shared NavUser composition and adopt it from the candidate sidebar without changing candidate routes.
- [x] CSU-03 — Verify candidate/employer regressions, desktop/mobile expanded/collapsed visuals, accessibility, and side effects.

## Evidence

- Exploration: both dashboards already use the same shadcn Sidebar primitive and inset shell. Candidate clipping is caused by `group-data-[collapsible=icon]:size-10!` plus `size="lg"` on 16px-icon navigation rows; employer uses the native `size-8` + `p-2` collapse geometry.
- Exploration: employer footer uses `NavUser` with shadcn Avatar and DropdownMenu; candidate footer is a separate plain Link and existing tests intentionally pin that divergence.
- RED evidence: 2 focused files / 37 tests produced 5 intentional failures and 32 passes, mapping only to native icon geometry, candidate account trigger in desktop/mobile, derived `XB` initials, and optional link-backed candidate menu items.
- GREEN evidence: candidate shell, shared NavUser, and employer AppSidebar suites pass 66/66 tests; TypeScript, scoped ESLint, and `git diff --check` pass without output.
- Browser regression: candidate and employer Chromium suites each pass 5/5 after preview recovery and route prewarming; candidate whole-document desktop/mobile Axe, overflow, and mutation matrix passes, and employer scoped desktop/mobile serious/critical Axe, overflow, and mutation matrix passes.
- Collapsed geometry: all five candidate destinations and all employer destinations measure 32×32px with 16px icons, 0px label width, and hidden overflow; both account triggers measure 32px.
- Candidate account menu: desktop collapsed and mobile drawer expose only `Mi perfil`, `Mis CVs`, and `Mi cuenta`, each backed by its real candidate route. Ximena renders as `XB` through the shared shadcn Avatar fallback.
- Side effects: direct inspection recorded zero mutation requests, empty local/session storage, and zero console/page errors.
- Screenshots: `/tmp/peopleflow-sidebar-unification/candidate-expanded.png`, `candidate-collapsed.png`, `candidate-collapsed-menu.png`, `candidate-mobile-menu.png`, `employer-collapsed.png`.
- Incident evidence: the first browser attempt was blocked before assertions because the preview PID was stale and port 3100 was down; after restarting only 3100, the first cold candidate navigation exceeded its 5s URL assertion, while employer passed. Five read-only candidate-route prewarms returned HTTP 200 and the exact candidate rerun then passed 5/5. No product correction was required for either incident.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

## Delivery Evidence

- Implementation commit: `0b94a4f` — `feat(frontend): complete workspace redesign and presentation cleanup` (verified product, tests, E2E, design guide, routes, and cleanup).
- Relevant to this record: `0b94a4f`.
- This task record and its documentation update remain untracked and are committed later by the parent, so no hash is claimed here.
- Push, PR creation, merge, deployment, release, install, remote operation, and protected-service mutation remain unauthorized and were not performed.
- Native Gentle review remained unavailable because the package-local binary is missing; the independent verification evidence above remains authoritative.
