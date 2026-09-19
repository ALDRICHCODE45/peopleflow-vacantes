package closurereport

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"testing"
)

func TestReceiptIntegrityOracle(t *testing.T) {
	tests := []struct {
		name             string
		raw              string
		expectedPreimage string
	}{
		{
			name: "whitespace",
			raw: `{
  "gate": "backend",
  "artifact_hashes": { "worktree_state": "abc", "receipt_integrity": "sha256:x" },
  "status": "pass"
}`,
			expectedPreimage: `{"gate":"backend","artifact_hashes":{"worktree_state":"abc"},"status":"pass"}`,
		},
		{
			name:             "genuine top-level key-order change",
			raw:              `{"status":"pass","gate":"backend","artifact_hashes":{"worktree_state":"abc"},"command":"go test"}`,
			expectedPreimage: `{"status":"pass","gate":"backend","artifact_hashes":{"worktree_state":"abc"},"command":"go test"}`,
		},
		{
			name:             "escaped-equivalent artifact_hashes key",
			raw:              `{"\u0061rtifact_hashes":{"worktree_state":"abc"},"gate":"backend"}`,
			expectedPreimage: `{"\u0061rtifact_hashes":{"worktree_state":"abc"},"gate":"backend"}`,
		},
		{
			name:             "artifact_hashes as the final top-level member",
			raw:              `{"gate":"backend","status":"pass","artifact_hashes":{"receipt_integrity":"sha256:x"}}`,
			expectedPreimage: `{"gate":"backend","status":"pass","artifact_hashes":{}}`,
		},
		{
			name:             "an earlier string-value decoy equal to artifact_hashes",
			raw:              `{"note":"artifact_hashes","artifact_hashes":{"worktree_state":"abc"},"gate":"backend"}`,
			expectedPreimage: `{"note":"artifact_hashes","artifact_hashes":{"worktree_state":"abc"},"gate":"backend"}`,
		},
		{
			name:             "receipt_integrity as the leading member",
			raw:              `{"artifact_hashes":{"receipt_integrity":"sha256:x","worktree_state":"abc"},"gate":"backend"}`,
			expectedPreimage: `{"artifact_hashes":{"worktree_state":"abc"},"gate":"backend"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			preimage, digest, err := deriveReceiptIntegrityOracle([]byte(tt.raw))
			if err != nil {
				t.Fatalf("derive receipt integrity oracle: %v", err)
			}
			if got := string(preimage); got != tt.expectedPreimage {
				t.Errorf("preimage = %q, want %q", got, tt.expectedPreimage)
			}

			expectedDigest := fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(tt.expectedPreimage)))
			if digest != expectedDigest {
				t.Errorf("digest = %q, want %q", digest, expectedDigest)
			}
		})
	}
}

func deriveReceiptIntegrityOracle(raw []byte) ([]byte, string, error) {
	if !json.Valid(raw) {
		return nil, "", fmt.Errorf("malformed receipt JSON")
	}

	index := skipJSONWhitespace(raw, 0)
	if index == len(raw) || raw[index] != '{' {
		return nil, "", fmt.Errorf("receipt JSON must be an object")
	}
	index++

	found := false
	targetValueStart, targetValueEnd := 0, 0
	for {
		index = skipJSONWhitespace(raw, index)
		if index == len(raw) {
			return nil, "", fmt.Errorf("unterminated receipt object")
		}
		if raw[index] == '}' {
			index++
			break
		}

		keyEnd, key, err := scanJSONString(raw, index)
		if err != nil {
			return nil, "", fmt.Errorf("read receipt object key: %w", err)
		}
		index = skipJSONWhitespace(raw, keyEnd)
		if index == len(raw) || raw[index] != ':' {
			return nil, "", fmt.Errorf("receipt object key %q has no value", key)
		}

		valueStart := skipJSONWhitespace(raw, index+1)
		valueEnd, err := scanJSONValue(raw, valueStart)
		if err != nil {
			return nil, "", fmt.Errorf("read receipt object value for %q: %w", key, err)
		}
		if key == "artifact_hashes" {
			if found {
				return nil, "", fmt.Errorf("duplicate artifact_hashes key")
			}
			found = true
			targetValueStart, targetValueEnd = valueStart, valueEnd
		}

		index = skipJSONWhitespace(raw, valueEnd)
		if index == len(raw) {
			return nil, "", fmt.Errorf("unterminated receipt object")
		}
		if raw[index] == '}' {
			index++
			break
		}
		if raw[index] != ',' {
			return nil, "", fmt.Errorf("receipt object member separator is invalid")
		}
		index++
	}

	if skipJSONWhitespace(raw, index) != len(raw) {
		return nil, "", fmt.Errorf("trailing receipt JSON data")
	}
	if !found {
		return nil, "", fmt.Errorf("missing artifact_hashes key")
	}

	object := stripReceiptIntegrityMember(raw[targetValueStart:targetValueEnd])
	preimage := append([]byte{}, raw[:targetValueStart]...)
	preimage = append(preimage, object...)
	preimage = append(preimage, raw[targetValueEnd:]...)

	var compact bytes.Buffer
	if err := json.Compact(&compact, preimage); err != nil {
		return nil, "", fmt.Errorf("compact receipt integrity preimage: %w", err)
	}

	digest := sha256.Sum256(compact.Bytes())
	return compact.Bytes(), fmt.Sprintf("sha256:%x", digest), nil
}

func skipJSONWhitespace(raw []byte, index int) int {
	for index < len(raw) {
		switch raw[index] {
		case ' ', '\n', '\r', '\t':
			index++
		default:
			return index
		}
	}
	return index
}

func scanJSONString(raw []byte, index int) (int, string, error) {
	if index == len(raw) || raw[index] != '"' {
		return 0, "", fmt.Errorf("expected JSON string")
	}
	for end := index + 1; end < len(raw); end++ {
		switch raw[end] {
		case '\\':
			end++
		case '"':
			var value string
			if err := json.Unmarshal(raw[index:end+1], &value); err != nil {
				return 0, "", err
			}
			return end + 1, value, nil
		}
	}
	return 0, "", fmt.Errorf("unterminated JSON string")
}

func scanJSONValue(raw []byte, index int) (int, error) {
	if index == len(raw) {
		return 0, fmt.Errorf("missing JSON value")
	}

	switch raw[index] {
	case '"':
		end, _, err := scanJSONString(raw, index)
		return end, err
	case '{':
		index++
		for {
			index = skipJSONWhitespace(raw, index)
			if index == len(raw) {
				return 0, fmt.Errorf("unterminated JSON object")
			}
			if raw[index] == '}' {
				return index + 1, nil
			}
			keyEnd, _, err := scanJSONString(raw, index)
			if err != nil {
				return 0, err
			}
			index = skipJSONWhitespace(raw, keyEnd)
			if index == len(raw) || raw[index] != ':' {
				return 0, fmt.Errorf("JSON object key has no value")
			}
			index, err = scanJSONValue(raw, skipJSONWhitespace(raw, index+1))
			if err != nil {
				return 0, err
			}
			index = skipJSONWhitespace(raw, index)
			if index == len(raw) {
				return 0, fmt.Errorf("unterminated JSON object")
			}
			if raw[index] == '}' {
				return index + 1, nil
			}
			if raw[index] != ',' {
				return 0, fmt.Errorf("JSON object member separator is invalid")
			}
			index++
		}
	case '[':
		index++
		for {
			index = skipJSONWhitespace(raw, index)
			if index == len(raw) {
				return 0, fmt.Errorf("unterminated JSON array")
			}
			if raw[index] == ']' {
				return index + 1, nil
			}
			var err error
			index, err = scanJSONValue(raw, index)
			if err != nil {
				return 0, err
			}
			index = skipJSONWhitespace(raw, index)
			if index == len(raw) {
				return 0, fmt.Errorf("unterminated JSON array")
			}
			if raw[index] == ']' {
				return index + 1, nil
			}
			if raw[index] != ',' {
				return 0, fmt.Errorf("JSON array element separator is invalid")
			}
			index++
		}
	default:
		end := index
		for end < len(raw) {
			switch raw[end] {
			case ' ', '\n', '\r', '\t', ',', '}', ']':
				if end == index {
					return 0, fmt.Errorf("missing JSON value")
				}
				return end, nil
			default:
				end++
			}
		}
		if end == index {
			return 0, fmt.Errorf("missing JSON value")
		}
		return end, nil
	}
}

// stripReceiptIntegrityMember removes only the receipt_integrity member from one
// artifact_hashes fixture object, so every other member (the bound worktree_state)
// stays in the oracle preimage byte-exactly.
func stripReceiptIntegrityMember(object []byte) []byte {
	return regexp.MustCompile(`,\s*"receipt_integrity"\s*:\s*"[^"]*"|"receipt_integrity"\s*:\s*"[^"]*"\s*,?`).ReplaceAll(object, nil)
}

const (
	receiptIntegrityPlaceholder = "sha256:RECEIPT-INTEGRITY-PLACEHOLDER"
	gitUnavailableReason        = "git commit/tree identity unavailable; receipts require a Git HEAD and tree"
)

const validProducerReceipt = `{"gate":"gate-build","status":"pass","tool":"go build ./...","command":"make gate-build","commit":"1111111111111111111111111111111111111111","tree":"2222222222222222222222222222222222222222","started_at":"2026-09-15T23:35:17Z","ended_at":"2026-09-15T23:35:18Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:3333333333333333333333333333333333333333333333333333333333333333","receipt_integrity":"sha256:RECEIPT-INTEGRITY-PLACEHOLDER"},"failure":""}`

type receiptReplacement struct {
	expected    string
	replacement string
}

func TestValidateReceipt_RejectsSemanticViolations(t *testing.T) {
	tests := []struct {
		name string
		raw  func(*testing.T) string
	}{
		{
			name: "status outside pass/fail",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"status":"pass"`, `"status":"unknown"`})
			},
		},
		{
			name: "uppercase PASS status",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"status":"pass"`, `"status":"PASS"`})
			},
		},
		{
			name: "uppercase FAIL status",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"FAIL"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"failure":""`, `"failure":"check failed"`},
				)
			},
		},
		{
			name: "space-prefixed pass status",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"status":"pass"`, `"status":" pass"`})
			},
		},
		{
			name: "exit outside 0/1",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"exit_code":0`, `"exit_code":2`})
			},
		},
		{
			name: "pass with exit 1",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"exit_code":0`, `"exit_code":1`})
			},
		},
		{
			name: "pass with non-empty failure",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"failure":""`, `"failure":"check failed"`})
			},
		},
		{
			name: "pass with positive failed-test count",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"fail":0`, `"fail":1`})
			},
		},
		{
			name: "pass with skip name",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"skip_names":[]`, `"skip_names":["TestSkipped"]`})
			},
		},
		{
			name: "fail with exit 0",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"failure":""`, `"failure":"check failed"`},
				)
			},
		},
		{
			name: "fail with exit 2",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":2`},
					receiptReplacement{`"failure":""`, `"failure":"check failed"`},
				)
			},
		},
		{
			name: "fail with empty failure",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
				)
			},
		},
		{
			name: "negative ok test count",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"ok":0`, `"ok":-1`})
			},
		},
		{
			name: "negative fail test count",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"fail":0`, `"fail":-1`})
			},
		},
		{
			name: "negative no_test_files count",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"no_test_files":0`, `"no_test_files":-1`})
			},
		},
		{
			name: "commit wrong length",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"111111111111111111111111111111111111111"`})
			},
		},
		{
			name: "commit 41 lowercase hex characters",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"11111111111111111111111111111111111111111"`})
			},
		},
		{
			name: "commit lowercase non-hex",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"`})
			},
		},
		{
			name: "commit uppercase hex",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"`})
			},
		},
		{
			name: "tree wrong length",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"222222222222222222222222222222222222222"`})
			},
		},
		{
			name: "tree 41 lowercase hex characters",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"22222222222222222222222222222222222222222"`})
			},
		},
		{
			name: "tree lowercase non-hex",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"`})
			},
		},
		{
			name: "tree uppercase hex",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"`})
			},
		},
		{
			name: "git unavailable on a pass",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"git:unavailable"`},
					receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"git:unavailable"`},
				)
			},
		},
		{
			name: "commit-only git unavailable on a pass",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"git:unavailable"`})
			},
		},
		{
			name: "tree-only git unavailable on a pass",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"git:unavailable"`})
			},
		},
		{
			name: "failure with only commit git unavailable without producer reason",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"git:unavailable"`},
					receiptReplacement{`"failure":""`, `"failure":"different reason"`},
				)
			},
		},
		{
			name: "failure with only tree git unavailable without producer reason",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"git:unavailable"`},
					receiptReplacement{`"failure":""`, `"failure":"different reason"`},
				)
			},
		},
		{
			name: "commit unavailable with invalid tree on failure",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"git:unavailable"`},
					receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"222222222222222222222222222222222222222"`},
					receiptReplacement{`"failure":""`, `"failure":"before; ` + gitUnavailableReason + `; after"`},
				)
			},
		},
		{
			name: "tree unavailable with invalid commit on failure",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"111111111111111111111111111111111111111"`},
					receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"git:unavailable"`},
					receiptReplacement{`"failure":""`, `"failure":"before; ` + gitUnavailableReason + `; after"`},
				)
			},
		},
		{
			name: "uppercase commit git unavailable on failure",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"GIT:UNAVAILABLE"`},
					receiptReplacement{`"failure":""`, `"failure":"before; ` + gitUnavailableReason + `; after"`},
				)
			},
		},
		{
			name: "uppercase tree git unavailable on failure",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"GIT:UNAVAILABLE"`},
					receiptReplacement{`"failure":""`, `"failure":"before; ` + gitUnavailableReason + `; after"`},
				)
			},
		},
		{
			name: "git unavailable failure without producer reason",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"git:unavailable"`},
					receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"git:unavailable"`},
					receiptReplacement{`"failure":""`, `"failure":"different reason"`},
				)
			},
		},
		{
			name: "git unavailable failure with uppercase producer reason",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"git:unavailable"`},
					receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"git:unavailable"`},
					receiptReplacement{`"failure":""`, `"failure":"before; ` + strings.ToUpper(gitUnavailableReason) + `; after"`},
				)
			},
		},
		{
			name: "worktree state wrong length",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`sha256:3333333333333333333333333333333333333333333333333333333333333333`, `sha256:333333333333333333333333333333333333333333333333333333333333333`})
			},
		},
		{
			name: "worktree state lowercase non-hex",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`sha256:3333333333333333333333333333333333333333333333333333333333333333`, `sha256:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz`})
			},
		},
		{
			name: "worktree state uppercase hex",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`sha256:3333333333333333333333333333333333333333333333333333333333333333`, `sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`})
			},
		},
		{
			name: "worktree state uppercase prefix",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`sha256:3333333333333333333333333333333333333333333333333333333333333333`, `SHA256:3333333333333333333333333333333333333333333333333333333333333333`})
			},
		},
		{
			name: "worktree state wrong same-length prefix",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`sha256:3333333333333333333333333333333333333333333333333333333333333333`, `sha999:3333333333333333333333333333333333333333333333333333333333333333`})
			},
		},
		{
			name: "receipt integrity wrong length",
			raw: func(t *testing.T) string {
				return replaceReceiptLiteral(t, validProducerReceipt, receiptIntegrityPlaceholder, `sha256:444444444444444444444444444444444444444444444444444444444444444`)
			},
		},
		{
			name: "receipt integrity lowercase non-hex",
			raw: func(t *testing.T) string {
				return replaceReceiptLiteral(t, validProducerReceipt, receiptIntegrityPlaceholder, `sha256:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz`)
			},
		},
		{
			name: "receipt integrity uppercase hex",
			raw: func(t *testing.T) string {
				return replaceReceiptLiteral(t, validProducerReceipt, receiptIntegrityPlaceholder, `sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)
			},
		},
		{
			name: "receipt integrity wrong same-length prefix",
			raw: func(t *testing.T) string {
				return replaceReceiptLiteral(t, validProducerReceipt, receiptIntegrityPlaceholder, `sha999:4444444444444444444444444444444444444444444444444444444444444444`)
			},
		},
		{
			name: "fractional-second timestamp",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"started_at":"2026-09-15T23:35:17Z"`, `"started_at":"2026-09-15T23:35:17.123Z"`})
			},
		},
		{
			name: "non-UTC offset timestamp",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"started_at":"2026-09-15T23:35:17Z"`, `"started_at":"2026-09-15T23:35:17+01:00"`})
			},
		},
		{
			name: "started at with explicit UTC offset",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"started_at":"2026-09-15T23:35:17Z"`, `"started_at":"2026-09-15T23:35:17+00:00"`})
			},
		},
		{
			name: "started at impossible date",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"started_at":"2026-09-15T23:35:17Z"`, `"started_at":"2026-02-30T23:35:17Z"`})
			},
		},
		{
			name: "malformed timestamp",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"started_at":"2026-09-15T23:35:17Z"`, `"started_at":"not-a-timestamp"`})
			},
		},
		{
			name: "ended at with explicit UTC offset",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"ended_at":"2026-09-15T23:35:18Z"`, `"ended_at":"2026-09-15T23:35:18+00:00"`})
			},
		},
		{
			name: "ended at with fractional seconds",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"ended_at":"2026-09-15T23:35:18Z"`, `"ended_at":"2026-09-15T23:35:18.123Z"`})
			},
		},
		{
			name: "ended at with non-UTC offset",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"ended_at":"2026-09-15T23:35:18Z"`, `"ended_at":"2026-09-15T23:35:18+01:00"`})
			},
		},
		{
			name: "ended at impossible date",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"ended_at":"2026-09-15T23:35:18Z"`, `"ended_at":"2026-09-31T23:35:18Z"`})
			},
		},
		{
			name: "malformed ended at",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"ended_at":"2026-09-15T23:35:18Z"`, `"ended_at":"not-a-timestamp"`})
			},
		},
		{
			name: "ended at before started at",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"ended_at":"2026-09-15T23:35:18Z"`, `"ended_at":"2026-09-15T23:35:16Z"`})
			},
		},
		{
			name: "receipt integrity uppercase hex suffix",
			raw: func(t *testing.T) string {
				sealed, digest := sealReceipt(t, validProducerReceipt)
				upperSuffix := strings.ToUpper(digest[len("sha256:"):])
				if upperSuffix == digest[len("sha256:"):] {
					t.Fatal("sealed digest has no hexadecimal letters to uppercase")
				}
				return replaceReceiptLiteral(t, sealed, digest, "sha256:"+upperSuffix)
			},
		},
		{
			name: "receipt integrity uppercase prefix",
			raw: func(t *testing.T) string {
				sealed, digest := sealReceipt(t, validProducerReceipt)
				return replaceReceiptLiteral(t, sealed, digest, "SHA256:"+digest[len("sha256:"):])
			},
		},
		{
			name: "well-formed incorrect receipt integrity digest",
			raw: func(t *testing.T) string {
				sealed, digest := sealReceipt(t, validProducerReceipt)
				wrong := `sha256:0000000000000000000000000000000000000000000000000000000000000000`
				if digest == wrong {
					t.Fatal("incorrect digest fixture matches the sealed digest")
				}
				return replaceReceiptLiteral(t, sealed, digest, wrong)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := ValidateReceipt([]byte(tt.raw(t))); err == nil {
				t.Fatal("ValidateReceipt accepted a semantic violation")
			}
		})
	}
}

// TestValidateReceipt_RequiresExactProducerGateTriple pins the fail-closed gate
// contract: only the nine required gates, carrying the byte-exact producer
// check_command as tool and the exact `make <gate>` command, are trustworthy.
func TestValidateReceipt_RequiresExactProducerGateTriple(t *testing.T) {
	spoofs := []receiptReplacement{
		{`"gate":"gate-build"`, `"gate":"gate-closure"`},
		{`"tool":"go build ./..."`, `"tool":"go vet ./..."`},
		{`"command":"make gate-build"`, `"command":"make gate-vet"`},
	}
	for _, spoof := range spoofs {
		t.Run(spoof.replacement, func(t *testing.T) {
			if _, err := ValidateReceipt([]byte(receiptWithMutations(t, spoof))); err == nil {
				t.Fatal("ValidateReceipt accepted a spoofed producer gate triple")
			}
		})
	}
}

// TestValidateReceipt_RejectsWorktreeStateTampering pins the integrity binding of
// the worktree_state: replacing it with another well-formed sha256 without
// resealing the receipt is a receipt_integrity mismatch, not a valid receipt.
func TestValidateReceipt_RejectsWorktreeStateTampering(t *testing.T) {
	sealed, _ := sealReceipt(t, validProducerReceipt)
	tampered := replaceReceiptLiteral(t, sealed,
		`"worktree_state":"sha256:3333333333333333333333333333333333333333333333333333333333333333"`,
		`"worktree_state":"sha256:4444444444444444444444444444444444444444444444444444444444444444"`)
	if _, err := ValidateReceipt([]byte(sealed)); err != nil {
		t.Fatalf("untampered sealed receipt must validate: %v", err)
	}
	if _, err := ValidateReceipt([]byte(tampered)); err == nil || err.Error() != "receipt_integrity does not match receipt content" {
		t.Fatalf("tampered worktree_state error = %v, want a receipt_integrity mismatch", err)
	}
}

func TestValidateReceipt_AcceptsValidControls(t *testing.T) {
	tests := []struct {
		name string
		raw  func(*testing.T) string
	}{
		{
			name: "authentic producer-shaped pass",
			raw: func(t *testing.T) string {
				sealed, _ := sealReceipt(t, validProducerReceipt)
				return sealed
			},
		},
		{
			name: "pass with nonzero ok and no_test_files counts",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"ok":0`, `"ok":2`},
					receiptReplacement{`"no_test_files":0`, `"no_test_files":3`},
				)
			},
		},
		{
			name: "ordinary failure with real IDs",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"failure":""`, `"failure":"check failed"`},
				)
			},
		},
		{
			name: "failure with fail count and skip names",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"fail":0`, `"fail":1`},
					receiptReplacement{`"skip_names":[]`, `"skip_names":["TestSkipped"]`},
					receiptReplacement{`"failure":""`, `"failure":"check failed"`},
				)
			},
		},
		{
			name: "git unavailable failure with producer reason substring",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"git:unavailable"`},
					receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"git:unavailable"`},
					receiptReplacement{`"failure":""`, `"failure":"before; git commit/tree identity unavailable; receipts require a Git HEAD and tree; after"`},
				)
			},
		},
		{
			name: "failure with only commit git unavailable",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"git:unavailable"`},
					receiptReplacement{`"failure":""`, `"failure":"before; git commit/tree identity unavailable; receipts require a Git HEAD and tree; after"`},
				)
			},
		},
		{
			name: "failure with only tree git unavailable",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"git:unavailable"`},
					receiptReplacement{`"failure":""`, `"failure":"before; git commit/tree identity unavailable; receipts require a Git HEAD and tree; after"`},
				)
			},
		},
		{
			name: "valid lowercase 64-hex commit and tree",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"commit":"1111111111111111111111111111111111111111"`, `"commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"`},
					receiptReplacement{`"tree":"2222222222222222222222222222222222222222"`, `"tree":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"`},
				)
			},
		},
		{
			name: "equal start and end timestamps",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t, receiptReplacement{`"ended_at":"2026-09-15T23:35:18Z"`, `"ended_at":"2026-09-15T23:35:17Z"`})
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := ValidateReceipt([]byte(tt.raw(t))); err != nil {
				t.Fatalf("ValidateReceipt rejected a valid receipt: %v", err)
			}
		})
	}
}

func TestValidateReceipt_AcceptsRawIntegrityVariants(t *testing.T) {
	tests := []struct {
		name string
		raw  func(*testing.T) string
	}{
		{
			name: "whitespace",
			raw: func(t *testing.T) string {
				return sealRawReceipt(t, `{
  "gate": "gate-build",
  "status": "pass",
  "tool": "go build ./...",
  "command": "make gate-build",
  "commit": "1111111111111111111111111111111111111111",
  "tree": "2222222222222222222222222222222222222222",
  "started_at": "2026-09-15T23:35:17Z",
  "ended_at": "2026-09-15T23:35:18Z",
  "exit_code": 0,
  "test_counts": { "ok": 0, "fail": 0, "no_test_files": 0 },
  "skip_names": [],
  "artifact_hashes": { "worktree_state": "sha256:3333333333333333333333333333333333333333333333333333333333333333", "receipt_integrity": "sha256:RECEIPT-INTEGRITY-PLACEHOLDER" },
  "failure": ""
}`)
			},
		},
		{
			name: "genuine top-level key-order change",
			raw: func(t *testing.T) string {
				return sealRawReceipt(t, `{"status":"pass","gate":"gate-build","tool":"go build ./...","command":"make gate-build","tree":"2222222222222222222222222222222222222222","commit":"1111111111111111111111111111111111111111","ended_at":"2026-09-15T23:35:18Z","started_at":"2026-09-15T23:35:17Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:3333333333333333333333333333333333333333333333333333333333333333","receipt_integrity":"sha256:RECEIPT-INTEGRITY-PLACEHOLDER"},"failure":""}`)
			},
		},
		{
			name: "escaped-equivalent artifact_hashes key",
			raw: func(t *testing.T) string {
				return sealRawReceipt(t, `{"gate":"gate-build","status":"pass","tool":"go build ./...","command":"make gate-build","commit":"1111111111111111111111111111111111111111","tree":"2222222222222222222222222222222222222222","started_at":"2026-09-15T23:35:17Z","ended_at":"2026-09-15T23:35:18Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"\u0061rtifact_hashes":{"worktree_state":"sha256:3333333333333333333333333333333333333333333333333333333333333333","receipt_integrity":"sha256:RECEIPT-INTEGRITY-PLACEHOLDER"},"failure":""}`)
			},
		},
		{
			name: "artifact_hashes as final top-level member",
			raw: func(t *testing.T) string {
				return sealRawReceipt(t, `{"gate":"gate-build","status":"pass","tool":"go build ./...","command":"make gate-build","commit":"1111111111111111111111111111111111111111","tree":"2222222222222222222222222222222222222222","started_at":"2026-09-15T23:35:17Z","ended_at":"2026-09-15T23:35:18Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"failure":"","artifact_hashes":{"worktree_state":"sha256:3333333333333333333333333333333333333333333333333333333333333333","receipt_integrity":"sha256:RECEIPT-INTEGRITY-PLACEHOLDER"}}`)
			},
		},
		{
			name: "earlier existing string field value decoy",
			raw: func(t *testing.T) string {
				return receiptWithMutations(t,
					receiptReplacement{`"status":"pass"`, `"status":"fail"`},
					receiptReplacement{`"exit_code":0`, `"exit_code":1`},
					receiptReplacement{`"skip_names":[]`, `"skip_names":["artifact_hashes"]`},
					receiptReplacement{`"failure":""`, `"failure":"check failed"`},
				)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := ValidateReceipt([]byte(tt.raw(t))); err != nil {
				t.Fatalf("ValidateReceipt rejected a valid raw-integrity variant: %v", err)
			}
		})
	}
}

func receiptWithMutations(t *testing.T, replacements ...receiptReplacement) string {
	t.Helper()
	raw := validProducerReceipt
	for _, replacement := range replacements {
		raw = replaceReceiptLiteral(t, raw, replacement.expected, replacement.replacement)
	}
	return sealRawReceipt(t, raw)
}

func sealRawReceipt(t *testing.T, raw string) string {
	t.Helper()
	sealed, _ := sealReceipt(t, raw)
	return sealed
}

func sealReceipt(t *testing.T, raw string) (string, string) {
	t.Helper()
	_, digest, err := deriveReceiptIntegrityOracle([]byte(raw))
	if err != nil {
		t.Fatalf("derive receipt integrity oracle: %v", err)
	}
	return replaceReceiptLiteral(t, raw, receiptIntegrityPlaceholder, digest), digest
}

func replaceReceiptLiteral(t *testing.T, raw, expected, replacement string) string {
	t.Helper()
	count := bytes.Count([]byte(raw), []byte(expected))
	if count != 1 {
		t.Fatalf("receipt literal %q occurs %d times, want 1", expected, count)
	}
	index := bytes.Index([]byte(raw), []byte(expected))
	return raw[:index] + replacement + raw[index+len(expected):]
}
