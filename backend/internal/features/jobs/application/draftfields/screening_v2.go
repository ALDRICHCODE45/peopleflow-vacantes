// Screening v2 group of a private vacancy draft.
//
// Scope: this file implements only the pure present-value validator for the v2
// typed screening question collection. It does not decode raw JSON, does not
// expose a wire DTO, does not touch the scalar, rich string, compensation,
// nested or v1 collection groups and does not persist or map anything. Its
// input is the already-decoded []any produced by an upstream strict JSON
// decoder, which owns malformed JSON, duplicate JSON keys and source UTF-8.
//
// The validator is present-value only: it never fills a default, never
// generates or reassigns an ID, never trims an ID and never repairs stored
// bytes. Three strict variants exist. An open question carries exactly id,
// type and prompt; single_choice_informative additionally carries options;
// single_choice_evaluated additionally carries options and correct_option_id.
// Every listed key is mandatory, a null value is rejected for a required
// non-null key and any key outside the variant key set is rejected even when
// its value is null. A missing key and an unknown or forbidden key are
// structural errors reported with dedicated sentinels so the later §4.2
// error-category mapping can distinguish them from value validation errors.
//
// A valid ID is a 36-character canonical UUID with version nibble 4 and RFC
// variant nibble 8-b, validated case-insensitively while the submitted
// spelling is preserved. Question IDs are unique questionnaire-wide and option
// IDs are unique within their question, both compared case-insensitively;
// correct_option_id membership is an exact string comparison. Prompt and label
// text is end-trimmed of Unicode White_Space, measured in codepoints and never
// Unicode-normalized or case-folded. Order is preserved.
//
// Every rejected input returns a nil slice, so a caller never observes a
// partial result. An accepted empty array returns a fresh non-nil empty slice,
// a returned slice never aliases the input and the input is only read, never
// mutated.
//
// This normalizing field validator is not a persisted-envelope validator: a
// future persisted read must require canonical normalized values and must
// never silently repair stored bytes.
package draftfields

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"
)

// Screening v2 question and option key names.
const (
	screeningV2KeyID              = "id"
	screeningV2KeyType            = "type"
	screeningV2KeyPrompt          = "prompt"
	screeningV2KeyOptions         = "options"
	screeningV2KeyCorrectOptionID = "correct_option_id"
	screeningV2KeyLabel           = "label"
)

// Screening v2 type literals. Types are compared verbatim and never trimmed,
// case-folded or Unicode-normalized.
const (
	screeningV2TypeOpen                    = "open"
	screeningV2TypeSingleChoiceInformative = "single_choice_informative"
	screeningV2TypeSingleChoiceEvaluated   = "single_choice_evaluated"
)

// Inclusive limits of the screening v2 group.
const (
	// screeningV2MaxQuestionItems is the inclusive item limit of the questions
	// array.
	screeningV2MaxQuestionItems = 100
	// screeningV2MaxPromptCodepoints is the inclusive codepoint limit of a
	// question prompt after end-trimming.
	screeningV2MaxPromptCodepoints = 2000
	// screeningV2MinOptionItems and screeningV2MaxOptionItems are the inclusive
	// option-count range of a single-choice question.
	screeningV2MinOptionItems = 2
	screeningV2MaxOptionItems = 8
	// screeningV2MaxLabelCodepoints is the inclusive codepoint limit of an
	// option label after end-trimming.
	screeningV2MaxLabelCodepoints = 200
)

// Screening v2 structural key sentinels. Missing and unknown keys are reported
// separately from value validation so a later error-taxonomy mapping can tell
// them apart. Every error returns a nil slice.
var (
	// ErrScreeningV2MissingKey rejects an object without a mandatory key.
	ErrScreeningV2MissingKey = errors.New("draftfields: screening v2 object is missing a required key")
	// ErrScreeningV2UnknownKey rejects a key outside the variant key set,
	// including a forbidden key submitted with a null value.
	ErrScreeningV2UnknownKey = errors.New("draftfields: unknown screening v2 key")
)

// Allowed key sets by variant, in required-key order. A key outside the set of
// the addressed variant is unknown; a key inside the set but absent is
// missing.
var (
	screeningV2OpenKeys = []string{
		screeningV2KeyID,
		screeningV2KeyType,
		screeningV2KeyPrompt,
	}
	screeningV2SingleChoiceInformativeKeys = []string{
		screeningV2KeyID,
		screeningV2KeyType,
		screeningV2KeyPrompt,
		screeningV2KeyOptions,
	}
	screeningV2SingleChoiceEvaluatedKeys = []string{
		screeningV2KeyID,
		screeningV2KeyType,
		screeningV2KeyPrompt,
		screeningV2KeyOptions,
		screeningV2KeyCorrectOptionID,
	}
)

// screeningV2OptionKeyOrder lists the two required option keys.
var screeningV2OptionKeyOrder = []string{screeningV2KeyID, screeningV2KeyLabel}

// ScreeningOptionV2 is one validated option of a single-choice screening
// question. ID preserves the submitted UUID spelling; Label is the end-trimmed
// literal.
type ScreeningOptionV2 struct {
	ID    string
	Label string
}

// ScreeningQuestionV2 is one validated screening question of a private vacancy
// draft. Options is nil for an open question and otherwise carries the
// submitted options in order; CorrectOptionID is empty when the variant has no
// correct answer.
type ScreeningQuestionV2 struct {
	ID              string
	Type            string
	Prompt          string
	Options         []ScreeningOptionV2
	CorrectOptionID string
}

// ValidateScreeningQuestionsV2 validates the v2 typed screening questions of a
// private vacancy draft.
//
// raw must be an exact non-nil []any of at most 100 strict question objects.
// A null or typed-nil root, a non-array root or an item that is not a non-nil
// object rejects the whole group. An accepted empty array returns a fresh
// non-nil empty slice; every error returns a nil slice.
//
// A question object is strict for its type. open allows exactly id, type and
// prompt; single_choice_informative additionally allows options;
// single_choice_evaluated additionally allows options and correct_option_id.
// Any other key is rejected with ErrScreeningV2UnknownKey even when its value
// is null; any allowed key that is absent is rejected with
// ErrScreeningV2MissingKey. type must be one of the exact literals open,
// single_choice_informative or single_choice_evaluated.
//
// id must be a UUIDv4 in the canonical 36-character 8-4-4-4-12 form with
// version nibble 4 and RFC variant nibble 8-b. Validation is
// case-insensitive, the submitted spelling is preserved and no trimming or
// reassignment ever happens. Question IDs are unique questionnaire-wide and
// option IDs are unique within their question, both compared
// case-insensitively.
//
// prompt must be valid UTF-8, is end-trimmed of Unicode White_Space, must be
// non-empty and is limited to 2000 codepoints after trimming; repeated prompts
// are legal. options is an exact non-nil []any of 2 to 8 strict objects with
// exactly id and label. label is valid UTF-8, end-trimmed, non-empty, limited
// to 200 codepoints and unique after an exact, case-sensitive comparison.
// correct_option_id must be a present non-null string equal exactly to one
// options[].id. Order is preserved and no NFC/NFD normalization or case-fold
// is applied to any text.
func ValidateScreeningQuestionsV2(raw any) ([]ScreeningQuestionV2, error) {
	items, err := screeningV2Array(raw)
	if err != nil {
		return nil, err
	}
	if len(items) > screeningV2MaxQuestionItems {
		return nil, fmt.Errorf("%w: screening_questions exceeds %d items", ErrCollectionTooMany, screeningV2MaxQuestionItems)
	}

	out := make([]ScreeningQuestionV2, 0, len(items))
	seenIDs := make(map[string]struct{}, len(items))
	for i, item := range items {
		question, err := screeningV2Question(item, i)
		if err != nil {
			return nil, err
		}
		idKey := strings.ToLower(question.ID)
		if _, duplicate := seenIDs[idKey]; duplicate {
			return nil, fmt.Errorf("%w: screening_questions[%d].%s", ErrCollectionDuplicate, i, screeningV2KeyID)
		}
		seenIDs[idKey] = struct{}{}
		out = append(out, question)
	}
	return out, nil
}

// screeningV2Array extracts the exact non-nil []any root. A null interface, a
// typed-nil []any and any non-array value are rejected with distinct
// sentinels.
func screeningV2Array(raw any) ([]any, error) {
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

// screeningV2Question validates one question at index.
//
// The order is fixed: object shape, dynamic type and literal of type, exact
// key set for that variant, mandatory keys, id, prompt and finally the
// variant-specific options and correct_option_id. Every failure returns a zero
// ScreeningQuestionV2.
func screeningV2Question(item any, index int) (ScreeningQuestionV2, error) {
	object, ok := item.(map[string]any)
	if !ok || object == nil {
		return ScreeningQuestionV2{}, fmt.Errorf("%w: screening_questions[%d]", ErrCollectionWrongType, index)
	}

	rawType, present := object[screeningV2KeyType]
	if !present {
		return ScreeningQuestionV2{}, fmt.Errorf("%w: screening_questions[%d].%s", ErrScreeningV2MissingKey, index, screeningV2KeyType)
	}
	typeName, ok := rawType.(string)
	if !ok {
		return ScreeningQuestionV2{}, fmt.Errorf("%w: screening_questions[%d].%s", ErrCollectionWrongType, index, screeningV2KeyType)
	}
	allowed := screeningV2AllowedKeys(typeName)
	if allowed == nil {
		return ScreeningQuestionV2{}, fmt.Errorf("%w: screening_questions[%d].%s", ErrCollectionInvalidLiteral, index, screeningV2KeyType)
	}

	for key := range object {
		if !slices.Contains(allowed, key) {
			return ScreeningQuestionV2{}, fmt.Errorf("%w: screening_questions[%d].%q", ErrScreeningV2UnknownKey, index, key)
		}
	}
	for _, key := range allowed {
		if _, present := object[key]; !present {
			return ScreeningQuestionV2{}, fmt.Errorf("%w: screening_questions[%d].%s", ErrScreeningV2MissingKey, index, key)
		}
	}

	id, err := screeningV2ID(object[screeningV2KeyID], screeningV2QuestionPath(index, screeningV2KeyID))
	if err != nil {
		return ScreeningQuestionV2{}, err
	}
	prompt, err := screeningV2TrimmedText(object[screeningV2KeyPrompt], screeningV2QuestionPath(index, screeningV2KeyPrompt), screeningV2MaxPromptCodepoints)
	if err != nil {
		return ScreeningQuestionV2{}, err
	}

	question := ScreeningQuestionV2{ID: id, Type: typeName, Prompt: prompt}
	if slices.Contains(allowed, screeningV2KeyOptions) {
		options, err := screeningV2ValidateOptions(object[screeningV2KeyOptions], screeningV2QuestionPath(index, screeningV2KeyOptions))
		if err != nil {
			return ScreeningQuestionV2{}, err
		}
		question.Options = options
	}
	if slices.Contains(allowed, screeningV2KeyCorrectOptionID) {
		correct, err := screeningV2CorrectOptionID(object[screeningV2KeyCorrectOptionID], question.Options, screeningV2QuestionPath(index, screeningV2KeyCorrectOptionID))
		if err != nil {
			return ScreeningQuestionV2{}, err
		}
		question.CorrectOptionID = correct
	}
	return question, nil
}

// screeningV2AllowedKeys returns the allowed key set of a known variant, or nil
// for an unknown type literal. A nil result is never allocated and is always
// treated as an invalid type.
func screeningV2AllowedKeys(typeName string) []string {
	switch typeName {
	case screeningV2TypeOpen:
		return screeningV2OpenKeys
	case screeningV2TypeSingleChoiceInformative:
		return screeningV2SingleChoiceInformativeKeys
	case screeningV2TypeSingleChoiceEvaluated:
		return screeningV2SingleChoiceEvaluatedKeys
	default:
		return nil
	}
}

// screeningV2Options validates the options array of a single-choice question.
//
// The value must be an exact non-nil []any of 2 to 8 strict option objects. A
// present null, a typed-nil slice or any non-array value is rejected with
// ErrCollectionWrongType. An option object carries exactly id and label; any
// other key is unknown and any missing key is structural. Option IDs are
// unique within the question compared case-insensitively and preserve their
// spelling; labels are unique after end-trimming compared exactly and
// case-sensitively. Order is preserved and the returned slice is freshly
// allocated.
func screeningV2ValidateOptions(raw any, path string) ([]ScreeningOptionV2, error) {
	items, ok := raw.([]any)
	if !ok || items == nil {
		return nil, fmt.Errorf("%w: %s", ErrCollectionWrongType, path)
	}
	if len(items) < screeningV2MinOptionItems {
		return nil, fmt.Errorf("%w: %s must contain at least %d options", ErrCollectionInvalidLiteral, path, screeningV2MinOptionItems)
	}
	if len(items) > screeningV2MaxOptionItems {
		return nil, fmt.Errorf("%w: %s exceeds %d options", ErrCollectionTooMany, path, screeningV2MaxOptionItems)
	}

	out := make([]ScreeningOptionV2, 0, len(items))
	seenIDs := make(map[string]struct{}, len(items))
	seenLabels := make(map[string]struct{}, len(items))
	for i, item := range items {
		optionPath := fmt.Sprintf("%s[%d]", path, i)
		object, ok := item.(map[string]any)
		if !ok || object == nil {
			return nil, fmt.Errorf("%w: %s", ErrCollectionWrongType, optionPath)
		}

		for key := range object {
			if !slices.Contains(screeningV2OptionKeyOrder, key) {
				return nil, fmt.Errorf("%w: %s.%q", ErrScreeningV2UnknownKey, optionPath, key)
			}
		}
		for _, key := range screeningV2OptionKeyOrder {
			if _, present := object[key]; !present {
				return nil, fmt.Errorf("%w: %s.%s", ErrScreeningV2MissingKey, optionPath, key)
			}
		}

		id, err := screeningV2ID(object[screeningV2KeyID], optionPath+"."+screeningV2KeyID)
		if err != nil {
			return nil, err
		}
		label, err := screeningV2TrimmedText(object[screeningV2KeyLabel], optionPath+"."+screeningV2KeyLabel, screeningV2MaxLabelCodepoints)
		if err != nil {
			return nil, err
		}

		idKey := strings.ToLower(id)
		if _, duplicate := seenIDs[idKey]; duplicate {
			return nil, fmt.Errorf("%w: %s.%s", ErrCollectionDuplicate, optionPath, screeningV2KeyID)
		}
		seenIDs[idKey] = struct{}{}
		if _, duplicate := seenLabels[label]; duplicate {
			return nil, fmt.Errorf("%w: %s.%s", ErrCollectionDuplicate, optionPath, screeningV2KeyLabel)
		}
		seenLabels[label] = struct{}{}

		out = append(out, ScreeningOptionV2{ID: id, Label: label})
	}
	return out, nil
}

// screeningV2CorrectOptionID validates one correct_option_id against the
// already-validated option IDs. The value must be a present non-null string and
// membership is an exact, case-sensitive comparison, so a case-only difference
// is rejected.
func screeningV2CorrectOptionID(raw any, options []ScreeningOptionV2, path string) (string, error) {
	text, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrCollectionWrongType, path)
	}
	for _, option := range options {
		if option.ID == text {
			return text, nil
		}
	}
	return "", fmt.Errorf("%w: %s", ErrCollectionInvalidLiteral, path)
}

// screeningV2ID validates one identifier. A non-string value is a wrong type
// and a string that is not a canonical UUIDv4 is an invalid literal; the
// submitted spelling is returned unchanged.
func screeningV2ID(raw any, path string) (string, error) {
	text, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrCollectionWrongType, path)
	}
	if !screeningV2IsUUIDv4(text) {
		return "", fmt.Errorf("%w: %s", ErrCollectionInvalidLiteral, path)
	}
	return text, nil
}

// screeningV2TrimmedText validates one prompt or label. The value must be valid
// UTF-8, is end-trimmed of Unicode White_Space, must be non-empty and is
// limited to maxCodepoints codepoints after trimming. Interior whitespace,
// U+FEFF, combining marks and case are preserved verbatim.
func screeningV2TrimmedText(raw any, path string, maxCodepoints int) (string, error) {
	text, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrCollectionWrongType, path)
	}
	if !utf8.ValidString(text) {
		return "", fmt.Errorf("%w: %s", ErrCollectionInvalidUTF8, path)
	}

	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return "", fmt.Errorf("%w: %s", ErrCollectionEmpty, path)
	}
	if utf8.RuneCountInString(trimmed) > maxCodepoints {
		return "", fmt.Errorf("%w: %s exceeds %d codepoints", ErrCollectionTooLong, path, maxCodepoints)
	}
	return trimmed, nil
}

// screeningV2QuestionPath builds the error path of one question field.
func screeningV2QuestionPath(index int, key string) string {
	return fmt.Sprintf("screening_questions[%d].%s", index, key)
}

// screeningV2IsUUIDv4 reports whether value is exactly 36 ASCII characters in
// the canonical 8-4-4-4-12 lexical UUID form with version nibble 4 at byte 14
// and RFC variant nibble 8-b at byte 19. Hex digit case is not inspected, so
// the caller can preserve the submitted spelling.
func screeningV2IsUUIDv4(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i := 0; i < 36; i++ {
		switch i {
		case 8, 13, 18, 23:
			if value[i] != '-' {
				return false
			}
		case 14:
			if value[i] != '4' {
				return false
			}
		case 19:
			switch value[i] {
			case '8', '9', 'a', 'A', 'b', 'B':
			default:
				return false
			}
		default:
			if !screeningV2IsASCIIHexDigit(value[i]) {
				return false
			}
		}
	}
	return true
}

// screeningV2IsASCIIHexDigit reports whether b is an ASCII hexadecimal digit.
func screeningV2IsASCIIHexDigit(b byte) bool {
	switch {
	case b >= '0' && b <= '9':
		return true
	case b >= 'a' && b <= 'f':
		return true
	case b >= 'A' && b <= 'F':
		return true
	default:
		return false
	}
}
