# Task 6.3 TRIANGULATE Evidence

## Objective

Execute and record the complete local quality and preset gate sequence on the committed Task 6.2 baseline without changing product behavior.

## Immutable baseline

- Branch: `feat/frontend-foundation`
- HEAD: `e48dba98a73b60ed502adf60eb9d7e4df89c5618`
- HEAD tree: `2b6dd39544d374a68ff2418f4f26f5bbbc443af8`
- Frontend tree before and after: `f2d6110f741fd46425bb707f2defe692643eecd2`
- Toolchain: Node `v22.22.1`, Corepack `0.34.6`, pnpm `10.34.5`, cached packages only

## Ordered gates

| # | Gate | Result |
| --- | --- | --- |
| 1 | `corepack pnpm install --frozen-lockfile` | PASS — lockfile unchanged |
| 2 | `pnpm dlx shadcn@latest preset decode b27M1Ev2` | PASS — Rhea, Neutral, Violet, Neutral chart, Lucide, Inter, Default radius, Subtle accent, Default menu |
| 3 | `pnpm dlx shadcn@latest preset resolve --json` | PASS — code and decoded values matched `b27M1Ev2` |
| 4 | `pnpm dlx shadcn@latest info --json` | PASS — Next.js, RSC, Base UI, Tailwind v4, Lucide, aliases, and resolved UI path matched |
| 5 | `pnpm typecheck` | PASS — no TypeScript errors |
| 6 | `pnpm lint` | PASS — no lint errors |
| 7 | `pnpm test` | PASS — 18/18 files and 99/99 tests |
| 8 | `pnpm test:e2e` | PASS — 68/68 tests |
| 9 | `pnpm test:a11y` | PASS — 16/16 tests |
| 10 | API-offline `PEOPLEFLOW_API_TIMEOUT_MS=1000 pnpm build` | PASS — no build-time jobs API fetch |

## Browser and build identity

- Fixture: owned PGID `3485361`, port `4010`, `GET /__health` returned `{"ok":true}`.
- Application: owned PGID `3490757`, built `next start` on port `3100`; `next dev` was never used.
- Both processes remained live for E2E and accessibility gates and were terminated by owned PGID afterward.
- Final build ID: `9OI_6F2JUgNgOlbGFSfmu`
- Deterministic generated-output digest: `88ff9ef38155afca46494122eaa040f6d684798e94b72b1d3315c051a89e4567`

## Blocking assertions

The run confirmed exact preset identity and values, explicit Base UI, Tailwind v4, Lucide, Inter, `@/components` and `@/components/ui` aliases, resolved `frontend/src/components/ui/`, semantic Violet/Neutral styling, Default radius, both schemes, Default/Solid menu treatment, and Subtle menu accent. It found no ad hoc overrides, charts, employer menus, backend changes, shared-config changes, or build-time vacancy fetch.

## Accounting and cleanup

- Task 6.3 runtime work unit: 0 product lines changed.
- Current PR 5 slice from `c4198aed4c791632e3e542df04bcac6f74ed4803` through the baseline HEAD: 298 insertions plus 6 deletions = 304 lines across 7 files.
- The prior failed harness evidence `sha256:f60c7f4ec4816d1d41bc005c46aabfaf1ecd71892b7286536cd9753f8cd1443f` is superseded only for Task 6.3 gate conclusions by this fresh run with the required live fixture and production-server topology.
- Ports `3000`, `3100`, and `4010` were free after cleanup. No `.next`, test results, Playwright report, TypeScript build info, PID, runtime log, or temporary evidence file remained.
- No product, backend, shared configuration, lockfile, or test source change is justified. Task 6.3 remains unchecked until the separate OpenSpec closure commit.
