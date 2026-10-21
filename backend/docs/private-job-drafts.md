# Private vacancy drafts API (v1)

Implementation reference for the private incomplete-vacancy-draft slice:
create → read → explicit save of one draft under the same ID.

This document describes the **implemented HTTP adapter** (T4). The accepted
contract is `odd/tasks/private-vacancy-drafts-save.md` (sections 1–10); where
this document and that contract differ, the contract wins.

The HTTP adapter is a thin transport over the persistence port
(`internal/features/jobs/application/drafts`). It owns only the HTTP shape; the
store owns authorization, preconditions, idempotency, audit and persistence.

## Routes

| Method | Route | Success |
| --- | --- | --- |
| `POST` | `/me/company/job-drafts` | `201 Created` |
| `GET` | `/me/company/job-drafts/{id}` | `200 OK` |
| `PATCH` | `/me/company/job-drafts/{id}` | `200 OK` |

`{id}` must be a UUID. A malformed path id is `400 invalid_request` and never
reaches the store.

## Identity and authorization

Identity comes **only** from the session context built by the auth middleware
(`RequireAuth` → `RequireCompanyRole(recruiter)`). There is no actor, company
or membership input in the path, body or headers; any client-supplied company
or actor value is ignored.

The persistence layer re-evaluates authorization transactionally inside the
same transaction as the write:

| Condition | Result |
| --- | --- |
| Missing / invalid token, no resolvable user | `401 unauthenticated` |
| No current membership, or role below recruiter | `403 forbidden` |
| Company missing / tombstoned | `403 company_inactive` |
| Company exists but is inactive at the transactional guard | `409 company_not_active` |
| Draft missing, in another company, or caller is neither owner nor principal | `404 not_found` |

The `404` is returned **after** the general auth gates, so a foreign or
non-principal draft is indistinguishable from a missing one. On `PATCH`, the
resource authorization runs **before** the precondition comparison, so a stale
tag can never be used as an existence oracle.

`POST`: owner or recruiter. `GET`/`PATCH`: owner or draft principal.

## Request body

The body is always exactly `{ "fields": { ... } }`.

- `POST` with an empty `fields` object is valid (an empty draft).
- `PATCH` with an empty `fields` object is rejected: `400 empty_patch`.
- Omitted `PATCH` fields stay unchanged; a present field is fully replaced (no
  nested merge). A list set to `null` is invalid.
- Create applies the documented defaults (omitted scalar → `null`, omitted list
  → `[]`, omitted `compensation` → documented defaults).
- Unknown or read-only keys, duplicate JSON keys and invalid UTF-8 are
  `400 invalid_request`. Field-value violations are `400 validation_error`.

## V2 profile requirements (H3a-1)

`POST`, `GET` and `PATCH /v2/me/company/job-drafts[/{id}]` use these
requirements inside `fields` (the stored/read `schema_version` remains **2**):

```json
{"seniority":"semi_senior","languages":[{"code":"en","min_level":"B2"}],"min_years_of_experience":"1.5","min_education_level":"bachelor","accepts_in_progress_education":true}
```

- `seniority`: null or exactly `intern|junior|semi_senior|senior|lead|manager|director`.
- `languages`: at most 20 entries, unique catalog `code` (see
  [language-catalog.md](language-catalog.md)), each with exactly `code` and
  `min_level`. Both keys are required and non-null. Levels are
  `A1|A2|B1|B2|C1|C2|native`; code/level spelling is never trimmed or case-folded.
  The old `{language,custom_name,level}` shape is rejected.
- `min_years_of_experience`: null or a decimal string matching
  `^(0|[1-9][0-9]?)(\.[0-9])?$`, range 0–60 inclusive. `"60.1"`, `"01"`,
  `"1.50"` and JSON numbers are invalid. A zero fraction is normalized:
  `"2.0"` becomes `"2"` on writes and reads.
- `min_education_level`: null or exactly
  `secondary|high_school|technical|tsu|bachelor|specialty|master|phd`.
- `accepts_in_progress_education`: boolean, never null; meaningful only with
  a minimum education level, but accepted independently.

Create defaults: `seniority`, minimum years and minimum education are null;
`languages` is `[]`; the education flag is `false`. PATCH omission preserves the
stored value; each present field replaces it completely. All keys are present
in stored documents and GET responses. Persisted validation rejects missing
keys and noncanonical values rather than silently repairing them.

Unknown keys are `400 invalid_request`; invalid values (including missing
language entry keys, duplicates and list overflow) use the existing draft
`400 validation_error` two-key envelope, not the candidate-profile field-error
extension. **None of these requirements block publication** (INT-22).
Legacy `/jobs` and historical draft v1 codecs remain unchanged.

### Migration 00041 (H3a-2)

Deploy `00041_vacancy_harmonization.sql` before serving the new codecs. It rewrites
stored draft BYTEA with 00031's canonical encoder and escaped-NUL masking,
preserving unrelated content and the schema marker. Every row advances `version`
once and receives `updated_at=now()` (including unchanged/partial historical
fixtures), invalidating previous draft ETags. Historical incomplete fixtures
remain incomplete; the migration does not invent unrelated missing fields.

Seniority `mid` becomes `semi_senior`. Languages keep `es`/`en`, or resolve `other`
against frozen Spanish catalog names and English aliases using NFC, case and
accent folding. Levels map `basic→A2`, `intermediate→B1`, `advanced→C1`,
`native→native`; null levels and unmatched names are dropped. Duplicate codes
retain their highest level and their first occurrence's order. If more than 20
distinct codes survive, only the first 20 remain; later duplicates still strengthen
retained codes. PostgreSQL NOTICE reports dropped, collapsed and distinct overflow
counts per draft. The three new fields default to null/null/false.

Only the existing public projection seniority column/check changes (`mid` is
rewritten); its source version stays unchanged. No new projection columns or
public API/search changes are included. Legacy `jobs` is untouched. **Frozen
idempotency/replay response bytes, fingerprints and original ETags are untouched**,
matching 00031's precedent: they describe the original request, not current state.

Like 00039, rollback metadata preserves data discarded by best-effort mapping.
`vacancy_draft_0041_backup` retains both original canonical bytes and the migrated
bytes (two documents per migrated draft, cascading on draft deletion).
`vacancy_language_0041_catalog` freezes Spanish names for rollback of new/edited
rows; neither metadata table is used by runtime reads/writes.

Down restores unchanged migrated rows from the backup, retaining dropped names,
duplicates and overflow. New or edited rows are reverse-mapped: `semi_senior→mid`,
`A2→basic`, `B1→intermediate`, `C1→advanced`, `native→native`. Other language codes
become `other` with the catalog Spanish name; their remaining CEFR levels become
null. For `es`/`en`, an unmappable level is refused. Non-null minimum years or
education, a non-false education flag, and `manager`/`director` seniority are also
refused (including projection seniority), atomically. The three requirement keys
are removed and unrelated edits are retained. Both directions use the identical
00031 canonical encoder and NUL-safe scanner, including on a fresh Down connection.
Versions advance again rather than rewinding. Both directions lock drafts and
projections; a version overflow aborts the transaction rather than wrapping.

Tests: `TestVacancyHarmonizationDefinition` pins the frozen catalog and canonical
encoder. Integration-tag tests cover stored mapping/projections/rollback,
overflow NOTICE, guarded Down, representable new/edited drafts, and canonical/historical envelopes. The DB tests
must be run against the dedicated disposable draft database.

## Structured geography (G2)

Both draft codecs now use a nullable structured `location` and nullable
`remote_scope`; the current editor uses `/v2/me/company/job-drafts` with r2 ETags.
See [geo-vacancy.md](geo-vacancy.md) for exact write/read shapes, validation,
publication rules and migration 00031. Both fields default to null and retain the
same whole-field replacement/no-op/CAS semantics. Locations are code-only in
storage and expanded to `{id,name}` plus a label on reads. Remote country arrays
retain submitted order. New `422 invalid_location` and `422 invalid_remote_scope`
errors carry `details:[{field,reason}]`; location paths start `fields.location.`.
Unknown nested keys remain `400 invalid_request`. These additive 422 envelopes
are exceptions to the baseline two-key error envelope below.

## Request-body budget

The request body limit is **1048576 bytes**, enforced **while reading**, before
the full payload is materialized and before the store is called. The handler
rejects; it never truncates.

- A raw body larger than the budget is `413 payload_too_large`.
- A body within the budget whose **field** violates a field limit is
  `400 validation_error`.

## Headers

### `POST` — `Idempotency-Key`

Required. Exactly one header line, non-empty, well-formed UUID.

| Case | Result |
| --- | --- |
| Header absent | `400 idempotency_key_required` |
| Header present but empty | `400 invalid_idempotency_key` |
| Repeated header line(s) | `400 invalid_idempotency_key` |
| Present but not a UUID | `400 invalid_idempotency_key` |

A repeated `Idempotency-Key` line is **never** silently collapsed to its first
value.

The key is scoped to (organization, actor, operation, key):

- Same key + equivalent normalized payload → `201` replay of the original body
  and ETag, with `Idempotency-Replayed: true` (even if the draft has since
  advanced; an explicit `GET` returns the current version).
- Same key + different normalized payload → `409 idempotency_conflict`.
- The first creation returns `Idempotency-Replayed: false`.

The replay/conflict comparison is versioned internally. A new idempotency
record stores the SHA-256 digest of the normalized write DTO together with an
explicit algorithm tag, and the comparison is dispatched by that persisted tag.
A record written before the tag existed is tagged with the legacy
canonical-bytes representation and replays/conflicts on its original bytes, so
existing keys, stored response bodies, ETags, audit events and counters are
unchanged. An unknown tag or a malformed digest fails closed as `500
internal_error` with no write. The HTTP contract above does not change.

### `PATCH` — `If-Match`

Required. Exactly one strong draft tag:

```text
"jd-r1-<lowercase-uuid36>-v<positive-decimal-version>"
```

The ETag is opaque to clients; never construct it by hand.

| Case | Result |
| --- | --- |
| Header absent | `428 precondition_required` |
| Header present but empty | `400 invalid_request` |
| Repeated header line(s) | `400 invalid_request` (flattened to a list before parsing) |
| Weak tag, list, `*`, or malformed | `400 invalid_request` |
| Tag for another draft or a stale/foreign version | `412 version_conflict` |

A `412` carries no editor data. There is **no automatic retry**: on an
uncertain `PATCH`, keep the dirty state and reconcile with an explicit `GET`;
do not reuse the changed version.

Repeated `If-Match` lines are flattened with commas by the adapter so the
store's parser rejects the list; the first line is never silently trusted.

## Responses

- Success bodies are the **exact stored JSON bytes** — the same bytes on replay.
- `ETag` is the strong tag for the returned version.
- `POST` always sets `Idempotency-Replayed: false` or `true`; `GET`/`PATCH` do
  not set it.
- Every private response, **including `401`/`403` produced by the auth
  middleware before the handler**, carries `Cache-Control: no-store`. The
  no-store middleware is mounted before the auth gates and only on these routes,
  so public routes are unchanged.
- Error bodies are the catalog envelope `{ "error": string, "code": string }`
  with no `data` (no DTO or editor data is ever returned on an error).
- A BFF or reverse proxy must preserve the `ETag` and `Idempotency-Replayed`
  response headers and must not cache private responses.

## Status codes

| Status | Code | Notes |
| --- | --- | --- |
| `400` | `invalid_request` | Malformed envelope, unknown/read-only key, duplicate key, invalid UTF-8, malformed path id, malformed/empty `If-Match` |
| `400` | `validation_error` | Recognized field violates its value contract |
| `400` | `empty_patch` | `PATCH` `fields` object has no keys |
| `400` | `idempotency_key_required` | `POST` without `Idempotency-Key` |
| `400` | `invalid_idempotency_key` | Key present but empty, duplicated or not a UUID |
| `401` | `unauthenticated` | Missing/invalid token |
| `403` | `forbidden` | No membership / insufficient role |
| `403` | `company_inactive` | Company missing or tombstoned |
| `404` | `not_found` | Missing, foreign or non-principal draft (after general gates) |
| `409` | `company_not_active` | Company inactive at the transactional guard |
| `409` | `idempotency_conflict` | Same key, different normalized payload |
| `412` | `version_conflict` | Stale or foreign `If-Match`; no data |
| `413` | `payload_too_large` | Raw body over the budget |
| `428` | `precondition_required` | `PATCH` without `If-Match` |
| `500` | `internal_error` | Unexpected/server invariant failure |

## Rollout

- Migration `00013_version_draft_idempotency_fingerprint.sql` adds the
  algorithm tag with the legacy representation as its default, so it is safe to
  apply while old rows exist; they are tagged legacy and never rewritten.
- Do **not** run a pre-00013 binary against a table that already holds digest
  rows: it reads the 32-byte digest as canonical bytes and turns every replay
  into a conflict. Deploy the new binary before new digest rows are written, and
  do not treat a mixed rollback as safe.
- The migration down half refuses transactionally while any non-legacy row
  exists, so digest rows are never left unreadable. A legacy-only table (no new
  writes yet) reverts cleanly.

## Out of scope

This slice deliberately does **not** implement, and these routes do **not**
expose:

- **autosave** (saves are explicit only),
- **publication** of a draft to a public vacancy,
- **delete**,
- **drafts listing**,
- requester catalog routes (owned separately),
- legacy-vacancy migration.

Drafts are never publicly exposed. Legacy public/update/delete job routes must
not find a draft id (they return `404`).

## Examples

Create:

```sh
curl -X POST https://api.example.com/me/company/job-drafts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: 6f2d0b3c-6a1e-4e2c-9b1a-0d9f0b6f2a11" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"title":"Backend Go","professional_area":"technology_systems"}}'
```

Read:

```sh
curl https://api.example.com/me/company/job-drafts/$DRAFT_ID \
  -H "Authorization: Bearer $TOKEN"
```

Explicit save under the ETag returned by `GET`:

```sh
curl -X PATCH https://api.example.com/me/company/job-drafts/$DRAFT_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H 'If-Match: "jd-r1-<uuid>-v1"' \
  -H "Content-Type: application/json" \
  -d '{"fields":{"compensation":{"mode":"range","amount":null,"min":"30000","max":"45000","currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":false}}}'
```

## Source map

| Concern | File |
| --- | --- |
| HTTP adapter + no-store middleware | `backend/internal/features/jobs/infrastructure/http/draftHandler.go` |
| Route wiring | `backend/cmd/api/router.go` |
| Composition root | `backend/cmd/api/main.go` |
| Persistence port | `backend/internal/features/jobs/application/drafts/drafts.go` |
| PostgreSQL adapter | `backend/internal/features/jobs/infrastructure/postgres/draftstore/` |
| Request composer | `backend/internal/features/jobs/application/draftinput/` |
| ETag / If-Match | `backend/internal/features/jobs/application/draftversion/` |
