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

Status: **P2a contract agreed** (msg 53e0858c); **P2b contract agreed** (§10.5, msg
a82eaafb).
Product answers in §10.6.
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
  "compensation": { "mode": "range", "amount": null, "min": "30000.00", "max": "40000.00", "currency": "MXN", "pay_period": "monthly", "basis": "gross" },
  "legacy_salary": null,
  "published_at": "2026-10-16T18:00:00.000000Z"
}
```

- `source` is `legacy | vacancy`. Every key is always present; dimensions a source does
  not have are `null` (`work_schedule`, `contract_type`, `professional_area` for
  legacy; `legacy_employment_type` and `legacy_salary {min,max,currency}` for vacancies).
  `compensation` is `null` unless the vacancy enabled public salary.
- List envelope `{ "items": [...], "next_cursor": string | null }`.
- `seniority`: `intern | junior | mid | senior | lead`; never `null` for legacy rows
  (NOT NULL there), `null` for a vacancy that left it empty (not a publication
  requirement).
- `published_at`: RFC 3339 UTC, never `null`. Legacy: the job's first publication time
  (`jobs.published_at`, required for every listed legacy row; not its creation time).
  Vacancy: the process `published_at` (P1 clock start).
- `compensation`: exactly the draft v2 compensation shape without `public_visible` —
  `{mode, amount, min, max, currency, pay_period, basis}` with `mode` `fixed | range`,
  amounts as decimal strings, `currency` `MXN | USD`, `pay_period`
  `hourly | weekly | semimonthly | monthly | yearly`, `basis` `gross | net`. It is
  non-`null` only when `public_visible` is true **and** the compensation is complete
  (mode, currency, pay period and basis set; `amount` for `fixed`, both `min` and `max`
  for `range`); the unused amount keys are `null`. Incomplete or hidden → `null`.
- `legacy_salary`: `{min, max, currency}` with `min`/`max` as nullable decimal strings
  and `currency` `MXN | USD`; `null` when both bounds are `null` (and always for
  vacancies). Legacy rows carry no pay period or basis and none is invented.
- Errors: `400 invalid_request` for query parameters, `404 not_found` on detail, the
  usual `{error, code}` envelope. Public routes send no `ETag` and no
  `Cache-Control: no-store`, like the legacy public routes.

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

### 10.5 P2b contract — CV library and applying (proposal)

Status: **P2b contract agreed** with the frontend agent (msg a82eaafb). Since P2b0 (§11),
"signed-in candidate" means a live `candidate` user (`403 account_required` / `403
wrong_role` otherwise). All routes require a signed-in **candidate**
(Bearer of a `candidate` user; a recruiter or owner token → `403 wrong_role`;
no live account → `403 account_required`; no session → `401`). Error envelope `{error, code}` unless stated; private responses carry
`Cache-Control: no-store`.

**CV library** (§10.6 S5, S6, S8, S9):

- `GET /v2/me/cvs` → `{ "items": [cv], "limits": { "max_cvs": 10, "max_bytes": 5242880,
  "content_types": ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] } }`,
  newest first. `cv` is exactly `{id, name, size, content_type, uploaded_at, in_use}`;
  `in_use` is true when any application references it.
- `POST /v2/me/cvs` — `multipart/form-data` with exactly one file part `file`
  (≤5 MB = 5,242,880 bytes) and an optional text part `name` (1–120 code points after
  normalization; default: the file name without path). → `201` with `cv`.
  Rejections: `413 cv_too_large`; `415 cv_unsupported_type` (neither PDF nor DOCX);
  `400 cv_content_mismatch` (allowed extension, different real content); `409
  cv_library_full` (already 10); `400 invalid_request` (malformed multipart, missing or
  repeated `file`, unknown parts). Type is decided by content: PDF magic `%PDF-`;
  DOCX = ZIP with `[Content_Types].xml` and `word/document.xml`. No upload idempotency
  key: a retried upload creates another CV the candidate can delete.
- `PATCH /v2/me/cvs/{id}` body exactly `{ "name": … }` → `200` with `cv`; renames only
  the library label (§10.6 S9).
- `DELETE /v2/me/cvs/{id}` → `204`. The CV leaves the library; every application keeps
  the exact version it used (DOC-7, §10.6 S8). An unused CV's file is removed from
  storage; a used one is retained for its applications. Final retention remains open.
- `GET /v2/me/cvs/{id}/file` → the candidate's own file with its stored content type
  and `Content-Disposition: attachment`. Another candidate's id → `404`.
- When storage is not configured, every `/v2/me/cvs*` route returns
  `503 cv_storage_unavailable` after the existing authentication and candidate gates;
  the rest of the API, including applying, remains available.
- Storage: private port with a local-disk adapter now (root from configuration, random
  keys, never served by a static mount), S3 adapter later without contract changes. File
  first, then the database row; a failed row write deletes the file; a reconciler removes
  files with no row.

**Screening form** — `GET /v2/jobs/{id}/screening` (public, like the detail) → `{
"questionnaire_revision": string, "questions": [ {id, prompt, type, options} ],
"limits": { "open_answer_max_length": 2000 } }`. `type` is `open | single_choice`;
`options` is `[{id,label}]` for `single_choice` and `null` for `open`; all questions are
required (§10.6 S2). It never reveals answer keys or whether a question is evaluated
(existing safe projector). `questionnaire_revision` is an opaque fingerprint of the
current questions. Legacy or unpublished id → `404`. A vacancy with no questions returns
`questions: []`.

**Apply** — `POST /v2/jobs/{id}/applications`, `Idempotency-Key` required (same rules
as draft create, scoped to candidate + vacancy), body exactly:

```json
{ "cv_id": "…", "questionnaire_revision": "…",
  "answers": [ { "question_id": "…", "option_id": "…" }, { "question_id": "…", "text": "…" } ] }
```

- One answer per question, all questions answered; `option_id` for `single_choice`,
  `text` (1–2,000 code points after trim) for `open`.
- `201` → exactly `{ "id", "vacancy_id", "status": "submitted", "applied_at" }`; replay
  with the same key returns the original `201` with `Idempotency-Replayed: true`.
- One transaction: lock the vacancy process → check published and company active →
  check revision → validate answers → create the participation in the vacancy's `new`
  stage with the exact CV version, a snapshot of the questions and answers, source
  `organic`, an intake history entry and an audit event. No cover letter, no automatic
  rejection or movement (INT-18, INT-22). Legacy `applications` untouched.
- Rejections: `404 not_found` (unknown, legacy, unpublished or inactive-company
  vacancy); `409 already_applied`; `409 questionnaire_changed` (stale revision — reload
  the form); `422 invalid_answers` with `{error, code, details: [{question_id, reason}]}`
  where `reason` is `required | unknown_option | too_long | wrong_type`; `422
  cv_unavailable` (CV not in the candidate's library); `400 invalid_request` (shape,
  unknown or duplicate question ids); `409 idempotency_conflict`;
  `400 idempotency_key_required` (missing key) / `400 invalid_idempotency_key`
  (empty, repeated or malformed key), as draft create.

**Candidate list** — `GET /v2/me/applications?cursor&limit` → `{ "items": [ { "id",
"vacancy": {id, title}, "company": {id, name}, "applied_at", "status": "submitted" } ],
"next_cursor": string | null }`, newest first. Only `submitted` exists until cut 4
decides what candidates see (§10.6 S10); internal stages are never exposed.

**Storage (backend):** additive migrations for candidate CV files/versions, process
participations (unique per process and candidate) with stage history, and their
idempotency records. Existing data untouched.

**Frontend notes (msg a82eaafb):** upload and download go through a Next Route Handler
that forwards the request with the server-side Bearer (no global Server Action body
limit change); `422 invalid_answers` details are decoded strictly as
`[{question_id, reason}]`, an unknown `question_id` is shown as a general error and the
form reloads.

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
- **S8 (user):** up to 10 CVs per candidate; deleting a used CV keeps the version in its
  applications.
- **S9 (user):** candidates can rename CVs (library label only).
- **S10 (user):** candidates see only «Postulación enviada» until cut 4 decides more.
- **Frontend inputs (msgs dbea2adf, b6993910, a5dc68ae):** one public listing with a common shape;
  VAC-4 only; two-step upload then apply; field-specific CV codes; URL compatibility.

## 11. P2b0 — candidate identity (proposal)

Status: **P2b0 contract agreed** with the frontend agent (msg 4831e0ec). Product answers in
§11.6. Branch
`feat/candidate-identity`, stacked on `feat/vacancy-public` (L28). Prerequisite of P2b:
today no candidate can create an account (L38).

### 11.1 Repository facts (exploration, L38)

- Recruiter accounts are created by the local identity bootstrap (operator-approved,
  recruiter only). The Cognito PostConfirmation Lambda maps `cognito:groups` to a user
  type, skips accounts without a recognized group, discards the app-client id, returns
  only an error where AWS expects the event, and is not deployed (AWS phase deferred).
- `RequireAuth` verifies the access token (RS256, issuer, `token_use`, one configured
  client id) and exposes only subject and groups. A valid token without a `users` row
  gets `401` downstream; nothing provisions it.
- Existing candidate routes (`/me/profile*`, `GET /me/applications`,
  `POST /jobs/{id}/applications`) require only authentication: a recruiter passes.
  Company routes are protected by membership, and candidates can never become members
  (company creation and AddMember reject them).
- The local bootstrap already has a hardened UserInfo client (subject match, verified
  email, strict claims) that this cut can reuse.

### 11.2 Model

- **Same Cognito user pool and app client** for both roles (§11.6 S1). The role lives
  only in `users.user_type`; JWT groups and the app client never grant a role.
- **Explicit candidate onboarding** (§11.6 S2): after signing up and in through the
  hosted login, the person completes «Crear mi cuenta de candidato» in `/candidato`. The
  API creates a `candidate` user only when the token's subject has no live user row. It
  never changes the role of an existing account and never links accounts by email.
- **One account, one role** (S20): a recruiter account cannot become a candidate; a person
  wanting both uses a second email. Recruiter provisioning stays as today (bootstrap).
- **Trusted identity data:** email comes from Cognito UserInfo fetched server-side with the
  caller's access token — subject must match the token and `email_verified` must be true.
  The browser never supplies the email. The name comes from the onboarding form
  (2–120 code points after the usual normalization), because sign-up only asks for email
  and password.
- **Role enforcement** (§11.6 S3): every candidate route — the legacy ones listed in
  §11.1 and all new `/v2/me/*` candidate routes of P2b — requires a live `candidate` user.
  Company routes keep their membership authorization unchanged.

### 11.3 Contract

All routes: `RequireAuth`, `Cache-Control: no-store`, envelope `{error, code}`.

`GET /v2/me` → `200`:

```json
{ "role": "candidate", "user": { "id": "…", "email": "ana@example.com", "full_name": "Ana Pérez" } }
```

`role` is `recruiter | candidate | null`; `user` is `null` exactly when `role` is `null`
(valid token, no live account yet). Keys are exactly these. The frontend uses it for the
`/empresa` and `/candidato` area guards and to route a new person to onboarding.

`POST /v2/me/candidate-account`, body exactly `{ "full_name": "…" }`:

| Result | Case |
| --- | --- |
| `201` + `GET /v2/me` body | Candidate account created |
| `200` + `GET /v2/me` body | The subject already has a candidate account (safe retry; name unchanged) |
| `409 account_exists` | The subject already has a recruiter account |
| `409 email_in_use` | Another account already uses this verified email |
| `422 email_not_verified` | UserInfo reports an unverified email |
| `400 validation_error` | Name invalid |
| `400 invalid_request` | Malformed body, unknown or duplicate keys |
| `503 identity_unavailable` | UserInfo unreachable or malformed; nothing written |

Creation and its audit event are one transaction; uniqueness on subject and email is
enforced by the existing constraints, so concurrent onboarding yields one account.

Role errors on candidate routes (legacy and new):

| Result | Case |
| --- | --- |
| `403 account_required` | Valid token, no live account (client sends the person to onboarding) |
| `403 wrong_role` | The account is a recruiter |

These replace today's `401` for a missing user row and today's acceptance of recruiters
on those routes; this is the requested change to existing contracts (Risk item 2 and
item 3). Company routes are unchanged.

Agreement notes (frontend msg 4831e0ec):

- The `201`/`200` body of `POST /v2/me/candidate-account` is exactly the `GET /v2/me`
  body, so the client updates its session without another read.
- Company routes are unchanged: a token without an account still gets `401
  unauthenticated` there, and a candidate account gets `403 forbidden` (no
  membership). Area guards rely on `GET /v2/me`, not on those codes.
- **No undo in this cut.** A mistaken candidate onboarding cannot be reverted by the
  product; an admin/support reversal is an open decision queued for the user. The
  frontend offers onboarding only inside the `/candidato` flow, behind an explicit
  button and the text «Vas a crear una cuenta de candidato con {email}. Esta cuenta no
  podrá usarse para publicar vacantes.»; before onboarding it shows the NextAuth session
  email for display only.

### 11.4 Configuration and AWS console (user)

No migration (the `users` table and its `candidate` type exist). New backend setting:
the Cognito UserInfo endpoint for the API (name decided in implementation; value from
the existing hosted domain; never committed). Console checks for the user, queued in
`backend/docs/pending-user-review.md`, on the existing pool and app client:

1. Self sign-up enabled, email as the sign-in identifier, email verification required.
2. Allowed sign-out URL also includes `http://localhost:3000/candidato/login`.
3. The callback stays `http://localhost:3000/api/auth/callback/cognito`; scopes
   `openid email profile` (already required by the recruiter flow).

### 11.5 Frontend placement (frontend owns this)

Real sign-up and sign-in at `/candidato/login` with the same NextAuth provider; onboarding
screen «Crear mi cuenta de candidato» when `role` is `null`; area guards by `role` with a
«Esta cuenta es de empresa/candidato» screen; candidate session, refresh and logout like
the recruiter's.

### 11.6 Decisions recorded for P2b0

- **S1 (user, S20):** same Cognito user pool; the role lives in our database.
- **S2 (user):** explicit onboarding step in our API (no Lambda, no AWS deployment).
- **S3 (user):** existing candidate routes are restricted to candidates in this cut.
- **S20 (user):** one account, one role; email and password sign-up.

## 12. Cut 4 — moving candidates between stages (proposal)

Status: **cut-4 contract agreed** with the frontend agent (msg 0e9b4188; clarifications in
§12.7). Product answers in §12.6. Branch `feat/pipeline-movement`, stacked on `feat/candidate-applications`. Participations exist
since P2b (`process_participations` with `stage_id`, `participation_stage_history`).

Rules: PIPE-11 (no skipping required stages), PIPE-14 (backward moves keep history; leaving
`Placement` has DEL-5 consequences), DEL-3/DEL-4/DEL-5 (one person once; entering
`Placement` confirms a hire and covers a position; leaving needs explicit confirmation and
reduces coverage without erasing history), DEL-9 (full-coverage milestone kept), AUD-*.
Out of scope: `Descartados`, reasons and recovery (cut 5), substates per candidate (cut 6),
delivery fulfillment and KPIs (delivery cut), configuration impact rules (cut 7),
collaborators, bulk moves (§12.6 S4).

### 12.1 Model

- **One move = one participation from its current stage to a target progression stage.**
  Forward: only to the next stage in the vacancy's current order. Backward: to any earlier
  stage (§12.6 S1). The target must differ from the current stage; `Descartados` is not a
  target in this cut.
- **Placement:** entering it records a hire; leaving it (backward) requires the request to
  carry `confirm_placement_exit: true` and records a departure. Covered positions = live
  participations currently in `Placement` (one per person per process, DEL-3). When a hire
  makes covered ≥ hiring headcount, a full-coverage milestone with its timestamp is stored;
  later departures never delete it (DEL-9). Coverage is shown as covered / headcount
  (§12.6 S2).
- **History:** every move appends a history entry (from, to, actor, time, and hire /
  departure when applicable) and an audit event, in the same transaction. Intake entries
  from P2b stay the first entry.
- **Concurrency:** each participation has a version; a move requires `If-Match` with the
  participation's ETag and locks the participation and its process. No automatic retry; the
  client reconciles with `GET`.
- **Configuration while candidates exist** (§12.6 S5): when a vacancy has at least one
  participation, a pipeline `PUT` may only rename stages; reordering, adding or removing a
  stage → `409 stage_change_requires_empty_pipeline`, nothing written. Substates and
  delivery stay editable as today.
- **Authorization:** owner or principal recruiter, like every vacancy configuration route
  (`404` otherwise). Only published vacancies have a board; a draft → `409
  vacancy_not_published`.

### 12.2 Contract

Base `/v2/me/company/job-drafts/{vacancyId}`. `RequireAuth` + recruiter company gates,
`Cache-Control: no-store`, envelope `{error, code}`.

`GET …/board` → `200`:

```json
{
  "stages": [ { "id": "…", "kind": "new", "name": "Nuevos", "count": 3 } ],
  "exit": { "id": "…", "kind": "discarded", "name": "Descartados", "count": 0 },
  "coverage": { "covered": 1, "required": 2, "full_coverage_reached_at": null },
  "participations": [
    { "id": "…", "stage_id": "…", "version": "4",
      "candidate": { "id": "…", "full_name": "Ana Pérez" },
      "applied_at": "…", "source": "organic", "cv": { "id": "…", "name": "CV" },
      "moved_at": "…" }
  ]
}
```

- `stages` in pipeline order with current names; `required` is the hiring headcount or
  `null` if unset; `full_coverage_reached_at` is the first milestone (RFC 3339) or `null`.
- `participations` ordered by stage order, then `moved_at` descending, then id; at most
  1,000 (more → `422 board_too_large`; paging arrives when needed).

`POST …/participations/{participationId}/moves`, `If-Match` required, body exactly
`{ "to_stage_id": "…", "confirm_placement_exit": false }` (the flag is optional, default
false) → `200` with the moved participation (board item shape) plus `coverage`, and the new
`ETag`.

| Status | Code | Case |
| --- | --- | --- |
| `409` | `stage_skip_not_allowed` | Forward move beyond the next stage (PIPE-11) |
| `409` | `placement_exit_confirmation_required` | Leaving `Placement` without the flag (DEL-5) |
| `400` | `validation_error` | Unknown stage, `Descartados`, or same stage |
| `400` | `invalid_request` | Malformed body, unknown/duplicate keys |
| `412` | `version_conflict` | Stale participation ETag |
| `428` | `precondition_required` | Missing `If-Match` |
| `404` | `not_found` | Unknown or foreign vacancy/participation |
| `409` | `vacancy_not_published` | Vacancy is a draft |

`GET …/participations/{participationId}/history` → `200` `{ "items": [ { "kind":
"intake" | "move", "from_stage_id": null | "…", "to_stage_id": "…", "hire": bool,
"departure": bool, "actor": {id, full_name}, "at": "…" } ] }`, oldest first. Stage names
come from the board (current names).

Pipeline `PUT` (cut 1 route) gains `409 stage_change_requires_empty_pipeline`.

Candidate list (`GET /v2/me/applications`, P2b): `status` becomes `submitted | in_process`
— `submitted` while the participation is in the `new` stage, `in_process` in any other
stage (§12.6 S3). This widens a P2b enum (contract change agreed here).

### 12.7 Contract clarifications (agreed, frontend msg 0e9b4188)

1. **Per-item precondition.** Every board item (and the move response) carries `etag`: a
   strong, opaque participation tag (never equal to or parseable as any other resource tag).
   The client sends it unchanged as `If-Match`; the move `200` returns the new tag in the
   item and in the `ETag` header. Empty, weak, list or malformed `If-Match` → `400
   invalid_request`; stale or foreign → `412 version_conflict`; missing → `428`. The board
   item `version` stays as a decimal string for display only.
2. **Locked structure is visible.** `GET`/`PUT …/pipeline` (cut 1) responses gain
   `structure_locked: boolean` — true while the vacancy has at least one participation. The
   client disables reorder/add/remove with an explanation; the `409
   stage_change_requires_empty_pipeline` stays the authority.
3. **Closed enums.** `source`: `organic` (recruiter intake adds values in its own cut).
   `stages[].kind`: `new | screening | screening_ok | in_process | placement | custom`;
   `exit.kind`: `discarded`.
4. **History actor.** `actor` is always `{kind: "candidate" | "recruiter", id, full_name}`,
   never `null`; the intake entry's actor is the candidate.
5. **Recruiter CV download** in this cut: `GET …/participations/{participationId}/cv` →
   the exact CV version of that participation as an attachment with its stored content
   type, `Cache-Control: no-store`; owner or principal only (`404` otherwise); `503
   cv_storage_unavailable` when storage is not configured.
6. **Screening answers** in this cut: `GET …/participations/{participationId}` → the board
   item plus `screening: [{question_id, prompt, type, answer}]` from the application
   snapshot, where `answer` is `{option_id, label}` (single choice) or `{text}` (open). No
   score, correctness or automatic evaluation is shown (INT-22; scoring stays open).
7. `GET …/board` can also return `422 board_too_large` and `409 vacancy_not_published`;
   `required: null` means headcount not set.
8. The candidate-facing API exposes only `status` (`submitted | in_process`) for a
   participation; no stage id, name or history.
9. The client recomputes column counts from the moved item plus `coverage`; on an uncertain
   result, `412` or `404`, it reloads the board and never retries automatically.

### 12.3 Storage (backend)

Additive migration `00023`: participation `version`, history columns for from-stage, hire
and departure flags, and a coverage milestone table (process, reached at, covered,
required). No existing rows rewritten (existing participations start at version 1; intake
history rows keep `from` null).

### 12.4 Frontend placement (frontend owns this)

The existing board (`pipeline-board.tsx`, drag and drop and move menu) on
`/empresa/vacantes/{id}/pipeline` connects to `GET …/board`; a move to a non-adjacent
forward column is disabled in the UI and the server stays the authority; leaving Placement
opens a confirmation dialog; coverage «X de Y plazas cubiertas»; a candidate sheet shows
the history.

### 12.5 Open for later cuts

Discard and recovery (cut 5), substate per candidate and filters (cut 6), delivery
fulfillment from history (delivery cut), configuration impact preview (cut 7).

### 12.6 Decisions recorded for cut 4

- **S1 (user):** forward one stage at a time; backward to any earlier stage.
- **S2 (user):** coverage counting (covered of headcount) is in this cut.
- **S3 (user):** candidates see «Enviada» in `Nuevos` and «En proceso» elsewhere.
- **S4 (user):** one candidate per move; no bulk moves.
- **S5 (user):** while a vacancy has candidates, columns can only be renamed until cut 7.

## 13. Cut 5 — discard with a reason and recovery (proposal)

Status: **cut-5 contract agreed** with the frontend agent (msg a47610b6; clarifications in
§13.6). Product answers in §13.5. Branch `feat/pipeline-discard`, stacked on `feat/pipeline-movement`.

Rules: PIPE-12 (a discard records a reason distinguishing a recruiter decision from a
candidate withdrawal; an extra comment is optional), PIPE-13 (recovery requires
confirmation, returns to the previous stage, keeps both events; if that stage was
`Placement`, renewed occupancy is explicitly confirmed before restoring hiring/coverage),
DEL-2/DEL-5 (leaving `Placement` needs confirmation and reduces coverage; history is never
erased), AUD-*. Thanks to the cut-4 structure lock (columns cannot be removed while
candidates exist), the previous stage always exists in this cut; the open case of a deleted
previous stage (§17.1) stays for cut 7.

### 13.1 Model

- **Discard** moves a participation from any progression stage to the exit stage
  `Descartados` (kind `discarded`). It stores the previous stage, the reason, an optional
  internal comment, an optional message for the candidate, the actor and the time.
- **Reason catalog** (fixed, §13.5 S1), always tied to its group:
  - `recruiter`: `requirements_not_met` (No cumple requisitos), `profile_mismatch` (Perfil no
    adecuado), `salary_expectation` (Expectativa salarial), `other_candidate_selected`
    (Seleccionamos a otra persona), `other` (Otro);
  - `candidate`: `accepted_other_offer` (Aceptó otra oferta), `no_longer_interested` (Ya no
    le interesa), `unresponsive` (Sin respuesta del candidato), `other` (Otro).
  - `other` requires an internal comment (1–1,000 characters); for every other code the
    comment is optional (≤1,000). The internal reason and comment are never shown to the
    candidate.
- **Message for the candidate** (§13.5 S2): optional plain text, 1–500 characters after
  trim, written by the recruiter, shown to the candidate with the status «Finalizada».
- **Discarding from `Placement`** is leaving `Placement`: it requires
  `confirm_placement_exit: true` and records a departure (coverage decreases; milestones
  stay).
- **Recovery** (§13.5 S3) returns a discarded participation to its stored previous stage,
  with explicit confirmation. If that stage is `Placement`, the request must also carry
  `confirm_placement_reentry: true`; recovery then records a renewed hire and may reach a
  new full-coverage milestone. Recovery is never a skip. After recovery the candidate no
  longer sees the message (§13.5 S4); history keeps everything.
- **Moves** (cut 4) never target `Descartados` and never start from it: discard and
  recovery have their own operations.
- **Authorization and concurrency:** owner or principal recruiter, as cut 4; the same
  per-participation `etag` / `If-Match` rules; one transaction per operation with history,
  audit and coverage.

### 13.2 Contract

Base `/v2/me/company/job-drafts/{vacancyId}/participations/{participationId}`; same gates,
`Cache-Control: no-store` and envelope as cut 4.

`POST …/discard`, `If-Match` required, body exactly (optional keys may be omitted):

```json
{ "reason": { "group": "recruiter", "key": "other" },
  "comment": "…", "candidate_message": "…", "confirm_placement_exit": false }
```

`POST …/recover`, `If-Match` required, body exactly `{ "confirm_placement_reentry": false }`
(the key may be omitted; an empty object `{}` is valid).

Both return `200` with the board item, `coverage` and the new `ETag`, like a move.

| Status | Code | Case |
| --- | --- | --- |
| `400` | `validation_error` | Unknown group/key, key not in its group, `other` without comment, comment/message too long or empty after trim |
| `409` | `already_discarded` | Discard of a discarded participation |
| `409` | `not_discarded` | Recovery of a participation that is not discarded |
| `409` | `placement_exit_confirmation_required` | Discard from `Placement` without the flag |
| `409` | `placement_reentry_confirmation_required` | Recovery into `Placement` without the flag |
| `400` | `invalid_request`, `412`, `428`, `404`, `409 vacancy_not_published` | As cut 4 |

Board items (cut 4) gain `discard`: `null`, or `{ "reason": {group, key}, "discarded_at",
"previous_stage_id" }` for participations in the exit stage. The internal comment and the
candidate message are returned only by the participation detail (`GET
…/participations/{id}`), which gains the same `discard` object plus `comment` and
`candidate_message`.

History items gain kinds `discard` and `recovery`: a discard item carries `reason`,
`comment`, `candidate_message` and `departure`; a recovery item carries `hire` when it
re-enters `Placement`. Existing kinds and keys are unchanged.

Candidate list (`GET /v2/me/applications`): `status` becomes `submitted | in_process |
closed`, and each item gains `message` — the candidate message while `closed`, otherwise
`null`. The internal reason never appears.

### 13.3 Storage (backend)

Additive migration `00024`: discard columns on participations (previous stage, reason group
and code with a CHECK on the catalog, comment, candidate message, discarded at) and history
columns for event kind and discard details. Existing rows stay valid (event kind derived for
intake and moves). The down refuses while discard data exists.

### 13.4 Frontend placement (frontend owns this)

A «Descartar» action on the card and in the candidate sheet with the reason (grouped
recruiter / candidate), comment, optional candidate message and the Placement confirmation;
the `Descartados` column shows the reason; «Recuperar» with confirmation (and the Placement
re-entry confirmation); `/candidato/postulaciones` shows «Finalizada» and the message.

### 13.5 Decisions recorded for cut 5

- **S1 (user):** fixed short reason catalog as listed; `other` requires an explanation.
- **S2 (user):** the candidate sees «Finalizada» plus an optional free message written by
  the recruiter (up to 500 characters), never the internal reason.
- **S3 (user):** discard and recovery by the same people who move candidates (owner or
  principal).
- **S4 (user):** after recovery the candidate message disappears from the candidate's view;
  internal history keeps it.
- No notification is sent to the candidate in this cut.

### 13.6 Contract clarifications (agreed, frontend msg a47610b6)

1. **Text rules** for `comment` and `candidate_message`: lengths are Unicode code points
   after trimming leading/trailing Unicode `White_Space`; the interior is kept as sent;
   control characters other than newline and tab are rejected; an empty value after trim
   is `400 validation_error` (clients omit empty optional fields). Plain text only.
2. **History items are a discriminated union** with exact keys:
   - `intake` and `move`: unchanged from cut 4 (no new keys);
   - `discard`: `kind, from_stage_id` (previous stage), `to_stage_id` (exit id),
     `hire` (false), `departure`, `reason {group, key}`, `comment` (string or null),
     `candidate_message` (string or null), `actor, at`;
   - `recovery`: `kind, from_stage_id` (exit id), `to_stage_id` (previous stage), `hire`,
     `departure` (false), `actor, at`.
3. **Participation detail:** `discard`, `comment` and `candidate_message` are always present;
   all `null` unless the participation is currently discarded.
4. **Discarded board items:** `stage_id` is the exit id, they count in `exit.count`,
   `moved_at` equals `discarded_at`, and `discard.previous_stage_id` is always a current
   progression stage (cut-4 structure lock).
5. `409 already_discarded` / `not_discarded` are "changed elsewhere": reload once, never retry
   (like `412`/`404`).
6. `400 validation_error` carries no details; the client validates with the same rules.
7. Candidate list: `message` always present, `null` unless `closed`; shown as plain text with
   «Enviada» / «En proceso» / «Finalizada».
8. Group titles in the UI: «Decisión de la empresa» (`recruiter`) and «Decisión del
   candidato» (`candidate`), labels as in §13.1.
9. **Field name** (frontend msg, agreed): the reason is `{group, key}` everywhere (discard
   body, board/detail `discard.reason`, history `reason`); values unchanged. `code` is
   reserved for error envelopes (and the architecture guard rejects ad-hoc `"code"`
   keys outside the error catalog). A body with `code` instead of `key` is `400
   invalid_request`.

## 14. Public listing enrichment (proposal)

Status: **contract agreed** with the frontend agent (msg 05d47df2; clarifications in §14.5). Requested by the frontend agent (msg a644dd14)
for the public card, with the user's decisions in §14.4. Branch
`feat/public-listing-enrichment`, stacked on `feat/pipeline-discard` (it reads
participations). Extends the P2a public contract (§10.3); legacy `/jobs` routes unchanged.

### 14.1 New keys on every `GET /v2/jobs` item (and therefore on the detail)

All keys always present; closed enums; legacy values as stated.

| Key | Type | Vacancy | Legacy |
| --- | --- | --- | --- |
| `company.logo_url` | string \| null | the company's public logo (same value as `GET /companies/{id}`) | same |
| `excerpt` | string \| null | first ≤240 Unicode code points of `description_plain`, cut at the last whitespace boundary inside the limit (hard cut if there is none), trimmed; `null` if the plain description is empty | same rule over the legacy description |
| `excerpt_truncated` | boolean | true when `excerpt` is shorter than the trimmed plain description | same |
| `benefits_preview` | `{predefined: [codes], custom: [strings]}` | the first 3 benefits in stored order, predefined first | `{predefined: [], custom: []}` |
| `benefits_total` | integer ≥0 | predefined + custom count | 0 |
| `skills_preview` | string[] | the first 6 skills in the order the company entered them | `[]` |
| `skills_total` | integer ≥0 | number of skills | 0 |
| `applicants` | `under_10 \| 10_plus \| 25_plus \| 50_plus` \| null | range over **all** participations of the process, discarded included (§14.4 S1); never an exact number | `null` |
| `screening_questions` | integer ≥0 \| null | number of questions in the current published questionnaire | `null` |

Ranges: `under_10` = 0–9, `10_plus` = 10–24, `25_plus` = 25–49, `50_plus` = 50 or more.

### 14.2 Detail

`GET /v2/jobs/{id}` keeps the full `benefits` object and gains `skills: string[]` (all
skills, entered order; `[]` for legacy). Preview keys are present in the detail too, because
the detail extends the list item.

### 14.3 Storage and privacy (backend)

- Skills become public content (user decision): the public projection allowlist adds them.
  The screening question count is stored in the projection as well, refreshed in the same
  transaction as publish and published saves (§10.2).
- Additive migration `00025` adds the projection columns and **backfills** existing
  projections from their draft fields, so published vacancies never show a wrong
  `screening_questions` (0 would read as «Postulación rápida»). Own commit; the down drops
  the new columns only.
- The applicant range is computed at read time from `process_participations` (count per
  process); the exact count never leaves the backend. No candidate data is exposed.
- Nothing else becomes public: requester, headcount, delivery, pipeline, hidden salary and
  answer keys stay private.

### 14.4 Decisions recorded

- **S1 (user):** every received application counts, discarded included, so the range never
  drops and does not reveal discards.
- **S2 (user):** ranges «Menos de 10» / «10+» / «25+» / «50+».
- **S3 (user, relayed by the frontend):** ranges only, never the exact number; company skills
  are public — complete in the detail, the first ones in the list.
- **Backend choice:** list previews use `*_preview` + `*_total` keys so `benefits` keeps one
  meaning (complete) wherever it appears.

### 14.5 Contract clarifications (agreed, frontend msg 05d47df2)

1. `company.logo_url` is either an absolute `https:` URL with a host (no credentials) or
   `null`. Any other stored value (relative, `http:`, `data:`, malformed) is exposed as
   `null` by the public routes; company data itself is not rewritten. Applies to both
   sources.
2. `excerpt`: before counting, every run of Unicode `White_Space` (newlines included) is
   collapsed to one ASCII space and the result is trimmed; `excerpt_truncated` compares
   against that normalized text.
3. Skills are already trimmed, non-empty and ≤200 code points each (draft validation, at
   most 100 per vacancy); `skills_preview` and `skills` keep the entered order.
   `benefits_preview.predefined` uses the draft benefit catalog codes; custom benefits are
   trimmed, non-empty, ≤200 code points.

## 15. Cut 6 — active substate per candidate and filter (proposal)

Status: **cut-6 contract agreed** with the frontend agent (msg faa0756f; clarifications in §15.6). Product answers in §15.5. Branch
`feat/pipeline-substates-active`, stacked on `feat/public-listing-enrichment`.

Rules: SUB-3 (at most one active substate, history of changes), SUB-4 (labels, not
sequential steps), SUB-5 (filter by active substate, multiple selections with OR, including
«Sin subestado»), PIPE-15 (a used substate is not removed without resolving occupants).
Open decision §17.9 is closed for the board (§15.5 S3); cross-vacancy reporting stays open.

### 15.1 Model

- A participation has `substate_id` (a substate of the vacancy's catalog) or `null`. It can be
  non-null only while the participation is in the stage of kind `in_process`.
- Setting or clearing it is one operation with its own history entry; any order, any substate
  (SUB-4). Setting the current value again is a no-op (no history, same ETag).
- Leaving `in_process` by a move or a discard clears it in the same transaction and records a
  substate history entry to `null` before the move/discard entry (§15.5 S1). Re-entering
  `in_process` (move or recovery) starts at «Sin subestado».
- Catalog (cut 2): renaming a substate is always allowed; a `PUT` that removes a substate some
  participation has active → `409 substate_in_use`, nothing written (§15.5 S2).
- Authorization, concurrency and transactions as cut 4 (owner or principal, per-item `etag`,
  draft → process → participation locks). The candidate never sees substates.

### 15.2 Contract

`POST …/participations/{participationId}/substate`, `If-Match` required, body exactly
`{ "substate_id": "<uuid>" | null }` → `200` with the board item and new `ETag` (same shape
as a move response, `coverage` included unchanged).

| Status | Code | Case |
| --- | --- | --- |
| `409` | `substate_requires_in_process` | Participation not in the `in_process` stage (incl. discarded) |
| `400` | `validation_error` | Unknown substate id for this vacancy |
| `400` | `invalid_request`, `412`, `428`, `404`, `409 vacancy_not_published` | As cut 4 |

Board items gain `substate_id: string | null`. Participation detail likewise.

History union gains kind `substate`: exactly `{kind, from_substate_id, to_substate_id, actor,
at}` (ids nullable; names come from the catalog). Other kinds unchanged.

Substates resource (cut 2) items gain `in_use: boolean` (true while any participation of the
vacancy has it active), so the editor can disable removal; `PUT` gains `409 substate_in_use`.

**Filtering is client-side** over the board (≤1,000 items, §12.2): selected substates are
combined with OR, «Sin subestado» matches `in_process` items with `substate_id = null`, and the
substate filter is combined with AND with every other board filter (§15.5 S3). Items outside
`in_process` do not match a substate filter.

### 15.3 Storage (backend)

Additive migration `00026`: participation `substate_id`, history `from_substate_id` /
`to_substate_id` and event kind `substate` (CHECKs extended so existing rows stay valid). Down
refuses while substate data exists. The catalog keeps stable ids (cut 2), so participations
reference them by id; no foreign key is possible to the JSON catalog, so integrity is enforced
in the write transactions (set, catalog PUT) and checked by tests.

### 15.4 Frontend placement (frontend owns this)

Substate selector on the card and in the candidate sheet while in «En proceso»; substate
badge on the card; multi-select filter with «Sin subestado» on the board; history entries;
catalog sheet disables removing a substate with `in_use: true`.

### 15.5 Decisions recorded for cut 6

- **S1 (user):** leaving «En proceso» clears the substate; history keeps it; re-entry starts
  without substate.
- **S2 (user):** a substate in use cannot be removed from the catalog until reassigned; renaming
  is allowed.
- **S3 (user):** the substate filter combines with other board filters with AND (OR among the
  selected substates).
- **S4 (user):** owner or principal set substates, like moves; candidates never see them.

### 15.6 Contract clarifications (agreed, frontend msg faa0756f)

1. `GET …/board` gains `substates: [{id, name}]` — the vacancy's current catalog in catalog
   order — so the client needs no second read for badges and the filter.
2. Each `substate` history entry also carries `from_substate_name` and `to_substate_name`
   (string or null), snapshotted at the time of the event; a later rename or removal does not
   change past entries. Exact keys: `{kind, from_substate_id, from_substate_name,
   to_substate_id, to_substate_name, actor, at}`.
3. `409 substate_in_use` on the catalog `PUT` carries `details: [{substate_id}]` (one per
   blocked substate, catalog order); it is the only other error with details besides
   `invalid_answers` and `publication_incomplete`.
4. A no-op set returns `200` with the same item and the same `ETag`, without a history entry.
5. Items outside `in_process`, discarded ones included, always have `substate_id: null`;
   `409 substate_requires_in_process` applies to discarded participations too.
6. The board has no other filters yet; the client implements the substate multi-select and
   keeps the AND rule for future filters. No backend change.
