# Screening v2 — persisted field validation

This file documents `screening_v2_persisted.go`, the additive persisted
entry-point wrapper over the present-value `ValidateScreeningQuestionsV2` of
`screening_v2.go`. It is a bounded validation unit only: no codec, no
projection, no persistence, no store, no routes, no version dispatch and no
error-envelope or HTTP mapping.

## API

```go
func ValidatePersistedScreeningQuestionsV2(raw any) error

var ErrScreeningV2NonCanonical
```

`raw` is the same already-decoded value accepted by
`ValidateScreeningQuestionsV2`: an exact non-nil `[]any` of at most 100 strict
typed question objects. The function returns `nil` when the value is canonical
and an error otherwise.

## Two-stage contract

1. **Grammar first.** `ValidateScreeningQuestionsV2` runs unchanged. Any grammar
   error is returned verbatim, so `errors.Is` still matches the existing
   `ErrCollection*` and `ErrScreeningV2*` sentinels.
2. **Canonical comparison.** After a successful grammar validation, every stored
   prompt and option label is compared **byte-for-byte** against the normalizer
   output. A stored value that the normalizer would change is rejected with
   `ErrScreeningV2NonCanonical` and the offending `screening_questions[i]...`
   field path.

Nothing is normalized, mutated, repaired, regenerated or lowercased. The input
is only read and is never mutated on either the success or the failure path.

The normalizing API still accepts and end-trims surrounding Unicode
`White_Space`; the persisted API rejects exactly that same input as
non-canonical. Interior whitespace, U+FEFF, case and composed/decomposed Unicode
are preserved and stay canonical, so `é` (U+00E9) and `e` + U+0301 are distinct
legal labels.

## Preserved values

Only prompt and option label are compared, because only those two are changed by
the normalizer. The validator already preserves the submitted UUID spelling
verbatim, compares question/option IDs case-insensitively, and checks
`correct_option_id` membership as an exact string. Therefore:

- An uppercase UUID is canonical when authored that way, and
- `correct_option_id` must match the stored option ID spelling exactly.

No extra UUID or identity comparison is added for values the validator already
preserves. This product decision is settled.

## Errors

| Condition | Result |
| --- | --- |
| any grammar failure | the unchanged `ValidateScreeningQuestionsV2` error |
| stored prompt differs from normalizer output | `ErrScreeningV2NonCanonical` + `screening_questions[i].prompt` |
| stored option label differs from normalizer output | `ErrScreeningV2NonCanonical` + `screening_questions[i].options[j].label` |

Persisted errors are later server-invariant failures, not client HTTP 400
results. No HTTP mapping is introduced here.

## Boundaries and non-readiness

This wrapper does **not** establish readiness of a full persisted read:

- The upstream strict JSON decoder still owns malformed JSON, duplicate JSON
  keys and source UTF-8.
- The persisted root (top-level `screening_questions` envelope), schema version
  and the complete-17-field canonical checks of the remaining fields are out of
  scope.
- No `partialStore`, `rawv2` passthrough, route, store, renderer or DB access is
  added.

Composing this wrapper with `description` alone must not be inferred to prove
full persisted validity.

## Out of scope

No wire DTO, JSON codec, default, canonicalization, digest, schema version,
route, store, persistence, DB, dependency, HTTP mapping or version dispatch is
added or changed here. `screening_v2.go`, its tests, the v1 validators and every
other source file are untouched.
