# Persisted private vacancy draft v2 — complete-document validation

This file documents `persisted_v2.go`, the additive pure validator of an
already stored canonical schema-2 private vacancy draft document. It is a
bounded validation unit only: no request decoder, no request body budget, no
create defaults, no store, no database, no route, no version dispatcher, no
HTTP envelope and no persistence.

## API

```go
func ValidatePersistedDraftV2(canonical []byte) error

var (
    ErrPersistedDraftRoot
    ErrPersistedDraftVersion
    ErrPersistedDraftNonCanonical
)
```

`canonical` is the stored byte slice. It returns `nil` when the stored document
is the complete canonical schema-2 value and an error otherwise. The input
bytes and the decoded tree are only read and are never mutated.

## Persisted root shape

The decoded root must be exactly:

```json
{ "schema_version": 2, "fields": { ...17 fields... } }
```

- The root must be a non-nil object with exactly `schema_version` and `fields`.
- `schema_version` must be the integer `2`. An integral spelling such as `2.0`
  decodes to the integer `2` and is accepted.
- `fields` must be a non-nil object with exactly the 17 writable keys, all
  present and none unknown:
  `title`, `location`, `work_mode`, `work_schedule`, `contract_type`,
  `seniority`, `professional_area`, `requester`, `skills`, `languages`,
  `benefits`, `custom_benefits`, `required_requirements`,
  `preferred_requirements`, `screening_questions`, `compensation`,
  `description`.
- Top-level read-envelope metadata and derived keys (`description_plain`, `id`,
  `status`, timestamps, `organization`, `principal`, and so on) are rejected.

Decoding reuses the strict `draftjson` decoder with its technical depth and
value limits. The `draftinput` request body budget (`MaxBodyBytes`) is **not**
applied: the persisted API has no 1048576-byte request cap.

## Value validation and canonical comparison

Values are validated, never the raw JSON bytes. Key order, inter-token
whitespace and JSON string escapes are accepted as long as the decoded values
are canonical.

| Group | Validator | Canonical check |
| --- | --- | --- |
| nine nullable scalars | `draftfields.ValidateScalars` | stored value compared with the normalized scalar, so surrounding whitespace and empty-string→null are rejected |
| `requester` | `draftfields.ValidateRequester` | exact `kind`/`id` only; the derived `name` is rejected |
| `skills`, `custom_benefits` | `draftfields.ValidateSkills` / `ValidateCustomBenefits` | stored values compared with the trimmed projection |
| `benefits` | `draftfields.ValidateBenefits` | exact untrimmed codes |
| `languages` | `draftfields.ValidateLanguages` | stored values compared with the end-trimmed projection |
| `screening_questions` | `draftfields.ValidatePersistedScreeningQuestionsV2` | grammar plus byte-for-byte canonical prompt/label; UUID spelling and the exact `correct_option_id` member are preserved; **never** projected through the v1 prompt-only helper |
| `compensation` | `draftfields.ValidateCompensation` | all eight keys, every cross-field rule and the exact normalized money strings |
| `description` | `draftrich.ValidateDocument` | unchanged nested `schema_version: 1` envelope keys and grammar; text and href are preserved |

The normalized projection reuses the composer's typed→wire helpers
(`requesterValue`, `stringValues`, `languageValues`, `compensationValue` and the
scalar projection through `canonicalFields`). `canonicalFields` is called with
`screening_questions` left unset, so the v2 questions are never fed through the
v1 projection. Nothing is normalized, repaired, regenerated or defaulted: a
stored value that a normalizer would change is rejected.

## Error taxonomy

| Condition | Error |
| --- | --- |
| malformed JSON, duplicate keys, invalid UTF-8, lone surrogate, non-integer number | `ErrPersistedDraftRoot` (wraps the `draftjson` error) |
| root not exactly `{schema_version, fields}`, `fields` not a non-nil object, missing or unknown key in `fields` | `ErrPersistedDraftRoot` |
| present `schema_version` is not the integer `2` | `ErrPersistedDraftVersion` |
| a field violates its contract or differs from the normalized projection | `ErrPersistedDraftNonCanonical` |

`ErrPersistedDraftNonCanonical` always wraps the underlying group validator
error when there is one, so a caller can still match a specific sentinel with
`errors.Is` (for example `draftfields.ErrInvalidEnum` or
`draftfields.ErrScreeningV2NonCanonical`). Root, version and field errors are
distinguishable with `errors.Is`.

Every rejection is a later server invariant failure, not a client HTTP 400
result. No HTTP mapping is introduced here.

## Boundaries and non-readiness

This validator does **not** establish readiness of a full versioned read:

- No store, database, version dispatcher, route, HTTP envelope or renderer is
  added or changed.
- No v1 compose/decode/create-default path is called, and the v1 fingerprint
  and screening projection stay intact.
- No persisted byte equality is required: storage as `BYTEA` does not force the
  stored bytes to equal the canonical encoder output.

Composing this validator does not, by itself, prove endpoint readiness. The
version-aware dispatcher, store, read envelope, authorization gates and route
enablement remain separate work.

## Out of scope

No request decoder, request body budget, create default, canonicalization,
digest, ETag, idempotency, schema-version dispatch, route, store, persistence,
database, dependency or HTTP mapping is added or changed here. `draftinput.go`,
its tests and every other existing source file are untouched.
