# Schema-2 patch input

`DecodePatchV2` is a pure, additive codec. It does not write drafts, query
catalogs, process ETags or idempotency, or enable HTTP routes.

```go
func DecodePatchV2(body []byte) (PatchV2, error)
func (p PatchV2) Fingerprint() []byte
```

## Presence and replacement

The body must be exactly `{"fields": {...}}`, without a client
`schema_version`. Empty fields return `ErrEmptyPatch`.

`PatchV2` embeds the existing `Fields` for the unchanged groups. Only supplied
fields have `Set == true`; no create defaults are applied. Nullable scalar,
requester and description values can be explicitly cleared with null. Lists
and compensation cannot be null. Objects and lists are fully replaced, never
merged with stored data. Absent fields are not revalidated.

`ScreeningQuestionsV2` is `shared.Optional[[]draftfields.ScreeningQuestionV2]`:

- omitted: `Set == false`;
- supplied valid array: `Set == true`, `Valid == true`;
- supplied empty array: a present, non-nil empty slice;
- supplied null: validation error, not a clearing operation.

The legacy `Fields.ScreeningQuestions` always remains unset. Typed screening
uses the same write validator as schema-2 creation: prompts and option labels
are trimmed, UUID spelling and array order are preserved, and evaluated answer
keys remain employer-facing. Each question is projected with its exact variant
keys. Description retains its own `schema_version: 1`.

## Errors and ordering

The pipeline is body budget, strict JSON, exact envelope, writable vocabulary,
empty-patch check, structural nested preflight, then value validation.

- `ErrPayloadTooLarge`: body exceeds the inclusive 1048576-byte limit.
- `ErrInvalidRequest`: malformed/non-strict JSON, wrong envelope, unknown or
  read-only keys, missing mandatory screening keys, unsupported rich version.
- `ErrEmptyPatch`: the fields object has no keys.
- `ErrValidation`: recognized field values violate their contracts.

Underlying validator errors remain matchable with `errors.Is`. Structural
preflight checks all screening questions/options independently of earlier value
errors; its order remains requester, languages, screening, compensation,
description. Value validation keeps the create/v1 group order. Errors return a
zero result; input bytes are never mutated.

## Fingerprint

The fingerprint is canonical go-json-v1 encoding of
`{"schema_version":2,"fields":<normalized supplied fields only>}`. It is a
**delta**, not a complete persisted document; `ValidatePersistedDraftV2` is not
an appropriate validator for this fingerprint. `Fingerprint()` returns a fresh
byte copy on each call.

For example, `{"fields":{"title":" X "}}` produces exactly:

```json
{"fields":{"title":"X"},"schema_version":2}
```

Existing schema-1 codecs and schema-2 creation are unchanged.

## Checks

From `backend/`:

```sh
go test ./internal/features/jobs/application/draftinput -count=1
go vet ./internal/features/jobs/application/draftinput
```
