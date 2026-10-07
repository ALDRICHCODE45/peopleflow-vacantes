// Collection group of a private vacancy draft.
//
// Scope: this file implements only the collection validator. It does not decode
// raw JSON, does not validate the scalar, rich string or compensation groups and
// does not persist or map any DTO. Its input is the already-decoded []any
// produced by the strict draft JSON decoder.
//
// The validator is present-value only: it never fills a default, never omits a
// submitted item and never applies a composer. Skills and custom_benefits are
// bounded string lists that are end-trimmed of Unicode White_Space, must be
// non-empty and are limited to 200 codepoints; duplicates are rejected on the
// exact literal after trimming, while order, interior whitespace, U+FEFF,
// combining marks and case are preserved and no NFC/NFD normalization or
// case-fold is ever applied. Benefits is a bounded set of unique exact codes
// that is never trimmed. Screening questions are bounded exact objects whose
// only key is a mandatory prompt string, end-trimmed and limited to 2000
// codepoints, with repeated prompts legal.
//
// Every API requires an exact non-nil []any. A null or typed-nil slice, a
// non-array value, a wrong item type or any invalid item rejects the whole
// group; every error returns a nil slice so a caller never observes a partial
// result. An accepted empty array returns a fresh non-nil empty slice, and a
// returned slice never aliases the input slice. The input is only read and is
// never mutated.
package draftfields

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

// Collection key names of the private vacancy draft collection group.
const screeningQuestionKeyPrompt = "prompt"

// Item limits for the collection group.
const (
	maxSkillItems             = 100
	maxCustomBenefitItems     = 100
	maxBenefitItems           = 8
	maxScreeningQuestionItems = 100
)

// Codepoint limits, applied after end-trimming.
const (
	maxSkillCodepoints           = 200
	maxCustomBenefitCodepoints   = 200
	maxScreeningPromptCodepoints = 2000
)

// Allowed benefit literal codes, in contract order. Codes are compared verbatim
// and are never trimmed, case-folded or Unicode-normalized.
var allowedBenefitCodes = []string{
	"health_insurance",
	"computer_equipment",
	"flexible_schedule",
	"remote_stipend",
	"training_budget",
	"extra_time_off",
	"wellness",
	"annual_bonus",
}

// Collection validation sentinels. Every error returns a nil slice.
var (
	// ErrCollectionNilRoot rejects a null or typed-nil input array.
	ErrCollectionNilRoot = errors.New("draftfields: collection root is null")
	// ErrCollectionNotArray rejects a non-nil input that is not an array.
	ErrCollectionNotArray = errors.New("draftfields: collection root is not an array")
	// ErrCollectionTooMany rejects an array above its item limit.
	ErrCollectionTooMany = errors.New("draftfields: collection exceeds its item limit")
	// ErrCollectionWrongType rejects an item of the wrong dynamic type.
	ErrCollectionWrongType = errors.New("draftfields: collection item has the wrong type")
	// ErrCollectionInvalidUTF8 rejects a Go string that is not valid UTF-8.
	ErrCollectionInvalidUTF8 = errors.New("draftfields: collection string is not valid utf-8")
	// ErrCollectionEmpty rejects a string that is empty after trimming.
	ErrCollectionEmpty = errors.New("draftfields: collection string is empty after trimming")
	// ErrCollectionTooLong rejects a string above its codepoint limit.
	ErrCollectionTooLong = errors.New("draftfields: collection string exceeds its codepoint limit")
	// ErrCollectionDuplicate rejects a literal repeated after end-trimming.
	ErrCollectionDuplicate = errors.New("draftfields: collection contains a duplicate")
	// ErrCollectionInvalidLiteral rejects a value outside the exact literal set.
	ErrCollectionInvalidLiteral = errors.New("draftfields: collection value is not an allowed literal")
	// ErrScreeningQuestionNotObject rejects a screening question that is not a
	// non-nil map.
	ErrScreeningQuestionNotObject = errors.New("draftfields: screening question is not an object")
	// ErrScreeningQuestionMissingPrompt rejects a screening question without a
	// prompt key.
	ErrScreeningQuestionMissingPrompt = errors.New("draftfields: screening question is missing prompt")
	// ErrScreeningQuestionUnknownKey rejects a key outside prompt.
	ErrScreeningQuestionUnknownKey = errors.New("draftfields: unknown screening question key")
)

// ScreeningQuestion is the concrete screening question of a private vacancy
// draft. Only the mandatory prompt is carried; no id, answer or knockout flag
// is part of this group.
type ScreeningQuestion struct {
	Prompt string
}

// ValidateSkills validates the skills collection of a private vacancy draft.
//
// raw must be an exact non-nil []any of at most 100 strings. Each item must be
// a valid UTF-8 string that is non-empty and at most 200 codepoints after
// end-trimming of Unicode White_Space. A literal repeated after trimming is
// rejected. Order, interior whitespace, U+FEFF, combining marks and case are
// preserved verbatim.
func ValidateSkills(raw any) ([]string, error) {
	return validateTrimmedStringCollection(raw, "skills", maxSkillItems, maxSkillCodepoints)
}

// ValidateCustomBenefits validates the custom_benefits collection of a private
// vacancy draft.
//
// raw must be an exact non-nil []any of at most 100 strings. Each item must be
// a valid UTF-8 string that is non-empty and at most 200 codepoints after
// end-trimming of Unicode White_Space. A literal repeated after trimming is
// rejected. Order, interior whitespace, U+FEFF, combining marks and case are
// preserved verbatim.
func ValidateCustomBenefits(raw any) ([]string, error) {
	return validateTrimmedStringCollection(raw, "custom_benefits", maxCustomBenefitItems, maxCustomBenefitCodepoints)
}

// ValidateBenefits validates the benefits collection of a private vacancy draft.
//
// raw must be an exact non-nil []any of at most 8 strings. Each item must equal
// one of the exact benefit codes verbatim: no trimming, case-folding or
// Unicode normalization is applied, so any surrounding or interior whitespace,
// any case variant and any unknown code is rejected. A repeated code is
// rejected. Submitted order is preserved.
func ValidateBenefits(raw any) ([]string, error) {
	items, err := collectionArray(raw)
	if err != nil {
		return nil, err
	}
	if len(items) > maxBenefitItems {
		return nil, fmt.Errorf("%w: benefits exceeds %d items", ErrCollectionTooMany, maxBenefitItems)
	}

	out := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for i, item := range items {
		code, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("%w: benefits[%d]", ErrCollectionWrongType, i)
		}
		if !isAllowedBenefitCode(code) {
			return nil, fmt.Errorf("%w: benefits[%d]", ErrCollectionInvalidLiteral, i)
		}
		if _, duplicate := seen[code]; duplicate {
			return nil, fmt.Errorf("%w: benefits[%d]", ErrCollectionDuplicate, i)
		}
		seen[code] = struct{}{}
		out = append(out, code)
	}
	return out, nil
}

// ValidateScreeningQuestions validates the screening_questions collection of a
// private vacancy draft.
//
// raw must be an exact non-nil []any of at most 100 items. Each item must be an
// exact non-nil map[string]any whose only key is the mandatory prompt. The
// prompt must be a valid UTF-8 string that is non-empty and at most 2000
// codepoints after end-trimming of Unicode White_Space. Repeated prompts are
// legal and submitted order is preserved. No id, answer or knockout key is
// accepted.
func ValidateScreeningQuestions(raw any) ([]ScreeningQuestion, error) {
	items, err := collectionArray(raw)
	if err != nil {
		return nil, err
	}
	if len(items) > maxScreeningQuestionItems {
		return nil, fmt.Errorf("%w: screening_questions exceeds %d items", ErrCollectionTooMany, maxScreeningQuestionItems)
	}

	out := make([]ScreeningQuestion, 0, len(items))
	for i, item := range items {
		object, ok := item.(map[string]any)
		if !ok || object == nil {
			return nil, fmt.Errorf("%w: screening_questions[%d]", ErrScreeningQuestionNotObject, i)
		}

		for key := range object {
			if key != screeningQuestionKeyPrompt {
				return nil, fmt.Errorf("%w: screening_questions[%d]", ErrScreeningQuestionUnknownKey, i)
			}
		}

		rawPrompt, present := object[screeningQuestionKeyPrompt]
		if !present {
			return nil, fmt.Errorf("%w: screening_questions[%d]", ErrScreeningQuestionMissingPrompt, i)
		}
		prompt, ok := rawPrompt.(string)
		if !ok {
			return nil, fmt.Errorf("%w: screening_questions[%d].prompt", ErrCollectionWrongType, i)
		}
		if !utf8.ValidString(prompt) {
			return nil, fmt.Errorf("%w: screening_questions[%d].prompt", ErrCollectionInvalidUTF8, i)
		}

		trimmed := strings.TrimSpace(prompt)
		if trimmed == "" {
			return nil, fmt.Errorf("%w: screening_questions[%d].prompt", ErrCollectionEmpty, i)
		}
		if utf8.RuneCountInString(trimmed) > maxScreeningPromptCodepoints {
			return nil, fmt.Errorf("%w: screening_questions[%d].prompt exceeds %d codepoints", ErrCollectionTooLong, i, maxScreeningPromptCodepoints)
		}

		out = append(out, ScreeningQuestion{Prompt: trimmed})
	}
	return out, nil
}

// collectionArray extracts the exact non-nil []any root shared by every
// collection API. A null interface, a typed-nil []any and any non-array value
// are rejected with distinct sentinels.
func collectionArray(raw any) ([]any, error) {
	if raw == nil {
		return nil, ErrCollectionNilRoot
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, ErrCollectionNotArray
	}
	if items == nil {
		return nil, ErrCollectionNilRoot
	}
	return items, nil
}

// validateTrimmedStringCollection validates the identical string-list rules
// shared by skills and custom_benefits: at most maxItems items, each an exact
// valid UTF-8 string that is non-empty and at most maxCodepoints codepoints
// after end-trimming of Unicode White_Space, with literal duplicates after
// trimming rejected.
//
// It is the only shared helper for those two fields; no generic framework is
// involved. The returned slice is freshly allocated, preserves input order and
// carries the trimmed literals.
func validateTrimmedStringCollection(raw any, field string, maxItems, maxCodepoints int) ([]string, error) {
	items, err := collectionArray(raw)
	if err != nil {
		return nil, err
	}
	if len(items) > maxItems {
		return nil, fmt.Errorf("%w: %s exceeds %d items", ErrCollectionTooMany, field, maxItems)
	}

	out := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for i, item := range items {
		text, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("%w: %s[%d]", ErrCollectionWrongType, field, i)
		}
		if !utf8.ValidString(text) {
			return nil, fmt.Errorf("%w: %s[%d]", ErrCollectionInvalidUTF8, field, i)
		}

		trimmed := strings.TrimSpace(text)
		if trimmed == "" {
			return nil, fmt.Errorf("%w: %s[%d]", ErrCollectionEmpty, field, i)
		}
		if utf8.RuneCountInString(trimmed) > maxCodepoints {
			return nil, fmt.Errorf("%w: %s[%d] exceeds %d codepoints", ErrCollectionTooLong, field, i, maxCodepoints)
		}
		if _, duplicate := seen[trimmed]; duplicate {
			return nil, fmt.Errorf("%w: %s[%d]", ErrCollectionDuplicate, field, i)
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out, nil
}

// isAllowedBenefitCode reports whether code equals one of the exact benefit
// literals.
func isAllowedBenefitCode(code string) bool {
	for _, allowed := range allowedBenefitCodes {
		if allowed == code {
			return true
		}
	}
	return false
}
