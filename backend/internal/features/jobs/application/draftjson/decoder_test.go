package draftjson

import (
	"bytes"
	"errors"
	"math"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

// The decode expectations below were authored before Decode was implemented.
// They describe the exact dynamic type set, the UTF-8/surrogate precheck and
// the technical depth/value limits of the raw JSON decoder. They are not a
// rich draft grammar and they do not exercise the canonical encoder.

func TestDecode_AcceptsExactRootTypes(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  any
	}{
		{name: "null root", input: `null`, want: nil},
		{name: "true root", input: `true`, want: true},
		{name: "false root", input: `false`, want: false},
		{name: "empty string root", input: `""`, want: ""},
		{name: "string root", input: `"hello"`, want: "hello"},
		{name: "escape equivalent value", input: `"\u0041"`, want: "A"},
		{name: "escaped backslash is literal text", input: `"\\u0041"`, want: `\u0041`},
		{name: "int64 root", input: `42`, want: int64(42)},
		{name: "negative int64 root", input: `-7`, want: int64(-7)},
		{name: "empty array root", input: `[]`, want: []any{}},
		{name: "empty object root", input: `{}`, want: map[string]any{}},
		{
			name:  "mixed object",
			input: `{"a":1,"b":[true,null,"x"],"c":{},"d":[]}`,
			want: map[string]any{
				"a": int64(1),
				"b": []any{true, nil, "x"},
				"c": map[string]any{},
				"d": []any{},
			},
		},
		{
			name:  "mixed array",
			input: `[1,"two",false,null,{},[]]`,
			want:  []any{int64(1), "two", false, nil, map[string]any{}, []any{}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Decode([]byte(tt.input))
			if err != nil {
				t.Fatalf("Decode(%q) error = %v, want nil", tt.input, err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("Decode(%q) = %#v, want %#v", tt.input, got, tt.want)
			}
		})
	}
}

func TestDecode_ReturnsOnlyExactDynamicTypes(t *testing.T) {
	got, err := Decode([]byte(`{"n":1,"s":"x","b":true,"z":null,"a":[],"o":{}}`))
	if err != nil {
		t.Fatalf("Decode() error = %v, want nil", err)
	}
	object, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("Decode() = %T, want map[string]any", got)
	}
	if _, ok := object["n"].(int64); !ok {
		t.Fatalf("object[\"n\"] = %T, want int64", object["n"])
	}
	if _, ok := object["s"].(string); !ok {
		t.Fatalf("object[\"s\"] = %T, want string", object["s"])
	}
	if _, ok := object["b"].(bool); !ok {
		t.Fatalf("object[\"b\"] = %T, want bool", object["b"])
	}
	if object["z"] != nil {
		t.Fatalf("object[\"z\"] = %#v, want nil", object["z"])
	}
	array, ok := object["a"].([]any)
	if !ok || array == nil {
		t.Fatalf("object[\"a\"] = %#v, want non-nil []any", object["a"])
	}
	nested, ok := object["o"].(map[string]any)
	if !ok || nested == nil {
		t.Fatalf("object[\"o\"] = %#v, want non-nil map[string]any", object["o"])
	}
}

func TestDecode_ExactIntegerNumberTokens(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  int64
	}{
		{name: "zero", input: `0`, want: 0},
		{name: "negative zero", input: `-0`, want: 0},
		{name: "one", input: `1`, want: 1},
		{name: "negative one", input: `-1`, want: -1},
		{name: "decimal one", input: `1.0`, want: 1},
		{name: "exponent one", input: `1e0`, want: 1},
		{name: "uppercase exponent", input: `1E0`, want: 1},
		{name: "hundred e minus two", input: `100e-2`, want: 1},
		{name: "trailing zeros cancelled", input: `123000e-3`, want: 123},
		{name: "max int64", input: `9223372036854775807`, want: math.MaxInt64},
		{name: "min int64", input: `-9223372036854775808`, want: math.MinInt64},
		{name: "max int64 fraction cancelled", input: `9223372036854775807.0`, want: math.MaxInt64},
		{name: "negative zero huge exponent", input: `-0e999999999999999999999999`, want: 0},
		{name: "negative zero decimal huge negative exponent", input: `-0.0e-999999999999999999999999`, want: 0},
		{name: "zero mantissa huge exponent", input: `0e999999999999999999999999`, want: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Decode([]byte(tt.input))
			if err != nil {
				t.Fatalf("Decode(%q) error = %v, want nil", tt.input, err)
			}
			value, ok := got.(int64)
			if !ok {
				t.Fatalf("Decode(%q) = %T, want int64", tt.input, got)
			}
			if value != tt.want {
				t.Fatalf("Decode(%q) = %d, want %d", tt.input, value, tt.want)
			}
		})
	}
}

func TestDecode_RejectsNonIntegerAndOverflowNumbers(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr error
	}{
		{name: "fraction", input: `1.5`, wantErr: ErrNumberNotInteger},
		{name: "negative fraction", input: `-0.1`, wantErr: ErrNumberNotInteger},
		{name: "fraction exponent", input: `1e-1`, wantErr: ErrNumberNotInteger},
		{name: "overflow positive", input: `9223372036854775808`, wantErr: ErrNumberOverflow},
		{name: "overflow negative", input: `-9223372036854775809`, wantErr: ErrNumberOverflow},
		{name: "overflow exponent", input: `1e19`, wantErr: ErrNumberOverflow},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Decode([]byte(tt.input))
			if !errors.Is(err, ErrInvalidNumber) {
				t.Fatalf("Decode(%q) error = %v, want ErrInvalidNumber", tt.input, err)
			}
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Decode(%q) error = %v, want wrapped %v", tt.input, err, tt.wantErr)
			}
			if got != nil {
				t.Fatalf("Decode(%q) = %#v, want nil output", tt.input, got)
			}
		})
	}
}

func TestDecode_StringSurrogateAndUTF8Precheck(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr error
	}{
		{name: "paired surrogate emoji", input: `"\uD83D\uDE00"`, want: "\U0001F600"},
		{name: "lowercase paired surrogate", input: `"\ud83d\ude00"`, want: "\U0001F600"},
		{name: "escape ufffd", input: `"\uFFFD"`, want: "\uFFFD"},
		{name: "genuine ufffd bytes", input: "\"\uFFFD\"", want: "\uFFFD"},
		{name: "escaped backslash then surrogate text", input: `"\\uD800"`, want: `\uD800`},
		{name: "escaped backslash then pair text", input: `"\\uD83D\\uDE00"`, want: `\uD83D\uDE00`},
		{name: "lone high surrogate", input: `"\uD800"`, wantErr: ErrInvalidSurrogate},
		{name: "lone low surrogate", input: `"\uDE00"`, wantErr: ErrInvalidSurrogate},
		{name: "reversed surrogate pair", input: `"\uDE00\uD83D"`, wantErr: ErrInvalidSurrogate},
		{name: "two high surrogates", input: `"\uD83D\uD83D"`, wantErr: ErrInvalidSurrogate},
		{name: "high surrogate then escaped backslash", input: `"\uD83D\\uDE00"`, wantErr: ErrInvalidSurrogate},
		{name: "high surrogate then plain text", input: `"\uD83Dx"`, wantErr: ErrInvalidSurrogate},
		{name: "lone high surrogate in object key", input: `{"\uD800":1}`, wantErr: ErrInvalidSurrogate},
		{name: "lone low surrogate in nested array", input: `[[["\uDE00"]]]`, wantErr: ErrInvalidSurrogate},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Decode([]byte(tt.input))
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("Decode(%q) error = %v, want %v", tt.input, err, tt.wantErr)
				}
				if got != nil {
					t.Fatalf("Decode(%q) = %#v, want nil output", tt.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("Decode(%q) error = %v, want nil", tt.input, err)
			}
			if got != tt.want {
				t.Fatalf("Decode(%q) = %#v, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestDecode_RejectsInvalidUTF8(t *testing.T) {
	tests := []struct {
		name  string
		input []byte
	}{
		{name: "lone continuation byte in string", input: []byte{'"', 0x80, '"'}},
		{name: "truncated sequence in string", input: []byte{'"', 0xC3, '"'}},
		{name: "surrogate encoded as cesu8", input: []byte{'"', 0xED, 0xA0, 0x80, '"'}},
		{name: "overlong encoding", input: []byte{'"', 0xC0, 0xAF, '"'}},
		{name: "invalid byte in object key", input: []byte{'{', '"', 0xFF, '"', ':', '1', '}'}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Decode(tt.input)
			if !errors.Is(err, ErrInvalidUTF8) {
				t.Fatalf("Decode(%v) error = %v, want ErrInvalidUTF8", tt.input, err)
			}
			if got != nil {
				t.Fatalf("Decode(%v) = %#v, want nil output", tt.input, got)
			}
		})
	}
}

func TestDecode_RejectsDuplicateKeys(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{name: "literal duplicate", input: `{"a":1,"a":2}`},
		{name: "literal and escape duplicate", input: `{"a":1,"\u0061":2}`},
		{name: "duplicate after previous null", input: `{"a":null,"a":1}`},
		{name: "duplicate with same null value", input: `{"a":null,"a":null}`},
		{name: "duplicate nested object", input: `{"outer":{"x":1,"x":2}}`},
		{name: "duplicate with different value types", input: `{"a":[1],"a":"x"}`},
		{name: "duplicate non ascii key", input: `{"é":1,"\u00e9":2}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Decode([]byte(tt.input))
			if !errors.Is(err, ErrDuplicateKey) {
				t.Fatalf("Decode(%q) error = %v, want ErrDuplicateKey", tt.input, err)
			}
			if got != nil {
				t.Fatalf("Decode(%q) = %#v, want nil output", tt.input, got)
			}
		})
	}
}

func TestDecode_DistinctKeysAreAllowed(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  map[string]any
	}{
		{
			name:  "same key in distinct objects",
			input: `{"a":{"k":1},"b":{"k":2}}`,
			want: map[string]any{
				"a": map[string]any{"k": int64(1)},
				"b": map[string]any{"k": int64(2)},
			},
		},
		{
			name:  "combining distinct from precomposed",
			input: `{"é":1,"e\u0301":2}`,
			want: map[string]any{
				"\u00e9":  int64(1),
				"e\u0301": int64(2),
			},
		},
		{
			name:  "non ascii keys preserved without nfc",
			input: `{"café":1,"日本":2,"\u00e9":3}`,
			want: map[string]any{
				"café":   int64(1),
				"日本":     int64(2),
				"\u00e9": int64(3),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Decode([]byte(tt.input))
			if err != nil {
				t.Fatalf("Decode(%q) error = %v, want nil", tt.input, err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("Decode(%q) = %#v, want %#v", tt.input, got, tt.want)
			}
		})
	}
}

func TestDecode_RequiresExactlyOneRootAndEOF(t *testing.T) {
	accepted := []struct {
		name  string
		input string
	}{
		{name: "trailing spaces", input: "{} "},
		{name: "trailing newline", input: "[]\n"},
		{name: "leading and trailing whitespace", input: "\t true \n "},
		{name: "trailing whitespace after scalar", input: "42  "},
	}

	for _, tt := range accepted {
		t.Run("accept/"+tt.name, func(t *testing.T) {
			if _, err := Decode([]byte(tt.input)); err != nil {
				t.Fatalf("Decode(%q) error = %v, want nil", tt.input, err)
			}
		})
	}

	rejected := []struct {
		name  string
		input string
	}{
		{name: "empty input", input: ``},
		{name: "whitespace only", input: " \t\n"},
		{name: "leading bom", input: "\uFEFF{}"},
		{name: "second object root", input: `{}{}`},
		{name: "second scalar root", input: `1 2`},
		{name: "trailing garbage", input: `{} x`},
		{name: "trailing comma object", input: `{"a":1,}`},
		{name: "trailing comma array", input: `[1,]`},
		{name: "second root after whitespace", input: "null\n[]"},
	}

	for _, tt := range rejected {
		t.Run("reject/"+tt.name, func(t *testing.T) {
			got, err := Decode([]byte(tt.input))
			if !errors.Is(err, ErrSyntax) {
				t.Fatalf("Decode(%q) error = %v, want ErrSyntax", tt.input, err)
			}
			if got != nil {
				t.Fatalf("Decode(%q) = %#v, want nil output", tt.input, got)
			}
		})
	}
}

func TestDecode_RejectsMalformedInput(t *testing.T) {
	inputs := []string{
		`{`,
		`[`,
		`[1,`,
		`{"a":}`,
		`{"a" 1}`,
		`[1 2]`,
		`{"a":1,}`,
		`[1,]`,
		`tru`,
		`nul`,
		`fals`,
		`+1`,
		`.5`,
		`1.`,
		`01`,
		`--1`,
		`1e`,
		`1e+`,
		`"unterminated`,
		`{'a':1}`,
		`[1;2]`,
		`NaN`,
		`Infinity`,
		`undefined`,
		`{"a":1}}`,
		`[,1]`,
		`{"a"::1}`,
	}

	for _, input := range inputs {
		t.Run(input, func(t *testing.T) {
			got, err := Decode([]byte(input))
			if !errors.Is(err, ErrSyntax) {
				t.Fatalf("Decode(%q) error = %v, want ErrSyntax", input, err)
			}
			if got != nil {
				t.Fatalf("Decode(%q) = %#v, want nil output", input, got)
			}
		})
	}
}

func TestDecode_DepthBoundary(t *testing.T) {
	accepted := []struct {
		name  string
		input []byte
	}{
		{name: "128 nested arrays", input: nestedArrayJSON(128)},
		{name: "null scalar at depth 128", input: nestedScalarJSON(127, "null")},
		{name: "true scalar at depth 128", input: nestedScalarJSON(127, "true")},
		{name: "string scalar at depth 128", input: nestedScalarJSON(127, `"x"`)},
		{name: "object at depth 128", input: nestedScalarJSON(127, `{}`)},
	}

	for _, tt := range accepted {
		t.Run("accept/"+tt.name, func(t *testing.T) {
			if _, err := Decode(tt.input); err != nil {
				t.Fatalf("Decode() error = %v, want nil", err)
			}
		})
	}

	rejected := []struct {
		name  string
		input []byte
	}{
		{name: "129 nested arrays", input: nestedArrayJSON(129)},
		{name: "null scalar at depth 129", input: nestedScalarJSON(128, "null")},
		{name: "object at depth 129", input: nestedScalarJSON(128, `{}`)},
	}

	for _, tt := range rejected {
		t.Run("reject/"+tt.name, func(t *testing.T) {
			got, err := Decode(tt.input)
			if !errors.Is(err, ErrDepthLimit) {
				t.Fatalf("Decode() error = %v, want ErrDepthLimit", err)
			}
			if got != nil {
				t.Fatalf("Decode() = %#v, want nil output", got)
			}
		})
	}
}

func TestDecode_ValueOccurrenceBoundary(t *testing.T) {
	accepted := []struct {
		name  string
		input []byte
	}{
		{
			name:  "array with 131071 nulls is 131072 values",
			input: nullArrayJSON(131071),
		},
		{
			name:  "object with 131071 null values excludes its keys",
			input: nullObjectJSON(131071),
		},
	}

	for _, tt := range accepted {
		t.Run("accept/"+tt.name, func(t *testing.T) {
			if _, err := Decode(tt.input); err != nil {
				t.Fatalf("Decode() error = %v, want nil", err)
			}
		})
	}

	rejected := []struct {
		name  string
		input []byte
	}{
		{
			name:  "array with 131072 nulls is 131073 values",
			input: nullArrayJSON(131072),
		},
		{
			name:  "object with 131072 null values is 131073 values",
			input: nullObjectJSON(131072),
		},
	}

	for _, tt := range rejected {
		t.Run("reject/"+tt.name, func(t *testing.T) {
			got, err := Decode(tt.input)
			if !errors.Is(err, ErrValueLimit) {
				t.Fatalf("Decode() error = %v, want ErrValueLimit", err)
			}
			if got != nil {
				t.Fatalf("Decode() = %#v, want nil output", got)
			}
		})
	}
}

func TestDecode_ErrorReturnsNilAndPreservesInput(t *testing.T) {
	inputs := [][]byte{
		[]byte(`{"a":1,"a":2}`),
		[]byte(`{"a":1`),
		[]byte(`[1.5]`),
		[]byte(`{"\uD800":1}`),
		[]byte(`{"a":1,}`),
		{'"', 0xFF, '"'},
	}

	for _, input := range inputs {
		t.Run(string(input), func(t *testing.T) {
			original := append([]byte(nil), input...)
			got, err := Decode(input)
			if err == nil {
				t.Fatalf("Decode(%q) error = nil, want rejection", input)
			}
			if got != nil {
				t.Fatalf("Decode(%q) = %#v, want nil output", input, got)
			}
			if !bytes.Equal(input, original) {
				t.Fatalf("Decode(%q) mutated input to %q", original, input)
			}
		})
	}
}

func TestDecode_SuccessDoesNotMutateInput(t *testing.T) {
	input := []byte(`{"a":[1,2,3],"b":"done","c":null}`)
	original := append([]byte(nil), input...)
	if _, err := Decode(input); err != nil {
		t.Fatalf("Decode() error = %v, want nil", err)
	}
	if !bytes.Equal(input, original) {
		t.Fatalf("Decode() mutated input to %q", input)
	}
}

func TestDecode_TriangulatesEscapeAndNestingEdges(t *testing.T) {
	t.Run("surrogate pair boundaries accepted", func(t *testing.T) {
		tests := []struct {
			input string
			want  string
		}{
			{input: `"\uD800\uDC00"`, want: "\U00010000"},
			{input: `"\uDBFF\uDFFF"`, want: "\U0010FFFF"},
			{input: `"\udbff\udfff"`, want: "\U0010FFFF"},
		}
		for _, tt := range tests {
			got, err := Decode([]byte(tt.input))
			if err != nil {
				t.Fatalf("Decode(%q) error = %v, want nil", tt.input, err)
			}
			if got != tt.want {
				t.Fatalf("Decode(%q) = %#v, want %q", tt.input, got, tt.want)
			}
		}
	})

	t.Run("adjacent non surrogate escapes accepted", func(t *testing.T) {
		tests := []struct {
			input string
			want  string
		}{
			{input: `"\uD7FF"`, want: "\uD7FF"},
			{input: `"\uE000"`, want: "\uE000"},
			{input: `"\u0000"`, want: "\x00"},
		}
		for _, tt := range tests {
			got, err := Decode([]byte(tt.input))
			if err != nil {
				t.Fatalf("Decode(%q) error = %v, want nil", tt.input, err)
			}
			if got != tt.want {
				t.Fatalf("Decode(%q) = %#v, want %q", tt.input, got, tt.want)
			}
		}
	})

	t.Run("pair versus escaped backslash text in one array", func(t *testing.T) {
		got, err := Decode([]byte(`["\uD83D\uDE00","\\uD83D\\uDE00"]`))
		if err != nil {
			t.Fatalf("Decode() error = %v, want nil", err)
		}
		want := []any{"\U0001F600", `\uD83D\uDE00`}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("Decode() = %#v, want %#v", got, want)
		}
	})

	t.Run("duplicate key with previous container value", func(t *testing.T) {
		got, err := Decode([]byte(`{"a":[1],"a":{"b":2}}`))
		if !errors.Is(err, ErrDuplicateKey) {
			t.Fatalf("Decode() error = %v, want ErrDuplicateKey", err)
		}
		if got != nil {
			t.Fatalf("Decode() = %#v, want nil output", got)
		}
	})

	t.Run("object frames at depth 128 accepted", func(t *testing.T) {
		if _, err := Decode(nestedObjectJSON(127)); err != nil {
			t.Fatalf("Decode(127 objects + null) error = %v, want nil", err)
		}
	})

	t.Run("object frames at depth 129 rejected", func(t *testing.T) {
		got, err := Decode(nestedObjectJSON(128))
		if !errors.Is(err, ErrDepthLimit) {
			t.Fatalf("Decode(128 objects + null) error = %v, want ErrDepthLimit", err)
		}
		if got != nil {
			t.Fatalf("Decode() = %#v, want nil output", got)
		}
	})
}

func nestedArrayJSON(depth int) []byte {
	return []byte(strings.Repeat("[", depth) + strings.Repeat("]", depth))
}

func nestedScalarJSON(depth int, scalar string) []byte {
	return []byte(strings.Repeat("[", depth) + scalar + strings.Repeat("]", depth))
}

func nullArrayJSON(elements int) []byte {
	var builder strings.Builder
	builder.Grow(2 + elements*5)
	builder.WriteByte('[')
	for i := 0; i < elements; i++ {
		if i > 0 {
			builder.WriteByte(',')
		}
		builder.WriteString("null")
	}
	builder.WriteByte(']')
	return []byte(builder.String())
}

func nestedObjectJSON(depth int) []byte {
	var builder strings.Builder
	builder.Grow(depth*7 + 6)
	for i := 0; i < depth; i++ {
		builder.WriteString(`{"k":`)
	}
	builder.WriteString("null")
	for i := 0; i < depth; i++ {
		builder.WriteByte('}')
	}
	return []byte(builder.String())
}

func nullObjectJSON(keys int) []byte {
	var builder strings.Builder
	builder.Grow(2 + keys*12)
	builder.WriteByte('{')
	for i := 0; i < keys; i++ {
		if i > 0 {
			builder.WriteByte(',')
		}
		builder.WriteString(`"k`)
		builder.WriteString(strconv.Itoa(i))
		builder.WriteString(`":null`)
	}
	builder.WriteByte('}')
	return []byte(builder.String())
}
