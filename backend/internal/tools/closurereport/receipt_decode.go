// Package closurereport — BC-01: strict gate-receipt JSON decoder.
//
// DecodeReceipt performs strict structural validation of gate-producer JSON
// receipts. It enforces the exact producer schema: all 13 top-level fields
// must be present and correctly typed, unknown fields are rejected, duplicate
// keys at any level are rejected, and non-integer or out-of-range integer
// representations are rejected. The returned UnvalidatedReceipt carries no
// trusted semantics — BC-02 validates identity/consistency and BC-03 binds
// the decoder to Generate.
//
// All string, array, count, and hash values are preserved accurately from the
// decoded JSON. Semantic validation (git identity format, count relationships,
// GO eligibility) belongs to BC-02.
package closurereport

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
)

// UnvalidatedReceipt is the raw gate-producer receipt with all 13 top-level
// fields decoded.  No semantic validation is performed: exit_code may be
// negative, counts may be inconsistent, and commit/tree may be "git:unavailable".
// BC-02 validates identity, integrity, and eligibility.
type UnvalidatedReceipt struct {
	Gate      string
	Status    string
	Tool      string
	Command   string
	Commit    string
	Tree      string
	StartedAt string
	EndedAt   string
	ExitCode  int

	TestCounts struct {
		Ok          int
		Fail        int
		NoTestFiles int
	}

	SkipNames []string

	ArtifactHashes struct {
		WorktreeState    string
		ReceiptIntegrity string
	}

	Failure string
}

// errMissingField is returned when a required field is absent.
func errMissingField(field string) error {
	return fmt.Errorf("missing required field: %s", field)
}

// errDuplicateField is returned when a field appears more than once at any level.
func errDuplicateField(field string) error {
	return fmt.Errorf("duplicate field: %s", field)
}

// errUnknownField is returned when a field not in the producer schema is present.
func errUnknownField(field string) error {
	return fmt.Errorf("unknown field: %s", field)
}

// errWrongType is returned when a field's JSON value type does not match the schema.
func errWrongType(field string, got, want string) error {
	return fmt.Errorf("field %s: wrong type %s, want %s", field, got, want)
}

// errInvalidInteger is returned when an integer field uses a non-integer JSON
// representation (float, exponent, or out-of-range value).
func errInvalidInteger(field string) error {
	return fmt.Errorf("field %s: invalid integer representation", field)
}

// DecodeReceipt parses and strictly validates a gate-producer JSON receipt.
// It returns an UnvalidatedReceipt on success or a descriptive error on any
// structural violation: missing fields, unknown fields, null values, wrong
// types, duplicate keys, non-integer integer representations, or malformed JSON.
// DecodeReceipt accepts normal JSON whitespace and key-order variation.
func DecodeReceipt(raw []byte) (UnvalidatedReceipt, error) {
	var zero UnvalidatedReceipt
	if len(raw) == 0 {
		return zero, errors.New("input is empty")
	}

	// Detect duplicate keys (including escaped-equivalent) before unmarshaling.
	// json.Unmarshal silently overwrites duplicate keys, so we must scan the
	// token stream with json.Decoder to compare decoded string keys.
	// UseNumber avoids float conversion for integer values during duplicate check.
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := checkDuplicateKeys(dec); err != nil {
		return zero, err
	}

	// Decode top-level into a map.
	var topLevel map[string]json.RawMessage
	if err := json.Unmarshal(raw, &topLevel); err != nil {
		return zero, fmt.Errorf("malformed JSON: %w", err)
	}

	// Check all required fields are present.
	for _, f := range requiredTopFields {
		if _, ok := topLevel[f]; !ok {
			return zero, errMissingField(f)
		}
		if string(topLevel[f]) == "null" {
			return zero, fmt.Errorf("field %s: must not be null", f)
		}
	}

	// Reject unknown top-level fields.
	for k := range topLevel {
		if !isKnownTopField(k) {
			return zero, errUnknownField(k)
		}
	}

	// Build the result, validating each field.
	var r UnvalidatedReceipt

	// gate (string)
	{
		var s string
		if err := json.Unmarshal(topLevel["gate"], &s); err != nil {
			return zero, errWrongType("gate", jsonType(topLevel["gate"]), "string")
		}
		r.Gate = s
	}

	// status (string)
	{
		var s string
		if err := json.Unmarshal(topLevel["status"], &s); err != nil {
			return zero, errWrongType("status", jsonType(topLevel["status"]), "string")
		}
		r.Status = s
	}

	// tool (string)
	{
		var s string
		if err := json.Unmarshal(topLevel["tool"], &s); err != nil {
			return zero, errWrongType("tool", jsonType(topLevel["tool"]), "string")
		}
		r.Tool = s
	}

	// command (string)
	{
		var s string
		if err := json.Unmarshal(topLevel["command"], &s); err != nil {
			return zero, errWrongType("command", jsonType(topLevel["command"]), "string")
		}
		r.Command = s
	}

	// commit (string)
	{
		var s string
		if err := json.Unmarshal(topLevel["commit"], &s); err != nil {
			return zero, errWrongType("commit", jsonType(topLevel["commit"]), "string")
		}
		r.Commit = s
	}

	// tree (string)
	{
		var s string
		if err := json.Unmarshal(topLevel["tree"], &s); err != nil {
			return zero, errWrongType("tree", jsonType(topLevel["tree"]), "string")
		}
		r.Tree = s
	}

	// started_at (string)
	{
		var s string
		if err := json.Unmarshal(topLevel["started_at"], &s); err != nil {
			return zero, errWrongType("started_at", jsonType(topLevel["started_at"]), "string")
		}
		r.StartedAt = s
	}

	// ended_at (string)
	{
		var s string
		if err := json.Unmarshal(topLevel["ended_at"], &s); err != nil {
			return zero, errWrongType("ended_at", jsonType(topLevel["ended_at"]), "string")
		}
		r.EndedAt = s
	}

	// exit_code (int, must be integer literal)
	{
		n, err := decodeStrictInt("exit_code", topLevel["exit_code"])
		if err != nil {
			return zero, err
		}
		r.ExitCode = n
	}

	// test_counts (object)
	{
		var tcMap map[string]json.RawMessage
		if err := json.Unmarshal(topLevel["test_counts"], &tcMap); err != nil {
			return zero, errWrongType("test_counts", jsonType(topLevel["test_counts"]), "object")
		}
		// Check required sub-fields present and not null.
		for _, f := range requiredTestCountsFields {
			if _, ok := tcMap[f]; !ok {
				return zero, errMissingField("test_counts." + f)
			}
			if string(tcMap[f]) == "null" {
				return zero, fmt.Errorf("field test_counts.%s: must not be null", f)
			}
		}
		// Reject unknown sub-fields.
		for k := range tcMap {
			if !isKnownTestCountsField(k) {
				return zero, errUnknownField("test_counts." + k)
			}
		}
		var err error
		r.TestCounts.Ok, err = decodeStrictInt("test_counts.ok", tcMap["ok"])
		if err != nil {
			return zero, err
		}
		r.TestCounts.Fail, err = decodeStrictInt("test_counts.fail", tcMap["fail"])
		if err != nil {
			return zero, err
		}
		r.TestCounts.NoTestFiles, err = decodeStrictInt("test_counts.no_test_files", tcMap["no_test_files"])
		if err != nil {
			return zero, err
		}
	}

	// skip_names (array of strings; null elements and non-strings are rejected)
	{
		rawArr := topLevel["skip_names"]
		if string(rawArr) == "null" {
			return zero, errWrongType("skip_names", "null", "array")
		}
		// Validate array element by element without silently coercing null to "".
		// First, verify the top-level value is a JSON array.
		if len(rawArr) < 2 || rawArr[0] != '[' || rawArr[len(rawArr)-1] != ']' {
			// Attempt full unmarshal to let json package reject non-array types.
			var arr []string
			if err := json.Unmarshal(rawArr, &arr); err != nil {
				return zero, errWrongType("skip_names", jsonType(rawArr), "array")
			}
			r.SkipNames = arr
		} else {
			// Raw array with brackets detected; decode each element strictly.
			arr, err := decodeStrictStringArray(rawArr)
			if err != nil {
				return zero, err
			}
			r.SkipNames = arr
		}
	}

	// artifact_hashes (object)
	{
		var ahMap map[string]json.RawMessage
		if err := json.Unmarshal(topLevel["artifact_hashes"], &ahMap); err != nil {
			return zero, errWrongType("artifact_hashes", jsonType(topLevel["artifact_hashes"]), "object")
		}
		// Check required sub-fields present and not null.
		for _, f := range requiredArtifactHashesFields {
			if _, ok := ahMap[f]; !ok {
				return zero, errMissingField("artifact_hashes." + f)
			}
			if string(ahMap[f]) == "null" {
				return zero, fmt.Errorf("field artifact_hashes.%s: must not be null", f)
			}
		}
		// Reject unknown sub-fields.
		for k := range ahMap {
			if !isKnownArtifactHashesField(k) {
				return zero, errUnknownField("artifact_hashes." + k)
			}
		}
		var s string
		if err := json.Unmarshal(ahMap["worktree_state"], &s); err != nil {
			return zero, errWrongType("artifact_hashes.worktree_state", jsonType(ahMap["worktree_state"]), "string")
		}
		r.ArtifactHashes.WorktreeState = s
		if err := json.Unmarshal(ahMap["receipt_integrity"], &s); err != nil {
			return zero, errWrongType("artifact_hashes.receipt_integrity", jsonType(ahMap["receipt_integrity"]), "string")
		}
		r.ArtifactHashes.ReceiptIntegrity = s
	}

	// failure (string)
	{
		var s string
		if err := json.Unmarshal(topLevel["failure"], &s); err != nil {
			return zero, errWrongType("failure", jsonType(topLevel["failure"]), "string")
		}
		r.Failure = s
	}

	return r, nil
}

// requiredTopFields is the ordered list of all required top-level fields.
var requiredTopFields = []string{
	"gate", "status", "tool", "command", "commit", "tree",
	"started_at", "ended_at", "exit_code", "test_counts",
	"skip_names", "artifact_hashes", "failure",
}

// isKnownTopField reports whether name is a known top-level field.
func isKnownTopField(name string) bool {
	for _, f := range requiredTopFields {
		if f == name {
			return true
		}
	}
	return false
}

// isKnownTestCountsField reports whether name is a known test_counts sub-field.
func isKnownTestCountsField(name string) bool {
	for _, f := range requiredTestCountsFields {
		if f == name {
			return true
		}
	}
	return false
}

// isKnownArtifactHashesField reports whether name is a known artifact_hashes sub-field.
func isKnownArtifactHashesField(name string) bool {
	for _, f := range requiredArtifactHashesFields {
		if f == name {
			return true
		}
	}
	return false
}

// requiredTestCountsFields lists every required field inside test_counts.
var requiredTestCountsFields = []string{"ok", "fail", "no_test_files"}

// requiredArtifactHashesFields lists every required field inside artifact_hashes.
var requiredArtifactHashesFields = []string{"worktree_state", "receipt_integrity"}

// decodeStrictInt decodes a raw JSON message as an int, rejecting
// float/exponent representations and out-of-range values.
// The raw JSON representation is verified to be a decimal integer literal.
func decodeStrictInt(name string, raw json.RawMessage) (int, error) {
	var n json.Number
	if err := json.Unmarshal(raw, &n); err != nil {
		return 0, errWrongType(name, jsonType(raw), "int")
	}
	// Verify the raw JSON is a decimal integer literal: optional leading '-',
	// followed by one or more digits 0-9. Reject floats (1.0), exponents (1e0),
	// and values outside int range.
	s := string(raw)
	s = trimJSONWhitespace(s)
	if !isDecimalIntegerLiteral(s) {
		return 0, errInvalidInteger(name)
	}
	i, err := n.Int64()
	if err != nil {
		return 0, errInvalidInteger(name)
	}
	// Verify the value fits in int.
	if i != int64(int(i)) {
		return 0, errInvalidInteger(name)
	}
	return int(i), nil
}

// isDecimalIntegerLiteral reports whether s is a valid JSON decimal integer
// literal: optional leading '-', then one or more ASCII decimal digits (0–9).
// It returns false for floats (1.0), exponents (1e3), hex (0x1), leading
// zeros (01), or empty strings.
func isDecimalIntegerLiteral(s string) bool {
	if len(s) == 0 {
		return false
	}
	i := 0
	// Optional leading minus.
	if i < len(s) && s[i] == '-' {
		i++
	}
	if i >= len(s) {
		return false
	}
	// Must have at least one digit.
	if s[i] < '0' || s[i] > '9' {
		return false
	}
	firstDigit := i
	i++
	// Remaining characters must all be digits; no leading zeros allowed unless
	// the entire number is exactly "0" or "-0".
	for i < len(s) {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
		// Reject leading zeros (e.g., "01", "-01").
		if i == firstDigit+1 && s[firstDigit] == '0' && s[i] != '0' {
			return false
		}
		i++
	}
	// Reject numbers that start with '0' followed by another digit.
	if len(s) > 1 {
		neg := s[0] == '-'
		start := 0
		if neg {
			start = 1
		}
		if s[start] == '0' && len(s) > start+1 && s[start+1] >= '0' && s[start+1] <= '9' {
			return false
		}
	}
	return true
}

// trimJSONWhitespace trims JSON whitespace from both ends of a string.
// JSON whitespace is space (0x20), tab (0x09), newline (0x0A), or CR (0x0D).
func trimJSONWhitespace(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t' || s[0] == '\n' || s[0] == '\r') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t' || s[len(s)-1] == '\n' || s[len(s)-1] == '\r') {
		s = s[:len(s)-1]
	}
	return s
}

// jsonType returns a human-readable type label for a JSON raw message.
func jsonType(raw json.RawMessage) string {
	s := trimJSONWhitespace(string(raw))
	if len(s) == 0 {
		return "null"
	}
	switch s[0] {
	case '{':
		return "object"
	case '[':
		return "array"
	case '"':
		return "string"
	case 't', 'f':
		if len(s) >= 4 {
			if s[:4] == "true" || s[:5] == "false" {
				return "bool"
			}
		}
		return "unknown"
	case 'n':
		if len(s) >= 4 && s[:4] == "null" {
			return "null"
		}
		return "unknown"
	}
	// Could be a number.
	if (s[0] >= '0' && s[0] <= '9') || s[0] == '-' {
		return "number"
	}
	return "unknown"
}

// checkDuplicateKeys walks the JSON token stream using json.Decoder.Token(),
// which returns decoded string keys (Unicode escapes resolved). It tracks
// seen keys at each nesting depth; finding a decoded key twice at the same
// depth returns an error. The dec must have UseNumber set.
func checkDuplicateKeys(dec *json.Decoder) error {
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil // io.EOF means complete valid JSON
		}
		if tok == nil {
			return nil // nil without error is also EOF
		}

		delim, ok := tok.(json.Delim)
		if !ok {
			// Non-delimiter at top level: a bare scalar or array root.
			// No keys to duplicate-check; validate JSON completeness via
			// json.Unmarshal later.
			return nil
		}

		switch delim {
		case '{':
			if err := checkObjectKeys(dec); err != nil {
				return err
			}
		case '[':
			if err := skipArray(dec); err != nil {
				return err
			}
		}
	}
}

// checkObjectKeys consumes all members of the current JSON object using
// decoded string keys, rejecting any duplicate at this depth.
// The opening '{' has already been consumed by the caller.
func checkObjectKeys(dec *json.Decoder) error {
	seen := make(map[string]bool)

	for {
		// More() is only valid within an open object scope.
		// After consuming a value (including nested object braces), the scope
		// is still open for the parent object. If More() returns false,
		// we consume the closing '}' and return.
		if !dec.More() {
			_, err := dec.Token() // consume '}'
			if err != nil {
				return fmt.Errorf("malformed JSON: %w", err)
			}
			return nil
		}

		keyTok, err := dec.Token()
		if err != nil {
			return fmt.Errorf("malformed JSON: %w", err)
		}
		key, ok := keyTok.(string)
		if !ok {
			return fmt.Errorf("malformed JSON: expected string key, got %T", keyTok)
		}
		if seen[key] {
			return errDuplicateField(key)
		}
		seen[key] = true

		valTok, err := dec.Token()
		if err != nil {
			return fmt.Errorf("malformed JSON: %w", err)
		}
		// Recurse into nested objects immediately.
		if d, ok := valTok.(json.Delim); ok {
			switch d {
			case '{':
				if err := checkObjectKeys(dec); err != nil {
					return err
				}
			case '[':
				if err := skipArray(dec); err != nil {
					return err
				}
			}
		}
		// Primitive values and nested structures consumed; continue loop.
	}
}

// skipValue consumes all tokens for a JSON value that starts with opening.
// opening is either '{' or '[' (already consumed by the caller).
func skipValue(dec *json.Decoder, _ json.Delim) error {
	for {
		if !dec.More() {
			_, err := dec.Token() // consume closing delimiter
			if err != nil {
				return fmt.Errorf("malformed JSON: %w", err)
			}
			return nil
		}
		tok, err := dec.Token()
		if err != nil {
			return fmt.Errorf("malformed JSON: %w", err)
		}
		if d, ok := tok.(json.Delim); ok {
			if err := skipValue(dec, d); err != nil {
				return err
			}
		}
	}
}

// skipArray consumes all elements of the current JSON array.
// The opening '[' has already been consumed by the caller.
func skipArray(dec *json.Decoder) error {
	for {
		if !dec.More() {
			_, err := dec.Token() // consume ']'
			if err != nil {
				return fmt.Errorf("malformed JSON: %w", err)
			}
			return nil
		}

		tok, err := dec.Token()
		if err != nil {
			return fmt.Errorf("malformed JSON: %w", err)
		}
		if d, ok := tok.(json.Delim); ok {
			switch d {
			case '{':
				if err := checkObjectKeys(dec); err != nil {
					return err
				}
			case '[':
				if err := skipArray(dec); err != nil {
					return err
				}
			}
		}
	}
}

// decodeStrictStringArray decodes a JSON array from raw as a []string,
// rejecting any null or non-string element. Empty arrays and arrays
// containing empty strings are accepted; only null/non-string elements are rejected.
func decodeStrictStringArray(raw json.RawMessage) ([]string, error) {
	// Wrap in a json.Decoder to use Token() for per-element inspection.
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()

	// Consume the opening '['.
	tok, err := dec.Token()
	if err != nil {
		return nil, fmt.Errorf("skip_names: malformed array: %w", err)
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '[' {
		return nil, errWrongType("skip_names", jsonType(raw), "array")
	}

	var result []string
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, fmt.Errorf("skip_names: malformed element: %w", err)
		}

		// Handle nested objects/arrays by skipping them.
		if d, ok := tok.(json.Delim); ok {
			if err := skipValue(dec, d); err != nil {
				return nil, fmt.Errorf("skip_names: %w", err)
			}
			return nil, errWrongType("skip_names element", "object or array", "string")
		}

		// tok should be a string, number, boolean, or null.
		switch v := tok.(type) {
		case string:
			result = append(result, v)
		case nil:
			return nil, fmt.Errorf("skip_names: element at index %d is null, want string", len(result))
		case json.Number:
			return nil, errWrongType(fmt.Sprintf("skip_names element at index %d", len(result)), "number", "string")
		default:
			return nil, errWrongType(fmt.Sprintf("skip_names element at index %d", len(result)), "bool", "string")
		}
	}

	// Consume the closing ']'.
	if _, err := dec.Token(); err != nil {
		return nil, fmt.Errorf("skip_names: malformed array: %w", err)
	}

	return result, nil
}
