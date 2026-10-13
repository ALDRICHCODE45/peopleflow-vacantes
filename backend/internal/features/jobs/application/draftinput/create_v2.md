# Screening v2 — create codec

This file documents `create_v2.go`, the create-only sibling of the v1
`DecodeCreate`. It composes the strict, normalized writable field input of a
schema-2 private vacancy draft `POST` request and exposes the canonical
schema-2 fingerprint. Patch, store writes, idempotency, HTTP envelopes and
routes are out of scope.

## API

```go
func DecodeCreateV2(body []byte) (CreateV2, error)

type CreateV2 struct {
    Fields
    ScreeningQuestionsV2 []draftfields.ScreeningQuestionV2
}

func (c CreateV2) Fingerprint() []byte
```

`CreateV2` reuses the v1 `Fields` container for the 16 unchanged groups and
carries the typed v2 questions separately. The promoted legacy
`Fields.ScreeningQuestions` is **always left unset**: a v2 question is never
projected through the lossy v1 prompt-only helper. After a successful decode
every unchanged field is present with its create default and
`ScreeningQuestionsV2` is a non-nil slice.

`Fingerprint` returns a fresh copy of the canonical bytes on every call; the
returned value never aliases internal state.

## Request envelope

The accepted body is always exactly `{"fields": {...}}`, with no client
`schema_version`:

```json
{ "fields": { "title": "Backend Go", "screening_questions": [] } }
```

A root `schema_version` marker, any other root key and a non-object `fields`
value are request errors. The body length is checked against `MaxBodyBytes`
(1048576) before decode. The raw body is then decoded with the strict
`draftjson` decoder: duplicate keys, invalid UTF-8, lone surrogate escapes,
non-integer numbers and trailing data are rejected.

## Unchanged groups

The nine nullable scalars, `requester`, `skills`, `languages`, `benefits`,
`custom_benefits`, `compensation` and `description` use the same validators,
defaults and normalized wire projection as v1. An omitted scalar or nullable
object becomes `null`, an omitted list becomes `[]`, an omitted compensation
receives the v1 default, an omitted description becomes `null` and an omitted
`screening_questions` becomes a non-nil empty array. The nested rich
description keeps its unchanged `description.schema_version: 1` envelope.

## Screening v2

`screening_questions` is validated by `draftfields.ValidateScreeningQuestionsV2`
(the present-value normalizer), never by the persisted canonical wrapper. Three
strict variants exist and each emits exactly its own keys in the fingerprint:

| `type` | Projected keys |
| --- | --- |
| `open` | `id`, `type`, `prompt` |
| `single_choice_informative` | `id`, `type`, `prompt`, `options` |
| `single_choice_evaluated` | `id`, `type`, `prompt`, `options`, `correct_option_id` |

An option emits exactly `id` and `label`. Prompt and label text is end-trimmed
of Unicode White_Space; the submitted UUID spelling and question/option order
are preserved verbatim; `correct_option_id` membership is an exact string
comparison against `options[].id`.

Structure is checked separately by a bounded structural-only walk. It inspects
every question and option, independently of any earlier value error in the
group, and reports an unknown key before a missing mandatory key for the variant
discriminated by `type`. A missing `type` is a missing mandatory key; a
non-object question, a non-string or unknown `type`, a present non-array
`options` value and a non-object option are left to the value validator and keep
their existing value classification.

## Fingerprint

`Fingerprint` is the canonical go-json-v1 encoding of the complete 17-field
value wrapped as schema 2:

```json
{ "fields": { "...17 fields...": null }, "schema_version": 2 }
```

Object key order is irrelevant, array order is meaningful, and the bytes are
accepted by `ValidatePersistedDraftV2`. The schema marker is the same numeric
private draft schema version as the persisted v2 root.

## Error taxonomy

| Condition | Error |
| --- | --- |
| raw body longer than `MaxBodyBytes` | `ErrPayloadTooLarge` |
| malformed/non-strict JSON | `ErrInvalidRequest` (wraps the `draftjson` error) |
| root not exactly `{"fields": {...}}` (client schema marker, extra root key, non-object `fields`) | `ErrInvalidRequest` |
| unknown/read-only key in `fields` or an unchanged nested/rich object | `ErrInvalidRequest` |
| missing or unknown screening variant key | `ErrInvalidRequest` (wraps `ErrScreeningV2MissingKey` / `ErrScreeningV2UnknownKey`) |
| unsupported rich description `schema_version` | `ErrInvalidRequest` |
| a recognized field value violates its contract | `ErrValidation` (wraps the group validator error) |

Structural errors are request errors and value errors are validation errors,
matching the inherited v1 taxonomy. No partial result is returned with an
error and the input bytes are never mutated.

### Error precedence

The order matches v1 and the screening structural preflight runs before value
composition:

1. `MaxBodyBytes` budget (`ErrPayloadTooLarge`).
2. Strict `draftjson` decode (`ErrInvalidRequest`).
3. Exact root envelope and root key vocabulary (`ErrInvalidRequest`).
4. Nested structural key preflight, in v1 order: `requester`, `languages`,
   `screening_questions`, `compensation`, `description`. The
   `screening_questions` slot runs a bounded structural-only walk that inspects
   every question and option independently of any earlier value error, so a
   later unknown or missing variant key still beats an earlier empty prompt/label
   and every earlier invalid scalar. Its non-structural outcomes are ignored
   here and re-derived in step 5.
5. Value composition, in v1 order: scalars, `skills`, `custom_benefits`,
   `benefits`, `languages`, `screening_questions`, `requester`, `compensation`,
   `description` (`ErrValidation`).
6. Canonical schema-2 fingerprint encoding.

In particular, a screening value error never preempts an earlier group value
error, and the nested structural ordering `requester` > `languages` >
`screening_questions` > `compensation` > `description` is preserved.

## Boundaries and non-readiness

This is a pure codec only. It adds no patch decoder, no store write, no
idempotency, no ETag, no version dispatcher, no route, no HTTP envelope and no
persistence or database access. `draftinput.go` and every other existing source
file are untouched, so the v1 create/patch byte-exact fingerprints and error
behavior stay intact. Composing this codec does not, by itself, make the create
endpoint ready.

## Out of scope

`DecodePatchV2`, create-v2 store writes, idempotency digests, schema-version
dispatch, routes and HTTP mapping remain separate work.
