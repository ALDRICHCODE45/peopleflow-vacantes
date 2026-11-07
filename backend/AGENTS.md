# Backend agent notes

## Running tests

Always run Go tests through the `make` targets in `backend/`, never `go test` directly. The targets route the run
through the machine-wide test queue named by `RUN_TESTS` (set to `run-tests` on the developer PC, empty in CI, where
the commands run unchanged) and cap package parallelism.

| Need | Command |
| --- | --- |
| Unit tests, whole module | `make test` |
| Unit tests, focused | `make test PKG=./internal/features/foo/... RUN='^TestBar$'` |
| Integration tests (loads `.env`, serial `-p 1`) | `make test-integration PKG=./cmd/api RUN='^TestFlow'` |
| Closure gates | `make gate-unit`, `make gate-integration`, `make closure-gate`, ... |

Knobs: `PKG` (one or more packages, quote a list: `PKG='./cmd/api ./db/migrations'`), `RUN` (a `-run` regex, single
quoted), `TIMEOUT` (for example `TIMEOUT=600s`) and `COUNT` (default `1`).

- Subagents run only the focused form for the packages they changed: `make test PKG=./changed/pkg/...` (or
  `make test-integration PKG=... RUN=...` for integration tests). The full suite is the parent's call.
- If you see `[run-tests] waiting`, the suite is queued behind other test runs on this machine. Do not kill it and do
  not retry it; it starts on its own when a slot frees up.
- Do not wrap long-running commands (`make run`, watchers, dev servers) in the queue.
