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

## Work unit `task-3.2-closure-server-only-reconciliation` — guarded transport import reconciliation

- Purpose: user-authorized server-only boundary audit/fix. `frontend/src/features/jobs/api/getJob.ts` imported `requestJson`/`RequestJsonResult` directly from `frontend/src/lib/api/requestJson.ts`, bypassing the guarded `import "server-only"` façade `frontend/src/lib/api/server.ts` used by `listJobs.ts`. Repository baseline validated before any edit: branch `feat/frontend-foundation`, HEAD `89249b90480d1ab2dd964dc9fb76db7d3784577d`, tracked worktree/index clean, no upstream.
- `.pi` preflight-file chronology (exact observations only, no causality assigned): the parent's pre-delegation baseline showed `.pi/gentle-ai/sdd-preflight.json` ABSENT. After the interrupted (twice user-aborted) delegated launch sequence, the file was present; its observed mtime is `2026-09-06 20:10:21 -0600` and its SHA-256 is `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813` (both re-confirmed read-only during the gatekeeper correction rerun and matching the parent's post-run inspection exactly). The file remains untracked (`?? .pi/gentle-ai/sdd-preflight.json`, the only entry under `.pi/`), is not part of the repository candidate, and was not deleted, modified, or created by this work unit. Prior cleanup authorization expired, so cleanup is blocked pending fresh user authorization; the earlier appended claims that untracked `.pi/` was present at baseline and of broad "no `.pi` access" were not supportable and are superseded by this chronology.
- Strict TDD RED first: added a focused source-inspection assertion in `frontend/src/features/jobs/jobId.test.ts` (`describe("server-only transport boundary")`): `getJob.ts` source must match `/lib\/api\/server"/` and must not match `/lib\/api\/requestJson/`. Run `cd frontend && COREPACK_ENABLE_NETWORK=0 corepack pnpm@10.34.5 exec vitest run src/features/jobs/jobId.test.ts` (Node v22.22.1, pnpm 10.34.5): **1 failed | 4 passed** — the failure was exactly the direct-import violation (no `lib/api/server` match in `getJob.ts`). Genuine RED, no production code written first.
- GREEN: `getJob.ts` now imports both `requestJson` and `RequestJsonResult` from `"../../../lib/api/server"`. Identical rerun: **5 passed (5)** — malformed-ID short-circuit (no `fetch` calls) and `fetchQuery`/`queryOptions` semantics preserved verbatim.
- Test-infrastructure note: because `server-only` cannot execute under jsdom, `jobId.test.ts` adds the same Vitest substitution already used by `listJobs.test.ts` (`vi.mock` of the guarded façade returning the raw transport; production import correctness proven by the source-inspection test). The mock path from `src/features/jobs/jobId.test.ts` is `../../lib/api/server` (one level shallower than `listJobs.test.ts`); the initial `../../../lib/api/server` copy was caught as a real resolution error before any run.
- Full import audit of application-facing request paths under `frontend/src` (post-fix): production callers are exactly `src/features/jobs/api/getJob.ts` and `src/features/jobs/api/listJobs.ts`, both importing only through `../../../lib/api/server`; `src/lib/api/server.ts` itself re-exports the core. Direct `requestJson` imports are confined to non-production transport tests: `src/lib/api/transport.test.ts` (the direct transport unit test — permitted by design) and the Vitest-only `vi.mock` substitutions in `listJobs.test.ts`/`jobId.test.ts` (test-only façade substitutes, not production imports). No browser-direct fetch, no Next proxy, no Zustand, no bypass production read.
- Verification (Node v22.22.1 binary resolved from the pnpm dlx cache prepended to `PATH`, explicit Corepack `pnpm@10.34.5`, offline `COREPACK_ENABLE_NETWORK=0`, from `frontend/`): full unit suite `corepack pnpm@10.34.5 test` → **14 files / 71 tests passed** (includes the Task 3.2 aggregate: server 5, transport 6, schemas 7, formatters 3, url 6, jobId 5, types 2, listJobs, plus all committed task 2.x suites); `corepack pnpm@10.34.5 exec tsc --noEmit` → exit 0, no diagnostics; focused `eslint src/features/jobs/api/getJob.ts src/features/jobs/jobId.test.ts` → 0 errors/0 warnings; full `corepack pnpm@10.34.5 lint` → exit 0; `git diff --check` → exit 0. Runtime/browser: N/A — no route composition exists yet (Tasks 4.x/5.x).
- Gatekeeper correction rerun (attempt 2, same work unit): the full RED capture above was retained untouched; GREEN/triangulation checks were rerun and every gate reproduced — focused `vitest run src/features/jobs/jobId.test.ts` → 5 passed (5), full suite → 14 files / 71 tests, `tsc --noEmit` → exit 0, focused eslint → 0/0, full lint → exit 0, `git diff --check` → exit 0. Application-facing request-path audit re-verified: the only `fetch(` call site in `frontend/src` production code is `src/lib/api/requestJson.ts:34`; the only application-facing TanStack Query `queryFn` paths are `getJob.ts` and `listJobs.ts`, both importing exclusively through the guarded `../../../lib/api/server`; `getJob.ts`'s guarded imports and the focused source-inspection test were preserved with no real issue found. Nothing was staged, committed, pushed, installed, or written under `.pi/`; `.pi/` was only read (stat + sha256).
- Changed-line accounting (accurate, corrected): total `git diff --numstat` = `frontend/src/features/jobs/api/getJob.ts` **2+/2−**, `frontend/src/features/jobs/jobId.test.ts` **28+/5−** (of which **5+/5− is formatter-only reformatting** of the existing malformed-ID assertion block, not authored behavior), plus the administrative `apply-progress.md` append. Authored behavioral lines = `getJob.ts` 2+/2− + `jobId.test.ts` 23+/0− = **25 insertions / 2 deletions = 27 authored behavioral changed lines**, inside the 400-line budget; `apply-progress.md` is administrative evidence, excluded from the budget. No install, no dependency/lockfile/manifest change, no backend; `.pi/` was read-only inspected and is untouched by the repository candidate (cleanup blocked pending fresh authorization); no staging/commit/push/PR.
- Checkbox: Task 3.2 remains `- [ ]` (6/22). Every production clause of Task 3.2 is implemented across the landed commits through `89249b9` plus this fix, but the repository's candidate-and-commit accounting contract requires the corresponding implementation commit to land before the checkbox closes, and committing is outside this work unit's authority; the commit is the only remaining gate.
- Rollback boundary: `git checkout -- frontend/src/features/jobs/api/getJob.ts frontend/src/features/jobs/jobId.test.ts` and truncate this file's appended section. Nothing else was touched.

## Final closure — task 3.2 GREEN complete (artifact-only reconciliation)

Task 3.2 is closed: the implementation landed on `feat/frontend-foundation` through commit `45d1d2ea68dd56072ccdfe45c922697fad56a5f6` (`fix(frontend): guard job detail transport boundary`), whose exact tree `76dc64e68dc44f76f69690842adf42b581a6176c` matches the approved Task 3.2 candidate, and its checkbox in `tasks.md` is now `- [x]` (7 checked / 15 unchecked). This closure is passive artifact accounting: no production, test, config, package, lockfile, backend, or `.pi` byte was edited; the only edits are this checkbox flip and this appended section. No push, no PR, nothing staged or committed.

### Clause-by-clause audit (all satisfied by committed code through `45d1d2e`)

- `frontend/src/lib/env/server.ts`: exact `import "server-only"`; strict origin/timeout rules in `src/lib/env/validate.ts` (absolute pathless credential-free http(s) origins, production HTTPS, dev/test loopback-only HTTP, integer timeout 1000–30000, default 8000).
- `frontend/src/lib/api/` request/timeout/status/JSON boundaries: `requestJson.ts` — native `fetch` with `cache: "no-store"` (line 35), AbortController timeout with `finally` cleanup, body-consumption timeout reclassified retryable `timeout`, retryable `429`/`5xx`, exact `notFoundStatus` discriminator, `invalid_response` for JSON/decoder failures; safe logging boundary: zero `console`/`logger` occurrences, errors carry only kind/retryable/status.
- `frontend/src/features/jobs/{schemas,url,formatters,jobId,types}.ts` and `api/{getJob,listJobs}.ts`: all present; Zod schemas `jobItemSchema`/`jobsListSchema`; deterministic module-level `es-MX` Intl formatters; canonical URLs with exact scalar filters and opaque cursors.
- TanStack Query `queryOptions` (`@tanstack/react-query` pinned `5.102.8`): `listJobsQueryOptions`/`getJobQueryOptions` with `queryFn` as the only application-facing caller of the server-only transport, importing exclusively through the guarded `../../../lib/api/server`; payloads decoded with feature-owned Zod schemas; UUID prevalidation short-circuits before any transport/env access.
- Negatives: no Zustand (0 matches in src and manifest), no browser-direct fetch (the only `fetch(` call site in `frontend/src` production code is `src/lib/api/requestJson.ts:34`), no Next route-handler proxy (no `route.ts` anywhere).

### Verification evidence (Node `v22.22.1`, Corepack pnpm `10.34.5`, `COREPACK_ENABLE_NETWORK=0`, from `frontend/`)

| Gate | Exact command | Result |
| --- | --- | --- |
| Task 3.2 aggregate (focused) | `corepack pnpm@10.34.5 exec vitest run src/lib/env/server.test.ts src/lib/api/transport.test.ts src/features/jobs/schemas.test.ts src/features/jobs/formatters.test.ts src/features/jobs/url.test.ts src/features/jobs/jobId.test.ts src/features/jobs/types.test.ts src/features/jobs/api/listJobs.test.ts` | exit 0; Test Files 8 passed (8); Tests 42 passed (42) |
| Full unit suite | `corepack pnpm@10.34.5 test` | exit 0; Test Files 14 passed (14); Tests 71 passed (71) |
| Typecheck | `corepack pnpm@10.34.5 exec tsc --noEmit` | exit 0, no diagnostics |
| Lint | `corepack pnpm@10.34.5 lint` | exit 0, no errors/warnings |
| Whitespace | `git diff --check` (repo root) | exit 0 |
| Import/request-path audit | grep over `frontend/src` | only application-facing importers of the transport are `api/getJob.ts` and `api/listJobs.ts` via the guarded façade; single production `fetch` call site; no Zustand/proxy |
| Browser runtime | N/A | no route composition exists (Tasks 4.x/5.x); browser runtime remains N/A |
| Strict TDD | historical | RED was genuinely recorded per sub-unit (missing-module failures in tasks 3.1/3.2 progress above); current state is GREEN; no new RED manufactured for this no-behavior-change closure |

### Review evidence, rollback, and remaining state

- Review target `sha256:8a852731e89b20af487d68e85e8fca6925126d777fccca82938f5374c49f99ac`; final acknowledged review revision `sha256:891d7b3374def894e3fb2df03650d013cad4508cc5c0a7eaaf877cc0cc7b4a61` (authority burned); SDD implementation evidence revision `sha256:58e45c34c960167fd0cedf1d83703e81e9495b555a11fb5f9ead635d5a296f68`.
- Rollback boundary: `git revert 45d1d2e` (plus the landed Task 3.2 sub-unit commits back to `c196f37` for the full Task 3.2 implementation) removes only this contract/data candidate; this closure adds no behavior to roll back beyond reverting the checkbox flip and truncating this section.
- Task state: 7 checked / 15 unchecked (7/22 complete). Remaining: tasks 3.3, 3.4, 4.1–4.4, 5.1–5.4, 6.1–6.4, 7.1. Explicit no-push state: nothing staged, nothing committed, nothing pushed, no PR created by this work unit.
- `.pi` preflight-file chronology (gatekeeper-corrected; exact observations only, no causality assigned): the parent proved a clean pre-phase worktree baseline with `.pi/` absent immediately before this SDD phase; after the phase, `.pi/gentle-ai/sdd-preflight.json` was observed present — 174 bytes, mtime `2026-09-06 20:43:07 -0600`, SHA-256 `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813` (read-only re-confirmed during this correction rerun, matching the parent's post-phase inspection exactly). The file is untracked (`?? .pi/`), excluded from the OpenSpec candidate, and no claim is made here about which process wrote it or about `.pi` state across the whole process lifetime. The previously appended wording that the untracked `.pi/gentle-ai/sdd-preflight.json` "predates this unit" is retracted as unsupported by the observed chronology. Cleanup requires fresh user authorization: the prior cleanup authorization was already consumed, so this correction deleted and modified no `.pi` byte.

## Work unit `task-3.3-triangulate` — failure classification and URL invariants proven (Task 3.3 remains `[ ]`)

Scope honored exactly: two modified focused test files (`frontend/src/features/jobs/jobId.test.ts` 47+/0−, `frontend/src/lib/api/transport.test.ts` 16+/0−), one new focused test file (`frontend/src/features/jobs/requestPath.test.ts`, 48 lines), and this append-only progress section. No production, config, package, lockfile, task, backend, or `.pi` byte changed; nothing staged, committed, pushed, or opened as a PR.

### Existing-proof audit and gaps closed

- Already proven by committed tests: timeout, network, 429, 5xx, unexpected 4xx (incl. bare list 404 and 400 under `notFoundStatus`), invalid JSON, decoder/schema rejection with leak checks, malformed-UUID short-circuit (direct + `fetchQuery`, fetch never called), omitted optionals, six-filter forwarding in one canonical request (AND semantics), `isCanonicalJobsQuery` redirect comparison, exact `MXN|USD` (schemas + formatters + URL `USD`), cursor byte-for-byte transport (`a+b%26c%3Dd` round trip), and filter cursor reset for all six filters.
- Gaps closed by this unit: (1) detail 404 classified through the real `getJob` query function (previously only at the raw transport layer); (2) a global production request-path audit proving `requestJson.ts` is the only `fetch(` call site, the transport module is imported only by `getJob.ts`/`listJobs.ts`/the guarded façade, and no `route.ts` proxy or Zustand store exists; (3) an explicit no-logging assertion across failure classifications.

### Checklist mapping (item → proving test)

| Item | Test |
| --- | --- |
| timeout | `transport.test.ts` aborted request → retryable `timeout` |
| network | `transport.test.ts` `fetch failed` → retryable `network` |
| 429 / 5xx / unexpected 4xx | `transport.test.ts` (429, 503, 400, bare 404; 400 under `notFoundStatus`), `listJobs.test.ts` (404/503) |
| invalid JSON / schema rejection | `transport.test.ts` (`invalid_response`, leak-free), `listJobs.test.ts` invalid payload rejected, leak-free |
| detail 404 | NEW `jobId.test.ts` valid-UUID `getJob` 404 → exactly `{kind:"not_found",retryable:false,status:404}` at `http://127.0.0.1:8080/jobs/<uuid>`, plus 200 decode through `jobItemSchema` |
| malformed UUID short-circuit | `jobId.test.ts` (direct + `fetchQuery`; fetch never called) |
| omitted optionals | `schemas.test.ts` |
| AND forwarding | `listJobs.test.ts` all six filters + cursor forwarded in one canonical `GET /jobs` request |
| canonical redirect comparison | `url.test.ts` `isCanonicalJobsQuery` true/false matrix |
| exact currency | `schemas.test.ts` (MXN/USD exact, EUR/mxn rejected), `formatters.test.ts` (`MXN 25,000 – MXN 40,000`, `USD 3,000`), `url.test.ts` exact uppercase `USD` |
| cursor byte-for-byte transport | `url.test.ts` (`a b+c=d%e/f~gñ` decode-identical round trip), `listJobs.test.ts` (`a+b%26c%3Dd`) |
| filter cursor reset | `url.test.ts` add/change/clear loop over all six filters |
| only request path over guarded `requestJson` | NEW `requestPath.test.ts` (single `fetch(` site, façade-only importers, no `route.ts`, no Zustand) + per-file source-inspection tests |
| safe-log assertions | inspected existing leak-free assertions; NEW `transport.test.ts` console-silent assertion across network/status/decoder failures |

### TDD Cycle Evidence

| Stage | Evidence |
| --- | --- |
| RED | N/A for production — test-only triangulation over already-correct committed behavior; no production RED was manufactured. Two intermediate failures were test-side corrections, not production defects: the new `getJob` test needed the same `lib/env/server` Vitest substitution `listJobs.test.ts` already uses (lazy env import resolves `server-only` under jsdom), and the request-path audit expectations were refined from identifier matches to import-statement matches (the façade and query functions legitimately mention the `requestJson` identifier). |
| GREEN | First full run after corrections: `cd frontend && COREPACK_ENABLE_NETWORK=0 corepack pnpm@10.34.5 exec vitest run src/features src/lib` → exit 0, 9 files / 47 tests passed. |
| TRIANGULATE | Literal configured form `cd frontend && COREPACK_ENABLE_NETWORK=0 corepack pnpm@10.34.5 test -- --run src/features src/lib` → exit 0, 15 files / 76 tests passed (full suite including task 2.x evidence suites). |
| REFACTOR | No-op — additions are minimal focused characterization tests; focused `eslint` on all three touched files → 0 errors/0 warnings; `tsc --noEmit` → exit 0, no diagnostics. |

### Runtime, hygiene, and accounting

- Runtime/browser: N/A — no route composition exists yet (Tasks 4.x/5.x); all proof is at the unit/data-boundary layer as contracted for 3.3.
- Toolchain: every command from `frontend/` with Node `v22.22.1` (nvm binary prepended to PATH) and explicit Corepack `pnpm@10.34.5`, `COREPACK_ENABLE_NETWORK=0`; no install, no download, no `pnpm dlx`/`npx`.
- Hygiene: `git status --untracked-files=all` → exactly the three touched test files + untracked `.pi/gentle-ai/sdd-preflight.json` (SHA-256 `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813`, mtime `2026-09-06 21:07:21 -0600`, 174 bytes, read-only inspected, untouched; cleanup requires fresh user authorization); `git diff --check` exit 0; index empty; no stale `next-server`/`vitest` processes.
- Budget: 47 + 16 + 48 = 111 authored test lines (0 deletions) + this appended section ≈ 40 lines = 160 changed lines (111 test + 49 progress), inside the hard 400-line budget.
- Task 3.3 checkbox remains `- [ ]` per instruction: it closes only when the implementation commit lands, and no commit is authorized in this unit. Tasks 3.4+ untouched.

### Rollback boundary

`git checkout -- frontend/src/features/jobs/jobId.test.ts frontend/src/lib/api/transport.test.ts`, delete `frontend/src/features/jobs/requestPath.test.ts`, and truncate this progress file to its pre-append 961-line prefix (SHA-256 `f2e358681ff5f2492a2dd26623b29d4962ed9d89fdfce6824e232ff2f43ce4cd`). No other byte is touched; the focused suite returns to its committed 42-test state.

## Work unit `task-3.3-triangulate` — corrective rerun: formatting-drift re-verification (supersedes stale exact line/accounting claims in the section above only)

Gatekeeper finding: after the first Task 3.3 phase result was recorded, a post-run repository formatter reformatted the candidate files. This section re-verifies the exact current on-disk bytes and supersedes only the stale exact line counts and budget arithmetic in the `task-3.3-triangulate` section above; the test→checklist mapping, TDD-stage semantics, hygiene invariants, and rollback boundary recorded there remain in force. All prior text above is preserved byte-for-byte.

### Reformatted candidate re-read (current bytes, this rerun)

| File | First-run claim | Current state |
| --- | --- | --- |
| `frontend/src/features/jobs/jobId.test.ts` | 47+/0− | 47+/0− (unchanged, 129 lines) |
| `frontend/src/lib/api/transport.test.ts` | 16+/0− | 94+/19− (153 lines; formatter re-wrap only) |
| `frontend/src/features/jobs/requestPath.test.ts` | 48 lines, new | 53 physical lines, new (wrap/trailing-blank drift) |
| `apply-progress.md` (first Task 3.3 section) | ≈40 lines | 49+/0− |

Baseline invariants unchanged: HEAD `18568211533a2eb93ed6b4ef720f1c9ab0acd69a`, index empty, `git diff --check` clean, `.pi/gentle-ai/sdd-preflight.json` untouched (174 bytes, SHA-256 `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813`, mtime `2026-09-06 21:07:21 -0600`; still excluded, cleanup awaits fresh user authorization).

### Behavioral neutrality of the drift

- Re-read of all three test files confirms an identical describe/it inventory and assertion set versus the first-run report (`jobId.test.ts` 6 tests / 4 describes, `transport.test.ts` 7 tests / 1 describe, `requestPath.test.ts` 3 tests / 1 describe). The deltas are pure formatter re-wrapping. No test or production code was edited in this rerun.
- Gates re-run on the current bytes, from `frontend/`, Node `v22.22.1`, `COREPACK_ENABLE_NETWORK=0`, Corepack `pnpm@10.34.5`; no install/download/`pnpm dlx`/`npx`:
  - `corepack pnpm@10.34.5 exec vitest run src/features src/lib` → exit 0, 9 files / 47 tests passed (1.08s).
  - `corepack pnpm@10.34.5 test -- --run src/features src/lib` → exit 0, 15 files / 76 tests passed (1.65s).
  - Focused `eslint` on the three touched test files → exit 0, 0 errors / 0 warnings.
  - `tsc --noEmit` → exit 0, no diagnostics.
- LSP primary diagnostics on all three test files: 0. Verdict: the formatting drift is behavior-neutral; no test or production semantics regressed, so no semantic correction was needed.
- Hygiene after rerun: no stale `next-server`/`vitest` processes; nothing staged, committed, or pushed.

### Corrected changed-line accounting (supersedes the 160-line figure)

- Pre-append changed lines excluding `.pi/**`: 47 + (94+19) + 53 (untracked) + 49 (first Task 3.3 progress section) = 262.
- This appendix contributes 33 diff lines (as authored, then lightly adjusted by the repository markdownlint autofix), giving `apply-progress.md` a final 82+/0− diff. Corrected final total excluding `.pi/**`: 47 + 113 + 53 + 82 = **295 changed lines** (111 test-side authored lines preserved from the first unit, 151 reformat-accounting lines now counted, 33 corrective progress lines), inside the hard 400-line budget.
- Task 3.3 checkbox remains `- [ ]`: it closes only when the implementation commit lands, and no commit is authorized. Tasks 3.4+ untouched.
- Rollback boundary unchanged (same three test files plus progress-file truncation to the pre-Task-3.3 961-line prefix, SHA-256 `f2e358681ff5f2492a2dd26623b29d4962ed9d89fdfce6824e232ff2f43ce4cd`); this appendix truncates with the same operation.

## Final closure — Task 3.3 TRIANGULATE complete

Task 3.3 is closed after the exact reviewed implementation candidate landed in commit `479641be4bd7e422726b6f31e2d37085f72d5ed1` (`test(frontend): triangulate job API boundaries`). Its tree `fabc7602fb665f60e6f91883e9d5e577bfee4b0e` exactly matches the approved review candidate, and the Task 3.3 checkbox is now `[x]` (8 checked / 14 unchecked).

- Strict-TDD evidence remains the Task 3.3 record above: focused 9 files / 47 tests and configured 15 files / 76 tests passed under Node `v22.22.1`, Corepack pnpm `10.34.5`, and `COREPACK_ENABLE_NETWORK=0`; lint, typecheck, LSP, and diff checks passed. No production behavior changed.
- Native SDD objective `task-3.3-triangulate` settled complete against evidence `sha256:d23d866eaf1f72590fca16b4b6f18dbdeb1eb30a05aaa8686f3e78ad22f1ed89`; the distinct `task-3.3-implementation-commit` objective also settled complete against evidence `sha256:8ad217cd69c13185ca880a7942ceb11b8d3c472355140fe1d436faafdce6375e`.
- Fresh reliability review lineage `review-1cbbf28b1050f05a` approved target `sha256:2b7303da39840801300cb6a79f7d5d879c705b1d5927428a68d4baa668910f8d`; acknowledgement consumed revision `sha256:d0be3e5bbd5c0e8aedc554ad6899342d1ca824baf6c913bda1f56ff0603ab495` and burned its authority. Informational finding `R3-001` did not open a correction.
- Rollback: `git revert 479641b` removes only the Task 3.3 tests and evidence candidate; revert the subsequent artifact-closure commit separately to reopen the checkbox and remove this closure section.
- No dependency install, download, backend change, push, PR, or reuse of prior completed objectives/review authority occurred. `.pi/gentle-ai/sdd-preflight.json` was excluded from settlement and review, then removed only under fresh one-shot user authorization. Task 3.4 REFACTOR is the next ordered implementation task.

## Task 3.4 REFACTOR — domain ownership isolation and deterministic helpers (work unit `task-3-4-refactor`)

Objective: refactor `frontend/src/features/jobs/{api,schemas,url,formatters,types.ts}` and `frontend/src/lib/{api,env}` so route concerns stay absent from domain modules, no browser-direct fetch or proxy exists, no cursor is decoded/logged, the TanStack Query orchestration over guarded `requestJson` remains the single request path with no Zustand store, and formatting has no hydration-dependent relative dates or invented salary periods. Behavior-preserving REFACTOR under strict TDD; inherited the Task 3.3 GREEN baseline at HEAD `b2123013e1fb7a78adb4a2f1c35dd67fc4f3ead0` (tree `11785723117f762d91d84d6c328041355da1a07e`, parent `479641be4bd7e422726b6f31e2d37085f72d5ed1`, clean worktree/index on `feat/frontend-foundation`). Pre-append progress prefix: 1053 lines, SHA-256 `ef8fc06de0ca958f858d57bb05acd81a3f1c17f1e7c5d310b7dbb04b03bf8208` (append-only verified).

### Inspect-first refactor decisions (only justified changes)

1. `frontend/src/features/jobs/api/listJobs.ts` (8+/19−): `canonicalKeyState` re-canonicalized an already-canonical, frozen snapshot through a redundant URL-string round trip (`buildJobsUrl` → `URLSearchParams` → re-parse) even though `canonicalSnapshot` (via `parseJobsQuery`) already emits canonical values in canonical `SERIALIZATION_ORDER`. The helper was removed; the frozen snapshot is now shared verbatim by the query-key state and the `queryFn`, making the documented one-shared-snapshot intent literal. The now-unused `JobsQueryKey` type import was dropped; `canonicalSearch` remains for the `listJobs` request URL. Behavior identical (proven by the committed query-key tests: shuffled-input equality, `CANONICAL_ORDER` key ordering, JSON-serializability, non-canonical input dropping, snapshot-vs-mutation isolation).
2. `frontend/src/features/jobs/formatters.ts` (20+/8−): the label maps and salary-currency union hand-duplicated the wire enums owned by `schemas.ts`, so a schema enum change would only surface as a view call-site error (or a silent `undefined` label) instead of failing at the maps. The key types are now derived from the schema-inferred `JobItem` (`WorkMode = JobItem["work_mode"]`, `EmploymentType`, `Seniority`, `SalaryCurrency = JobItem["salary_currency"]`) and every map is `as const satisfies Record<…, string>` / `satisfies readonly SalaryCurrency[]`, making enum drift a compile error exactly where the labels live. This implements design §5.3 ("Types used by views are inferred from schemas so static and runtime contracts cannot drift"). Type-only import (`import type { JobItem } from "./types"`); zero runtime coupling. Pi-lens advisory `find-import-file-without-extension` matches the codebase-wide extension-less relative-import convention (`./schemas`, `../url`, etc.) and was intentionally kept consistent; all gates pass.
3. `frontend/src/features/jobs/types.ts` (1+/1−): stale doc comment — `JobsList` is no longer "consumed by the future list/detail query functions"; those functions exist and import it. Documentation-accuracy only.
4. Formatting determinism was re-pinned unchanged: module-level `Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" })` and per-currency `Intl.NumberFormat` with ICU narrow-space normalization; no relative dates, no invented periods.

### Inspected and deliberately unchanged (existing shape already satisfies the objective)

- `src/lib/api/requestJson.ts` + guarded `src/lib/api/server.ts` and `src/lib/env/{server,validate}.ts`: minimal, single fetch site, `no-store`, typed discriminated errors, no logging, exact `notFoundStatus` discriminator; both server entries guarded by exact `import "server-only"`. No duplication worth churning.
- `url.ts`: deliberately standalone (zero imports, platform `URLSearchParams` only) so canonical redirect comparison happens before any API/env access; coupling it to schemas/types was rejected as a boundary regression, not an improvement. Cursor opacity preserved (`canonicalValue` only omits empty; never decodes/normalizes/logs/interprets).
- `getJob.ts`/`listJobs.ts` lazy `await import("../../../lib/env/server")` duplication (2 sites with near-identical comments): extracting a shared accessor would mix env ownership into the transport façade or add an extra lib/env surface for two call sites — churn, not deduplication. The lazy pattern is load-bearing (short-circuit must precede eager env validation).
- 1-space indentation in `api/getJob.ts`, `api/listJobs.ts`, `jobId.ts` vs 2-space elsewhere: that state was set by the previously authorized, independently verified `task-3.2-post-apply-job-detail-format` lens-formatting unit; overturning an explicitly authorized prior formatting decision is outside this REFACTOR's authority. Normalizing now would be ~120 mechanical whitespace lines of churn.
- Route concerns: none exist in domain modules (no `next/navigation`, `next/server`, `route.ts`, `NEXT_PUBLIC`, or `use client` anywhere under `src/features/jobs` or `src/lib`).

### TDD Cycle Evidence (Task 3.4 REFACTOR)

| Stage | Evidence |
| --- | --- |
| Inherited baseline (Task 3.3 GREEN) | `corepack pnpm exec vitest run src/features src/lib` from `frontend/`, Node `v22.22.1`, Corepack pnpm `10.34.5`, `COREPACK_ENABLE_NETWORK=0`: exit 0, 9 files / 47 tests |
| RED | Not applicable/not manufactured: behavior-preserving REFACTOR; no new behavior or defect correction became necessary, so no failing test was required or created |
| GREEN (post-refactor) | identical focused command: exit 0, 9 files / 47 tests (includes the pinned query-key canonical-order tests, formatter behavior tests, request-path audit tests) |
| TRIANGULATE | focused suite rerun after each individual edit held at 47/47; typecheck `corepack pnpm typecheck` exit 0 with no diagnostics, proving the derived types equal the previous unions |
| REFACTOR | the refactor itself; committed behavior (Task 3.1–3.3 tests) untouched — no test file modified in this unit |

### Final gates (Node `v22.22.1` via nvm, Corepack pnpm `10.34.5`, `COREPACK_ENABLE_NETWORK=0`, from `frontend/`)

| Gate | Exact command | Result |
| --- | --- | --- |
| Focused tests (Task 3.3 inherited baseline) | `corepack pnpm exec vitest run src/features src/lib` | exit 0; Test Files 9 passed (9); Tests 47 passed (47) |
| Focused tests (post-refactor) | same command | exit 0; Test Files 9 passed (9); Tests 47 passed (47) |
| Full unit suite (configured form) | `corepack pnpm test -- --run src/features src/lib` equivalent verified via the focused command above; full `corepack pnpm exec vitest run` not required by this unit | focused form is the task-local authoritative runner per dispatch |
| Typecheck | `corepack pnpm typecheck` | exit 0, no diagnostics |
| Lint | `corepack pnpm lint` | exit 0, no errors/warnings |
| API-unavailable production build | `rm -rf .next && PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:9 PEOPLEFLOW_SITE_URL=http://127.0.0.1:3000 corepack pnpm build` | exit 0; Next.js compiled, type-validated, 2 static routes (`/`, `/_not-found`); no API process available |
| Negative: route concerns/proxy | grep over `src/features/jobs` + `src/lib` for the token set `zustand`, `route.ts`, `use client`, `next/navigation`, `next/server`, `NEXT_PUBLIC` | only matches are the requestPath.test.ts absence assertions themselves |
| Negative: browser fetch/proxy | grep `\bfetch(` over production `src/` | single call site `src/lib/api/requestJson.ts:34`; no `route.ts` proxy exists |
| Negative: cursor decode/log | grep `cursor` over domain+lib | only opacity-contract wording; no decode/normalize/log/interpret |
| Negative: requestJson bypass | guarded-façade importer grep | production importers exactly `api/getJob.ts` + `api/listJobs.ts`; TanStack `queryOptions`/`queryFn` remain the single application request path over `requestJson` |
| Negative: Zustand | grep + manifest | zero matches |
| Negative: hydration-dependent/invented formatting | grep in `formatters.ts` for the token set `RelativeTimeFormat`, `hace`, `por mes`, `getTimezoneOffset` | none; module-level deterministic UTC date + code-currency formatters |
| server-only guards | head -1 both server entries | exact `import "server-only"` in `lib/api/server.ts` and `lib/env/server.ts` |
| Whitespace gate | `git diff --check` | exit 0 |
| Scope | `git status --porcelain --untracked-files=all` | exactly the three edited frontend files + untracked `.pi/gentle-ai/sdd-preflight.json` (read-only inspected; see below); index empty; no test/config/lockfile/backend path touched |

### Changed-line accounting

`git diff --numstat`: `frontend/src/features/jobs/api/listJobs.ts` 8+/19−, `frontend/src/features/jobs/formatters.ts` 20+/8−, `frontend/src/features/jobs/types.ts` 1+/1− → **29 insertions / 28 deletions = 57 changed source lines**, far inside the 400-line budget. `apply-progress.md` is administrative evidence, excluded per project accounting. Nothing staged, committed, pushed, or opened as a PR; no dependency/lockfile/manifest change; no install.

### Runtime/browser verification

N/A — no route composition exists yet (Tasks 4.x/5.x); all proof is at the domain/data-boundary layer as contracted for 3.4. No stale `next-server` or background processes were left behind.

### `.pi` preflight-file observation (exact, no causality assigned)

The parent's verified baseline stated `.pi/gentle-ai/sdd-preflight.json` absent, yet it was present at attempt start: mtime `2026-09-06 21:36:00 -0600` (after the 21:31:32 HEAD commit, ~1 minute before this phase began), 5 JSON keys containing exactly this dispatch's session-preflight values (`executionMode: auto`, `artifactStore: openspec`, `chainedPrStrategy: ask-on-risk`, `reviewBudgetLines: 400`, `prompted: false`) and no attempt/task/authority data. Read-only inspected only; not touched, modified, or deleted; excluded from the candidate.

### Task state and checkbox

Task 3.4's checkbox remains `- [ ]` per explicit dispatch instruction (the parent forbids editing `tasks.md`; the checkbox closes only when the separately authorized implementation commit lands, consistent with the candidate-and-commit accounting contract for every prior unit). Tasks 4.1+ untouched. No push and no PR.

### Rollback boundary

`git checkout -- frontend/src/features/jobs/api/listJobs.ts frontend/src/features/jobs/formatters.ts frontend/src/features/jobs/types.ts` and truncate this file to its pre-append 1053-line prefix (SHA-256 `ef8fc06de0ca958f858d57bb05acd81a3f1c17f1e7c5d310b7dbb04b03bf8208`). No other byte is touched; the focused suite returns to the inherited Task 3.3 GREEN state. One coherent rollback boundary covers the complete REFACTOR.

## Task 3.4 REFACTOR — corrective rerun addendum (work unit `task-3-4-refactor`, single allowed gatekeeper rerun)

This append-only addendum supersedes only the two superseded claims identified below; every byte of the first Task 3.4 attempt section above is retained unchanged. Bound to failed evidence revision `sha256:e4661ee977923ad690958acfb3b89e52a90a6549b620d90fed3fd09a54994d83`; fresh acquire `proceed`, max attempts 2 and 400 changed lines preserved; no acquire/settle/reset/review-authority interaction was performed. HEAD/tree unchanged during this rerun: `b2123013e1fb7a78adb4a2f1c35dd67fc4f3ead0` / tree `11785723117f762d91d84d6c328041355da1a07e` on `feat/frontend-foundation`.

### B1 corrected — genuinely exhaustive salary formatter map

- Defect: `SALARY_CURRENCIES as const satisfies readonly SalaryCurrency[]` validates member validity only (a schema-added currency would still pass); the `Map<SalaryCurrency, Intl.NumberFormat>` could be partial, and `salaryFormatters.get(currency)!` assumed totality with a non-null assertion.
- Correction (formatters.ts only): the array + `Map` is replaced by `const salaryFormatters: Record<SalaryCurrency, Intl.NumberFormat> = { MXN: salaryFormatter("MXN"), USD: salaryFormatter("USD") }`, where `SalaryCurrency = JobItem["salary_currency"]` is schema-derived. A schema enum addition without a matching required key is now a TypeScript `TS2741` compile error exactly at this map; the non-null assertion and the partial map are gone (`salaryFormatters[currency]` is total by type). Exact MXN/USD behavior preserved: same `"es-MX"`, `style: "currency"`, `currencyDisplay: "code"`, `maximumFractionDigits: 0`, ICU narrow-space normalization, en-dash ranges, `Desde`/`Hasta` prefixes, and `null` for no bounds. No schema type weakened; no fallback behavior added. The independently verified `listJobs.ts` frozen-snapshot state and `types.ts` candidate bytes are untouched.
- Exhaustiveness proof (static, throwaway probe outside the repo): the same `Record<SalaryCurrency, Intl.NumberFormat>` pattern against a widened union `"MXN" | "USD" | "EUR"` fails typecheck with exactly `error TS2741: Property 'EUR' is missing in type '{ MXN: Intl.NumberFormat; USD: Intl.NumberFormat; }' but required in type 'Record<SalaryCurrency, NumberFormat>'` (exit 2 for the probe file — expected RED for the probe; the project typecheck itself is exit 0).
- Behavior probe (runtime, Node v22.22.1 `--experimental-strip-types` over the real module): `formatSalary` outputs are byte-identical for all four pinned cases — `{min:25000,max:40000,currency:"MXN"}` → `MXN 25,000 – MXN 40,000`; `{min:3000,currency:"USD"}` → `Desde USD 3,000`; `{max:3000,currency:"USD"}` → `Hasta USD 3,000`; `{currency:"MXN"}` → `null`.
- Honest intermediate note: the correction edit briefly introduced 4-space over-indentation and four blank lines with trailing whitespace in the replaced block; `git diff --check` caught them and the block was normalized back to the file's existing indentation (whitespace-only, proven by the unchanged test/lint/typecheck/build results below). No other transient occurred.

### B2 corrected — stale accounting superseded (append-only)

- Superseded: the first attempt's claim of `29+/28− = 57` source lines was stale after automatic formatter normalization (the gatekeeper observed `32+/29− = 61` before B1 correction). The final authoritative post-correction/post-formatting source accounting is:
- `git diff --numstat`: `frontend/src/features/jobs/api/listJobs.ts` **11+/20−**, `frontend/src/features/jobs/formatters.ts` **33+/19−**, `frontend/src/features/jobs/types.ts` **1+/1−** → **45 insertions / 40 deletions = 85 changed source lines**, inside the 400-line budget. (formatters grew from the first-attempt 20+/8− by the B1 `Record` correction plus whitespace-only normalization of the replaced block.) `apply-progress.md` is administrative evidence, excluded per project accounting; including it, the file currently stands at 69+/0− plus this addendum.
- `formatters.ts` is 105 lines; `listJobs.ts` 59; `types.ts` 15.

### Exact rerun gate results (Node `v22.22.1` via nvm PATH, Corepack pnpm `10.34.5`, `COREPACK_ENABLE_NETWORK=0`, from `frontend/`)

| Gate | Exact command | Result |
| --- | --- | --- |
| Runtime pin | `node --version` / `corepack pnpm --version` | `v22.22.1` / `10.34.5` |
| Focused tests | `corepack pnpm exec vitest run src/features src/lib` | exit 0; Test Files 9 passed (9); Tests 47 passed (47) |
| Typecheck | `corepack pnpm typecheck` | exit 0, no diagnostics |
| Lint | `corepack pnpm lint` | exit 0, no errors/warnings |
| API-unavailable build | `rm -rf .next && PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:9 PEOPLEFLOW_SITE_URL=http://127.0.0.1:3000 corepack pnpm build` | exit 0; Next.js compiled, type-validated, 4/4 static pages (`/` 8.18 kB First Load 110 kB, `/_not-found` 997 B); no API process available |
| Exhaustiveness probe | `corepack pnpm exec tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext /tmp/b1-probe/probe.ts` | exit 2 with exactly TS2741 `Property 'EUR' is missing` — proves `Record<SalaryCurrency, Intl.NumberFormat>` enforces exhaustive required keys |
| Formatting probe | Node `--experimental-strip-types` importing `formatSalary` | 4/4 pinned MXN/USD outputs byte-identical |
| Negative greps | `zustand`/`route.ts`/`use client`/`next/navigation`/`next/server`/`NEXT_PUBLIC` over `src/features/jobs` + `src/lib` (production) | none |
| Negative: fetch sites | `grep -rn "\bfetch(" src --include="*.ts"` (non-test) | single call site `src/lib/api/requestJson.ts:34` |
| Negative: requestJson bypass | guarded-façade importer grep | production importers exactly `api/getJob.ts` + `api/listJobs.ts` via `../../../lib/api/server` |
| Negative: cursor opacity | grep `cursor` in `url.ts` for decode/log/interpret/normalize | only opacity-contract wording |
| Negative: hydration/invented formatting | `RelativeTimeFormat`/`hace`/`por mes`/`getTimezoneOffset` in `formatters.ts` | none |
| server-only guards | `head -1 src/lib/api/server.ts src/lib/env/server.ts` | exact `import "server-only"` in both |
| B1 remnants | `get(currency)!`, `new Map<`, `as const satisfies readonly SalaryCurrency` in `formatters.ts` | none |
| Whitespace gate | `git diff --check` | exit 0 (after removing the four transient blank-line trailing spaces) |
| Index | `git diff --cached --stat` | empty; nothing staged, committed, pushed, or opened as a PR |

### Scope, hygiene, and preserved verified changes

- `git status --porcelain --untracked-files=all`: exactly `M frontend/src/features/jobs/api/listJobs.ts`, `M frontend/src/features/jobs/formatters.ts`, `M frontend/src/features/jobs/types.ts`, `M openspec/changes/frontend-public-job-discovery/apply-progress.md`, and untracked `.pi/gentle-ai/sdd-preflight.json`; index empty. `.next/` build artifacts are gitignored. `.pi/gentle-ai/sdd-preflight.json` was read-only SHA-verified unchanged twice during this rerun: `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813`; it was not touched, modified, or deleted and remains excluded from the candidate.
- Preserved verified changes untouched: the removed `canonicalKeyState` and the direct frozen `canonicalSnapshot` list-query key, the type-only `formatters -> types -> schemas` ownership edge, and all committed tests (`jobId.test.ts`, `listJobs.test.ts`, `formatters.test.ts`, etc. — no test file modified; no RED manufactured, behavior-preserving REFACTOR).
- Append-only verification: pre-append 1122-line prefix SHA-256 `10a335b373936ccefc7c7848736b83cccb818f23404cf3bb89d9baa29d544957` retained byte-for-byte; this addendum appends at lines 1123+.

### Rollback boundary (updated, one coherent boundary)

`git checkout -- frontend/src/features/jobs/api/listJobs.ts frontend/src/features/jobs/formatters.ts frontend/src/features/jobs/types.ts` and truncate this file to its pre-append 1122-line prefix (SHA-256 `10a335b373936ccefc7c7848736b83cccb818f23404cf3bb89d9baa29d544957`), which removes both the first Task 3.4 evidence section and this addendum while preserving all earlier history. No other byte is touched; the focused suite returns to the inherited Task 3.3 GREEN state.

### Task state

Task 3.4's checkbox remains `- [ ]` per dispatch instruction (closes only when the separately authorized implementation commit lands). Tasks 4.1+ untouched. No stage, commit, push, PR, install, or dependency change.

### Final Task 3.4 evidence reconciliation (authoritative)

- This is the final authoritative Task 3.4 evidence reconciliation. It supersedes only stale accounting/rollback statements in the two prior Task 3.4 sections above (their pre-append line counts and the truncate-to-1122 rollback); all other prior content is preserved verbatim as history.
- Re-measured source numstat vs HEAD, unchanged from the last independent verifier's stable candidate: `frontend/src/features/jobs/api/listJobs.ts` 11+/20−; `frontend/src/features/jobs/formatters.ts` 67+/53−; `frontend/src/features/jobs/types.ts` 1+/1−; source total 79+/74− = 153 changed lines, matching the independently verified candidate byte-for-byte; this evidence-only successor itself adds no source change.
- This `apply-progress.md` file is administrative evidence and is excluded from the source budget; no exact admin line, addition, or dirty-path count is stated here because the host formatter may normalize Markdown after this append.
- Correct full Task 3.4 rollback: restore all three source files to HEAD (`git checkout -- frontend/src/features/jobs/api/listJobs.ts frontend/src/features/jobs/formatters.ts frontend/src/features/jobs/types.ts`) and restore this `apply-progress.md` to the verified original 1053-line baseline prefix, SHA-256 `ef8fc06de0ca958f858d57bb05acd81a3f1c17f1e7c5d310b7dbb04b03bf8208` (SHA-256 of the first 1053 lines); rollback does NOT truncate to 1122 lines.
- Final source bytes for later verification binding (both methods reported): `git hash-object` — listJobs.ts `7c948c188a70a978beeed35034dcb4d3c750763f`, formatters.ts `c2c8b3f2d4f48c0acaa44c6c81d600d985108ef6`, types.ts `f65b8301a48bab7f957be403d83cced4ebbb79bc`; SHA-256 — listJobs.ts `4b86ce1dc1027d853209a2c9a70ef1c037d6ce8ea65400c123a1c4ed540806e5`, formatters.ts `08f11146e779be5f09926b47b711e5d30880ce30d34b5935b690fd87d1616c98`, types.ts `20aa4323be774bcf53a1eae9200646c53b3329c599083ad59a80348d97081d84`.
- Inherited final executable evidence (run by the last independent verifier AFTER final source normalization, not rerun by this evidence-only successor): Node v22.22.1, Corepack pnpm 10.34.5, `COREPACK_ENABLE_NETWORK=0`; focused suite 9 files/47 tests passed, typecheck passed, lint passed, API-offline build passed, static boundaries clean, exhaustive currency probe passed, and `git diff --check` clean. B1 is fixed. This successor changes no source, test, or config file.
- Task 3.4 remains `- [ ]` in `tasks.md`; no stage, commit, push, PR, install, or dependency change occurred in this successor.

## Final closure — Task 3.4 REFACTOR complete

- Implementation commit `f8a85bb` — `refactor(frontend): isolate job domain ownership` (parent `b2123013e1fb7a78adb4a2f1c35dd67fc4f3ead0`, tree `719e6b502ec79aa958cb3bda350fc02d361d7cc8`), authorized and settled; its staged tree matched the approved review tree exactly.
- Four committed paths: `frontend/src/features/jobs/api/listJobs.ts` (11+/20−), `frontend/src/features/jobs/formatters.ts` (67+/53−), `frontend/src/features/jobs/types.ts` (1+/1−), and `openspec/changes/frontend-public-job-discovery/apply-progress.md` (132+ evidence only).
- Authoritative source accounting: 79+/74− = 153 changed source lines across the three source files; the `apply-progress.md` evidence additions are administrative and excluded from the source budget.
- Final pinned evidence: Node v22.22.1, Corepack pnpm 10.34.5, `COREPACK_ENABLE_NETWORK=0`; focused suite 9 files / 47 tests passed, typecheck passed, lint passed, API-offline production build passed, static boundary checks clean, salary exhaustiveness and runtime formatting probes passed, `git diff --check` and LSP diagnostics clean.
- SDD evidence successor completion revision: `sha256:9bb45be22f448ec2051e761195175df193605b71e57cbc029f5f1b3228666bb6`; review lineage `review-e118b9d74bcbf41d` approved this target as the consumed revision and its authority is burned (not reusable).
- No install, stage, push, PR, or dependency change occurred in this closure; rollback is `git revert f8a85bb` plus reverting the separate closure commit once created by the parent.
- Task 3.4 is closed at 9/22 complete (13 pending); Task 4.1 RED is next.
- Closure review identities: approved review target `sha256:6fef21afa14d1b09d9f3d2906074c261cc033688901fa41b4b5685b72021be2d`; consumed review revision `sha256:96a2e50be8d109f14c2ce018c0c11bbded3a9afb67c8f02fa41a57627fc28db5`; review lineage `review-e118b9d74bcbf41d` authority is burned and MUST NOT be reused.

## Task 4.1 RED — vacancy list expectations

- Added only RED evidence: `frontend/src/app/(public)/vacantes/page.test.tsx`, `frontend/tests/e2e/vacantes.spec.ts`, and test-only `frontend/tests/fixtures/jobs-server.mjs`. No Task 4.2 route, layout, error boundary, jobs component, QueryClient composition, config, or package state changed.
- The fixture is a standalone Node HTTP process on `127.0.0.1:4010`, outside `src/` and production bundles. Its health/data probe returned `["?currency=MXN"]`; it was reset before Playwright and both fixture and production Next processes were SIGTERM-cleaned on command exit.
- Harness safety evidence: Node `v22.22.1`, frontend-local Corepack pnpm `10.34.5`; existing jobs Vitest suite passed 15 files/76 tests; existing root Playwright suite passed 13/13 against a production `next start`; fixture syntax check, `pnpm typecheck`, and `pnpm lint` passed.
- RED evidence: focused Vitest exited 1 with the sole failure `Cannot find module './page'` from the intentionally absent Task 4.2 `vacantes/page.tsx`. Focused Playwright exited 1: fixture health test passed and seven list assertions failed because production `/vacantes` returned 404—canonical redirect, validated semantic success/scalar filters, empty/reset, retryable error, pending/opaque next link, mobile titled Sheet, and omission-safe metadata are absent. This is attributable only to missing Task 4.2 behavior, not fixture startup, ports, package state, types, or lint.

### TDD Cycle Evidence

| Task | Test files | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4.1 | `page.test.tsx`, `vacantes.spec.ts`, `jobs-server.mjs` | page-data/E2E | 76 Vitest + 13 production Playwright passing | 1 unit + 7 browser assertions fail for absent route | Not authorized | Not started (RED only) | Not started |

- Task 4.1 remains unchecked as required; no implementation commit is authorized. Workload boundary: PR 4 RED slice, `feature-branch-chain`, 153 test/fixture lines plus this concise evidence; below the 400-line cap.
- Status consumed: `frontend-public-job-discovery` apply `ready`, repo-local root `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes-frontend`, allowed edit root is the workspace, no action-context warnings.
- Rollback boundary: remove the three new test/fixture files and truncate this file to its exact 1,196-line, 199,908-byte pre-append prefix (SHA-256 `8f922d3e416743bd741527bbee6cd187aa1d7ea46d6ce68ee`).

## Task 4.1 RED corrective addendum

- Narrowed the retry assertion to `role=alert` filtered by `/intentar de nuevo/i`; it no longer targets Next's empty route announcer or permits a future multi-alert conflict.
- Final corrected RED: typecheck and focused lint passed; Vitest failed only for missing `vacantes/page.tsx`; fixture test passed, and seven Playwright checks failed only for absent Task 4.2 behavior on production `/vacantes` 404.
- Final physical accounting: page test 31 + E2E 91 + fixture 53 + progress diff 22 = 197 changed lines; fixture/Next processes were cleaned and Task 4.1 remains unchecked.
- Post-write host formatting supersedes only that exact administrative total: test/fixture scope remains 175 lines and the settlement-time `git diff --numstat` is authoritative; the complete candidate remains below 400 lines.

## Task 4.1 RED proof repair — canonical request-log reconciliation

- Native correction context consumed: `task-4-1-red-canonical-proof-repair`, fresh `proceed`, max two attempts / 400 changed lines, repo-local allowed root with no action-context warnings; failed evidence `sha256:c021aa80abd2c274eea28713a88b41cfdd60b7d40d4c06adee4bea1ec04b9720` is parent-owned for settlement.
- Only `frontend/tests/e2e/vacantes.spec.ts` changed: file-level Playwright serial mode overrides global `fullyParallel`; every test resets `GET /__reset`; the isolated fixture health assertion is exact (`["?currency=MXN"]`); canonicalization now receives Playwright `request` and proves both browser-observed fixture URLs and fixture `GET /__requests` are exactly empty before its redirect assertion.
- Node `v22.22.1`, frontend-local Corepack pnpm `10.34.5`, `COREPACK_ENABLE_NETWORK=0`: typecheck, focused E2E lint, fixture syntax, and `git diff --check` passed. Focused Vitest remains genuine RED solely for absent `vacantes/page.tsx` (`Cannot find module './page'`).
- Production `next start` plus fixture on `127.0.0.1:4010`: `/vacantes` is 404; serial file run has the exact fixture health pass, then canonical redirect RED. Its server-side log was exactly `[]`; serial failure skips later tests by Playwright design, so the other six behavior tests were independently rerun and each remained RED only because Task 4.2 is absent. Fixture and Next were SIGTERM-cleaned; ports 3000/4010 are clear.
- Production route/components remain absent. `page.test.tsx` and `jobs-server.mjs` hashes were preserved; preflight SHA-256 is `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813`; the original 199,908-byte progress prefix SHA-256 remains `8f922d3e416743bd741527b1ee12311576853bbee6cd187aa1d7ea46d6ce68ee`.

### TDD Cycle Evidence — Task 4.1 repair

| Stage | Evidence |
| --- | --- |
| RED | Focused Vitest still fails only for the intentionally absent Task 4.2 page; production fixture Playwright shows the health proof pass and all seven behavior contracts remain RED against `/vacantes` 404. |
| GREEN | Not authorized; no production code was written. |
| TRIANGULATE | Exact fixture request-log reset/health/canonical-empty assertions, typecheck, focused lint, syntax, and diff checks passed under the pinned runtime. |
| REFACTOR | Not started; the repair is the minimal test-proof correction. |

- Task 4.1 remains unchecked; no task checkbox, stage, commit, push, PR, review, package, lock, config, production, or Task 4.2 file changed. Settlement-time native/git accounting is authoritative and below 400 changed lines. Rollback: restore only the prior `vacantes.spec.ts` candidate and remove this appended reconciliation section; no production rollback exists.

## Final closure — Task 4.1 RED complete

- RED commit `cf148ed3fbd698b988dd7aec40974fc05e030116` (`test(frontend): define public vacancy list behavior`) landed: exactly three test-only files, 355 insertions, and no production files. Correct committed SHA-256 values: page test `8d20ff3a64c31e9b8e2c3cdc86611655fca2983da7b9f063282cb0a55c62ae6c`; E2E `25ed691ef0abcbb788dfabb201ab22d8b4895d4e0af817cb17553a628a9398c5`; fixture `35b6950159239cbe7860ccff441de5731bf5998d2c956cc20988d9c417027262`.
- Independent verification passed: backend passed; frontend jobs/lib passed 9 files/47 tests; fixture health passed; typecheck, focused lint, fixture syntax, primary LSP, applicable pi-lens checks, and diff check passed. One auxiliary ast-grep lane was unavailable and is not clean.
- Intentional RED remains: focused Vitest had exactly four failures for absent `error.tsx` / `JobsNavigationIsland`; ten Playwright behavior scenarios remained Task 4.2 404 RED. Before the canonical redirect failure, browser and server `GET /__requests` logs were both exactly empty.
- Accounting and cleanup: the corrected candidate was 398/400 before commit; committed RED scope is 355 lines. Fixture/Next exited and ports 3000/4010 are free.
- Native objective `task-4-1-red-independent-verification` settled `complete` with `sha256:5f297912a101b2e8dcb9e6d8150f36843504a6d8f0989b0b3b713c8cf9b742b1`, remediating `sha256:36d29b93a3ff76fbdb39c4793e715df64107f8f775b59b9f01e67e2a50a85c64`.
- Rollback: revert `cf148ed`; it removes only the three Task 4.1 RED files. Task 4.2 remains unchecked and unstarted.

## Task 4.2 GREEN — blocked preflight (no implementation)

- Native status consumed from parent: `gentle-ai.sdd-status` v2, change `frontend-public-job-discovery`, authoritative OpenSpec store, apply `ready`, repo-local action context, workspace/sole allowed root `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes-frontend`, no warnings. Parent-owned work unit `task-4-2-green-vacancy-list-ui` was `proceed`; no attempt token was acquired, settled, reset, or persisted here.
- Strict TDD guidance was read. Under Node `v22.22.1`, Corepack pnpm `10.34.5`, and `COREPACK_ENABLE_NETWORK=0`, the committed focused RED was reconfirmed before any production edit: `corepack pnpm exec vitest run 'src/app/(public)/vacantes/page.test.tsx'` exited 1 with exactly four expected absent-Task-4.2 failures — missing `vacantes/error.tsx` and missing `features/jobs/components/JobsNavigationIsland` (three pending-navigation cases). No unrelated assertion or infrastructure failure occurred.
- Focused real-production Playwright RED was reconfirmed against the test-only fixture on `127.0.0.1:4010` and `next start` on `127.0.0.1:3000`: fixture health passed; canonical redirect failed only because `/vacantes` remained 404 and did not redirect; `GET /__requests` was exactly `[]` after the test, proving canonical RED happened before API access. The serial file consequently skipped the remaining nine behaviors. Both processes received cleanup and ports 3000/4010 were clear afterwards.
- Hard 400-line/offline primitive gate BLOCKED implementation before production writes. `corepack pnpm exec shadcn add button field input select sheet empty --dry-run --yes` resolved only the required CLI-managed Base UI primitive set, but reports a new `cn` dependency (forbidden: no dependency/lockfile changes). Its minimum generated primitive output is already 804 lines: button 56, input 20, select 201, empty 104, label 20, separator 25, sheet 139, and field 239. This exceeds the complete work-unit cap before any route or feature composition (layout, page, error boundary, rows, filters, or navigation island) is counted. `src/components/ui/` remains empty and no generated primitive was written.
- No production, test, task, manifest, lockfile, config, fixture, backend, or protected preflight file changed. Task 4.2 stays `- [ ]`; no stage, commit, push, or PR occurred. This administrative append is the only file change.

### TDD Cycle Evidence — Task 4.2 blocked preflight

| Stage | Evidence |
| --- | --- |
| RED | Reconfirmed: focused Vitest 4 expected absent-module failures; real Next + fixture canonical Playwright RED with `/__requests` exactly `[]`. |
| GREEN | Blocked before production code: mandatory managed primitives require forbidden dependency/lockfile change and their 804 generated lines alone exceed 400. |
| TRIANGULATE | Not started; task cannot legally enter GREEN. |
| REFACTOR | Not started. |

### Proposed compliant division

1. Authorize a prerequisite delivery slice for the required `cn` dependency/lockfile plus `button` and `sheet` only: generated source is 195 lines (56 + 139), before the measured lockfile delta. It may proceed only if its actual complete candidate remains at or below 400; no `size:exception` is implied.
2. Follow with a primitive-only slice for `field`, its `label`, and `separator`: 284 generated source lines (239 + 20 + 25), below 400.
3. Follow with a primitive-only slice for `select`, `input`, and `empty`: 325 generated source lines (201 + 20 + 104), below 400.
4. After those committed prerequisites, split Task 4.2 itself in order into a route/server-data slice (`(public)/layout.tsx`, `vacantes/page.tsx`, `error.tsx`, server-only list result states) and a navigation-controls slice (filters, rows, mobile Sheet composition, `JobsNavigationIsland`), each re-estimated against the then-committed primitive baseline and held at or below 400. Do not start Task 4.3 until Task 4.2 is fully GREEN and committed.

- Rollback boundary: revert this administrative append only; there is no production candidate to roll back.

## Task 4.2 — First provider-rescoped prerequisite slice: shadcn `button` + `sheet` primitives (first slice)

- Scope executed: only the provider-approved CLI command `corepack pnpm exec shadcn add button sheet --yes` (local shadcn, `COREPACK_ENABLE_NETWORK=0`, Node v22.22.1, pnpm 10.34.5, run from `frontend/`). No other dependency, executable, or command was used.
- CLI result: created exactly 2 files — `frontend/src/components/ui/button.tsx` (55 lines, SHA-256 `091c4bd0726a66e33ec2c562bb27a7e260ca67ac36d421fe105797fa847175d8`) and `frontend/src/components/ui/sheet.tsx` (138 lines, SHA-256 `6560fa4a6e73b4ae4f98e0645a3040cf583347d7fc8bdde69aad187608352292`).
- Approved `cn` dependency effect (explicitly authorized for this slice only): `frontend/package.json` +1 line (`"cn": "^0.2.6"`), `frontend/pnpm-lock.yaml` +10 lines (cn@0.2.6 importer + package + snapshot entries). No other dependency or lockfile change.
- Generated-file inspection: both files use Base UI primitives (`@base-ui/react/button`, `@base-ui/react/dialog` — not Radix), `class-variance-authority` variants, `cn` from the CLI-managed `cn` package (Rhea style), alias import `@/components/ui/button`, and Lucide `XIcon`; `SheetContent` includes a `SheetTitle`-compatible composition, `sr-only` Close label, and Base UI `data-starting-style`/`data-ending-style` transitions. Existing `src/lib/utils.ts` untouched.
- Invariants verified: `shadcn info --json` → Next.js 15.5.25, Tailwind v4, base `base`, style `base-rhea`, iconLibrary `lucide`, aliases `@/components` / `@/components/ui` / `@/lib/utils`, resolved UI destination `frontend/src/components/ui`; `preset resolve --json` → code `b27M1Ev2`, rhea/neutral/violet, font `inter`, lucide.
- Verification evidence: RED reconfirm before writes `vitest run 'src/app/(public)/vacantes/page.test.tsx'` → 4 failed / 4, all Task 4.2-absent-module failures (`JobsNavigationIsland` missing, `error.tsx` missing), no unrelated infrastructure failure; `corepack pnpm typecheck` → pass; `corepack pnpm lint` → pass; `git diff --check` → pass.
- Budget accounting (complete candidate): 55 + 138 generated lines + 11 package/lock lines + this append-only evidence block ≈ 240 changed lines, below the 400-line budget. No `size:exception` used or implied.
- Preserved: `.pi/gentle-ai/sdd-preflight.json` byte-identical at SHA-256 `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813` (excluded from candidate accounting); the 1,274-line apply-progress prefix preserved (SHA-256 before append `6173bdf5b487f1bba16108a02644978c911a05077b1c1cc78b9ddc6e8389866c`); Task 4.2 GREEN checkbox left `- [ ]`; no route, feature, test, config, global CSS, task checkbox, backend, root, stage, commit, push, or PR change; no token exposed or persisted; no native rescope/acquire/settle/reset/review called by this executor.
- Remaining for Task 4.2 (unchanged, unchecked): layout/page/error/`features/jobs/components/` implementation slices plus the follow-up primitive slices (`field`/`label`/`separator`, then `select`/`input`/`empty`) as proposed above. This is the first prerequisite slice only — Task 4.2 is NOT GREEN.

### Correction addendum (single allowed gatekeeper rerun) — supersedes stale hashes/line count in the first-slice section above

- Supersedes: only the generated-file hashes/line counts and the candidate accounting in the immediately prior "Task 4.2 — First provider-rescoped prerequisite slice" section are superseded by this addendum. All other statements there remain valid. Failed evidence revision remediated by this addendum: `sha256:13ac831290a444fd479ad1ee4b7fd2e8e3e0329be1b245cd45b0cde4fdb11520`.
- Cause: host normalization (formatter/LSP pass) reformatted both generated files after the first report, invalidating the recorded hashes and Sheet line count. No semantic or dependency change occurred.
- Authoritative normalized values (recomputed locally by this executor, matching parent readback): `frontend/src/components/ui/button.tsx` — 55 lines, SHA-256 `dc4f890617b2207898464023063a6ee817c44bcb2d1318e6bbac4f2aaa40aa85`; `frontend/src/components/ui/sheet.tsx` — 137 lines, SHA-256 `0a78159a66631af43a71a18a6df34a3a07b21e576f7a6e29215c4548a6eee4eb`. Normalization was formatting-only (semicolons, indentation, collapsed `<XIcon />`); Base UI primitives, `cn` package import, `@/components/ui/button` alias, Lucide `XIcon`, and CVA variants are all intact.
- Rerun results (Node v22.22.1, pnpm 10.34.5, `COREPACK_ENABLE_NETWORK=0`, from `frontend/`): `tsc --noEmit` typecheck pass; `eslint .` lint pass; `shadcn info --json` invariants unchanged (Next.js 15.5.25, Tailwind v4, base `base`, style `base-rhea`, lucide, aliases/UI destination unchanged); `preset resolve --json` → `b27M1Ev2`, rhea/neutral/violet, inter, lucide; `git diff --check` pass; Task 4.2 GREEN checkbox still `- [ ]`.
- Corrected candidate accounting: 55 + 137 generated lines + 11 package/lock lines + first-slice evidence section (13 lines) + this addendum (10 lines) = 226 changed lines plus the 26-line pre-staged parent division proposal present before this executor's writes; cumulative objective budget remains below 400. No `size:exception` used or implied.
- Preserved: `.pi/gentle-ai/sdd-preflight.json` byte-identical at SHA-256 `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813`; no generated/package/lock edits in this rerun (no cosmetic churn); no route, business, test, config, global CSS, stage, commit, push, or PR change; no native operations called; no token handled or exposed.

### Successor slice — remaining CLI-managed primitives: `field`, `input`, `select`, `empty` (generation 84, work unit `task-4-2-shadcn-primitives-remaining-generated-output`)

- Scope executed: exactly one CLI command, `corepack pnpm exec shadcn add field input select empty --yes` (local shadcn, from `frontend/`, Node v22.22.1, pnpm 10.34.5, `COREPACK_ENABLE_NETWORK=0`). It created exactly the six dry-run-predicted files — `empty.tsx`, `field.tsx`, `input.tsx`, `label.tsx`, `separator.tsx`, `select.tsx` under `frontend/src/components/ui/` — and performed no dependency installation; `package.json`/`pnpm-lock.yaml` diffs are byte-identical to the previously approved `cn@^0.2.6` effect (+1/+10 lines), with no new dependency.
- Authoritative post-normalization values (recomputed locally): `empty.tsx` 103 lines / SHA-256 `377c468270992bd5f581520e08932aa8c0b9dc51f3de4a253b71af7e068b0923`; `field.tsx` 238 / `b1d0fd7b85ec95fb9173aa0a6dc84863f217b20c0387b53cb5d2f0f3e569789b`; `input.tsx` 19 / `c263a65e15e2d10303c2ae2c3dc94c3bb539911faa19109fefc25fadbc840e70`; `label.tsx` 19 / `b3b7b21d2877838fc73713df48a47248392de04a3b3fafa8961369f33ab14530`; `select.tsx` 200 / `ff04f8b85c20c46e69cd79fa9db1e70e40040cb76cd697093232fc102fb82cb0`; `separator.tsx` 24 / `9a80ff8c110e0c55489509f4f82ebcc929c0174b59544047147b7134f86a54e7`. Total new generated source: 603 lines.
- Generated-file inspection (all six read completely): Base UI primitives only — `@base-ui/react/input`, `@base-ui/react/separator`, `@base-ui/react/select` (Portal/Positioner/Popup/ScrollArrow naming, `data-horizontal`/`data-vertical`, `render` prop composition; zero Radix imports or `asChild` assumptions); `cn` from the CLI-managed `cn` package; `field.tsx` composes via aliases `@/components/ui/label` and `@/components/ui/separator`; `select.tsx` uses Lucide `ChevronDownIcon`/`CheckIcon`/`ChevronUpIcon`; CVA variants in `empty.tsx`/`field.tsx`; Rhea semantics throughout (rounded-2xl/xl, semantic tokens `bg-input/50`, `text-muted-foreground`, `bg-popover`, `font-heading`).
- Pre-existing files preserved byte-identically: `button.tsx` SHA-256 `dc4f890617b2207898464023063a6ee817c44bcb2d1318e6bbac4f2aaa40aa85` (55 lines), `sheet.tsx` SHA-256 `0a78159a66631af43a71a18a6df34a3a07b21e576f7a6e29215c4548a6eee4eb` (137 lines); the CLI did not modify them.
- Verification evidence: committed Task 4.2 RED reconfirmed before writes (`vitest run 'src/app/(public)/vacantes/page.test.tsx'` → 4 failed / 4, only absent `JobsNavigationIsland`/`error.tsx` modules, no unrelated infrastructure failure); `shadcn info --json` → 8 installed components (`button`, `empty`, `field`, `input`, `label`, `select`, `separator`, `sheet`), base `base`, style `base-rhea`, preset `b27M1Ev2`, UI destination `frontend/src/components/ui`; `preset resolve --json` → `b27M1Ev2`, rhea/neutral/violet, inter, lucide; `corepack pnpm typecheck` (`tsc --noEmit`) pass; `corepack pnpm lint` (`eslint .`) pass; `git diff --check` pass; LSP: the pi-lens hook reported all six generated files clean during generation (6/6 "JavaScript/TypeScript clean" runner messages) and whole-project `tsc --noEmit` is clean — a standalone `lsp_diagnostics` invocation was unavailable in this session's toolset (the pi-lens CLI requires the pi harness), so the per-file hook runner plus project tsc stand as the LSP evidence.
- Budget accounting (successor objective, 1000-line generated-output exception): 603 new generated lines + no package/lock delta + this evidence section (12 lines) ≈ 615 lines, well under 1000. No `size:exception` for the 400-line review budget was requested or implied beyond the user's sole generated-output exception.
- Preserved: `.pi/gentle-ai/sdd-preflight.json` byte-identical at SHA-256 `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813` (excluded from accounting); apply-progress first 1,295 lines byte-identical at SHA-256 `e287f73373c5f206f54b62947442d2a3f5c52820505e5813c8afc2fdf18884d6` before this append; Task 4.2 GREEN checkbox still `- [ ]`; no routes, business components, tests, globals/config, backend/root, stage, commit, push, or PR changes; no native operations called; no token handled or exposed.
- Task 4.2 remains NOT GREEN; primitives are ready as the composition baseline for the upcoming route/server-data and navigation-controls slices.

### Correction addendum (single allowed gatekeeper rerun) — supersedes stale six-file hashes/line counts in the generation-84 section above

- Supersedes: only the six generated-file hashes/line counts and the budget accounting in the immediately prior "Successor slice" section are superseded by this addendum; all other statements there (command, inspection findings, verification results, preservation facts) remain valid. Failed evidence revision remediated: `sha256:035552330eb98fa6c02b4805aa2c2af4cbc4703b2f0128fcb977c39d4f54f1f9`.
- Cause: a second host normalization pass reformatted all generated primitives after the first successor report, invalidating the recorded hashes and `select.tsx` line count. No semantic change; `package.json`/`pnpm-lock.yaml` remain byte-identical to the approved `cn@^0.2.6` effect (+1/+10 lines); `button.tsx`/`sheet.tsx` remain at their settled normalized hashes.
- Authoritative normalization-stable values (recomputed twice, consecutive reads identical, matching parent readback): `empty.tsx` 103 lines / `81b7341ebd5bc7bfb01b1e7af6d7f6f0fa8ae755b8581c7996013e09c59cc55b`; `field.tsx` 238 / `dac6cccef524693a5a9d7777cb13f38ba6e8957e63171269f6559bc8a46e22b8`; `input.tsx` 19 / `66262df4c1108d5c2bec8f9db5e7c384ec4df707b9986d4b2b35fc726c629589`; `label.tsx` 19 / `8cabc1265b9a8311a224a7926da155dcc1c54b0213856ee8f159182b7b7dfe57`; `select.tsx` 201 / `3f566eeb4c8c85b8fcfd36b01ec7a169163d630dbd00965cfe3dc82cff599be6`; `separator.tsx` 24 / `6b18a02c4f908d16d2df328858d3924445f3907be4bcc9002104a4727703df88`. Total new generated source: 604 lines. `button.tsx` 55 / `dc4f890617b2207898464023063a6ee817c44bcb2d1318e6bbac4f2aaa40aa85`; `sheet.tsx` 137 / `0a78159a66631af43a71a18a6df34a3a07b21e576f7a6e29215c4548a6eee4eb`.
- Rerun verification (Node v22.22.1, pnpm 10.34.5, `COREPACK_ENABLE_NETWORK=0`): `tsc --noEmit` pass; `eslint .` pass; `shadcn info --json` → 8 components (button, empty, field, input, label, select, separator, sheet), base `base`, style `base-rhea`, preset `b27M1Ev2`, UI dest `frontend/src/components/ui`; `preset resolve --json` → `b27M1Ev2` (rhea/neutral/violet, inter, lucide); `git diff --check` pass; Task 4.2 GREEN checkbox still `- [ ]`; LSP evidence unchanged from the prior section (pi-lens hook per-file clean reports at generation time plus project tsc; standalone lsp_diagnostics unavailable in this toolset, as truthfully disclosed there).
- Corrected budget accounting (successor objective, 1000-line generated-output exception): 604 new generated lines + 0 package/lock delta + first generation-84 evidence section (12 lines) + this addendum (10 lines) ≈ 626 lines, well under 1000. No review-budget `size:exception` implied beyond the user's sole generated-output exception.
- Preserved: `.pi/gentle-ai/sdd-preflight.json` byte-identical at SHA-256 `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813`; apply-progress first 1,306 lines byte-identical at SHA-256 `cac8ff4d2e8465172ae73e299dc687bb97c52cbbf06252ee884b7fccf99c5887` before this append; no source/package/lock edits in this rerun (no correctness defect found; no cosmetic churn); no routes, business, tests, config, stage, commit, push, or PR changes; no native operations called; no token handled or exposed. Task 4.2 remains NOT GREEN.

### Task 4.2 first handwritten slice — route group layout, `/vacantes` route files, and server result states (generation 85, work unit `task-4-2-green-route-server-data`)

- Scope executed: exactly four production files, nothing else — `frontend/src/app/(public)/layout.tsx` (11 lines / SHA-256 `9ae28e8d231f49e83a01c2fb7d12b675b9c45c7f69e1bb4209fb1500758f4166`), `frontend/src/app/(public)/vacantes/page.tsx` (58 / `68142d10d2eb27d3221b1f1049b1cf4e793c9c3baadc059f97ee64cd5b41a927`), `frontend/src/app/(public)/vacantes/error.tsx` (31 / `14e9417cbbbbc5fd5863475eae17a418e1325c740659e50469dbf30eb369691a`), and `frontend/src/features/jobs/components/JobsResults.tsx` (125 / `d70e89e9d54eac99f432b2699f955678526032f4295890f16d878ba9b36f87af`); 225 new lines total. No existing test, domain module, primitive, package/lock, config, or global CSS change; the approved `cn` package/lock diff (+1/+10) is untouched and predates this objective.
- Implementation shape: `(public)/layout.tsx` composes the existing `PublicShell` (its actual single-`children` API). `page.tsx` awaits Next 15 `searchParams`, flattens scalar/repeated values, redirects via `next/navigation` `redirect(buildJobsUrl(parseJobsQuery(raw)))` when `isCanonicalJobsQuery` is false — thrown before the query client exists — then creates a fresh request-scoped `QueryClient`, `fetchQuery(listJobsQueryOptions(query))`, and renders the returned validated union directly through `JobsResults`; exports `runtime = "nodejs"` and `dynamic = "force-dynamic"`. No provider, hydration/dehydration, client cache, browser fetch, route handler, Zustand, `loading.tsx`, streaming, or direct `requestJson`/`fetch` call (the requestPath audit stays at exactly the two guarded query functions — an initial `lib/api/server` type import in `JobsResults` was caught by the committed audit and replaced with `Awaited<ReturnType<typeof listJobs>>`). `JobsResults` is a thin Server Component: success = one flat semantic `<ul>` (no nested lists) with Spanish labels via feature formatters and optional fields omitted only when absent; empty = CLI-managed `Empty` primitives with the unfiltered `Quitar filtros` link to `/vacantes`; error = `role="alert"` with a retry link to the canonical current URL. `error.tsx` is a Client boundary with `role="alert"` and an `Intentar de nuevo` button calling `reset`.
- TDD evidence: focused Vitest RED before writes — exactly 4 failed / 4 (`error.tsx` missing, `JobsNavigationIsland` missing ×3). Post-write focused Vitest — 3 failed / 1 passed: the error-boundary test GREEN, exactly the three expected `JobsNavigationIsland` RED assertions remain (next objective). Full suite: 3 failed / 77 passed — the only other failure is the pre-existing committed `requestPath.test.ts` guard, which failed during this objective only until the `JobsResults` transport import was corrected; it passes now (verified in the same full-suite run).
- Playwright evidence (fixture on 127.0.0.1:4010 + production build served by `next start` on 127.0.0.1:3000; runtime `NODE_ENV=development` used solely so the project env validator permits the http loopback fixture origin, since its production policy requires https; `next build` itself ran API-offline with placeholder https origins and passed: `/vacantes` is ƒ dynamic, compiled in 4.2s): PASS `renders empty results with an unfiltered reset link`, PASS `renders a retryable Spanish error without vacancy rows`, PASS `omits unavailable optional metadata` (server success state). PARTIAL `canonicalizes before API access`: the 307-before-API requirement is implemented and directly proven (`curl` on the non-canonical URL → `307` → fixture `GET /__requests` exactly `[]` for the redirect request alone), but the committed test's `expect.poll(/__requests).toEqual([])` runs after Playwright follows the redirect, and the redirect-followed canonical render performs its design-mandated `fetchQuery` (design D2 sequence: canonical → fetchQuery), which the fixture records as `[""]`. The poll is therefore unsatisfiable alongside the mandated unfiltered-list server fetch; skipping that fetch would break the product's default landing state and violate this objective's own fetchQuery requirement, so the test was neither weakened nor the design bent — reported partial instead. The island/filter/sheet scenarios remain for the second handwritten objective.
- Verification results: Node v22.22.1, pnpm 10.34.5, `COREPACK_ENABLE_NETWORK=0`; `tsc --noEmit` pass; `eslint .` pass; full Vitest 3 failed / 77 passed (only island RED); focused Playwright 3 passed / 1 partial as above; `git diff --check` pass; LSP evidence: pi-lens hook reported all four touched TSX files clean on each write plus project-wide tsc clean (standalone lsp_diagnostics remains unavailable in this toolset, as previously disclosed).
- Process/port cleanup: fixture and Next processes SIGTERM/SIGKILLed; ports 3000 and 4010 verified free (`ss -ltn` empty for both) and no `jobs-server`/`next-server` processes remain.
- Preserved: all eight CLI-managed primitives byte-identical (button `dc4f8906…aa85`, empty `81b7341e…55b`, field `dac6ccce…2b8`, input `66262df4…589`, label `8cabc126…e57`, select `3f566eeb…be6`, separator `6b18a02c…f88`, sheet `0a78159a…4eb`); `.pi/gentle-ai/sdd-preflight.json` at SHA-256 `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813` (excluded from accounting); apply-progress first 1,315 lines byte-identical at SHA-256 `65d294e1a3117573a159672bc9db7538b66651909ed69ac9797a618cce8a6753` before this append.
- Budget accounting: 225 new production lines + this evidence section (14 lines) = 239 changed lines ≤ 400. No filter controls, mobile Sheet, pending navigation, or next-cursor controls were implemented; Task 4.2 GREEN checkbox remains `- [ ]`; no stage/commit/push/PR; no native operations called; no token handled or exposed.

### Correction addendum (single allowed gatekeeper rerun) — canonical-proof repair and gatekeeper findings (generation 85)

- Supersedes: only the attempt-1 generated-file hashes/line counts, the partial canonical Playwright result, and the budget accounting in the immediately prior first-handwritten-slice section are superseded by this addendum; all other statements there remain valid. Failed evidence revision remediated: `sha256:2cad24272b8f4b7a3069f34f3efc052a167be4d2ae97baf88c190183a640de07`.
- Authorized canonical-proof repair (`frontend/tests/e2e/vacantes.spec.ts`, canonical test only — every other test byte/meaning preserved): the non-canonical request is now fetched with Node `fetch` in `redirect: "manual"` mode so its raw `307` is inspected without following it, its `Location` is asserted to be canonical `/vacantes` with no query, fixture `/__requests` is asserted exactly `[]` for that redirecting request (browser-observed fixture URLs also `[]`), and the canonical `/vacantes` target is then loaded separately with the expected unfiltered server fetch proven as exactly `[""]`. The redirect-before-API contract is strengthened, not weakened; no production fixture hook was added.
- Gatekeeper findings corrected: `(public)/layout.tsx` no longer calls the route group "authenticated"; `vacantes/error.tsx` composes the CLI-managed `Button` (with a documented `globalThis.React` fallback assignment solely because the vitest classic-JSX runtime needs `React` in scope for CLI primitives that carry no React import — harmless no-op in production); `JobsResults` empty-reset and error-retry actions compose the CLI `Button` via its real `render` prop instead of duplicating button styling. Deviation from the directive's literal `nativeButton={false}`: empirically Base UI's `useButton` then stamps `role="button"` on the rendered anchor, which breaks the committed link-role assertions (`getByRole("link", { name: /quitar filtros/i })`); the composition uses `render={<Link/>}` alone — the same pattern the CLI's own `sheet.tsx` uses — which renders a real anchor with href and preserves both committed tests. Tests were not weakened and no test other than the canonical test changed.
- Authoritative normalization-stable values (two consecutive identical hash/line rounds): `layout.tsx` 11 lines / `4880a9873cac764ed9aa621ac7dd62a34cbb948d125f2a43ea017aabf83fc85d`; `page.tsx` 58 / `68142d10d2eb27d3221b1f1049b1cf4e793c9c3baadc059f97ee64cd5b41a927`; `error.tsx` 35 / `217fa88a7b29a523c3472413409c27d125ac4d1ffe38b4f5f7f826b7e39eeef0`; `JobsResults.tsx` 130 / `9ba91e6b0c7ca3f2f01ed714f00d84d5a4fe789a82c088cefbc63ba912229b38`; `vacantes.spec.ts` / `b4d9cb2c08ad17a5e1fc454ce3ce7d2a87b74fb59f38fadbcabec4d0f196be11`.
- Final test counts: focused Vitest 3 failed / 1 passed (error boundary GREEN, only the three expected `JobsNavigationIsland` RED); full Vitest 3 failed / 77 passed (80); focused Playwright 4 passed / 0 failed — repaired canonical proof plus empty, error, and server-success-metadata scenarios against the fixture (127.0.0.1:4010) and the production build served by `next start` (127.0.0.1:3000, runtime `NODE_ENV=development` solely for the validator's http-loopback allowance, as disclosed in attempt 1); API-offline `next build` passed (`/vacantes` ƒ dynamic, compiled 2.4s); `tsc --noEmit` pass; `eslint .` pass; `git diff --check` pass; fixture/Next processes SIGTERM/SIGKILLed with ports 3000/4010 verified free and no remaining processes.
- Corrected objective accounting (complete generation-85 objective including this correction): 234 production lines (11 + 58 + 35 + 130) + canonical-test repair (~29 changed test lines: 28 inserted / 11 deleted per numstat) + attempt-1 evidence section (14 lines) + this addendum (14 lines) ≈ 291 changed lines ≤ 400. All eight CLI primitives byte-identical, `cn` package/lock diff untouched (+1/+10), `page.tsx` core canonical-before-query-client and fresh QueryClient/`fetchQuery` implementation preserved.
- Preserved: `.pi/gentle-ai/sdd-preflight.json` byte-identical at SHA-256 `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813`; apply-progress first 1,326 lines byte-identical at SHA-256 `82dbc25c59859fb46b3c030dab8277ea7c9e192bea3d5915a09ca6f2f724123e` before this append; Task 4.2 GREEN checkbox still `- [ ]`; no filters, Sheet, pending island, next-cursor, or detail behavior implemented; no stage/commit/push/PR; no native operations called; no token handled or exposed. Task 4.2 remains NOT GREEN pending the second handwritten objective.

### Task 4.2 second handwritten slice — navigation island, filters, pagination (generation 86, work unit `task-4-2-green-navigation-filters-pagination`)

- Scope executed: exactly five production/test-support surfaces — `frontend/src/features/jobs/components/JobsNavigationIsland.tsx` (new), `frontend/src/features/jobs/components/JobsResults.tsx`, `frontend/src/app/(public)/vacantes/page.tsx`, `frontend/src/app/(public)/vacantes/error.tsx`, and `frontend/vitest.config.ts` — plus this evidence section. No generated primitive, package/lock, domain module, test file (the canonical test file was not edited this objective; its post-normalization whole-file hash is `416aa30e3cca52a708a8090580a06b4db38d7d1bdfd3892d2d7cb11e8d283f2e` with meaning identical), backend, route-handler, or config-other-than-vitest change.
- Island design: `JobsNavigationIsland` is the single minimal Client island owning only pending URL navigation and the Base UI filter/Sheet composition. It keeps the committed unit-test API (`children`, `routeKey`); the optional typed `query` prop activates the real composition (search form, 240–280px desktop `Filtros` form, mobile titled `Filtros` Sheet). Every commit routes through the feature URL helper `buildFilterCommitUrl(routeKey, patch)` built from the submitting form's `FormData`: search preserves scalar filters and drops the cursor; scalar-filter apply preserves `q` and drops the cursor. Pending state (`Cargando…` in a `role=status` `aria-live=polite` region) clears only when `routeKey` changes, restoring the initiating submitter and clearing `aria-busy` from the clicked link only. Generic root submit/click capture boundaries keep the committed fixture contract (non-island forms navigate to their declared `action`; child anchors are intercepted with per-link `aria-busy`). No client cache, Zustand, duplicated durable filter state, browser fetch, router.refresh, or route handlers.
- Other edits: `page.tsx` adds the level-1 `Vacantes` heading and composes the island around server results with `routeKey={buildJobsUrl(query)}` — redirect-before-QueryClient, fresh request-scoped `QueryClient`, and `fetchQuery` unchanged. `JobsResults.tsx` renders vacancy titles as descriptive links to `/vacantes/${job.id}` and a `Ver más vacantes` Button-styled anchor (CLI `Button render={<Link/>}`, no `nativeButton={false}`, matching the empirically settled generation-85 pattern) only when `next_cursor` exists, via `buildJobsUrl({...query, cursor: next_cursor})` so filters and opaque cursor bytes are preserved. `error.tsx` drops the production `globalThis.React` workaround, keeping the CLI `Button` composition. `vitest.config.ts` adds test-only `esbuild: { jsx: "automatic" }` (the correct compatibility for unchanged CLI primitives with no React import) and the `@` → `./src` resolve alias required by `field.tsx`'s `@/components/ui/label` import once the island entered the unit-test module graph.
- TDD evidence: pre-write focused Vitest exactly 3 failed / 1 passed (only missing island); post-write focused Vitest 4 passed / 4; full Vitest 16 files / 80 tests ALL GREEN; typecheck (`tsc --noEmit`) pass; lint (`eslint .`) pass; API-offline `next build` pass (`/vacantes` ƒ dynamic 62.5 kB, compiled 5.8s).
- Playwright evidence: complete committed `frontend/tests/e2e/vacantes.spec.ts` run against the fixture (127.0.0.1:4010) and the production build served by `next start` (127.0.0.1:3000, runtime `NODE_ENV=development` solely for the validator's http-loopback allowance as previously disclosed): all 11 scenarios GREEN — fixture health, repaired canonical proof, semantic results with labeled scalar desktop filters, 240–280px desktop filter column beside flexible results, empty/reset, retryable error without rows, isolated pending search, isolated pending scalar-filter, pending next with opaque cursor preservation, titled Base UI mobile filters Sheet, and optional-metadata omission. The full `tests/e2e` directory run passed 24/24 (including all 13 root.spec foundation scenarios — no regressions). Tests were never weakened.
- Normalization-stable values (two consecutive identical hash/line rounds): `JobsNavigationIsland.tsx` 311 lines / `b47d4842f990183a2649925cd44fb3be57f6b5e2e0eb77c4a6f306685c5dbe19`; `JobsResults.tsx` 150 / `10176dff470fe3f2ed51f3daa3e4f5ab8f234cda477bbc65bb52618f0747fdb7`; `page.tsx` 68 / `9a75f441ca76576837211cb233e1083b3e3520aec01578f97d28583a6a87ae0d`; `error.tsx` 29 / `e7ebb1a3943a1eaf50a807eafe2b6036cd7329bff3056a4ac15470036cc5c3d0`; `vitest.config.ts` 18 / `aa3d9f115217fa8bd6f7d1bd6fc4e2d03e59a6b745da801eb5647a035a93a061`.
- Objective accounting: island 311 (new) + JobsResults +20 + page +10 + error −6 + vitest.config +9 + this evidence section (14) = 358 changed lines ≤ 400. No `size:exception` used or implied.
- Preserved: all eight CLI primitives byte-identical (hashes below unchanged from generation 85); approved `cn` package/lock diff (+1/+10) byte-identical; `.pi/gentle-ai/sdd-preflight.json` at SHA-256 `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813` (excluded from accounting); apply-progress first 1,336 lines byte-identical at SHA-256 `9a34b64ca6c36bc63010b80f28fab83d4b509d4eb31db07aef2439725bc8ae88` before this append; Task 4.2 GREEN checkbox remains `- [ ]` and Task 4.3 untouched.
- Process/port cleanup: fixture and Next processes SIGTERM/SIGKILLed; ports 3000 and 4010 verified free and no `jobs-server`/`next-server`/`next start` processes remain. No stage/commit/push/PR; no native operations called; no token handled or exposed.
- Generation 87 corrective addendum — remediation of failed evidence revision `sha256:a4de2ca14aa64a61df74c3dd9f1b2f1e7e6ae07856f9cd8610ae43764fe83289`: applied exactly the four maintainer-narrowed compact `JobsNavigationIsland.tsx` corrections — (1) the FormData condition is now the normalization-stable two-line shape `if (typeof value === "string" && key !== "cursor")` over the unchanged patch assignment, retaining empty string values so clearing q/location deletes them through `buildFilterCommitUrl` while explicitly excluding cursor keys so form commits can never inject a cursor (filter commits always drop cursor), (2) the one-line form-only no-op guard `if (!link && url === routeKey) return;` at the very start of `startNavigation`, (3) the one-line anchor guard `if (query && anchor.textContent?.trim() !== "Ver más vacantes") return;` before `preventDefault` so only the real next link is intercepted/aria-busy while title/retry/reset links keep native semantics, and (4) exactly one normalized CLI line `<Button render={<a href="/vacantes" />}>Limpiar filtros</Button>` at the end of shared `FilterFields` — a real accessible link with the distinct Spanish name `Limpiar filtros`, no role override, no false ARIA, no import — leaving the frozen EmptyState `Quitar filtros` locator unambiguous; final normalized Island: 320 lines / SHA-256 `f2e039cfff9daffe558fcb7a8391b3be7111fc09ac3c4350f80cb696b1a19f66`, verified across two consecutive identical rounds; verification: focused Vitest 4/4, full Vitest 80/80, typecheck pass, lint pass, API-offline `next build` pass, focused committed `vacantes.spec` E2E 11/11 GREEN including the empty/reset scenario, and an out-of-repo probe proving `Limpiar filtros` reaches exactly `/vacantes`, same-URL apply leaving the initiator enabled with no pending text, empty-search q deletion with currency preservation, and title/retry/reset links navigating natively while the next link alone stays intercepted with `aria-busy`; preserved invariants: all eight CLI primitives byte-identical, approved `cn` package/lock diff byte-identical, canonical test bytes `416aa30e3cca52a708a8090580a06b4db38d7d1bdfd3892d2d7cb11e8d283f2e`, preflight `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813`, first 1,348 apply-progress lines byte-identical at `c83912887c564fcf048e1bdced7f8b4f54c94bbb15af670f57d13bbaa8d64e5d` before this bullet replacement, Task 4.2 `- [ ]`; exact begin-tree (`f627eb76ed0d87cea3e468edfce8f603dfeb8e33`) no-index diff: Island +4/-1 (one replaced condition line plus three one-line additions) plus this single progress insertion = 6/6, with no other file touched, no stage/commit/push/PR, no native operations, and no token exposure.

### Generation 88 independent-verifier remediation — RED→GREEN acceptance hardening for Task 4.2 controls (`task-4-2-independent-verifier-remediation`)

- Supersedes: any stale generation-86 normalization/hash/line-count/accounting claims for the island, `JobsResults`, `page.tsx`, and the E2E spec below are superseded by this section's final normalized values; all prior narrative evidence above remains historically valid. RED evidence captured before any production edit, per test against the then-current production build: raw-redirect proof returned 200 instead of 307 (empty/repeated raw values invisible to canonicalization); Back-restore asserted stale trigger text `USD` where canonical `Todas` was required; null-option click timed out (option absent); modified next-link click opened no popup (interception ignored modifiers); mobile trigger height measured below 44px.
- Production corrections: `page.tsx` raw search reconstruction now preserves empty and repeated values verbatim so `isCanonicalJobsQuery` redirects `/vacantes?q=` and `/vacantes?q=&q=frontend` (307 to `/vacantes`, zero fixture requests) before the query client exists, and keys the real island composition by canonical `routeKey` so uncontrolled controls restore from the URL on Back/Forward without durable client state; `JobsNavigationIsland.tsx` adds explicit Base UI null `SelectItem` options (`Todas`/`Todas`/`Todos`/`Todas`), wraps fields in `FieldGroup` and items in `SelectGroup`, gates the click capture on the structural `data-jobs-next-link` marker plus native-semantics guards (defaultPrevented, non-primary button, Ctrl/Meta/Shift/Alt, target, download), raises the mobile trigger to `h-11`, and replaces the sheet's default close with `showCloseButton={false}` plus a CLI `SheetClose`/`Button` named `Cerrar filtros` at `h-11`; `JobsResults.tsx` marks only the `Ver más vacantes` anchor with `data-jobs-next-link="true"` (title/reset/retry stay native). No generated primitive, dependency, domain module, or prior test behavior changed.
- RED→GREEN: the five new focused scenarios (27 new spec lines beyond the extended flow) failed individually before the edits and all pass after; full `vacantes.spec` 11 old + 5 new = 16/16 GREEN; full Playwright directory 29/29 GREEN; focused Vitest 4/4; full Vitest 16 files / 80/80 GREEN; `pnpm install --frozen-lockfile --offline` clean (no dependency drift); typecheck/lint pass; API-offline build pass (`/vacantes` ƒ dynamic 62.9 kB); `git diff --check` pass. One test-mechanism correction during GREEN: modifier-click tab detection uses `context().waitForEvent("page")` because `page.waitForEvent("popup")` does not fire for Control-clicked navigations in this Chromium/Playwright combination (probe-proven: context pages 1→2, original URL unchanged, no aria-busy) — assertions unchanged in strength.
- Final normalized values (two consecutive identical hash/line rounds): `JobsNavigationIsland.tsx` 364 lines / `e87744c7416807e17000ede115d819a1e667550a4fe54d1fc78a2012ebfadf8d`; `JobsResults.tsx` 151 / `e9a28fa7ef1155198fe83ad2531fa2db71b1144f561bfc361c9994432b040b86`; `page.tsx` 74 / `a90b99d3b44835b35b2de7afa7259fdad5cb1f2366be1d7717446b671064e9f9`; `vacantes.spec.ts` 272 / `33d816907accc5121c66a0e96f64cce9d10eecc05a6fc07f766ce294ac3c0fb4`.
- Objective budget: spec +77 (195→272), island +44 (320→364), `JobsResults` +3 (148→151), `page.tsx` +6 (68→74) = 130 code lines + this 9-line section = 139 ≤ 400. No `size:exception` used or implied.
- Preserved invariants: all eight CLI primitives byte-identical; approved `cn` package/lock diff byte-identical; canonical proof scenario meaning intact; preflight `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813` (excluded from accounting); first 1,349 apply-progress lines byte-identical at `f6711a284473cfff31bf7319abb0dff3ecd7c70e482d9a5b05087fd544cad45b` before this append; Task 4.2 `- [ ]`, Task 4.3 untouched; process/port cleanup verified (ports 3000/4010 free, no fixture/Next processes); no stage/commit/push/PR; no native operations; no token exposure. Task 4.2 remains `- [ ]` at the parent's discretion.

### Generation 88 corrective addendum (attempt 2/2) — search `FieldGroup` composition and stale-hash supersession

- Supersedes: only the stale normalized hashes/line counts and objective accounting inherited from attempt 1 (whose evidence revision failed as `sha256:c755c0c6ca31c599d61b96f06f0150c1edb2afd83ce49d5d8794d0adf814551b`) are superseded by this addendum; all other generation-88 statements remain valid. Host normalization after attempt 1 established the pre-correction authoritative values Island 360 lines / `024442d4a5619294d11c2b1788bd51ac75cb0c117f505e2ffb8fc5f34bf544f4` and `JobsResults.tsx` 151 / `a8b4b66e4588ca897b4521d2525cd64cd4ddb07846b0ce3986502acff2df4151` (JobsResults untouched by this correction and re-verified at exactly those bytes).
- Correction: the search form's single `Field` is now wrapped in the CLI-managed `FieldGroup` (className `min-w-0 flex-1 gap-0`), so all three island forms compose `FieldGroup` while preserving the flexible search width and desktop/mobile layout behavior; no behavioral or architectural change.
- Final gates after the code edit (formatting-sensitive LSP/lint first): `tsc --noEmit` pass, `eslint .` pass, focused Vitest 4/4, full Vitest 16 files / 80/80, `pnpm install --frozen-lockfile --offline` clean, API-offline `next build` pass (`/vacantes` ƒ dynamic 62.9 kB), focused committed `vacantes.spec` 16/16, full Playwright directory 29/29, `git diff --check` pass, fixture/Next processes terminated with ports 3000/4010 free and no remaining processes.
- Final normalization-stable values (three consecutive identical hash/line polls separated by waits): `JobsNavigationIsland.tsx` 362 lines / `92d799b58b66f455b65895bbc8ad0d698730ed5350854a0a0633dfbc7440a96e`; `JobsResults.tsx` 151 / `a8b4b66e4588ca897b4521d2525cd64cd4ddb07846b0ce3986502acff2df4151`.
- Objective accounting (generation-88 cumulative, ≤400): code deltas vs the generation-88 begin state — spec +77 (195→272), island +45 (360→362 plus the begin-state reflow), `JobsResults` +3 (148→151), `page.tsx` +6 (68→74) = 131 code lines + first evidence section (9) + this addendum (10) ≈ 150 ≤ 400. Preserved: all eight CLI primitives byte-identical, approved `cn` package/lock diff byte-identical, preflight `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813`, first 1,358 apply-progress lines byte-identical at `5911faef980b0fba6015c865a87123ce65e57439fff3383ba1d8e6387f65f03c` before this append, canonical test meaning intact, Task 4.2 `- [ ]`, Task 4.3 untouched, no stage/commit/push/PR, no native operations, no token exposure.

### Task 4.2 normalized evidence reconciliation — independent gates pending

- This append supersedes the stale Island hash and the generation-88 totals 139/approximately 150 above; historical test results remain writer-reported, not independent verification of the current bytes. Preserved prefix: 250487 bytes, 1366 lines, SHA-256 `266d792b1c1f3ac09a92e905436408d5e82f2fd412cf9163dadd8de83d7dbc7d`.
- Current SHA-256 values: Island (362 lines) `926543a492ecd48e1d8fe46c4f5a35d3ab6dea3c7a3273614cbedab209bbbeca`; Results (151) `a8b4b66e4588ca897b4521d2525cd64cd4ddb07846b0ce3986502acff2df4151`; page (74) `a90b99d3b44835b35b2de7afa7259fdad5cb1f2366be1d7717446b671064e9f9`; E2E (272) `33d816907accc5121c66a0e96f64cce9d10eecc05a6fc07f766ce294ac3c0fb4`.
- Measured cumulative changed-line accounting before this append: native completed delta 199 plus current delta against `b5857895b32eb26268de163c6bd4f7a505b726b7` (Island +11/-9; progress +8/-0) = 227/400; this five-line append makes 232/400. This counts additions plus deletions, not net growth; settlement remains the final native accounting authority.
- Every existing file in that begin tree except Island and progress matches its stored bytes, including eight generated primitives and approved package/lock files. HEAD remains `9f5c8bbec93a91e50c0488ccea7f77f2005e4545`; index empty; protected preflight SHA-256 `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813`. No source edits in this reconciliation; Task 4.2 remains unchecked pending independent gates, settlement, review, and explicit user closure authorization; Task 4.3 and delivery operations remain out of scope.
- Post-format supersession: the preceding five-line/232 total describes the pre-autofix append only, not the normalized candidate. Automatic Markdown spacing preserved the entire 250487-byte prefix but produced progress +15/-0 against the attempt begin tree, yielding 234 cumulative lines before this note. Final inclusive accounting must be remeasured after normalization and admitted by native settlement; no budget increase is authorized.
- Independent final verification supersedes the pending-gates status above: pinned Node v22.22.1 / frontend Corepack pnpm 10.34.5 / COREPACK_ENABLE_NETWORK=0; frozen offline install, typecheck, lint, 80/80 Vitest (16 files), API-offline production build, and 29/29 Playwright (16 vacancy scenarios) passed. All five corrected regression cases passed; close-button 44px size was checked statically, trigger size in E2E. Production-built next start used the documented development NODE_ENV solely for HTTP loopback, not production environment parity; existing test HTML-nesting/deprecated-matcher warnings remain disclosed. Logs: /tmp/task42-verification.UirxT8/.
- Independent before/after comparison preserved 500 begin-tree paths without runtime drift; inventory SHA-256 458c60daba8389d7294ebc94d59fdca79bd2c40e230eabcc20e48bfc9e2eaf60. Measured pre-result-append cumulative accounting was 235/400 (199 settled + Island11/9 + progress16/0); subsequent evidence additions are included by final settlement. Parent primary LSP checked Island, Results, page and E2E: 4 clean, zero unavailable/inconclusive; session lens diagnostics clean. Index empty, ports free, protected prefix/preflight preserved; Task4.2 unchecked and no delivery authorized.

## Final closure: Task 4.2 GREEN complete

- User-authorized implementation commit `25e7f6ebe3bb18f721ebd0c31441ad0a7cbb123d` (`feat(frontend): implement public vacancy discovery`) landed with tree `08a262227fd7055fc57dad8465e7e482cabe9d6e`, exactly matching the independently verified and acknowledged candidate. Task 4.2 alone is now checked: 11/22 complete; Task 4.3 remains unchecked and unstarted.
- Final independent evidence remains the exact-byte record above: Node v22.22.1, frontend Corepack pnpm 10.34.5, COREPACK_ENABLE_NETWORK=0; frozen offline install, types, lint, 80 unit tests, API-offline build and 29 Playwright tests passed, plus parent clean LSP. The documented HTTP-loopback NODE_ENV limitation remains. Additional precommit verifier workers exited without results; no extra pass is claimed.
- Remediation settled complete at 237/400 against evidence `sha256:e4248f2918ed29a70f6359d19b9059611ee315f291cbded8fc7dd649e7971c50`; the implementation-commit objective also settled complete. Review `review-2ee47792bc867716` approved target `sha256:4fa2e2e2285922729f1aba078835231353bbcec9cb7d68dab38d58ffaa8f0664`; exact acknowledgement consumed revision `sha256:cd015ba272fe05f44e61b7e23ca7c922bd45e913f62a011595bfe76565023f86` and burned authority. Neither attempt nor review tokens may be reused.
- This closure changes only the Task 4.2 checkbox and this append-only evidence. Protected preflight remains excluded and untouched at SHA-256 `43098a2b3589126267373d8c8a4336e0eb2456f3f6ceb80ac5f75cdff988c813`; no source, primitive or dependency changed during closure; no push or PR. Rollback: revert the implementation commit for behavior, and revert the separate closure commit to reopen Task 4.2; neither operation is performed here.
