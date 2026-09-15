# Task 6.3 TRIANGULATE Evidence

- Branch: `recovery/frontend-public-job-discovery-tdd`
- HEAD: `b7fee8592eb77fcae6a5940f3752ab32ef2b7ae2`
- HEAD tree: `75d1143e5a5e71c010363487afb2dbf517f50ddd`
- Runtime: Node `v22.22.1`; pnpm `10.34.5`; local `shadcn` dependency `4.20.1`; `npm_config_offline=true`.
- Product/source lines changed: **0**. Frontend, backend, config, lockfile, and source hashes remained unchanged.

## Ordered gates

| Result | Exact command / evidence |
| --- | --- |
| PASS | `corepack pnpm install --offline --frozen-lockfile` — lockfile up to date, zero downloads |
| PASS | `corepack pnpm dlx shadcn@latest preset decode b27M1Ev2` — Rhea, Neutral, Violet, Neutral chart, Lucide, Inter, Default radius, Default menu, Subtle accent |
| PASS | `corepack pnpm dlx shadcn@latest preset resolve --json` — code `b27M1Ev2`, expected values; only documented `fontHeading` fallback |
| PASS | `corepack pnpm dlx shadcn@latest info --json` — Next App Router/RSC, Base UI (`base`), Tailwind v4, Lucide, aliases `@/components` and `@/components/ui`, UI path `frontend/src/components/ui` |
| PASS | `corepack pnpm typecheck` |
| PASS | `corepack pnpm lint` |
| PASS | `corepack pnpm test` — 18 files, 99 tests |
| PASS | `cd backend && go test ./...` |
| PASS | `PEOPLEFLOW_API_BASE_URL=https://127.0.0.1:9 PEOPLEFLOW_SITE_URL=https://example.invalid PEOPLEFLOW_API_TIMEOUT_MS=1000 corepack pnpm build` — Next 15.5.25, no build-time API access |
| PASS | Fixture-backed production topology: fixture `127.0.0.1:4010`, Next `127.0.0.1:3100`, `NODE_ENV=development` only for the documented loopback HTTP exception, timeout `1000ms`; `corepack pnpm test:e2e` — **68/68** |
| PASS | Same topology; `corepack pnpm test:a11y` — **16/16** |

Browser coverage included light/dark desktop/mobile, Inter typography, semantic Violet/Neutral tokens, Default radius, preset/path assertions, no raw/custom style drift, no charts/employer menus, cursor/filter/history behavior, safe text, errors/not-found, focus, wrapping, reduced motion, and overflow.

## Guards, cleanup, rollback

- Gate output digest: `sha256:34cd8743a71e11a427525250ca116cb24c74d3863fb47f93dfce1afe1a48bde3` (`/tmp/task63-gates.log`).
- Final `git status --porcelain --untracked-files=all`, unstaged diff, and staged diff were empty; HEAD/tree remained exactly as recorded.
- Removed generated `.next`, `test-results`, `playwright-report`, `tsconfig.tsbuildinfo`, and run-owned temporary logs. Ports 3100/4010 were free and no owned Next/fixture process remained.
- Rollback: revert this evidence commit only; it removes no product behavior and no frontend/backend/configuration bytes.
