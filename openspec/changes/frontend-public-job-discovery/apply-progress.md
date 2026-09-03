# Apply Progress: Frontend Public Job Discovery

## Current apply slice

- Change: `frontend-public-job-discovery`
- Work unit: `task-2.2-green` (GREEN — consume the verified preset and implement shared foundation)
- Delivery boundary: PR 2 of the selected feature-branch chain; tracker branch `feat/frontend-foundation`
- State: GREEN implementation committed at `8467124` (`feat(frontend): add public foundation and marketing root`); no push or PR was performed
- Persisted checkbox: `- [x]` — task 2.2's authorized implementation commit landed at `8467124` and the checkbox is closed in this reconciliation
- Final verification (Node `v22.22.1` / pnpm `10.34.5`): unit 6/6 files and 29/29 tests exit 0; typecheck pass; lint pass; API-offline Next `15.5.25` build pass; production root Playwright 1/1 pass; no stale server
- Scope: 9 paths and 195 textual changed lines, below the 400-line review budget
- Out of scope and not started: task 2.3 (TRIANGULATE), task 2.4 (REFACTOR), and every later task

Prior slices remain fully documented below: task 1.1 bootstrap (committed at `8e488a4`, remediation attempt 2 and revalidation attempt 3 bound to evidence revision `sha256:f62828b3be7ebbf193d74abcaa6b29c70d5c5eeea3e9d0d3b4c327626c28d7e0`) and task 2.1 RED (committed at `bfada71`).

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
- Task state after this closure: task 2.3 (TRIANGULATE), task 2.4 (REFACTOR), and every later task are not started; their checkboxes remain `- [ ]`.

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
- Task 2.4 (REFACTOR) and every later task remain untouched; their checkboxes are still `- [ ]`.
