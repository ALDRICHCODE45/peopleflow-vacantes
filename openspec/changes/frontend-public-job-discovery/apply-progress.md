# Apply Progress: Frontend Public Job Discovery

## Current apply slice

- Change: `frontend-public-job-discovery`
- Work unit: `task-2.4-closure` (ACTIVE — close out the committed task 2.4 REFACTOR)
- Delivery boundary: PR 2 of the selected feature-branch chain; tracker branch `feat/frontend-foundation`
- State: task 2.4 REFACTOR committed at `8ac4932` (`refactor(frontend): stabilize shared shell composition`), exact scope `frontend/src/components/shells/PublicShell.tsx` at 9 insertions / 5 deletions = 14 committed lines; no push or PR was performed
- Persisted checkbox: the task 2.4 checkbox is closed (`- [x]`, 5 checked / 17 unchecked) in `tasks.md` as part of this candidate; the native work unit `task-2.4-closure` itself is currently active and not yet settled
- Settled prior native objectives: `task-2.4-refactor`, `task-2.4-independent-verification`, and `task-2.4-commit` are all settled complete
- Final verification (Node `v22.22.1` / pnpm `10.34.5`): unit 6/6 files and 29/29 tests exit 0; typecheck pass; lint pass; API-offline Next `15.5.25` build pass; 13/13 root E2E and 4/4 axe pass; no stale server
- Scope: the committed production delta is one path, 14 changed lines, below the 400-line review budget; the six protected formatter-only test diffs (98+/54−) remain unstaged and untouched
- Out of scope and not started: every task 3+ item

Prior slices remain fully documented below: task 1.1 bootstrap (committed at `8e488a4`, remediation attempt 2 and revalidation attempt 3 bound to evidence revision `sha256:f62828b3be7ebbf193d74abcaa6b29c70d5c5eeea3e9d0d3b4c327626c28d7e0`), task 2.1 RED (committed at `bfada71`), task 2.2 GREEN (committed at `8467124`), and task 2.3 TRIANGULATE (committed at `7e4a050`).

## Structured status consumed

- Schema: `gentle-ai.sdd-status` v2
- Store: authoritative `openspec`
- Change root: `openspec/changes/frontend-public-job-discovery`
- Apply state: `ready`
- Native attempt: `proceed` for `task-1.1-bootstrap`
- Action context: `repo-local`
- Workspace root / allowed edit root: `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes-frontend`
- Applied narrower delegated edit surfaces: `frontend/**` and this file only
- Action-context warnings: none; all writes stayed within the delegated surfaces

## Candidate implementation

Created the standalone frontend bootstrap with exact direct dependency versions, Next.js `15.5.25`, React `19.1.9`, TypeScript, Tailwind CSS v4, pnpm `10.34.5`, Node 22 metadata, App Router detection, `src/`, local test/build scripts, and no product routes or components.

Initialized shadcn through the existing-project preset flow with explicit Base UI. No shadcn component was added. `src/components/ui/` is the resolved output path but remains absent because the initialized component list is empty.

### Created frontend paths

- `frontend/.gitignore`
- `frontend/.nvmrc`
- `frontend/components.json`
- `frontend/eslint.config.mjs`
- `frontend/next-env.d.ts`
- `frontend/next.config.ts`
- `frontend/package.json`
- `frontend/playwright.config.ts`
- `frontend/pnpm-lock.yaml`
- `frontend/postcss.config.mjs`
- `frontend/src/app/globals.css`
- `frontend/src/lib/utils.ts`
- `frontend/tsconfig.json`
- `frontend/vitest.config.ts`

## CLI and preset evidence

| Check | Exact command | Outcome |
| --- | --- | --- |
| Current init semantics | `cd frontend && pnpm dlx shadcn@latest init --help` | Passed; help explicitly listed `-b, --base <base>` with `base`, `radix`, and `aria`. |
| Preset decode | `cd frontend && pnpm dlx shadcn@latest preset decode b27M1Ev2` | Passed; `b27M1Ev2`, Rhea, Neutral base, Violet theme, Neutral chart, Lucide, Inter/inherit heading, Default radius, Subtle accent, Default menu. |
| Existing-project initialization | `cd frontend && pnpm dlx shadcn@latest init --preset b27M1Ev2 --base base --yes` | Passed; detected Next.js, Tailwind v4, and import alias; wrote `components.json`, `src/lib/utils.ts`, and updated `src/app/globals.css`. Base UI was explicit. |
| Alias assertion | `cd frontend && NODE22=$(find "$HOME/.cache/pnpm/dlx" -path '*/node@22.22.1/node_modules/node/bin/node' -type f -print \| tail -1) && PATH="$(dirname "$NODE22"):$PATH" node -e '<JSON alias assertion>'` | Passed; `components=@/components`, `ui=@/components/ui`, and `@/*=["./src/*"]`. |
| Project information | `cd frontend && pnpm dlx shadcn@latest info --json` | Passed and inspected; Next.js `15.5.25`, `srcDirectory=true`, `rsc=true`, Tailwind `v4`, `style=base-rhea`, `base=base`, Lucide, no installed components, and UI resolved to `frontend/src/components/ui`. |
| Resolved preset | `cd frontend && pnpm dlx shadcn@latest preset resolve --json` | Passed and inspected; code `b27M1Ev2` and all decoded values matched exactly. The CLI reported only the expected `font` fallback, with Inter and inherited heading font. |

The help, decode, info, and resolve checks were also rerun successfully under Node `v22.22.1`. No preset, primitive-base, framework/RSC, Tailwind, icon, alias, or path mismatch was found.

## Verification evidence

Node 22 gates used a temporary Node `v22.22.1` executable with its directory prepended to `PATH`; Corepack then selected the manifest-pinned pnpm `10.34.5`.

| Gate | Exact command | Outcome |
| --- | --- | --- |
| Runtime version | `PATH="$(dirname "$NODE22"):$PATH" corepack pnpm exec node -p 'process.version'` | Passed: `v22.22.1`. |
| Frozen install | `cd frontend && PATH="$(dirname "$NODE22"):$PATH" corepack pnpm install --frozen-lockfile` | Passed: lockfile up to date, pnpm `10.34.5`. |
| Typecheck | `cd frontend && PATH="$(dirname "$NODE22"):$PATH" corepack pnpm typecheck` | Passed with no diagnostics. |
| Lint | `cd frontend && PATH="$(dirname "$NODE22"):$PATH" corepack pnpm lint` | Passed with no errors or warnings after excluding Next-generated `next-env.d.ts`. |
| Unit runner | `cd frontend && PATH="$(dirname "$NODE22"):$PATH" corepack pnpm test` | Passed; Vitest `3.2.7` found no behavioral tests, as expected for the production-neutral bootstrap. |
| E2E runner | `cd frontend && PATH="$(dirname "$NODE22"):$PATH" corepack pnpm test:e2e` | Passed with `--pass-with-no-tests`; browser scenarios are N/A until routes are introduced by later tasks. |
| Accessibility runner | `cd frontend && PATH="$(dirname "$NODE22"):$PATH" corepack pnpm test:a11y` | Passed with `--grep @a11y --pass-with-no-tests`; browser accessibility scenarios are N/A until routes exist. |
| API-offline build | `cd frontend && PATH="$(dirname "$NODE22"):$PATH" PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:9 PEOPLEFLOW_SITE_URL=http://127.0.0.1:3000 corepack pnpm build` | Passed with Next.js `15.5.25`; compiled, type-checked, and generated only the framework 404 because task 1.1 intentionally creates no routes. No API process was available. |
| Production startup | `cd frontend && PATH="$(dirname "$NODE22"):$PATH" corepack pnpm start --hostname 127.0.0.1 --port 3102` | Passed; ready in 488 ms under Node `v22.22.1`. HTTP `/` returned the expected 404 because routes are outside task 1.1. Browser product runtime: N/A. |

Intermediate corrections: the first lint run exposed the generated `next-env.d.ts` triple-slash rule and was corrected by ignoring that generated file; the final lint gate passed. An initial development-start probe used an invalid forwarded `--` and failed before startup; the corrected development probe reached ready state, and the final production-start command above passed.

## TDD Cycle Evidence

| Stage | Evidence |
| --- | --- |
| RED | N/A by explicit task contract: task 1.1 is a production-neutral prerequisite, while `openspec/config.yaml` and its Go runner are backend-only. No backend code or tests were touched. |
| GREEN | Bootstrap configuration, dependency graph, exact lockfile, and explicit shadcn initialization were established; frontend-local typecheck, lint, unit-runner, build, and startup gates passed. |
| TRIANGULATE | Frozen install, Node 22 execution, shadcn decode/resolve/info, exact alias assertion, empty E2E/a11y harnesses, API-offline build, and production startup were independently checked. |
| REFACTOR | Removed the only lint warning and then isolated Next-generated `next-env.d.ts` from authored lint scope; reran lint successfully without changing product behavior. |

## Changed-line accounting

Frontend snapshot additions: **7,739 lines**.

- Authored source/configuration: **142 lines**.
- Generated output: **7,597 lines**.
  - Approved generated-only exception: `pnpm-lock.yaml` plus shadcn output (`components.json`, `src/app/globals.css`, `src/lib/utils.ts`): **7,591 lines**.
  - Other generated Next bootstrap file (`next-env.d.ts`): **6 lines**; no size exception is needed for it.
- This progress artifact is administrative evidence and is excluded from frontend source-budget accounting.
- `git diff --stat` and `git diff --cached --stat` were empty because all candidate files are untracked and nothing was staged; `git ls-files --others --exclude-standard frontend` was used for the complete 14-file snapshot and line count.

Authored source remains below the 400-line review budget. The coherent lockfile/shadcn snapshot uses only the approved generated-only exception.

## Remediation evidence — attempt 2 (gatekeeper rerun for task-1.1 only)

Parent dispatch diagnostics reported unresolved imports in four new configuration files. Attempt 2 re-proved resolution under the pinned Node `v22.22.1` + pnpm `10.34.5` environment instead of editing any source. **Zero frontend files were modified during remediation**; the snapshot and line accounting below are unchanged.

### Package-resolution evidence (Node `v22.22.1`, pnpm `10.34.5`, run from `frontend/`)

Every reported specifier was resolved with `import.meta.resolve` under Node 22:

| Reported import | Resolution result |
| --- | --- |
| `@eslint/eslintrc` | RESOLVED → `node_modules/.pnpm/@eslint+eslintrc@3.3.7/.../lib/index.js`; `FlatCompat` named export verified as `function` |
| `eslint-config-next/core-web-vitals` | RESOLVED → `node_modules/eslint-config-next/core-web-vitals` (direct devDependency `15.5.25`) |
| `eslint-config-next/typescript` | RESOLVED → `node_modules/eslint-config-next/typescript` (direct devDependency `15.5.25`) |
| `@playwright/test` | RESOLVED → `node_modules/.pnpm/@playwright+test@1.62.1/.../index.mjs` (direct devDependency `1.62.1`) |
| `@tailwindcss/postcss` | RESOLVED → `node_modules/.pnpm/@tailwindcss+postcss@4.3.3/.../dist/index.mjs` (direct devDependency `4.3.3`) |
| `vitest/config` | RESOLVED → `node_modules/.pnpm/vitest@3.2.7_.../dist/config.js` (direct devDependency `3.2.7`) |

### `@vitejs/plugin-react` specific verification

- `grep -rn "@vitejs/plugin-react"` across `*.ts`, `*.tsx`, `*.mjs`, `*.json` (excluding `node_modules`): **not imported anywhere**. The shipped `frontend/vitest.config.ts` imports only `vitest/config`.
- `package.json` direct dependency check via `node -e`: **`plugin-react declared: false`**.
- `grep -c "@vitejs/plugin-react" pnpm-lock.yaml`: **0 occurrences**; `pnpm why @vitejs/plugin-react`: no dependency path.
- Conclusion: the diagnostic was stale/incorrect for this revision. The package is neither imported nor needed — task 1.1 has no behavioral tests (`--passWithNoTests`), and adding an unused transform plugin would be an unnecessary source change. If later tasks (2.1+) add React component tests, the transform requirement is re-evaluated there.

### Rechecked shadcn and alias assertions (attempt 2)

- `pnpm dlx shadcn@latest preset decode b27M1Ev2`: passed; Rhea, Neutral base, Violet theme, Neutral chart, Lucide, Inter/inherit heading, Default radius, Subtle accent, Default menu — preset `b27M1Ev2` intact.
- `pnpm dlx shadcn@latest preset resolve --json`: passed; code `b27M1Ev2`, all values matched exactly, only the expected `font` fallback.
- `pnpm dlx shadcn@latest info --json`: passed; framework Next.js `15.5.25`, `srcDirectory=true`, `rsc=true`, Tailwind `v4`, `style=base-rhea`, `base=base` (Base UI explicit), Lucide, `components=@/components`, `ui=@/components/ui`, resolved `ui` path `/frontend/src/components/ui`, zero installed components.
- `tsconfig.json` paths: `{"@/*":["./src/*"]}` — alias unchanged.

### Full gate rerun (attempt 2, Node `v22.22.1` via Corepack-pinned pnpm `10.34.5`)

| Gate | Exact command | Outcome |
| --- | --- | --- |
| Frozen install | `corepack pnpm install --frozen-lockfile` | Passed: `Already up to date`, 683 ms, pnpm `10.34.5` |
| Typecheck | `corepack pnpm typecheck` | Passed, no diagnostics |
| Lint | `corepack pnpm lint` | Passed, no errors/warnings |
| Unit | `corepack pnpm test` | Passed: no test files found, exit 0 (expected for production-neutral bootstrap) |
| E2E | `corepack pnpm test:e2e` | Passed with `--pass-with-no-tests` (N/A until routes exist) |
| A11y | `corepack pnpm test:a11y` | Passed with `--grep @a11y --pass-with-no-tests` (N/A until routes exist) |
| Build | `PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:9 PEOPLEFLOW_SITE_URL=http://127.0.0.1:3000 corepack pnpm build` | Passed; API-offline, framework 404 only, no API process available |
| Start | `corepack pnpm start --hostname 127.0.0.1 --port 3102` | Passed: `Ready in 496ms` under Node `v22.22.1`; `GET /` → 404 (expected, no routes in task 1.1) |

### Corrected line accounting (attempt 2)

No correction needed. Re-verified after remediation: 14 untracked frontend files, **7,739 total lines** (authored 142 / generated 7,597), `git diff --stat` and `git diff --cached --stat` empty, nothing staged. `git status --porcelain` shows only `?? frontend/` and `?? openspec/changes/frontend-public-job-discovery/` on branch `feat/frontend-foundation`.

### Attempt 2 conclusion

All blocking diagnostics were disproved with exact resolution evidence; the task-1.1 candidate is coherent with no source changes required.

## Deviations and risks

- No design deviation was introduced. No frontend file was modified during the attempt-2 remediation rerun.
- The machine default was Node `v24.14.1`, so early bootstrap commands emitted the expected engine warning against `>=22 <23`. Final frozen install, checks, build, and startup were rerun under Node `v22.22.1` and passed.
- No browser binaries or route-level browser scenario were exercised because task 1.1 intentionally creates no routes; E2E and accessibility applicability is N/A at this stage.

## Remaining assigned task

Task 1.1 is complete (see the final closure section below). For the original task text, see `tasks.md` §1.1.

All task 2.1+ checkboxes remained untouched and outside that task-1.1 work-unit boundary (historical: task 2.1 was subsequently implemented and closed; see the section below).

## Final revalidation — corrected native accounting objective (attempt 3, read-mostly)

Purpose: revalidate the exact existing task-1.1 candidate under the corrected native objective (one attempt, max 10,000 changed lines, generated lockfile/shadcn snapshot approved). No file was rebuilt or redesigned. All checks ran from `frontend/` under pinned Node `v22.22.1` (binary resolved from the pnpm dlx cache) with Corepack selecting manifest pnpm `10.34.5`.

| Check | Exact command | Outcome |
| --- | --- | --- |
| Node version | `PATH="$(dirname "$NODE22"):$PATH" node --version` | `v22.22.1` (machine default v24.14.1 not used) |
| pnpm version | `corepack pnpm --version` | `10.34.5` (manifest `packageManager: pnpm@10.34.5`; engines `>=22.0.0 <23.0.0`; `.nvmrc` `22`) |
| Frozen install | `corepack pnpm install --frozen-lockfile` | Passed: `Lockfile is up to date`, `Already up to date`, 637 ms, pnpm `10.34.5`; `corepack pnpm exec node -p 'process.version'` → `v22.22.1` |
| Base-UI help | `pnpm dlx shadcn@latest init --help` | Passed: `-b, --base <base>` lists `base, radix, aria` (explicit Base UI supported) |
| Preset decode | `pnpm dlx shadcn@latest preset decode b27M1Ev2` | Passed: `b27M1Ev2`, rhea, neutral base, violet theme, neutral chart, lucide, inter/inherit heading, default radius, default menuColor, subtle menuAccent |
| Project info | `pnpm dlx shadcn@latest info --json` | Passed: Next.js `15.5.25` (next-app, App Router), `srcDirectory=true`, `rsc=true`, Tailwind `v4`, `style=base-rhea`, `base=base`, Lucide, `components=@/components`, `ui=@/components/ui`, resolved UI `…/frontend/src/components/ui`, `components: []` |
| Resolved preset | `pnpm dlx shadcn@latest preset resolve --json` | Passed: code `b27M1Ev2`, all ten values matched exactly; sole fallback `font` (expected) |
| Blocking assertions | `node /tmp/assert-1.1.mjs` (Node 22) | Passed: all preset identity/value, Base UI (`info.config.base === "base"`, `components.json` style `base-rhea`), Tailwind v4, Next 15/RSC/src-dir, aliases, `tsconfig.json` `@/* -> ["./src/*"]`, resolved UI path, zero installed components |
| Scope negatives | `ls src/components/ui`, `ls src/features`, `find src -name "*.tsx"` | No `src/components/ui/`, no `src/features/`, no `.tsx` anywhere; `src/app/` contains only `globals.css` → no product routes/UI and no task-2 work |
| Import resolution | Node 22 `import.meta.resolve` for `@eslint/eslintrc`, `eslint-config-next/core-web-vitals`, `eslint-config-next/typescript`, `@playwright/test`, `@tailwindcss/postcss`, `vitest/config` | All RESOLVED; `FlatCompat` named export verified `function`; `@vitejs/plugin-react` still undeclared, unimported, 0 lockfile occurrences (stale diagnostic stays disproved) |
| Typecheck | `corepack pnpm typecheck` | Passed, no diagnostics |
| Lint | `corepack pnpm lint` | Passed, no errors/warnings |
| Unit | `corepack pnpm test` | Passed: `No test files found, exiting with code 0` (expected, production-neutral) |
| E2E | `corepack pnpm test:e2e` | Passed with `--pass-with-no-tests` (N/A until routes exist) |
| A11y | `corepack pnpm test:a11y` | Passed with `--grep @a11y --pass-with-no-tests` (N/A until routes exist) |
| API-offline build | `PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:9 PEOPLEFLOW_SITE_URL=http://127.0.0.1:3000 corepack pnpm build` | Passed: Next.js `15.5.25`, framework 404 only, no API process available |
| Startup | `corepack pnpm start --hostname 127.0.0.1 --port 3102` | Passed: `Ready in 466ms`; `GET /` → 404 (expected, no routes); server stopped after probe |
| Changed-line accounting | `git ls-files --others --exclude-standard frontend` + `wc -l` | 14 untracked files, **7,739 total**: authored 142 (eslint.config.mjs 21, .gitignore 8, next.config.ts 5, .nvmrc 1, package.json 50, playwright.config.ts 19, postcss.config.mjs 7, tsconfig.json 23, vitest.config.ts 8) + generated 7,597 (pnpm-lock.yaml 7,432 + shadcn output components.json 25 / globals.css 128 / utils.ts 6 = 7,591 under the approved generated-only exception, plus next-env.d.ts 6); within the corrected 10,000-line objective |
| Checkbox state | `grep -c '^\- \[ \]' tasks.md` / `grep -c '^\- \[x\]' tasks.md` | 22 unchecked / 0 checked; task 1.1 remains `- [ ]` because no commit is authorized |

**No frontend file was modified during this revalidation.** `git status --porcelain` shows only `?? frontend/` and `?? openspec/changes/frontend-public-job-discovery/` on `feat/frontend-foundation`; `git diff --stat` and `git diff --cached --stat` remain empty (build/start artifacts `.next/`, `tsconfig.tsbuildinfo`, `test-results/` are gitignored). Nothing was staged, committed, pushed, or opened as a PR. Task 2.1 and later were not started. Attempt-2 evidence above remains valid and unchanged.

## Rollback boundary

Remove only the 14 frontend paths listed above. This removes the standalone bootstrap, exact dependency lock, test/build harness, and coherent shadcn initialization without touching backend code, root/shared configuration, OpenSpec source artifacts, or later feature work.

## Final closure — task 1.1 complete

- Planning commit `aff13fc` (`docs(openspec): define frontend public job discovery`) and bootstrap implementation commit `8e488a4` (`chore(frontend): bootstrap Next.js foundation`) are both landed on `feat/frontend-foundation`.
- `src/lib/utils.ts` was reconciled to blob `bd0c391ddd1088e9067844c48835bf4abcd61783` through completed native work unit `task-1.1-formatter-reconciliation`; `pnpm-lock.yaml` was reconciled to blob `cb49f20d235e783ac7f66007f25b7839c764866b` through completed native work unit `task-1.1-lockfile-reconciliation`; `src/app/globals.css` remained blob `63ff46048f838f8cb5652fbc28e77257b2238f1d` throughout.
- Final revalidation under Node `v22.22.1` / pnpm `10.34.5` passed: frozen install, shadcn preset/Base UI/alias assertions, import resolution, typecheck, lint, empty unit/E2E/a11y runners, API-offline build, and the expected startup 404 (task 1.1 creates no routes).
- All 14 blobs matched settled tree `4ff86dcad756e6ddf1d88b4a9d35c34c6d2cee16` both before and after verification; no source or OpenSpec artifact changed during verification.
- Task 1.1 is complete: its implementation checkbox in `tasks.md` is now `- [x]` (1 checked, 21 unchecked implementation rows). At that closure time task 2.1 and every later task were untouched (task 2.1 has since landed; see the section below). No push was made and no PR was created.

## Task 2.1 RED closure — complete

- RED implementation commit: `bfada71c7ce6972c0fa792409570dfaa9d548ae2` — `test(frontend): define public root foundation`. Exact scope: seven test files, 391 insertions, no production files.
- Genuine RED evidence (required, not a defect to fix in closure), Node 22.22.1 / pnpm 10.34.5:
  - `pnpm test` → 5 files failed, 1 passed; failures are missing `layout` / `page` / `logo` / `PublicShell` modules plus missing system-dark media activation.
  - `pnpm test:e2e` → root `ERR_CONNECTION_REFUSED` because no route/server exists yet.
- Native work units `task-2.1-red` and `task-2.1-red-commit` both settled complete. Parent acquired, settled, and committed; no apply-side stage/commit was performed.
- Rollback: revert commit `bfada71`; it removes only the seven root/foundation test files.
- Task state: 2.1 checkbox is `- [x]` (2 checked / 20 unchecked). Task 2.2 (GREEN) is next and has not started. No push or PR.

## Corrective rerun — task 2.2 GREEN (gatekeeper rerun, one allowed corrective attempt)

Purpose: continue the exact task 2.2 GREEN candidate left by the timed-out prior actor and drive the committed task 2.1 RED suite to GREEN. **Zero files were authored or modified in this rerun** — the candidate was inspected, preserved, and every gate was executed; two intrinsic test-vs-framework conflicts block GREEN and are reported precisely below with the minimum test corrections, per the delegated instruction not to edit tests.

### Candidate inspection and preservation

- Dirty state verified formatter-only via `git diff` on the six RED test files (whitespace/wrapping only) and confirmed byte-identical before/after the rerun (`git status --porcelain` unchanged: 7 modified test/config files + untracked `frontend/public/`, `layout.tsx`, `(marketing)/page.tsx`, `brand/logo.tsx`, `shells/PublicShell.tsx`).
- Candidate production files preserved as-is: `src/app/layout.tsx` (35), `src/app/(marketing)/page.tsx` (18), `src/components/brand/logo.tsx` (35), `src/components/shells/PublicShell.tsx` (36), `src/app/globals.css` (+54 system-dark media block and brand-mark scheme swap), `public/brand/peopleflow-{light,dark}.webp` (1584×396, ratio 4 verified by the logo test). Total authored candidate ≈ 178 lines, matching the prior actor's report.
- No production correction was needed: the candidate is valid Next.js code. Both blockers live in the committed test file, not in the candidate.

### Blocker 1 (precise) — named `RootLayout` export is invalid for a Next.js layout

- `frontend/src/app/layout.test.tsx` line 18 requires the named export: `import { RootLayout, metadata } from "./layout";`.
- `frontend/src/app/layout.tsx` satisfies it with `export function RootLayout(...)` + `export default RootLayout;`.
- Next.js 15.5 route-export validation rejects any extra named export from a layout module. Exact evidence:
  - `PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:9 PEOPLEFLOW_SITE_URL=http://127.0.0.1:3000 corepack pnpm build` → `Failed to compile. src/app/layout.tsx — Type error: Layout "src/app/layout.tsx" does not match the required types of a Next.js Layout. "RootLayout" is not a valid Layout export field.`
  - `corepack pnpm typecheck` (with the build-regenerated `.next/types` in the tsconfig program) → same root cause: `Property 'RootLayout' is incompatible with index signature ... not assignable to type 'never'` in `.next/types/app/layout.ts(12,13)`.
- No production-side fix exists inside the allowed edit surfaces: the named export cannot be removed (breaks the test import) and cannot be kept (breaks `next build` type validation). Workarounds (`typescript.ignoreBuildErrors`, removing `.next/types` from tsconfig, project-wide config changes) are explicitly forbidden and would be hacks.
- **Minimum test correction:** change the import to the default export — `import RootLayout, { metadata } from "./layout";` — and the production layout to `export default function RootLayout(...)`, dropping the `export default RootLayout;` alias line. No other assertion needs to change (the metadata export is valid).

### Blocker 2 (precise) — React 19 hoists `<html>`/`<body>` out of the RTL container

- Three committed assertions query the Testing Library container: `container.querySelector("html")` (×2) and `container.querySelector("body")` (×1) in `frontend/src/app/layout.test.tsx` lines 31, 43, 54.
- React 19 (react-dom 19.1.9) treats `<html>`/`<body>` as pinned root elements: rendering them from a valid Next root layout hoists them onto the real `document.documentElement`/`document.body` and leaves the RTL container holding only the children. Debug evidence (temporary throwaway test, deleted after): `CONTAINER: <p>contenido</p>` while `document.documentElement` carried `lang="es-MX"` and the Inter variable/className — i.e. the production behavior is correct and the container-only queries can never pass.
- No production-side fix exists: any valid Next root layout returns `<html>`, and React 19 always hoists it in a jsdom document context.
- **Minimum test correction:** in those three assertions use the document root elements instead of the container — `document.querySelector("html")` / `document.querySelector("body")` (or `document.documentElement` / `document.body`).

### Verification evidence (Node v22.22.1, Corepack-pinned pnpm 10.34.5, from `frontend/`)

| Gate | Exact command | Outcome |
| --- | --- | --- |
| Node | `find ~/.cache/pnpm/dlx -path '*/node@22.22.1/.../bin/node'` + `PATH` prepend; `node --version` | `v22.22.1` |
| pnpm | `corepack pnpm --version` | `10.34.5` |
| Unit (RED→GREEN state) | `corepack pnpm test` | 1 file failed / 5 passed; **26 of 29 tests pass** — page, logo, PublicShell, preset-identity, globals.css suites are fully GREEN. The 3 failures are exactly Blocker 2 (html/body container queries). The suite also caught the prior actor's reported missing system-dark media activation and it now passes (globals.css system-dark block present). |
| Typecheck | `corepack pnpm typecheck` | Fails only via Blocker 1 (`.next/types` export-field check); no other diagnostics. Passed clean before the failed build generated `.next/types`. |
| Lint | `corepack pnpm lint` | Passed, zero errors/warnings. |
| API-offline build | `PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:9 PEOPLEFLOW_SITE_URL=http://127.0.0.1:3000 corepack pnpm build` | Fails only on Blocker 1 with the exact "not a valid Layout export field" error; compilation itself succeeded (`✓ Compiled successfully in 1428ms`). |
| shadcn info | `pnpm dlx shadcn@latest info --json` | Confirmed: Next.js 15.5.25, `srcDirectory=true`, `rsc=true`, Tailwind v4, `style=base-rhea`, `base=base`, Lucide, aliases `components=@/components` / `ui=@/components/ui`, resolved UI path `frontend/src/components/ui`, `components: []`. |
| Preset resolve | `pnpm dlx shadcn@latest preset resolve --json` | Confirmed: code `b27M1Ev2`, values rhea/neutral/violet/neutral-chart/lucide/inter/inherit-heading/default-radius/subtle-accent/default-menu — exact match with the tasks.md preset fidelity contract, no fallbacks. |
| Focused E2E smoke (dev server, production unavailable) | `PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:9 PEOPLEFLOW_SITE_URL=http://127.0.0.1:3000 corepack pnpm dev --hostname 127.0.0.1 --port 3000` then `corepack pnpm exec playwright test tests/e2e/root.spec.ts` | Server `Ready in 1485ms`; rendered `lang="es-MX"` confirmed via curl. All product assertions passed; single failure is `getByRole("button")` resolving to the dev-only **"Open Next.js Dev Tools"** overlay button (absent in production builds). No test change is needed for the E2E spec; it must be rerun against a production build once Blocker 1 is resolved. A stale leftover `next-server` on port 3000 from the prior actor was stopped before the run; the dev server was stopped after. |

### TDD Cycle Evidence (task 2.2, partial — blocked)

| Stage | Evidence |
| --- | --- |
| RED | Provided by committed task 2.1 (`bfada71`); the prior actor's "missing system-dark media activation" RED failure is now genuinely GREEN. |
| GREEN | 26/29 unit tests pass and the candidate compiles; blocked from full GREEN only by Blockers 1–2 in `layout.test.tsx` and the derived build/typecheck gates. |
| TRIANGULATE | shadcn `info --json` + `preset resolve --json` re-verified exact `b27M1Ev2` identity; focused dev-mode Playwright smoke executed with product assertions passing. |
| REFACTOR | Not started (out of scope for GREEN; task 2.4). |

### Remaining work after the test corrections land

1. ~~Apply the two minimum corrections~~ → **DONE** (see the authorized correction section below).
2. ~~Re-run gates~~ → **DONE** (evidence below); one exit-code caveat remains on the unit gate, owned by read-only files.
3. ~~Mark task 2.2 checkbox `- [x]` only when the implementation commit lands (per the candidate-and-commit accounting contract).~~ SUPERSEDED: the implementation commit landed at `8467124` and the checkbox is now closed (see the final task 2.2 closure section below).

## Authorized minimal test correction — task 2.2 GREEN (work unit `task-2.2-green`)

Human decision: `authorize_minimal_test_correction` — correct only the invalid committed layout-test assumptions, adjust the production default export, finish GREEN verification. Bound to failed evidence revision `sha256:42f633aea0a2a7489a7fe8d40d7e24303f7a2767d810eae13f80a8c8d7d2bc62` (no runtime tokens persisted). Allowed edit surfaces honored exactly: `frontend/src/app/layout.test.tsx`, `frontend/src/app/layout.tsx`, this file. No other production or test file was modified; `tasks.md` untouched; nothing staged, committed, or pushed.

### Corrections applied (exact)

1. `frontend/src/app/layout.test.tsx`: `import { RootLayout, metadata } from "./layout";` → `import RootLayout, { metadata } from "./layout";` (valid default import; named `metadata` retained).
2. `frontend/src/app/layout.test.tsx`: the three committed RTL `container` queries for `<html>`/`<body>` now query the React 19 document root — `document.querySelector("html")` ×2, `document.querySelector("body")` ×1 — because React 19 pins `<html>`/`<body>` onto the real document, never the RTL container. The now-unused `const { container }` destructuring was removed on exactly those three tests (otherwise lint fails on unused vars). A one-line comment on each test records why. All behavioral assertions preserved at full strength; no assertion weakened or removed.
3. `frontend/src/app/layout.tsx`: `export function RootLayout(...)` + `export default RootLayout;` → single `export default function RootLayout(...)` (33 lines, was 35). The extra named export — the exact "not a valid Layout export field" build/typecheck blocker — is gone. No other byte changed.

Pre-existing formatter-only drift in the dirty test file (e.g. the wrapped `readFileSync(...)` multiline call, present before this correction) was preserved untouched, per the delegation.

### Blocker resolution evidence

- Blocker 1 (named layout export) — **RESOLVED**: API-offline build now compiles, type-checks, and generates 4/4 static pages (`/` 8.18 kB First Load 110 kB, `/_not-found`); typecheck passes with no diagnostics. The `.next/types` route-export rejection is gone.
- Blocker 2 (container `<html>`/`<body>` queries) — **RESOLVED**: the three layout tests pass against the real document root; full suite is 6/6 files, **29/29 tests passing** (was 26/29 with 3 failures).

### Verification evidence (Node `v22.22.1` via pinned pnpm `10.34.5`, from `frontend/`)

| Gate | Exact command | Outcome |
| --- | --- | --- |
| Baseline (pre-correction, for attribution) | `git stash push -- src/app/layout.test.tsx` + `corepack pnpm test` + `git stash pop` | Reproduced the failed evidence revision state: 3 failed / 26 passed AND the same 3 unhandled teardown errors — proving those errors pre-date this correction and originate in read-only files |
| 1. Unit | `corepack pnpm test` (`vitest run --passWithNoTests`) | **6/6 files, 29/29 tests passed**, but process exit 1: Vitest caught 3 unhandled post-teardown errors (non-deterministically 3–4 across runs; count varies with scheduler timing), all `TypeError: Right-hand side of 'instanceof' is not an object` in react-dom `getActiveElementDeep` via `Immediate.performWorkUntilDeadline`, "caught after test environment was torn down", originating ONLY in `src/app/(marketing)/page.test.tsx` and `src/components/shells/PublicShell.test.tsx` — both read-only for this work unit |
| 1a. Root-cause diagnostic (throwaway, zero repo files touched) | temp setup file in ignored `node_modules/` registering `afterEach(() => cleanup())` + temp vitest config in `/tmp`; deleted after | With only the cleanup hook registered: **6/6 files, 29/29 tests, exit 0**. Proven cause: `vitest.config.ts` lacks `globals: true`, so `@testing-library/react` auto-cleanup never registers; roots stay mounted and React 19 scheduler work fires after jsdom teardown. One-line remediation (`globals: true` in `vitest.config.ts`, or `afterEach(cleanup)` in the two read-only test files) is OUTSIDE the authorized edit surfaces and requires a parent/user decision |
| 2. Typecheck | `corepack pnpm typecheck` | Passed, no diagnostics |
| 3. Lint | `corepack pnpm lint` | Passed, zero errors/warnings |
| 4. API-offline build | `PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:9 PEOPLEFLOW_SITE_URL=http://127.0.0.1:3000 corepack pnpm build` | Passed: Next.js `15.5.25`, compiled 1435 ms, lint/type validity OK, 4/4 static pages, `/` + `/_not-found` only; no API process available |
| 5. Focused root Playwright smoke (production) | `corepack pnpm start --hostname 127.0.0.1 --port 3000` then `node node_modules/@playwright/test/cli.js test tests/e2e/root.spec.ts` | Server `Ready in 460 ms` under Node `v22.22.1`; `GET /` → HTTP 200 with `lang="es-MX"`; **1 passed** (chromium, 250 ms), exit 0 — all product assertions including zero buttons (dev-overlay absent in production) |
| Stale-server check | `ss -ltnp` + `pgrep -af 'next-server\|next start'` after run | No listener on 3000, no next-server processes; temp logs removed |
| Runtime pin | `node --version` / `corepack pnpm --version` | `v22.22.1` / `10.34.5` (machine default v24.14.1 not used; an intermediate shell precedence slip briefly hit v24 and was corrected with proper grouping before any gate result was recorded) |

### Unit-gate caveat (requires parent decision — NOT a test failure)

Every test passes (29/29). The only reason `pnpm test` exits non-zero is the pre-existing missing-RTL-auto-cleanup infrastructure defect in read-only files (`page.test.tsx`, `PublicShell.test.tsx`, `vitest.config.ts`), proven by the 1a diagnostic. The objective "make the committed task 2.1 RED suite pass" is achieved at the assertion level; the exit-code remediation is a one-line change outside `authorize_minimal_test_correction`'s edit surfaces. Recommended next authorization: `globals: true` in `frontend/vitest.config.ts` (preferred — one line, fixes all files, no test edits) or equivalent per-file `afterEach(cleanup)`.

### TDD Cycle Evidence (task 2.2 GREEN — complete at assertion level)

| Stage | Evidence |
| --- | --- |
| RED | Committed task 2.1 suite (`bfada71`); baseline rerun before this correction reproduced 3 failed / 26 passed bound to the failed evidence revision |
| GREEN | After the authorized minimal correction: 29/29 tests pass, typecheck/lint/build/production-E2E all pass; exit-code caveat is pre-existing test-infra, not a behavioral failure |
| TRIANGULATE | Production-mode Playwright smoke (HTTP 200, `lang="es-MX"`, 1 h1, exactly one `/vacantes` link, zero buttons) passed against `pnpm start`; build validated route-export types via `.next/types` |
| REFACTOR | Not started (task 2.4, out of scope) |

### Changed-line accounting (this correction)

- `frontend/src/app/layout.test.tsx` (tracked): `git diff --stat` = 14 insertions / 8 deletions total vs HEAD, of which ~3/1 are pre-existing formatter-only drift; authored delta ≈ 11+/7− (import, 3 comment lines, 3 destructure removals, 3 query lines).
- `frontend/src/app/layout.tsx` (untracked): 33 lines (was 35) — default-only export.
- `apply-progress.md`: administrative evidence, excluded from budget.
- Total authored delta for this work unit ≈ **28 changed lines** — far below the 400-line budget. No staging or commits performed.

### Rollback boundary

Revert the two exact files: restore the committed `frontend/src/app/layout.test.tsx` via `git checkout -- frontend/src/app/layout.test.tsx` and delete untracked `frontend/src/app/layout.tsx` (or restore its 35-line two-export form). No other file, config, or lockfile was touched by this correction.

## Final GREEN resolution — task 2.2

The parent applied the proven one-line test-infrastructure correction, `globals: true` in `frontend/vitest.config.ts`, so React Testing Library auto-cleanup registers for every test. Independent verification then completed the task 2.2 GREEN objective under Node `v22.22.1` and pnpm `10.34.5`:

- `corepack pnpm test`: passed, 6/6 files and 29/29 tests, exit 0, with no unhandled-errors section.
- `corepack pnpm typecheck`: passed with no diagnostics.
- `corepack pnpm lint`: passed with no errors or warnings.
- API-offline `corepack pnpm build`: passed; Next.js `15.5.25` compiled, validated types, and generated 4/4 static pages with only `/` and `/_not-found`.
- Production `pnpm start` plus focused `tests/e2e/root.spec.ts`: passed, 1/1 Chromium test; the server was terminated and port 3000 had no remaining listener.
- `git diff --check`: passed. The semantic task footprint is approximately 194 changed lines, below the 400-line budget; administrative evidence is excluded.
- Static preset assertions remained GREEN for exact `b27M1Ev2`, Base UI, Rhea/Neutral/Violet, Inter, Lucide, Default radius, Default/Solid menu, Subtle accent, Tailwind v4, aliases, and resolved UI path. Live `pnpm dlx` registry checks were not repeated by the read-only verifier because they can mutate the external dlx cache; the prior apply run's live checks remain valid.

Native runtime settlement completed the `task-2.2-green` objective and remediated evidence revision `sha256:916a616096dd79883ffb399388fb128b8ac8a331c06ec87114447a6cb38bbb84`. The statement "Task 2.2 remains `- [ ]` until an explicitly authorized implementation commit lands" recorded above is now SUPERSEDED: the implementation commit `8467124` has landed and the checkbox is closed (see the final task 2.2 closure section below). At that settlement time no stage, commit, push, or PR had been performed by apply-side actors.

## Final closure — task 2.2 GREEN complete

- Implementation commit `8467124` (`feat(frontend): add public foundation and marketing root`) landed on `feat/frontend-foundation`; task 2.2's checkbox in `tasks.md` is now `- [x]`. No push was made and no PR was created.
- Final verification under Node `v22.22.1` / pnpm `10.34.5`: unit tests 6/6 files and 29/29 tests passing with exit 0; `corepack pnpm typecheck` passed with no diagnostics; `corepack pnpm lint` passed with no errors or warnings; API-offline `corepack pnpm build` passed with Next.js `15.5.25`; production `pnpm start` plus the focused `tests/e2e/root.spec.ts` browser smoke passed 1/1 with no stale server left behind.
- Native runtime completion: the `task-2.2-green` work unit settled complete natively, remediating evidence revision `sha256:916a616096dd79883ffb399388fb128b8ac8a331c06ec87114447a6cb38bbb84`.
- Scope: the exact staged implementation scope was 9 paths and 195 textual changed lines, below the 400-line review budget; administrative evidence is excluded from the budget.
- Rollback: revert commit `8467124`, which removes only this foundation candidate plus its reviewed generated snapshot without touching unrelated work.
- Task state after this closure: task 2.3 (TRIANGULATE), task 2.4 (REFACTOR), and every later task are not started; their checkboxes remain `- [ ]` (historical: tasks 2.3 and 2.4 have since landed — see the sections below).

## Final closure — task 2.3 TRIANGULATE complete

Task 2.3 is closed: implementation commit `7e4a05016e4552e0440241321da56afe82558f5a` (`fix(frontend): ensure accessible public root foundation`) landed on `feat/frontend-foundation`, and its checkbox in `tasks.md` is now `- [x]`. No push was made and no PR was created.

### Commit identity and line accounting

- Exact commit scope: `frontend/tests/e2e/root.spec.ts` (+378/−0) and `frontend/src/components/shells/PublicShell.tsx` (+4/−1); totals **382 additions + 1 deletion = 383 textual lines**, under the hard 400-line budget.
- Production defect fixed: the dark-scheme `/vacantes` link used `text-primary` with ~2.16:1 contrast; semantic `bg-primary text-primary-foreground` reaches ~6.64:1 light / ~8.35:1 dark without changing preset tokens.

### Failed-verification correction history

1. The first apply attempt timed out and native accounting measured 443 lines because a 69-line progress append was included; the user authorized an audited reset, recovery restored progress to HEAD, and the candidate was compacted to 380 lines.
2. Independent verification then blocked on a test-harness false positive: repeated `test.use({ viewport })` in one scheme-level describe made mobile 375×812 override desktop. Remediation produced genuine RED (two nominal desktop tests failed: expected 1280×720, received 375×812) and GREEN after nested per-cell describes plus exact `page.viewportSize()` assertions.

### Final corrected verification (Node v22.22.1 / Corepack pnpm 10.34.5)

| Gate | Command | Result |
| ---- | ------- | ------ |
| Unit | `corepack pnpm test` | 6 files / 29 tests pass |
| Typecheck | `corepack pnpm typecheck` | pass |
| Lint | `corepack pnpm lint` | pass |
| Build | `corepack pnpm build` (API offline) | pass, Next.js 15.5.25 |
| E2E | production `pnpm start` + focused Playwright suite | 13/13 pass with actual desktop 1280×720 and mobile 375×812 |
| Axe | accessibility suite | 4/4 pass across light/dark × both widths |

- Preset identity: live `pnpm dlx shadcn@latest` decode/resolve/info pass for `b27M1Ev2` — Rhea, Neutral base, Violet theme, Neutral chart, Inter body with inherited Inter heading, Lucide, Default radius, Default/Solid menu, Subtle accent, Base UI `base`, Tailwind v4, `@/*` → `./src/*`, and UI output under `frontend/src/components/ui/`.
- Negative checks pass: no raw/ad hoc colors, custom radius/primitive overrides, charts, employer menus, horizontal overflow, or root API calls (including same-origin `/api`); exact focus on `/vacantes`; correct visible logo dimensions; exactly one h1 and exactly one `/vacantes` link.

### Work units, rollback, and remaining state

- Complete native work units: `task-2.3-triangulate`, `task-2.3-independent-verification` (failed then remediated), `task-2.3-formatting-correction`, and `task-2.3-commit`.
- Rollback boundary: `git revert 7e4a050` removes only the E2E triangulation expansion and the PublicShell contrast fix without touching unrelated work.
- Six formatter-only frontend test diffs remain intentionally unstaged; no push and no PR.
- Task 2.4 (REFACTOR) and every later task remain untouched; their checkboxes are still `- [ ]` (historical: task 2.4 has since been committed — see the section below).

## Task 2.4 REFACTOR — applied and committed (closure objective active)

Objective: remove duplicated navigation markup and non-semantic styling from `frontend/src/app/globals.css`, `frontend/src/components/brand/`, and `frontend/src/components/shells/` while preserving exact preset tokens, Inter roles, Default radius, both schemes, WCAG AA focus/contrast, reduced-motion-safe transitions, and one shared shell for root and future vacancy routes.

### Refactor decision

- Duplicated navigation markup: none found. `PublicShell` is already the single shared shell and `(marketing)/page.tsx` composes it; no nav markup duplication existed in the allowed surfaces, so no churn was manufactured there.
- `PublicShell.tsx`: the container classes `mx-auto w-full max-w-5xl px-4` were repeated three times (header, main, footer). Extracted into one shared `shellContainer` constant so header/main/footer keep a single width/padding rhythm inherited by root and future vacancy routes. No className output changes; behavior-identical.
- `globals.css`: the dark token values appear in both the `.dark` block and the `@media (prefers-color-scheme: dark)` block. This duplication is contractually pinned by the protected, uneditable `globals.css.test.ts` (`cssBlock(".dark")` requires the `.dark` block; the media-query test requires dark values after the media block), so it is NOT a safe refactor target. No other non-semantic styling found; the semantic `bg-primary text-primary-foreground` vacancy link contrast fix from task 2.3 is preserved verbatim.
- `brand/logo.tsx`: already minimal (data-driven marks, `cn()` composition, reserved dimensions); its protected test pins the current shape. Left unchanged.

### TDD Cycle Evidence (task 2.4 REFACTOR)

| Stage | Evidence |
| --- | --- |
| RED/GREEN/TRIANGULATE | Already committed (tasks 2.1–2.3, commits `8467124`, `7e4a050`); REFACTOR preserves committed behavior, no new production behavior introduced |
| REFACTOR | Single deduplication refactor committed at `8ac4932` (`refactor(frontend): stabilize shared shell composition`) with a final committed delta of 9+/5− = 14 lines in `PublicShell.tsx`; all gates rerun GREEN post-refactor |

### Verification (Node v22.22.1 / Corepack pnpm 10.34.5, run from `frontend/`)

| Gate | Command | Result |
| ---- | ------- | ------ |
| Typecheck | `corepack pnpm typecheck` | pass, no diagnostics |
| Lint | `corepack pnpm lint` | pass, no errors/warnings |
| Unit (incl. preset/config assertions) | `corepack pnpm test` | 6 files / 29 tests pass, exit 0 (includes `preset-identity.test.ts` and `globals.css.test.ts` preset/configuration assertions) |
| API-offline build | `corepack pnpm build` (after `rm -rf .next`) | pass, Next.js 15.5.25, 4/4 static pages |
| Root browser E2E | production `pnpm start` + `playwright test tests/e2e/root.spec.ts` | 13/13 pass (incl. live rendered preset triangulation and no-raw-color composition checks) |
| Axe | `corepack pnpm test:a11y` | 4/4 pass (light/dark × desktop/mobile) |
| Server hygiene | `pkill` + curl probe | `next-server` terminated; port 3000 clear, no stale Next server |
| Protected diffs | `sha256sum` of all six files | all six hashes byte-for-byte identical to the handoff values |

### Changed-line accounting (this work unit)

- `frontend/src/components/shells/PublicShell.tsx`: final committed accounting is 9 insertions / 5 deletions = **14 changed lines** (the only authored production delta). The pre-stage on-disk diff measured 7+/3− = 10 lines; staging formatting changed only physical JSX wrapping/collapse and was independently proven semantic-neutral, so the committed 9+/5− = 14 lines is the authoritative final accounting.
- The six protected formatter-only diffs remain unstaged and untouched (98+/54− pre-existing, excluded from this work unit's accounting).
- Total authored delta: **14 committed lines** (9+/5− in `PublicShell.tsx`, the authoritative final accounting), far below the 400-line budget. `apply-progress.md` is administrative evidence, excluded.
- No push or PR was performed and the six formatter-only diffs remain unstaged. The authorized implementation commit `8ac4932` has landed; the prior native work units `task-2.4-refactor`, `task-2.4-independent-verification`, and `task-2.4-commit` are settled complete, while the native `task-2.4-closure` objective is currently active.

### Rollback boundary

With commit `8ac4932` landed, `git revert 8ac4932` removes only this foundation refactor; no other file was touched.

### Remaining tasks

The prior task 2.4 objectives — `task-2.4-refactor`, `task-2.4-independent-verification`, and `task-2.4-commit` — are settled complete, with the implementation commit `8ac4932` landed and the task 2.4 checkbox closed in `tasks.md` as part of this candidate. The native work unit `task-2.4-closure` is currently active and not yet settled. Tasks 3.x and later remain untouched and unchecked.

## Corrective verification note — task 2.4 (administrative evidence correction)

The first independent verification of task 2.4 stopped fail-closed before any runtime gate: two parent-supplied expected SHA-256 baselines arrived malformed/truncated, so protected-hash comparison could not proceed. No repo bytes changed; this was not a candidate defect.

Corrected independent verification (`subtask_gentle-ai-verify_1788445602719_9fd220af`, read-only, Node v22.22.1 / Corepack pnpm 10.34.5) passed all gates: typecheck, lint, 6/6 files and 29/29 unit tests, API-offline Next 15.5.25 build, 13/13 focused root E2E, 4/4 axe, live shadcn decode/resolve/info, diff check, all six exact protected hashes, and no stale server.

### Task 2.4 committed state (closure objective active)

- Implementation commit `8ac49325bdc1ce4e069143256d91a11678918f3f` (`refactor(frontend): stabilize shared shell composition`) landed on `feat/frontend-foundation`, authored by `aldrich_coder45`, touching exactly one path: `frontend/src/components/shells/PublicShell.tsx` at 9 insertions / 5 deletions = 14 committed lines.
- Final accounting correction: the pre-stage on-disk diff read 7+/3− = 10 lines; staging formatting changed only physical JSX wrapping/collapse and was independently proven semantic-neutral, so the committed 9+/5− = 14 lines is the final production accounting.
- Pre-commit verifier `subtask_gentle-ai-verify_1788446246091_b42f6445` confirmed: exact one-file staged scope with protected and OpenSpec files excluded, clean `git diff --cached --check`, and Node v22.22.1 / Corepack pnpm 10.34.5 typecheck, lint, and 29/29 unit tests passing; the prior runtime evidence (13/13 root E2E, 4/4 axe, API-offline build) remains applicable because the refactor is behavior-identical.
- Prior native work units `task-2.4-refactor`, `task-2.4-independent-verification`, and `task-2.4-commit` are settled complete. The current native work unit `task-2.4-closure` is active (not yet settled). The task 2.4 checkbox is `- [x]` (5 checked / 17 unchecked) in `tasks.md` as part of this candidate.
- The six formatter-only frontend test diffs (98+/54−) remain intentionally unstaged and byte-for-byte preserved; no push was made, no PR was created, and no task 3 work has started.
- Post-reset remediation note: the user authorized an audited reset of only `task-2.4-closure` at prior status revision `sha256:7d303ee4245cbadc7b583a1b21250b634ea6225d21de1cee957a0a5f9416a49a`. Attempt 1 found and corrected real stale/premature wording; attempt 2 passed all candidate content/scope checks but failed solely because the parent omitted the six known expected hashes from the verifier prompt — not a candidate defect.
- The audited reset preserved this staged corrected candidate, and the `task-2.4-closure` authority remains active/not settled until post-commit settlement. This note is evidence bookkeeping only and does not claim the closure objective is complete.

## Task 3.1 RED — contract tests added (verification remediation, attempt 2)

- Work unit: `task-3.1-red`, tests-only strict-TDD RED; remediation attempt 2 of 2 bound to the failed independent verification evidence `sha256:11367d79261b1abb5e68f13ee0568326e858cbfcce3e7a74e41085090d699372`; HEAD `ababed8` on `feat/frontend-foundation`. No checkbox changed and nothing staged, committed, or pushed. This section replaces the prior candidate claims (350-line revision whose seven verification defects are corrected below).
- Six new test files, **377 formatter-stable lines total** (53 `src/lib/env/server.test.ts`, 78 `src/lib/api/transport.test.ts`, 82 `src/features/jobs/schemas.test.ts`, 58 `src/features/jobs/formatters.test.ts`, 71 `src/features/jobs/url.test.ts`, 35 `src/features/jobs/jobId.test.ts`); with this 11-line section the candidate is 388 lines, inside the 400-line hard budget.
- Corrections vs the failed verification: (1) `transport.test.ts` pins an explicit `notFoundStatus` request option as the only not-found discriminator — a bare list 404 and any other unexpected 4xx classify as non-retryable `{kind:"status"}`, detail 404 with `notFoundStatus:404` classifies `{kind:"not_found"}`, and a 400 under the option stays a status error; (2) `schemas.test.ts` positively parses every `onsite|remote|hybrid`, `full_time|part_time|contract|internship`, `intern|junior|mid|senior|lead`, and `MXN|USD` value, rejects null salary bounds, and proves unknown keys (`status`, `updated_at`, `company.logo_url`, `company.verified`) are stripped from the nested company as well as the job item; (3) `url.test.ts` exercises add, change, and clear for each of the six filters while a cursor exists, proving every commit omits the cursor, additions/changes keep the new value, clears omit the key, and the other five filters persist; (4) `buildNextJobsUrl` preserves all six active filters (exact uppercase `USD`) plus the opaque cursor byte-for-byte through `URLSearchParams` decoding with a stable canonical round trip; (5) `formatters.test.ts` adds UTC-boundary-crossing offsets (`2026-01-15T23:30:00-06:00` → "16 de enero de 2026", `2026-01-15T02:30:00+05:00` → "14 de enero de 2026") proving `timeZone:"UTC"` changes the rendered date; (6) `server.test.ts` symmetrically covers both `PEOPLEFLOW_API_BASE_URL` and `PEOPLEFLOW_SITE_URL` for production HTTPS, loopback-only HTTP, credentials/query/fragment/origin-path rejection, and non-HTTP schemes, preserving the timeout tests/default and the static `server-only` guard; (7) this section itself was rewritten to match the corrected tests exactly.
- Contract-implied production API for task 3.2: unchanged from the prior documentation except `requestJson` options gain `notFoundStatus?: number` (the detail-only not-found discriminator; without it no 404 is special-cased): `src/lib/env/validate.ts` (`validateServerEnv`, `DEFAULT_API_TIMEOUT_MS`) guarded by `src/lib/env/server.ts` (`import "server-only"` re-export); `src/lib/api/requestJson.ts` (`requestJson` → `{ok:true,data}` / `{ok:false,error:{kind:"timeout"|"network"|"status"|"not_found"|"invalid_response",retryable,status?}}`); `src/features/jobs/{schemas,formatters,url,jobId,api/getJob}` with `jobItemSchema`/`jobsListSchema`, `workModeLabel`/`employmentTypeLabel`/`seniorityLabel`/`formatPublishedDate`/`formatSalary`, `parseJobsQuery`/`buildJobsUrl`/`isCanonicalJobsQuery`/`buildFilterCommitUrl`/`buildNextJobsUrl`, `isValidJobId`, `getJob`. Wire enums (`onsite|remote|hybrid`, `full_time|part_time|contract|internship`, `intern|junior|mid|senior|lead`, `MXN|USD`); es-MX expectations pinned against Node 22.22.1 ICU output ("15 de enero de 2026", "MXN 25,000", "USD 3,000").
- RED evidence (Node `v22.22.1`, pnpm `10.34.5`, from `frontend/`): `corepack pnpm exec vitest run src/lib/env/server.test.ts src/lib/api/transport.test.ts src/features/jobs/schemas.test.ts src/features/jobs/formatters.test.ts src/features/jobs/url.test.ts src/features/jobs/jobId.test.ts` → **6 files failed, 0 tests run**; every failure is exactly `Failed to resolve import "./validate" | "./requestJson" | "./schemas" | "./formatters" | "./url" | "./api/getJob"` — genuine missing task-3.2 production modules, not malformed tests.
- Type-structural soundness proof: the six final test files were copied to a throwaway `/tmp/t31-typecheck` mirror with stub `.d.ts` declarations of the seven future modules (including the new `notFoundStatus` option) and typechecked with the frontend's own `tsc` under the frontend strict tsconfig settings (`dom`, `dom.iterable`, `esnext`) → exit 0 (mirror removed afterwards; zero repo changes from this check).
- Hygiene: `git diff --check` clean; the six protected formatter-only test diffs remain unstaged and byte-for-byte identical before/after (all six SHA-256 values match the handoff baselines); no production/config/backend/lockfile/fixture/helper file changed; the task 3.1 checkbox remains `- [ ]`; no stale servers or leftover processes; throwaway `/tmp` verification trees removed.
- Rollback boundary: delete the six new `*.test.ts` files (paths above); no other byte of the repository was touched by this work unit.

## Final closure — task 3.1 RED complete

Task 3.1 is closed: implementation commit `e35a82beeff22f1da5615e6c4a6c47a70d635535` (`test(frontend): specify public job discovery contracts`) landed on `feat/frontend-foundation`, and its checkbox in `tasks.md` is now `- [x]`. No push was made and no PR was created.

### Commit identity and line accounting

- Exact commit scope: the six Task 3.1 RED test files (`src/lib/env/server.test.ts` 53, `src/lib/api/transport.test.ts` 78, `src/features/jobs/schemas.test.ts` 82, `src/features/jobs/formatters.test.ts` 58, `src/features/jobs/url.test.ts` 71, `src/features/jobs/jobId.test.ts` 35) plus the existing 11-line Task 3.1 apply-progress section — **7 paths, 388 insertions, 0 deletions** (verified via `git show --numstat`), inside the hard 400-line budget.

### Independent RED verification and post-commit hygiene

- Independently settled RED verification under Node `v22.22.1` with explicitly selected Corepack pnpm `10.34.5`: the focused Vitest run produced **6 failed files / 0 tests run**, solely because the seven future Task 3.2 modules (`validate`, `requestJson`, `schemas`, `formatters`, `url`, `api/getJob`, and the server env guard) were absent — genuine missing production modules, not malformed tests. TypeScript parser/virtual-module structure checks, the contract audit, protected hashes, scope checks, process cleanup, and diff checks all passed.
- Post-commit formatter cleanup work unit `task-3.1-post-commit-formatter-cleanup` completed at native generation 33 (status revision `sha256:3d978c15b040ca0c103261689396fc04f0c15a0d9458dfd210b0b6dbb6ccd94c`, evidence `sha256:ddb266ba49f05c7db3d80e69b0cbf724052d1d2e62c8c3d1da2dc32c8ea8d222`). Exactly four post-commit formatter-only Task 3.1 diffs were restored to HEAD, and all six Task 3.1 test files are now clean against HEAD.
- Working-tree state at closure: exactly the six protected pre-existing formatter-only diffs remain unstaged and excluded (98+/54−); the index is empty; there are no untracked files; and no production, backend, config, package, or lockfile change exists.

### Rollback boundary and remaining state

- Rollback: `git revert e35a82b` removes only the six contract-test files and this progress section without touching unrelated work.
- Task state after this closure: Task 3.1 is complete (6/22 checkboxes closed); Task 3.2 (GREEN) remains not started, and every later task is untouched. No push and no PR.

## Artifact-only reconciliation — TanStack Query state ownership (maintainer decision, native work unit `task-3.2-api-state-reconciliation`)

> **Historical/superseded (maintainer-authorized reset):** the reconciliation objective below was reset before settlement after its final verifier failed (evidence `sha256:034c73ea90268fd652934c83e978ae28d6a8b0f65f37d2efc74668bb2891e219`, reset revision `sha256:1e511f4163e0569f152e7c395eadab59060c324ff2be3bb235f9d033053e6c85`). It is retained verbatim as history, not as a current claim; see the `task-3.2-api-state-reconciliation-correction` section at the end of this file for the current state and authoritative changed-line accounting.

This section documents a **documentation-only OpenSpec artifact reconciliation**, not implementation. It was corrected once (the one allowed gatekeeper rerun, bound to failed evidence `sha256:11d245550fde9e53b0b16570e3a77269fe22ee6bf4d61b6d042a6ad57f8ae470`) to remove internally non-executable hydration wording: this slice keeps TanStack Query orchestration **server-side only** with a fresh request-scoped `QueryClient` and no `QueryClientProvider`/`HydrationBoundary`/client cache. The later authoritative maintainer decision is now recorded in the design/tasks wording:

1. TanStack Query orchestrates every application-facing API request server-side: SSR-first list/detail reads execute feature-owned `queryOptions` through `fetchQuery` on a fresh request-scoped server `QueryClient`; no client query cache is hydrated.
2. A fresh server `QueryClient` is created per request/render boundary; never a module-global or cross-request shared client.
3. `requestJson` remains the low-level server-only transport beneath that orchestration.
4. Zod validates every network boundary.
5. URL parameters are authoritative for discovery filters and cursors, and URL navigation triggers a new server render with a fresh request-scoped query client.
6. Zustand is reserved only for demonstrated client-local cross-component state that the URL or TanStack Query cannot own; it is not added now.
7. SSR-first rendering, no browser-direct API access, no Next proxy, and `cache: "no-store"` freshness are preserved.

### Reconciled artifacts (exact scope)

- `design.md`: D2 rewritten (TanStack Query is the single server-side orchestration layer executed through a fresh request-scoped server `QueryClient`; the stale rejection is explicitly superseded; no client cache is hydrated), D3 reworded (`requestJson` beneath TanStack Query), D5 rationale records the Zustand reservation; §3.1 package policy adds `@tanstack/react-query` and forbids Zustand; §4 topology comment plus a new server-side orchestration paragraph (fresh request-scoped server `QueryClient`, `fetchQuery`, explicitly no `QueryClientProvider`/`HydrationBoundary`/dehydrated state/client cache); §5.2 retitled "Server-only transport beneath TanStack Query" with the request-scoped `fetchQuery` boundary and the `queryFn`-only-caller rule over `requestJson` with Zod decoding; §6.2 list sequence and §6.4 detail participant updated to show server-side `fetchQuery` orchestration through the request-scoped `QueryClient` with unchanged `no-store` freshness and no hydration payload; §6.3 and §7.3 island paragraphs now state job data is read solely server-side through the request-scoped TanStack Query `QueryClient` with no Zustand store and no client query cache; §10.1 adds an orchestration-boundary test bullet; §13 adds a bypass/Zustand risk row.
- `tasks.md`: a new "State ownership reconciliation" section records the decision as binding (server-side `fetchQuery` on a fresh request-scoped server `QueryClient`; no `QueryClientProvider`, `HydrationBoundary`, dehydrated state, or client query cache); task 3.2 (GREEN) wording now requires TanStack Query `queryOptions`/`queryFn` over `requestJson`, Zod boundary decoding, `no-store`, and forbids Zustand/browser-direct/proxy; tasks 3.3, 3.4, 4.2, 4.4, and 5.2 carry the matching server-side wording (4.2 and 5.2 explicitly on the fresh request-scoped server `QueryClient` with no client query cache). **No checkbox was changed.**
- `specs/public-job-discovery/spec.md` was inspected and is implementation-neutral; it was **not** touched.

### Explicit scope statement

- This is **artifact-only** work; no implementation was performed.
- Task 3.2 remains `- [ ]` and **not started**; no production code, test, config, package manifest, or lockfile byte was changed, and no dependency was added or installed.
- No files were staged, committed, pushed, or opened as a PR; branch remains `feat/frontend-foundation` at expected HEAD `e9b4bc12a4bc296656c06dcc5bf9308d9d91613a`.
- The six protected formatter-only diffs remained excluded and untouched; all six SHA-256 hashes were verified byte-identical to the handoff baselines before and after the edits.
- Historical evidence above is preserved verbatim; this section only appends.

### Reconciliation checks

| Check | Exact command | Result |
| --- | --- | --- |
| Branch / HEAD | `git branch --show-current` / `git rev-parse HEAD` | `feat/frontend-foundation` / `e9b4bc12a4bc296656c06dcc5bf9308d9d91613a` |
| Protected hashes (before and after) | `sha256sum` of the six protected paths | all six match the handoff baselines exactly |
| Working-tree scope | `git status --porcelain` | only the six pre-existing protected modifications plus the three edited OpenSpec artifact files |
| Checkbox invariants | `grep -c '^- \[[xX]\]' tasks.md` / `grep -c '^- \[ \]' tasks.md` | 6 checked / 16 unchecked (unchanged) |
| Changed-line count | `git diff --numstat` over the three artifacts | see below |

### Changed-line accounting

`git diff --numstat` for the full uncommitted reconciliation candidate, including this corrective rerun (design.md + tasks.md + apply-progress.md): **89 insertions, 20 deletions = 109 changed lines** (apply-progress.md 44+/0−, design.md 24+/14−, tasks.md 21+/6−), within the 400-line hard budget. The gatekeeper correction removed all internally non-executable `QueryClientProvider`/`HydrationBoundary`/dehydrate/client-cache claims in favor of server-side `fetchQuery` orchestration on a fresh request-scoped server `QueryClient`, and replaced the incorrectly escaped checkbox commands with executable forms. No other path changed; nothing staged; no checkbox changed.

### Rollback boundary

Revert the three OpenSpec artifact files only (`design.md`, `tasks.md`, `apply-progress.md`) to their pre-reconciliation blobs; no repository byte outside `openspec/changes/frontend-public-job-discovery/` was touched.

## Maintainer-authorized reset and correction — TanStack Query state reconciliation (work unit `task-3.2-api-state-reconciliation-correction`)

A maintainer explicitly authorized resetting only the prior blocked `task-3.2-api-state-reconciliation` reconciliation objective (artifact-only; no implementation). Fresh acquire returned `proceed` for this correction objective with a hard 400-line changed-line budget. This correction is documentation-only: no production code, test, config, package, or lockfile byte was changed, no dependency was added or installed, and no checkbox in `tasks.md` was touched.

- Failed evidence being remediated: the prior objective's final verifier failed with evidence `sha256:034c73ea90268fd652934c83e978ae28d6a8b0f65f37d2efc74668bb2891e219`; the exact reset revision was `sha256:1e511f4163e0569f152e7c395eadab59060c324ff2be3bb235f9d033053e6c85`. The parent owns settlement; a passing settlement remediates that failed evidence.
- Defect 1 corrected — `design.md` §6.4 detail sequence no longer bypasses request-scoped TanStack Query orchestration. It now mirrors the coherent list boundary of §6.2: detail route/metadata → fresh request-scoped server `QueryClient` `fetchQuery` → feature-owned server-only `queryFn` → `requestJson` → Go API, with validated results and typed errors returning through the QueryClient to the route. The UUID short-circuit, detail 404 → `notFound()` mapping, Zod validation, request-scoped dedupe, direct server rendering, and `cache: "no-store"` freshness are all preserved.
- Defect 2 corrected — the trailing whitespace added at `design.md` line 239 was removed; `git diff --check` now passes with exit 0.
- Historical labeling: the reconciliation section above is preserved verbatim as history. Its pre-correction statements (the §6.4 participant description and the 109-line accounting) are superseded, not deleted; this section records the current claim.
- Task state: Task 3.2 remains `- [ ]` and not started; no checkbox changed and no implementation was performed. No files were staged, committed, pushed, or opened as a PR.

### Correction checks

| Check | Exact command | Result |
| --- | --- | --- |
| Branch / HEAD | `git branch --show-current` / `git rev-parse HEAD` | `feat/frontend-foundation` / `e9b4bc12a4bc296656c06dcc5bf9308d9d91613a` (unchanged) |
| Protected hashes (before and after) | `sha256sum` of the six protected paths | all six match the handoff baselines exactly |
| Whitespace gate | `git diff --check` | exit 0, no whitespace errors |
| Checkbox invariants | `grep -c '^- \[[xX]\]' tasks.md` / `grep -c '^- \[ \]' tasks.md` | unchanged at 6 checked / 16 unchecked |
| Changed-line accounting | `git diff --numstat` over `design.md`, `apply-progress.md`, `tasks.md` | see below |

### Correction changed-line accounting

`git diff --numstat` for the full uncommitted candidate after this correction: **129 insertions, 25 deletions = 154 changed lines** (apply-progress.md 74+/0−, design.md 34+/19−, tasks.md 21+/6−). The correction itself contributed 45 changed lines on top of the preserved prior candidate: design.md +10/−5 for the §6.4 rework and apply-progress.md +30 for the superseded banner and this section. The total stays well inside the hard 400-line budget. `apply-progress.md` is administrative evidence, excluded from frontend source-budget accounting.

### Correction rollback boundary

Revert the two corrected artifacts (`design.md`, `apply-progress.md`) to their pre-correction blobs, or revert all three OpenSpec artifacts to HEAD to remove the reconciliation candidate entirely; no repository byte outside `openspec/changes/frontend-public-job-discovery/` was touched by this correction.

## Bounded strict-TDD GREEN sub-unit — server env validation (work unit `task-3.2-green-server-env`, Task 3.2 remains `[ ]`)

First bounded GREEN sub-unit of Task 3.2 only: `frontend/src/lib/env/validate.ts` (new, 84 lines after final repository formatting) and `frontend/src/lib/env/server.ts` (new, 7 lines). No test, task, package, lockfile, config, backend, or shared-root byte was edited; nothing staged, committed, pushed, or opened as a PR; Task 3.2 stays unchecked because `requestJson`, jobs schemas/api/url/formatters, and TanStack Query query functions remain for later sub-units.

### TDD cycle evidence

| Cycle | Evidence |
| --- | --- |
| RED (pre-edit, committed by parent) | `corepack pnpm@10.34.5 exec vitest run src/lib/env/server.test.ts src/lib/api/transport.test.ts src/features/jobs/schemas.test.ts src/features/jobs/formatters.test.ts src/features/jobs/url.test.ts src/features/jobs/jobId.test.ts` from `frontend/`: exit 1; 6 failed test files; failures were only unresolved intentionally absent Task 3.2 modules (`./validate`, `./requestJson`, `./schemas`, `./formatters`, `./url`, `./api/getJob`). Node v22.22.1, pnpm 10.34.5. |
| RED-equivalent (correction rerun) | Before correcting, `node --experimental-strip-types` probes against the prior uncommitted `validate.ts` (Node v22.22.1) demonstrated the gatekeeper defects live: raw origins returned un-normalized (`HTTP://127.0.0.1:8080/` accepted as-is), `https://host?` and `https://host#` accepted (empty query/fragment delimiters), and timeout strings `1e3` and ` 15000 ` accepted. |
| GREEN | Implemented `validate.ts` (`DEFAULT_API_TIMEOUT_MS = 8000`; `validateServerEnv`; required `PEOPLEFLOW_API_BASE_URL`/`PEOPLEFLOW_SITE_URL`; absolute, pathless, credential-free http(s) origins rejecting any `?`/`#` delimiter including the empty form; production HTTPS; dev/test HTTP only for `127.0.0.1`/`localhost`/`::1` with IPv6 bracket normalization; timeout accepting only integer numbers or digit-only strings in 1000–30000 inclusive with default 8000; returns the normalized WHATWG origin via `url.origin`) and `server.ts` (guarded by exact `import "server-only"`, exporting the validated `process.env` result and re-exporting the validate API). Both new files were also reindented from a spurious global 4-space offset to the project's standard 2-space style; no behavioral change. |
| GREEN result | `corepack pnpm@10.34.5 exec vitest run src/lib/env/server.test.ts` from `frontend/` → exit 0; Test Files 1 passed (1); Tests 5 passed (5). |
| TRIANGULATE | Reran the exact committed six-file RED command from `frontend/`: Test Files 5 failed / 1 passed (6); Tests 5 passed (5). Failures are exclusively unresolved-import RED on intentionally absent future modules: `./requestJson` (`transport.test.ts`), `./schemas`, `./formatters`, `./url` (`url.test.ts`), `./api/getJob` (`jobId.test.ts`). |
| REFACTOR | Post-correction reruns of the focused suite, focused lint, and the behavior probes stayed green; indentation normalization produced no behavioral change. |

### Gatekeeper correction rerun (evidence hash `sha256:5faf6fdc322f038fa974f7cf2847d3562ab2b9bbe6e1654a9975f200a03ba407`)

The previous evidence failed six gatekeeper checks; all are corrected in this rerun under fresh native authority `proceed`:

1. Markdown cleanliness: the former checkbox-invariants row embedded unescaped pipe characters inside inline code within a table cell, producing a real MD056 (table column count) warning near line 576. The row was rewritten pipe-free and this appended section now has consistent table column counts. Every pre-unit byte through the old file ending is preserved — the file was restored byte-identical to its HEAD blob before re-appending only this section.
2. `parseOrigin` returns the normalized WHATWG origin (`url.origin`) instead of the trimmed raw text, so casing, default ports (`:443`/`:80`), and a lone trailing slash normalize while valid non-default ports are preserved.
3. Query or fragment delimiters are rejected even when empty (`https://host?`, `https://host#`) by inspecting the trimmed input for `?`/`#` in addition to `url.pathname`; credentials, path, and scheme rules are unchanged and exact.
4. Timeout parsing accepts only `number` integers or digit-only (`/^\d+$/`) environment strings; scientific notation (`1e3`), whitespace-padded strings, objects, booleans, empty strings, non-integers, and out-of-range values are all rejected; 1000–30000 inclusive and the 8000 default are preserved.
5. Changed-line accounting below now includes the `apply-progress.md` diff in the hard 400-line candidate total; production/authored source is stated separately.
6. The rollback boundary below includes reverting this appended progress section while preserving all earlier history.

### Verification commands and exact results

| Check | Exact command | Result |
| --- | --- | --- |
| Focused GREEN | `corepack pnpm@10.34.5 exec vitest run src/lib/env/server.test.ts` (from `frontend/`, Node v22.22.1) | exit 0; Tests 5 passed (5) |
| Six-file triangulation | the committed RED command above | Test Files 5 failed / 1 passed (6); Tests 5 passed (5); failures only on intentionally absent future modules |
| Behavior probes | `node --experimental-strip-types` probe script importing `./src/lib/env/validate.ts` (Node v22.22.1) | pre-fix: raw origin returned, `https://host?`/`https://host#` accepted, `1e3`/` 15000 ` accepted; post-fix: normalized origins returned and every probe case rejected as required |
| Focused lint | `corepack pnpm@10.34.5 exec eslint src/lib/env/validate.ts src/lib/env/server.ts` | 0 errors, 0 warnings |
| Typecheck (attribution only) | `corepack pnpm@10.34.5 exec tsc --noEmit` (from `frontend/`) | errors are exclusively `TS2307 Cannot find module` for the intentionally absent future modules inside committed contract tests (`./requestJson`, `./schemas`, `./formatters`, `./url`, `./api/getJob`, `./jobId`); zero errors attributed to `server.ts` or `validate.ts` |
| Runtime / browser verification | N/A | This environment-only unit introduces no application-facing request, route, or browser surface; browser runtime remains N/A until route composition exists. |
| Markdown diagnostics | `markdownlint` is not installed in this repo; manual structural check of the appended section | no unescaped pipes inside cells; consistent column counts; no MD056 |
| Whitespace gate | `git diff --check` | exit 0 |
| Scope | `git status --porcelain` | exactly the six protected pre-existing modifications plus untracked `frontend/src/lib/env/server.ts` and `frontend/src/lib/env/validate.ts` and the modified `apply-progress.md`; nothing else |
| Index | `git diff --cached --stat` | empty |
| Protected hashes | `sha256sum` of the six protected paths | all six byte-identical to the handoff baselines |
| Checkbox invariants | grep counts of checked and unchecked task rows in `tasks.md` (patterns for `- [x]` and `- [ ]`) | 6 checked / 16 unchecked (Task 3.2 intentionally unchecked) |

### Changed-line accounting

Hard 400-line candidate total includes production source AND this `apply-progress.md` diff: authored source `validate.ts` 84 lines after final repository formatting + `server.ts` 7 lines = 91 lines, plus the `apply-progress.md` appended-section diff of 51 added lines, for a total of 142 lines — inside the hard 400-line budget. Deletions from the six protected pre-existing formatter-only modifications are not part of this unit's authored candidate and remain untouched.

### Rollback boundary

Delete the two new files `frontend/src/lib/env/validate.ts` and `frontend/src/lib/env/server.ts` AND revert `apply-progress.md` to its HEAD blob (removing only this appended `task-3.2-green-server-env` section while preserving all earlier history); this removes only the env-validation GREEN sub-unit and returns the six-file suite to its committed RED state without touching any other byte.

## Bounded strict-TDD GREEN sub-unit — generic JSON transport (work unit `task-3.2-green-request-json`, Task 3.2 remains `[ ]`)

Second bounded GREEN sub-unit of Task 3.2 only: `frontend/src/lib/api/requestJson.ts` (new, 72 lines) and `frontend/src/lib/api/server.ts` (new, 4 lines, guarded by exact `import "server-only"` and re-exporting the core). The generic transport stays directly testable in `requestJson.ts`; the production import boundary is the guarded `server.ts` entry. No test, task, package, lockfile, Vitest configuration, backend, shared-root, route, or application-facing request/query orchestration byte was touched; nothing staged, committed, pushed, or opened as a PR. No TanStack Query, Zod, or Zustand was added. Task 3.2 stays unchecked because jobs schemas/api/url/formatters, TanStack Query query functions, and QueryClient composition remain for later sub-units; the API-state reconciliation remains authoritative.

### Implemented behavior (matches the committed contract test exactly)

Native `fetch` with `cache: "no-store"` and a single `accept: application/json` header (no cookies, authorization, referer, or arbitrary headers are forwarded); `AbortController` timeout defaulting to `DEFAULT_API_TIMEOUT_MS` imported from the pure `src/lib/env/validate.ts` module (never the guarded `process.env` entry) with reliable timer cleanup in a `finally` block; a `timedOut` flag distinguishes the transport's own timeout from any external abort; feature-provided decoder callback; typed discriminated success/error results; timeout and network classifications (both retryable); `429` and `5xx` as retryable status errors; every other non-2xx as non-retryable status; exact `notFoundStatus` equality as the sole not-found discriminator; invalid JSON and decoder/schema failures as non-retryable `invalid_response`; returned errors carry only kind/retryable/status fields — no response bodies, decoder details, URLs, query text, location, cursor, stack traces, or sensitive values. No logging exists in this unit (no logging is preferred and acceptable per the unit contract).

### TDD cycle evidence

| Cycle | Evidence |
| --- | --- |
| RED (pre-edit, committed by parent and independently rerun) | `corepack pnpm@10.34.5 exec vitest run src/lib/env/server.test.ts src/lib/api/transport.test.ts src/features/jobs/schemas.test.ts src/features/jobs/formatters.test.ts src/features/jobs/url.test.ts src/features/jobs/jobId.test.ts` from `frontend/`: exit 1; Test Files 5 failed / 1 passed (6); Tests 5 passed (5). The only failure mode was `Failed to resolve import "./requestJson"` in `transport.test.ts` plus the equally absent `./schemas`, `./formatters`, `./url`, and `./api/getJob`; the environment suite was GREEN. Node v22.22.1, pnpm 10.34.5. |
| GREEN | Implemented `requestJson.ts` (typed `RequestJsonError`/`RequestJsonResult`/`RequestJsonOptions` discriminated unions; `AbortController` with `timedOut` flag and `finally`-cleared timer; `cache: "no-store"`; single `accept` header; retryable `429`/`>=500`; exact `notFoundStatus` equality; `invalid_response` for both JSON parse and decoder failures) and the guarded `server.ts` entry (`import "server-only"` plus core re-exports). |
| GREEN result | `corepack pnpm@10.34.5 exec vitest run src/lib/api/transport.test.ts` from `frontend/` → exit 0; Test Files 1 passed (1); Tests 6 passed (6). |
| TRIANGULATE | Reran the exact committed six-file command from `frontend/`: Test Files 4 failed / 2 passed (6); Tests 11 passed (11). GREEN suites exactly `src/lib/api/transport.test.ts` (6) and `src/lib/env/server.test.ts` (5); the four RED suites fail exclusively on unresolved-import RED for intentionally absent future modules `./formatters`, `./api/getJob` (and `./jobId`), `./schemas`, and `./url`. |
| REFACTOR | No refactor was needed: the implementation is a single minimal function in project-standard 2-space style with discriminated unions, and the post-implementation rerun of the focused two-suite command (`transport.test.ts` + `server.test.ts`) stayed at 11 passed (11); focused lint stayed at 0 problems. |

### Verification commands and exact results

| Check | Exact command | Result |
| --- | --- | --- |
| Focused GREEN | `corepack pnpm@10.34.5 exec vitest run src/lib/api/transport.test.ts` (from `frontend/`, Node v22.22.1) | exit 0; Test Files 1 passed (1); Tests 6 passed (6) |
| Six-file triangulation | the committed RED command above | Test Files 4 failed / 2 passed (6); Tests 11 passed (11); RED only on intentionally absent future modules |
| Post-refactor focused rerun | `corepack pnpm@10.34.5 exec vitest run src/lib/api/transport.test.ts src/lib/env/server.test.ts` | exit 0; Test Files 2 passed (2); Tests 11 passed (11) |
| Focused lint | `corepack pnpm@10.34.5 exec eslint src/lib/api/requestJson.ts src/lib/api/server.ts` | exit 0; 0 errors, 0 warnings |
| Typecheck (attribution only) | `corepack pnpm@10.34.5 exec tsc --noEmit` (from `frontend/`) | exit 2; errors are exclusively `TS2307 Cannot find module` for the intentionally absent future modules inside committed contract tests (`./formatters`, `./api/getJob`, `./jobId`, `./schemas`, `./url`); zero errors attributed to `requestJson.ts` or `server.ts` (the `server-only` side-effect import resolves the same way it already does for `lib/env/server.ts`) |
| Whitespace gate | `git diff --check` | exit 0 |
| Scope | `git status --porcelain` | exactly the six protected pre-existing modifications, untracked `frontend/src/lib/api/requestJson.ts` and `frontend/src/lib/api/server.ts`, and the modified `apply-progress.md`; nothing else |
| Index | `git diff --cached --stat` | empty |
| Protected hashes | `sha256sum` of the six protected paths | all six byte-identical to the handoff baselines (`3b22e706…`, `75782ef6…`, `1fef9572…`, `d3a8ccc8…`, `18206dc2…`, `38ed1543…`) |
| Checkbox invariants | grep counts of `- [x]` and `- [ ]` rows in `tasks.md` | 6 checked / 16 unchecked (Task 3.1 stays checked, Task 3.2 stays unchecked, totals 6/22) |
| Runtime / browser verification | N/A | This unit introduces no application-facing request, route, or browser surface; the transport is server-only and not yet called by any query function or route, so browser runtime remains N/A until route composition exists. |

### Changed-line accounting

Inclusive hard 400-line accounting over the three authorized surfaces (`requestJson.ts`, `server.ts`, and this `apply-progress.md` diff): authored production source `requestJson.ts` 72 lines + `server.ts` 4 lines = 76 added lines, plus the `apply-progress.md` appended-section diff of 42 added lines = 118 changed lines total (0 deletions) — inside the hard 400-line budget. Deletions in the six protected pre-existing formatter-only modifications are not part of this unit's candidate and were never touched.

### Rollback boundary

Delete the two new files `frontend/src/lib/api/requestJson.ts` and `frontend/src/lib/api/server.ts` AND revert `apply-progress.md` to its pre-unit blob (SHA-256 `222e68b3ec6c9759f0be35da063a2f51e880fef39f8a6f13ac82a8aa456dae5b`, 603 lines), which removes only this appended `task-3.2-green-request-json` section while preserving all earlier history; the six-file suite returns to its committed RED state and no other byte is touched. `requestJson.ts` depends only on the already-landed `../env/validate` module, so no prior sub-unit is affected.

## Correction rerun — transport-owned body-timeout classification (work unit `task-3.2-green-request-json`, single gatekeeper corrective rerun)

This appended section is the authorized single corrective rerun under fresh native authority `proceed`. It supersedes only the two stale claims identified below; all earlier history above, including the complete first-attempt evidence sections, remains immutable.

### Independent verification failures corrected

1. Transport-owned timeout during body consumption (production correction in `requestJson.ts`): a timeout firing after response headers were received but while `response.json()` was still consuming the body was caught by the nested JSON catch and returned as non-retryable `invalid_response`. The JSON catch now checks the existing `timedOut` flag and returns `{ kind: "timeout", retryable: true }` whenever the transport-owned timeout fired at any point across the complete request/body-consumption lifecycle; genuine invalid JSON remains `{ kind: "invalid_response", retryable: false }`. The `finally`-cleared timer cleanup is unchanged and reliable.
2. Stale typecheck exit-code claim (superseded): the previously appended section claimed `corepack pnpm@10.34.5 exec tsc --noEmit` exited 2. Fresh reruns observed the reproducible exit code 1 (six consecutive runs from `frontend/` plus a direct `node_modules/.bin/tsc --noEmit` invocation, all with byte-identical stdout); one first-invocation transient exit 2 was observed a single time and could not be reproduced. The authoritative reproducible result is exit 1, which explicitly supersedes the stale exit-2 claim.

### TDD evidence (RED-equivalent → GREEN via probes, committed tests untouched)

Committed tests could not be edited, so the semantic gap beyond `transport.test.ts` was demonstrated with `node --experimental-strip-types` probes (Node v22.22.1) over the real module, copied with only the relative import specifier rewritten for ESM resolution (behavior identical):

| Cycle | Evidence |
| --- | --- |
| RED-equivalent (pre-correction probe) | Body-consumption timeout scenario returned `{"ok":false,"error":{"kind":"invalid_response","retryable":false}}` — the reported defect reproduced live. Regression guards already correct: genuine invalid JSON → `invalid_response`, headers-phase timeout → `timeout`. |
| GREEN (production correction) | `requestJson.ts` JSON catch now returns retryable `timeout` when the `timedOut` flag is set, with a comment documenting the lifecycle invariant; no other behavior changed. |
| GREEN-equivalent (post-correction probe) | Same probe: body-consumption timeout → `{"ok":false,"error":{"kind":"timeout","retryable":true}}`; genuine invalid JSON → `invalid_response` (retryable false); headers-phase timeout → `timeout`. No committed behavior regressed. |

### Verification commands and exact results

| Check | Exact command | Result |
| --- | --- | --- |
| Focused GREEN | `corepack pnpm@10.34.5 exec vitest run src/lib/api/transport.test.ts` (from `frontend/`, Node v22.22.1, pnpm 10.34.5) | exit 0; Test Files 1 passed (1); Tests 6 passed (6) |
| Six-file triangulation | the committed RED command above | exit 1; Test Files 4 failed / 2 passed (6); Tests 11 passed (11); GREEN suites exactly `src/lib/api/transport.test.ts` (6) and `src/lib/env/server.test.ts` (5); the four RED suites fail exclusively on unresolved-import RED for intentionally absent future modules (`./formatters`, `./api/getJob` with `./jobId`, `./schemas`, `./url`) |
| Focused lint | `corepack pnpm@10.34.5 exec eslint src/lib/api/requestJson.ts src/lib/api/server.ts` | exit 0; 0 errors, 0 warnings |
| Typecheck (exact exit code + attribution) | `corepack pnpm@10.34.5 exec tsc --noEmit` (from `frontend/`) | reproducible exit 1 (six consecutive runs plus one direct `node_modules/.bin/tsc --noEmit` run, byte-identical stdout); errors are exclusively `TS2307 Cannot find module` for the intentionally absent future modules inside committed RED test files (`./formatters`, `./api/getJob`, `./jobId`, `./schemas`, `./url`); zero errors attributed to `requestJson.ts` or `server.ts`. This explicitly supersedes the stale exit-2 claim; the one transient exit-2 observation is recorded only for transparency and is not reproducible. |
| Behavior probes | `node --experimental-strip-types probe.ts` (Node v22.22.1) | pre-fix: body-consumption timeout misclassified as `invalid_response`; post-fix: body-consumption timeout → retryable `timeout`, genuine invalid JSON → `invalid_response`, headers-phase timeout → `timeout` |
| Whitespace gate | `git diff --check` | exit 0 |
| Scope | `git status --porcelain` | exactly the six protected pre-existing modifications, untracked `frontend/src/lib/api/requestJson.ts` and `frontend/src/lib/api/server.ts`, and the modified `apply-progress.md`; nothing else |
| Index | `git diff --cached --stat` | empty |
| Protected hashes | `sha256sum` of the six protected paths | all six byte-identical to the handoff baselines (`3b22e706…`, `75782ef6…`, `1fef9572…`, `d3a8ccc8…`, `18206dc2…`, `38ed1543…`) |
| Progress prefix integrity | first 603 lines of `apply-progress.md` | SHA-256 `222e68b3ec6c9759f0be35da063a2f51e880fef39f8a6f13ac82a8aa456dae5b` retained (append-only verified) |
| Checkbox invariants | grep counts of `- [x]` and `- [ ]` rows in `tasks.md` | 6 checked / 16 unchecked (Task 3.1 stays checked, Task 3.2 stays unchecked, totals 6/22) |
| Runtime / browser verification | N/A | This correction changes only server-side transport error classification; no application-facing request, route, or browser surface exists, so browser runtime remains N/A until route composition exists. |

### Inclusive updated line accounting

Hard 400-line candidate total over the authorized surfaces (`requestJson.ts`, `server.ts`, and the cumulative `apply-progress.md` diff): authored production source `requestJson.ts` 77 lines (72 baseline + 5 correction lines) + `server.ts` 4 lines = 81 lines, plus the cumulative `apply-progress.md` diff of 42 (first-attempt section) + 44 (this correction section) added lines, for an inclusive total of 167 changed lines (0 deletions) — inside the hard 400-line budget. Deletions in the six protected pre-existing modifications are not part of this unit's candidate and were never touched.

### Updated rollback boundary

Delete the two new files `frontend/src/lib/api/requestJson.ts` and `frontend/src/lib/api/server.ts` AND revert `apply-progress.md` to its pre-unit blob (SHA-256 `222e68b3ec6c9759f0be35da063a2f51e880fef39f8a6f13ac82a8aa456dae5b`, 603 lines), which removes both appended `task-3.2-green-request-json` sections (first-attempt and correction) while preserving all earlier history; the six-file suite returns to its committed RED state and no other byte is touched. `requestJson.ts` depends only on the already-landed `../env/validate` module, so no prior sub-unit is affected.

## Maintainer-authorized final mechanical correction — requestJson.ts indentation normalization (work unit `task-3.2-green-request-json-indent-correction`, Task 3.2 remains `[ ]`)

This appended section is the explicitly maintainer-authorized final mechanical correction under a fresh native reset at the required revision (native authority: `proceed` for this narrower objective, bound to remediate failed evidence `sha256:c7f1e520e1c1e888ec956c6ac3e6fb36450d38b69723789591d84f4aa4c96ef8`, hard 400-line budget). No attempt tokens or state were persisted anywhere.

### Formatting-only change (no behavior change)

The visibly inconsistent over-indentation of the `let payload` / nested `try` / `catch` block in `frontend/src/lib/api/requestJson.ts` (previously a 12-space base where the enclosing outer-`try` body uses 4 spaces) was normalized to the same two-space nesting style as the surrounding function. `diff -w` between the pre- and post-correction files is empty, proving the change is whitespace-only: zero changes to behavior, types, comments, control flow, names, imports, exports, or any other source content; line count stays 77.

### Rerun results (Node v22.22.1, Corepack pnpm 10.34.5, from `frontend/`; committed tests unchanged)

| Check | Exact command | Result |
| --- | --- | --- |
| Focused GREEN | `corepack pnpm@10.34.5 exec vitest run src/lib/api/transport.test.ts` | exit 0; Test Files 1 passed (1); Tests 6 passed (6) |
| Six-file triangulation | the committed RED command (`server.test.ts transport.test.ts schemas.test.ts formatters.test.ts url.test.ts jobId.test.ts`) | 2 GREEN suites (`src/lib/api/transport.test.ts` 6, `src/lib/env/server.test.ts` 5), 4 intentional missing-module RED suites (`Failed to resolve import` for `./schemas`, `./formatters`, `./url`, `./api/getJob`), 11 passing executed tests, no assertion failures |
| Focused lint | `corepack pnpm@10.34.5 exec eslint src/lib/api/requestJson.ts src/lib/api/server.ts` | exit 0; 0 errors, 0 warnings |
| Typecheck (attribution) | `corepack pnpm@10.34.5 exec tsc --noEmit` | attribution run observed exit 2 (cold first invocation); three immediate reruns all exited 1 with byte-identical stdout, confirming the previously documented first-invocation exit-2 transient. Diagnostics across all runs are exclusively the five allowed `TS2307 Cannot find module` errors for intentionally absent future modules (`./formatters`, `./api/getJob`, `./jobId`, `./schemas`, `./url`); zero errors attributed to `requestJson.ts` or `server.ts` |
| Whitespace gate | `git diff --check` | exit 0 |
| Scope | `git status --porcelain` | exactly the six protected pre-existing modifications, modified `apply-progress.md`, and untracked `frontend/src/lib/api/requestJson.ts` + `frontend/src/lib/api/server.ts`; nothing else; branch `feat/frontend-foundation`, HEAD `f9bddf3`, empty index |
| Protected hashes + progress prefix | `sha256sum` of six protected paths and first 603 lines of this file | all six byte-identical to the handoff baselines; first-603 prefix SHA-256 `222e68b3ec6c9759f0be35da063a2f51e880fef39f8a6f13ac82a8aa456dae5b` retained (append-only verified) |
| Checkbox invariants | grep counts in `tasks.md` | 6 checked / 16 unchecked (Task 3.1 stays checked, Task 3.2 stays unchecked, totals 6/22) |
| Runtime / browser verification | N/A | Formatting-only change to a server-only transport module with no application-facing request, route, or browser surface; browser runtime remains N/A until route composition exists. |

### Inclusive updated line accounting

Hard 400-line candidate total over the authorized surfaces: `requestJson.ts` 77 lines + `server.ts` 4 lines = 81 authored source lines, plus cumulative `apply-progress.md` additions of 86 lines pre-correction (42 first-attempt + 44 prior correction section) + 30 lines for this correction section (after the repository markdownlint autofix) = 116 cumulative progress additions, for an inclusive total of 197 changed lines (0 deletions) — inside the hard 400-line budget.

### Rollback boundary (unchanged)

Delete the two new API files `frontend/src/lib/api/requestJson.ts` and `frontend/src/lib/api/server.ts` AND restore `apply-progress.md` to its original 603-line pre-unit blob (SHA-256 `222e68b3ec6c9759f0be35da063a2f51e880fef39f8a6f13ac82a8aa456dae5b`), which removes every appended `task-3.2-green-request-json*` section while preserving all earlier history; the six-file suite returns to its committed RED state and no other byte is touched.

## Corrective rerun — final indentation alignment in requestJson.ts (work unit `task-3.2-green-request-json-indent-correction`, single authorized corrective rerun)

This appended section is the single authorized corrective rerun for the reset objective under fresh native authority `proceed` (same hard 400-line budget). It supersedes only the prior section's claim that indentation normalization was complete: fresh inspection found the `let payload` / nested JSON `try` / `catch` block still two spaces too deep (6-space base instead of 4). No attempt tokens or state were persisted.

### Exact final alignment (formatting-only, no non-whitespace change)

The block was dedented by exactly two spaces so that `let payload: unknown;`, the nested JSON `try {` / `} catch {` / `}`, and the immediately following decoder `try {` all sit at exactly four leading spaces inside the outer `try` body (verified programmatically by leading-space counting, not inferred from ESLint; the block was additionally printed back with visible whitespace and diffed byte-exact against the target block). Interior nesting is unchanged: `payload = await response.json();` at six spaces, comment/catch bodies at six/eight as designed. Line count stays 77; zero changes to behavior, types, comments, control flow, names, imports, or exports.

### Rerun results (Node v22.22.1 via nvm, Corepack pnpm 10.34.5, from `frontend/`; committed tests unchanged)

| Check | Exact command | Result |
| --- | --- | --- |
| Focused GREEN | `corepack pnpm@10.34.5 exec vitest run src/lib/api/transport.test.ts` | exit 0; Test Files 1 passed (1); Tests 6 passed (6) |
| Six-file triangulation | the committed RED command (`server.test.ts transport.test.ts schemas.test.ts formatters.test.ts url.test.ts jobId.test.ts`) | exit 1; Test Files 4 failed / 2 passed (6); Tests 11 passed (11); 2 GREEN suites (`src/lib/api/transport.test.ts` 6, `src/lib/env/server.test.ts` 5) and 4 intentional missing-module RED suites (`Failed to resolve import` for `./formatters`, `./api/getJob`, `./schemas`, `./url`), no assertion failures |
| Focused lint | `corepack pnpm@10.34.5 exec eslint src/lib/api/requestJson.ts src/lib/api/server.ts` | exit 0; 0 errors, 0 warnings |
| Typecheck (exact exit code + attribution) | `corepack pnpm@10.34.5 exec tsc --noEmit` | reproducible exit 1 (two consecutive runs); exactly 5 diagnostics, all `TS2307 Cannot find module` in the four intentionally RED committed test files (`formatters.test.ts` 1, `jobId.test.ts` 2, `schemas.test.ts` 1, `url.test.ts` 1); zero errors attributed to `requestJson.ts` or `server.ts` |
| Whitespace gate | `git diff --check` | exit 0 |
| Scope | `git status --porcelain` | exactly the six protected pre-existing modifications, modified `apply-progress.md`, and untracked `frontend/src/lib/api/requestJson.ts` + `frontend/src/lib/api/server.ts`; nothing else; branch `feat/frontend-foundation`, HEAD `f9bddf3df068916f95e15b9b84868756cb76681c`, empty index |
| Protected hashes + progress prefixes | `sha256sum` of six protected paths and of the preserved prefixes of this file | all six byte-identical to the handoff baselines (`3b22e706…`, `75782ef6…`, `1fef9572…`, `d3a8ccc8…`, `18206dc2…`, `38ed1543…`); first-603-line prefix SHA-256 `222e68b3ec6c9759f0be35da063a2f51e880fef39f8a6f13ac82a8aa456dae5b` and pre-correction 719-line full-file SHA-256 `9cd8d4e49e0c58df41e1ff160c8f2c2ac62d94db53b155c47db7c43645076f9e` both retained (append-only verified) |
| Checkbox invariants | grep counts in `tasks.md` | 6 checked / 16 unchecked (Task 3.1 stays checked, Task 3.2 stays unchecked, totals 6/22) |
| Runtime / browser verification | N/A | Formatting-only change to a server-only transport module with no application-facing request, route, or browser surface; browser runtime remains N/A until route composition exists. |

### Inclusive updated line accounting

Hard 400-line candidate total over the authorized surfaces: `requestJson.ts` 77 lines + `server.ts` 4 lines = 81 authored source lines, plus cumulative `apply-progress.md` additions of 116 lines pre-correction (42 first-attempt + 44 prior correction + 30 indentation section) + 30 lines for this corrective-rerun section = 227 changed lines (0 deletions) — inside the hard 400-line budget. Deletions in the six protected pre-existing modifications are not part of this unit's candidate and were never touched.

### Rollback boundary (unchanged)

Delete the two new API files `frontend/src/lib/api/requestJson.ts` and `frontend/src/lib/api/server.ts` AND restore `apply-progress.md` to its original 603-line pre-unit blob (SHA-256 `222e68b3ec6c9759f0be35da063a2f51e880fef39f8a6f13ac82a8aa456dae5b`), which removes every appended `task-3.2-green-request-json*` section while preserving all earlier history; the six-file suite returns to its committed RED state and no other byte is touched.

## Work unit `task-3.2-post-commit-request-json-format` — evidence

- Scope: exactly the two allowed surfaces for this rerun — the byte-frozen formatter-only candidate `frontend/src/lib/api/requestJson.ts` (read-only here, 93 lines, no byte changed) and this append-only progress suffix in `openspec/changes/frontend-public-job-discovery/apply-progress.md` (lines 750–763); no production semantics touched, no other path changed.
- Classification: formatter-only (Prettier-style) rewrapping with zero semantic delta — the first hunk additionally wraps the `notFoundStatus` conditional expression (`options.notFoundStatus !== undefined && status === options.notFoundStatus`) across lines, remaining hunks expand single-line object literals/returns onto multiple lines, and the expanded literals gain formatter-added trailing commas. Verified preserved semantics: native `fetch`; `cache: "no-store"`; minimal `accept: application/json` header (lowercase key, case-insensitive per HTTP semantics); AbortController timeout with `clearTimeout` cleanup in `finally`; body-consumption race reclassified as retryable `timeout`; typed discriminated `RequestJsonResult`; exact `notFoundStatus` mapping (only that status maps to `not_found`); feature-owned decoder isolation; no logging or sensitive-value output.
- Identity: current SHA-256 `53039c84e7b89df165ec62a3c77830d5a100abb1fd9569040efdf15d3f2e94a3`, git blob `95c839fc94741d123c642a44b7db6c047d98f9ec`, 93 lines; HEAD SHA-256 `01e1a8a2c6780f335b62393e0bbc7d5b5a4fae5b0a6fee8dcb5876300a1f60b7`, blob `a7e46c658b5b5cc13992ee986aca814579d347fb`, 77 lines; diff SHA-256 `0bc6e2b6b8658f38a469d52e69cd566011dbfdff434551974cb72222170964f6`, 21 additions / 5 deletions = 26 changed source lines.
- Focused tests (Node v22.22.1 via nvm, explicit Corepack `pnpm@10.34.5`, from `frontend/`): `corepack pnpm@10.34.5 exec vitest run src/lib/api/transport.test.ts` → GREEN, 1 suite / 6 tests passed. `corepack pnpm@10.34.5 exec vitest run src/lib/env/server.test.ts src/lib/api/transport.test.ts src/features/jobs/schemas.test.ts src/features/jobs/formatters.test.ts src/features/jobs/url.test.ts src/features/jobs/jobId.test.ts` → exit 1 as expected: 2 passed suites (transport, server), 4 suites fail only on unresolved-module imports of intentionally absent later Task 3.2 modules (`./formatters`, `./api/getJob`, `./schemas`, `./url`), 11 executed tests passed, zero assertion failures. No test or config modified to mask RED suites.
- Lint: `corepack pnpm@10.34.5 exec eslint src/lib/api/requestJson.ts src/lib/api/transport.test.ts` → exit 0, no findings.
- Typecheck: `corepack pnpm@10.34.5 exec tsc --noEmit` → exit 1 with exactly five diagnostics, all `TS2307` unresolved-module errors in RED test files caused by the intentionally absent later Task 3.2 modules (`./formatters`, `./api/getJob`, `./jobId`, `./schemas`, `./url`); no diagnostic touches any implemented file.
- `git diff --check` → clean, exit 0.
- Runtime/browser: N/A — `requestJson` is a server-only transport beneath future TanStack Query orchestration; no route composition exists yet (Task 3.2 GREEN route/module work is later), so no runtime harness boundary applies to this formatter-only unit.
- Budget: 26 changed source lines (21+/5−) plus exactly 14 appended progress lines in this section (blank separator through the final bullet, lines 750–763) = 40 total ≤ 400 hard changed-line budget.
- Rollback boundary: `git checkout HEAD -- frontend/src/lib/api/requestJson.ts` (restore blob `a7e46c658b5b5cc13992ee986aca814579d347fb`) plus truncating only this newly appended progress suffix (everything after the byte-preserved 749-line prefix, prefix SHA-256 `8105059e2436ebe7accdfdd877d5dc491e69cb82e1e56eeb3be12547b1384321`). No other path is touched.
- Not staged, not committed. Task 3.2 remains unchecked; Task 3.3 and the `task-3.2-green-formatters` unit are not started.

## Work unit `task-3.2-green-formatters` — evidence

- Scope: exactly one new production file `frontend/src/features/jobs/formatters.ts` (91 lines, untracked, named exports only) plus this append-only progress suffix; no other path created or modified. The six protected pre-existing dirty test files, `tasks.md`, `requestJson.ts`, `env/server.ts`, `api/server.ts`, `package.json`, `pnpm-lock.yaml`, configs, schemas, URL/jobId/getJob, routes, backend, and dependencies were not touched.
- RED (Node v22.22.1 via nvm, explicit Corepack `pnpm@10.34.5`, from `frontend/`): `corepack pnpm@10.34.5 exec vitest run src/features/jobs/formatters.test.ts` → exit 1; Test Files 1 failed (1); Tests `no tests`; sole cause `Failed to resolve import "./formatters"` — exactly one failed suite, zero tests, no assertion failures.
- GREEN implementation: `formatters.ts` exports `workModeLabel`, `employmentTypeLabel`, `seniorityLabel` (fixed Mexico Spanish label maps: Presencial/Remoto/Híbrido; Tiempo completo/Medio tiempo/Por contrato/Beca; Prácticas/Junior/Medio/Senior/Líder), `formatPublishedDate` (module-level deterministic `Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" })`), and `formatSalary` (module-level deterministic `Intl.NumberFormat("es-MX", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: 0 })` per currency; ICU no-break/narrow spaces normalized to ordinary spaces; range `MXN 25,000 – MXN 40,000` with en dash and ordinary spaces; min-only `Desde USD 3,000`; max-only `Hasta USD 3,000`; neither bound → `null`; bound presence tested with `!== undefined` so zero is present; no validation, unknown-input fallback, or invented `por mes`).
- GREEN run: `corepack pnpm@10.34.5 exec vitest run src/features/jobs/formatters.test.ts` → exit 0; Test Files 1 passed (1); Tests 3 passed (3). No production code was written before the RED run; no test file was modified at any point.
- Six-file triangulation: `corepack pnpm@10.34.5 exec vitest run src/lib/env/server.test.ts src/lib/api/transport.test.ts src/features/jobs/schemas.test.ts src/features/jobs/formatters.test.ts src/features/jobs/url.test.ts src/features/jobs/jobId.test.ts` → exit 1 as expected; Test Files 3 failed / 3 passed (6); Tests 14 passed (14); GREEN suites `server.test.ts` (5), `transport.test.ts` (6), `formatters.test.ts` (3); the three RED suites fail solely on unresolved imports of intentionally absent later Task 3.2 modules (`./api/getJob`, `./schemas`, `./url`); zero assertion failures; no test or config modified to mask RED.
- Lint: `corepack pnpm@10.34.5 exec eslint src/features/jobs/formatters.ts src/features/jobs/formatters.test.ts` → exit 0; 0 errors, 0 warnings; primary diagnostics for `formatters.ts`: none.
- Typecheck: `corepack pnpm@10.34.5 exec tsc --noEmit` → cold first invocation exit 2 (the previously documented first-invocation transient), then two consecutive reruns both exit 1 with byte-identical stdout (stdout SHA-256 `1b33bc235b89b77a1dbd4c622045d2f1fdef946bcfeddf74a503af6706e3f8d9`); exactly four diagnostics, all `TS2307 Cannot find module` in the three intentionally RED later-module test files (`jobId.test.ts` 2: `./api/getJob`, `./jobId`; `schemas.test.ts` 1: `./schemas`; `url.test.ts` 1: `./url`); zero diagnostics touch `formatters.ts` or `formatters.test.ts`.
- Whitespace gate: `git diff --check` → exit 0, clean.
- Scope check: `git status --porcelain` shows exactly the six protected pre-existing modifications, modified `apply-progress.md`, and untracked `frontend/src/features/jobs/formatters.ts`; nothing else; branch `feat/frontend-foundation`, HEAD `6f71c5dd67fc758b4390b0f5edd071490ce44ba2`, empty index (nothing staged/committed/pushed — delegated instruction).
- Protected test-file hashes (untouched, verified after all runs): `formatters.test.ts` `b83e70f68d291d592ffa0538e483195f34386118d710e6d2bc7e1c1544703795`, `jobId.test.ts` `75becc4f27c7b160e1f48b039690afe6e35cab45e54027dec72344c9a28a2214`, `schemas.test.ts` `a4504bb81df4b194f98740f4c7842ab048ffe110c060c78eed0d5519c7a12b4e`, `url.test.ts` `bf720c241c9191da5f380cff54135c87175b2af357f7ce6b44718a6f3dd4d180`, `transport.test.ts` `0cd7845a54682f0c66be0d24860f125b639c4de918ba1255d1f68af7cf9c73dc`, `server.test.ts` `b7012f530e5047a6eadf886f87124f56c304593e0b89f9a047d5a2fb09af9b34`. Pre-append 763-line prefix of this file: SHA-256 `14da204ff56ddf77175d33218d8f47531e347dd3320951b376c922ad0b5c300e` (append-only verified after write).
- TDD cycle evidence:

| Cycle | Step | Evidence |
| --- | --- | --- |
| RED | Failing test first | `vitest run src/features/jobs/formatters.test.ts` → 1 failed suite, `Tests no tests`, only `Failed to resolve import "./formatters"` |
| GREEN | Minimal implementation | `formatters.ts` (91 lines) created; focused run → 1 passed suite / 3 passed tests, exit 0, first attempt |
| TRIANGULATE | Offset boundaries + salary variants | covered by the committed tests (`-06:00`/`+05:00` UTC crossings, range/min-only/max-only/null); six-file run 14 passed, 3 intentional missing-module RED suites |
| REFACTOR | No-op | module-level deterministic formatters, const label maps, shared `formatSalaryAmount`/whitespace normalizer already minimal; lint 0/0, no duplication to remove, no post-refactor diff |

- Runtime/browser verification: N/A — pure formatting/label helpers with no route, request, browser, or hydration surface; browser runtime remains N/A until route composition exists (Tasks 4.x/5.x).
- Budget: `formatters.ts` 91 authored source lines (0 deletions, new file) + this appended progress section of 26 lines (blank separator through the final bullet, file lines 764–789; 789 − 763 = 26) = 117 changed lines total — inside the hard 400-line budget.
- Rollback boundary: delete the single new file `frontend/src/features/jobs/formatters.ts` and truncate this progress file to its original 763-line prefix (SHA-256 `14da204ff56ddf77175d33218d8f47531e347dd3320951b376c922ad0b5c300e`); no other byte is touched and the six-file suite returns to its prior RED state.
- Checkbox invariants: Task 3.2 intentionally remains unchecked (formatters is one of several Task 3.2 modules; `schemas`, `url`, `jobId`/`api/getJob`, `api/`, and `types.ts` are still absent); `tasks.md` totals stay 6 checked / 16 unchecked (6/22).

## Work unit `task-3.2-green-schemas` — evidence

- Scope: exactly four authorized surfaces — one new production file `frontend/src/features/jobs/schemas.ts` (29 lines, untracked, named exports `jobItemSchema` and `jobsListSchema` only), the exact direct `zod: "3.25.76"` declaration in `frontend/package.json`, the corresponding root-importer entry in `frontend/pnpm-lock.yaml`, plus this append-only progress suffix. The six protected pre-existing dirty test files, `tasks.md` (Task 3.2 stays `[ ]`), `schemas.test.ts`, `types.ts`, formatters, `requestJson`, `env/server.ts`, `api/server.ts`, URL/jobId/getJob, routes, configs, and backend were not touched.
- RED (Node v22.22.1 via nvm, explicit Corepack `pnpm@10.34.5`, from `frontend/`): `corepack pnpm@10.34.5 exec vitest run src/features/jobs/schemas.test.ts` → exit 1; Test Files 1 failed (1); Tests `no tests`; sole cause `Failed to resolve import "./schemas"` — one failed suite, zero tests executed, no assertion failures. No mutation preceded RED.
- Dependency gate (before mutation): locked `zod@3.25.76` verified compatible — pure-JS ESM+CJS package, no `engines` restriction (Node 22-safe), already installed at `node_modules/.pnpm/zod@3.25.76` and present in the lock as a transitive of `@modelcontextprotocol/sdk` (`zod-to-json-schema@3.25.2`); manifest had no direct zod/TanStack Query/Zustand. Version decision: exact `3.25.76` direct add via `corepack pnpm@10.34.5 add --save-exact zod@3.25.76` (exit 0, "Already up to date" — reused the existing snapshot, `4.5.4` upgrade offer not taken). No other version chosen.
- GREEN implementation: `schemas.ts` uses direct Zod 3 (`import { z } from "zod"`) with zero coercion, transforms, defaults, fallbacks, cross-field rules, logging, or extra validation: `id`/`company.id` as `z.string().uuid()`; `title`/`company.name` as `.min(1)`; required `description`, `work_mode` `onsite|remote|hybrid`, `employment_type` `full_time|part_time|contract|internship`, `seniority` `intern|junior|mid|senior|lead`, `salary_currency` `MXN|USD`; optional `location` (any string, including empty — direct `z.string().optional()`, no non-empty constraint), `salary_min`/`salary_max` (`z.number().int()`), `published_at` (`z.string().datetime({ offset: true })`); list requires `items` array with optional non-empty `next_cursor`; default Zod object stripping removes unknown additive job/company keys; omission accepted, `null` and explicit-undefined-for-required rejected. First GREEN run: 1 passed suite / 7 passed tests, exit 0.
- Six-file triangulation: `corepack pnpm@10.34.5 exec vitest run src/lib/env/server.test.ts src/lib/api/transport.test.ts src/features/jobs/schemas.test.ts src/features/jobs/formatters.test.ts src/features/jobs/url.test.ts src/features/jobs/jobId.test.ts` → exit 1 as expected; Test Files 2 failed / 4 passed (6); Tests 21 passed (21); GREEN suites exactly `transport.test.ts` (6), `server.test.ts` (5), `schemas.test.ts` (7), `formatters.test.ts` (3); the two RED suites fail solely on unresolved imports of intentionally absent later Task 3.2 modules (`./api/getJob`, `./url`); zero assertion failures; no test or config modified to mask RED.
- Primary diagnostics (parent-provided, not run in this apply): after the initial candidate, the parent Pi primary TypeScript LSP diagnostics checked `schemas.ts` and `schemas.test.ts` and returned 0 diagnostics across both files; recorded verbatim from the parent's report, independently of the `tsc --noEmit` runs below.
- Focused lint: `corepack pnpm@10.34.5 exec eslint src/features/jobs/schemas.ts src/features/jobs/schemas.test.ts` → exit 0; 0 errors, 0 warnings.
- Typecheck (exact exit code + attribution): `corepack pnpm@10.34.5 exec tsc --noEmit` → cold first invocation exit 2 (the previously documented first-invocation transient), then two consecutive reruns both exit 1 with byte-identical stdout (stdout SHA-256 `e8c998c0d826aa9cee85e464c0093c4475f81d751de7911938c796fda0c02270`); exactly three `TS2307 Cannot find module` errors in the intentionally RED later-module test files (`jobId.test.ts` 2: `./api/getJob`, `./jobId`; `url.test.ts` 1: `./url`); zero diagnostics touch `schemas.ts` or `schemas.test.ts`.
- Dependency/root-importer audit: root importer in `pnpm-lock.yaml` now declares `zod: { specifier: 3.25.76, version: 3.25.76 }`; `frontend/node_modules/zod` symlinks to `.pnpm/zod@3.25.76/...`; the seven pre-existing transitive `zod@3.25.76` lock references (snapshots, MCP SDK peer edges) remain distinct from the new direct importer entry; `package.json` contains no `@tanstack/react-query` and no `zustand`.
- Whitespace gate: `git diff --check` → exit 0, clean.
- Scope check: `git status --porcelain` shows exactly the six protected pre-existing modifications, modified `frontend/package.json`, `frontend/pnpm-lock.yaml`, `apply-progress.md`, and untracked `frontend/src/features/jobs/schemas.ts`; nothing else; branch `feat/frontend-foundation`, HEAD `5676521e0f84ca0448b3a8bf7bf050adcc488543`, empty index (nothing staged/committed/pushed — delegated instruction).
- Protected test-file hashes (untouched, verified after all runs): `formatters.test.ts` `b83e70f68d291d592ffa0538e483195f34386118d710e6d2bc7e1c1544703795`, `jobId.test.ts` `75becc4f27c7b160e1f48b039690afe6e35cab45e54027dec72344c9a28a2214`, `schemas.test.ts` `a4504bb81df4b194f98740f4c7842ab048ffe110c060c78eed0d5519c7a12b4e`, `url.test.ts` `bf720c241c9191da5f380cff54135c87175b2af357f7ce6b44718a6f3dd4d180`, `transport.test.ts` `0cd7845a54682f0c66be0d24860f125b639c4de918ba1255d1f68af7cf9c73dc`, `server.test.ts` `b7012f530e5047a6eadf886f87124f56c304593e0b89f9a047d5a2fb09af9b34`. Pre-append 789-line prefix of this file: SHA-256 `cbbb028d8d17711fc1219f75cc74910ca1fa099dcbebdb530254bdfd5e1d00cc` (append-only verified after write).
- TDD cycle evidence:

| Cycle | Step | Evidence |
| --- | --- | --- |
| RED | Failing test first | `vitest run src/features/jobs/schemas.test.ts` → 1 failed suite, `Tests no tests`, only `Failed to resolve import "./schemas"` |
| GREEN | Minimal implementation | `schemas.ts` (29 lines) created; focused run → 1 passed suite / 7 passed tests, exit 0, first attempt |
| TRIANGULATE | Enum/currency/UUID/offset boundaries | covered by the committed tests (all enum values, `MXN`/`USD`, `mxn`/trailing-space rejection, UUID rejection, `-06:00`/naive/`ayer` datetime cases); six-file run 21 passed, 2 intentional missing-module RED suites |
| REFACTOR | No-op | shared local aliases (`uuid`, `nonEmptyString`, `offsetAwareIsoDateTime`, `integer`), flat object schemas, no duplication; lint 0/0, no post-refactor diff |

- Runtime/browser verification: N/A — pure wire-decoding schemas with no route, request, browser, or hydration surface; browser runtime remains N/A until route composition exists (Tasks 4.x/5.x).
- Budget: `schemas.ts` 29 authored source lines (0 deletions, new file) + `package.json` 2 additions / 1 deletion (3 diff lines per `git diff --numstat`) + `pnpm-lock.yaml` 3 additions / 0 deletions + this appended progress section of 28 lines (lines 790–817) = 63 changed lines total — inside the hard 400-line budget.
- Rollback boundary: delete the single new file `frontend/src/features/jobs/schemas.ts`; restore `frontend/package.json` and `frontend/pnpm-lock.yaml` to their exact HEAD identities (package.json SHA-256 `4579d0ee6d417513353566ae4322c590b6f173dd887b85d1136710a9d500e03c`, Git blob `de6eab36c5b15bd4594568bdca77ed7bdd7c8002`; pnpm-lock.yaml SHA-256 `e2c33f188ce514a5a473ad2fd0d28be308e4309faded0dbbf2500058655acfef`, Git blob `cb49f20d235e783ac7f66007f25b7839c764866b`); truncate this progress file to its original 789-line prefix (SHA-256 `cbbb028d8d17711fc1219f75cc74910ca1fa099dcbebdb530254bdfd5e1d00cc`). No other byte is touched; the focused suite returns to its committed RED state.
- Checkbox invariants: Task 3.2 intentionally remains unchecked in this unit per delegated instruction (schemas is one of several Task 3.2 modules; `url`, `jobId`/`api/getJob`, `types.ts`, and query orchestration are still absent); `tasks.md` totals stay 6 checked / 16 unchecked (6/22).

## Work unit task-3.2-green-url — URL canonical query state (`frontend/src/features/jobs/url.ts`)

- Scope honored: created exactly one production file, `frontend/src/features/jobs/url.ts` (125 authored source lines, 0 deletions), with the required named exports `parseJobsQuery`, `buildJobsUrl`, `isCanonicalJobsQuery`, `buildFilterCommitUrl`, `buildNextJobsUrl`; platform `URLSearchParams` only, no dependencies, no logging, no cursor decoding/interpretation, no route/request/API code, no `types.ts`, no `jobId.ts`, no `api/getJob.ts`, no TanStack Query, no Zustand, no schema or wire-value changes.
- Pre-attempt state: delegated lock restoration was already complete before this attempt; verified at attempt start — worktree at `feat/frontend-foundation` HEAD `23d4f90692440751ab6f571e0901c7d7ad31fb9d`, index empty, exactly the six protected modifications, `frontend/pnpm-lock.yaml` clean at HEAD (SHA-256 `db7a5ad464133e3e6efa3b27f088d26ed8d81d313ef2709c74c00cd0fd187274`, Git blob `b6c4bcb8109133114749e096e850ad7e8dc80113`), `frontend/package.json` at Git blob `d497c1275341dfc363a63cc022b43f874de21dfc`; `frontend/src/features/jobs/url.ts` verified absent before the RED run.
- RED (Node v22.22.1 via nvm, Corepack `pnpm@10.34.5`): `cd frontend && corepack pnpm@10.34.5 exec vitest run src/features/jobs/url.test.ts` → `Test Files 1 failed (1)`, `Tests no tests`, sole cause `Error: Failed to resolve import "./url" from "src/features/jobs/url.test.ts". Does the file exist?` — exactly one failed suite, zero tests executed, no other failure.
- GREEN: re-ran the identical focused command after creating `url.ts` → `✓ src/features/jobs/url.test.ts (6 tests)`, `Test Files 1 passed (1)`, `Tests 6 passed (6)`.
- TRIANGULATE (exact six-file command): `cd frontend && corepack pnpm@10.34.5 exec vitest run src/lib/env/server.test.ts src/lib/api/transport.test.ts src/features/jobs/schemas.test.ts src/features/jobs/formatters.test.ts src/features/jobs/url.test.ts src/features/jobs/jobId.test.ts` → `Test Files 1 failed | 5 passed (6)`, `Tests 27 passed (27)`, zero assertion failures: GREEN suites `server.test.ts (5)`, `transport.test.ts (6)`, `schemas.test.ts (7)`, `formatters.test.ts (3)`, `url.test.ts (6)`; the only failing suite is the intentional missing-module RED `jobId.test.ts` (`Error: Failed to resolve import "./api/getJob" from "src/features/jobs/jobId.test.ts". Does the file exist?`; `src/features/jobs/jobId.ts` also confirmed absent via `ls`).
- Lint: `corepack pnpm@10.34.5 exec eslint src/features/jobs/url.ts src/features/jobs/url.test.ts` → exit 0, no warnings or errors.
- Typecheck: `corepack pnpm@10.34.5 exec tsc --noEmit` → exit 1 with exactly two intentional TS2307 diagnostics, both in `jobId.test.ts` (`(2,24) Cannot find module './api/getJob' or its corresponding type declarations.`, `(3,30) Cannot find module './jobId' or its corresponding type declarations.`); zero diagnostics attributable to `url.ts` or `url.test.ts`.
- Runtime/browser verification: N/A — pure URL query-state module built on platform `URLSearchParams` with no route, request, browser, or hydration surface; browser runtime remains N/A until route composition exists (Tasks 4.x/5.x).
- Toolchain and stability: every pnpm command ran with Node v22.22.1 (nvm) and explicit Corepack `pnpm@10.34.5`; `frontend/pnpm-lock.yaml` was guard-checked before and after every command and never drifted (final SHA-256 `db7a5ad464133e3e6efa3b27f088d26ed8d81d313ef2709c74c00cd0fd187274`, blob `b6c4bcb8109133114749e096e850ad7e8dc80113`); `frontend/package.json` stayed at blob `d497c1275341dfc363a63cc022b43f874de21dfc`; all six protected file SHA-256 hashes re-verified unchanged after implementation (page.test.tsx `3b22e706…`, globals.css.test.ts `75782ef6…`, layout.test.tsx `1fef9572…`, preset-identity.test.ts `d3a8ccc8…`, logo.test.tsx `18206dc2…`, root.spec.ts `38ed1543…`).
- Budget: `url.ts` 125 authored source lines (0 deletions, new file) + this appended progress section of 17 lines (lines 818–834; `git diff --numstat` for this file: 17 additions, 0 deletions) = 142 changed lines total — inside the hard 400-line budget; no tracked path other than this progress file changed beyond the six protected pre-existing modifications.
- `git diff --check` → exit 0 (no whitespace/conflict-marker errors). Index untouched; nothing staged, committed, pushed, or opened as a PR.
- Final scope: exactly the six protected pre-existing modifications + untracked `frontend/src/features/jobs/url.ts` + this modified append-only progress file; index empty; lock and package.json clean; no other untracked paths.
- Rollback boundary: delete the single new file `frontend/src/features/jobs/url.ts`; truncate this progress file to its original 817-line prefix (SHA-256 `4d1c534a5b90fffcd0a3a5cb6624d1fac42202ef8e5831859e2a32288f559ed3`). No other byte is touched; the focused suite returns to its committed RED state (`Failed to resolve import "./url"`).
- Checkbox invariants: Task 3.2 intentionally remains unchecked per delegated instruction (env/transport/schemas landed earlier; `url` is one of several Task 3.2 modules; `jobId`/`api/getJob`, `types.ts`, and TanStack Query orchestration are still absent); `tasks.md` unchanged at 6 checked / 16 unchecked (6/22).

## Work unit task-3.2-green-url-correction — superseding gatekeeper correction (generation 54)

- Scope honored: edited only `frontend/src/features/jobs/url.ts` (the two corroborated canonicalization boundaries) and appended this section to this progress file after line 834; no tests or files added, nothing deleted, prior evidence above preserved byte-for-byte (first 817 lines SHA-256 `4d1c534a5b90fffcd0a3a5cb6624d1fac42202ef8e5831859e2a32288f559ed3` re-verified before and after the append; the superseded 818–834 section is retained untouched above this section).
- Corroborated defects (independent verifier `subtask_gentle-ai-verify_1788587875881_0243c5bc`, failed evidence `sha256:2fc2cfc09840c6968bcdea962560622502b94928e1d3ab8ced1bcff3ea4a1249`): (1) `buildJobsUrl` bypassed `canonicalValue`, so direct inputs such as `{ seniority: "expert", currency: "usd" }` emitted noncanonical wire values and `{ q: " react ", location: "　Monterrey　" }` emitted outer whitespace that `isCanonicalJobsQuery` rejects; (2) `buildNextJobsUrl("/vacantes?q=react&cursor=old", "")` retained `cursor=old` from the parsed current URL instead of omitting the cursor.
- Correction RED (Node v22.22.1 via nvm, explicit Corepack `pnpm@10.34.5`): read-only probe `corepack pnpm@10.34.5 exec node --experimental-strip-types --input-type=module -e "import { buildJobsUrl, buildNextJobsUrl, isCanonicalJobsQuery } from './src/features/jobs/url.ts'; …"` importing the module directly (no file writes; the original missing-module RED was not re-run destructively): P1 `buildJobsUrl({seniority:"expert",currency:"usd"})` → `/vacantes?seniority=expert&currency=usd` (expected `/vacantes`); P2 `buildJobsUrl({q:" react ",location:"　Monterrey　"})` → `/vacantes?q=+react+&location=%E3%80%80Monterrey%E3%80%80` with `isCanonicalJobsQuery` round-trip `false` (expected `/vacantes?q=react&location=Monterrey`); P3 `buildNextJobsUrl("/vacantes?q=react&cursor=old","")` → `/vacantes?q=react&cursor=old` (expected `/vacantes?q=react`). Exactly 3 failing checks; 3 controls already passing (P4 exact valid values in fixed order, P5 valid cursor preserved, P6 runtime-unknown key ignored).
- Correction (url.ts only, two boundaries): `buildJobsUrl` now routes every serialized value through the existing `canonicalValue` under fixed-key `SERIALIZATION_ORDER` iteration — trim `q`/`location`, omit empty/invalid enum/currency/cursor values, ignore runtime-unknown keys, preserve exact valid values and canonical order; `buildNextJobsUrl` canonicalizes the cursor argument (`canonicalValue(CURSOR_KEY, cursor)`) so an empty next cursor means omit — a next cursor replaces prior cursor state and never retains the parsed old one. Six valid filters and all other exports unchanged; no new runtime exports. Net +3 lines (125 → 128).
- Correction GREEN probe: identical probe re-run after the edit → 9/9 PASS (P1–P9, additionally P7 empty-string inputs omit keys, P8 `parseJobsQuery`→`buildJobsUrl` idempotence on a mixed dirty query, P9 `buildFilterCommitUrl` still cursor-free and canonical); `isCanonicalJobsQuery` round-trip on the whitespace case now `true`; 0 failing checks.
- Focused URL suite: `cd frontend && corepack pnpm@10.34.5 exec vitest run src/features/jobs/url.test.ts` → `Test Files 1 passed (1)`, `Tests 6 passed (6)`.
- Exact six-file command re-run: `Test Files 1 failed | 5 passed (6)`, `Tests 27 passed (27)`, zero assertion failures; GREEN suites `url.test.ts (6)`, `transport.test.ts (6)`, `server.test.ts (5)`, `schemas.test.ts (7)`, `formatters.test.ts (3)`; the sole failing suite remains the intentional missing-module RED `jobId.test.ts` (`Error: Failed to resolve import "./api/getJob" from "src/features/jobs/jobId.test.ts". Does the file exist?`).
- Lint/typecheck: `corepack pnpm@10.34.5 exec eslint src/features/jobs/url.ts src/features/jobs/url.test.ts` → exit 0, no warnings or errors; `corepack pnpm@10.34.5 exec tsc --noEmit` → exactly two intentional TS2307 diagnostics, both in `jobId.test.ts` (`(2,24)` and `(3,30)`), zero attributable to `url.ts`/`url.test.ts`; `git diff --check` → exit 0.
- Toolchain and guards: every package command ran with Node v22.22.1 (nvm) and explicit Corepack `pnpm@10.34.5`; `frontend/pnpm-lock.yaml` guard-checked before and after every command — SHA-256 `db7a5ad464133e3e6efa3b27f088d26ed8d81d313ef2709c74c00cd0fd187274`, Git blob `b6c4bcb8109133114749e096e850ad7e8dc80113`, no drift; `frontend/package.json` Git blob `d497c1275341dfc363a63cc022b43f874de21dfc`; all six protected hashes re-verified unchanged (page.test.tsx `3b22e706…`, globals.css.test.ts `75782ef6…`, layout.test.tsx `1fef9572…`, preset-identity.test.ts `d3a8ccc8…`, logo.test.tsx `18206dc2…`, root.spec.ts `38ed1543…`).
- Budget (recomputed from HEAD): `url.ts` 128 authored source lines (new untracked file, 0 deletions) + total progress additions after line 817 (17 prior + 16 new = 33, `git diff --numstat` for this file: 33 additions / 0 deletions) = 161 changed lines total — inside the hard cumulative 400-line budget; no tracked path other than this progress file changed beyond the six protected pre-existing modifications. (The section was 13 lines as authored; the repository markdownlint autofix reformatted it to 16 diff lines.)
- Final scope: exactly the six protected pre-existing modifications + untracked `frontend/src/features/jobs/url.ts` (128 lines) + this modified append-only progress file; index empty; lock and package clean; nothing staged, committed, pushed, or opened as a PR; no other unit started.
- Rollback boundary: delete the single new file `frontend/src/features/jobs/url.ts` and truncate this progress file to its original 817-line prefix (SHA-256 `4d1c534a5b90fffcd0a3a5cb6624d1fac42202ef8e5831859e2a32288f559ed3`); the focused suite returns to the committed missing-module RED (`Failed to resolve import "./url"`).
- Checkbox invariants: Task 3.2 intentionally remains unchecked per delegated instruction; `tasks.md` untouched at 6 checked / 16 unchecked (6/22).

## Work unit task-3.2-post-commit-url-format — deterministic Biome reconciliation

- Scope: behavior-neutral post-commit reconciliation of `frontend/src/features/jobs/url.ts` only — committed HEAD form 128 lines (SHA-256 `56f4acef98183f7060277e7fb28cd0e13ab5d48142e8cf4a365bca5452e670cc`, blob `2a56dd46cf6218ef944881391dad136fb482e0ac`) vs worktree form 143 lines (SHA-256 `e4c26e80cc4428358e6d958ba96b3b136c5195225d2ac7d7c1dd0c6b26e2a0ea`, blob `22b55ce4e49f411ae70594713840f086b6ee6d51`), exact diff 19 additions / 4 deletions, diff SHA-256 `e89cfb49ee913073d7ba22d569eef1e8fe763177a81ba1f0344656bd9c55fcbe`; no source or test file edited and no source-mutating formatter or normalizer run in this unit.
- RED: N/A (strict TDD) — behavior was already tested and green; the only accepted bytes are deterministic Biome formatting of the committed implementation, so manufacturing a failing test was prohibited and none was created.
- AST/token equivalence (in-memory, zero file writes; TypeScript 5.9.3 parser under Node v22.22.1, HEAD bytes via `git cat-file blob HEAD:frontend/src/features/jobs/url.ts`): the raw diff is wrapping/whitespace plus exactly two formatter-added trailing commas — one after `"currency"` in the `FILTER_KEYS` array literal and one after the final `patch` parameter of `buildFilterCommitUrl`. Structural `ts.forEachChild` comparison excludes punctuation: structural AST SHA-256 both `a72787a608bf4ca59bab9d2727404782346f7aa4e3f963cf059cba22221c22b0`. An independent syntax-leaf comparison matched after removing only the two worktree-added trailing-comma tokens: SHA-256 both `4c90a2c513c054d34d23f6451acc79dd2c363599fc9c4cdd0a3872909ac73bd3`; parse diagnostics none for either form; no semantic tokens differ (the only remaining token-level differences are wrapping/whitespace inside raw spans). These hashes are recipe-bound and were recorded by the independent verifier; structural and syntax-leaf equality were additionally reconfirmed locally under a locally documented recipe.
- Focused URL evidence: `corepack pnpm@10.34.5 exec vitest run src/features/jobs/url.test.ts` → exit 0, 1 suite / 6 tests passed.
- Aggregate six-file evidence: `corepack pnpm@10.34.5 exec vitest run src/lib/env/server.test.ts src/lib/api/transport.test.ts src/features/jobs/schemas.test.ts src/features/jobs/formatters.test.ts src/features/jobs/url.test.ts src/features/jobs/jobId.test.ts` → exit 1 as expected: 5 green suites, 27 passing tests, zero assertion failures; the only failure is the intentional unresolved-import RED in `src/features/jobs/jobId.test.ts` (`Failed to resolve import "./api/getJob"`).
- Lint evidence: `corepack pnpm@10.34.5 exec eslint src/features/jobs/url.ts src/features/jobs/url.test.ts` → exit 0, 0 errors, 0 warnings.
- Type evidence: `corepack pnpm@10.34.5 exec tsc --noEmit` → process exit code 1 with exactly two TS2307 diagnostics, both in `src/features/jobs/jobId.test.ts` (2,24 `./api/getJob` and 3,30 `./jobId`), none elsewhere and none attributable to `url.ts`/`url.test.ts`; independently rerun locally with an identical result.
- Parent-provided diagnostics evidence: the parent's primary TypeScript diagnostics run already checked `url.ts` and `url.test.ts` — 2 files, 0 diagnostics, no unavailable/failed/inconclusive outcomes; recorded here as parent-provided evidence, not re-executed locally.
- Runtime/browser: N/A — pure behavior-neutral formatting; route composition has not begun.
- Toolchain: every frontend package command ran under Node v22.22.1 via nvm with explicit Corepack `pnpm@10.34.5`; no package-manager state installed or changed; `frontend/pnpm-lock.yaml` unchanged (7,435 lines, SHA-256 `db7a5ad464133e3e6efa3b27f088d26ed8d81d313ef2709c74c00cd0fd187274`, blob `b6c4bcb8109133114749e096e850ad7e8dc80113`) and `frontend/package.json` unchanged (51 lines, SHA-256 `152eeec6366eee4a3e34feaf2f4301d454213700d9c793b9bbb2bb4e1f29b3cb`, blob `d497c1275341dfc363a63cc022b43f874de21dfc`).
- Protected guards: all six protected dirty paths byte-identical before and after (page.test.tsx `3b22e706…`, globals.css.test.ts `75782ef6…`, layout.test.tsx `1fef9572…`, preset-identity.test.ts `d3a8ccc8…`, logo.test.tsx `18206dc2…`, root.spec.ts `38ed1543…`); `tasks.md` untouched (151 lines, SHA-256 `7a3d53337f117366db9b638606c9ce1f8390c9b18bb97b71675cef38f845c1e7`, blob `b6cdd835d4cf25770c645eb9d37930ad268f295a`); the 850-line progress prefix was byte-identical before the append (SHA-256 `132402297f9b2199124526d689fa582e7eeff71ad8f65f6f7434223441f40c1f`) and was re-verified byte-for-byte after.
- Diff hygiene: `git status --porcelain` shows exactly seven dirty paths before this progress append and exactly eight after it (the append adds this progress file as the eighth); index and standard untracked inventory are empty both times; `git diff --check` clean (exit 0); no staging, commit, push, or PR was performed.
- Budget: 23 `url.ts` diff lines (19 additions + 4 deletions) + 19 appended evidence lines = 42 total changed lines — inside the hard 400-line budget.
- Rollback boundary: `git checkout -- frontend/src/features/jobs/url.ts` restores the committed 128-line HEAD form (blob `2a56dd46…`) and truncating this file to its 850-line prefix (SHA-256 `132402297f9b2199124526d689fa582e7eeff71ad8f65f6f7434223441f40c1f`) removes this section; the focused URL suite stays green at HEAD and the aggregate suite returns to the same intentional jobId RED.
- Checkbox state: Task 3.2 intentionally remains unchecked in `tasks.md` per delegated instruction (6/22 complete); no checkbox flipped by this formatting-only unit.
- Exact final scope: the seven dirty paths exactly as found (six protected test-path modifications plus the `url.ts` Biome formatting) plus this append-only progress file; no other unit started, no dependency/config/backend/TanStack/route path touched.

## Work unit `task-3.2-green-job-detail-prevalidation` — evidence correction (third authorized apply attempt)

- Purpose: corrects only this evidence artifact, superseding failed evidence revision `sha256:8bf2924e8a1c07806a6bb4925adf07b7eba988feca678e62b919f429204fbd45`; the two prior failed evidence appends were removed from the current working tree and this file was restored byte-for-byte to its committed 869-line prefix (SHA-256 `ef2a2d967f1a584f7f8b1ee9e1848a82e7205ff6d3eb1ce4b55fbf737949088b`) before this append. Production bytes untouched and re-read from the filesystem after all checks: `frontend/src/features/jobs/jobId.ts` (12 lines, SHA-256 `801bfc1519368a96a5b5570f06cb0581756a63f56d3fbe054b89ca56a735c726`) and `frontend/src/features/jobs/api/getJob.ts` (41 lines, SHA-256 `68b69152e1847ff98682bc0c5b2a5a2d40c9b830099e6c2647526f9e8580ef4a`).
- Strict TDD: historical RED was independently confirmed before production creation — focused `vitest run src/features/jobs/jobId.test.ts` exit 1, one failed suite, zero tests, first unresolved import `./api/getJob`. GREEN now: the identical focused command returned `Test Files 1 passed (1)`, `Tests 2 passed (2)`, exit 0.
- Exact six-file aggregate: `vitest run src/lib/env/server.test.ts src/lib/api/transport.test.ts src/features/jobs/schemas.test.ts src/features/jobs/formatters.test.ts src/features/jobs/url.test.ts src/features/jobs/jobId.test.ts` → `Test Files 6 passed (6)`, `Tests 29 passed (29)`, exit 0; suites `server` (5), `transport` (6), `schemas` (7), `formatters` (3), `url` (6), `jobId` (2); zero assertion failures.
- Typecheck: `tsc --noEmit` exit 0, no diagnostics. Lint: `eslint src/features/jobs/jobId.ts src/features/jobs/api/getJob.ts` exit 0, no errors or warnings. Every command used existing dependencies only, via Node v22.22.1 (nvm) + Corepack `pnpm@10.34.5`.
- Style conformance: manual read-only review of both modules (explicitly not a formatter binary check) — double quotes, semicolons, 2-space indentation, trailing commas, named exports only, type-only `zod` import, lazy `await import` of the server-only env module placed below the malformed-ID short-circuit; consistent with the committed `url.ts`/`schemas.ts` conventions.
- Test-fidelity disclosure: the committed tests assert only `ok:false`, `error.kind:"not_found"`, and that `fetch` is never called; the exact `retryable:false` and `status:404` values are proven by source inspection of `getJob.ts`, not by test assertions.
- Runtime/browser verification: N/A — no route, page, or hydration surface exists for this unit; browser runtime remains deferred to Tasks 4.x/5.x.
- Install honesty: the first writer's forbidden `pnpm dlx` external-cache side effect remains disclosed and uncleaned; the whole session is NOT claimed no-install clean. This final retry itself performed no install and no download. Authorized Vitest ignored-cache writes are outside Git's inventory and do not appear in `git status`.
- Diff hygiene: `git status --short --untracked-files=all` after this append lists exactly nine paths: (1) `frontend/src/app/(marketing)/page.test.tsx`, (2) `frontend/src/app/globals.css.test.ts`, (3) `frontend/src/app/layout.test.tsx`, (4) `frontend/src/app/preset-identity.test.ts`, (5) `frontend/src/components/brand/logo.test.tsx`, (6) `frontend/tests/e2e/root.spec.ts` — the six protected pre-existing modified tests, hashes unchanged (`3b22e706…`, `75782ef6…`, `1fef9572…`, `d3a8ccc8…`, `18206dc2…`, `38ed1543…`); (7) untracked `frontend/src/features/jobs/api/getJob.ts`; (8) untracked `frontend/src/features/jobs/jobId.ts`; (9) modified `openspec/changes/frontend-public-job-discovery/apply-progress.md`. Index empty; `git diff --check` exit 0; nothing staged, committed, pushed, or opened as a PR; no RDD commands invoked.
- Budget: 53 authored production additions (12 `jobId.ts` + 41 `getJob.ts`, 0 deletions) + this appended evidence section of 15 lines (lines 870–884) = 68 total changed lines — inside the hard 400-line budget.
- Rollback boundary: delete `frontend/src/features/jobs/jobId.ts` and `frontend/src/features/jobs/api/getJob.ts` and truncate this file to its 869-line committed prefix (SHA-256 `ef2a2d967f1a584f7f8b1ee9e1848a82e7205ff6d3eb1ce4b55fbf737949088b`); the focused suite returns to its historical RED (unresolved `./api/getJob`). Guards verified: branch `feat/frontend-foundation`, HEAD `c3f24ac0e096857528ea2ac096db121dcb706149`, `tasks.md` untouched (151 lines, SHA-256 `7a3d53337f117366db9b638606c9ce1f8390c9b18bb97b71675cef38f845c1e7`).
- Checkbox invariants: Task 3.2 intentionally remains unchecked in `tasks.md` (6/22 complete); no checkbox flipped by this correction.

## Work unit `task-3.2-post-apply-job-detail-format` — lens formatting adoption (fifth authorized apply attempt; corrected append)

- Purpose: re-records the lens-formatting adoption evidence after retraction of the failed 13-line append (`sha256:d4872330ceba021ea127b6ad9f5ce6afdd20471403ce9bf3f21e77f1ba4e768b`), whose total-additions and budget figures were correct but whose blank-versus-content line decomposition was false; per that correction this section avoids all blank-versus-content decomposition and states only the exact total append range and count, recounted from the final file. This unit edited NO production file; the 884-line prefix (SHA-256 `e70047967c5e08731df571920e140ea0c9859e28d943d0c9c6c8b89b48a65826`) is preserved byte-for-byte, and this section appends at lines 885–897 (exactly 13 new lines in total).
- Semantic-equivalence proof (cryptographic; no formatter binary invoked, no source file edited): the superseded pre-format bytes were reconstructed from the current bytes by the exact whitespace transform (doubling the leading indent width on code and `//` lines; `*` comment-continuation lines unchanged), reproducing the superseded hashes `801bfc1519368a96a5b5570f06cb0581756a63f56d3fbe054b89ca56a735c726` (`jobId.ts`) and `68b69152e1847ff98682bc0c5b2a5a2d40c9b830099e6c2647526f9e8580ef4a` (`getJob.ts`) exactly. Non-space byte streams are byte-identical old→new, line counts unchanged (12/41), and no tabs, CR, or trailing whitespace exist in any version: the lens change was whitespace/indentation only, with zero token, string, regex, comment-text, import, control-flow, or API changes.
- Superseded identity: `frontend/src/features/jobs/jobId.ts` 12 lines, now SHA-256 `48a8a7ba595bcf76ab5db1c4ae077df933691ca41e8b696da903f105252facba`; `frontend/src/features/jobs/api/getJob.ts` 41 lines, now SHA-256 `9666613041a8b73b9b1035486c85773e58ebe8d27e55c8750c2802bbaea43fbf`. These replace the two old hashes above; both files were re-read from the filesystem and hash-verified before and after this append.
- Verification (all via Node v22.22.1 nvm + Corepack `pnpm@10.34.5`, existing dependencies only): focused `vitest run src/features/jobs/jobId.test.ts` → `Test Files 1 passed (1)`, `Tests 2 passed (2)`, exit 0; exact six-file aggregate (`server.test.ts`/`transport.test.ts`/`schemas.test.ts`/`formatters.test.ts`/`url.test.ts`/`jobId.test.ts`) → `Test Files 6 passed (6)`, `Tests 29 passed (29)`, exit 0; `tsc --noEmit` exit 0 clean; `eslint src/features/jobs/jobId.ts src/features/jobs/api/getJob.ts` exit 0 clean; `git diff --check` exit 0 clean; manual read-only style/stability inspection of both modules reconfirmed double quotes, consistent 1-space indent, no trailing whitespace, and no behavioral drift.
- Inventory invariance: exact nine dirty paths identical pre- and post-append — six protected modified tests (`3b22e706…`, `75782ef6…`, `1fef9572…`, `d3a8ccc8…`, `18206dc2…`, `38ed1543…`, unchanged), untracked `getJob.ts` + `jobId.ts`, and this modified progress file; `frontend/package.json` `152eeec6…`, `frontend/pnpm-lock.yaml` `db7a5ad4…`, `tasks.md` 151 lines `7a3d5333…`, and committed `url.ts` git blob `22b55ce4…` all unchanged; index empty (0 staged paths).
- Runtime/browser verification: N/A — no route, page, or hydration surface exists for this formatting-adoption unit; browser runtime remains deferred to Tasks 4.x/5.x.
- Install honesty: this successor ran no install, no add/update, no `pnpm dlx`, no `npx`, and no download; the first writer's forbidden `pnpm dlx` external-cache side effect remains historical, disclosed, and uncleaned; the overall session is NOT claimed no-install clean.
- Lifecycle: no staging, no commit, no push, no PR, no RDD commands, and no `git add -N`; parent owns intent-to-add and settlement.
- Rollback boundary: truncate this file to its 884-line prefix (SHA-256 `e70047967c5e08731df571920e140ea0c9859e28d943d0c9c6c8b89b48a65826`) to remove this section, and either restore the superseded pre-format bytes (`801bfc15…`/`68b69152…`) to the two production paths or delete both untracked paths, which returns the focused suite to its historical RED (unresolved `./api/getJob`).
- Checkbox invariants: Task 3.2 intentionally remains unchecked in `tasks.md` (6/22 complete); no checkbox flipped by this formatting-adoption unit. Budget: 53 production additions + 15 prior evidence lines + 13 this append = 81 total candidate additions ≤ 400.

## Bounded strict-TDD GREEN sub-unit — schema-inferred job types (work unit `task-3.2-green-types`, Task 3.2 remains `[ ]`)

Third bounded GREEN sub-unit of Task 3.2 only: `frontend/src/features/jobs/types.ts` (new, 15 lines) and `frontend/src/features/jobs/types.test.ts` (new, 48 lines). No other production, test, task, package, lockfile, config, backend, or route byte was touched; nothing staged, committed, pushed, or opened as a PR. Task 3.2 stays unchecked because TanStack Query query functions (`queryOptions`/`fetchQuery` composition) and remaining Task 3.2 wiring remain for later sub-units.

- Scope honored: `types.ts` derives exactly two exported type aliases from the feature-owned Zod schemas with no manual field duplication — `JobItem = z.infer<typeof jobItemSchema>` (validated wire shape of one vacancy) and `JobsList = z.infer<typeof jobsListSchema>` (validated `/jobs` list envelope); stable names matching the existing `getJob` transport contract and the future list/detail query functions. `z.input` was not used because the schemas declare no coercion, defaults, or transforms, so `z.infer` alone is the truthful contract; no enum-value or optional-field lists were duplicated by hand.
- RED (Node v22.22.1, explicit Corepack `pnpm@10.34.5`, `COREPACK_ENABLE_NETWORK=0`, from `frontend/`): the type-contract test `types.test.ts` was authored FIRST; no existing test imports `./types` (verified by repo-wide grep, so no duplication). `corepack pnpm@10.34.5 exec tsc --noEmit` → exit 2 with exactly one diagnostic: `types.test.ts(4,40): error TS2307: Cannot find module './types' or its corresponding type declarations.` — genuine RED for the missing type contract. The same focused Vitest run (`vitest run src/features/jobs/types.test.ts`) passed at runtime because `expectTypeOf` assertions are compile-time no-ops; the authoritative RED channel for this type-only slice is `tsc --noEmit`, which covers all test files via the project tsconfig. No production code existed before this RED.
- GREEN: `types.ts` created; focused rerun → `vitest run src/features/jobs/types.test.ts` exit 0, 2/2 tests, and `tsc --noEmit` exit 0 with zero diagnostics — every compile-time pin typechecks (exact `onsite|remote|hybrid`, `full_time|part_time|contract|internship`, `intern|junior|mid|senior|lead`, `MXN|USD`; `id: string`; nested `{ id: string; name: string }` company; optional `location`/`salary_min`/`salary_max`/`published_at`/`next_cursor`; `JobsList["items"]` exactly `JobItem[]`), so schema changes that break the consumer contract now surface as type-test failures and static/runtime types cannot drift.
- TRIANGULATE: the exact six committed contract suites plus the new types suite → `Test Files 7 passed (7)`, `Tests 31 passed (31)`, exit 0; zero assertion failures; no suite masked or modified.
- REFACTOR: no-op — two minimal `z.infer` aliases with doc comments and a narrow two-test suite; focused lint 0/0 and clean typecheck after GREEN, no duplication to remove.
- Runtime/browser verification: N/A — type-only slice with no route, request, browser, or hydration surface; browser runtime remains deferred to Tasks 4.x/5.x.
- Focused lint: `corepack pnpm@10.34.5 exec eslint src/features/jobs/types.ts src/features/jobs/types.test.ts` → exit 0, 0 errors, 0 warnings.
- Whitespace gate: `git diff --check` → exit 0. Index: `git diff --cached --stat` empty.
- Scope: `git status --porcelain --untracked-files=all` shows exactly the two new untracked files `frontend/src/features/jobs/types.ts` and `frontend/src/features/jobs/types.test.ts` and nothing else (the six pre-existing protected formatter-only diffs were absorbed into commit `843b2c4` by the parent and the tree was clean at baseline). Branch `feat/frontend-foundation`, HEAD `843b2c4d14dc870485f107c2ba45ed622610d86c`.
- Budget: 63 authored source/test lines (15 + 48, 0 deletions) plus this appended progress section (exactly 18 lines; 63 + 18 = 81 total) — far inside the 400-line budget.
- Rollback boundary: delete the two new files `frontend/src/features/jobs/types.ts` and `frontend/src/features/jobs/types.test.ts` and restore `apply-progress.md` to its pre-append HEAD blob (897 newline-terminated lines, SHA-256 `7df7f87a34e087a231492c2dcaa10e31edb08441c6c84f1863cb7a60655a4ed6`); the type contract returns to its committed RED state and no other byte is touched.
- Checkbox invariants: Task 3.2 intentionally remains unchecked in `tasks.md` (6 checked / 16 unchecked, 6/22 complete) per delegated instruction.
- Known follow-up (outside this unit's surfaces): `api/getJob.ts` currently declares a local `type JobItem = z.infer<typeof jobItemSchema>` duplicate; a later Task 3.2/3.4 sub-unit should consolidate it to `import type { JobItem } from "../types"` when that file's surface is authorized.
