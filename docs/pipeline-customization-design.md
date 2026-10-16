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

After the cut-2 browser test, substates are not a separate subsection: they are edited
in a Sheet opened from the ⋯ menu of the `in_process` column in «Columnas del
pipeline», with their own save. It shows the current name of the `in_process` stage.
The contract did not change.

### 7.5 Decisions recorded for cut 2

- **S1 (user):** technical ceiling of 50 substates per vacancy.
- **S2 (user):** display order chosen by the recruiter (up/down), display only.
- **S3 (user):** a new vacancy starts empty; the four SUB-2 examples are offered as
  suggestions.
- **S4 (user):** names unique within the vacancy, same comparison as columns.
- **Frontend inputs (msg 88c7cf5b):** own resource and ETag; reuse cut-1 conventions;
  `limits` in the response; substates hang from kind `in_process`.

## 8. Cut 3 — delivery cutoff, target and commitment date (proposal)

Status: **cut-3 contract agreed** with the frontend agent (msg e88fd491). Product
answers (user, 2026-10-16) in §8.6.
Rules: PIPE-7 (any progression stage may be the cutoff, never `Descartados`),
PIPE-15 (replace an active cutoff before deleting its column), CFG-1, CFG-2, CFG-4,
CFG-6, CFG-8, CFG-9, CFG-10, CFG-12, VAC-3 (all three are required to publish, not to
save a draft). Out of scope: CFG-11 (publishing with a past date — publication cut),
CFG-3/CFG-7 freeze at fulfillment and delivery evaluation (cuts 4+), CFG-5 pauses.

### 8.1 Model

Three independent, individually nullable fields per vacancy (today: the draft):

| Field | Meaning | Valid value |
| --- | --- | --- |
| `cutoffStageId` | Delivery milestone column (DEL-1) | id of a **progression** stage of the current pipeline configuration (stored or deterministic default ids); never the `discarded` exit |
| `targetQuantity` | Distinct candidates to deliver | integer 1–999 (technical ceiling, §8.6 S2) |
| `commitmentDate` | Fecha compromiso de entrega | local date `YYYY-MM-DD` in `America/Mexico_City`; must be a business day |

- A never-configured vacancy has all three `null` (version `"0"`); the cutoff starts
  empty (§8.6 S1). Any combination of nulls may be saved: a draft may be incomplete.
  Requiring all three is the publication cut's job (VAC-3).
- The commitment date covers the whole local day (CFG-9); the server's "today" is the
  current date in `America/Mexico_City`, never the viewer's zone (CFG-12).
- **Date window on change:** a new or changed `commitmentDate` must be a business day
  in `[today, today + 1 year]` (§8.6 S3); `today + 1 year` is the same calendar date
  next year (29 Feb → 28 Feb). A stored date sent back **unchanged** is accepted even if
  it is now in the past or outside the window, so an old draft can still save its other
  fields; CFG-11 blocks publishing it later.
- Removing the cutoff column: built-in stages can never be removed (Q1), so only a
  custom cutoff stage is affected. A pipeline `PUT` that omits the stage currently
  stored as `cutoffStageId` is rejected with `409 cutoff_stage_in_use` and writes
  nothing (PIPE-15). Reordering or renaming the cutoff stage is allowed. Delivery and
  pipeline writes lock the same draft row, so they cannot race.

### 8.2 Business-day calendar

Business days are Monday–Friday excluding the mandatory rest days of art. 74 of the
Ley Federal del Trabajo (text in force, fraction VII reformed DOF 30-09-2024),
**computed by rule** in the backend (§8.6 S4), never hardcoded in the client:

- fixed: 1 January, 1 May, 16 September, 25 December;
- movable Mondays: first Monday of February, third Monday of March, third Monday of
  November;
- 1 October every six years when it is the federal executive transmission (2030,
  2036, …);
- fraction IX (ordinary election days set by electoral law) currently always falls on a
  Sunday, so it is already excluded as a weekend and is not modeled; if the law changes,
  the rule changes in code.

No organization calendars (CFG-8). A law change is a code change plus a note here.

### 8.3 Contract

Own resource, own version and ETag:
`/v2/me/company/job-drafts/{draftId}/pipeline/delivery`. Identity, authorization,
`Cache-Control: no-store`, envelope and inherited status codes exactly as §4.

`GET` → `200`:

```json
{
  "version": "1",
  "cutoffStageId": "…",
  "targetQuantity": 5,
  "commitmentDate": "2026-11-30",
  "limits": { "maxTargetQuantity": 999 },
  "calendar": {
    "timeZone": "America/Mexico_City",
    "today": "2026-10-16",
    "minDate": "2026-10-16",
    "maxDate": "2027-10-16",
    "nonBusinessDates": ["2026-10-17", "2026-10-18", "…", "2026-11-16", "…"]
  }
}
```

- Keys exactly as above; `cutoffStageId`, `targetQuantity`, `commitmentDate` always
  present, `null` when not configured. `calendar.nonBusinessDates` lists **every**
  non-business date (weekends and art. 74 days) in `[minDate, maxDate]`, ascending,
  each once, so the client only disables what it receives.
- `PUT` with `If-Match`, full replacement, body exactly
  `{ "cutoffStageId": …, "targetQuantity": …, "commitmentDate": … }` — all three keys
  required, each nullable. Response: same shape as `GET` with the new `ETag`.
- Version semantics, opaque strong ETag (never a draft/pipeline/substate tag),
  independence from the other three resources, first `PUT` materializing `"1"` with
  audit (even all-null), and no-op `PUT` without audit — all as cut 2.
- Each changing `PUT` writes one `JobDraftDeliveryConfigured` audit event in the same
  transaction with actor and previous/new values of the three fields (CFG-2, CFG-6).

Status codes, in addition to §4:

| Status | Code | Case |
| --- | --- | --- |
| `400` | `invalid_request` | Missing or unknown key, wrong JSON type (e.g. string target, fractional number), malformed date string |
| `400` | `validation_error` | Unknown or `discarded` cutoff id; target outside 1–999; changed date outside the window |
| `400` | `non_business_date` | Changed `commitmentDate` on a weekend or art. 74 day (field-specific, CFG-10) |
| `409` | `cutoff_stage_in_use` | **On pipeline `PUT`** (cut-1 route): the request omits the custom stage stored as cutoff |

`non_business_date` and `cutoff_stage_in_use` are the first field-specific codes; they
are added to the shared catalog and to `backend/docs/pipeline-config.md`. All other
§4 behavior of the pipeline route is unchanged.

Frontend notes recorded with the agreement (no backend change):

- The `409 cutoff_stage_in_use` body stays `{ error, code }` without the stage id; if
  the client did not expect that column to be the cutoff, it re-reads `GET …/delivery`.
- Strict decoding: `calendar` is exactly `{ timeZone, today, minDate, maxDate,
  nonBusinessDates }`, every date is `YYYY-MM-DD`, `nonBusinessDates` is ascending and
  without duplicates, and `limits` is exactly `{ maxTargetQuantity }`. Adding a key is
  a contract change.
- A stored past or out-of-window date is shown with a warning and sent back unchanged
  when other fields are saved; if the day changes while the page is open, the server's
  `400` is the authority.

### 8.4 Storage (backend)

Additive migration `00017`: table keyed by draft id with positive version, nullable
typed columns (`cutoff_stage_id UUID`, `target_quantity INTEGER CHECK 1–999`,
`commitment_date DATE`). No existing data is rewritten. The binary embeds the time-zone
database so `America/Mexico_City` resolves in any container.

### 8.5 Frontend placement (frontend owns this)

New subsection «Entrega» at `/empresa/vacantes/{id}/configuracion/entrega`, saved
separately. The column editor reads the delivery resource to badge the cutoff column
and disable removing it; a `409 cutoff_stage_in_use` from the pipeline `PUT` is shown
as that column's error.

### 8.6 Decisions recorded for cut 3

- **S1 (user):** the cutoff starts empty.
- **S2 (user):** target ceiling 999.
- **S3 (user):** selectable commitment dates from today up to one year.
- **S4 (user):** business days computed by rule from art. 74 LFT (closes the
  calendar-sourcing part of open decision §17.2; partial days and early/late
  business-day calculation remain open for the evaluation cut).
- **Frontend inputs (msg d3d1b987):** own resource; cut-1/2 conventions; nullable fields;
  server-provided non-business dates; field-specific codes; cutoff read from this
  resource by the column editor; CFG-11 belongs to publication.

## 9. Publication P1 — publish a draft (proposal)

Status: **P1 contract agreed** with the frontend agent (msg b7f35cff). Product answers
(user, 2026-10-16) in §9.7.
Publication is split in two cuts (§9.7 S1): **P1** (this section) turns a draft into a
published vacancy for the employer — process record, clock start, VAC-3 gate, CFG-11 —
and **P2** adds public listing/detail with the full offer content and organic
applications entering `Nuevos`. Cut 4 (candidate movement) follows P2.

Rules: VAC-1 (publishing starts the delivery clock), VAC-2 (incomplete drafts allowed),
VAC-3 (publication requirements), VAC-4 (public content; P2), CFG-11 (no initial
publication with a past commitment date), AUD-* (publication is audited).
Out of scope for P1: public visibility and applications (P2), pause/close/reopen
(VAC-5…VAC-10), principal reassignment, legacy `jobs`/`applications` (left as they are,
§9.7 S4).

### 9.1 Repository facts (exploration, L23)

- A v2 draft already holds: principal recruiter (assigned at creation), requester
  `{kind,id}`, title, rich description, location (one string), work mode, work schedule,
  contract type, professional area, requirements, benefits, compensation with
  `visible` (default false), screening.
- Missing for VAC-3: **request date** and **hiring headcount**.
- Delivery cutoff/target/date live in the cut-3 resource; pipeline and substates in
  cuts 1–2; all are keyed by the draft id.
- No link exists between drafts and legacy `jobs`; applications reference `jobs`.

### 9.2 Model

- **Same id.** The published vacancy keeps the draft id; every employer route
  `/empresa/vacantes/{id}` and every configuration resource stays valid.
- **Process record.** Publishing creates one process row keyed by that id with status
  `published`, `published_at` (the delivery clock start, VAC-1) and `published_by`.
  A draft is published at most once; later lifecycle states (paused, closed) extend this
  record in their own cut.
- **Inheritance without copies.** Columns, substates and delivery stay the per-id
  resources of cuts 1–3 and keep working after publication (§9.7 S3). Never-saved
  columns need no materialization: built-in stage ids are deterministic (UUIDv5 of the
  draft id and kind, §3), so the process already has stable stage ids and the pipeline
  keeps version `"0"` until its first save.
- **Editing after publication** (§9.7 S3): draft content, columns, substates and delivery
  remain editable with their existing audit. Rules that need candidates (PIPE-15…18)
  arrive in cut 7.
- **Management fields** (new, internal, never public — VAC-3): `requestDate` (local
  date, today or any past day in `America/Mexico_City`, any weekday, §9.7 S6) and
  `hiringHeadcount` (integer 1–999, independent of the delivery target — VAC-11,
  §9.7 S5). An unchanged stored value is accepted on save, like cut 3.

### 9.3 Readiness — what is missing to publish

Requirement codes (stable; the client translates them and treats unknown codes as a
generic missing item):

| Code | Requirement | Where it is completed |
| --- | --- | --- |
| `title_missing` | title | draft editor |
| `description_missing` | non-empty description | draft editor |
| `location_missing` | location | draft editor |
| `work_mode_missing` | modality | draft editor |
| `work_schedule_missing` | jornada | draft editor |
| `contract_type_missing` | contract type | draft editor |
| `professional_area_missing` | professional area | draft editor |
| `requester_missing` | requester | draft editor |
| `request_date_missing` | request date | management |
| `hiring_headcount_missing` | hiring headcount | management |
| `delivery_cutoff_missing` | cutoff column | delivery |
| `delivery_target_missing` | delivery target | delivery |
| `commitment_date_missing` | commitment date | delivery |
| `commitment_date_past` | commitment date before today in Mexico City (CFG-11) | delivery |

Requirements, benefits and salary are optional (§9.7 S2). The principal recruiter always
exists, so it has no code. Codes are listed in the table order.

### 9.4 Contract

All routes: same identity, authorization (owner or draft principal; `404` otherwise),
`Cache-Control: no-store` and envelope as §4.

**Management** — `GET`/`PUT /v2/me/company/job-drafts/{draftId}/management`, cut-3
conventions (own version/ETag, full replacement with `If-Match`, pure `GET`, first `PUT`
materializes `"1"` with audit, no-op without audit, independent versions). Keys exactly:

```json
{ "version": "1", "requestDate": "2026-10-10", "hiringHeadcount": 2,
  "limits": { "maxHiringHeadcount": 999 }, "today": "2026-10-16" }
```

`PUT` body exactly `{ "requestDate": …, "hiringHeadcount": … }`, both required and
nullable. Changed future date or headcount outside 1–999 → `400 validation_error`;
type/shape errors → `400 invalid_request`. Audit `JobDraftManagementConfigured` with
previous/new values.

**Readiness** — `GET /v2/me/company/job-drafts/{draftId}/publication` → `200`:

```json
{ "status": "draft", "publishedAt": null, "missing": ["request_date_missing", "commitment_date_past"] }
```

Keys exactly `status` (`draft` | `published`), `publishedAt` (RFC 3339 UTC or `null`),
`missing` (array, empty when ready or already published). Pure read.

**Publish** — `POST /v2/me/company/job-drafts/{draftId}/publication`, body exactly `{}`:

- `Idempotency-Key` required, same rules and replay semantics as draft create
  (`Idempotency-Replayed`, `409 idempotency_conflict`).
- `If-Match` required with the **draft** ETag: the client publishes only the content it
  saw. Configuration resources have their own versions, so the server re-evaluates every
  requirement atomically inside the publish transaction (draft row locked like cuts 1–3).
- `201` body `{ "id", "status": "published", "publishedAt" }` (keys exactly these). No
  public URL in P1.
- One transaction: lock draft → check If-Match → evaluate §9.3 → insert process row → audit `VacancyPublished` (actor, published
  at, frozen snapshot of target, cutoff stage id and name, commitment date, headcount and
  request date).

Evaluation order on `POST`: auth gates → transport body budget and read (`413` /
`400`, inherited from §4 and identical for every draft, so not an existence oracle) →
draft authorization (`404`) → `Idempotency-Key`
shape → **replay** (same key and payload returns the original `201` with
`Idempotency-Replayed: true`, even though the draft is now published; same key with a
different payload → `409 idempotency_conflict`) → `If-Match` (`428`/`400`/`412`) →
`409 already_published` → requirements (`422`) → write. Publishing does not change the
draft version or ETag.

Status codes, in addition to §4:

| Status | Code | Case |
| --- | --- | --- |
| `422` | `publication_incomplete` | Requirements missing; body `{ "error", "code", "missing": [codes] }` — the first envelope with a list, only for this code |
| `409` | `already_published` | Draft already published (a replay with the same key returns the original `201` instead) |
| `412` | `version_conflict` | Stale draft `If-Match` |
| `428` | `precondition_required` | Missing `If-Match` |

**Portfolio list** — `GET /v2/me/company/job-drafts` items gain `status`
(`draft` | `published`) and `published_at` (RFC 3339 UTC or `null`). This is a
coordinated contract change to the draft list; ordering, cursor and filters are
unchanged.

Frontend notes recorded with the agreement (no backend change):

- From the portfolio row or pipeline page the confirmation dialog first reads the draft
  (ETag and summary) and `GET …/publication`; a `412` is shown as «Esto cambió en otro
  lugar».
- One `Idempotency-Key` per confirmation attempt; an uncertain `POST` is never retried
  automatically: «Comprobar» reads `GET …/publication` and, if still `draft`, allows
  publishing again with the same key.
- The `422` body is decoded strictly only for `publication_incomplete`; unknown missing
  codes are generic; `409 already_published` is treated as idempotent success.
- Management lives in the configuration subsection «Solicitud»
  (`/configuracion/solicitud`) with its own save; its date picker uses the response's
  `today`.
- List `status` is a strict enum and `published_at` RFC 3339 or `null`; a published row
  shows «Activa» and leaves the Borradores tab.

### 9.5 Storage (backend)

Additive migrations: `00018` management table (draft id, version, nullable
`request_date DATE`, `hiring_headcount INTEGER CHECK 1–999`) and `00019` process table
(id = draft id, company id, status `CHECK ('published')`, `published_at`,
`published_by`). No existing data is rewritten; legacy `jobs`/`applications` untouched.

### 9.6 Frontend placement (frontend owns this)

«Publicar» in the draft editor's review step, the portfolio row actions and the draft
pipeline empty state; a «Te falta para publicar» checklist from `missing`; a confirmation
dialog with commitment date, target and cutoff column warning that the clock starts
(§9.7 S7); after publishing the row shows «Activa» with its date and the pipeline page
shows the (empty) board. Management fields need a home in the configuration section or
the editor — frontend decides.

### 9.7 Decisions recorded for P1

- **S1 (user):** split publication into P1 (publish) and P2 (public listing/detail and
  applications).
- **S2 (user):** required public content: title, description, location, modality,
  jornada, contract type and professional area; requirements, benefits and salary
  optional (closes open decision §17.10 for publication).
- **S3 (user):** after publication, content and configuration stay editable with audit.
- **S4 (user):** legacy catalog vacancies and their applications are left as they are.
- **S5 (user):** hiring headcount 1–999.
- **S6 (user):** request date today or any past date.
- **S7 (user):** confirmation with a summary before publishing.
- **Frontend inputs (msg 253fa21d):** server-side readiness codes, Idempotency-Key plus
  draft If-Match, `422` with a `missing` list, same id, portfolio status.

## 10. Publication P2 — public vacancies and applications (proposal)

Status: **P2a proposal under frontend review; P2b outline.** Product answers in §10.6.
P2 is split (§10.6 S1): **P2a** makes published vacancies publicly visible next to
legacy catalog jobs; **P2b** adds the candidate CV library and applying with CV and
screening answers, landing in the `new` stage. Branch `feat/vacancy-public` is stacked
on `feat/vacancy-publication` (L28).

Rules: VAC-4 (only offer content is public; salary only when enabled), VAC-6 (paused /
closed behavior — later lifecycle cut), SAL-3…SAL-8 (salary filters — later cut,
§10.6 S4), SRCH-1 (filter vocabulary — frontend), INT-17/INT-18 (CV mandatory, no
cover letter — P2b), INT-22 (no automatic rejection — P2b), DOC-7 (each application
keeps its CV version — P2b).

### 10.1 Repository facts (exploration, L31)

- Public catalog today: `GET /jobs` and `/jobs/{id}` over legacy `jobs` only, lenient
  query parsing, Spanish full-text over title (A) and description (B), keyset paging,
  company `{id,name}`; the legacy DTO has no rich description, requirements, benefits,
  schedule, contract or professional area.
- A published vacancy's content lives in `job_drafts.fields` (BYTEA canonical JSON) —
  not queryable. Compensation visibility is the draft key `public_visible` (default
  false). Rich descriptions have a derived plain text.
- A safe screening projector already exists (`dtos/screening_candidate_v2.go`): id,
  prompt, `open | single_choice`, options `{id,label}` — never answer keys or whether a
  question is evaluated.
- No upload handling exists in the backend; the frontend apply wizard is a prototype.

### 10.2 P2a model — public projection

- **One public projection row per published vacancy** (same id), holding only VAC-4
  content plus the public filter columns: title, rich description, plain description,
  required/preferred requirements, benefits (predefined codes + custom), location,
  work mode, work schedule, contract type, professional area, seniority, compensation
  **only when `public_visible` is true**, `published_at`, company id, and a generated
  Spanish search vector (title A, plain description B). Never stored there: requester,
  headcount, request date, delivery, pipeline, screening answer keys, hidden salary.
- **Kept in sync transactionally:** written in the publish transaction and in every
  draft save of a published vacancy (same transaction as the save, P1 §9.7 S3). No
  eventual consistency.
- **Published content cannot become incomplete** (§10.6 S3): while a vacancy is
  published, a write that would make any §9.3 requirement missing is rejected with
  `422 publication_incomplete` and the codes that would be missing — on draft `PATCH`,
  delivery `PUT` and management `PUT`. `commitment_date_past` is exempt (time passes;
  publication is not undone). Changing values remains allowed.
- **Legacy rows are untouched** and keep their own visibility rules. Vacancies published
  before this cut (only in review databases, P1 unmerged) appear publicly after their
  next draft save; no data backfill migration.

### 10.3 P2a contract — public routes (anonymous, additive)

New routes; legacy `GET /jobs*` stay unchanged.

`GET /v2/jobs` — query parameters, each at most once, unknown keys rejected:

| Param | Meaning |
| --- | --- |
| `q` | Spanish full-text over title and description |
| `location` | case-insensitive substring of location |
| `work_mode` | `onsite \| remote \| hybrid` |
| `work_schedule` | `full_time \| part_time` |
| `contract_type` | `project \| indefinite \| professional_services \| temporary \| internship` |
| `professional_area` | one of the 16 catalog codes |
| `limit` | 1–50, default 20 |
| `cursor` | opaque token from `next_cursor` |

Invalid values → `400 invalid_request` (v2 is strict, unlike v1). Filters on schedule,
contract and professional area match only published vacancies: legacy rows have no such
dimension and are excluded while those filters are active (legacy `employment_type` is
never mapped to contract types or schedule — business rules §12.2).

Ordering: with `q`, rank descending; then `published_at` descending; then source and id
as stable tie-breakers; the cursor encodes that position across both sources.

List item and detail share one shape (`snake_case`, like the v1 public API):

```json
{
  "id": "…",
  "source": "vacancy",
  "title": "Backend Go",
  "company": { "id": "…", "name": "Acme" },
  "location": "Ciudad de México",
  "work_mode": "hybrid",
  "work_schedule": "full_time",
  "contract_type": "indefinite",
  "professional_area": "technology_systems",
  "seniority": "mid",
  "legacy_employment_type": null,
  "compensation": { "mode": "range", "amount": null, "min": "30000.00", "max": "40000.00", "currency": "MXN", "period": "monthly", "basis": "gross" },
  "legacy_salary": null,
  "published_at": "2026-10-16T18:00:00.000000Z"
}
```

- `source` is `legacy | vacancy`. Every key is always present; dimensions a source does
  not have are `null` (`work_schedule`, `contract_type`, `professional_area` for
  legacy; `legacy_employment_type` and `legacy_salary {min,max,currency}` for vacancies).
  `compensation` is `null` unless the vacancy enabled public salary.
- List envelope `{ "items": [...], "next_cursor": string | null }`.

`GET /v2/jobs/{id}` → `200` with the list shape plus `description` (rich document for
vacancies, `null` for legacy), `description_plain` (both), `requirements
{required, preferred}` (nullable strings; both `null` for legacy) and `benefits
{predefined: [codes], custom: [strings]}` (empty arrays for legacy). `404 not_found`
for unknown, unpublished or inactive-company ids. Ids are UUIDs in both sources, so
existing `/vacantes/{id}` links keep working; `source` tells the client which apply flow
applies (legacy flow unchanged; vacancy flow arrives in P2b).

Responses are public and cacheable only as the legacy public routes are today; no
private data is ever included.

### 10.4 P2a storage (backend)

Additive migration `00020`: projection table keyed by the vacancy id (FK to the process),
typed filter columns, JSONB for rich description / benefits / compensation, generated
`tsvector` with GIN index, and the source draft version. No existing rows rewritten.

### 10.5 P2b outline (to be finalized after P2a closes)

- **CV library:** `POST /v2/me/cvs` (multipart, signed-in candidate) → `{id, name, size,
  content_type, uploaded_at}`; PDF or DOCX verified by content, ≤5 MB; `413 cv_too_large`,
  `415 cv_unsupported_type`, `400 cv_content_mismatch`; immutable versions; private
  storage port with a local-disk adapter (S3 later), generated keys, no public mount,
  orphan cleanup. `GET /v2/me/cvs` lists them; reuse across applications (§10.6 S6).
- **Apply:** `POST /v2/jobs/{id}/applications` (signed-in candidate, `Idempotency-Key`),
  body `{cv_id, answers}`; all screening questions required, open answers ≤2,000
  characters (§10.6 S2); answers bound to the questionnaire revision; creates a process
  participation in the `new` stage with intake audit and the exact CV version; no cover
  letter; `409` when already applied. Legacy `applications` untouched.
- **Candidate view:** the candidate's applications list for `/candidato/postulaciones`.

### 10.6 Decisions recorded for P2

- **S1 (user):** split into P2a (public listing/detail) and P2b (CV library and apply).
- **S2 (user):** all screening questions are required; open answers up to 2,000
  characters; never automatic rejection (INT-22).
- **S3 (user):** a published vacancy cannot be saved with a required item missing.
- **S4 (user):** P2a filters: text, location, modality, jornada, contract, professional
  area; salary and language filters in their own cut.
- **S5 (user, S15):** CV mandatory, local storage behind an interface, PDF/DOCX, 5 MB.
- **S6 (user, S16):** applying requires a candidate session; CVs live in the candidate's
  library and are reusable, each application keeping its exact version.
- **Frontend inputs (msgs dbea2adf, b6993910):** one public listing with a common shape;
  VAC-4 only; two-step upload then apply; field-specific CV codes; URL compatibility.
