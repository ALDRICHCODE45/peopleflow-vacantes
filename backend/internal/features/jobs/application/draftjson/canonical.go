// Package draftjson encodes an already validated and normalized private
// vacancy draft value into canonical go-json-v1 bytes.
//
// Scope: this package is only the canonical byte producer. It does not decode
// raw JSON, does not validate a rich draft grammar, does not apply a request
// body budget and does not compute a DTO fingerprint. Callers must hand in a
// value that already passed domain validation and normalization; the encoder
// only re-checks the mechanical preconditions it needs to stay total.
package draftjson

import (
	"encoding/json"
	"errors"
	"fmt"
	"unicode/utf8"
)

const (
	// maxValidatedDepth is the inclusive nesting depth of the prewalk, with
	// the root value at depth 1. It is an internal defensive limit, not a
	// rich draft grammar limit and not an HTTP body limit.
	maxValidatedDepth = 128
	// maxValidatedValues is the inclusive number of visited JSON value
	// occurrences, map keys excluded. It is an internal defensive limit, not
	// a rich draft grammar limit and not an HTTP body limit.
	maxValidatedValues = 131072
)

var (
	// ErrUnsupportedType rejects any dynamic type outside the exact whitelist:
	// map[string]any, []any, string, int64, bool and nil. Distinct named
	// types, floats, json.Number, json.RawMessage and custom marshalers are
	// rejected without invoking any caller method.
	ErrUnsupportedType = errors.New("draftjson: unsupported dynamic type")
	// ErrTypedNil rejects a nil map[string]any or nil []any, which are
	// non-nil interfaces holding a nil container.
	ErrTypedNil = errors.New("draftjson: typed nil map or slice")
	// ErrInvalidUTF8 rejects a string value that is not valid UTF-8.
	ErrInvalidUTF8 = errors.New("draftjson: string is not valid utf-8")
	// ErrNonASCIIKey rejects a map key that is not ASCII.
	ErrNonASCIIKey = errors.New("draftjson: map key must be ascii")
	// ErrDepthLimit rejects a value nested deeper than 128 levels.
	ErrDepthLimit = errors.New("draftjson: nesting exceeds 128 levels")
	// ErrValueLimit rejects more than 131072 visited JSON value occurrences.
	ErrValueLimit = errors.New("draftjson: value occurrences exceed 131072")
)

// EncodeValidatedValue encodes an already validated and normalized value into
// canonical go-json-v1 bytes using default encoding/json.Marshal.
//
// Accepted dynamic types are exactly: nil, bool, int64, valid-UTF-8 string,
// non-nil map[string]any with ASCII keys, and non-nil []any. Everything else
// is rejected, including distinct named types, float64, json.Number,
// json.RawMessage, typed nil containers and custom marshaler implementations
// (whose methods are never invoked). Go aliases are the same type as their
// target and are therefore accepted; named distinct types are not.
//
// Before marshaling, a bounded iterative prewalk rejects values nested deeper
// than 128 levels and values with more than 131072 occurrences. The prewalk
// stops before fanning out an oversized child set, counts repeated references
// per occurrence and terminates on cycles. The input value is never mutated.
func EncodeValidatedValue(value any) ([]byte, error) {
	if err := prewalkValidatedValue(value); err != nil {
		return nil, err
	}
	return json.Marshal(value)
}

// prewalkFrame is one pending JSON value of the iterative prewalk.
//
// The prewalk is iterative on purpose: a bounded explicit stack cannot blow
// the goroutine stack the way unbounded recursive fan-out can, and it lets the
// guard reject an oversized child set before that set is pushed at all.
//
// Every pending frame is a value that will be visited exactly once, so
// len(stack) is part of the occurrence accounting. Repeated references are
// counted once per occurrence because each occurrence pushes its own frame.
// Cycles terminate because the guards only ever allow maxValidatedValues
// frames in flight and maxValidatedDepth levels of nesting.
type prewalkFrame struct {
	value any
	depth int
}

func prewalkValidatedValue(root any) error {
	stack := make([]prewalkFrame, 1, 16)
	stack[0] = prewalkFrame{value: root, depth: 1}
	visited := 0

	for len(stack) > 0 {
		frame := stack[len(stack)-1]
		stack = stack[:len(stack)-1]

		visited++
		if visited > maxValidatedValues {
			return fmt.Errorf("%w: visited %d values", ErrValueLimit, visited)
		}
		if frame.depth > maxValidatedDepth {
			return fmt.Errorf("%w: depth %d", ErrDepthLimit, frame.depth)
		}

		switch value := frame.value.(type) {
		case nil, bool, int64:
			continue
		case string:
			if !utf8.ValidString(value) {
				return fmt.Errorf("%w: string value", ErrInvalidUTF8)
			}
		case map[string]any:
			if value == nil {
				return fmt.Errorf("%w: map[string]any", ErrTypedNil)
			}
			for key := range value {
				if !isASCII(key) {
					return fmt.Errorf("%w: key %q", ErrNonASCIIKey, key)
				}
			}
			if err := guardChildren(len(stack), visited, len(value), frame.depth); err != nil {
				return err
			}
			for _, child := range value {
				stack = append(stack, prewalkFrame{value: child, depth: frame.depth + 1})
			}
		case []any:
			if value == nil {
				return fmt.Errorf("%w: []any", ErrTypedNil)
			}
			if err := guardChildren(len(stack), visited, len(value), frame.depth); err != nil {
				return err
			}
			for _, child := range value {
				stack = append(stack, prewalkFrame{value: child, depth: frame.depth + 1})
			}
		default:
			// Rejecting here, without ever asserting to an encoding/json
			// marshaler interface, is what guarantees that caller MarshalJSON
			// methods are never invoked.
			return fmt.Errorf("%w: %T", ErrUnsupportedType, value)
		}
	}

	return nil
}

// guardChildren enforces both technical limits for a container before its
// children are appended to the stack.
//
// The depth guard runs first so that a container already deep enough to
// overflow is rejected without allocating frames for a potentially huge child
// set. The occurrence guard accounts for the frames that are still pending, so
// the stack can never exceed the remaining value budget even when many wide
// containers are pending at the same time.
func guardChildren(pending, visited, children, depth int) error {
	if children == 0 {
		return nil
	}
	if depth+1 > maxValidatedDepth {
		return fmt.Errorf("%w: child depth %d", ErrDepthLimit, depth+1)
	}
	if total := visited + pending + children; total > maxValidatedValues {
		return fmt.Errorf("%w: %d pending values", ErrValueLimit, total)
	}
	return nil
}

// isASCII reports whether every byte of s is ASCII. ASCII is a subset of valid
// UTF-8, so an ASCII key is always a valid UTF-8 key.
func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= utf8.RuneSelf {
			return false
		}
	}
	return true
}
