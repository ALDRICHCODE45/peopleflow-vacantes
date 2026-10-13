// Screening v2 persisted-field canonical validation.
//
// Scope: this file adds the persisted-entry-point wrapper over the existing
// present-value ValidateScreeningQuestionsV2. It validates grammar first, then
// rejects a stored prompt or option label whose bytes differ from what the
// normalizer produces. It does not decode raw JSON, does not expose a wire DTO,
// does not touch the scalar, rich string, compensation, nested or v1 collection
// groups and does not persist, project, store, route or map errors to HTTP.
//
// A persisted read must never silently repair stored bytes. The normalizing
// validator end-trims Unicode White_Space from prompt and label text, so any
// stored value that the normalizer would change is non-canonical here, even
// though the normalizing API accepts it. This wrapper compares the original
// decoded prompt and label strings against the normalizer output byte-for-byte
// and reports ErrScreeningV2NonCanonical with the offending field path.
//
// Only prompt and label can differ: the validator preserves the submitted UUID
// spelling verbatim, validates correct_option_id membership as an exact string
// and compares type verbatim, so no extra UUID or identity comparison is made
// here. An uppercase UUID stays canonical when authored that way, and the
// uppercase spelling must match correct_option_id exactly. This product
// decision is settled.
//
// Grammar failures are returned unchanged so errors.Is still matches the
// existing sentinels. These are later server-invariant failures, not client
// HTTP 400 results; no HTTP mapping is introduced here.
package draftfields

import (
	"errors"
	"fmt"
)

// ErrScreeningV2NonCanonical rejects a persisted screening v2 value whose
// stored bytes differ from what the present-value normalizer would produce. A
// persisted read must never silently repair stored data, so a stored prompt or
// option label that carries surrounding Unicode White_Space is a
// server-invariant failure, not a client input to be trimmed.
var ErrScreeningV2NonCanonical = errors.New("draftfields: screening v2 persisted value is not canonical")

// ValidatePersistedScreeningQuestionsV2 validates an already-decoded persisted
// screening v2 field.
//
// raw is the same exact non-nil []any accepted by ValidateScreeningQuestionsV2.
// Grammar is validated first and any error is returned unchanged, preserving
// errors.Is for ErrCollection* and ErrScreeningV2* sentinels.
//
// When grammar is valid, every stored prompt and option label must be
// byte-for-byte identical to the normalizer output. A stored value that the
// normalizer would end-trim is rejected with ErrScreeningV2NonCanonical and a
// screening_questions[i]... field path. Nothing is normalized, mutated,
// repaired, regenerated or lowercased, and the input is only read.
//
// This wrapper does not establish readiness of a full persisted read: the
// upstream strict JSON decoder still owns source syntax, duplicate JSON keys and
// UTF-8, and the remaining persisted-root, schema-version and other-field
// canonical checks are out of scope here.
func ValidatePersistedScreeningQuestionsV2(raw any) error {
	questions, err := ValidateScreeningQuestionsV2(raw)
	if err != nil {
		return err
	}

	// The successful validator guarantees the []any of non-nil map[string]any
	// shape and string prompt/label values, so these assertions cannot fail for
	// the value it just accepted.
	items := raw.([]any)
	for i, question := range questions {
		object := items[i].(map[string]any)
		if object[screeningV2KeyPrompt].(string) != question.Prompt {
			return fmt.Errorf("%w: %s", ErrScreeningV2NonCanonical, screeningV2QuestionPath(i, screeningV2KeyPrompt))
		}
		if question.Options == nil {
			continue
		}
		options := object[screeningV2KeyOptions].([]any)
		optionsPath := screeningV2QuestionPath(i, screeningV2KeyOptions)
		for j, option := range question.Options {
			if options[j].(map[string]any)[screeningV2KeyLabel].(string) != option.Label {
				return fmt.Errorf("%w: %s", ErrScreeningV2NonCanonical, fmt.Sprintf("%s[%d].%s", optionsPath, j, screeningV2KeyLabel))
			}
		}
	}
	return nil
}
