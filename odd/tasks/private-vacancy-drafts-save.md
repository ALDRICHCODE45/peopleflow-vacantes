# Private vacancy draft explicit save
Implement the accepted private draft create/read/explicit-save slice in the backend.
Preserve prior work; small local commits for isolated review are authorized, without push, frontend edits, or ambient database access.

## Specs

### S1 — Continuation authorization
> Adelante, no me preguntes ni te pares, siguee

### S2 — Isolated database authorization
User answered `si` to:
> Para verificarlo de punta a punta, ¿autorizás levantar un **PostgreSQL temporal aislado en Docker**, sin usar tu `DATABASE_URL` ni tocar bases existentes? Sin esa prueba no daría el guardado por terminado.

### S3 — Accepted contract
The exact previously authorized frontend contract is reproduced below before the Log. Its DESIGN CANDIDATE label is retained; do not claim contract finalization. This is implementation of its accepted design, not permission to edit the frontend.
The later user HTTPS-only decision supersedes the historical HTTP allowance in section 5.

### S4 — Existing constraints
No autosave, publishing, legacy migration, frontend edits, or modification of earlier B1/OpenSpec/helper work. Use existing validated field/rich/JSON helpers. User preference: “hay que avanzar rapido pero seguro.”
Local commit authorization supersedes the earlier no-staging/no-commit restriction for the review split only. User answered `Si` to: “Para destrabar la revisión, ¿me autorizás a dividir el trabajo en **commits locales chicos, sin push**, preservando los cambios anteriores?”

## Tasks
- T1 [done] S1,S3,S4 — Compose strict create/patch input; muxlyjem-4-p1tq plus deep-key correction muxmjpnl-a-uuam, focused/helpers/vet GREEN and independent recheck passed; commit `0dfe077` (C10), native review acknowledged under T5.
- T2 [done] S1,S3,S4 — Implement pure strong draft ETag/precondition parsing; delegated muxlytvw-5-57e1, focused tests/vet and independent verification passed; commit `2a2d821` (C9), native review acknowledged under T5.
- T3 [done] S1-S4 — Implement transactional draft persistence; muxm7db4-7-5hi2 plus muxn02y8-d-qdyq correction, 6 unit/32 integration tests and vet PASS. Canonical UUID keys, exact owner/principal/replay gates, in-flight revoke and SQL audit failure proofs added. Commit `b36f77b` (C11), native review acknowledged under T5.
- T4 [done] S1-S4 — Connect private HTTP endpoints and errors; muxma2hx-8-8mh0 handler/router tests and vet GREEN; actual HTTP+DB acceptance passed. Commit `b1a882d` (C12), four-lens native review acknowledged under T5.
- T5 [done] S1-S4 — Scoped functional verification, independent checks, and seven native review ranges completed over 12 local commits; all approved authorities acknowledged. Committed-boundary package tests and real HTTP/JWT/PostgreSQL tests PASS. Parent commit isolation preserved main index and all 51 source bytes. This closes the explicit draft save slice, not the global suite or frontend contract finalization; see Known verification limits.

## Local review slices

- C1 [done] Exact JSON integers: `cbae748d5f8e9ecba791105c8acb34702db7d0d9` (number.go + number_test.go, 685 lines). File-pair tests and full draftjson suite PASS. Native review `review-3abea76db8a41299` approved and acknowledged; authority burned.
- C2 [done] Canonical JSON serialization with byte fixtures: `f7162c1c96cedbf2fb52ab06a95952e581ba6bf3` (canonical.go, canonical_test.go, rich_fixtures_test.go, both testdata files; 2164 lines). Self-contained tests PASS. Native review `review-d89952d3cc0bb23e` approved and acknowledged; authority burned.
- C3 [done] Strict JSON decoding: `589e77427e6697c10ab7b3b9dd2c9d7d6cf4f91e` (decoder.go + decoder_test.go; 1051 lines). Package suite PASS. Native review `review-57b45e5d2a7aeec2` approved and acknowledged; authority burned.
- C4 [done] Scalar fields: `7cb86778d1781d293e6d705864199d433e4605ee`.
- C5 [done] Collections: `607e48083e4718cb8e38798bd68501c5832c3759`.
- C6 [done] Nested fields: `e0fb767e6cf30f1247a8b34dd3324caa389309c9`.
- C7 [done] Compensation: `0e43520622d027a5a8d0a4659dd62aa00bd266aa`. C4-C7 field-validation review range approved/acknowledged as `review-92307903adaec8ab`.
- C8 [done] Rich documents, HTTPS links and pinned dependency: `5450024ee4197c6b7420017391f0a01259810f55`.
- C9 [done] ETags: `2a2d821ac934a116b1829ed1fd29be07f97b15f3`.
- C10 [done] Input composition: `0dfe0779d2cff7e4ef112330cc9758c80cc2c619`. C8-C10 input-boundary review range approved/acknowledged as `review-1736c80bc3eaaa2b`.
- C11 [done] Transactional persistence, port, migration and audit: `b36f77bc8555a6ed48dc728f385078fe069783a0`; approved/acknowledged as `review-e100542a744116c9`.
- C12 [done] HTTP endpoints, errors, wiring, docs and acceptance tests: `b1a882d3c276103420459b3081f1220ae53ea912`; high-risk four-lens group approved/acknowledged as `review-a9de4de7c853c79f`.
- Every commit retains its behavior tests. Job-4 PASS at all nine subsequent committed boundaries; no test-only split or source rewrite.
- Commit branch: `feat/private-draft-save-review-slices` in `.scratch/private-draft-save-review`. Main branch/index untouched.
- Clean review checkout: registered `.scratch/private-draft-slice-review`, at C12. Both isolated worktrees are clean. Retained untracked selection in the formerly dirty assembly worktree caused a pre-authority candidate mismatch; a clean committed checkout resolved isolation without authority recovery.
- Final verification: all 51 candidate paths are byte-identical across main, assembly and review checkouts; full diff whitespace checks pass. Main staged B1 requesterName remains the same two files/448 lines; OpenSpec and frontend untouched.
- Job-5 reran committed store integration and real HTTP/JWT flow serially against the exact authorized temporary PostgreSQL container: PASS (1.153s / 0.292s). No ambient DB access, new source changes, or push.

## Current integration status

- User authorized local integration (`si`) without push. `feat/private-drafts-requester-name` fast-forwarded from `3e9a5d9` to `2670cd2`; prior isolated-only statements below are historical.
- All 58 integrated paths matched the reviewed commit. Original B1 index patch and 15 protected files were byte-identical after integration and verification. Duplicate draft copies remain backed up in stash `53e2b7ac724e69aa554868d1770d2280c97c532b`; do not reapply blindly.
- Initial main-tree verification failed because nonignored `.scratch/` held 262350 cache/worktree files. User authorized the proposed exclusion with `como tu recomiendes`: local `.git/info/exclude` now ignores `/.scratch/`, and anchor indexing skips only that root directory. No files were deleted; shared `.gitignore` is unchanged.
- RED observed, then focused GREEN and full untagged backend suite passed: 4080 tests/subtests, 57 packages, 10 packages without tests, no failures, empty stderr. Logs: `.scratch/local-integration-2670cd2/scratch-fix-suite.json` and `.stderr`. A final extra ghost-test fixture was added afterward; independent verifier `muxtz2qt-8-cgj5` reran all four focused anchor-index tests successfully and verified B1/OpenSpec preservation.
- User `adelante` authorized committing the two-file anchor fix locally: `4e7bd307c0c50cfb6aa0625f2739ed1588d26adf` on `feat/private-drafts-requester-name`. The identical mirror remains uncommitted in `.scratch/private-draft-save-review`. Native isolated review `review-e78aea79703a2e42` approved and acknowledged; authority burned at `sha256:68eff417e4cb37ec31798de194d8624ccff4dd555d55f8629b950c5e0ab3467e`. No push. Commit contents match the approved tree exactly; original staged B1 patch and other protected files remain unchanged. This status document is intentionally updated after preservation verification.
- No new full race, tagged database, or browser run. Earlier integration evidence remains separate.

## Known verification limits

- Follow-up after user `adelante`: the isolated assembly now passes full untagged `go test -json ./... -count=1 -timeout=90s` (outer 180s): exit 0, 60.829s, 4005 tests/subtests pass, 0 fail/skip; 57 packages pass, 10 have no test files. Independent verifier `muxr4lf3-7-o13d` observed unchanged before/after content digest. Logs: `.scratch/final-closure-suite.json` and `.scratch/final-closure-suite.stderr` (empty).
- Fixes are seven files committed locally in `.scratch/private-draft-save-review`, not the original tree: SQLC `aaff374b8b15e26c87988925f30a46b2c3258e6e`, capability scope `6578068f5711e899ab6fba6420f967cb4bd156d6`, fixtures `2670cd2b2b54ff16ee486be626228f129721ae34`. They cover shared backend capability scope for archguard/closurereport; minimal gate-unit fixtures; SQLC-generated draft models. The SQLC drift was caused by migration 00012, unlike the pre-existing capability-scope issue. Pinned generation changed only models.go (+34 lines), and clean/seeded-drift verification passed.
- Follow-up native review `review-70f5ad6d614e5a5c` approved and acknowledged, authority burned at `sha256:b36334624c94bab509364b07fbdbb4ab7fdd38332856aef63e4a8839eabdf961`. User subsequently authorized these three local commits (`si, adelante`), without push or merge. All seven files matched the approved candidate Git tree before committing; assembly is clean at `2670cd2`. Original branch/index remain untouched. Earlier C1-C12 byte-equality notes are historical.
- This latest full suite does not run separately tagged live-DB integration or a full race run. Prior isolated draft integration evidence remains separate. LSP check of the first report-only fix was inconclusive, not a clean result.
- Nonblocking follow-up: exported `BackendCapabilities` is a mutable slice while membership is cached at initialization; current repository callers do not mutate it. No observed behavioral defect.
- The port package has no unit test files; adapter and real HTTP integration exercise it.
- No browser/frontend checks, requester catalog HTTP implementation, publication, or contract-finalization claim.
- The branch is local only and has not been merged into the original dirty branch. Temporary PostgreSQL remains running; no cleanup or publication was performed.

## Accepted contract evidence

```markdown
# Private vacancy drafts v1 — design candidate

**Status: DESIGN CANDIDATE — awaiting FE/BE cotejo. NOT implemented. Not contract-final.**

This document proposes the first private-draft API slice: create → get → edit → explicit save of one
incomplete vacancy draft under the same ID. It is a **candidate**, not a build order, not an
implementation plan, and not authorization to write source. The contract may only be called final
after the parent and the backend owner complete a document-by-document comparison.

### Evidence legend

| Tag | Meaning |
| --- | --- |
| `[BE]` | Accepted design supplied/confirmed by the backend owner (latest literal DTO / clarifications). Not independently re-verified here. |
| `[accepted]` | Accepted design, **not implemented** (relabeled from the stale `[prop]` "not backend-confirmed"). |
| `[proven]` | Runtime evidence, limited to the Tiptap proof corpus. |
| `[pending]` | Accepted design whose implementation evidence is still owed. |

**Only the Tiptap rich-document proof has runtime evidence today** (see §5.4). Every other statement
below is a design decision or a supplied fact, not observed runtime behavior.

Business rules are preserved by reference to `docs/recruitment-business-rules.md`; this document does
not restate or soften them.

## 1. Scope and routes

**In scope:** private incomplete draft create→get→edit→explicit save, same ID throughout.

**Out of scope (explicitly):** autosave, publication, delete, drafts listing, principal reassignment,
and legacy-vacancy migration. Drafts are never publicly exposed (VAC-6).

| Method | Route | Purpose | Tag |
| --- | --- | --- | --- |
| `POST` | `/me/company/job-drafts` | Create a private draft; returns the full read envelope | `[BE]` |
| `GET` | `/me/company/job-drafts/{id}` | Read one draft by ID | `[BE]` |
| `PATCH` | `/me/company/job-drafts/{id}` | Explicit save of changed fields | `[BE]` |

Legacy public/update/delete routes must not find new draft IDs — a **requirement to test** (§2.3), not current behavior.

## 2. Write body and read envelope

### 2.1 Write rules (`POST` and `PATCH`) `[BE]`

- The body is always `{ "fields": { ... } }`. `fields` is **required**.
- `POST` with `{}` inside `fields` is allowed (empty draft).
- `PATCH` with an empty `fields` object is rejected: `400 empty_patch`.
- Reject with `400 invalid_request`: unknown fields, read-only fields, duplicate JSON keys,
  invalid UTF-8.
- Request body limit: **1048576 bytes, enforced before decode**. Field limits reject; they never
  truncate.

**`POST` omission semantics:**

| Omitted input | Resulting value |
| --- | --- |
| Scalar | `null` |
| Nullable object | `null` |
| List | `[]` |
| `compensation` | Receives the documented defaults (§4.6) |

**`PATCH` semantics:** omitted field = unchanged; a present field is **fully replaced** (no nested
merge). A list set to `null` is invalid.

### 2.2 Read envelope `[BE]`

```json
{
  "schema_version": 1,
  "id": "<UUID>",
  "status": "draft",
  "principal_recruiter_id": "<UUID>",
  "version": "1",
  "created_at": "<UTC RFC3339, microseconds>",
  "updated_at": "<UTC RFC3339, microseconds>",
  "fields": { "…": "ALL writable fields, §4–§5" }
}
```

- `version` is a **positive decimal string**; the initial value is `"1"`.
- `actor`, `organization`, `principal`, `status` and server timestamps are **never** accepted from
  the request body.
- Read-only derived: `fields.description_plain` and `requester.name` are **never writable**.
- No `closingDate`, `wizardStep`, `employmentType` or `department` legacy fields exist in this
  contract.

### 2.3 Authoring resource and draft identity `[BE]`

- The draft is a **separate authoring resource within the existing `jobs` feature**, not a nullable
  expansion of legacy vacancy rows.
- An immutable `created_by` stores the creator, distinct from the `principal` semantic field even when
  they are equal initially. It is server-owned; there is no extra client write.
- The draft ID is stable. Future publication promotion is a **pending design** (not this slice) and
  must be atomic with no duplicate logical published vacancy.
- "Legacy routes cannot find a draft ID" is a **requirement to test**, not existing behavior: public
  `GET`, legacy `PATCH` and legacy `DELETE` against a draft ID must return `404`.

## 3. Common field rules `[BE]`

- Non-rich free scalar strings are trimmed at Unicode ends; empty becomes `null`. **No interior
  normalization.**
- **Explicitly exempt from trimming:** monetary strings (§4.6 rejects whitespace and never trims) and
  rich string content (§5: no trim, no NFC).
- List items and `screening_questions.prompt` are trimmed, then validated non-empty, then limited;
  limits apply to the **normalized** value.
- Character limits count **Unicode codepoints**; byte limits count UTF-8 bytes.
- Lists: max **100 items**; order is meaningful and **preserved**.

## 4. Simple field table `[BE]`

| Field | Type | Limit / values | Notes |
| --- | --- | --- | --- |
| `title` | string \| null | 200 | — |
| `location` | string \| null | 300 | — |
| `work_mode` | enum \| null | `onsite` \| `remote` \| `hybrid` | — |
| `work_schedule` | enum \| null | `full_time` \| `part_time` | `Jornada`; distinct from contract type (CAT-6) |
| `contract_type` | enum \| null | `project` \| `indefinite` \| `professional_services` \| `temporary` \| `internship` | Labels per CAT-1 |
| `seniority` | enum \| null | `intern` \| `junior` \| `mid` \| `senior` \| `lead` | Retain prototype catalog for this slice; **no years mapping** |
| `professional_area` | enum \| null | 16 codes, §4.1 | No default |
| `requester` | object \| null | §4.2 | — |
| `skills` | string[] | item 200, non-empty after trim | Literal duplicates after trim → `400 validation_error`; no fuzzy matching; order preserved |
| `languages` | object[] | §4.3 | — |
| `benefits` | array | §4.4 | — |
| `custom_benefits` | string[] | item 200, non-empty after trim | Literal duplicates after trim → `400 validation_error`; independent from `benefits`; order preserved |
| `required_requirements` | string \| null | 16384 UTF-8 bytes | — |
| `preferred_requirements` | string \| null | 16384 UTF-8 bytes | — |
| `screening_questions` | object[] | §4.5 | — |
| `compensation` | object (**non-null**) | §4.6 | `[BE]` |
| `description` | object \| null | §5 | Rich document |

### 4.1 `professional_area` codes (REQ-7, 16) `[BE]`

`technology_systems`, `engineering`, `product`, `design_creative`, `sales_business_development`,
`marketing_communications`, `administration_finance`, `human_resources`, `operations_production`,
`logistics_transport`, `customer_service_support`, `healthcare`, `education_training`, `legal`,
`construction_maintenance`, `tourism_hospitality_gastronomy`.

### 4.2 `requester` `[BE]`

`null` or `{ "kind": "internal_area" | "client", "id": "<UUID>|null" }`. Both keys are required if
the object is present. Read adds a derived `name: string | null` (max 160). `id` must belong to the
same organization **and** the same `kind`; otherwise `400 validation_error` with **no data**. Visual
initial state is `internal_area` with **no fake selected ID**.

### 4.3 `languages` `[BE]`

Each item: `{ "language": "es"|"en"|"other", "custom_name": string|null (≤200), "level": "basic"|"intermediate"|"advanced"|"native"|null }`.
All keys required. For `es`/`en`, `custom_name` is `null`; `other` may be `null` (incomplete draft).
No semantic dedup, no CEFR mapping.

### 4.4 `benefits` `[BE]`

Fixed catalog, unique, effectively max 8. "No reordering" means the **backend preserves the
submitted order**; it is not a UI prohibition on reordering. Catalog: `health_insurance`,
`computer_equipment`, `flexible_schedule`, `remote_stipend`, `training_budget`, `extra_time_off`,
`wellness`, `annual_bonus`.

### 4.5 `screening_questions` `[BE]`

Each item: `{ "prompt": string }`, trimmed then non-empty, ≤2000 codepoints **after normalization**.
No UI ids, no answers, no knockout behavior.

### 4.6 `compensation` (non-null object, ALL keys present) `[BE]`

| Key | Type / values |
| --- | --- |
| `mode` | `null` \| `fixed` \| `range` |
| `amount` | `null` \| decimal string |
| `min` | `null` \| decimal string |
| `max` | `null` \| decimal string |
| `currency` | `null` \| `MXN` \| `USD` |
| `pay_period` | `null` \| `hourly` \| `weekly` \| `semimonthly` \| `monthly` \| `yearly` |
| `basis` | `null` \| `gross` \| `net` |
| `public_visible` | boolean |

- Omitted **whole object** on `POST` → `mode`/`amount`/`min`/`max`/`basis` = `null`, `currency` = `MXN`,
  `pay_period` = `monthly`, `public_visible` = `false`.
- Present on `POST`/`PATCH`: all keys required, **no defaults**. A `null` object is `400`.
- Conditional shape: `fixed` → `min`/`max` = `null`; `range` → `amount` = `null`; `mode` = `null` → all
  amounts `null`. `min <= max` is enforced **only when both bounds are non-null**; a single bound is a
  valid incomplete draft, and there is no requirement that both bounds be supplied together.
- Money regex: `^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$`. Range `0`..`999999999999.99`; responses are
  exact to **2 decimals**. Reject sign, exponent, commas, spaces and excess precision; **no rounding
  or conversion**. Monetary strings are **never trimmed**: surrounding whitespace is rejected by the
  regex.
- `quincenal` maps to `semimonthly` (twice a month) — **not** every-two-weeks — and fixes no payroll
  dates. `public_visible` does not publish the draft.

## 5. Rich description design

### 5.1 Shape `[BE]`

`description` is `null` or `{ "schema_version": 1, "document": <restricted PM JSON> }`.

- The proof metadata string `tiptap-draft-contract/v1` is **corpus metadata ONLY** — it is **not** an
  API version. The API version is the numeric `description.schema_version: 1`.
- `description_plain` is derived server-side, `null` iff `description` is `null`, ≤65536 bytes.

### 5.2 Node / mark rules (CAT-3) `[BE]`

- `doc` requires ≥1 block: `paragraph` or `bulletList`/`orderedList`; `doc` cannot be nested and is
  **never empty**.
- `paragraph` has **no attrs**; optional content is `text`/`hardBreak`. An empty `content: []` is
  accepted **only on `paragraph`**; root/list/list-item nodes require valid non-empty grammar. An
  empty paragraph is valid; a null `description` is different, and an empty doc is invalid.
- Lists require ≥1 `listItem`; `listItem` starts with a `paragraph`, then paragraphs/lists.
- `text` is non-empty with **no attrs and no content**; `hardBreak` has **no text/content and no
  attrs**.
- `orderedList` attrs: all of `start` (integer 1..2147483647) and `type: null`.
- Marks appear **only on `text`/`hardBreak`**, max 4 total, one each: `bold` (**no attrs**), `italic`
  (**no attrs**), `fontSizePreset` with **exact attrs `{ "preset": "small"|"normal"|"large" }`**,
  and `link` (attrs below).
- An empty `marks: []` is accepted inline. Preserve `[]` versus omitted; do not normalize them. An
  unknown `description.schema_version` is rejected `400 invalid_request`.
- `link` requires all attrs: `href`, `target`, `rel`, `class`, `title`. Explicit "normal" size is
  preserved.
- `href`: absolute http(s), ≤2048 codepoints, no credentials, no controls, no whitespace, no
  backslash. `target`: `null`/`_blank`/`_self`. `rel`: `null` or an allowlist of
  `noopener`/`noreferrer`/`nofollow` tokens, ASCII-space separated, ≤128 ASCII. `class`: `null` or
  `'enlace-externo'`. `title`: `null` or string ≤200.
- Renderer independently fixes protection/classes; **never** raw HTML or received CSS.
- Unknown nodes, marks, keys or attrs are rejected — no stripping, no array sorting.
- Limits: depth 16 (`doc` = 1), nodes 2000.
- Go validates the tree **before** deriving plain text. Plain extraction: paragraphs concatenate
  text, `hardBreak` → newline, `doc`/list/`item` join child results with newline, no trim, no list
  markers; link label is text, not the URL.
- Raw JSON bypasses the Tiptap URI command validation; the **backend is authoritative**.

### 5.3 Deterministic rich bytes and fingerprint (ACCEPTANCE REQUIREMENT) `[BE]` — seq33 final clarification

> Rich-byte budget and fingerprint deterministic canonicalization are **AUTHORITATIVE BACKEND**. The
> backend preserves strings, arrays and marks. Frontend prevalidation is **optional**; the backend
> decides; there is **no client hash authority**. Shared implementation fixtures must cover `<>&`,
> Unicode, `U+2028`/`U+2029`, escapes, and differing object key order. **Do not assume
> `JSON.stringify == json.Marshal`.** Canonicalization changes encoding/property order only — never
> arrays, strings, marks or the tree. The 65536-byte compact-canonical-JSON budget is **accepted** as
> the BE-authoritative design; the shared byte-serializer fixtures (JS/Go escaping of HTML and
> Unicode) are **implementation evidence still owed**, not a renewed proposal. Cross-language parity
> is not proven.

### 5.4 Proof status `[proven]`

- Fixture SHA-256 `8477901e59fd99657ef9f320547560bce940aebbcd3c2c96c514eff4363fd4e5` at
  `frontend/src/features/jobs/tiptap-contract-proof/fixtures/tiptap-draft-contract.fixtures.json`.
- Tiptap runtime **3.31.4**, corpus of **8 cases, editor-only**: 7 constructed inputs driven through
  the real editor and 1 command-generated. **No Go validation and no serializer execution** were run;
  this is **not API runtime evidence**. The full 1925-test / 91 worker/independent suites are also not
  API runtime evidence. The approved proof is not reopened.
- Acceptance-future only: shared-fixture coverage for marked-`hardBreak` plus the unsafe-HTML and
  empty-text negative cases. No source proof imports production code.

## 6. Auth, authorization and concurrency

### 6.1 Authentication / authorization gates `[BE]`

| Condition | Result |
| --- | --- |
| Missing / invalid / expired token, or absent sub-user | `401 unauthenticated` |
| Membership or role failure | `403 forbidden` |
| Missing / tombstoned company | `403 company_inactive` |
| Company not active at the transactional guard | `409 company_not_active` |

- Middleware `IsCompanyLive` does **not** enforce active status; an explicit **transactional active
  guard** returns `409 company_not_active`.
- Owner or principal only for `GET`/`PATCH`/replay. Other draft, cross-org or missing → `404 not_found`
  **after** the general auth gates.
- `POST`: owner or recruiter with current membership; the creator becomes principal recruiter.
- Permissions, CAS, write and audit are atomic. A no-op still performs the permission/CAS check and
  returns `200` with the same version/ETag, but writes **no audit**. A real change increments the
  version.

### 6.2 `ETag` / `If-Match` `[BE]`

- Format: exact quoted `jd-r1-<lowercaseUUID>-v<positiveDecimalVersion>`. Frontend treats it as
  **opaque** and never constructs it.
- `If-Match` requires one strong, issued tag. Missing → `428 precondition_required`. Weak, list, `*`
  or bad format → `400 invalid_request`. Other ID / stale → `412 version_conflict` (after the auth
  `404`), with no editor data returned.
- The deterministic representation includes the derivation rules and `r1`; `requester.name` is an
  immutable catalog value in this slice. Future catalog changes must invalidate this representation.
- Uncertain `PATCH`: no auto-retry, no assumed success, preserve dirty state, reconcile with an
  explicit `GET`. A `412` does **not** by itself prove UI dirty state was preserved.

### 6.3 POST idempotency `[BE]`

- `POST` requires a UUID `Idempotency-Key`, keyed on org + actor + operation + key; the create, audit
  and idempotency record are atomic.
- Fingerprint is the normalized DTO (object property order irrelevant; array order meaningful;
  defaults and decimal normalization included; schema version included).
- Same payload → `201` with the original body + ETag and `Idempotency-Replayed: true` (vs `false` on
  first creation). Different payload → `409 idempotency_conflict`. Replay re-authorizes. No TTL while
  the draft exists and no delete.
- If a replay returns an older version, the FE must **not** overwrite a newer cache; reconcile with an
  explicit `GET`.
- All private replies and errors carry `Cache-Control: no-store`.
- The query key is **identity + org + id**, not org/id: an `owner` and a `recruiter` in the same org
  must not share a private cache. On identity change, clear or cancel outstanding results. Mutation
  retries use `false`; never overwrite dirty state.
- A BFF/reverse proxy must preserve the `ETag` and `Idempotency-Replayed` response headers.
- Acceptance tests: two concurrent `POST`s sharing one key yield **one row and one audit**; a
  different payload yields `409 idempotency_conflict`; an equivalent normalized payload (defaults,
  decimals) replays. An uncertain `POST` keeps the **frozen key + payload** until resolved, with no
  auto-retry using a new key and no cache overwrite. The existing CAS, audit-rollback and re-auth
  tests remain.

## 7. Requester catalog

| Method | Route | Tag |
| --- | --- | --- |
| `GET` | `/me/company/requesters?kind=internal_area\|client&q=&limit=&cursor=` | `[accepted]` |
| `POST` | `/me/company/requesters` `{kind, name}` | `[accepted]` |

- `GET` response: `{ "items": [{ "id", "kind", "name" }], "next_cursor": null | string }`. `kind` is
  required; `q` defaults empty; `limit` defaults 20, range 1..50.
- `POST` → `201` canonical entry, atomic with audit. Owner/recruiter in the active org (not the
  draft principal); no cross-org access, no actor in the body; no edit/delete/merge.
- An inline entry persists even if the draft is later cancelled, with a UI warning.
- `name`: 160 codepoints. Normalization order: UTF-8 validate → NFC → trim/collapse Unicode
  `White_Space` to ASCII space. `name_key` = full-Unicode casefold → NFC, preserving accents; **no
  NFKC, no fuzzy**. Reject non-whitespace controls; do not silently remove zero-width characters.
- Version the Unicode algorithm + fixtures; pin `UNIQUE(org, kind, key)` in PostgreSQL for
  deterministic behavior with no DB-lower divergence.
- Duplicates → `409 requester_already_exists` with `data: { "existing": { "id", "kind", "name" } }`,
  only for currently authorized entries. Explicit selection — never auto-merge.
- **Dedicated typed-error projection is required** (accepted design, not implemented): the existing
  `WriteCatalogErrorData` strips data except for conflict; the new path must not rely on generic
  error-payload expansion. `[accepted]`
- `name` normalized to empty → `400 validation_error`. Exact vectors: `'Área'` and `'A\u0301REA'` are
  **equal** (NFC + full casefold); `'Area'` is **distinct**. The NBSP-as-space and `Straße`/`STRASSE`
  vectors are unchanged, and org/type separation is enforced.
- `q` is limited to **160 codepoints after normalization** (input body/token bounds are separate).
  `last_name_key` validates the canonical full-casefold output, accounting for Unicode expansion: do
  **not** impose 160 on the expanded key, and do not invent an unproven lexical key limit.
- **Cursor (`[accepted]`):** opaque base64url JSON v1 with `version`, `company_id`, `kind`,
  `q_normalized`, `last_name_key`, `last_id`; encoded token **≤4096 bytes**. Validate version/keys/
  types/UUID/lengths/normalized query/scope, else `400 invalid_request`. Not a credential, not
  encrypted, not a snapshot; the session-org SQL predicate always applies. No signed cursor is
  required for access security. Keyset on `(name_key COLLATE "C", id)`, prefix escaped literally,
  same normalization, no total count. Backend normalization fixtures remain an acceptance item.

## 8. Errors

Envelope: `{ "error": string, "code": string, "data"?: … }`. Human copy is not part of the contract;
`data` is defined **only** for typed requester duplicates on the new paths — not for `412` or
idempotency conflicts.

| Status | Code | Notes |
| --- | --- | --- |
| `400` | `invalid_request` | Existing, reused |
| `400` | `validation_error` | New |
| `400` | `empty_patch` | New |
| `400` | `idempotency_key_required` | New |
| `400` | `invalid_idempotency_key` | New |
| `401` | `unauthenticated` | Existing |
| `403` | `forbidden` / `company_inactive` | Existing |
| `404` | `not_found` | Existing |
| `409` | `company_not_active` | Existing |
| `409` | `idempotency_conflict` | New |
| `409` | `requester_already_exists` | New |
| `412` | `version_conflict` | New |
| `413` | `payload_too_large` | Body oversize; field oversize is `400` |
| `428` | `precondition_required` | New |
| `500` | `internal_error` | Existing |

- The legacy `409 conflict` is unchanged.
- Backend `errors.go` currently falls back to `500` for unknown code/status; this catalog requires
  additions before implementation.

## 9. Verification and worked examples

### 9.1 Auth test seam `[accepted]`

Server-only per-request session resolver; tests inject an ephemeral real JWT and drive the actual
handler through real client HTTP → Go verifier → isolated PostgreSQL with real users/memberships. The
normal app fails closed until a real provider exists. No deployed test endpoint, no test flag, no
arbitrary actor cookie, no static env actor, no new AWS or login UI. Not browser E2E, not Next
cookies/CSRF/refresh; no invented token-revocation store. Test cases: expired JWT `401`, membership
removed / liveness / active guards, owner/principal/non-principal/cross-org, replay re-auth, CAS race,
audit rollback, and UI dirty-state separately.

### 9.2 Minimal create `[BE]`

`POST /me/company/job-drafts` with `Idempotency-Key: <UUID>`:

```json
{ "fields": { "title": "Backend Go", "professional_area": "technology_systems" } }
```

### 9.3 Compensation edit with CAS `[BE]`

`PATCH` with `If-Match: "jd-r1-<uuid>-v1"`:

```json
{ "fields": { "compensation": {
  "mode": "range", "amount": null, "min": "30000", "max": "45000",
  "currency": "MXN", "pay_period": "monthly", "basis": "gross", "public_visible": false } } }
```

→ `200`, `version: "2"`, decimals exact to 2. Stale `If-Match` `v1` → `412`
`{ "error": "draft version conflict", "code": "version_conflict" }` with **no `data`** (the human
copy is illustrative, not contract).

### 9.4 Creation, conflict and replay `[BE]`

- Creation → `201`, `Idempotency-Replayed: false`, `ETag` at version `v1`.
- Replay of the original `POST` with the same key → `201`, `Idempotency-Replayed: true`, and the
  original `v1` body + `ETag`, **even when the current version is `v2`**; an explicit `GET` returns
  the current `v2`.
- With no session present, the request fails closed through the server-only per-request session
  resolver. No invented JWT claim, cookie or token-revocation store is part of this contract.
- `quincenal` maps to `semimonthly` (twice a month) — **not** every-two-weeks — and fixes no payroll
  dates. Visibility does not publish the draft.

The JSON snippets in §9 are **abbreviated illustrations**, not complete response bodies.

## 10. Document finalization and implementation acceptance gaps

Accepted design — requester `GET`/`POST`/cursor/typed-error projection, the compensation default
asymmetry, both numeric `schema_version: 1` keys, and auth — is **decided**. No reconfirmation is
requested. What remains:

1. **Not contract-final.** Finalization awaits the parent/backend full-document readback after this
   exact hash. This is a process gate, not an open design question.
2. **Serializer proof pending** (§5.3): shared byte-serializer fixtures still owed.
3. **Fixture coverage pending** (§5.4): marked-`hardBreak` plus unsafe-HTML/empty-text negatives.
4. **Error catalog implementation.** Backend `errors.go` needs the new codes; unknown codes currently
   fall back to `500` (read-only source evidence as previously recorded).
5. **Publication promotion design.** Promoting a draft to a published logical vacancy is **not this
   slice**; its atomic, no-duplicate design is pending.

## 11. Delivery

No source writes except this document. Exact transcript details take precedence over earlier technical
agreements; edits label **accepted design / not implemented** versus **verified/implemented** behavior.
Finalized business rules are preserved by reference. This is passive documentation, so no meaningful
RED applies — a property of the material, not a disabled TDD toggle. The contract must not be claimed
final until the parent/backend readback completes.

## References

- `docs/recruitment-business-rules.md` (agreed business rules; REQ-7, CAT-1…CAT-6, VAC-6, SAL-2).
- `docs/recruitment-integration-map.md` (FE↔BE gap map).
- `odd/tasks/tiptap-contract-proof.md` (proof scope, versions, fixture SHA, pending items).
- `frontend/src/features/jobs/tiptap-contract-proof/fixtures/tiptap-draft-contract.fixtures.json`.

```

## Log
L21: User `adelante` authorized the recommended separate local fix commit. Created `4e7bd307c0c50cfb6aa0625f2739ed1588d26adf` using path-scoped commit for only archguard.go and archguard_test.go; original staged B1 patch and other protected files unchanged. Committed blobs match approved tree83f16042f0a98e3a3596104b046f0bf9cf51635e. No source rewrite, test rerun, push, or change to the isolated mirror. Local Git exclusion remains unversioned by design.
L20: User `si` authorized local integration without push. After scratch-induced verification failures, user `como tu recomiendes` authorized the proposed local Git and anchor-index exclusion without deleting files or pushing. Integrated at 2670cd2, kept stash53e2b7ac724e69aa554868d1770d2280c97c532b, verified preservation, and resolved failures with the two-file uncommitted anchor fix plus local Git exclusion. Full suite4080passes, final focused verifier PASS, native review-e78aea79703a2e42 acknowledged. See Current integration status for exact evidence and limits.
L19: User `si, adelante` authorized local commits for the latest suite corrections, explicitly without push or merge. Created aaff374 (SQLC), 6578068 (backend scope), 2670cd2 (fixtures) on feat/private-draft-save-review-slices. Seven source files byte-matched approved candidate tree84241af5334942528463631218c5d84af98258bf; temporary review checkout had been removed, so Git blobs provided exact comparison. Isolated assembly clean, original B1 index preserved. No source change or test rerun during commit-only step.
L18: User `adelante` authorized continuing the global-suite pending work. Reproduced and fixed backend-vs-frontend capability scope across both consumers, removed nested closure fixture overhead, and regenerated SQLC draft models. Final independent full unit suite PASS 4005 tests/subtests/57 packages in60.829s; zero failed/skipped tests, 10 packages without tests. Native review review-70f5ad6d614e5a5c approved/acknowledged. Seven follow-up files remain uncommitted solely in isolated assembly; original main preserved. Live integration/race not rerun in this follow-up.
L17: Completed 12 local cohesive commits with code/tests/docs together. All seven native review ranges approved and acknowledged, including final high-risk four-lens HTTP group. Job-4 boundary unit checks PASS; job-5 isolated PostgreSQL/HTTP acceptance PASS. Final 51-file byte equality and both clean worktrees verified; original staged B1/OpenSpec preserved. Global-suite historical timeout/closurereport remains outside this split; no push, merge, frontend work, or cleanup.
L16: C3 589e774 native review review-57b45e5d2a7aeec2 approved and acknowledged. Job-3 all targeted unit packages PASS, including handler/router/store/error/audit regressions (drafts port has no tests). Job-4 now assembles remaining cohesive commits and checks actual committed boundaries; no DB access, source edits, pushes, or main index changes. Remaining native reviews pending.
L15: C2 f7162c1 passed self-contained canonical/fixture tests; native review review-d89952d3cc0bb23e approved and acknowledged. Background job-3 checks remaining draft unit packages without DB or network access before further commits.
L14: Parent rejected the explorer's source/test split and unverified compilation claims. C1 focused tests and package suite passed; commit cbae748 on isolated branch; native review review-3abea76db8a41299 approved/acknowledged with burned authority. Remaining scope has not been reviewed. Full-suite timeout/closurereport failure remain recorded.
L13: User: “Si” in response to “Para destrabar la revisión, ¿me autorizás a dividir el trabajo en **commits locales chicos, sin push**, preservando los cambios anteriores?” Local commit splitting is authorized; no frontend edits or push. T1-T4 historical no-commit notes describe the prior state; T5 owns the authorized split and commit evidence.
L1: User: “Adelante, no me preguntes ni te pares, siguee”
L2: Prior user authorization covers temporary isolated Docker PostgreSQL. Running peopleflow-drafts-test-01a112f8, PostgreSQL16.14 on127.0.0.1:32768, ephemeral tmpfs, database/user draft_test. No production or ambient database use.
L3: Existing main staged requesterName and OpenSpec changes remain untouched. Prior rich review approved/acknowledged review-60834bccecce96eb. No commits authorized.
L4: T1/T2 are disjoint pure units launched together; no DB or network access by these writers. Save HTTP/persistence acceptance remains pending.
L5: T1 worker muxlyjem-4-p1tq writes only application/draftinput; T2 worker muxlytvw-5-57e1 writes only application/draftversion. Read-only explorer muxlz142-6-2iod maps exact transactional/auth/audit/router seams for T3/T4. Parent waits for pushed results; no completion claimed.
L6: T1 initial tests/vet passed, but independent verifier muxmhgk5-9-sp0t found deep rich unknown-key errors classified as validation_error instead of invalid_request. Correction muxmjpnl-a-uuam active; T2 independently passes. Native assess unassessable due undeclared untracked scope; independent verification applied.
L7: T3 muxm7db4-7-5hi2 and T4 muxma2hx-8-8mh0 run with disjoint surfaces and frozen drafts.Store port. Parent shared error catalog tests RED then GREEN. Requester catalog HTTP remains separate; current save validates references only.
L8: Parent middleware regression could not start offline due missing chi module. Downloaded pinned modules into project cache; verified go.mod/go.sum hashes unchanged. Worker offline checks can resume. No production DB access.
L9: T3 corrections passed 6 unit/32 integration tests. Parent strengthened SQLSTATE55P03 lock-timeout, P0001 exact trigger error, full response/ETag including updated_at rollback, and unauthorized changed-payload replay assertions. Parent serial integration command for draftstore and real cmd/api TestDraftFlow PASS (1.144s /0.169s).
L10: HTTP/JWT/PostgreSQL acceptance muxmuwys-c-wfbj passed 9 test functions/16 subtests including defaults, compensation save, stale CAS, original replay, concurrent create/save, no-op, expired token/revoked membership/company gates, private404s and legacy route isolation. No browser or requester catalog HTTP claimed.
L11: Full unit suite timed out180s; all logged functional packages passed; closurereport failed canonical133 vs122. This is not a full-suite PASS.
L12: Prepared registered .scratch/private-draft-save-review detached worktree from3e9a5d9 with51 byte-verified files including prior helper dependencies, excluding B1/OpenSpec/task logs. Native inspect/start returned lens_context_budget_exceeded, mutation not_started, no authority created. Proposed lineage review-8e197f13ebdda030 is NOT active; do not status/abandon/retry same candidate. Provider requires smaller reviewable commits; no commits/staging authorized or performed.
