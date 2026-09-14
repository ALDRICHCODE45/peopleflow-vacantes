# Task 6.4 evidence — zero-source hardening audit

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
