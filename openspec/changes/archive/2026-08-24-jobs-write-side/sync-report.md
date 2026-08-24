# Sync Report: `jobs-write-side`

- **status**: `synced`
- **change**: `jobs-write-side`
- **artifact store**: `openspec` (file-backed, authoritative)
- **domains synced**: `jobs`
- **canonical files updated**: `openspec/specs/jobs/spec.md`
- **delta type**: purely additive — `## ADDED Requirements` only (no MODIFIED / REMOVED / RENAMED)
- **destructive sync**: none (no REMOVED requirements, no large MODIFIED blocks — no approval required)
- **active same-domain collisions**: none (`sameDomainActiveChanges: []`; only active change is `jobs-write-side`)

---

## 1. Delta merged

Appended the 9 ADDED write-side requirements from `openspec/changes/jobs-write-side/specs/jobs/spec.md` into the canonical `openspec/specs/jobs/spec.md`, preserving heading hierarchy (`## ADDED Requirements` → `### Requirement: …` → `#### Scenario: …`) and Markdown formatting:

1. `PATCH /jobs/{id}` Endpoint and Gate
2. Field Editability Matrix
3. Status Transition Table
4. CAS Optimistic Concurrency
5. Domain Validation Rules
6. Same-Company Invariant and IDOR Defense
7. Editor Response DTO
8. Write Route Security Boundary
9. Error Taxonomy

**ADDED: 9** | **MODIFIED: none** | **REMOVED: none** | **RENAMED: none**

Canonical result: **17 requirements** (8 read-side preserved unchanged + 9 write-side added), **68 scenarios** (29 read-side + 39 write-side, matching verify report 39/39).

## 2. Canonical prose updates

- **Intro**: replaced "Read-only slice: candidates browse published jobs from active companies." with a read-path + gated-write-path description (`PATCH /jobs/{id}`).
- **`## Out of scope (deferred)`**: rewrote to reflect post-change reality:
  - **Now delivered**: gated `PATCH /jobs/{id}` write side — partial field edits, publish/close transitions (with `closed` terminal), CAS concurrency control.
  - **Still deferred**: `POST /jobs` (creation), re-open (`closed → {draft,published}`), soft-delete endpoint, notification/event publishing, `company_members` ownership, "solo empresa `active` publica" enforcement on creation, recruiter subtree beyond the gated write route, frontend job board, production seed strategy, currency conversion (FX), dev-seed non-requirement note.
  - Explicitly states `PUT /jobs/{id}` is **NOT** part of this API (the delivered method is `PATCH`, not `PUT`).

## 3. Existing requirements preserved

The 8 canonical read-side requirements (Public Read Endpoints, Read-Side Visibility Rule, Jobs Schema Migration, Status Domain, Full-Text Search, Listing Filters, Keyset Pagination, Enum Invariants) were **not modified**.

**Residual note (parent-owned)**: the `Status Domain` requirement body still contains the sentence "The transitions (publish/close) and their endpoints are OUT of scope." This statement predates the write side and is superseded by the now-delivered publish/close transitions in the delta. Per the sync instruction, existing requirements were left unchanged; the sentence is stale but not contradicting any scenario (scenarios only assert read behavior). Recommend a future MODIFIED delta or explicit approval before touching it.

## 4. Validation / checks performed

- Read delta spec, canonical spec, `openspec/config.yaml`, and `openspec/changes/jobs-write-side/verify-report.md`.
- Native `gentle-ai sdd-status` (authoritative for `openspec` store): `applyState: all_done`, tasks 19/19 complete, `dependencies.verify: all_done`, `blockedReasons: []`, `nextRecommended: archive`, no same-domain active changes.
- Verify report verdict `pass_with_warnings` — 0 blockers, 0 CRITICAL, 9/9 requirements, 39/39 scenarios; no unresolved FAIL / BLOCKED / CRITICAL / verification blockers.
- Automated merge check: asserted delta contains only `## ADDED Requirements`; asserted canonical contains exactly 17 requirement headings (8 + 9); scenario count 68 (29 + 39); required prose paragraphs located and replaced exactly.

## 5. Structured status & actionContext findings

- `artifactStore`: `openspec` (authoritative — no Engram mirroring per `openspec/config.yaml`)
- `changeName`: `jobs-write-side`
- `applyState`: `all_done`
- `actionContext.mode`: `repo-local` — `allowedEditRoots` check not applicable; edits confined to `openspec/specs/jobs/spec.md` and `openspec/changes/jobs-write-side/sync-report.md`, both inside the workspace root.
- `dependencies`: apply `all_done`, verify `all_done`, sync `ready`, archive `ready`.
- Config `rules.archive`: destructive-delta warning applies to REMOVED merges only — not triggered (purely additive).

## 6. Next recommended phase

`sdd-archive` — verify-report passes (warnings are process/coverage/attestation items, not completeness defects), sync is complete, implementation tasks all complete, and no blockers remain. The change folder was **not** moved to archive by this phase.
