# Task 6.4 Fresh Bounded Audit Evidence

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
