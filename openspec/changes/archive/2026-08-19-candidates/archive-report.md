# Archive Report — `candidates`

**Archived**: 2026-08-19
**Source**: `openspec/changes/candidates/`
**Target**: `openspec/changes/archive/2026-08-19-candidates/`
**Cycle**: complete — planning → apply → verify → archive

---

## Final State (per Final-State Authority hierarchy)

Highest-ranked sources for these facts: native review authority (none discovered — `reviewGate` structurally absent), the persisted tasks artifact (21/21 complete), explicit final-state facts in the orchestrator launch prompt, and the post-apply gate context (`verify-report.md`). All four agree.

| Surface | Status | Evidence |
|---|---|---|
| `tasks.md` completion | 21/21 `[x]`, 0 unchecked | `openspec/changes/archive/2026-08-19-candidates/tasks.md` |
| `verify-report.md` | PASS WITH WARNINGS | `openspec/changes/archive/2026-08-19-candidates/verify-report.md` |
| Critical issues | 0 | `verify-report.md` |
| Blockers | 0 | `verify-report.md` |
| Requirements covered | 7/7 | `verify-report.md` |
| Scenarios covered | 18/18 | `verify-report.md` |
| `reviewGate` | structurally absent (kill switch off; no review ever discovered) | orchestrator launch prompt; no `reviews/` folder in the change |
| Active change folder | `openspec/changes/candidates/` removed | post-archive `ls openspec/changes/` |

No contradictions were detected between the launch prompt's final-state facts, the persisted `verify-report`, and the persisted `tasks.md`. Where the launch prompt asserts post-verify resolutions ("verify warnings are non-blocking", "21/21 tasks complete"), they are consistent with the persisted artifacts.

---

## Specs Synced

Two delta specs were applied to the main specs (source of truth). The merge preserved every requirement in the existing main spec except the requirement explicitly MODIFIED by the delta.

| Domain | Main spec before | Action | Main spec after |
|---|---|---|---|
| `candidates` | did not exist | Created (mechanical `cp` + `mv`, see Mechanical Evidence) | `openspec/specs/candidates/spec.md` (full delta) |
| `identity` | `openspec/specs/identity/spec.md` | MODIFIED — `JWT Middleware` requirement body + scenario `zero routes wrapped` → `/me/* route subtree is wrapped`; the other two scenarios and the requirement title preserved | `openspec/specs/identity/spec.md` |

After the sync, `openspec/specs/identity/spec.md` still contains 10 requirements (9 unchanged + JWT Middleware updated). No REMOVED or RENAMED requirements were issued.

### Delta `identity` — what changed inside the `JWT Middleware` block

- **Body**: `... MUST be registered in cmd/api/main.go but NOT attached to any route in this slice.` → `... MUST be attached to the /me/* route subtree in cmd/api/main.go. (Previously: middleware was registered in cmd/api/main.go but NOT attached to any route in this slice.)`
- **Scenario title**: `zero routes wrapped` → `/me/* route subtree is wrapped`
- **Scenario body** (WHEN / THEN):
  - old — `WHEN every chi.Mount/With/Use is checked` / `THEN zero routes pass through the JWT middleware`
  - new — `WHEN every chi.Mount/With/Use on /me/* paths is checked` / `THEN at least one route under /me/* passes through the JWT middleware`
- **Preserved**: `Scenario: valid token populates claims`, `Scenario: invalid cases return 401`

---

## Archive Contents

```
openspec/changes/archive/2026-08-19-candidates/
├── archive-report.md            ← this file (additive, post-move)
├── design.md
├── exploration.md
├── proposal.md
├── specs/
│   ├── candidates/spec.md
│   └── identity/spec.md
├── tasks.md                     ← 21/21 tasks marked [x]
└── verify-report.md
```

All pre-move artifacts are present and byte-identical to their pre-archive versions (see Mechanical Evidence). The active `openspec/changes/` directory no longer contains this change.

---

## Source of Truth Updated

The following main specs now reflect the new behavior:

- `openspec/specs/candidates/spec.md` — full candidate profile + JWT-middleware-mounted-on-`/me/*` specification (new domain).
- `openspec/specs/identity/spec.md` — `JWT Middleware` requirement updated to require attachment to `/me/*` route subtree.

These files are the source of truth for future verification and the next change that amends them.

---

## Mechanical Evidence (MANDATORY readback)

Archival is a mechanical filesystem operation. Each copy and move below was verified by a structural `diff -r` against a pre-operation snapshot. Empty `diff -r` output is the only passing evidence; a skipped or non-empty `diff -r` would fail the phase.

### Step 1 — Create new `openspec/specs/candidates/spec.md` (mechanical `cp` + `mv`)

```
$ diff -r /home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes/openspec/changes/candidates/specs/candidates/spec.md <temp_copy>
(no output)
$ mv <temp_copy> /home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes/openspec/specs/candidates/spec.md
```

Verbatim `diff -r` output: **empty** — byte-identical.

### Step 2 — Apply MODIFIED delta to `openspec/specs/identity/spec.md`

This was a content edit (merge), not a copy. The Edit tool replaced the `JWT Middleware` requirement block atomically. Post-edit verification:

```
$ grep -c '^### Requirement:' openspec/specs/identity/spec.md
10
$ sed -n '/^### Requirement: JWT Middleware/,$p' openspec/specs/identity/spec.md
### Requirement: JWT Middleware
The middleware MUST verify an RS256-signed JWT ... MUST be attached to the `/me/*` route subtree in `cmd/api/main.go`.
(Previously: middleware was registered in `cmd/api/main.go` but NOT attached to any route in this slice.)
...
#### Scenario: /me/* route subtree is wrapped
- GIVEN a static scan of `main.go`
- WHEN every `chi.Mount`/`With`/`Use` on `/me/*` paths is checked
- THEN at least one route under `/me/*` passes through the JWT middleware
```

10 requirements preserved; JWT Middleware block matches the delta spec exactly.

### Step 3 — Move to archive (mechanical `git mv`)

```
$ git -C /home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes mv openspec/changes/candidates openspec/changes/archive/2026-08-19-candidates
Moved via git mv

$ diff -r /tmp/sdd-archive.X9drNO/source openspec/changes/archive/2026-08-19-candidates
(no output)

$ test ! -e openspec/changes/candidates && echo SOURCE_GONE
SOURCE_GONE
```

Verbatim `diff -r` output: **empty** — byte-identical against the pre-move recursive snapshot. The `archive-report.md` was not present in the snapshot (it is additive and post-move), so it is correctly excluded from the comparison per the Mechanical Copy Contract.

---

## Task Completion Gate

`openspec/changes/candidates/tasks.md` inspection:

- `grep -c '^- \[ \]'` → `0`
- `grep -c '^- \[x\]'` → `21`

No unchecked implementation tasks. Gate passes; no reconciliation needed (no stale checkboxes for completed work).

---

## Review Receipt Gate

`reviewGate` is **structurally absent** — the receipt-driven review kill switch is off for this candidate, and no review was ever discovered. Per the Native Review Receipt Gate contract, this is **not a defect**: archive proceeds under ordinary repository policy. No `reviews/{transaction,ledger,receipt,gate-context}.json` files exist; no envelope was read; none needed to be.

---

## Outstanding Warnings (carried from `verify-report.md`)

These are non-blocking and **do not affect archive eligibility**. They are recorded here so a future reader does not mistake them for defects requiring rework.

1. **Pre-existing `companies/` gofmt non-cleanliness** — 2 files in `backend/internal/companies/` are not gofmt-clean (out of scope for `candidates`; not modified by this change). No action required.
2. **DB-boundary CHECK-constraint test gap** — the `candidate_profiles` schema relies on Postgres CHECK constraints, but integration tests assert domain-layer rejection rather than the DB-layer CHECK itself. Documented in `tasks.md`; behaviorally equivalent (rejection happens pre-write). No action required.
3. **RED-before-GREEN not independently git-reconstructable** — `tasks.md` documents this and verify-report acknowledges that the `git show <sha>` reconstruction is approximate (a moved/shared `domain/repositories/candidateRepository.go` makes per-WU atomic RED commits partially fungible). Test results in the present tree prove the GREEN half. Documented; no action required.

---

## Phase Result

- Status: **success**
- Specs synced: 1 created (`candidates`), 1 updated (`identity`).
- Archive folder: `openspec/changes/archive/2026-08-19-candidates/`.
- Source folder gone from active `openspec/changes/`.
- All mechanical copy/move operations verified by empty `diff -r` readback.
- Task Completion Gate passed (21/21 checked, 0 unchecked).
- Review Receipt Gate not applicable (`reviewGate` absent; no review discovered).
- No CRITICAL issues, no blockers.

**SDD cycle complete** for `candidates`. Ready for the next change.