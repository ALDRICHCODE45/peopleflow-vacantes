# Private vacancy drafts v2 — screening questions design proposal

**Status: DESIGN PROPOSAL — technical decisions FE/BE DESIGN AGREED (BE seq4). NOT implemented.
Not full-file approved. Not an implementation permission. Not contract-final.**

The backend reviewed **only the seq4 decision extract**, not this whole file or its hash. This
revision records those decisions and closes the stale design questions; it does **not** claim endpoint
readiness or whole-file approval. Product-agreed types and limits stay `[accepted]`; technical
decisions agreed between FE and BE per seq4 are `[agreed]`.

Two layers are kept apart: the **approved product concept** `[accepted]` and the **FE/BE design
agreement** `[agreed]`. `[agreed]` is a design decision, not implemented behavior and not a human
implementation grant.

### Scope quotes (source of this unit)

> "Siguiente paso: acordar el contrato v2 de preguntas antes de conectarlo al editor. Recomiendo 2–8
> opciones por pregunta y hasta 200 caracteres por opción."
>
> "Bien, adelante."

The approval covers the **limits** (2–8 options, ≤200 characters per option) and this **documentation
agreement**. It does **not** cover backend or frontend source implementation.

### Evidence legend

| Tag | Meaning |
| --- | --- |
| `[accepted]` | Approved product concept. Not implemented. |
| `[agreed]` | FE/BE DESIGN AGREED (BE seq4). Not implemented, not full-file approval, not a human implementation permission. |
| `[pending]` | Implementation evidence still owed. |
| `[v1]` | Preserved by reference to `docs/contracts/private-vacancy-drafts-v1.md`. |

## 1. What changes and what does not

**Changes:** only the item shape of `fields.screening_questions`, plus a v2 envelope marker.

**Unchanged `[v1]` (preserved by reference):** every other field, all limits and normalization rules,
`description.schema_version: 1` and its whole tree rules, compensation, requester, auth gates, CAS/
`ETag` mechanics and `POST` idempotency semantics. This document does not restate or relax them.

Preserved v2 constraints: at most **100** questions per draft and a `prompt` of at most **2000
Unicode codepoints** after normalization `[v1]`.

## 2. Question model

**Approved concept `[accepted]`:** exactly three explicit types exist. There is **no** auto-reject and
**no** pipeline action attached to any question; evaluation never moves or discards a candidate
automatically (INT-22). An automated-score feature is **out of scope and undecided**, not forbidden by
this document.

| Approved concept | Correct answer | Product meaning |
| --- | --- | --- |
| Open question, human review | none | Free text; a human reads it. |
| Single choice, informative | none | One choice from a list; purely informative. |
| Single choice, evaluated | **exactly one**, mandatory | One choice; exactly one correct option. |

### 2.1 Wire names `[agreed]`

BE agreed these wire names per seq4: `open`, `single_choice_informative`, `single_choice_evaluated`
and the correct-answer key `correct_option_id`.

### 2.2 Strict key sets per variant `[agreed]`

Each question object is strict. Only the listed keys are allowed; **every** listed key is required.

| `type` | Required keys | Forbidden keys |
| --- | --- | --- |
| `open` | `id`, `type`, `prompt` | `options`, `correct_option_id` |
| `single_choice_informative` | `id`, `type`, `prompt`, `options` | `correct_option_id` |
| `single_choice_evaluated` | `id`, `type`, `prompt`, `options`, `correct_option_id` | — |

- `correct_option_id` is **required, non-null**, and must be **exactly one member** of `options[].id`.
  It is **never** allowed on `open` or `single_choice_informative` (absent, not `null`).
- Each option item requires **both** `id` and `label`; no other option key is allowed.

### 2.3 Options `[accepted]`

- Present on both single-choice types; **absent** on `open`.
- **2–8 options** per question. 1 and 9 are invalid.
- Each option `label`: **1–200 Unicode codepoints**, trimmed at Unicode ends first, then validated
  non-empty and then limited. An empty-after-trim label is invalid.
- Order is meaningful and preserved.

### 2.4 Identifiers `[agreed]`

- Stable **UUIDv4** IDs (version nibble `4`, RFC variant `8`–`b`). Each question ID is unique within a
  questionnaire; each option ID is unique within its question.
- Edits and reordering **preserve** IDs. IDs are assigned once and never reassigned in-place.
- These IDs are authoring-level identity, not the future candidate-answer storage identity (§6).

### 2.5 Unknown input and duplicate labels `[agreed]`

- An unknown `type`, unknown option key or unknown question key is **rejected**. There is no fallback
  type and no stripping: a v2 question object is strict, with only the keys its type allows.
- Two options with **exact-equal trimmed labels** are rejected (same as `[v1]` list duplicates). No
  NFC, no casefolding, no fuzzy comparison.

## 3. Write body, envelope, canonical bytes and digest `[agreed]`

- **Write schema marker.** The write body is always `{ "fields": { … } }`. There is **no client
  `schema_version` input**: the root `schema_version` is a read/persisted canonical marker, **not** a
  new allowed write key. A root `schema_version` in a write is wrong and expects
  `400 invalid_request`; do not mistakenly allow a client write version.
- **Persisted canonical schema and resource version.** The stored draft carries the canonical
  `schema_version: 2` plus its resource version; the client never supplies either.
- **Canonicalization `[agreed]`.** `go-json-v1` encoding of
  `{"schema_version":2,"fields":<complete normalized 17 fields>}`, including the private IDs, types,
  options and `correct_option_id`. `description.schema_version: 1` is unchanged.
- **Persisted algorithm.** Exact string **`go-json-v1+sha256`** (SHA-256, 32 bytes). The legacy
  **`go-json-v1+canonical-bytes`** is unchanged — it is not "rich bytes". v1 bytes, tags and replays
  stay unchanged.
- **Version mismatch outcomes.** `GET`/`PATCH` addressing a **known other** resource version →
  `404 not_found` (no payload, no `ETag`, no editor data). An **unknown/corrupt stored** version →
  `500`, never a version mismatch.
- A v2 `GET` must **not** silently transform, project or downgrade into the v1 shape; a v1 `GET` must
  not forward-fit v2 data. Cross-version reads/writes **reject**; they never project lossily.

## 4. Routes, gates, errors, idempotency and ETag `[agreed]`

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/v2/me/company/job-drafts` | Create |
| `GET` | `/v2/me/company/job-drafts/{id}` | Read one |
| `PATCH` | `/v2/me/company/job-drafts/{id}` | Explicit save |

V1 routes stay **without a prefix** and intact. The FE/BE seq4 route agreement is a design decision,
not an implemented endpoint.

### 4.1 Gates and order `[agreed]`

Same pipeline as v1: `Cache-Control: no-store` → auth → recruiter → existing store authorization
(owner/principal checks as applicable). **After these authorization gates**, check the addressed
resource's schema version: another known schema version → `404` before `If-Match` and before body
semantics. This ordering also applies to reads; schema inspection never bypasses authorization.

### 4.2 Error taxonomy `[agreed]`

Errors keep the exact `{ "error", "code" }` shape (no v2 `data`). Unknown, missing or extra keys and
malformed JSON → `400 invalid_request`. Types, UUIDs, list counts, labels, unknown vocabulary type and
a `correct_option_id` that is not a member → `400 validation_error`. A **missing required key** is
`400 invalid_request`; a **required non-null key sent as `null`** is `400 validation_error`. The v1
strict rules for **duplicate JSON keys and invalid UTF-8 remain**.

### 4.3 Idempotency `[agreed]`

- Scope is **(company, actor, operation, key)**, with the key a canonical UUID.
- Operation: v1 is `create`, v2 is **`create:v2`**. Lookup + `INSERT` run under the advisory lock.
- **Same key across versions is independent**: v2 `create:v2` may create a **second** draft alongside
  a v1 `create`; there is **never** cross-version replay or fallback.
- **Within one version**: identical normalized canonical request bytes replay the original result;
  different canonical bytes → `409` existing conflict. Raw JSON whitespace or key ordering is not
  the request identity.
- The DB uniqueness already includes the `operation` `TEXT` column. That is **not** proof that the
  overall migration set is complete.

### 4.4 ETag `[agreed]`

- v1 `jd-r1-…` is **intact**. v2 uses a quoted **`jd-r2-<UUID>-v<n>`** form (`<n>` positive decimal).
- A **separate v2 parser**: missing tag → `428 precondition_required`; malformed, weak, list, `*`, or a
  foreign marker **including `r1`** → `400 invalid_request`; a valid `r2` with the wrong ID or stale →
  `412 version_conflict` **after** the auth and version gates.
- v2 replay re-authorization uses the `r2` parser.

## 5. Existing v1 is untouched and not migrated `[agreed]`

- The v1 exact parser, read model, canonical bytes, tags and replay behavior stay exactly as they are.
- Migration is **excluded**; there is **no** legacy 3-question cap change and no migration. Existing v1
  drafts stay v1.
- Any future conversion requires an **explicit, persisted, concurrency-gated operation** with IDs
  assigned once; that constraint is stated only, with **no** migration design specified.

## 6. Candidate-facing projection `[agreed]` — server allowlist

If a candidate surface is ever built, it reads a reduced projection defined by a **server-side
allowlist**: `id`, `type` (`open` | `single_choice`), `prompt`, and, for choices only,
`options: [{ id, label }]`. Absent data is **omitted**, never serialized as `null`.

- The candidate DTO carries **no answer keys, no flags and no scores** — no `correct_option_id`, no
  evaluation flag, no score metadata. Automated scoring is **out of scope and undecided**; this
  document neither adds nor forbids it.
- No public draft endpoint and **no public candidate-answers API** are created by this document.
  Questions do not automatically publish (VAC-6).

### 6.1 Employer variants (valid JSON)

```json
{
  "id": "b0f1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  "type": "single_choice_evaluated",
  "prompt": "¿Qué palabra clave declara una función en Go?",
  "options": [
    { "id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "label": "func" },
    { "id": "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", "label": "function" }
  ],
  "correct_option_id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
}
```

```json
{ "id": "c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c", "type": "single_choice_informative", "prompt": "¿Qué modalidad de trabajo prefieres?", "options": [ { "id": "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", "label": "Remoto" }, { "id": "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f70", "label": "Híbrido" } ] }
```
```json
{ "id": "d2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d", "type": "open", "prompt": "Describe un proyecto del que estés orgulloso." }
```

### 6.2 Candidate projection — keys omitted, not `null`

The **evaluated** question maps to `type: "single_choice"` with `correct_option_id` **stripped**:

```json
{ "id": "b0f1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "type": "single_choice", "prompt": "¿Qué palabra clave declara una función en Go?", "options": [ { "id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "label": "func" }, { "id": "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", "label": "function" } ] }
```
The **informative** question maps identically (no key exists to strip):

```json
{ "id": "c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c", "type": "single_choice", "prompt": "¿Qué modalidad de trabajo prefieres?", "options": [ { "id": "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", "label": "Remoto" }, { "id": "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f70", "label": "Híbrido" } ] }
```
The **open** question maps to `type: "open"` and omits `options` (and `correct_option_id`) entirely:

```json
{ "id": "d2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d", "type": "open", "prompt": "Describe un proyecto del que estés orgulloso." }
```

## 7. Compatibility and validation example matrix `[agreed]`

Constraints below are **design constraints**, not newly executed tests; no suite is run by this unit.

| # | Case | Expected |
| --- | --- | --- |
| 1 | v1 payload on the v1 route | Unchanged; accepted as v1 `[v1]`. |
| 2 | Typed v2 question sent to a v1 route | Reject (unknown keys). |
| 3 | `schema_version` present in a write body | `400 invalid_request` (not a write key). |
| 4 | Unknown `type` | Reject; never fall back. |
| 5 | Missing required key / extra key | `400 invalid_request`. |
| 6 | Required non-null key sent as `null` | `400 validation_error`. |
| 7 | `single_choice_evaluated` `correct_option_id` not an `options[].id` member | `400 validation_error`. |
| 8 | `single_choice_informative` with `correct_option_id` | Reject. |
| 9 | `open` with `options` or `correct_option_id` | Reject. |
| 10 | `options` length 1 / 2 / 8 / 9 | Reject / accept / accept / reject. |
| 11 | Label length 200 / 201 codepoints after trim | Accept / reject. |
| 12 | Duplicate labels after exact trim | Reject `[agreed]`. |
| 13 | Repeated prompts across questions | Legal. |
| 14 | Reorder questions or options | Order preserved. |
| 15 | Edit a question or option | ID stable. |
| 16 | Address a known other resource version | `404 not_found` (no payload/ETag/editor data). |
| 17 | Unknown/corrupt stored version | `500` (not a mismatch). |
| 18 | v2 `If-Match` given an `r1` tag | `400 invalid_request`. |
| 19 | Valid `r2` tag, wrong ID / stale | `412 version_conflict` after gates. |
| 20 | Candidate projection of the evaluated question | `correct_option_id`, flags and scores excluded. |

## 8. Resolved decisions and future implementation gates

**Resolved by FE/BE seq4 (design closed, not endpoint-ready):** routes, gates/order, error taxonomy,
version-mismatch outcomes, idempotency scope and operation names, ETag v2 form and parser,
canonicalization + exact algorithm, candidate allowlist, wire names, UUIDv4 stability,
100/2000/2–8/200/1 MiB limits, duplicate exact-trim with no NFC/casefold, and no legacy 3-cap/migration.
No stale open design question remains in this document.

**Future implementation gates (not design questions):**

- Implement typed v2 validation first, then version-aware dispatcher/store/read, then enable v2 routes only after all implementation gates are satisfied. This user-approved sequencing adjustment allows safe validation of persisted v2 data; it does not make endpoints ready.
- Select the expected version immutably on the server, not from client input or stored-row dispatch. Keep the default v1 store and v1 behavior unchanged; do not introduce a partial v2 store or pass through unvalidated v2 data.
- Replay parser `r2` and the `create:v2` operation namespace.
- Reject outcomes perform **no mutation**.
- v1 goldens unchanged.
- Candidate allowlist tests.

Docs may close design decisions; they do **not** make the feature endpoint-ready or approve the whole
file.

## 9. Form integration boundary

- The `Questionnaire` shadcn component is installed at exact `@shadcn/react` **0.3.1**
  (`frontend/src/components/ui/questionnaire.tsx`). It is a presentational primitive: **not** the
  authoring model, and it carries no validation authority.
- The backend remains the **privacy owner** of screening data; the client cannot decide exposure.
- The root form must stay **outside** the draft form; draft-form integration is a **future** unit.
- The legacy prototype cap (`MAX_SCREENING_QUESTIONS = 3` in the create-form prototype) is **not**
  changed here and is not the v2 contract limit.

## 10. Evidence boundaries and delivery

- **No source, test, README, business-rules or v1-contract file is edited**; no dependencies,
  services, database or git operation is touched.
- The backend reviewed only the seq4 decision extract, **not** this whole file or its hash; the
  `[agreed]` decisions are design agreement, not implementation or full-file approval.
- JSON snippets in §6 are checked structurally by **in-memory parse only**, plus UUIDv4/RFC-variant
  and `correct_option_id` membership checks; they are illustrations, not full response bodies.
- This is passive documentation, so TDD is not applicable; the checks are syntax/structural, not
  behavior tests, and the §7 limits remain constraints, not executed tests.
- Not contract-final: finalization awaits the parent/backend readback after this exact doc hash.

## References

- `docs/contracts/private-vacancy-drafts-v1.md` — §3, §4.5 (screening item shape), §5 (rich
  `description.schema_version: 1`), §6 (CAS/ETag/idempotency), §8 (error envelope).
- `docs/contracts/private-vacancy-drafts-canonical-json-v1.md` — canonical id `go-json-v1`, digest.
- `docs/recruitment-business-rules.md` — INT-22 (no automatic rejection), VAC-6 (never expose drafts).
- `frontend/src/features/jobs/drafts/lists.ts` — current v1 screening validator (`{ prompt }` only).
- `odd/tasks/private-vacancy-drafts.md` — v1 task boundary.
