package draftjson

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

// The expected byte strings below are literals authored before
// EncodeValidatedValue existed. They describe default encoding/json.Marshal
// output: sorted map keys, no whitespace, HTML characters and U+2028/U+2029
// escaped, and no trailing newline.

func TestEncodeValidatedValue_LiteralCanonicalBytes(t *testing.T) {
	tests := []struct {
		name  string
		input any
		want  string
	}{
		{name: "nil", input: nil, want: `null`},
		{name: "bool true", input: true, want: `true`},
		{name: "bool false", input: false, want: `false`},
		{name: "int64 zero", input: int64(0), want: `0`},
		{name: "int64 negative", input: int64(-1), want: `-1`},
		{name: "int64 max", input: int64(9223372036854775807), want: `9223372036854775807`},
		{name: "int64 min", input: int64(-9223372036854775808), want: `-9223372036854775808`},
		{name: "empty string", input: "", want: `""`},
		{name: "ascii string", input: "hello world", want: `"hello world"`},
		{name: "quote and backslash escaped", input: `say "hi" \ done`, want: `"say \"hi\" \\ done"`},
		{name: "control characters escaped", input: "a\x00b\tc\nd\re\x08f\x0cg\x1f", want: `"a\u0000b\tc\nd\re\bf\fg\u001f"`},
		{name: "html characters escaped by default marshaler", input: `<a href="x">&'</a>`, want: `"\u003ca href=\"x\"\u003e\u0026'\u003c/a\u003e"`},
		{name: "line separators escaped", input: "\u2028\u2029", want: `"\u2028\u2029"`},
		{name: "unicode preserved as utf8", input: "café ñ 日本語 😀", want: "\"café ñ 日本語 😀\""},
		{name: "combining sequence not normalized", input: "e\u0301", want: "\"e\u0301\""},
		{name: "empty array", input: []any{}, want: `[]`},
		{name: "array mark order preserved", input: []any{int64(3), int64(1), int64(2)}, want: `[3,1,2]`},
		{name: "empty object", input: map[string]any{}, want: `{}`},
		{name: "empty map key is ascii", input: map[string]any{"": int64(1)}, want: `{"":1}`},
		{name: "ascii DEL in map key and string value", input: map[string]any{"\x7f": "\x7f"}, want: "{\"\x7f\":\"\x7f\"}"},
		{name: "map keys sorted", input: map[string]any{"b": int64(1), "a": int64(2), "c": int64(3)}, want: `{"a":2,"b":1,"c":3}`},
		{name: "map key html escaping and order", input: map[string]any{"<b>": int64(1), "&": int64(2)}, want: `{"\u0026":2,"\u003cb\u003e":1}`},
		{
			name:  "presence of null empty string empty array and empty object",
			input: map[string]any{"present": nil, "emptyString": "", "emptyArray": []any{}, "emptyObject": map[string]any{}},
			want:  `{"emptyArray":[],"emptyObject":{},"emptyString":"","present":null}`,
		},
		{
			name:  "absent key is not added",
			input: map[string]any{"emptyArray": []any{}, "emptyString": ""},
			want:  `{"emptyArray":[],"emptyString":""}`,
		},
		{
			name:  "nested containers keep presence and mark order",
			input: map[string]any{"z": []any{int64(1), map[string]any{"y": "x"}, []any{}}, "a": []any{}},
			want:  `{"a":[],"z":[1,{"y":"x"},[]]}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := EncodeValidatedValue(tt.input)
			if err != nil {
				t.Fatalf("EncodeValidatedValue() error = %v, want nil", err)
			}
			if string(got) != tt.want {
				t.Fatalf("EncodeValidatedValue() = %q, want literal %q", got, tt.want)
			}
		})
	}
}

func TestEncodeValidatedValue_AppendsNoNewline(t *testing.T) {
	got, err := EncodeValidatedValue(map[string]any{"a": []any{int64(1), "b"}})
	if err != nil {
		t.Fatalf("EncodeValidatedValue() error = %v, want nil", err)
	}
	if want := `{"a":[1,"b"]}`; string(got) != want {
		t.Fatalf("EncodeValidatedValue() = %q, want literal %q", got, want)
	}
	if bytes.Contains(got, []byte("\n")) {
		t.Fatalf("EncodeValidatedValue() = %q, want no raw newline (no Encoder.Encode)", got)
	}
}

func TestEncodeValidatedValue_RejectsUnsupportedTypes(t *testing.T) {
	tests := []struct {
		name  string
		input any
	}{
		{name: "float64", input: float64(1)},
		{name: "float32", input: float32(1)},
		{name: "int", input: 1},
		{name: "int32", input: int32(1)},
		{name: "uint64", input: uint64(1)},
		{name: "json.Number", input: json.Number("1")},
		{name: "json.RawMessage", input: json.RawMessage(`{"a":1}`)},
		{name: "named map type", input: namedMap{"a": int64(1)}},
		{name: "named slice type", input: namedSlice{int64(1)}},
		{name: "named string type", input: namedString("x")},
		{name: "named int64 type", input: namedInt64(1)},
		{name: "named bool type", input: namedBool(true)},
		{name: "map with string values", input: map[string]string{}},
		{name: "byte slice", input: []byte("x")},
		{name: "array instead of slice", input: [1]any{}},
		{name: "struct", input: struct{}{}},
		{name: "pointer", input: new(int64)},
		{name: "channel", input: make(chan int)},
		{name: "func", input: func() {}},
		{name: "custom marshaler value", input: customMarshaler{}},
		{name: "custom marshaler pointer", input: &customMarshaler{}},
		{name: "float nested in object", input: map[string]any{"a": float64(1)}},
		{name: "float nested in array", input: []any{int64(1), float64(2)}},
		{name: "json.Number nested in object", input: map[string]any{"a": json.Number("1")}},
		{name: "named map nested in array", input: []any{namedMap{}}},
		{name: "custom marshaler nested in object", input: map[string]any{"a": customMarshaler{}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := EncodeValidatedValue(tt.input)
			if !errors.Is(err, ErrUnsupportedType) {
				t.Fatalf("EncodeValidatedValue(%T) error = %v, want %v", tt.input, err, ErrUnsupportedType)
			}
			if got != nil {
				t.Fatalf("EncodeValidatedValue(%T) bytes = %q, want nil", tt.input, got)
			}
		})
	}
}

func TestEncodeValidatedValue_DoesNotInvokeMarshalJSON(t *testing.T) {
	tests := []struct {
		name  string
		input func(called *bool) any
	}{
		{
			name:  "custom marshaler value",
			input: func(called *bool) any { return customMarshaler{called: called} },
		},
		{
			name:  "custom marshaler nested in object",
			input: func(called *bool) any { return map[string]any{"a": customMarshaler{called: called}} },
		},
		{
			name:  "custom marshaler nested in array",
			input: func(called *bool) any { return []any{customMarshaler{called: called}} },
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called := false
			got, err := EncodeValidatedValue(tt.input(&called))
			if !errors.Is(err, ErrUnsupportedType) {
				t.Fatalf("error = %v, want %v", err, ErrUnsupportedType)
			}
			if got != nil {
				t.Fatalf("bytes = %q, want nil", got)
			}
			if called {
				t.Fatal("caller MarshalJSON was invoked; encoder must not call caller methods")
			}
		})
	}
}

func TestEncodeValidatedValue_RejectsTypedNil(t *testing.T) {
	var nilMap map[string]any
	var nilSlice []any

	tests := []struct {
		name  string
		input any
	}{
		{name: "typed nil map", input: nilMap},
		{name: "typed nil slice", input: nilSlice},
		{name: "typed nil map nested in array", input: []any{nilMap}},
		{name: "typed nil slice nested in object", input: map[string]any{"a": nilSlice}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := EncodeValidatedValue(tt.input)
			if !errors.Is(err, ErrTypedNil) {
				t.Fatalf("EncodeValidatedValue(%T) error = %v, want %v", tt.input, err, ErrTypedNil)
			}
			if got != nil {
				t.Fatalf("EncodeValidatedValue(%T) bytes = %q, want nil", tt.input, got)
			}
		})
	}
}

func TestEncodeValidatedValue_RejectsInvalidUTF8AndNonASCIIKeys(t *testing.T) {
	tests := []struct {
		name  string
		input any
		want  error
	}{
		{name: "invalid utf8 scalar", input: "caf\xe9", want: ErrInvalidUTF8},
		{name: "invalid utf8 suffix", input: "ok\xff", want: ErrInvalidUTF8},
		{name: "invalid utf8 surrogate bytes", input: "\xed\xa0\x80", want: ErrInvalidUTF8},
		{name: "invalid utf8 nested in array", input: []any{"\x80"}, want: ErrInvalidUTF8},
		{name: "invalid utf8 nested in object", input: map[string]any{"a": "\xf0\x28\x8c\x28"}, want: ErrInvalidUTF8},
		{name: "valid utf8 multibyte is accepted by the prewalk", input: "café", want: nil},
		{name: "non ascii map key", input: map[string]any{"café": int64(1)}, want: ErrNonASCIIKey},
		{name: "DEL is the last accepted map key byte", input: map[string]any{"\x7f": int64(1)}, want: nil},
		{name: "byte 0x80 is a non ascii map key", input: map[string]any{"\x80": int64(1)}, want: ErrNonASCIIKey},
		{name: "invalid utf8 map key", input: map[string]any{"\xff": int64(1)}, want: ErrNonASCIIKey},
		{name: "non ascii key nested in object", input: map[string]any{"a": map[string]any{"ñ": int64(1)}}, want: ErrNonASCIIKey},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := EncodeValidatedValue(tt.input)
			if tt.want == nil {
				if err != nil {
					t.Fatalf("EncodeValidatedValue() error = %v, want nil", err)
				}
				if len(got) == 0 {
					t.Fatal("EncodeValidatedValue() = empty bytes, want canonical bytes")
				}
				return
			}
			if !errors.Is(err, tt.want) {
				t.Fatalf("EncodeValidatedValue() error = %v, want %v", err, tt.want)
			}
			if got != nil {
				t.Fatalf("EncodeValidatedValue() bytes = %q, want nil", got)
			}
		})
	}
}

func TestEncodeValidatedValue_AcceptsTechnicalBoundaries(t *testing.T) {
	t.Run("scalar at depth 128", func(t *testing.T) {
		got, err := EncodeValidatedValue(nestedArray(128, int64(1)))
		if err != nil {
			t.Fatalf("EncodeValidatedValue() error = %v, want nil", err)
		}
		want := strings.Repeat("[", 127) + "1" + strings.Repeat("]", 127)
		if string(got) != want {
			t.Fatalf("EncodeValidatedValue() = %q, want literal depth-128 nesting", got)
		}
	})

	t.Run("empty container at depth 128", func(t *testing.T) {
		got, err := EncodeValidatedValue(nestedArray(128, []any{}))
		if err != nil {
			t.Fatalf("EncodeValidatedValue() error = %v, want nil", err)
		}
		want := strings.Repeat("[", 128) + strings.Repeat("]", 128)
		if string(got) != want {
			t.Fatalf("EncodeValidatedValue() = %q, want literal depth-128 nesting", got)
		}
	})

	t.Run("131072 value occurrences", func(t *testing.T) {
		// One array occurrence plus 131071 null occurrences.
		got, err := EncodeValidatedValue(nilSliceOf(131071))
		if err != nil {
			t.Fatalf("EncodeValidatedValue() error = %v, want nil", err)
		}
		if count := bytes.Count(got, []byte("null")); count != 131071 {
			t.Fatalf("encoded null occurrences = %d, want 131071", count)
		}
	})

	t.Run("map keys do not count as value occurrences", func(t *testing.T) {
		// One object occurrence plus 131071 null values is exactly 131072
		// values; the 131071 keys are excluded from the visit count.
		got, err := EncodeValidatedValue(objectWithNilValues(131071))
		if err != nil {
			t.Fatalf("EncodeValidatedValue() error = %v, want nil", err)
		}
		if len(got) == 0 {
			t.Fatal("EncodeValidatedValue() = empty bytes, want canonical bytes")
		}
	})
}

func TestEncodeValidatedValue_RejectsTechnicalBoundaryExcess(t *testing.T) {
	tests := []struct {
		name  string
		input any
		want  error
	}{
		{name: "scalar at depth 129", input: nestedArray(129, int64(1)), want: ErrDepthLimit},
		{name: "empty container at depth 129", input: nestedArray(129, []any{}), want: ErrDepthLimit},
		{name: "object key at depth 129", input: nestedArray(128, map[string]any{"a": nil}), want: ErrDepthLimit},
		{
			name:  "wide container at depth 128 fails on depth before child fanout",
			input: nestedArray(128, nilSliceOf(200000)),
			want:  ErrDepthLimit,
		},
		{name: "131073 value occurrences", input: nilSliceOf(131072), want: ErrValueLimit},
		{name: "131073 value occurrences via map values", input: objectWithNilValues(131072), want: ErrValueLimit},
		{
			name:  "wide root container fails on count before child fanout",
			input: nilSliceOf(200000),
			want:  ErrValueLimit,
		},
		{
			name:  "wide nested container fails on count before child fanout",
			input: []any{nilSliceOf(200000)},
			want:  ErrValueLimit,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := EncodeValidatedValue(tt.input)
			if !errors.Is(err, tt.want) {
				t.Fatalf("EncodeValidatedValue() error = %v, want %v", err, tt.want)
			}
			if got != nil {
				t.Fatalf("EncodeValidatedValue() bytes = %q, want nil", got)
			}
		})
	}
}

func TestEncodeValidatedValue_TerminatesOnCycles(t *testing.T) {
	t.Run("self referential map", func(t *testing.T) {
		cycle := map[string]any{}
		cycle["self"] = cycle
		got, err := EncodeValidatedValue(cycle)
		if !errors.Is(err, ErrDepthLimit) {
			t.Fatalf("error = %v, want %v", err, ErrDepthLimit)
		}
		if got != nil {
			t.Fatalf("bytes = %q, want nil", got)
		}
	})

	t.Run("self referential slice", func(t *testing.T) {
		cycle := []any{nil}
		cycle[0] = cycle
		got, err := EncodeValidatedValue(cycle)
		if !errors.Is(err, ErrDepthLimit) {
			t.Fatalf("error = %v, want %v", err, ErrDepthLimit)
		}
		if got != nil {
			t.Fatalf("bytes = %q, want nil", got)
		}
	})

	t.Run("mutually referential maps", func(t *testing.T) {
		first := map[string]any{}
		second := map[string]any{"first": first}
		first["second"] = second
		got, err := EncodeValidatedValue(first)
		if !errors.Is(err, ErrDepthLimit) {
			t.Fatalf("error = %v, want %v", err, ErrDepthLimit)
		}
		if got != nil {
			t.Fatalf("bytes = %q, want nil", got)
		}
	})

	t.Run("cycle reachable through an array", func(t *testing.T) {
		cycle := map[string]any{}
		cycle["list"] = []any{cycle}
		got, err := EncodeValidatedValue(cycle)
		if !errors.Is(err, ErrDepthLimit) {
			t.Fatalf("error = %v, want %v", err, ErrDepthLimit)
		}
		if got != nil {
			t.Fatalf("bytes = %q, want nil", got)
		}
	})
}

func TestEncodeValidatedValue_CountsRepeatedReferencesPerOccurrence(t *testing.T) {
	shared := nilSliceOf(65535)

	t.Run("single occurrence is within the value budget", func(t *testing.T) {
		if _, err := EncodeValidatedValue([]any{shared}); err != nil {
			t.Fatalf("EncodeValidatedValue() error = %v, want nil", err)
		}
	})

	t.Run("second occurrence exceeds the value budget", func(t *testing.T) {
		// 1 root + (1 array + 65535 nulls) + (1 array + 65535 nulls) = 131073
		// values, so repeated references must be counted per occurrence
		// instead of being deduplicated by identity.
		got, err := EncodeValidatedValue([]any{shared, shared})
		if !errors.Is(err, ErrValueLimit) {
			t.Fatalf("error = %v, want %v", err, ErrValueLimit)
		}
		if got != nil {
			t.Fatalf("bytes = %q, want nil", got)
		}
	})

	t.Run("repeated reference is encoded once per occurrence", func(t *testing.T) {
		value := map[string]any{"kind": "shared"}
		got, err := EncodeValidatedValue([]any{value, value})
		if err != nil {
			t.Fatalf("EncodeValidatedValue() error = %v, want nil", err)
		}
		want := `[{"kind":"shared"},{"kind":"shared"}]`
		if string(got) != want {
			t.Fatalf("EncodeValidatedValue() = %q, want literal %q", got, want)
		}
	})
}

func TestEncodeValidatedValue_DoesNotMutateInput(t *testing.T) {
	input := map[string]any{
		"array":  []any{int64(1), "two", nil},
		"nested": map[string]any{"flag": true, "empty": []any{}},
		"float":  "not a float",
		"null":   nil,
	}
	snapshot := cloneValidatedValue(input)

	if _, err := EncodeValidatedValue(input); err != nil {
		t.Fatalf("EncodeValidatedValue() error = %v, want nil", err)
	}
	if !reflect.DeepEqual(input, snapshot) {
		t.Fatalf("input was mutated:\n got %#v\nwant %#v", input, snapshot)
	}
}

// fixtureDocument is the on-disk shape of testdata/go-json-v1.json. The
// document is decoded with UseNumber so that every fixture number arrives as
// a json.Number and is converted through a bounded strconv.ParseInt.
type fixtureDocument struct {
	FixtureID     string        `json:"fixtureId"`
	SchemaVersion int           `json:"schemaVersion"`
	Producer      string        `json:"producer"`
	Notes         []string      `json:"notes"`
	Cases         []fixtureCase `json:"cases"`
}

type fixtureCase struct {
	Name               string `json:"name"`
	Unit               string `json:"unit"`
	Input              any    `json:"input"`
	ExpectedUTF8       string `json:"expectedUtf8"`
	ExpectedHex        string `json:"expectedHex"`
	ExpectedByteLength int    `json:"expectedByteLength"`
	ExpectedSHA256     string `json:"expectedSha256"`
	ExpectedError      string `json:"expectedError"`
}

func TestEncodeValidatedValue_Fixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "go-json-v1.json"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()

	var doc fixtureDocument
	if err := decoder.Decode(&doc); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if doc.FixtureID != "go-json-v1" {
		t.Fatalf("fixtureId = %q, want %q", doc.FixtureID, "go-json-v1")
	}
	if doc.SchemaVersion != 1 {
		t.Fatalf("schemaVersion = %d, want 1", doc.SchemaVersion)
	}

	units := map[string]int{}
	for _, tc := range doc.Cases {
		units[tc.Unit]++
	}
	if units["encoder-unit"] == 0 {
		t.Fatal("fixture has no encoder-unit cases")
	}
	if units["rich-shaped"] == 0 {
		t.Fatal("fixture has no rich-shaped cases")
	}

	t.Run("fixture inputs convert to exact whitelisted types", func(t *testing.T) {
		byName := map[string]any{}
		for _, tc := range doc.Cases {
			byName[tc.Name] = fixtureInputValue(t, tc.Input)
		}
		if byName["null_scalar"] != nil {
			t.Fatalf("null_scalar decoded to %T(%v), want untyped nil", byName["null_scalar"], byName["null_scalar"])
		}
		got, ok := byName["int64_max"].(int64)
		if !ok {
			t.Fatalf("int64_max decoded to %T, want int64 (no float64 from the loader)", byName["int64_max"])
		}
		if got != 9223372036854775807 {
			t.Fatalf("int64_max = %d, want 9223372036854775807", got)
		}
	})

	for _, tc := range doc.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			value := fixtureInputValue(t, tc.Input)
			assertWhitelistedFixtureTypes(t, value)

			got, err := EncodeValidatedValue(value)

			if tc.ExpectedError != "" {
				wantErr := fixtureErrorSentinel(t, tc.ExpectedError)
				if !errors.Is(err, wantErr) {
					t.Fatalf("error = %v, want %v", err, wantErr)
				}
				if got != nil {
					t.Fatalf("bytes = %q, want nil", got)
				}
				return
			}

			if err != nil {
				t.Fatalf("EncodeValidatedValue() error = %v, want nil", err)
			}

			wantBytes := []byte(tc.ExpectedUTF8)
			if !bytes.Equal(got, wantBytes) {
				t.Fatalf("bytes = %q, want literal %q", got, wantBytes)
			}
			if gotHex := hex.EncodeToString(got); gotHex != tc.ExpectedHex {
				t.Fatalf("output hex = %s, want literal %s", gotHex, tc.ExpectedHex)
			}
			if len(got) != tc.ExpectedByteLength {
				t.Fatalf("byte length = %d, want literal %d", len(got), tc.ExpectedByteLength)
			}
			if gotSum := sha256Hex(got); gotSum != tc.ExpectedSHA256 {
				t.Fatalf("sha256 = %s, want literal %s", gotSum, tc.ExpectedSHA256)
			}

			// Fixture integrity: the authored literals must agree with each
			// other. This detects a hand-edited or silently regenerated
			// fixture and never rewrites testdata.
			fixtureHex, err := hex.DecodeString(tc.ExpectedHex)
			if err != nil {
				t.Fatalf("fixture expectedHex %q is invalid: %v", tc.ExpectedHex, err)
			}
			if !bytes.Equal(fixtureHex, wantBytes) {
				t.Fatalf("fixture expectedHex %s does not match expectedUtf8 %q", tc.ExpectedHex, tc.ExpectedUTF8)
			}
			if len(wantBytes) != tc.ExpectedByteLength {
				t.Fatalf("fixture expectedByteLength %d does not match expectedUtf8 length %d", tc.ExpectedByteLength, len(wantBytes))
			}
			if wantSum := sha256Hex(wantBytes); wantSum != tc.ExpectedSHA256 {
				t.Fatalf("fixture expectedSha256 %s does not match expectedUtf8 sha256 %s", tc.ExpectedSHA256, wantSum)
			}
		})
	}
}

// fixtureInputValue converts the decoded fixture input into the exact
// whitelisted value types. Only numbers are transformed, through a bounded
// strconv.ParseInt, so the loader can never produce a float64.
func fixtureInputValue(t *testing.T, value any) any {
	t.Helper()

	switch typed := value.(type) {
	case map[string]any:
		converted := make(map[string]any, len(typed))
		for key, child := range typed {
			converted[key] = fixtureInputValue(t, child)
		}
		return converted
	case []any:
		converted := make([]any, len(typed))
		for i, child := range typed {
			converted[i] = fixtureInputValue(t, child)
		}
		return converted
	case json.Number:
		parsed, err := strconv.ParseInt(string(typed), 10, 64)
		if err != nil {
			t.Fatalf("fixture number %q is not an exact int64: %v", typed, err)
		}
		return parsed
	default:
		return value
	}
}

func assertWhitelistedFixtureTypes(t *testing.T, value any) {
	t.Helper()

	switch typed := value.(type) {
	case nil, bool, int64, string:
		return
	case map[string]any:
		for _, child := range typed {
			assertWhitelistedFixtureTypes(t, child)
		}
	case []any:
		for _, child := range typed {
			assertWhitelistedFixtureTypes(t, child)
		}
	default:
		t.Fatalf("fixture value has non-whitelisted type %T", value)
	}
}

func fixtureErrorSentinel(t *testing.T, name string) error {
	t.Helper()

	switch name {
	case "ErrUnsupportedType":
		return ErrUnsupportedType
	case "ErrTypedNil":
		return ErrTypedNil
	case "ErrInvalidUTF8":
		return ErrInvalidUTF8
	case "ErrNonASCIIKey":
		return ErrNonASCIIKey
	case "ErrDepthLimit":
		return ErrDepthLimit
	case "ErrValueLimit":
		return ErrValueLimit
	default:
		t.Fatalf("fixture declares unknown error %q", name)
		return nil
	}
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func nestedArray(depth int, leaf any) any {
	value := leaf
	for i := 1; i < depth; i++ {
		value = []any{value}
	}
	return value
}

func nilSliceOf(length int) []any {
	return make([]any, length)
}

func objectWithNilValues(keys int) map[string]any {
	object := make(map[string]any, keys)
	for i := 0; i < keys; i++ {
		object["k"+strconv.Itoa(i)] = nil
	}
	return object
}

func cloneValidatedValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		clone := make(map[string]any, len(typed))
		for key, child := range typed {
			clone[key] = cloneValidatedValue(child)
		}
		return clone
	case []any:
		clone := make([]any, len(typed))
		for i, child := range typed {
			clone[i] = cloneValidatedValue(child)
		}
		return clone
	default:
		return value
	}
}

// namedMap, namedSlice, namedString, namedInt64 and namedBool are distinct
// named types. They must be rejected because the whitelist is exact: only
// map[string]any, []any, string, int64, bool and nil are accepted. Go aliases
// (which are the same type, not a distinct one) are not distinguishable and
// are intentionally not represented here.
type (
	namedMap    map[string]any
	namedSlice  []any
	namedString string
	namedInt64  int64
	namedBool   bool
)

// customMarshaler implements json.Marshaler. The encoder must reject it
// without calling MarshalJSON.
type customMarshaler struct {
	called *bool
}

func (c customMarshaler) MarshalJSON() ([]byte, error) {
	if c.called != nil {
		*c.called = true
	}
	return []byte(`"custom"`), nil
}
