# Task 6.4 Fresh Bounded Audit Evidence

> **Merge note (2026-09-24, merge resolution).** Two independent verification attempts for Task 6.4 are retained below in chronological order. Neither attempt replaced the other and no recorded result, hash, or verdict was altered; this merge ran no command.

## Attempt 1 — target tracker `feat/frontend-foundation` @ `de97e15` (2026-09-10, fresh bounded audit)

- Baseline: HEAD `de97e15b59fbfb8b8086940e1af5684aa3f95078`, baseline tree `f3b9fe727b1cb27da40196cc9466099f32172f32`.
- Scope: zero frontend source/test/config edits; Task 6.4 remains unchecked; this evidence is the only changed path.
- Toolchain: offline cached Node `v22.22.1`, Corepack `0.34.6`, pnpm `10.34.5`.
- G1 `corepack pnpm install --frozen-lockfile`: PASS; lockfile unchanged.
- G2 preset decode: PASS — `b27M1Ev2` Rhea/Neutral/Violet/Neutral chart/Lucide/Inter/default radius/subtle/default menu.
- G3 `preset resolve --json`: PASS — exact code/values, `fontHeading: inherit`; G4 `info --json`: PASS — Next 15 RSC/Base UI/Tailwind v4/Lucide/`@` aliases/UI path.
- G5 `pnpm typecheck`: PASS; G6 `pnpm lint`: PASS.
- G7 `pnpm test`: PASS — 18 files/99 tests; known Base UI `render=Link` warning was not a browser-proved defect.
- Prep API-offline `pnpm build`: PASS; fixture `/__health` and `/jobs` HTTP 200 plus `/vacantes` expected job content passed before browser gates.
- G8 `pnpm test:e2e`: PASS — 68/68; G9 `pnpm test:a11y`: PASS — 16/16; fixture/app readiness re-passed after each.
- Temporary absolute-import Playwright probe: desktop/mobile `q=empty` reset is anchor/link “Quitar filtros”, Tab-reachable, Enter resets to `/vacantes`; observed post-navigation focus was `BODY`.
- Browser verification is built-server fixture evidence only: app ran `pnpm start` with process `NODE_ENV=development`, never `next dev`; it is not production-environment parity.
- Approved typography remains Clash Display headings via Fontshare; preset identity remains Inter with inherited heading fallback, not Inter-only headings.
- G10 API-offline `PEOPLEFLOW_API_TIMEOUT_MS=1000 pnpm build`: PASS; BUILD_ID `t39MvQRaJhn4cPUmBlmNQ`, output digest excluding `.next/cache` `bbf5aee4f442ef00be0d58b414d6aedd56882913e7bf48176c9d7db5d4c6fabe`.
- Frontend tracked tree is unchanged: `f2d6110f741fd46425bb707f2defe692643eecd2`; no source diff or staged change.
- Owned fixture/app PGIDs `379170`/`379172` stayed live for browser gates, received TERM, exited, and ports 3000/3100/4010 are free.

## Attempt 2 — source archive `recovery/frontend-public-job-discovery-tdd` @ `08b75bc` (2026-09-14, zero-source hardening audit)

## Baseline and scope

- Branch: `recovery/frontend-public-job-discovery-tdd`
- Clean baseline: `08b75bc1c24ecc2da6954a0cabf1edbf6ec865d8` (`docs(openspec): close recovered frontend task 6.3`)
- Baseline tree: `5ebf30c808acab1e13ff8b6f219b92a5bd5c6ea3`
- Source guard: frontend was clean before and after the audit; tracked frontend manifest hash remained `61ebb54c1f34537ed723a1ff8a24b504750795d8845c8d1516ad555c15668c91`.
- Only OpenSpec files were authorized for the closure commit; no frontend/backend/config/lockfile/test path changed.

## Complete cached gate sequence

Node `v22.22.1`, Corepack pnpm `10.34.5`, `npm_config_offline=true`, `COREPACK_ENABLE_NETWORK=0`:

- Frozen install: pass.
- shadcn `preset decode b27M1Ev2`: pass; Rhea/Neutral/Violet/Neutral chart/Lucide/Inter/Default radius/Default menu/Subtle accent.
- shadcn `preset resolve --json`: pass; exact `b27M1Ev2` values (expected inherited-heading fallback).
- shadcn `info --json`: pass; Next App Router/RSC, Base UI, Tailwind v4, Lucide, aliases, and `src/components/ui` path exact.
- `pnpm typecheck`: pass.
- `pnpm lint`: pass.
- `pnpm test`: pass, 18 files / 99 tests.
- `cd backend && go test ./...`: pass.
- API-offline build with `PEOPLEFLOW_API_TIMEOUT_MS=1000`: pass, Next.js `15.5.25`, no build-time API access.
- Production-fixture full E2E: pass, 68/68.
- Production-fixture accessibility: pass, 16/16.

## Audit conclusion

No bounded frontend fix is justified. Focused review confirmed safe focus, contrast, copy, wrapping, reduced-motion behavior, and fixture timing. No landing completion, auth, application, candidate/employer workspace, backend, shared-root/config/docs, ISR, streaming dependence, browser-direct API, charts, or employer menus were introduced. The exact preset constraints remain binding; the only typography clarification is the four-line normative addendum in `design.md` retaining the already user-approved Fontshare Clash Display heading exception while Inter remains body typography.

## Environment, cleanup, and rollback

The browser runtime used the production build with the test fixture on loopback and `NODE_ENV=development` to permit the HTTP fixture URL; this is not production-environment parity. Owned fixture and Next process groups were terminated, ports 3000/3100/4010 were clear, and generated `.next`, `test-results`, and `playwright-report` outputs were removed. Rollback is one revert of the closure commit, restoring the four OpenSpec files; frontend source and the original baseline remain unchanged.
