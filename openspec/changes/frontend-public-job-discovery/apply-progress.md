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
