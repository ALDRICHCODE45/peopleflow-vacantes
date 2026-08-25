# Sync Report: `jobs-create`

- **status**: `synced`
- **change**: `jobs-create` (artifact store: `openspec`, file-backed)
- **domains synced**: `jobs`
- **canonical files updated**: `openspec/specs/jobs/spec.md`
- **artifact store**: `openspec` (authoritative) — this report persisted to `openspec/changes/jobs-create/sync-report.md`

---

## 1. Delta classification

The delta (`openspec/changes/jobs-create/specs/jobs/spec.md`) is **ADDED-only**: 8 new requirements / 38 scenarios, no `MODIFIED`, `REMOVED`, or `RENAMED` sections. Native ADDED semantics apply — purely additive append into the canonical `jobs` capability spec. No destructive delta, so no explicit approval was required or recorded.

## 2. Requirements synced (ADDED, 8)

| # | Requirement | Scenarios |
|---|---|---|
| 1 | Job Creation Endpoint | 6 |
| 2 | Create Field Set | 4 |
| 3 | Draft Creation Semantics | 4 |
| 4 | Active Company Creation Gate | 4 |
| 5 | Create Domain Validation | 9 |
| 6 | Create Response | 4 |
| 7 | Create Route Security Boundary | 2 |
| 8 | Create Error Taxonomy | 5 |

Total: 8 requirements / 38 scenarios appended. Requirement blocks were copied byte-exact from the delta (no transcription), preserving heading hierarchy (`### Requirement:` / `#### Scenario:`), GIVEN/WHEN/THEN bullets, tables, and sentinel/status-code wording.

## 3. Canonical merge outcome

`openspec/specs/jobs/spec.md` went from **17 requirements / 68 scenarios** (8 read-side + 9 PATCH write-side) to **25 requirements / 106 scenarios**:

- The 8 create requirements were appended under the existing `## ADDED Requirements` section, after the last PATCH requirement (`Error Taxonomy`).
- **No requirement name collision**: each of the 8 new names was asserted absent from the canonical spec before append; each now appears exactly once. Create-side names are deliberately distinct from PATCH-side names (`Create Domain Validation` vs `Domain Validation Rules`, `Create Error Taxonomy` vs `Error Taxonomy`, `Create Route Security Boundary` vs `Write Route Security Boundary`, `Create Response` vs `Editor Response DTO`).
- **Existing 17 canonical requirements untouched** — verified `git diff` touches only the out-of-scope prose line (1 deletion) plus the appended block (291 insertions); no read-side or PATCH-side requirement line was modified.

## 4. Out-of-scope prose update

`## Out of scope (deferred)` in the canonical spec was updated precisely:

- **Removed from deferred list**: `` `POST /jobs` (creation) `` — now DELIVERED (draft-at-creation behind `RequireAuth` + `RequireCompanyRole(recruiter)`, atomic active-company gate → `409`).
- **Removed from deferred list**: ``"solo empresa `active` publica" enforcement on creation`` — this is the same surface delivered by the new `Active Company Creation Gate` requirement (409 for non-active companies at INSERT time); leaving it listed would contradict the canonical spec.
- **Kept deferred**: re-opening a closed job (`closed → {draft,published}`), soft-delete endpoint, notification/event publishing, `company_members` ownership, frontend job board, production seed strategy, currency conversion (FX).
- **Precision rewording**: "a recruiter subtree beyond the gated `PATCH /jobs/{id}` write route" → "beyond the gated `POST /jobs` and `PATCH /jobs/{id}` write routes" (the gated subtree now includes the create route; the item remains deferred for further recruiter endpoints).
- **Delivered-write-side sentence** now opens with `POST /jobs` creation before describing `PATCH /jobs/{id}` partial edits, transitions, and CAS; `PUT /jobs/{id}` is still NOT part of the API.

## 5. Guardrail checks

| Check | Result |
|---|---|
| `verify-report.md` present and passing | ✅ verdict `pass`, blockers 0, critical 0, 8/8 requirements, 38/38 scenarios |
| Delta ADDED-only (no MODIFIED/REMOVED/RENAMED) | ✅ no destructive sync, no RENAMED unsupported path |
| Active same-domain collisions | ✅ none — `jobs-create` is the only active change touching `openspec/specs/jobs/spec.md` |
| Legacy flat spec (`openspec/changes/{change}/spec.md`) | ✅ n/a — domain-spec layout used |
| Canonical paths inside workspace | ✅ `openspec/specs/jobs/spec.md` under repo root; no `allowedEditRoots` restriction (repo-local action mode) |
| `rules.sync` from `openspec/config.yaml` | ✅ no `sync` rule block present in config; archive rules (destructive-delta warning) not triggered (ADD-only) |

## 6. Validation performed

- Byte-exact extraction and append of the delta block via script; assertions enforced:
  - the 8 appended names match the expected list exactly;
  - no appended name existed in the canonical spec before append;
  - requirement count 17 → 25, scenario count 68 → 106 (delta contributes exactly 8 req / 38 scenarios);
  - `` `POST /jobs` (creation), `` no longer in the deferred list; `re-opening a closed job`, `soft-delete endpoint`, `notification or event publishing` still present.
- `git diff --stat` confirms the only canonical edits are the prose line and the appended block (291 insertions / 1 deletion).
- No code touched; no commit created; change folder left in place (not archived).

## 7. Structured status & actionContext findings

| Field | Value |
|---|---|
| artifactStore | openspec (authoritative — config `schema: spec-driven`, "Persistence mode: openspec") |
| changeName | jobs-create |
| applyState | all_done (17/17 implementation tasks `[x]`) |
| actionContext.mode | repo-local (no `workspace-planning` mode, no `allowedEditRoots` restriction) |
| delta shape | ADDED-only (8 req / 38 scenarios) |

## 8. Next recommended phase

`sdd-archive` — sync is clean (canonical merged, no collisions, no blockers). Archive readiness is the parent-owned lifecycle decision; note verify-report §11 flags only the environmental integration-suite skip (`DATABASE_URL` unset), which is design-accepted and not a sync blocker.
