# Agent instructions

## Running tests

Always run tests through the project's test scripts (`pnpm test`, `make test`,
etc.), never by invoking the runner binary directly (`npx vitest`, `go test`,
`pytest`), so the machine-wide `run-tests` queue applies. Subagents run only
the tests related to the files they changed (for example `vitest related`,
`jest --findRelatedTests`, `go test ./changed/pkg/...`, `pytest path/to/test`),
passing them through the project script. Only the main agent runs the full
suite, once, before finishing. If you see `[run-tests] waiting`, the suite is
queued, not hung: wait for it and do not kill or retry it.

Frontend (`frontend/`, Node 22):

- `pnpm test` — full Vitest suite; `pnpm test <path>` for one file or folder.
- `pnpm test:related <changed files>` — only the tests related to those files.
- `pnpm test:e2e [spec]` and `pnpm test:a11y` — Playwright.
