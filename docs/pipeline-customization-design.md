# Pipeline customization — design and cut-1 contract

Status: **cut-1 contract agreed** between the backend and frontend agents, with the
user's product answers (Q1–Q3). Not implemented yet. Product rules come from
`docs/recruitment-business-rules.md` (§5 PIPE-*, §5.1 SUB-*, §6 CFG-*); this document
maps them to a model and a contract and adds only the decisions recorded in §6.

## 1. Delivery plan (one feature at a time)

| Cut | Scope | Candidates involved | Risk |
| --- | --- | --- | --- |
| 0 | This design and contract agreement | — | none |
| **1** | **Per-vacancy stage configuration: rename, reorder, up to 3 extra columns** | none | low |
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
exists, the published process inherits it (backend decision for that later cut).

## 3. Model

A configuration has two parts:

- **Progression** — an ordered list of stages, `Nuevos` first and `Placement` last.
- **Exit** — exactly one `Descartados` stage, outside the order (PIPE-8).

Each stage has:

| Field | Meaning |
| --- | --- |
| `id` | Stable UUID. Never reused, never changes on rename or reorder. Cut 4 references it from candidate history. |
| `kind` | Semantic function, fixed for life: `new`, `screening`, `screening_ok`, `in_process`, `placement`, `custom`, `discarded`. |
| `name` | Display name, editable for every stage including `Descartados` (PIPE-2). Renaming never changes `kind` (PIPE-9). |

Defaults:

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
   `in_process`, `placement`, `discarded`). Built-in stages are never removed (Q1).
2. `new` is the first progression stage (Q3) and `placement` the last (PIPE-3).
   Everything between them is freely reorderable.
3. `discarded` is never in the progression (PIPE-8).
4. At most 3 `custom` stages (PIPE-4); by invariant 2 they always sit before
   `placement` (PIPE-5). Custom stages may be removed in cut 1 (no occupants, no
   cutoff yet).
5. Names are normalized exactly like requester-catalog names
   (`backend/docs/requester-catalog.md`): UTF-8 → NFC → trim and collapse Unicode
   `White_Space` (including NBSP) to one ASCII space; non-whitespace control
   characters rejected; zero-width and other format characters kept. After
   normalization a name has 1–40 code points.
6. Names are unique within one configuration, progression and exit together (Q2),
   compared on the full-Unicode casefold of the normalized name: accents preserved,
   no NFKC, no fuzzy matching (`Área` = `ÁREA`, `Area` ≠ `Área`).
7. A client cannot invent ids or kinds: existing stages are referenced by `id`, a
   new custom stage is sent without `id` and the server assigns a random UUID.

Critical-action kinds (`in_process`, `placement`, `discarded`) are exposed through
`kind`; the rename confirmation dialog (PIPE-10) is a frontend concern driven by it.

### Defaults without writes

A draft whose configuration was never saved has no stored row. `GET` returns the
defaults with **deterministic ids**: each built-in stage id is a UUIDv5 derived from
the draft id and the stage kind. Two concurrent `GET`s therefore return the same ids,
`GET` never writes, and existing drafts need no backfill migration. The first
successful `PUT` stores the configuration with those same built-in ids.

## 4. Contract (agreed)

Base: `/v2/me/company/job-drafts/{draftId}/pipeline`. Same identity, authorization
and error envelope as the draft routes (`backend/docs/private-job-drafts.md`):
owner or draft principal; missing, foreign or non-principal draft → `404 not_found`
after the general auth gates; every response carries `Cache-Control: no-store`.

### `GET` → `200`

```json
{
  "version": "3",
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

- `version` is a decimal string; `"0"` means "defaults, never saved".
- `ETag` is a strong, opaque pipeline tag. Clients never construct it; it never
  equals or parses as a draft tag.
- Pipeline and draft versions are **independent**: a pipeline `PUT` never changes the
  draft version or ETag, and a draft `PATCH` never changes the pipeline version.

### `PUT` (full replacement) → `200` with the same body and new `ETag`

`If-Match` required. Body is exactly `stages` and `exit`; existing stages by `id`, new
custom stages without `id`, removed custom stages omitted. Unknown keys are rejected.

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

- `kind` is never accepted from the client; it is derived from the stored (or
  deterministic default) id; an id-less entry is always `custom`.
- The response `stages` order is the request order, with server-assigned ids for new
  custom stages, so the editor keeps working without another `GET`.
- A `PUT` whose normalized result equals the stored configuration returns `200` with
  the same version and ETag and writes no audit event.
- An uncertain `PUT` (timeout) is not retried: the client reconciles with `GET`. No
  `Idempotency-Key`.

Status codes (subset of the draft catalog, envelope `{ "error", "code" }`, no details):

| Status | Code | Case |
| --- | --- | --- |
| `400` | `invalid_request` | Malformed JSON, unknown/duplicate key, invalid UTF-8, malformed path id, empty/weak/list/malformed `If-Match` |
| `400` | `validation_error` | Any invariant in §3 violated (unknown or duplicated id, built-in missing, `new` not first, `placement` not last, more than 3 custom, bad or duplicate name) |
| `401` / `403` / `404` / `409` | as drafts | Auth gates, inactive company, missing/foreign/non-principal draft |
| `412` | `version_conflict` | Stale or foreign `If-Match`; no data |
| `413` | `payload_too_large` | Raw body over the budget |
| `428` | `precondition_required` | `PUT` without `If-Match` |
| `500` | `internal_error` | Unexpected failure |

The frontend validates against `limits` and the §3 rules before sending; a server
`400` is shown as a generic failure that keeps the edited state.

### Audit

Each `PUT` that changes the configuration writes one `audit_events` row
(`JobDraftPipelineConfigured`) in the same transaction, with actor and the previous
and new configuration (PIPE-16, AUD-*).

## 5. Frontend placement (frontend owns this)

After the cut-1 browser test, the editor moved to a vacancy configuration section
with subsections: `/empresa/vacantes/{id}/configuracion/columnas`, reached from a
gear on the pipeline page `/empresa/vacantes/{id}/pipeline`. It is not a step of the
draft editor. Cuts 2 (substates) and 3 (delivery configuration) enter as new
subsections of that section. The contract did not change. Reordering
uses accessible up/down buttons with `Nuevos` and `Placement` fixed. Stage colors are
derived from `kind` client-side; custom stages are neutral. An unknown `kind` is an
invalid response: adding a kind is a contract change.

## 6. Decisions recorded for this design

- **Q1 (user, 2026-10-15):** built-in columns are only renamed and reordered, never
  removed.
- **Q2 (user):** stage names are unique within a vacancy, compared ignoring case and
  surplus whitespace, preserving accents.
- **Q3 (user):** `Nuevos` is always the first column.
- **F1–F3 and contract objections (frontend agent):** full replacement with
  `If-Match`; draft error vocabulary; string version and opaque ETag; independent
  versions; pure `GET`; no-op `PUT` without audit; requester-catalog normalization;
  `Descartados` renamable.
