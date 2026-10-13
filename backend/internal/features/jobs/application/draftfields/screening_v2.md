# Screening v2 — pure typed question validation

This file documents `screening_v2.go`, the additive present-value validator for
the v2 typed screening question collection of a private vacancy draft. It is a
bounded validation unit only: no codec, no persistence, no routes, no store, no
error-envelope mapping and no write-body decoding.

## API

```go
func ValidateScreeningQuestionsV2(raw any) ([]ScreeningQuestionV2, error)

type ScreeningQuestionV2 struct {
	ID              string
	Type            string
	Prompt          string
	Options         []ScreeningOptionV2
	CorrectOptionID string
}

type ScreeningOptionV2 struct {
	ID    string
	Label string
}
```

Plain domain structs, not wire DTOs. `Options` is `nil` when the variant has no
options; `CorrectOptionID` is `""` when the variant has no correct answer. A
valid ID is never empty. No marshaling shape is claimed here.

`raw` is the already-decoded collection from the upstream strict JSON decoder:
an exact non-nil `[]any` of at most 100 question objects. An accepted empty
array returns a fresh non-nil empty slice. Every error returns a `nil` slice, so
a caller never observes a partial result. The input is only read and is never
mutated; returned slices never alias the input.

## Boundaries

Three decoding stages exist and must not be conflated:

1. **Upstream strict JSON decoding.** The existing strict decoder owns malformed
   JSON, duplicate JSON keys and source UTF-8 at the byte level. This validator
   never sees raw bytes and never re-implements those rules.
2. **Present-value normalization (this unit).** Over an already-decoded value
   this validator is presence-preserving: it never fills a default, never
   generates or reassigns an ID, never trims an ID and never repairs bytes. It
   end-trims prompt/label text of Unicode `White_Space`, validates shape and
   reuses existing collection sentinels. It is not an envelope validator.
3. **Future persisted-envelope canonical validation.** A later persisted read
   must require canonical normalized values and must never silently repair
   stored bytes. This normalizing field validator alone is not a
   persisted-envelope validator and must not be used to accept non-canonical
   persisted data.

## Strict key sets per variant

Each question object is strict for its `type`. Every listed key is mandatory;
any key outside the listed set is rejected even when its value is `null`.

| `type` | Required keys | Forbidden keys |
| --- | --- | --- |
| `open` | `id`, `type`, `prompt` | `options`, `correct_option_id` |
| `single_choice_informative` | `id`, `type`, `prompt`, `options` | `correct_option_id` |
| `single_choice_evaluated` | `id`, `type`, `prompt`, `options`, `correct_option_id` | — |

Each option object requires **both** `id` and `label`; no other option key is
allowed. `correct_option_id` is required, non-null and must be exactly one
member of `options[].id` (case-sensitive membership).

## Value rules

- **IDs.** Canonical 36-character `8-4-4-4-12` UUIDs with version nibble `4` and
  RFC variant nibble `8`–`b`. Validation is case-insensitive, the submitted
  spelling is preserved verbatim and no trimming or reassignment is applied.
  Question IDs are unique questionnaire-wide; option IDs are unique within their
  question. Both duplicate checks compare case-insensitively.
- **Prompt.** Valid UTF-8, end-trimmed of Unicode `White_Space`, non-empty and at
  most 2000 codepoints after trimming. Repeated prompts across questions are
  legal. No NFC/NFD normalization or case-fold.
- **Options.** 2–8 options per single-choice question; 1 and 9 are invalid.
  Order is preserved.
- **Label.** Valid UTF-8, end-trimmed, non-empty and at most 200 codepoints
  after trimming. Duplicate labels after the exact trim are rejected with an
  exact, case-sensitive comparison; case variants are legal.
- **Text preservation.** Interior whitespace, U+FEFF and combining marks are
  preserved. A string of only U+FEFF is substantive, not empty, matching the v1
  collection semantics.

## Errors

Missing and unknown/forbidden keys are structural and reported with dedicated
sentinels; every other value failure reuses the existing collection sentinels so
a later §4.2 mapping can separate shape errors from validation errors.

| Condition | Sentinel |
| --- | --- |
| null / typed-nil root | `ErrCollectionNilRoot` |
| non-array root | `ErrCollectionNotArray` |
| more than 100 questions | `ErrCollectionTooMany` |
| question or option item not a non-nil object | `ErrCollectionWrongType` |
| null or wrong dynamic type for a present value | `ErrCollectionWrongType` |
| prompt/label/`type`/`id` not a `string` | `ErrCollectionWrongType` |
| missing required key (question or option) | `ErrScreeningV2MissingKey` |
| unknown or forbidden key, even `null` | `ErrScreeningV2UnknownKey` |
| unknown `type` literal | `ErrCollectionInvalidLiteral` |
| invalid UUIDv4 or `correct_option_id` not an exact member | `ErrCollectionInvalidLiteral` |
| fewer than 2 options | `ErrCollectionInvalidLiteral` |
| more than 8 options | `ErrCollectionTooMany` |
| duplicate question/option ID or duplicate trimmed label | `ErrCollectionDuplicate` |
| invalid UTF-8 prompt/label | `ErrCollectionInvalidUTF8` |
| prompt/label empty after trimming | `ErrCollectionEmpty` |
| prompt above 2000 or label above 200 codepoints | `ErrCollectionTooLong` |

A present `null` for a required non-null key (`options`, `correct_option_id`,
`id`, `type`, `prompt`, an option `id`/`label`) is a validation error
(`ErrCollectionWrongType`); an absent key is structural
(`ErrScreeningV2MissingKey`).

## Out of scope

No wire DTO, envelope, defaults, canonicalization, digest, schema version,
route, store, persistence, DB, dependency or error-response mapping is added or
changed here. The v1 validators, including the prompt-only
`ValidateScreeningQuestions`, are untouched.
