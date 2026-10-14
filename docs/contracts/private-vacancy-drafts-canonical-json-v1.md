# Private vacancy drafts — canonical JSON addendum v1

Accepted implementation convention for the deterministic rich bytes and `POST` fingerprint of
`docs/contracts/private-vacancy-drafts-v1.md` (§5.3, §6.3). This is **accepted design with
implementation evidence pending**: no source, tests, API, or serializer is implemented here, and no
product, currency, list, or auth agreement is reopened.

- Algorithm id: **`go-json-v1`**. This is **not** RFC 8785 / JCS.
- Authority: the **backend** owns canonical bytes, budget, and fingerprint. Frontend prevalidation is
  optional; there is **no client hash authority**.
- Frozen parent: `docs/contracts/private-vacancy-drafts-v1.md`, SHA-256
  `17c83c206cf11b6fd95b197aeef03b238ca0de220389e5f0ae67de1c54d48fa3`.

## Quick facts

| Topic | Decision |
| --- | --- |
| Canonical id | `go-json-v1` (not JCS) |
| Bytes / budget / fingerprint owner | Backend authoritative; FE optional, no hash authority |
| Raw body bound | ≤ 1 MiB before decode |
| Rich budget | `len(Marshal({"schema_version":1,"document":…}))` ≤ 65536 |
| Plain budget | `description_plain` UTF-8 bytes ≤ 65536, separate |
| Fingerprint | `SHA-256` over `Marshal({"schema_version":1,"fields":…})` |
| Encoder | `encoding/json.Marshal` defaults; not `Encoder.Encode`, not `SetEscapeHTML(false)` |

## 1. Request intake (pre-canonical)

- Raw body **≤ 1 MiB, enforced before decode**.
- Must be **valid UTF-8** and **one** JSON value.
- Reject **duplicate keys at all levels** and **unpaired escaped UTF-16 surrogates before** the
  ordinary Go decode, because Go may substitute an invalid `\uXXXX` surrogate with the replacement
  character and lose the defect.
- A frontend object-schema validation **cannot** detect raw duplicate keys; duplicates are a
  raw-bytes concern, not a post-decode one.
- The existing request/schema/tree validation still runs **before** any trusted plain or canonical
  output.

## 2. Restricted JSON view

The canonical tree is restricted to `map[string]any` / `[]any` plus primitive types.

- No structs, no `omitempty`, no `RawMessage`, no custom `Marshaler`.
- Present keys are retained; an absent key stays absent.
- An **empty array is a non-nil slice**; `null` is a **nil** value. They are distinct.
- **No** array sorting, no mark reordering, no trimming, no NFC, no defaulting, no type coercion.

## 3. Rich numbers

Only two fields carry rich numbers: `description.schema_version: 1` and `orderedList.attrs.start`
(integer `1..2147483647`).

- Decode with `UseNumber`; classify the **exact lexical** integer and its range, then convert to
  `int64`. **No `float64` authority.**
- Accept lexically integer-valued forms: `1`, `1.0`, `1e0` → `1`; `3` and `3.0` → `3`.
- Reject a fraction or an out-of-range value.
- Complexity is bounded by **input lexical length**: do not build `10^exponent` or an unbounded big
  decimal. Classify **mantissa + decimal position** before any conversion, so huge magnitudes reject
  quickly for these positive-only field domains.
- Planned negative tests: `1e999999999` and `1e-999999999` are invalid.
- Money is unchanged: accepted as **normalized decimal strings** with two places (§4.6).

## 4. Encoding rules

- Use `encoding/json.Marshal` **defaults** on the restricted view. Do **not** use `Encoder.Encode`
  (it appends a newline) and do **not** call `SetEscapeHTML(false)`.
- Known ASCII keys follow the encoder's **lexicographic** order.
- Strings use Go quote/backslash/control escaping. HTML-significant characters stay escaped:

  `"<>&"` → `"\u003c\u003e\u0026"`

- Actual U+2028 / U+2029 encode as `\u2028` / `\u2029`; other Unicode stays literal UTF-8.
- **Logical string values are unchanged** — escaping affects bytes only.

## 5. Rich byte budget

- `len(Marshal({"schema_version":1,"document":…}))` must be **≤ 65536** for the complete envelope,
  including keys, braces, and escapes.
- `description: null` carries **no** tree budget.
- `description_plain` is limited to **≤ 65536 UTF-8 bytes separately**.
- The request body bound (§1) is separate from both budgets.

## 6. Idempotency fingerprint

- `SHA-256` of `Marshal({"schema_version":1,"fields":<COMPLETE NORMALIZED WRITE DTO>})`.
- Normalization included: `POST` defaults, `null` / `[]` shapes, two-decimal money, rich description.
- Excluded (identity/auth scope outside org + actor + operation + idempotency key): read `id`,
  `version`, timestamps, `principal`, `created_by`, org, derived `requester.name`, `description_plain`.
- Persist the algorithm version **with the idempotency record** so future reinterpretation is
  impossible; this is not a schema/API `version` bump.
- The fingerprint is **not** a hash of the response envelope.

## 7. Shared fixtures (planned)

Each fixture carries an input (raw JSON where appropriate), the expected canonical UTF-8 or hex,
`byteLength`, and `sha256` **measured by the implementation, never invented**. Planned coverage:

- encoder unit `{ "b": null, "a": "<>&" }` — key order plus escapes;
- valid rich fixtures kept separate from the encoder unit;
- "Café" and emoji: literal vs decomposed forms, decomposed ≠ NFC;
- an actual U+2028 and the escaped `\u2028` are the same; a text-literal backslash-`u2028` differs;
- quote / backslash / newline / tab / NUL;
- `paragraph` absent-content vs `[]` distinct; marks absent vs `[]` distinct; permuted mark arrays
  distinct;
- `null` / `false` / `[]` distinct; integer-form acceptance;
- budget pairs 65536 vs 65537, including HTML-escape expansion;
- raw surrogate and duplicate-key rejection.

## 8. Evidence boundaries

- Frontend and Go must pass the **shared fixture checks before any parity claim**.
- Go encoder behavior is read from backend `go doc Marshal` / `Encoder.SetEscapeHTML` under
  **Go 1.26.1** — not from execution parity.
- Accepted design only: **not** API implemented, **not** a serializer, **not** new dependencies,
  **not** source authorization.
- No expected hashes were produced; every hash field waits on measured implementation output.

## Checklist

- [ ] Frozen parent hash unchanged: `17c83c…4fa3`.
- [ ] No product, currency, list, or auth agreement reopened.
- [ ] Encoder example shows single-backslash escape sequences.
- [ ] Every expected `sha256` is implementation-measured, not authored.

---

Related: `docs/contracts/private-vacancy-drafts-v1.md` §5.3, §6.3; `odd/tasks/private-vacancy-drafts.md`.
