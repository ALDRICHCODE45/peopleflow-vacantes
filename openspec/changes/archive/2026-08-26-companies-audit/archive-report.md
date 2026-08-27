# Archive Report: `companies-audit` (2026-08-26)

Status: archived
Change: `companies-audit` — extend `audit_events` with `CompanyUpdated` / `CompanyDeleted` from companies write paths

## Verdict

- **Review (RDD):** approved (4R on the delivery candidate, commit `22bc253`); medium-risk consolidated review on this archive candidate (reliability lens), one CRITICAL finding resolved as a false positive (see below).
- **Code:** all suites green — `go build ./...`, `go vet`, unit (`go test ./...`, 36+ packages), integration (`make test-integration`, 38 packages, real Postgres 16).
- **Specs:** canonical reconciliation complete (see Canonical Reconciliation Chain).

## Canonical Reconciliation Chain (finding R3-1 resolution)

The reliability lens raised R3-1 (CRITICAL, `introduced`): "the two spec deltas archived under this change are NOT pasted into the canonical audit_events and companies specs — no canonical-spec path appears in the changed-path manifest."

**Resolution: false positive, verified against the tree.** The canonical-spec paste happened in the DELIVERY commit `22bc253` (`HEAD^{tree}` = `becd9eee...`), which is the **base tree** of this archive candidate. Evidence:

- `git show 22bc253:openspec/specs/audit_events/spec.md` contains 11 references to `CompanyUpdated`/`CompanyDeleted`; the Purpose declares "Exactly four event types ... `CompanyUpdated` and `CompanyDeleted` from the `companies` owner-only write paths".
- `git show 22bc253:openspec/specs/companies/spec.md` contains the `Audit Events for Companies` requirement and no longer the deferred `No Audit Events for Companies (Deferred)`.
- The archive candidate's manifest correctly does NOT touch `openspec/specs/` — the reconciliation already landed in the base tree. The lens inspected only the candidate diff (archive + ROADMAP) and could not observe the base-tree sync.

The reconciliation chain is therefore complete across the two commits:

1. `22bc253` (delivery): code + canonical spec sync (`openspec/specs/audit_events/spec.md`, `openspec/specs/companies/spec.md`) + change artifacts in `openspec/changes/companies-audit/`.
2. This commit (archive): move `openspec/changes/companies-audit/` → `openspec/changes/archive/2026-08-26-companies-audit/` + ROADMAP marked DELIVERED.

No canonical spec was left self-contradictory at any point after `22bc253`; the archive commit only relocates immutable artifacts and records delivery in the roadmap.

## Artifacts archived

- `proposal.md` — decisions (8 open items resolved) + scope + non-goals + rollback plan
- `specs/audit_events/spec.md` — delta MODIFIED (Event Type Vocabulary, Metadata Shape)
- `specs/companies/spec.md` — delta REMOVED (No Audit Events (Deferred)) + ADDED (Audit Events for Companies, 12 scenarios)
- `design.md` — ADRs D1–D11 (seam change, jobs_closed plumbing via domain builder, co-write fail-closed)
- `tasks.md` — WU1–WU4 breakdown
- `exploration.md` — factual base
- `archive-report.md` — this file

## Delivery facts (final state)

- Delivery commit: `22bc253f58045da77f04895f324adaf4f5ac43e9` (31 files, tree `becd9eee66c1c3b4b95b1d9ebfb4c59768cc2aad` == approved review candidate tree).
- Review lineage (delivery): `review-c2b066ff61050483` — approved, receipt present.
- Review lineage (archive): `review-3ad685b0baa4110b` — correction resolved, finalized.
- Backlog follow-ups (not in this cycle): W1–W6 of companies-write verify; hardening read-side `deleted_at IS NULL`; restore/undelete endpoint; `CompanyRestored`/`CompanySoftDeleted` event constants (future-only by design).
