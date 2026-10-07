package draftfields

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	shared "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
)

// The expectations in this file were authored before ValidateScalars was
// implemented. They describe the B6.1 scalar contract: presence preservation
// for nine concrete fields, exact enum literals, end-only Unicode White_Space
// trimming for free text, and codepoint/byte limits applied after
// normalization.

// allScalarKeys lists the nine keys of the scalar group in the order the
// contract presents them.
var allScalarKeys = []string{
	"title",
	"location",
	"required_requirements",
	"preferred_requirements",
	"work_mode",
	"work_schedule",
	"contract_type",
	"seniority",
	"professional_area",
}

// optionalFor returns the scalar field addressed by its wire key.
func optionalFor(t *testing.T, scalars Scalars, key string) shared.Optional[string] {
	t.Helper()
	switch key {
	case "title":
		return scalars.Title
	case "location":
		return scalars.Location
	case "required_requirements":
		return scalars.RequiredRequirements
	case "preferred_requirements":
		return scalars.PreferredRequirements
	case "work_mode":
		return scalars.WorkMode
	case "work_schedule":
		return scalars.WorkSchedule
	case "contract_type":
		return scalars.ContractType
	case "seniority":
		return scalars.Seniority
	case "professional_area":
		return scalars.ProfessionalArea
	default:
		t.Fatalf("unknown scalar key %q", key)
		return shared.Optional[string]{}
	}
}

// requireOptional asserts the exact tri-state of one field.
func requireOptional(t *testing.T, name string, got shared.Optional[string], wantSet, wantValid bool, wantValue string) {
	t.Helper()
	if got.Set != wantSet || got.Valid != wantValid || got.Value != wantValue {
		t.Errorf("%s = %+v, want Set=%v Valid=%v Value=%q", name, got, wantSet, wantValid, wantValue)
	}
}

func TestValidateScalars_EmptyMapLeavesAllFieldsAbsent(t *testing.T) {
	got, err := ValidateScalars(map[string]any{})
	if err != nil {
		t.Fatalf("ValidateScalars: %v", err)
	}
	if got != (Scalars{}) {
		t.Errorf("empty map: want zero Scalars, got %+v", got)
	}
}

func TestValidateScalars_NilMapRejected(t *testing.T) {
	got, err := ValidateScalars(nil)
	if !errors.Is(err, ErrNilMap) {
		t.Fatalf("err = %v, want ErrNilMap", err)
	}
	if got != (Scalars{}) {
		t.Errorf("nil map: want zero Scalars, got %+v", got)
	}
}

func TestValidateScalars_NullValues(t *testing.T) {
	for _, key := range allScalarKeys {
		t.Run(key, func(t *testing.T) {
			got, err := ValidateScalars(map[string]any{key: nil})
			if err != nil {
				t.Fatalf("ValidateScalars: %v", err)
			}
			requireOptional(t, key, optionalFor(t, got, key), true, false, "")
		})
	}
}

func TestValidateScalars_WrongTypeRejectsEveryField(t *testing.T) {
	for _, key := range allScalarKeys {
		for name, value := range map[string]any{
			"int64":   int64(1),
			"float64": float64(1),
			"bool":    true,
			"array":   []any{"x"},
			"object":  map[string]any{"x": "y"},
		} {
			t.Run(key+"/"+name, func(t *testing.T) {
				got, err := ValidateScalars(map[string]any{key: value})
				if !errors.Is(err, ErrWrongType) {
					t.Fatalf("err = %v, want ErrWrongType", err)
				}
				if got != (Scalars{}) {
					t.Errorf("want zero Scalars, got %+v", got)
				}
			})
		}
	}
}

func TestValidateScalars_WrongTypeRejectsWholeGroup(t *testing.T) {
	got, err := ValidateScalars(map[string]any{
		"title":    "Engineer",
		"location": int64(7),
	})
	if !errors.Is(err, ErrWrongType) {
		t.Fatalf("err = %v, want ErrWrongType", err)
	}
	if got != (Scalars{}) {
		t.Errorf("want zero Scalars, got %+v", got)
	}
}

func TestValidateScalars_UnknownKeysRejected(t *testing.T) {
	unknownKeys := []string{
		"salary_min",
		"salary_max",
		"description",
		"requirements",
		"responsibilities",
		"Title",
		"WORK_MODE",
		"workmode",
		"professional_areas",
		"",
		"id",
	}
	for _, key := range unknownKeys {
		t.Run(key, func(t *testing.T) {
			got, err := ValidateScalars(map[string]any{key: "x"})
			if !errors.Is(err, ErrUnknownKey) {
				t.Fatalf("err = %v, want ErrUnknownKey", err)
			}
			if got != (Scalars{}) {
				t.Errorf("want zero Scalars, got %+v", got)
			}
		})
	}
}

func TestValidateScalars_UnknownKeyRejectsWholeGroup(t *testing.T) {
	got, err := ValidateScalars(map[string]any{
		"title":      "Engineer",
		"salary_min": int64(1),
	})
	if !errors.Is(err, ErrUnknownKey) {
		t.Fatalf("err = %v, want ErrUnknownKey", err)
	}
	if got != (Scalars{}) {
		t.Errorf("want zero Scalars, got %+v", got)
	}
}

func TestValidateScalars_FreeTextNormalization(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantSet   bool
		wantValid bool
		wantValue string
	}{
		{name: "plain preserved", input: "hello", wantSet: true, wantValid: true, wantValue: "hello"},
		{name: "leading and trailing ASCII spaces trimmed", input: "  hello  ", wantSet: true, wantValid: true, wantValue: "hello"},
		{name: "U+0085 end trimmed", input: "\u0085hello\u0085", wantSet: true, wantValid: true, wantValue: "hello"},
		{name: "NBSP end trimmed", input: "\u00a0hello\u00a0", wantSet: true, wantValid: true, wantValue: "hello"},
		{name: "U+3000 end trimmed", input: "\u3000hello\u3000", wantSet: true, wantValid: true, wantValue: "hello"},
		{name: "mixed Unicode end whitespace trimmed", input: " \t\nhello\r\n\u0085\u00a0\u3000", wantSet: true, wantValid: true, wantValue: "hello"},
		{name: "interior space preserved", input: "a b", wantSet: true, wantValid: true, wantValue: "a b"},
		{name: "interior newline preserved", input: "a\nb", wantSet: true, wantValid: true, wantValue: "a\nb"},
		{name: "interior NBSP preserved", input: "a\u00a0b", wantSet: true, wantValid: true, wantValue: "a\u00a0b"},
		{name: "combining mark preserved without NFC", input: "e\u0301", wantSet: true, wantValid: true, wantValue: "e\u0301"},
		{name: "leading BOM preserved", input: "\uFEFFhello", wantSet: true, wantValid: true, wantValue: "\uFEFFhello"},
		{name: "trailing BOM preserved", input: "hello\uFEFF", wantSet: true, wantValid: true, wantValue: "hello\uFEFF"},
		{name: "BOM-only preserved", input: "\uFEFF", wantSet: true, wantValid: true, wantValue: "\uFEFF"},
		{name: "literal replacement char preserved", input: "\uFFFD", wantSet: true, wantValid: true, wantValue: "\uFFFD"},
		{name: "empty becomes null", input: "", wantSet: true, wantValid: false, wantValue: ""},
		{name: "ASCII whitespace only becomes null", input: " \t\r\n", wantSet: true, wantValid: false, wantValue: ""},
		{name: "Unicode whitespace only becomes null", input: "\u0085\u00a0\u3000", wantSet: true, wantValid: false, wantValue: ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ValidateScalars(map[string]any{"title": tc.input})
			if err != nil {
				t.Fatalf("ValidateScalars: %v", err)
			}
			requireOptional(t, "title", got.Title, tc.wantSet, tc.wantValid, tc.wantValue)
		})
	}
}

func TestValidateScalars_FreeTextLimitsAreInclusive(t *testing.T) {
	tests := []struct {
		name      string
		key       string
		value     string
		wantValue string
		wantErr   bool
	}{
		{name: "title 200 ascii codepoints", key: "title", value: strings.Repeat("a", 200)},
		{name: "title 201 ascii codepoints", key: "title", value: strings.Repeat("a", 201), wantErr: true},
		{name: "title 200 astral codepoints", key: "title", value: strings.Repeat("\U0001F600", 200)},
		{name: "title 201 astral codepoints", key: "title", value: strings.Repeat("\U0001F600", 201), wantErr: true},
		{name: "title 200 astral codepoints counts codepoints not bytes", key: "title", value: strings.Repeat("\U0001F600", 200)},
		{name: "title trims before limit", key: "title", value: "\u3000" + strings.Repeat("\U0001F600", 200) + " ", wantValue: strings.Repeat("\U0001F600", 200)},
		{name: "title whitespace does not absorb limit", key: "title", value: " " + strings.Repeat("\U0001F600", 201) + " ", wantErr: true},
		{name: "location 300 ascii codepoints", key: "location", value: strings.Repeat("b", 300)},
		{name: "location 301 ascii codepoints", key: "location", value: strings.Repeat("b", 301), wantErr: true},
		{name: "location 300 astral codepoints", key: "location", value: strings.Repeat("\U0001F600", 300)},
		{name: "location 301 astral codepoints", key: "location", value: strings.Repeat("\U0001F600", 301), wantErr: true},
		{name: "required 16384 ascii bytes", key: "required_requirements", value: strings.Repeat("a", 16384)},
		{name: "required 16385 ascii bytes", key: "required_requirements", value: strings.Repeat("a", 16385), wantErr: true},
		{name: "required 16384 multibyte bytes", key: "required_requirements", value: strings.Repeat("\u00e9", 8192)},
		{name: "required 16386 multibyte bytes", key: "required_requirements", value: strings.Repeat("\u00e9", 8193), wantErr: true},
		{name: "preferred 16384 ascii bytes", key: "preferred_requirements", value: strings.Repeat("a", 16384)},
		{name: "preferred 16385 ascii bytes", key: "preferred_requirements", value: strings.Repeat("a", 16385), wantErr: true},
		{name: "requirements trims before byte limit", key: "required_requirements", value: " " + strings.Repeat("a", 16384) + " ", wantValue: strings.Repeat("a", 16384)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ValidateScalars(map[string]any{tc.key: tc.value})
			if tc.wantErr {
				if !errors.Is(err, ErrTooLong) {
					t.Fatalf("err = %v, want ErrTooLong", err)
				}
				if got != (Scalars{}) {
					t.Errorf("want zero Scalars, got %+v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ValidateScalars: %v", err)
			}
			field := optionalFor(t, got, tc.key)
			wantValue := tc.wantValue
			if wantValue == "" {
				wantValue = tc.value
			}
			requireOptional(t, tc.key, field, true, true, wantValue)
		})
	}
}

func TestValidateScalars_EnumsAcceptExactLiterals(t *testing.T) {
	enumCases := []struct {
		key     string
		allowed []string
	}{
		{key: "work_mode", allowed: []string{"onsite", "remote", "hybrid"}},
		{key: "work_schedule", allowed: []string{"full_time", "part_time"}},
		{key: "contract_type", allowed: []string{"project", "indefinite", "professional_services", "temporary", "internship"}},
		{key: "seniority", allowed: []string{"intern", "junior", "mid", "senior", "lead"}},
		{key: "professional_area", allowed: []string{
			"technology_systems",
			"engineering",
			"product",
			"design_creative",
			"sales_business_development",
			"marketing_communications",
			"administration_finance",
			"human_resources",
			"operations_production",
			"logistics_transport",
			"customer_service_support",
			"healthcare",
			"education_training",
			"legal",
			"construction_maintenance",
			"tourism_hospitality_gastronomy",
		}},
	}
	for _, tc := range enumCases {
		for _, literal := range tc.allowed {
			t.Run(tc.key+"/"+literal, func(t *testing.T) {
				got, err := ValidateScalars(map[string]any{tc.key: literal})
				if err != nil {
					t.Fatalf("ValidateScalars: %v", err)
				}
				requireOptional(t, tc.key, optionalFor(t, got, tc.key), true, true, literal)
			})
		}
	}
}

func TestValidateScalars_EnumsRejectInexactLiterals(t *testing.T) {
	tests := []struct {
		name  string
		key   string
		value string
	}{
		{name: "work_mode uppercase", key: "work_mode", value: "ONSITE"},
		{name: "work_mode title case", key: "work_mode", value: "Onsite"},
		{name: "work_mode leading space", key: "work_mode", value: " onsite"},
		{name: "work_mode trailing space", key: "work_mode", value: "onsite "},
		{name: "work_mode leading tab", key: "work_mode", value: "\tonsite"},
		{name: "work_mode trailing NEL", key: "work_mode", value: "onsite\u0085"},
		{name: "work_mode empty", key: "work_mode", value: ""},
		{name: "work_mode concatenated", key: "work_mode", value: "onsite remote"},
		{name: "work_mode misspelled", key: "work_mode", value: "onsight"},
		{name: "work_schedule uppercase", key: "work_schedule", value: "FULL_TIME"},
		{name: "work_schedule hyphenated", key: "work_schedule", value: "full-time"},
		{name: "work_schedule unknown", key: "work_schedule", value: "fulltime"},
		{name: "work_schedule empty", key: "work_schedule", value: ""},
		{name: "contract_type uppercase", key: "contract_type", value: "PROJECT"},
		{name: "contract_type legacy employment literal", key: "contract_type", value: "contract"},
		{name: "contract_type unknown", key: "contract_type", value: "permanent"},
		{name: "contract_type trailing space", key: "contract_type", value: "project "},
		{name: "seniority uppercase", key: "seniority", value: "SENIOR"},
		{name: "seniority leading space", key: "seniority", value: " senior"},
		{name: "seniority unknown", key: "seniority", value: "principal"},
		{name: "seniority empty", key: "seniority", value: ""},
		{name: "professional_area uppercase", key: "professional_area", value: "ENGINEERING"},
		{name: "professional_area legacy literal", key: "professional_area", value: "technology"},
		{name: "professional_area unknown", key: "professional_area", value: "other"},
		{name: "professional_area trailing space", key: "professional_area", value: "engineering "},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ValidateScalars(map[string]any{tc.key: tc.value})
			if !errors.Is(err, ErrInvalidEnum) {
				t.Fatalf("err = %v, want ErrInvalidEnum", err)
			}
			if got != (Scalars{}) {
				t.Errorf("want zero Scalars, got %+v", got)
			}
		})
	}
}

func TestValidateScalars_InvalidUTF8Rejected(t *testing.T) {
	invalid := string([]byte{0xff, 0xfe, 0xfd})
	for _, key := range allScalarKeys {
		t.Run(key, func(t *testing.T) {
			got, err := ValidateScalars(map[string]any{key: invalid})
			if !errors.Is(err, ErrInvalidUTF8) {
				t.Fatalf("err = %v, want ErrInvalidUTF8", err)
			}
			if got != (Scalars{}) {
				t.Errorf("want zero Scalars, got %+v", got)
			}
		})
	}
}

func TestValidateScalars_InvalidUTF8RejectedBeforeEnumMatch(t *testing.T) {
	// A leading valid byte plus an invalid continuation must not be trimmed or
	// compared before the UTF-8 check.
	got, err := ValidateScalars(map[string]any{"work_mode": "onsite\xff"})
	if !errors.Is(err, ErrInvalidUTF8) {
		t.Fatalf("err = %v, want ErrInvalidUTF8", err)
	}
	if got != (Scalars{}) {
		t.Errorf("want zero Scalars, got %+v", got)
	}
}

func TestValidateScalars_NoDefaultsForOmittedFields(t *testing.T) {
	got, err := ValidateScalars(map[string]any{"title": "Engineer"})
	if err != nil {
		t.Fatalf("ValidateScalars: %v", err)
	}
	requireOptional(t, "title", got.Title, true, true, "Engineer")
	for _, key := range allScalarKeys {
		if key == "title" {
			continue
		}
		if field := optionalFor(t, got, key); field != (shared.Optional[string]{}) {
			t.Errorf("%s = %+v, want absent", key, field)
		}
	}
}

func TestValidateScalars_DoesNotMutateInput(t *testing.T) {
	tests := []struct {
		name  string
		input map[string]any
	}{
		{
			name: "success with trimmable and enum values",
			input: map[string]any{
				"title":     "  Engineer  ",
				"work_mode": "remote",
				"location":  nil,
			},
		},
		{
			name:  "wrong type",
			input: map[string]any{"title": int64(1)},
		},
		{
			name:  "unknown key",
			input: map[string]any{"salary_min": int64(1)},
		},
		{
			name:  "invalid utf8",
			input: map[string]any{"title": "bad\xff"},
		},
		{
			name:  "too long",
			input: map[string]any{"title": strings.Repeat("a", 201)},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			before := make(map[string]any, len(tc.input))
			for key, value := range tc.input {
				before[key] = value
			}
			_, _ = ValidateScalars(tc.input)
			if !reflect.DeepEqual(tc.input, before) {
				t.Errorf("input mutated: got %v, want %v", tc.input, before)
			}
		})
	}
}
