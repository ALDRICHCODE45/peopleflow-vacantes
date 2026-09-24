# Employer Pipeline Redesign

## Goal

Redesign the employer vacancy pipeline as a compact, information-rich Kanban inspired by the supplied project-board reference while preserving PeopleFlow's frozen four-stage vocabulary, truthful read-only prototype behavior, and existing board/list functionality.

## Reference

- `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-22-13-39-37_5360x2520.png`
- Direction extracted from the reference: compact neutral columns, small rich cards, prominent status/priority-like semantic accents, identity avatars, dense metadata, and deliberate horizontal board overflow.

## Scope

- Preserve stages and order exactly: `submitted`, `in_review`, `hired`, `rejected` (`Nuevos`, `En revisión`, `Contratados`, `Descartados`).
- Preserve local diacritic-insensitive search, board/list switching, filtering, stage counts, all fixture fields, and recovery states.
- Preserve props-only immutable behavior: no drag/drop, stage transitions, candidate creation, network mutation, router mutation, storage, fake filters, fake sorting, or unsupported actions.
- Recompose the search and view controls with installed shadcn InputGroup and ToggleGroup.
- Recompose board columns and candidate cards with installed Card, Avatar, and Badge primitives.
- Recompose the list with installed Table primitives and recovery/empty states with Empty.
- Reuse global `status-info`, `status-review`, `status-success`, and `status-danger` tokens; do not add raw colors to feature code.
- Keep native horizontal scrolling; do not install ScrollArea or any dependency.
- Keep existing `data-pf-*` hooks, route contracts, frozen fixtures, and employer shell behavior.
- RDD remains disabled for this work unless the user explicitly changes that decision.

## Acceptance Criteria

- Board remains four fixed semantic columns in the canonical order with honest filtered counts.
- Candidate cards use shadcn Card hierarchy, real heading semantics, initials Avatar, text-labelled match/source/skill metadata, comment/activity/owner details, and no interactive or draggable affordance.
- Search and board/list switch are keyboard accessible with at least 40px control targets.
- List mode uses the installed shadcn Table while retaining semantic rows, all canonical fields, and native horizontal overflow.
- Empty/recovery states use shadcn Empty and preserve exact truthful copy.
- Semantic stage colors remain supplemental to text and work in light/dark themes.
- Desktop/mobile layouts have no document horizontal overflow, serious/critical Axe findings, mutation requests, or local/session storage writes.
- No dependency, API, backend, auth/session, fixture, route, or model changes.

## Tasks

- [x] EPR-01 — Define RED contracts for shadcn composition, semantic stage accents, and unchanged read-only behavior.
- [x] EPR-02 — Recompose search and board/list controls with InputGroup and ToggleGroup.
- [x] EPR-03 — Recompose columns and candidate cards with Card, Avatar, Badge, and compact reference-aligned density.
- [x] EPR-04 — Recompose list and empty/recovery states with Table and Empty primitives.
- [x] EPR-05 — Verify focused contracts, route integration, themes, responsive board/list layout, Axe, overflow, and no side effects.

## Evidence

- Exploration: current workspace is props-only and owns only local `query` and `view` state; the source contract already forbids network/router/storage/drag behavior.
- Exploration: four canonical columns and counts derive from the filtered immutable input through `summarizeCandidateStages`.
- Exploration: ToggleGroup, InputGroup, Card, Avatar, Badge, Table, and Empty are already installed; no registry installation is required.
- Visual decision: adapt the reference's compact project-card language without copying its unsupported add-column, filter, sorting, grouping, or mutation controls.
- RED evidence: the focused pipeline suite started with 13 intentional shadcn-composition failures and 19 preserved behavior passes; the failures cover Badge/Card/Avatar/InputGroup/ToggleGroup/Table/Empty and the exact primitive import/style contract, with no unrelated failure.
- Controls GREEN: InputGroup search and controlled ToggleGroup reduced the suite to 7 remaining EPR-03/04 failures and 25 passes; TypeScript and diff checks pass.
- Board/Card GREEN: semantic stage count Badges and Card/Avatar/Badge candidate composition reduced the suite to 4 remaining EPR-04 failures and 28 passes; TypeScript and diff checks pass.
- List/Empty GREEN: installed Table and Empty composition closed the focused suite at 32/32; TypeScript, focused ESLint, and diff checks pass.
- Runtime visual correction: the first browser pass found the shared Table wrapper had stolen horizontal scroll from the focusable list region and card identity text was ellipsized. Product-local table-container neutralization plus natural identity wrapping moved the focused suite through two explicit RED/GREEN corrections to 33/33.
- Final visual evidence: `/tmp/peopleflow-employer-pipeline-redesign/manifest.json` plus six light/dark desktop and light mobile board/list PNGs. Desktop columns are 265px; mobile columns are 231px; the outer list region owns 1322px content inside 1094px desktop/356px mobile. No document overflow, console/page errors, non-GET requests, or storage writes were observed.
- Final static acceptance: 5 employer-vacancy/route test files / 77 tests pass; TypeScript, focused ESLint, LSP error diagnostics, and `git diff --check` pass.
- Final Chromium acceptance: 5/5 employer workspace tests pass in 30.0s, including keyboard board/list switching, shadcn structure, distinct stage tones, accessible outer-region scrolling, whole-surface Axe, responsive overflow, and mutation/storage checks. One verifier first invoked pnpm from the repository root and hit the known no-package error; the exact frontend-directory command then passed.
- RDD remained disabled. No native review transaction was started.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

## Delivery Evidence

- Implementation commit: `0b94a4f` — `feat(frontend): complete workspace redesign and presentation cleanup` (verified product, tests, E2E, design guide, routes, and cleanup).
- Relevant to this record: `0b94a4f`.
- This task record and its documentation update remain untracked and are committed later by the parent, so no hash is claimed here.
- Push, PR creation, merge, deployment, release, install, remote operation, and protected-service mutation remain unauthorized and were not performed.
- Native Gentle review remained unavailable because the package-local binary is missing; the independent verification evidence above remains authoritative.
