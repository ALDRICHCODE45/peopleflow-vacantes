# Pipeline customization — design proposal (cut 1: stage configuration)

Status: **proposal under review** by the backend and frontend agents. Nothing here is
implemented. Product rules come from `docs/recruitment-business-rules.md` (§5 PIPE-*,
§5.1 SUB-*, §6 CFG-*); this document never restates or changes them, it only maps
them to a model and a contract.

## 1. Delivery plan (one feature at a time)

| Cut | Scope | Candidates involved | Risk |
| --- | --- | --- | --- |
| 0 | This design and contract agreement | — | none |
| **1** | **Per-vacancy stage configuration: rename, reorder before `Placement`, up to 3 extra columns** | none | low |
| 2 | `En proceso` substate catalog (SUB-1, SUB-2, SUB-6) | none | low |
| 3 | Delivery cutoff, target and commitment date configuration (CFG-1…CFG-13) | none | medium |
| 4 | Real candidate movement between stages, with history | yes | **high** (migrates `applications`) |
| 5 | Discard with reason and recovery (PIPE-12, PIPE-13) | yes | medium |
| 6 | Active substate per candidate and OR filter incl. `Sin subestado` (SUB-3, SUB-5) | yes | medium |
| 7 | Editing configuration with occupants: impact preview, "not applicable" stages, removing used columns (PIPE-15…PIPE-18) | yes | high — blocked on open decision §17.1 |

Each cut: ODD task, agreed contract, test-first, real browser test by the user, local
merge to `main`, user pushes. No PRs.

## 2. Repository facts that shape cut 1

- The only real employer vacancy entity today is the private draft (`job_drafts`,
  `/v2/me/company/job-drafts/{id}`). There is no draft → published-process path yet;
  the legacy `jobs` table is the public catalog.
- Drafts carry no delivery cutoff, target or commitment fields.
- `applications.status` is a fixed `CHECK (submitted, in_review, rejected, hired)`;
  cut 1 does not touch it.
- The frontend pipeline is local fixtures with four stages.

Consequence: **cut 1 attaches the configuration to the draft.** When the publish path
exists, the published process inherits it (the draft id becomes the process
identity or is linked to it — backend decision for that later cut).

## 3. Model

A configuration has two parts:

- **Progression** — an ordered list of stages. `Placement` is always last.
- **Exit** — exactly one `Descartados` stage, outside the order (PIPE-8).

Each stage has:

| Field | Meaning |
| --- | --- |
| `id` | Stable UUID. Never reused, never changes on rename or reorder. Cut 4 will reference it from candidate history, so stability is the point. |
| `kind` | Semantic function, fixed for life: `new`, `screening`, `screening_ok`, `in_process`, `placement`, `custom`, `discarded`. |
| `name` | Display name, editable. Renaming never changes `kind` (PIPE-9). |

Defaults (PIPE default list) — created with fresh ids:

| Order | kind | name |
| --- | --- | --- |
| 1 | `new` | Nuevos |
| 2 | `screening` | Screening |
| 3 | `screening_ok` | Screening OK |
| 4 | `in_process` | En proceso |
| 5 | `placement` | Placement |
| exit | `discarded` | Descartados |

Invariants enforced by the backend on every save:

1. Exactly one stage of each built-in kind (`new`, `screening`, `screening_ok`,
   `in_process`, `placement`, `discarded`) — see open question Q1.
2. `placement` is the last progression stage (PIPE-3).
3. `discarded` is never in the progression (PIPE-8).
4. At most 3 `custom` stages (PIPE-4), always before `placement` (PIPE-5) — implied by 2.
5. Names: trimmed, non-empty, at most 40 characters counted in runes — see Q2 for uniqueness.
6. Ids of built-in stages cannot be swapped between kinds; a client cannot invent
   ids — a new custom stage is sent without `id` and the server assigns one.

Critical-action kinds (`in_process`, `placement`, `discarded`) are exposed through
`kind`; the rename confirmation dialog (PIPE-10) is a frontend concern driven by it.

## 4. Contract (proposal)

Base: `/v2/me/company/job-drafts/{draftId}/pipeline`. Same identity, authorization
and error vocabulary as the draft routes (`backend/docs/private-job-drafts.md`):
owner or draft principal; foreign or missing draft → `404 not_found`.

### `GET` → `200`

```json
{
  "version": 3,
  "stages": [
    { "id": "…", "kind": "new", "name": "Nuevos" },
    { "id": "…", "kind": "screening", "name": "Screening" },
    { "id": "…", "kind": "screening_ok", "name": "Screening OK" },
    { "id": "…", "kind": "custom", "name": "Prueba técnica" },
    { "id": "…", "kind": "in_process", "name": "En proceso" },
    { "id": "…", "kind": "placement", "name": "Placement" }
  ],
  "exit": { "id": "…", "kind": "discarded", "name": "Descartados" },
  "limits": { "maxCustomStages": 3, "nameMaxLength": 40 }
}
```

Header `ETag: "<version>"`. A draft without a stored configuration is materialized
with the defaults on first access (inside the read transaction or at draft creation —
backend choice), so the frontend always gets real stable ids.

### `PUT` (full replacement) → `200` with the same body

Request: `If-Match` required. Body is the desired `stages` and `exit` — existing ones
by `id`, new custom stages without `id`, removed custom stages simply omitted.

```json
{
  "stages": [
    { "id": "…", "name": "Nuevos" },
    { "name": "Prueba técnica" },
    { "id": "…", "name": "Filtro" },
    { "id": "…", "name": "Filtro OK" },
    { "id": "…", "name": "Entrevistas" },
    { "id": "…", "name": "Contratado" }
  ],
  "exit": { "id": "…", "name": "Descartados" }
}
```

`kind` is not accepted from the client: it is derived from the stored id; an
id-less entry is always `custom`.

Errors:

| Case | Status / code |
| --- | --- |
| Missing `If-Match` | `428 precondition_required` |
| Stale `If-Match` | `412 precondition_failed` |
| Unknown or duplicated id, missing built-in stage, `placement` not last, more than 3 custom, bad name | `422 validation_failed` with per-field details (`stages[3].name`, …) |

Why full replacement instead of granular operations: reorder + rename + add in one
editor save is one atomic, auditable change, and a stale editor can never half-apply.

### Audit

Each successful `PUT` writes one `audit_events` row (`pipeline_config_changed`) with
actor, previous and new configuration. Even without candidates this is a
behavior-changing configuration edit (PIPE-16, AUD-*).

### Removing custom stages in cut 1

Allowed freely: no candidates can occupy a draft's stage yet and the cutoff does not
exist yet. Cut 3 adds "cannot remove the cutoff stage" and cut 7 adds the occupant
and history rules of PIPE-15.

## 5. Open questions

Product (need the user):

- **Q1.** Can the default columns `Nuevos`, `Screening` and `Screening OK` be removed,
  or only renamed and reordered? The rules only say they can be renamed (PIPE-2) and
  reordered (PIPE-3). Proposal: not removable.
- **Q2.** Must stage names be unique within a vacancy (ignoring case and extra spaces,
  as in the requester catalog)? Proposal: yes — two columns called "Entrevista" on one
  board are ambiguous.
- **Q3.** Where do new organic applications land: always in `Nuevos` (wherever it was
  moved), or in whatever column is first? Proposal: `Nuevos` must stay first, which
  also resolves the question. Needed before cut 4, but it changes the cut-1 invariants.

Contract (frontend agent):

- **F1.** Is full replacement with `If-Match` comfortable for the editor UX, or is a
  per-action API needed?
- **F2.** Where does the editor live (inside the draft editor, as a tab of the pipeline
  page, or both)? It decides when the frontend first calls `GET`.
- **F3.** Any field missing for rendering (colors per stage, descriptions)? Colors
  are not in the business rules; proposal: derived from `kind` client-side.
