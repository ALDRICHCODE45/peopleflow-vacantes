package draftfields

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

// The expectations in this file were authored before the collection validators
// were implemented. They describe the B8 contract: four present-value APIs over
// an exact non-nil []any, a fresh non-nil empty result, nil output on every
// error, no input mutation and no mutable alias.
//
// skills and custom_benefits share one rule set: at most 100 items, each an
// exact valid UTF-8 string that is end-trimmed of Unicode White_Space, must be
// non-empty and at most 200 codepoints, with literal duplicates after trimming
// rejected while order, interior whitespace, U+FEFF, combining marks and case
// are preserved. benefits is at most 8 unique exact codes and is never trimmed.
// screening_questions is at most 100 exact maps whose only key is a mandatory
// prompt string, end-trimmed, non-empty and at most 2000 codepoints, with
// repeated prompts legal.

// anyStrings builds a []any of the given strings.
func anyStrings(values ...string) []any {
	out := make([]any, len(values))
	for i, value := range values {
		out[i] = value
	}
	return out
}

// repeatAnyString builds a []any holding value count times.
func repeatAnyString(value string, count int) []any {
	out := make([]any, count)
	for i := range out {
		out[i] = value
	}
	return out
}

// uniqueAnyStrings builds count distinct non-empty strings.
func uniqueAnyStrings(prefix string, count int) []any {
	out := make([]any, count)
	for i := range out {
		out[i] = fmt.Sprintf("%s-%03d", prefix, i)
	}
	return out
}

// requireCollectionError asserts the exact sentinel and a nil slice output.
func requireCollectionError(t *testing.T, got []string, err error, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("err = %v, want %v", err, want)
	}
	if got != nil {
		t.Errorf("output = %v, want nil on error", got)
	}
}

// requireQuestionError asserts the exact sentinel and a nil slice output.
func requireQuestionError(t *testing.T, got []ScreeningQuestion, err error, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("err = %v, want %v", err, want)
	}
	if got != nil {
		t.Errorf("output = %v, want nil on error", got)
	}
}

// assertNonNilEmptyStringSlice asserts a fresh non-nil empty slice.
func assertNonNilEmptyStringSlice(t *testing.T, got []string) {
	t.Helper()
	if got == nil {
		t.Fatal("output = nil, want non-nil empty slice")
	}
	if len(got) != 0 {
		t.Errorf("len(output) = %d, want 0", len(got))
	}
}

// assertNonNilEmptyQuestionSlice asserts a fresh non-nil empty slice.
func assertNonNilEmptyQuestionSlice(t *testing.T, got []ScreeningQuestion) {
	t.Helper()
	if got == nil {
		t.Fatal("output = nil, want non-nil empty slice")
	}
	if len(got) != 0 {
		t.Errorf("len(output) = %d, want 0", len(got))
	}
}

func TestValidateSkills_RejectsNullRoot(t *testing.T) {
	if _, err := ValidateSkills(nil); !errors.Is(err, ErrCollectionNilRoot) {
		t.Fatalf("ValidateSkills(nil) err = %v, want ErrCollectionNilRoot", err)
	}

	var typedNil []any
	got, err := ValidateSkills(typedNil)
	requireCollectionError(t, got, err, ErrCollectionNilRoot)
}

func TestValidateSkills_RejectsNonArrayRoot(t *testing.T) {
	values := map[string]any{
		"string":    "health_insurance",
		"int":       42,
		"int64":     int64(1),
		"float64":   1.5,
		"bool":      true,
		"map":       map[string]any{"a": "b"},
		"struct":    struct{}{},
		"strings":   []string{"a"},
		"ints":      []int{1},
		"anyarray":  [2]any{"a", "b"},
		"byteSlice": []byte("ab"),
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateSkills(value)
			requireCollectionError(t, got, err, ErrCollectionNotArray)
		})
	}
}

func TestValidateSkills_EmptyReturnsFreshNonNilSlice(t *testing.T) {
	first, err := ValidateSkills([]any{})
	if err != nil {
		t.Fatalf("ValidateSkills(empty): %v", err)
	}
	assertNonNilEmptyStringSlice(t, first)

	second, err := ValidateSkills([]any{})
	if err != nil {
		t.Fatalf("ValidateSkills(empty): %v", err)
	}
	assertNonNilEmptyStringSlice(t, second)
	if len(first) > 0 || len(second) > 0 {
		t.Fatal("expected empty results")
	}
	first = append(first, "mutated")
	if len(second) != 0 {
		t.Errorf("second result aliased first: %v", second)
	}
}

func TestValidateSkills_TrimsUnicodeWhiteSpaceAtEndsOnly(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "ascii space", in: "  Go  ", want: "Go"},
		{name: "tab and newline", in: "\tGo\n", want: "Go"},
		{name: "carriage return and form feed", in: "\r\fGo\v", want: "Go"},
		{name: "next line and line separator", in: "\u0085Go\u2028", want: "Go"},
		{name: "no-break space", in: "\u00a0Go\u00a0", want: "Go"},
		{name: "ideographic space", in: "\u3000Go\u3000", want: "Go"},
		{name: "em space", in: "\u2003Go\u2003", want: "Go"},
		{name: "interior whitespace preserved", in: "Go  Lang", want: "Go  Lang"},
		{name: "interior newline preserved", in: "Go\nLang", want: "Go\nLang"},
		{name: "FEFF preserved", in: "\ufeffGo\ufeff", want: "\ufeffGo\ufeff"},
		{name: "zero width space preserved", in: "\u200bGo\u200b", want: "\u200bGo\u200b"},
		{name: "combining mark preserved", in: "e\u0301", want: "e\u0301"},
		{name: "case preserved", in: "GoLang", want: "GoLang"},
		{name: "astral preserved", in: "\U0001f600", want: "\U0001f600"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ValidateSkills([]any{tc.in})
			if err != nil {
				t.Fatalf("ValidateSkills(%q): %v", tc.in, err)
			}
			if len(got) != 1 {
				t.Fatalf("len(output) = %d, want 1", len(got))
			}
			if got[0] != tc.want {
				t.Errorf("output[0] = %q, want %q", got[0], tc.want)
			}
		})
	}
}

func TestValidateSkills_PreservesOrder(t *testing.T) {
	in := []any{"zeta", "alpha", "mid", "Beta"}
	got, err := ValidateSkills(in)
	if err != nil {
		t.Fatalf("ValidateSkills: %v", err)
	}
	want := []string{"zeta", "alpha", "mid", "Beta"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("output = %v, want %v", got, want)
	}
}

func TestValidateSkills_RejectsWhitespaceOnlyValues(t *testing.T) {
	values := []string{
		"",
		" ",
		"\t",
		"\n",
		"\r\n",
		"\v",
		"\f",
		"\u0085",
		"\u00a0",
		"\u2003",
		"\u3000",
		"\u2028\u2029",
		" \t\n ",
	}
	for _, value := range values {
		t.Run(fmt.Sprintf("%q", value), func(t *testing.T) {
			got, err := ValidateSkills([]any{value})
			requireCollectionError(t, got, err, ErrCollectionEmpty)
		})
	}
}

func TestValidateSkills_RejectsWrongItemTypes(t *testing.T) {
	values := map[string]any{
		"null":    nil,
		"int":     1,
		"int64":   int64(1),
		"float64": 1.0,
		"bool":    true,
		"map":     map[string]any{},
		"slice":   []any{"Go"},
		"struct":  struct{}{},
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateSkills([]any{value})
			requireCollectionError(t, got, err, ErrCollectionWrongType)
		})
	}
}

func TestValidateSkills_RejectsInvalidUTF8(t *testing.T) {
	values := []string{
		"\xff",
		"Go\xff",
		"\xffGo",
		"a\x80b",
		"\xc3",
		"\xe2\x82",
		"\xf0\x9f\x98",
		"\xed\xa0\x80",
	}
	for _, value := range values {
		t.Run(fmt.Sprintf("%q", value), func(t *testing.T) {
			got, err := ValidateSkills([]any{value})
			requireCollectionError(t, got, err, ErrCollectionInvalidUTF8)
		})
	}
}

func TestValidateSkills_CodepointBoundary(t *testing.T) {
	t.Run("200 ascii codepoints accepted", func(t *testing.T) {
		value := strings.Repeat("a", 200)
		got, err := ValidateSkills([]any{value})
		if err != nil {
			t.Fatalf("ValidateSkills(200): %v", err)
		}
		if len(got) != 1 || got[0] != value {
			t.Errorf("output = %v, want [%q]", got, value)
		}
	})

	t.Run("201 ascii codepoints rejected", func(t *testing.T) {
		got, err := ValidateSkills([]any{strings.Repeat("a", 201)})
		requireCollectionError(t, got, err, ErrCollectionTooLong)
	})

	t.Run("200 astral codepoints accepted", func(t *testing.T) {
		value := strings.Repeat("\U0001f600", 200)
		if len(value) != 800 {
			t.Fatalf("test setup: byte length = %d, want 800", len(value))
		}
		got, err := ValidateSkills([]any{value})
		if err != nil {
			t.Fatalf("ValidateSkills(200 astral): %v", err)
		}
		if len(got) != 1 || got[0] != value {
			t.Errorf("output = %v, want [%q]", got, value)
		}
	})

	t.Run("201 astral codepoints rejected", func(t *testing.T) {
		got, err := ValidateSkills([]any{strings.Repeat("\U0001f600", 201)})
		requireCollectionError(t, got, err, ErrCollectionTooLong)
	})

	t.Run("codepoints not bytes", func(t *testing.T) {
		// 200 astral codepoints are 800 bytes; a byte limit would reject them.
		value := strings.Repeat("\U0001f600", 200)
		if len(value) != 800 {
			t.Fatalf("test setup: byte length = %d, want 800", len(value))
		}
		if _, err := ValidateSkills([]any{value}); err != nil {
			t.Fatalf("ValidateSkills(800 bytes / 200 codepoints): %v", err)
		}
	})
}

func TestValidateSkills_ItemBoundary(t *testing.T) {
	t.Run("100 accepted", func(t *testing.T) {
		in := uniqueAnyStrings("skill", 100)
		got, err := ValidateSkills(in)
		if err != nil {
			t.Fatalf("ValidateSkills(100): %v", err)
		}
		if len(got) != 100 {
			t.Errorf("len(output) = %d, want 100", len(got))
		}
	})

	t.Run("101 rejected", func(t *testing.T) {
		got, err := ValidateSkills(uniqueAnyStrings("skill", 101))
		requireCollectionError(t, got, err, ErrCollectionTooMany)
	})
}

func TestValidateSkills_RejectsTrimInducedDuplicates(t *testing.T) {
	cases := map[string][]any{
		"leading space":  {"Go", " Go"},
		"trailing space": {"Go", "Go "},
		"tab":            {"Go", "\tGo\t"},
		"nbh":            {"Go", "\u00a0Go"},
		"mixed":          {"Go Lang", "  Go Lang\u3000"},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateSkills(in)
			requireCollectionError(t, got, err, ErrCollectionDuplicate)
		})
	}
}

func TestValidateSkills_DistinguishesCaseAndCombiningMarks(t *testing.T) {
	cases := map[string][]any{
		"case distinct":        {"Go", "go"},
		"case distinct upper":  {"GO", "Go"},
		"combining vs precomp": {"\u00e9", "e\u0301"},
		"combining variants":   {"e\u0301", "e\u0302"},
		"FEFF distinct":        {"Go", "\ufeffGo"},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateSkills(in)
			if err != nil {
				t.Fatalf("ValidateSkills(%v): %v", in, err)
			}
			if len(got) != len(in) {
				t.Errorf("len(output) = %d, want %d", len(got), len(in))
			}
		})
	}
}

func TestValidateSkills_DoesNotMutateInput(t *testing.T) {
	in := []any{"  Go  ", "Rust", "Python"}
	before := append([]any(nil), in...)
	if _, err := ValidateSkills(in); err != nil {
		t.Fatalf("ValidateSkills: %v", err)
	}
	if !reflect.DeepEqual(in, before) {
		t.Errorf("input mutated: got %v, want %v", in, before)
	}
}

func TestValidateSkills_ErrorOutputIsNil(t *testing.T) {
	cases := map[string]any{
		"null root":    nil,
		"not array":    "Go",
		"wrong item":   []any{1},
		"invalid utf8": []any{"\xff"},
		"empty item":   []any{" "},
		"too long":     []any{strings.Repeat("a", 201)},
		"duplicate":    []any{"Go", " Go"},
		"too many":     uniqueAnyStrings("skill", 101),
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateSkills(in)
			if err == nil {
				t.Fatalf("ValidateSkills(%v) err = nil, want error", in)
			}
			if got != nil {
				t.Errorf("output = %v, want nil", got)
			}
		})
	}
}

func TestValidateCustomBenefits_RejectsNullRoot(t *testing.T) {
	if _, err := ValidateCustomBenefits(nil); !errors.Is(err, ErrCollectionNilRoot) {
		t.Fatalf("ValidateCustomBenefits(nil) err = %v, want ErrCollectionNilRoot", err)
	}

	var typedNil []any
	got, err := ValidateCustomBenefits(typedNil)
	requireCollectionError(t, got, err, ErrCollectionNilRoot)
}

func TestValidateCustomBenefits_RejectsNonArrayRoot(t *testing.T) {
	values := map[string]any{
		"string":  "meal_vouchers",
		"int":     1,
		"float64": 1.0,
		"bool":    false,
		"map":     map[string]any{},
		"strings": []string{"meal_vouchers"},
		"struct":  struct{}{},
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateCustomBenefits(value)
			requireCollectionError(t, got, err, ErrCollectionNotArray)
		})
	}
}

func TestValidateCustomBenefits_EmptyReturnsFreshNonNilSlice(t *testing.T) {
	got, err := ValidateCustomBenefits([]any{})
	if err != nil {
		t.Fatalf("ValidateCustomBenefits(empty): %v", err)
	}
	assertNonNilEmptyStringSlice(t, got)
}

func TestValidateCustomBenefits_TrimsAndPreserves(t *testing.T) {
	in := []any{"  meal_vouchers  ", "Go\nLang", "\ufeffBonos"}
	got, err := ValidateCustomBenefits(in)
	if err != nil {
		t.Fatalf("ValidateCustomBenefits: %v", err)
	}
	want := []string{"meal_vouchers", "Go\nLang", "\ufeffBonos"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("output = %v, want %v", got, want)
	}
}

func TestValidateCustomBenefits_RejectsWhitespaceOnlyAndInvalidUTF8(t *testing.T) {
	t.Run("whitespace only", func(t *testing.T) {
		got, err := ValidateCustomBenefits([]any{"\u00a0\t"})
		requireCollectionError(t, got, err, ErrCollectionEmpty)
	})
	t.Run("invalid utf8", func(t *testing.T) {
		got, err := ValidateCustomBenefits([]any{"benos\xff"})
		requireCollectionError(t, got, err, ErrCollectionInvalidUTF8)
	})
	t.Run("wrong type", func(t *testing.T) {
		got, err := ValidateCustomBenefits([]any{nil})
		requireCollectionError(t, got, err, ErrCollectionWrongType)
	})
}

func TestValidateCustomBenefits_CodepointAndItemBoundary(t *testing.T) {
	t.Run("200 codepoints accepted", func(t *testing.T) {
		if _, err := ValidateCustomBenefits([]any{strings.Repeat("b", 200)}); err != nil {
			t.Fatalf("ValidateCustomBenefits(200): %v", err)
		}
	})
	t.Run("201 astral codepoints rejected", func(t *testing.T) {
		got, err := ValidateCustomBenefits([]any{strings.Repeat("\U0001f600", 201)})
		requireCollectionError(t, got, err, ErrCollectionTooLong)
	})
	t.Run("100 accepted", func(t *testing.T) {
		got, err := ValidateCustomBenefits(uniqueAnyStrings("benefit", 100))
		if err != nil {
			t.Fatalf("ValidateCustomBenefits(100): %v", err)
		}
		if len(got) != 100 {
			t.Errorf("len(output) = %d, want 100", len(got))
		}
	})
	t.Run("101 rejected", func(t *testing.T) {
		got, err := ValidateCustomBenefits(uniqueAnyStrings("benefit", 101))
		requireCollectionError(t, got, err, ErrCollectionTooMany)
	})
}

func TestValidateCustomBenefits_RejectsTrimInducedDuplicates(t *testing.T) {
	got, err := ValidateCustomBenefits([]any{"meal_vouchers", "\tmeal_vouchers "})
	requireCollectionError(t, got, err, ErrCollectionDuplicate)
}

func TestValidateCustomBenefits_PreservesOrder(t *testing.T) {
	in := []any{"zeta", "alpha", "Beta"}
	got, err := ValidateCustomBenefits(in)
	if err != nil {
		t.Fatalf("ValidateCustomBenefits: %v", err)
	}
	want := []string{"zeta", "alpha", "Beta"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("output = %v, want %v", got, want)
	}
}

func TestValidateCustomBenefits_DoesNotMutateInput(t *testing.T) {
	in := []any{"  meal_vouchers  ", "laptop"}
	before := append([]any(nil), in...)
	if _, err := ValidateCustomBenefits(in); err != nil {
		t.Fatalf("ValidateCustomBenefits: %v", err)
	}
	if !reflect.DeepEqual(in, before) {
		t.Errorf("input mutated: got %v, want %v", in, before)
	}
}

func TestValidateBenefits_RejectsNullRoot(t *testing.T) {
	if _, err := ValidateBenefits(nil); !errors.Is(err, ErrCollectionNilRoot) {
		t.Fatalf("ValidateBenefits(nil) err = %v, want ErrCollectionNilRoot", err)
	}

	var typedNil []any
	got, err := ValidateBenefits(typedNil)
	requireCollectionError(t, got, err, ErrCollectionNilRoot)
}

func TestValidateBenefits_RejectsNonArrayRoot(t *testing.T) {
	values := map[string]any{
		"string":  "wellness",
		"int":     1,
		"float64": 1.0,
		"bool":    true,
		"map":     map[string]any{},
		"strings": []string{"wellness"},
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateBenefits(value)
			requireCollectionError(t, got, err, ErrCollectionNotArray)
		})
	}
}

func TestValidateBenefits_EmptyReturnsFreshNonNilSlice(t *testing.T) {
	got, err := ValidateBenefits([]any{})
	if err != nil {
		t.Fatalf("ValidateBenefits(empty): %v", err)
	}
	assertNonNilEmptyStringSlice(t, got)
}

func TestValidateBenefits_AcceptsAllExactCodesInOrder(t *testing.T) {
	want := []string{
		"health_insurance",
		"computer_equipment",
		"flexible_schedule",
		"remote_stipend",
		"training_budget",
		"extra_time_off",
		"wellness",
		"annual_bonus",
	}
	got, err := ValidateBenefits([]any{
		"annual_bonus",
		"wellness",
		"extra_time_off",
		"training_budget",
		"remote_stipend",
		"flexible_schedule",
		"computer_equipment",
		"health_insurance",
	})
	if err != nil {
		t.Fatalf("ValidateBenefits: %v", err)
	}
	reverse := []string{
		"annual_bonus",
		"wellness",
		"extra_time_off",
		"training_budget",
		"remote_stipend",
		"flexible_schedule",
		"computer_equipment",
		"health_insurance",
	}
	if !reflect.DeepEqual(got, reverse) {
		t.Errorf("output = %v, want submitted order %v", got, reverse)
	}

	for _, code := range want {
		t.Run(code, func(t *testing.T) {
			single, err := ValidateBenefits([]any{code})
			if err != nil {
				t.Fatalf("ValidateBenefits(%q): %v", code, err)
			}
			if len(single) != 1 || single[0] != code {
				t.Errorf("output = %v, want [%q]", single, code)
			}
		})
	}
}

func TestValidateBenefits_ItemBoundary(t *testing.T) {
	eight := []any{
		"health_insurance",
		"computer_equipment",
		"flexible_schedule",
		"remote_stipend",
		"training_budget",
		"extra_time_off",
		"wellness",
		"annual_bonus",
	}
	t.Run("8 accepted", func(t *testing.T) {
		got, err := ValidateBenefits(eight)
		if err != nil {
			t.Fatalf("ValidateBenefits(8): %v", err)
		}
		if len(got) != 8 {
			t.Errorf("len(output) = %d, want 8", len(got))
		}
	})
	t.Run("9 rejected", func(t *testing.T) {
		nine := append(append([]any(nil), eight...), "dental_insurance")
		got, err := ValidateBenefits(nine)
		requireCollectionError(t, got, err, ErrCollectionTooMany)
	})
}

func TestValidateBenefits_RejectsDuplicates(t *testing.T) {
	got, err := ValidateBenefits([]any{"wellness", "wellness"})
	requireCollectionError(t, got, err, ErrCollectionDuplicate)
}

func TestValidateBenefits_RejectsInexactLiterals(t *testing.T) {
	values := []string{
		"",
		" ",
		" health_insurance",
		"health_insurance ",
		"\thealth_insurance",
		"Health_Insurance",
		"HEALTH_INSURANCE",
		"Health_insurance",
		"health-insurance",
		"health insurance",
		"healthinsuranc",
		"dental_insurance",
		"wellnes",
		"annual_bonus\xff",
		"health_insurance\u00a0",
	}
	for _, value := range values {
		t.Run(fmt.Sprintf("%q", value), func(t *testing.T) {
			got, err := ValidateBenefits([]any{value})
			requireCollectionError(t, got, err, ErrCollectionInvalidLiteral)
		})
	}
}

func TestValidateBenefits_RejectsWrongItemTypes(t *testing.T) {
	values := map[string]any{
		"null":    nil,
		"int":     1,
		"int64":   int64(1),
		"float64": 1.0,
		"bool":    true,
		"map":     map[string]any{},
		"slice":   []any{"wellness"},
		"struct":  struct{}{},
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateBenefits([]any{value})
			requireCollectionError(t, got, err, ErrCollectionWrongType)
		})
	}
}

func TestValidateBenefits_DoesNotMutateInput(t *testing.T) {
	in := []any{"wellness", "annual_bonus"}
	before := append([]any(nil), in...)
	if _, err := ValidateBenefits(in); err != nil {
		t.Fatalf("ValidateBenefits: %v", err)
	}
	if !reflect.DeepEqual(in, before) {
		t.Errorf("input mutated: got %v, want %v", in, before)
	}
}

func TestValidateBenefits_OutputDoesNotAliasInput(t *testing.T) {
	in := []any{"wellness", "annual_bonus"}
	got, err := ValidateBenefits(in)
	if err != nil {
		t.Fatalf("ValidateBenefits: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len(output) = %d, want 2", len(got))
	}
	in[0] = "extra_time_off"
	if got[0] != "wellness" {
		t.Errorf("output changed with input: %v", got)
	}
	got[0] = "extra_time_off"
	if in[0] != "extra_time_off" {
		t.Errorf("unexpected input value: %v", in)
	}
}

func TestValidateBenefits_ErrorOutputIsNil(t *testing.T) {
	cases := map[string]any{
		"null root":  nil,
		"not array":  "wellness",
		"wrong item": []any{1},
		"unknown":    []any{"dental_insurance"},
		"duplicate":  []any{"wellness", "wellness"},
		"too many":   []any{"wellness", "wellness", "wellness", "wellness", "wellness", "wellness", "wellness", "wellness", "wellness"},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateBenefits(in)
			if err == nil {
				t.Fatalf("ValidateBenefits(%v) err = nil, want error", in)
			}
			if got != nil {
				t.Errorf("output = %v, want nil", got)
			}
		})
	}
}

func TestValidateScreeningQuestions_RejectsNullRoot(t *testing.T) {
	if _, err := ValidateScreeningQuestions(nil); !errors.Is(err, ErrCollectionNilRoot) {
		t.Fatalf("ValidateScreeningQuestions(nil) err = %v, want ErrCollectionNilRoot", err)
	}

	var typedNil []any
	got, err := ValidateScreeningQuestions(typedNil)
	requireQuestionError(t, got, err, ErrCollectionNilRoot)
}

func TestValidateScreeningQuestions_RejectsNonArrayRoot(t *testing.T) {
	values := map[string]any{
		"string":  "why?",
		"int":     1,
		"float64": 1.0,
		"bool":    false,
		"map":     map[string]any{"prompt": "why?"},
		"struct":  struct{}{},
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateScreeningQuestions(value)
			requireQuestionError(t, got, err, ErrCollectionNotArray)
		})
	}
}

func TestValidateScreeningQuestions_EmptyReturnsFreshNonNilSlice(t *testing.T) {
	got, err := ValidateScreeningQuestions([]any{})
	if err != nil {
		t.Fatalf("ValidateScreeningQuestions(empty): %v", err)
	}
	assertNonNilEmptyQuestionSlice(t, got)
}

func TestValidateScreeningQuestions_AcceptsPromptsAndTrims(t *testing.T) {
	in := []any{
		map[string]any{"prompt": "  Why this role?  "},
		map[string]any{"prompt": "\tDescribe a hard bug\u3000"},
		map[string]any{"prompt": "\ufeffPreserved\ufeff"},
		map[string]any{"prompt": "Interior  spacing"},
	}
	got, err := ValidateScreeningQuestions(in)
	if err != nil {
		t.Fatalf("ValidateScreeningQuestions: %v", err)
	}
	want := []ScreeningQuestion{
		{Prompt: "Why this role?"},
		{Prompt: "Describe a hard bug"},
		{Prompt: "\ufeffPreserved\ufeff"},
		{Prompt: "Interior  spacing"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("output = %+v, want %+v", got, want)
	}
}

func TestValidateScreeningQuestions_RepeatedPromptsAreLegal(t *testing.T) {
	in := []any{
		map[string]any{"prompt": "Same?"},
		map[string]any{"prompt": " Same? "},
		map[string]any{"prompt": "Same?"},
	}
	got, err := ValidateScreeningQuestions(in)
	if err != nil {
		t.Fatalf("ValidateScreeningQuestions: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("len(output) = %d, want 3", len(got))
	}
	for _, question := range got {
		if question.Prompt != "Same?" {
			t.Errorf("Prompt = %q, want Same?", question.Prompt)
		}
	}
}

func TestValidateScreeningQuestions_RejectsNonObjectItems(t *testing.T) {
	typedNilMap := map[string]any(nil)
	values := map[string]any{
		"null":     nil,
		"string":   "why?",
		"int":      1,
		"float64":  1.0,
		"bool":     true,
		"slice":    []any{"prompt"},
		"typedNil": typedNilMap,
		"struct":   struct{}{},
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateScreeningQuestions([]any{value})
			requireQuestionError(t, got, err, ErrScreeningQuestionNotObject)
		})
	}
}

func TestValidateScreeningQuestions_RejectsUnknownKeys(t *testing.T) {
	keys := []string{"id", "answer", "answers", "knockout", "required", "type", "Prompt", "prompts", ""}
	for _, key := range keys {
		t.Run(key, func(t *testing.T) {
			item := map[string]any{"prompt": "why?", key: "x"}
			got, err := ValidateScreeningQuestions([]any{item})
			requireQuestionError(t, got, err, ErrScreeningQuestionUnknownKey)
		})
	}
}

func TestValidateScreeningQuestions_RejectsMissingPrompt(t *testing.T) {
	got, err := ValidateScreeningQuestions([]any{map[string]any{}})
	requireQuestionError(t, got, err, ErrScreeningQuestionMissingPrompt)
}

func TestValidateScreeningQuestions_RejectsWrongPromptValues(t *testing.T) {
	values := map[string]any{
		"null":    nil,
		"int":     1,
		"int64":   int64(1),
		"float64": 1.0,
		"bool":    true,
		"map":     map[string]any{},
		"slice":   []any{"why?"},
		"struct":  struct{}{},
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			item := map[string]any{"prompt": value}
			got, err := ValidateScreeningQuestions([]any{item})
			requireQuestionError(t, got, err, ErrCollectionWrongType)
		})
	}
}

func TestValidateScreeningQuestions_RejectsWhitespaceOnlyPrompt(t *testing.T) {
	values := []string{"", " ", "\t", "\n", "\u00a0", "\u3000", "\r\n", "\u2028"}
	for _, value := range values {
		t.Run(fmt.Sprintf("%q", value), func(t *testing.T) {
			item := map[string]any{"prompt": value}
			got, err := ValidateScreeningQuestions([]any{item})
			requireQuestionError(t, got, err, ErrCollectionEmpty)
		})
	}
}

func TestValidateScreeningQuestions_RejectsInvalidUTF8Prompt(t *testing.T) {
	item := map[string]any{"prompt": "why\xff?"}
	got, err := ValidateScreeningQuestions([]any{item})
	requireQuestionError(t, got, err, ErrCollectionInvalidUTF8)
}

func TestValidateScreeningQuestions_PromptCodepointBoundary(t *testing.T) {
	t.Run("2000 accepted", func(t *testing.T) {
		prompt := strings.Repeat("a", 2000)
		got, err := ValidateScreeningQuestions([]any{map[string]any{"prompt": prompt}})
		if err != nil {
			t.Fatalf("ValidateScreeningQuestions(2000): %v", err)
		}
		if len(got) != 1 || got[0].Prompt != prompt {
			t.Errorf("output = %+v, want prompt of length 2000", got)
		}
	})
	t.Run("2001 rejected", func(t *testing.T) {
		got, err := ValidateScreeningQuestions([]any{map[string]any{"prompt": strings.Repeat("a", 2001)}})
		requireQuestionError(t, got, err, ErrCollectionTooLong)
	})
	t.Run("2000 astral codepoints accepted", func(t *testing.T) {
		prompt := strings.Repeat("\U0001f600", 2000)
		if len(prompt) != 8000 {
			t.Fatalf("test setup: byte length = %d, want 8000", len(prompt))
		}
		if _, err := ValidateScreeningQuestions([]any{map[string]any{"prompt": prompt}}); err != nil {
			t.Fatalf("ValidateScreeningQuestions(2000 astral): %v", err)
		}
	})
	t.Run("2001 astral codepoints rejected", func(t *testing.T) {
		prompt := strings.Repeat("\U0001f600", 2001)
		got, err := ValidateScreeningQuestions([]any{map[string]any{"prompt": prompt}})
		requireQuestionError(t, got, err, ErrCollectionTooLong)
	})
}

func TestValidateScreeningQuestions_ItemBoundary(t *testing.T) {
	t.Run("100 accepted", func(t *testing.T) {
		in := make([]any, 100)
		for i := range in {
			in[i] = map[string]any{"prompt": fmt.Sprintf("Question %d?", i)}
		}
		got, err := ValidateScreeningQuestions(in)
		if err != nil {
			t.Fatalf("ValidateScreeningQuestions(100): %v", err)
		}
		if len(got) != 100 {
			t.Errorf("len(output) = %d, want 100", len(got))
		}
	})
	t.Run("101 rejected", func(t *testing.T) {
		in := make([]any, 101)
		for i := range in {
			in[i] = map[string]any{"prompt": fmt.Sprintf("Question %d?", i)}
		}
		got, err := ValidateScreeningQuestions(in)
		requireQuestionError(t, got, err, ErrCollectionTooMany)
	})
}

func TestValidateScreeningQuestions_DoesNotMutateInput(t *testing.T) {
	item := map[string]any{"prompt": "  Why?  "}
	in := []any{item}
	before := map[string]any{"prompt": "  Why?  "}

	if _, err := ValidateScreeningQuestions(in); err != nil {
		t.Fatalf("ValidateScreeningQuestions: %v", err)
	}
	if !reflect.DeepEqual(item, before) {
		t.Errorf("input item mutated: got %v, want %v", item, before)
	}
	if len(in) != 1 || !reflect.DeepEqual(in[0], before) {
		t.Errorf("input slice mutated: %v", in)
	}
}

func TestValidateScreeningQuestions_OutputDoesNotAliasInput(t *testing.T) {
	item := map[string]any{"prompt": "Why?"}
	in := []any{item}
	got, err := ValidateScreeningQuestions(in)
	if err != nil {
		t.Fatalf("ValidateScreeningQuestions: %v", err)
	}
	item["prompt"] = "Changed?"
	if got[0].Prompt != "Why?" {
		t.Errorf("output aliased input: %q", got[0].Prompt)
	}
	got[0].Prompt = "Mutated?"
	if item["prompt"] != "Changed?" {
		t.Errorf("output mutation reached input: %v", item["prompt"])
	}
}

func TestValidateScreeningQuestions_ErrorOutputIsNil(t *testing.T) {
	cases := map[string]any{
		"null root":      nil,
		"not array":      "why?",
		"wrong item":     []any{1},
		"missing prompt": []any{map[string]any{}},
		"unknown key":    []any{map[string]any{"prompt": "why?", "id": 1}},
		"null prompt":    []any{map[string]any{"prompt": nil}},
		"empty prompt":   []any{map[string]any{"prompt": " "}},
		"invalid utf8":   []any{map[string]any{"prompt": "\xff"}},
		"too long":       []any{map[string]any{"prompt": strings.Repeat("a", 2001)}},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateScreeningQuestions(in)
			if err == nil {
				t.Fatalf("ValidateScreeningQuestions(%v) err = nil, want error", in)
			}
			if got != nil {
				t.Errorf("output = %v, want nil", got)
			}
		})
	}
}
