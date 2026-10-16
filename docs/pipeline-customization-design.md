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

## 7. Cut 2 — `En proceso` substate catalog (proposal)

Status: **cut-2 contract agreed** with the frontend agent (msg 29a86067). Product
answers (user, 2026-10-16) are recorded in §7.5. Rules: SUB-1 (unlimited user-defined substates only inside semantic
`En proceso`), SUB-2 (the four names are examples, not built-ins), SUB-4 (tracking
labels, not sequential steps), SUB-6 (substates instead of a column per interview).
Assigning a substate to a candidate (SUB-3) and filtering (SUB-5) are cut 6.

### 7.1 Model

- The catalog belongs to the vacancy (today: the draft) and applies to its stage of
  kind `in_process`, whatever that stage is named (PIPE-9). It never references the
  column name.
- A catalog is an ordered list of substates `{ id, name }`. The order is the
  recruiter's display order only; it never implies a sequence (SUB-4).
- Invariants on every save:
  1. At most 50 substates (technical ceiling, §7.5 S1).
  2. Names normalized exactly like stage names (§3 invariant 5), 1–40 code points.
  3. Names unique within the catalog on the full-Unicode casefold of the normalized
     name, accents preserved (§3 invariant 6). Substate names are not compared with
     column names.
  4. Existing substates referenced by `id`; new ones sent without `id` get a random
     server UUID; unknown or duplicated ids are rejected.
  5. An empty catalog is valid.
- Removal is free in cut 2: no candidate can hold a substate yet. Cut 6/7 add the
  occupant and history rules (PIPE-15).
- A never-configured vacancy has an empty catalog (version `"0"`); `GET` never writes.
  The examples from SUB-2 are returned as `suggestions` for one-click adding; they are
  never stored unless the recruiter saves them.

### 7.2 Contract

Own resource, own version and ETag, so saving substates never invalidates an open
column editor and vice versa:
`/v2/me/company/job-drafts/{draftId}/pipeline/substates`. Identity, authorization,
`Cache-Control: no-store`, error envelope and status codes are exactly the cut-1 ones
(§4), including `404` for missing/foreign/non-principal drafts and authorization
before precondition comparison.

`GET` → `200`:

```json
{
  "version": "2",
  "substates": [
    { "id": "…", "name": "Primera entrevista" },
    { "id": "…", "name": "Pruebas psicométricas" }
  ],
  "limits": { "maxSubstates": 50, "nameMaxLength": 40 },
  "suggestions": ["Primera entrevista", "Segunda entrevista", "Pruebas psicométricas", "Propuesta entregada"]
}
```

`PUT` with `If-Match`, full replacement, body exactly `{ "substates": [...] }`:

```json
{ "substates": [ { "id": "…", "name": "Entrevista técnica" }, { "name": "Propuesta entregada" } ] }
```

- Response: same shape as `GET`, `substates` in request order with server ids for new
  entries, new `ETag`.
- Response keys are exactly `version`, `substates`, `limits`, `suggestions`; each
  substate is exactly `{ id, name }`; `limits` is exactly `{ maxSubstates,
  nameMaxLength }` with positive integers. Adding a key is a contract change.
- `suggestions` is always present as an array (possibly empty, never null). It is the
  same fixed list on every response, **not filtered** against the catalog; each entry
  is already normalized, casefold-unique and within `nameMaxLength`. The client
  filters it against its editor state.
- The current name of the `in_process` stage is read from `GET …/pipeline`; this
  resource does not repeat it.
- `version` decimal string, `"0"` = never saved; the ETag is strong, opaque and never
  equal to or parseable as a draft or pipeline tag.
- Versions are independent: a substate `PUT` never changes the draft or pipeline
  version, and neither of those changes the substate version.
- First `PUT` materializes version `"1"` with an audit event (cut-1 precedent), even an
  empty list over version `"0"`; later a
  `PUT` whose normalized result equals the stored catalog returns `200` with the same
  version and no audit event.
- Each changing `PUT` writes one `audit_events` row (`JobDraftSubstatesConfigured`) in
  the same transaction, with actor and previous/new catalog.
- `400 validation_error` for any §7.1 invariant; `400 invalid_request` for malformed
  JSON, unknown or duplicate keys, invalid UTF-8, malformed path id or malformed
  `If-Match`; `412 version_conflict`, `413 payload_too_large`, `428
  precondition_required` as in §4.

### 7.3 Storage (backend)

Additive migration `00016` with one table keyed by draft id (same pattern as
`job_draft_pipeline_configs`): draft id, positive version, encoded catalog. No existing
data is rewritten.

### 7.4 Frontend placement (frontend owns this)

Second subsection of the vacancy configuration section:
`/empresa/vacantes/{id}/configuracion/subestados`, saved separately from «Columnas del
pipeline». It shows the current name of the `in_process` stage.

### 7.5 Decisions recorded for cut 2

- **S1 (user):** technical ceiling of 50 substates per vacancy.
- **S2 (user):** display order chosen by the recruiter (up/down), display only.
- **S3 (user):** a new vacancy starts empty; the four SUB-2 examples are offered as
  suggestions.
- **S4 (user):** names unique within the vacancy, same comparison as columns.
- **Frontend inputs (msg 88c7cf5b):** own resource and ETag; reuse cut-1 conventions;
  `limits` in the response; substates hang from kind `in_process`.
