package draftfields

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

// The expectations in this file were authored before the nested validators
// were implemented. They describe the B9 contract: two value-only APIs over an
// already-decoded requester object and languages array, with nil output on
// every error, no partial result, no input mutation and no mutable alias.
//
// ValidateRequester treats JSON null as a valid "no requester" value; any
// other input must be an exact non-nil map whose only keys are the mandatory
// kind and id. kind is internal_area or client; id is null or a canonical
// 36-character lexical UUID whose case is preserved and whose version and
// variant nibbles are unrestricted.
//
// ValidateLanguages requires an exact non-nil []any of at most 100 exact
// non-nil maps whose only keys are language, custom_name and level. Enums are
// exact literals, custom_name is end-trimmed of Unicode White_Space and limited
// to 200 codepoints, and order plus duplicates are preserved.

// Canonical lexical UUIDs used across the requester matrix. None of these is
// looked up in any catalog: the validator is lexical only.
const (
	nestedLowerUUID     = "123e4567-e89b-12d3-a456-426614174000"
	nestedUpperUUID     = "123E4567-E89B-12D3-A456-426614174000"
	nestedMixedUUID     = "123e4567-E89B-12d3-A456-426614174000"
	nestedAllFUUID      = "ffffffff-ffff-ffff-ffff-ffffffffffff"
	nestedNilUUID       = "00000000-0000-0000-0000-000000000000"
	nestedArbitraryUUID = "12345678-9abc-def0-1234-56789abcdef0"
	nestedUnknownUUID   = "deadbeef-dead-beef-dead-beefdeadbeef"
)

// requireRequesterError asserts the exact sentinel and a nil pointer output.
func requireRequesterError(t *testing.T, got *Requester, err error, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("err = %v, want %v", err, want)
	}
	if got != nil {
		t.Errorf("output = %+v, want nil on error", got)
	}
}

// requireLanguageError asserts the exact sentinel and a nil slice output.
func requireLanguageError(t *testing.T, got []Language, err error, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("err = %v, want %v", err, want)
	}
	if got != nil {
		t.Errorf("output = %+v, want nil on error", got)
	}
}

// mustRequester asserts a successful, non-nil requester.
func mustRequester(t *testing.T, raw any) *Requester {
	t.Helper()
	got, err := ValidateRequester(raw)
	if err != nil {
		t.Fatalf("ValidateRequester(%v): %v", raw, err)
	}
	if got == nil {
		t.Fatalf("ValidateRequester(%v) = nil, want a requester", raw)
	}
	return got
}

// mustLanguages asserts a successful, non-nil slice.
func mustLanguages(t *testing.T, raw any) []Language {
	t.Helper()
	got, err := ValidateLanguages(raw)
	if err != nil {
		t.Fatalf("ValidateLanguages(%v): %v", raw, err)
	}
	if got == nil {
		t.Fatalf("ValidateLanguages(%v) = nil, want a slice", raw)
	}
	return got
}

// requireLanguageAt asserts a single in-range item and returns it.
func requireLanguageAt(t *testing.T, got []Language, index int) Language {
	t.Helper()
	if index < 0 || index >= len(got) {
		t.Fatalf("len(output) = %d, want index %d", len(got), index)
	}
	return got[index]
}

// assertNonNilEmptyLanguageSlice asserts a fresh non-nil empty slice.
func assertNonNilEmptyLanguageSlice(t *testing.T, got []Language) {
	t.Helper()
	if got == nil {
		t.Fatal("output = nil, want non-nil empty slice")
	}
	if len(got) != 0 {
		t.Errorf("len(output) = %d, want 0", len(got))
	}
}

// languageItem builds one languages[] object with exactly the three keys.
func languageItem(language string, customName, level any) map[string]any {
	return map[string]any{
		"language":    language,
		"custom_name": customName,
		"level":       level,
	}
}

// requireStringPtr asserts a non-nil pointer carrying want.
func requireStringPtr(t *testing.T, got *string, want, field string) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s = nil, want %q", field, want)
	}
	if *got != want {
		t.Errorf("%s = %q, want %q", field, *got, want)
	}
}

// nestedLanguageItems builds count distinct accepted items.
func nestedLanguageItems(count int) []any {
	out := make([]any, count)
	for i := range out {
		out[i] = languageItem("other", fmt.Sprintf("Name %03d", i), nil)
	}
	return out
}

func TestValidateRequester_NullIsValid(t *testing.T) {
	got, err := ValidateRequester(nil)
	if err != nil {
		t.Fatalf("ValidateRequester(nil) err = %v, want nil", err)
	}
	if got != nil {
		t.Errorf("ValidateRequester(nil) = %+v, want nil", got)
	}
}

func TestValidateRequester_RejectsTypedNilAndNonObjects(t *testing.T) {
	var typedNilMap map[string]any
	var typedNilStringPtr *string
	values := map[string]any{
		"typed nil map":    typedNilMap,
		"typed nil string": typedNilStringPtr,
		"string":           nestedLowerUUID,
		"int":              7,
		"int64":            int64(7),
		"float64":          1.5,
		"bool":             true,
		"slice":            []any{"internal_area"},
		"strings":          []string{"internal_area"},
		"struct":           struct{}{},
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateRequester(value)
			requireRequesterError(t, got, err, errRequesterNotObject)
		})
	}
}

func TestValidateRequester_RejectsMissingKeys(t *testing.T) {
	cases := map[string]map[string]any{
		"empty object":       {},
		"kind only":          {"kind": "internal_area"},
		"id only":            {"id": nestedLowerUUID},
		"id only null":       {"id": nil},
		"kind present id":    {"kind": "client"},
		"id present no kind": {"id": nestedLowerUUID},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateRequester(in)
			requireRequesterError(t, got, err, errRequesterMissingKey)
		})
	}
}

func TestValidateRequester_RejectsUnknownKeys(t *testing.T) {
	keys := []string{"name", "organization_id", "organization", "kind_id", "Kind", "ID", "", "uuid", "requester"}
	for _, key := range keys {
		t.Run(key, func(t *testing.T) {
			in := map[string]any{"kind": "internal_area", "id": nestedLowerUUID, key: "x"}
			got, err := ValidateRequester(in)
			requireRequesterError(t, got, err, errRequesterUnknownKey)
		})
	}
}

func TestValidateRequester_KindRules(t *testing.T) {
	t.Run("accepts exact literals", func(t *testing.T) {
		for _, kind := range []string{"internal_area", "client"} {
			got := mustRequester(t, map[string]any{"kind": kind, "id": nestedLowerUUID})
			if got.Kind != kind {
				t.Errorf("Kind = %q, want %q", got.Kind, kind)
			}
		}
	})

	t.Run("rejects inexact literals", func(t *testing.T) {
		values := []string{
			"",
			" ",
			" internal_area",
			"internal_area ",
			"\tinternal_area",
			"INTERNAL_AREA",
			"Internal_Area",
			"internal area",
			"internal-area",
			"internal",
			"client_company",
			"external",
			"candidate",
		}
		for _, kind := range values {
			t.Run(fmt.Sprintf("%q", kind), func(t *testing.T) {
				got, err := ValidateRequester(map[string]any{"kind": kind, "id": nil})
				requireRequesterError(t, got, err, errRequesterInvalidKind)
			})
		}
	})

	t.Run("rejects null and wrong types", func(t *testing.T) {
		values := map[string]any{
			"null":    nil,
			"int":     1,
			"float64": 1.0,
			"bool":    true,
			"map":     map[string]any{},
			"slice":   []any{"internal_area"},
			"struct":  struct{}{},
		}
		for name, kind := range values {
			t.Run(name, func(t *testing.T) {
				got, err := ValidateRequester(map[string]any{"kind": kind, "id": nil})
				requireRequesterError(t, got, err, errRequesterWrongType)
			})
		}
	})
}

func TestValidateRequester_AcceptsUUIDLexicalMatrix(t *testing.T) {
	tests := []struct {
		name string
		id   string
	}{
		{name: "lowercase", id: nestedLowerUUID},
		{name: "uppercase", id: nestedUpperUUID},
		{name: "mixed case", id: nestedMixedUUID},
		{name: "all f unrestricted version and variant", id: nestedAllFUUID},
		{name: "nil uuid unrestricted version and variant", id: nestedNilUUID},
		{name: "arbitrary version and variant", id: nestedArbitraryUUID},
		{name: "unknown but lexical", id: nestedUnknownUUID},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := mustRequester(t, map[string]any{"kind": "internal_area", "id": tc.id})
			requireStringPtr(t, got.ID, tc.id, "ID")
		})
	}

	t.Run("null id is valid and yields nil pointer", func(t *testing.T) {
		got := mustRequester(t, map[string]any{"kind": "client", "id": nil})
		if got.ID != nil {
			t.Errorf("ID = %q, want nil", *got.ID)
		}
	})
}

func TestValidateRequester_RejectsMalformedUUIDs(t *testing.T) {
	hyphenReplaced := nestedLowerUUID[:8] + "0" + nestedLowerUUID[9:]
	hyphenShifted := nestedLowerUUID[:7] + "-" + nestedLowerUUID[8:]
	badTailChar := nestedLowerUUID[:35] + "g"

	ids := map[string]string{
		"empty":            "",
		"compact 32":       strings.ReplaceAll(nestedLowerUUID, "-", ""),
		"braces":           "{" + nestedLowerUUID + "}",
		"urn":              "urn:uuid:" + nestedLowerUUID,
		"trailing newline": nestedLowerUUID + "\n",
		"leading space":    " " + nestedLowerUUID,
		"trailing space":   nestedLowerUUID + " ",
		"trailing tab":     nestedLowerUUID + "\t",
		"interior space":   nestedLowerUUID[:17] + " " + nestedLowerUUID[18:],
		"non ascii":        "\u00e9" + nestedLowerUUID[2:],
		"non hex letter":   badTailChar,
		"hyphen replaced":  hyphenReplaced,
		"hyphen shifted":   hyphenShifted,
		"35 chars":         nestedLowerUUID[:35],
		"37 chars":         nestedLowerUUID + "0",
		"upper with space": nestedUpperUUID + " ",
		"whitespace only":  " ",
	}
	for name, id := range ids {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateRequester(map[string]any{"kind": "internal_area", "id": id})
			requireRequesterError(t, got, err, errRequesterInvalidID)
		})
	}

	t.Run("wrong dynamic type", func(t *testing.T) {
		values := map[string]any{
			"int":     7,
			"int64":   int64(7),
			"float64": 1.5,
			"bool":    true,
			"map":     map[string]any{"value": nestedLowerUUID},
			"slice":   []any{nestedLowerUUID},
			"struct":  struct{}{},
		}
		for name, id := range values {
			t.Run(name, func(t *testing.T) {
				got, err := ValidateRequester(map[string]any{"kind": "internal_area", "id": id})
				requireRequesterError(t, got, err, errRequesterWrongType)
			})
		}
	})
}

func TestValidateRequester_ReturnsFreshIndependentResults(t *testing.T) {
	in := map[string]any{"kind": "client", "id": nestedLowerUUID}

	first := mustRequester(t, in)
	second := mustRequester(t, in)

	if first == second {
		t.Fatal("two calls returned the same *Requester")
	}
	if first.ID == nil || second.ID == nil {
		t.Fatal("ID must be non-nil for a submitted UUID")
	}
	if first.ID == second.ID {
		t.Error("two calls aliased the same ID pointer")
	}

	*first.ID = "mutated"
	first.Kind = "internal_area"
	if *second.ID != nestedLowerUUID {
		t.Errorf("mutating first changed second: %q", *second.ID)
	}
	if second.Kind != "client" {
		t.Errorf("mutating first changed second kind: %q", second.Kind)
	}
	if in["id"] != nestedLowerUUID || in["kind"] != "client" {
		t.Errorf("returned values aliased the input: %v", in)
	}
}

func TestValidateRequester_DoesNotMutateInput(t *testing.T) {
	in := map[string]any{"kind": "internal_area", "id": nestedLowerUUID}
	before := map[string]any{"kind": "internal_area", "id": nestedLowerUUID}

	if _, err := ValidateRequester(in); err != nil {
		t.Fatalf("ValidateRequester: %v", err)
	}
	if !reflect.DeepEqual(in, before) {
		t.Errorf("input mutated: got %v, want %v", in, before)
	}
}

func TestValidateRequester_ErrorOutputIsNil(t *testing.T) {
	cases := map[string]any{
		"typed nil map": map[string]any(nil),
		"not object":    "client",
		"missing key":   map[string]any{"kind": "client"},
		"unknown key":   map[string]any{"kind": "client", "id": nil, "name": "x"},
		"null kind":     map[string]any{"kind": nil, "id": nil},
		"bad kind":      map[string]any{"kind": "external", "id": nil},
		"bad id":        map[string]any{"kind": "client", "id": "not-a-uuid"},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateRequester(in)
			if err == nil {
				t.Fatalf("ValidateRequester(%v) err = nil, want error", in)
			}
			if got != nil {
				t.Errorf("output = %+v, want nil", got)
			}
		})
	}
}

func TestValidateLanguages_RejectsNullRoot(t *testing.T) {
	if _, err := ValidateLanguages(nil); !errors.Is(err, errLanguagesNilRoot) {
		t.Fatalf("ValidateLanguages(nil) err = %v, want errLanguagesNilRoot", err)
	}

	var typedNil []any
	got, err := ValidateLanguages(typedNil)
	requireLanguageError(t, got, err, errLanguagesNilRoot)
}

func TestValidateLanguages_RejectsNonArrayRoot(t *testing.T) {
	values := map[string]any{
		"string":   "other",
		"int":      1,
		"float64":  1.0,
		"bool":     true,
		"map":      map[string]any{"language": "other"},
		"strings":  []string{"other"},
		"language": []Language{{Language: "other"}},
		"struct":   struct{}{},
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateLanguages(value)
			requireLanguageError(t, got, err, errLanguagesNotArray)
		})
	}
}

func TestValidateLanguages_EmptyReturnsFreshNonNilSlice(t *testing.T) {
	first := mustLanguages(t, []any{})
	assertNonNilEmptyLanguageSlice(t, first)

	second := mustLanguages(t, []any{})
	assertNonNilEmptyLanguageSlice(t, second)

	first = append(first, Language{Language: "other"})
	if len(second) != 0 {
		t.Errorf("second result aliased first: %+v", second)
	}
}

func TestValidateLanguages_ItemBoundary(t *testing.T) {
	t.Run("100 accepted", func(t *testing.T) {
		in := make([]any, 100)
		for i := range in {
			in[i] = languageItem("other", fmt.Sprintf("Name %03d", i), "native")
		}
		got := mustLanguages(t, in)
		if len(got) != 100 {
			t.Errorf("len(output) = %d, want 100", len(got))
		}
	})

	t.Run("101 rejected", func(t *testing.T) {
		got, err := ValidateLanguages(nestedLanguageItems(101))
		requireLanguageError(t, got, err, errLanguagesTooMany)
	})
}

func TestValidateLanguages_RejectsNonObjectItems(t *testing.T) {
	var typedNilMap map[string]any
	values := map[string]any{
		"null":      nil,
		"string":    "other",
		"int":       1,
		"float64":   1.0,
		"bool":      true,
		"slice":     []any{"other"},
		"typed nil": typedNilMap,
		"struct":    struct{}{},
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateLanguages([]any{value})
			requireLanguageError(t, got, err, errLanguageNotObject)
		})
	}
}

func TestValidateLanguages_RejectsUnknownKeys(t *testing.T) {
	keys := []string{"id", "custom", "language_code", "name", "level_name", "Language", "", "customName"}
	for _, key := range keys {
		t.Run(key, func(t *testing.T) {
			item := languageItem("other", nil, nil)
			item[key] = "x"
			got, err := ValidateLanguages([]any{item})
			requireLanguageError(t, got, err, errLanguageUnknownKey)
		})
	}
}

func TestValidateLanguages_RejectsMissingKeys(t *testing.T) {
	cases := map[string]map[string]any{
		"empty object":            {},
		"language only":           {"language": "other"},
		"custom_name only":        {"custom_name": nil},
		"level only":              {"level": nil},
		"missing custom_name":     {"language": "other", "level": nil},
		"missing level":           {"language": "other", "custom_name": nil},
		"missing language":        {"custom_name": nil, "level": nil},
		"missing level with name": {"language": "other", "custom_name": "Name"},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateLanguages([]any{in})
			requireLanguageError(t, got, err, errLanguageMissingKey)
		})
	}
}

func TestValidateLanguages_AcceptsAllLanguagesAndLevels(t *testing.T) {
	levels := []any{nil, "basic", "intermediate", "advanced", "native"}
	for _, language := range []string{"es", "en"} {
		for _, level := range levels {
			name := fmt.Sprintf("%s/level=%v", language, level)
			t.Run(name, func(t *testing.T) {
				got := mustLanguages(t, []any{languageItem(language, nil, level)})
				item := requireLanguageAt(t, got, 0)
				if item.Language != language {
					t.Fatalf("Language = %q, want %q", item.Language, language)
				}
				if item.CustomName != nil {
					t.Errorf("CustomName = %q, want nil", *item.CustomName)
				}
				if level == nil {
					if item.Level != nil {
						t.Errorf("Level = %q, want nil", *item.Level)
					}
				} else {
					requireStringPtr(t, item.Level, level.(string), "Level")
				}
			})
		}
	}

	t.Run("other accepts null name and level", func(t *testing.T) {
		item := requireLanguageAt(t, mustLanguages(t, []any{languageItem("other", nil, nil)}), 0)
		if item.CustomName != nil || item.Level != nil {
			t.Errorf("output = %+v, want nil pointers", item)
		}
	})

	t.Run("other accepts a substantive name", func(t *testing.T) {
		item := requireLanguageAt(t, mustLanguages(t, []any{languageItem("other", "  Náhuatl  ", "native")}), 0)
		requireStringPtr(t, item.CustomName, "Náhuatl", "CustomName")
		requireStringPtr(t, item.Level, "native", "Level")
	})
}

func TestValidateLanguages_RejectsInexactLiterals(t *testing.T) {
	languages := []string{
		"",
		" ",
		"ES",
		"En",
		"OTHER",
		"Other",
		" en",
		"en ",
		"\ten",
		"es-ES",
		"eng",
		"spanish",
		"german",
	}
	for _, language := range languages {
		t.Run("language "+fmt.Sprintf("%q", language), func(t *testing.T) {
			got, err := ValidateLanguages([]any{languageItem(language, nil, nil)})
			requireLanguageError(t, got, err, errLanguageInvalidLanguage)
		})
	}

	levels := []string{
		"",
		" ",
		"BASIC",
		" Basic",
		"basic ",
		"\tbasic",
		"fluent",
		"cefr_b1",
		"A1",
		"advanced ",
		"native\n",
	}
	for _, level := range levels {
		t.Run("level "+fmt.Sprintf("%q", level), func(t *testing.T) {
			got, err := ValidateLanguages([]any{languageItem("other", nil, level)})
			requireLanguageError(t, got, err, errLanguageInvalidLevel)
		})
	}

	t.Run("null language is a wrong type", func(t *testing.T) {
		in := map[string]any{"language": nil, "custom_name": nil, "level": nil}
		got, err := ValidateLanguages([]any{in})
		requireLanguageError(t, got, err, errLanguageWrongType)
	})

	t.Run("wrong dynamic types", func(t *testing.T) {
		values := map[string]any{
			"int":     1,
			"int64":   int64(1),
			"float64": 1.0,
			"bool":    true,
			"map":     map[string]any{},
			"slice":   []any{"other"},
			"struct":  struct{}{},
		}
		for name, value := range values {
			t.Run("language/"+name, func(t *testing.T) {
				in := map[string]any{"language": value, "custom_name": nil, "level": nil}
				got, err := ValidateLanguages([]any{in})
				requireLanguageError(t, got, err, errLanguageWrongType)
			})
			t.Run("custom_name/"+name, func(t *testing.T) {
				got, err := ValidateLanguages([]any{languageItem("other", value, nil)})
				requireLanguageError(t, got, err, errLanguageWrongType)
			})
			t.Run("level/"+name, func(t *testing.T) {
				got, err := ValidateLanguages([]any{languageItem("other", nil, value)})
				requireLanguageError(t, got, err, errLanguageWrongType)
			})
		}
	})
}

func TestValidateLanguages_CustomNameNormalization(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		wantNil bool
		want    string
	}{
		{name: "ascii trim", in: "  Náhuatl  ", want: "Náhuatl"},
		{name: "tab and newline trim", in: "\tNáhuatl\n", want: "Náhuatl"},
		{name: "carriage return and form feed trim", in: "\r\fNáhuatl\v", want: "Náhuatl"},
		{name: "next line and line separator trim", in: "\u0085Náhuatl\u2028", want: "Náhuatl"},
		{name: "no-break space trim", in: "\u00a0Náhuatl\u00a0", want: "Náhuatl"},
		{name: "ideographic space trim", in: "\u3000Náhuatl\u3000", want: "Náhuatl"},
		{name: "empty becomes null", in: "", wantNil: true},
		{name: "whitespace only becomes null", in: " \t\n\u00a0\u3000", wantNil: true},
		{name: "interior whitespace preserved", in: "Náhuatl  clásico", want: "Náhuatl  clásico"},
		{name: "interior newline preserved", in: "Náhuatl\nclásico", want: "Náhuatl\nclásico"},
		{name: "FEFF preserved", in: "\ufeffNáhuatl\ufeff", want: "\ufeffNáhuatl\ufeff"},
		{name: "combining mark preserved", in: "e\u0301", want: "e\u0301"},
		{name: "case preserved", in: "NáHuatL", want: "NáHuatL"},
		{name: "astral preserved", in: "\U0001f600", want: "\U0001f600"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			item := requireLanguageAt(t, mustLanguages(t, []any{languageItem("other", tc.in, nil)}), 0)
			if tc.wantNil {
				if item.CustomName != nil {
					t.Errorf("CustomName = %q, want nil", *item.CustomName)
				}
				return
			}
			requireStringPtr(t, item.CustomName, tc.want, "CustomName")
		})
	}

	t.Run("invalid utf8 rejected", func(t *testing.T) {
		values := []string{"\xff", "Ná\xffhuatl", "\xffNáhuatl", "a\x80b", "\xc3", "\xed\xa0\x80"}
		for _, value := range values {
			t.Run(fmt.Sprintf("%q", value), func(t *testing.T) {
				got, err := ValidateLanguages([]any{languageItem("other", value, nil)})
				requireLanguageError(t, got, err, errLanguageInvalidUTF8)
			})
		}
	})
}

func TestValidateLanguages_CustomNameCodepointBoundary(t *testing.T) {
	t.Run("200 ascii accepted", func(t *testing.T) {
		value := strings.Repeat("a", 200)
		item := requireLanguageAt(t, mustLanguages(t, []any{languageItem("other", value, nil)}), 0)
		requireStringPtr(t, item.CustomName, value, "CustomName")
	})

	t.Run("201 ascii rejected", func(t *testing.T) {
		got, err := ValidateLanguages([]any{languageItem("other", strings.Repeat("a", 201), nil)})
		requireLanguageError(t, got, err, errLanguageTooLong)
	})

	t.Run("200 astral accepted", func(t *testing.T) {
		value := strings.Repeat("\U0001f600", 200)
		if len(value) != 800 {
			t.Fatalf("test setup: byte length = %d, want 800", len(value))
		}
		item := requireLanguageAt(t, mustLanguages(t, []any{languageItem("other", value, nil)}), 0)
		requireStringPtr(t, item.CustomName, value, "CustomName")
	})

	t.Run("201 astral rejected", func(t *testing.T) {
		got, err := ValidateLanguages([]any{languageItem("other", strings.Repeat("\U0001f600", 201), nil)})
		requireLanguageError(t, got, err, errLanguageTooLong)
	})

	t.Run("length measured after trimming", func(t *testing.T) {
		value := "  " + strings.Repeat("a", 200) + "  "
		if _, err := ValidateLanguages([]any{languageItem("other", value, nil)}); err != nil {
			t.Fatalf("ValidateLanguages(trimmed 200): %v", err)
		}
		tooLong := "  " + strings.Repeat("a", 201) + "  "
		got, err := ValidateLanguages([]any{languageItem("other", tooLong, nil)})
		requireLanguageError(t, got, err, errLanguageTooLong)
	})
}

func TestValidateLanguages_EsEnRequireNullCustomName(t *testing.T) {
	t.Run("null accepted", func(t *testing.T) {
		for _, language := range []string{"es", "en"} {
			item := requireLanguageAt(t, mustLanguages(t, []any{languageItem(language, nil, nil)}), 0)
			if item.CustomName != nil {
				t.Errorf("CustomName = %q, want nil", *item.CustomName)
			}
		}
	})

	t.Run("whitespace only normalizes to null before the rule", func(t *testing.T) {
		for _, language := range []string{"es", "en"} {
			for _, value := range []string{"", " ", " \t\n ", "\u00a0\u3000"} {
				item := requireLanguageAt(t, mustLanguages(t, []any{languageItem(language, value, nil)}), 0)
				if item.CustomName != nil {
					t.Errorf("CustomName = %q, want nil", *item.CustomName)
				}
			}
		}
	})

	t.Run("substantive rejected", func(t *testing.T) {
		cases := map[string]string{
			"spanish": "Español",
			"english": "English",
			"padded":  "  English  ",
			"feff":    "\ufeff",
			"astral":  "\U0001f600",
		}
		for name, value := range cases {
			for _, language := range []string{"es", "en"} {
				t.Run(name+"/"+language, func(t *testing.T) {
					got, err := ValidateLanguages([]any{languageItem(language, value, nil)})
					requireLanguageError(t, got, err, errLanguageCustomNameForbidden)
				})
			}
		}
	})
}

func TestValidateLanguages_NormalizesBeforeEsEnRule(t *testing.T) {
	t.Run("es invalid utf8 is an encoding error", func(t *testing.T) {
		got, err := ValidateLanguages([]any{languageItem("es", "Espa\xffol", nil)})
		requireLanguageError(t, got, err, errLanguageInvalidUTF8)
	})

	t.Run("en overlong is a length error", func(t *testing.T) {
		got, err := ValidateLanguages([]any{languageItem("en", strings.Repeat("a", 201), nil)})
		requireLanguageError(t, got, err, errLanguageTooLong)
	})

	t.Run("other substantive name is accepted", func(t *testing.T) {
		item := requireLanguageAt(t, mustLanguages(t, []any{languageItem("other", "Español", nil)}), 0)
		requireStringPtr(t, item.CustomName, "Español", "CustomName")
	})
}

func TestValidateLanguages_PreservesOrderAndDuplicates(t *testing.T) {
	in := []any{
		languageItem("other", "Español", "native"),
		languageItem("other", "Español", "native"),
		languageItem("es", nil, nil),
		languageItem("en", nil, "advanced"),
		languageItem("other", "Español", nil),
	}
	got := mustLanguages(t, in)
	if len(got) != 5 {
		t.Fatalf("len(output) = %d, want 5", len(got))
	}
	wantLanguages := []string{"other", "other", "es", "en", "other"}
	for i, want := range wantLanguages {
		if got[i].Language != want {
			t.Errorf("output[%d].Language = %q, want %q", i, got[i].Language, want)
		}
	}
	for i, want := range []string{"Español", "Español"} {
		requireStringPtr(t, got[i].CustomName, want, fmt.Sprintf("output[%d].CustomName", i))
	}
	requireStringPtr(t, got[4].CustomName, "Español", "output[4].CustomName")
}

func TestValidateLanguages_ReturnsFreshIndependentResults(t *testing.T) {
	item := languageItem("other", "  Náhuatl  ", "native")
	in := []any{item}

	first := mustLanguages(t, in)
	second := mustLanguages(t, in)

	if len(first) != 1 || len(second) != 1 {
		t.Fatalf("unexpected lengths: %d, %d", len(first), len(second))
	}
	if first[0].CustomName == second[0].CustomName {
		t.Error("two calls aliased the same CustomName pointer")
	}
	if first[0].Level == second[0].Level {
		t.Error("two calls aliased the same Level pointer")
	}
	if first[0].CustomName == nil || first[0].Level == nil {
		t.Fatal("expected non-nil pointers for a substantive name and level")
	}

	*first[0].CustomName = "changed"
	*first[0].Level = "basic"
	if *second[0].CustomName != "Náhuatl" {
		t.Errorf("mutating first changed second name: %q", *second[0].CustomName)
	}
	if *second[0].Level != "native" {
		t.Errorf("mutating first changed second level: %q", *second[0].Level)
	}
	if item["custom_name"] != "  Náhuatl  " || item["level"] != "native" {
		t.Errorf("returned values aliased the input: %v", item)
	}
}

func TestValidateLanguages_DoesNotMutateInput(t *testing.T) {
	item := languageItem("other", "  Náhuatl  ", "basic")
	in := []any{item}
	before := map[string]any{"language": "other", "custom_name": "  Náhuatl  ", "level": "basic"}

	if _, err := ValidateLanguages(in); err != nil {
		t.Fatalf("ValidateLanguages: %v", err)
	}
	if !reflect.DeepEqual(item, before) {
		t.Errorf("input item mutated: got %v, want %v", item, before)
	}
	if len(in) != 1 || !reflect.DeepEqual(in[0], before) {
		t.Errorf("input slice mutated: %v", in)
	}
}

func TestValidateLanguages_ErrorOutputIsNil(t *testing.T) {
	cases := map[string]any{
		"null root":      nil,
		"not array":      "other",
		"not object":     []any{"other"},
		"missing key":    []any{map[string]any{"language": "other"}},
		"unknown key":    []any{map[string]any{"language": "other", "custom_name": nil, "level": nil, "id": 1}},
		"null language":  []any{map[string]any{"language": nil, "custom_name": nil, "level": nil}},
		"bad language":   []any{languageItem("de", nil, nil)},
		"bad level":      []any{languageItem("other", nil, "fluent")},
		"wrong type":     []any{languageItem("other", 7, nil)},
		"invalid utf8":   []any{languageItem("other", "\xff", nil)},
		"too long":       []any{languageItem("other", strings.Repeat("a", 201), nil)},
		"forbidden name": []any{languageItem("es", "Español", nil)},
		"too many":       nestedLanguageItems(101),
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := ValidateLanguages(in)
			if err == nil {
				t.Fatalf("ValidateLanguages(%v) err = nil, want error", in)
			}
			if got != nil {
				t.Errorf("output = %+v, want nil", got)
			}
		})
	}
}
