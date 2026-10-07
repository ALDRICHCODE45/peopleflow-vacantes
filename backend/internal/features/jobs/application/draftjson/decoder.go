package draftjson

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"unicode/utf8"
)

// Decoder-level sentinels. Depth and value limits reuse the shared
// ErrDepthLimit and ErrValueLimit so the decoder and the canonical encoder
// cannot drift apart on the technical boundary values.
var (
	// ErrSyntax rejects a byte stream that is not exactly one well-formed
	// RFC 8259 JSON value, including a truncated value, a second root and
	// trailing non-whitespace data.
	ErrSyntax = errors.New("draftjson: malformed raw JSON")
	// ErrDuplicateKey rejects a second occurrence of a key within one JSON
	// object, compared after escape decoding and independent of the value
	// stored for the first occurrence.
	ErrDuplicateKey = errors.New("draftjson: duplicate object key")
	// ErrInvalidSurrogate rejects a string containing a UTF-16 surrogate
	// escape that is not part of a well-formed high-then-low pair.
	ErrInvalidSurrogate = errors.New("draftjson: invalid surrogate escape")
	// ErrInvalidNumber rejects a syntactically valid JSON number that is not
	// an exact int64. It always wraps ErrNumberNotInteger or ErrNumberOverflow.
	ErrInvalidNumber = errors.New("draftjson: number is not an exact int64")
)

// Decode converts one raw JSON document into the exact dynamic type set:
// map[string]any, []any, string, int64, bool and nil. Empty arrays and empty
// objects are non-nil.
//
// The document must be exactly one RFC 8259 value followed only by JSON
// whitespace. Every rejection returns a nil value and an error; a partial tree
// is never returned and the input bytes are never mutated.
//
// The decoder is strict where encoding/json is lossy or lenient:
//
//   - Raw input bytes are validated as UTF-8 and strings are scanned for
//     UTF-16 surrogate escapes before the standard library can replace them.
//     A lone or reversed surrogate escape is rejected with ErrInvalidSurrogate
//     and invalid UTF-8 with ErrInvalidUTF8. A literal U+FFFD, a surrogate
//     encoded as an escaped backslash plus text (for example "\\uD800"), and a
//     well-formed high-then-low pair are all accepted.
//   - JSON numbers are classified with ParseExactInt64 in the same pass that
//     builds the tree. Integral spellings such as 1, 1.0 and 100e-2 become
//     int64; a fraction wraps ErrNumberNotInteger and an int64 overflow wraps
//     ErrNumberOverflow, both wrapped by ErrInvalidNumber. No float64 is ever
//     produced.
//   - A key repeated within one object is rejected with ErrDuplicateKey,
//     compared after escape decoding and including a previous null value.
//     The same key in distinct objects is allowed. Keys are preserved exactly,
//     without Unicode normalization.
//
// Two technical limits apply to the whole document, matching the canonical
// encoder: the root value is depth 1 and no value may exceed an inclusive
// depth of 128, and no more than an inclusive 131072 value occurrences may be
// visited, with object keys excluded. A container counts once and each scalar,
// array, object and null counts once. Both limits are checked before a value
// is attached to its parent and before a child container is allocated, so an
// oversized document is rejected before it can fan out. These are internal
// defensive limits, not a rich draft grammar or an HTTP body budget.
//
// Work is O(len(data)) and memory is proportional to the input plus the
// bounded number of accepted containers.
func Decode(data []byte) (any, error) {
	if !utf8.Valid(data) {
		return nil, ErrInvalidUTF8
	}
	// json.Valid rejects empty input, malformed structure, trailing commas, a
	// second root and trailing garbage, all of which encoding/json's Token
	// stream is lenient about. It does not validate UTF-8 or surrogate
	// pairing, which the two checks around it cover.
	if !json.Valid(data) {
		return nil, ErrSyntax
	}
	if err := validateSurrogateEscapes(data); err != nil {
		return nil, err
	}

	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()

	var (
		root        any
		rootSet     bool
		stack       []*decodeFrame
		occurrences int
	)

	for {
		token, err := decoder.Token()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil, ErrSyntax
			}
			return nil, fmt.Errorf("%w: %v", ErrSyntax, err)
		}

		switch typed := token.(type) {
		case json.Delim:
			switch typed {
			case '{':
				if err := accountValue(&occurrences, len(stack)+1); err != nil {
					return nil, err
				}
				stack = append(stack, &decodeFrame{
					isObject:  true,
					object:    map[string]any{},
					expectKey: true,
				})
			case '[':
				if err := accountValue(&occurrences, len(stack)+1); err != nil {
					return nil, err
				}
				stack = append(stack, &decodeFrame{array: []any{}})
			case '}':
				if len(stack) == 0 || !stack[len(stack)-1].isObject {
					return nil, ErrSyntax
				}
				frame := popFrame(&stack)
				if err := attachValue(&root, &rootSet, stack, frame.object); err != nil {
					return nil, err
				}
			case ']':
				if len(stack) == 0 || stack[len(stack)-1].isObject {
					return nil, ErrSyntax
				}
				frame := popFrame(&stack)
				if err := attachValue(&root, &rootSet, stack, frame.array); err != nil {
					return nil, err
				}
			default:
				return nil, ErrSyntax
			}
		case string:
			if top := topFrame(stack); top != nil && top.isObject && top.expectKey {
				if _, duplicate := top.object[typed]; duplicate {
					return nil, ErrDuplicateKey
				}
				top.key = typed
				top.expectKey = false
				break
			}
			value, err := stringValue(typed)
			if err != nil {
				return nil, err
			}
			if err := accountValue(&occurrences, len(stack)+1); err != nil {
				return nil, err
			}
			if err := attachValue(&root, &rootSet, stack, value); err != nil {
				return nil, err
			}
		case json.Number:
			value, err := ParseExactInt64(typed.String())
			if err != nil {
				return nil, classifyNumberError(err)
			}
			if err := accountValue(&occurrences, len(stack)+1); err != nil {
				return nil, err
			}
			if err := attachValue(&root, &rootSet, stack, value); err != nil {
				return nil, err
			}
		case bool:
			if err := accountValue(&occurrences, len(stack)+1); err != nil {
				return nil, err
			}
			if err := attachValue(&root, &rootSet, stack, typed); err != nil {
				return nil, err
			}
		case nil:
			if err := accountValue(&occurrences, len(stack)+1); err != nil {
				return nil, err
			}
			if err := attachValue(&root, &rootSet, stack, nil); err != nil {
				return nil, err
			}
		default:
			return nil, ErrSyntax
		}

		if rootSet && len(stack) == 0 {
			return finishRoot(decoder, root)
		}
	}
}

// decodeFrame is one container being built by the iterative Token walk.
//
// An array is accumulated in array and only attached to its parent once it is
// closed, because appending to a slice header copies the header and would not
// propagate to a parent that already stored it. An object is a reference type
// and behaves the same either way; it is attached on close too, for symmetry.
type decodeFrame struct {
	isObject  bool
	object    map[string]any
	array     []any
	key       string
	expectKey bool
}

func topFrame(stack []*decodeFrame) *decodeFrame {
	if len(stack) == 0 {
		return nil
	}
	return stack[len(stack)-1]
}

func popFrame(stack *[]*decodeFrame) *decodeFrame {
	frames := *stack
	frame := frames[len(frames)-1]
	*stack = frames[:len(frames)-1]
	return frame
}

// accountValue applies both technical limits to one value occurrence before
// the caller attaches it or allocates a child container. Object keys are not
// values and never reach this function.
func accountValue(occurrences *int, depth int) error {
	if depth > maxValidatedDepth {
		return fmt.Errorf("%w: depth %d", ErrDepthLimit, depth)
	}
	*occurrences = *occurrences + 1
	if *occurrences > maxValidatedValues {
		return fmt.Errorf("%w: %d values", ErrValueLimit, *occurrences)
	}
	return nil
}

// attachValue stores a completed value in its parent container or as the root.
// Attaching to an object completes the pending key, so the next string token
// is a new key again.
func attachValue(root *any, rootSet *bool, stack []*decodeFrame, value any) error {
	parent := topFrame(stack)
	if parent == nil {
		if *rootSet {
			return ErrSyntax
		}
		*root = value
		*rootSet = true
		return nil
	}
	if parent.isObject {
		if parent.expectKey {
			return ErrSyntax
		}
		parent.object[parent.key] = value
		parent.expectKey = true
		return nil
	}
	parent.array = append(parent.array, value)
	return nil
}

// finishRoot enforces that the root value is followed only by JSON whitespace.
// The json.Valid precheck already guarantees this; the explicit EOF read keeps
// the guarantee local to the walk and returns ErrSyntax if it is ever violated.
func finishRoot(decoder *json.Decoder, root any) (any, error) {
	if _, err := decoder.Token(); err != nil {
		if errors.Is(err, io.EOF) {
			return root, nil
		}
		return nil, fmt.Errorf("%w: %v", ErrSyntax, err)
	}
	return nil, ErrSyntax
}

// stringValue returns a decoded string token unchanged. It exists so the
// strict checks that guarantee no replacement has happened stay visible at the
// point where a string value is produced.
func stringValue(value string) (string, error) {
	if !utf8.ValidString(value) {
		return "", ErrInvalidUTF8
	}
	return value, nil
}

// classifyNumberError maps a ParseExactInt64 result onto the decoder contract.
func classifyNumberError(err error) error {
	if errors.Is(err, ErrNumberSyntax) {
		return fmt.Errorf("%w: %w", ErrSyntax, err)
	}
	return fmt.Errorf("%w: %w", ErrInvalidNumber, err)
}

// validateSurrogateEscapes scans every JSON string literal and rejects a
// UTF-16 surrogate \u escape that is not part of a well-formed high-then-low
// pair. The scan is escape-aware: a backslash escapes the next byte, so the
// literal text produced by "\\uD800" is not mistaken for a surrogate escape.
// It deliberately ignores structural validity, which json.Valid owns.
func validateSurrogateEscapes(data []byte) error {
	for i := 0; i < len(data); i++ {
		if data[i] != '"' {
			continue
		}
		next, err := scanStringLiteral(data, i)
		if err != nil {
			return err
		}
		i = next - 1
	}
	return nil
}

// scanStringLiteral walks one string literal starting at the opening quote and
// returns the index just past its closing quote, or len(data) when the literal
// is unterminated. It rejects invalid surrogate escapes and leaves every other
// malformed escape to json.Valid.
func scanStringLiteral(data []byte, start int) (int, error) {
	i := start + 1
	for i < len(data) {
		switch data[i] {
		case '"':
			return i + 1, nil
		case '\\':
			if i+1 >= len(data) {
				return len(data), nil
			}
			if data[i+1] != 'u' {
				i += 2
				continue
			}
			if i+6 > len(data) || !isHexQuad(data[i+2:i+6]) {
				i += 2
				continue
			}
			code := hexQuad(data[i+2 : i+6])
			if isHighSurrogate(code) {
				if i+12 <= len(data) && data[i+6] == '\\' && data[i+7] == 'u' && isHexQuad(data[i+8:i+12]) {
					if isLowSurrogate(hexQuad(data[i+8 : i+12])) {
						i += 12
						continue
					}
				}
				return 0, ErrInvalidSurrogate
			}
			if isLowSurrogate(code) {
				return 0, ErrInvalidSurrogate
			}
			i += 6
		default:
			i++
		}
	}
	return len(data), nil
}

// isHexQuad reports whether b is exactly four ASCII hexadecimal digits.
func isHexQuad(b []byte) bool {
	for _, c := range b {
		if !isHexDigit(c) {
			return false
		}
	}
	return true
}

func isHexDigit(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

// hexQuad decodes four ASCII hexadecimal digits. The caller guarantees width.
func hexQuad(b []byte) rune {
	var value rune
	for _, c := range b {
		value = value*16 + rune(hexDigitValue(c))
	}
	return value
}

func hexDigitValue(c byte) byte {
	switch {
	case c >= '0' && c <= '9':
		return c - '0'
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10
	default:
		return c - 'A' + 10
	}
}

func isHighSurrogate(code rune) bool {
	return code >= 0xD800 && code <= 0xDBFF
}

func isLowSurrogate(code rune) bool {
	return code >= 0xDC00 && code <= 0xDFFF
}
