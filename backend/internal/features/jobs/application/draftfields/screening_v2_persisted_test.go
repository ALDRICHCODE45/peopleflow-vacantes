package draftfields

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

// The expectations in this file describe the persisted-field contract: the
// persisted entry point reuses ValidateScreeningQuestionsV2 for grammar and
// additionally rejects a stored prompt or option label whose bytes differ from
// the normalizer output. It never repairs, trims or normalizes stored data.
// Helpers and constants are shared with screening_v2_test.go in the same
// package; this file intentionally does not repeat the grammar matrix.

// Uppercase spellings of the shared option IDs, used to prove that an uppercase
// UUID plus an exactly matching uppercase correct_option_id stays canonical.
const (
	persistedScreeningV2OptionIDAUpper = "1A2B3C4D-5E6F-4A7B-8C9D-0E1F2A3B4C5D"
	persistedScreeningV2OptionIDBUpper = "2B3C4D5E-6F7A-4B8C-9D0E-1F2A3B4C5D6E"
)

// persistedScreeningV2Clone returns an independently allocated deep copy of an
// already-decoded JSON tree so a snapshot can be compared after a call.
func persistedScreeningV2Clone(value any) any {
	switch typed := value.(type) {
	case []any:
		out := make([]any, len(typed))
		for i := range typed {
			out[i] = persistedScreeningV2Clone(typed[i])
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			out[key] = persistedScreeningV2Clone(item)
		}
		return out
	default:
		return value
	}
}

// requirePersistedScreeningV2NonCanonical asserts a non-canonical rejection at
// an exact field path.
func requirePersistedScreeningV2NonCanonical(t *testing.T, err error, path string) {
	t.Helper()
	if !errors.Is(err, ErrScreeningV2NonCanonical) {
		t.Fatalf("err = %v, want ErrScreeningV2NonCanonical", err)
	}
	if !strings.Contains(err.Error(), path) {
		t.Fatalf("err = %v, want field path %q", err, path)
	}
}

func TestValidatePersistedScreeningQuestionsV2_AcceptsCanonical(t *testing.T) {
	options := screeningV2Options(
		[2]string{screeningV2OptionIDA, "Alpha"},
		[2]string{screeningV2OptionIDB, "Beta"},
	)
	upperOptions := screeningV2Options(
		[2]string{persistedScreeningV2OptionIDAUpper, "Alpha"},
		[2]string{persistedScreeningV2OptionIDBUpper, "Beta"},
	)
	cases := map[string]any{
		"empty":       []any{},
		"open":        []any{screeningV2OpenMap(screeningV2QuestionID, "Prompt")},
		"informative": []any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", options)},
		"evaluated":   []any{screeningV2EvaluatedMap(screeningV2QuestionID, "Prompt", options, screeningV2OptionIDA)},
		"uppercase ids and exact uppercase member": []any{
			screeningV2EvaluatedMap(screeningV2QuestionIDUpper, "Prompt", upperOptions, persistedScreeningV2OptionIDAUpper),
		},
		"mixed-case id preserved": []any{
			screeningV2OpenMap(screeningV2QuestionIDMixed, "Prompt"),
		},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			if err := ValidatePersistedScreeningQuestionsV2(in); err != nil {
				t.Fatalf("ValidatePersistedScreeningQuestionsV2(%v) = %v, want nil", in, err)
			}
		})
	}
}

func TestValidatePersistedScreeningQuestionsV2_AcceptsPreservedUnicodeAndInteriorSpace(t *testing.T) {
	options := screeningV2Options(
		[2]string{screeningV2OptionIDA, "e\u0301"},
		[2]string{screeningV2OptionIDB, "\u00e9"},
		[2]string{screeningV2OptionIDC, "Alpha"},
		[2]string{screeningV2OptionIDD, "alpha"},
	)
	cases := map[string]any{
		"interior space and U+FEFF prompt": []any{
			screeningV2InformativeMap(screeningV2QuestionID, "A  B\uFEFFC", options),
		},
		"U+FEFF-only label is substantive": []any{
			screeningV2InformativeMap(screeningV2QuestionID, "Prompt", screeningV2Options(
				[2]string{screeningV2OptionIDA, "\uFEFF"},
				[2]string{screeningV2OptionIDB, "Beta"},
			)),
		},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			if err := ValidatePersistedScreeningQuestionsV2(in); err != nil {
				t.Fatalf("ValidatePersistedScreeningQuestionsV2(%v) = %v, want nil", in, err)
			}
		})
	}
}

func TestValidatePersistedScreeningQuestionsV2_RejectsNonCanonicalWhitespace(t *testing.T) {
	cases := map[string]struct {
		in   any
		path string
	}{
		"ascii prompt": {
			[]any{screeningV2OpenMap(screeningV2QuestionID, "  Prompt  ")},
			"screening_questions[0].prompt",
		},
		"nbsp prompt": {
			[]any{screeningV2OpenMap(screeningV2QuestionID, "\u00a0Prompt\u00a0")},
			"screening_questions[0].prompt",
		},
		"label": {
			[]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", screeningV2Options(
				[2]string{screeningV2OptionIDA, " Alpha "},
				[2]string{screeningV2OptionIDB, "Beta"},
			))},
			"screening_questions[0].options[0].label",
		},
		"second question label": {
			[]any{
				screeningV2OpenMap(screeningV2QuestionIDAt(0), "Prompt"),
				screeningV2InformativeMap(screeningV2QuestionIDAt(1), "Prompt", screeningV2Options(
					[2]string{screeningV2OptionIDAt(0), "Gamma"},
					[2]string{screeningV2OptionIDAt(1), " Delta "},
				)),
			},
			"screening_questions[1].options[1].label",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			requirePersistedScreeningV2NonCanonical(t, ValidatePersistedScreeningQuestionsV2(tc.in), tc.path)
		})
	}
}

func TestValidatePersistedScreeningQuestionsV2_PropagatesGrammarErrors(t *testing.T) {
	options := screeningV2Options(
		[2]string{screeningV2OptionIDA, "A"},
		[2]string{screeningV2OptionIDB, "B"},
	)
	cases := map[string]struct {
		in   any
		want error
	}{
		"null root":      {nil, ErrCollectionNilRoot},
		"non array root": {"questions", ErrCollectionNotArray},
		"missing key": {
			[]any{map[string]any{screeningV2KeyID: screeningV2QuestionID, screeningV2KeyType: screeningV2TypeOpen}},
			ErrScreeningV2MissingKey,
		},
		"extra key":    {[]any{screeningV2OpenWithForbiddenOption()}, ErrScreeningV2UnknownKey},
		"unknown type": {[]any{screeningV2QuestionWithType("multiple_choice")}, ErrCollectionInvalidLiteral},
		"wrong prompt type": {
			[]any{map[string]any{screeningV2KeyID: screeningV2QuestionID, screeningV2KeyType: screeningV2TypeOpen, screeningV2KeyPrompt: 7}},
			ErrCollectionWrongType,
		},
		"null options": {
			[]any{map[string]any{
				screeningV2KeyID:      screeningV2QuestionID,
				screeningV2KeyType:    screeningV2TypeSingleChoiceInformative,
				screeningV2KeyPrompt:  "Prompt",
				screeningV2KeyOptions: nil,
			}},
			ErrCollectionWrongType,
		},
		"invalid uuid": {[]any{screeningV2OpenMap("not-a-uuid", "Prompt")}, ErrCollectionInvalidLiteral},
		"duplicate ids": {
			[]any{screeningV2OpenMap(screeningV2QuestionID, "A"), screeningV2OpenMap(screeningV2QuestionID, "B")},
			ErrCollectionDuplicate,
		},
		"duplicate trimmed labels": {
			[]any{screeningV2InformativeMap(screeningV2QuestionID, "Prompt", screeningV2Options(
				[2]string{screeningV2OptionIDA, "A"},
				[2]string{screeningV2OptionIDB, " A "},
			))},
			ErrCollectionDuplicate,
		},
		"case-only correct member": {
			[]any{screeningV2EvaluatedMap(screeningV2QuestionID, "Prompt", options, strings.ToUpper(screeningV2OptionIDA))},
			ErrCollectionInvalidLiteral,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			err := ValidatePersistedScreeningQuestionsV2(tc.in)
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if errors.Is(err, ErrScreeningV2NonCanonical) {
				t.Fatalf("grammar error masked as non-canonical: %v", err)
			}
		})
	}
}

func TestValidatePersistedScreeningQuestionsV2_DoesNotMutateAndContrastsNormalizer(t *testing.T) {
	in := []any{screeningV2InformativeMap(screeningV2QuestionID, "  Prompt  ", screeningV2Options(
		[2]string{screeningV2OptionIDA, "  Alpha  "},
		[2]string{screeningV2OptionIDB, "Beta"},
	))}
	before := persistedScreeningV2Clone(in)

	normalized, err := ValidateScreeningQuestionsV2(in)
	if err != nil {
		t.Fatalf("ValidateScreeningQuestionsV2: %v", err)
	}
	if normalized[0].Prompt != "Prompt" || normalized[0].Options[0].Label != "Alpha" {
		t.Fatalf("normalizer output = %+v, want trimmed prompt and label", normalized[0])
	}

	requirePersistedScreeningV2NonCanonical(t, ValidatePersistedScreeningQuestionsV2(in), "screening_questions[0].prompt")
	if !reflect.DeepEqual(in, before) {
		t.Errorf("failure path mutated input: %v", in)
	}

	canonical := []any{screeningV2OpenMap(screeningV2QuestionID, "Prompt")}
	canonicalBefore := persistedScreeningV2Clone(canonical)
	if err := ValidatePersistedScreeningQuestionsV2(canonical); err != nil {
		t.Fatalf("ValidatePersistedScreeningQuestionsV2(canonical) = %v, want nil", err)
	}
	if !reflect.DeepEqual(canonical, canonicalBefore) {
		t.Errorf("success path mutated input: %v", canonical)
	}
}
