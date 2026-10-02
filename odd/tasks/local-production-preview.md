# Local production preview for pnpm start

## Scope

User requires `pnpm start` with the existing local HTTP mock, not a substitution
with `pnpm dev`. Add an explicit `PEOPLEFLOW_LOCAL_PREVIEW=true` opt-in, restricted
to two loopback origins. Keep production HTTPS strict without the opt-in. No
NODE_ENV workaround, user env-file edits or public-host exception.

## Work

- [x] Read current environment validator and tests.
- [x] Add strict flag parsing and require both origins to be loopback in preview.
- [x] Test valid localhost/IPv4/IPv6, false/absent, invalid flags, remote hosts,
      mixed origins, malformed origins and unchanged timeout restrictions.
- [x] Document local configuration and production deployment boundary.
- [x] Run actual production build, start and HTTP route smoke checks.

The delegated task never began tool work (0 turns/0 calls when checked) and was
cancelled. Parent implemented the bounded change directly; no worker result was
used as verification.

## Evidence

- RED: 2 new tests failed, 5 existing passed before implementation.
- GREEN: `pnpm exec vitest run src/lib/env/server.test.ts`: 7 tests passed.
- TypeScript (`--noEmit --incremental false`) and scoped ESLint passed.
- `PEOPLEFLOW_LOCAL_PREVIEW=true` with API `http://127.0.0.1:4110`, site
  `http://localhost:3000`, timeout 8000: **`pnpm build` passed** on Node 22.23.2.
- Same environment: **`pnpm start --hostname 127.0.0.1 --port 4317`** served all
  21 implemented page patterns at valid fixture IDs with HTTP 200. Includes both
  landings/logins, vacancy listing/detail/application, public company, employer
  routes including pipeline and talent, and all candidate workspace pages.
- Artifacts: `/tmp/pf-local-production-build.log`,
  `/tmp/pf-local-production-start.log`, `/tmp/pf-local-production-routes.json`.
- HTTP checks are not visual acceptance. User owns visual tests.

## Rollback

Remove only the opt-in parsing/loopback exception and its tests/docs. Existing
HTTPS production behavior remains unchanged; no application data or schema moved.
