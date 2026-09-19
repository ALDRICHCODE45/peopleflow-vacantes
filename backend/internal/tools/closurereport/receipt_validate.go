// Package closurereport — BC-02: semantic receipt validation.
package closurereport

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const receiptGitUnavailableReason = "git commit/tree identity unavailable; receipts require a Git HEAD and tree"

// receiptGateTools is the package-owned exact producer contract for the nine
// required closure gates: the byte-exact check_command the frozen WS7A producer
// (scripts/closure/gate) records as `tool`. A gate outside this set, or a gate
// whose tool/command is not the producer's own, fails closed.
var receiptGateTools = map[string]string{
	"gate-build": "go build ./...", "gate-vet": "go vet ./...", "gate-fmt": "gofmt -l .",
	"gate-unit":        "go test ./... -count=1 -v",
	"gate-race":        "go test -race -v -count=1 ./internal/runtime/middleware ./internal/runtime/health ./cmd/api",
	"gate-integration": "go test -tags=integration -p 1 ./... -count=1 -json",
	"gate-migrations":  "built cmd/migrate round trip (cmd/migrate integration harness)",
	"gate-sqlc":        "go tool sqlc generate in a clean temp copy, then diff",
	"gate-arch":        "archguard repository guards (cross-feature imports, ad-hoc code-literal scan, locked non-goals, traceability structure/coverage; route topology via TestRouteTopology_ExactRegistrations)",
}

// ValidatedReceipt is the gate-producer receipt with semantics validated.
// It is not GO-eligible; BC-03 binds the decoder to Generate.
type ValidatedReceipt struct {
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

// ValidateReceipt structurally decodes and semantically validates a gate-producer
// receipt, including its byte-preserving receipt-integrity digest.
func ValidateReceipt(raw []byte) (ValidatedReceipt, error) {
	ur, err := DecodeReceipt(raw)
	if err != nil {
		return ValidatedReceipt{}, fmt.Errorf("structural decode failed: %w", err)
	}

	if err := validateReceiptSemantics(ur); err != nil {
		return ValidatedReceipt{}, err
	}

	digest, err := receiptIntegrityDigest(raw)
	if err != nil {
		return ValidatedReceipt{}, fmt.Errorf("receipt integrity preimage: %w", err)
	}
	if ur.ArtifactHashes.ReceiptIntegrity != digest {
		return ValidatedReceipt{}, fmt.Errorf("receipt_integrity does not match receipt content")
	}

	return validatedReceipt(ur), nil
}

func validateReceiptSemantics(r UnvalidatedReceipt) error {
	tool, ok := receiptGateTools[r.Gate]
	if !ok {
		return fmt.Errorf("gate %q is outside the nine required producer gates", r.Gate)
	}
	if r.Tool != tool {
		return fmt.Errorf("tool %q does not match the producer contract for gate %q", r.Tool, r.Gate)
	}
	if r.Command != "make "+r.Gate {
		return fmt.Errorf("command %q does not match the producer contract for gate %q", r.Command, r.Gate)
	}

	if r.Status != "pass" && r.Status != "fail" {
		return fmt.Errorf("status must be pass or fail")
	}
	if r.ExitCode != 0 && r.ExitCode != 1 {
		return fmt.Errorf("exit_code must be 0 or 1")
	}

	if r.Status == "pass" {
		if r.ExitCode != 0 {
			return fmt.Errorf("pass receipt must have exit_code 0")
		}
		if r.Failure != "" {
			return fmt.Errorf("pass receipt must have an empty failure")
		}
		if r.TestCounts.Fail != 0 {
			return fmt.Errorf("pass receipt must have fail test count 0")
		}
		if len(r.SkipNames) != 0 {
			return fmt.Errorf("pass receipt must not contain skip names")
		}
	} else {
		if r.ExitCode != 1 {
			return fmt.Errorf("fail receipt must have exit_code 1")
		}
		if r.Failure == "" {
			return fmt.Errorf("fail receipt must have a failure")
		}
	}

	if r.TestCounts.Ok < 0 || r.TestCounts.Fail < 0 || r.TestCounts.NoTestFiles < 0 {
		return fmt.Errorf("test counts must be nonnegative")
	}

	commitUnavailable, err := validateGitReference("commit", r.Commit)
	if err != nil {
		return err
	}
	treeUnavailable, err := validateGitReference("tree", r.Tree)
	if err != nil {
		return err
	}
	if commitUnavailable || treeUnavailable {
		if r.Status != "fail" {
			return fmt.Errorf("git:unavailable requires a fail receipt")
		}
		if !strings.Contains(r.Failure, receiptGitUnavailableReason) {
			return fmt.Errorf("git:unavailable failure must include the producer reason")
		}
	}

	if !isSHA256Hex(r.ArtifactHashes.WorktreeState) {
		return fmt.Errorf("worktree_state must be sha256 plus 64 lowercase hexadecimal characters")
	}
	if !isSHA256Hex(r.ArtifactHashes.ReceiptIntegrity) {
		return fmt.Errorf("receipt_integrity must be sha256 plus 64 lowercase hexadecimal characters")
	}

	startedAt, err := parseReceiptTime("started_at", r.StartedAt)
	if err != nil {
		return err
	}
	endedAt, err := parseReceiptTime("ended_at", r.EndedAt)
	if err != nil {
		return err
	}
	if endedAt.Before(startedAt) {
		return fmt.Errorf("ended_at must not precede started_at")
	}

	return nil
}

func validateGitReference(name, value string) (bool, error) {
	if value == "git:unavailable" {
		return true, nil
	}
	if (len(value) != 40 && len(value) != 64) || !isLowerHex(value) {
		return false, fmt.Errorf("%s must be lowercase 40- or 64-character hexadecimal or git:unavailable", name)
	}
	return false, nil
}

func isSHA256Hex(value string) bool {
	return len(value) == len("sha256:")+64 && strings.HasPrefix(value, "sha256:") && isLowerHex(value[len("sha256:"):])
}

func isLowerHex(value string) bool {
	for i := 0; i < len(value); i++ {
		if value[i] < '0' || value[i] > '9' {
			if value[i] < 'a' || value[i] > 'f' {
				return false
			}
		}
	}
	return true
}

func parseReceiptTime(name, value string) (time.Time, error) {
	if len(value) != len("2006-01-02T15:04:05Z") ||
		value[4] != '-' || value[7] != '-' || value[10] != 'T' ||
		value[13] != ':' || value[16] != ':' || value[19] != 'Z' {
		return time.Time{}, fmt.Errorf("%s must be an exact UTC-second timestamp", name)
	}

	parsed, err := time.Parse("2006-01-02T15:04:05Z", value)
	if err != nil {
		return time.Time{}, fmt.Errorf("%s is invalid: %w", name, err)
	}
	return parsed, nil
}

func receiptIntegrityDigest(raw []byte) (string, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil {
		return "", fmt.Errorf("read top-level JSON value: %w", err)
	}
	if delimiter, ok := token.(json.Delim); !ok || delimiter != '{' {
		return "", fmt.Errorf("receipt must be a top-level object")
	}

	found := false
	valueStart, valueEnd := 0, 0
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return "", fmt.Errorf("read top-level key: %w", err)
		}
		key, ok := token.(string)
		if !ok {
			return "", fmt.Errorf("top-level object key is not a string")
		}

		start, err := valueStartAfterKey(raw, int(decoder.InputOffset()))
		if err != nil {
			return "", fmt.Errorf("locate value for top-level key %q: %w", key, err)
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return "", fmt.Errorf("read value for top-level key %q: %w", key, err)
		}
		end := int(decoder.InputOffset())
		if end < start || end > len(raw) {
			return "", fmt.Errorf("impossible value offsets for top-level key %q", key)
		}

		if key == "artifact_hashes" {
			if found {
				return "", fmt.Errorf("duplicate artifact_hashes key")
			}
			found = true
			valueStart, valueEnd = start, end
		}
	}

	if _, err := decoder.Token(); err != nil {
		return "", fmt.Errorf("read closing receipt object: %w", err)
	}
	if !found {
		return "", fmt.Errorf("missing artifact_hashes key")
	}

	preimage := append([]byte{}, raw[:valueStart]...)
	object, err := receiptIntegrityPreimage(raw[valueStart:valueEnd])
	if err != nil {
		return "", fmt.Errorf("receipt integrity preimage: %w", err)
	}
	preimage = append(preimage, object...)
	preimage = append(preimage, raw[valueEnd:]...)

	var compact bytes.Buffer
	if err := json.Compact(&compact, preimage); err != nil {
		return "", fmt.Errorf("compact receipt preimage: %w", err)
	}

	digest := sha256.Sum256(compact.Bytes())
	return fmt.Sprintf("sha256:%x", digest), nil
}

// receiptIntegrityPreimage rewrites one artifact_hashes object with only its
// receipt_integrity member excluded, so the bound worktree_state and every other
// member stay in the receipt_integrity preimage byte-exactly. Nothing is rewritten
// or recursed into: only that one member's exact bytes are dropped.
func receiptIntegrityPreimage(object []byte) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(object))
	if _, err := decoder.Token(); err != nil {
		return nil, fmt.Errorf("read artifact_hashes object: %w", err)
	}
	kept := [][]byte{}
	position := int(decoder.InputOffset())
	for decoder.More() {
		keyStart := skipReceiptWhitespace(object, position)
		if keyStart < len(object) && object[keyStart] == ',' {
			keyStart = skipReceiptWhitespace(object, keyStart+1)
		}
		token, err := decoder.Token()
		if err != nil {
			return nil, fmt.Errorf("read artifact_hashes key: %w", err)
		}
		key, ok := token.(string)
		if !ok {
			return nil, fmt.Errorf("artifact_hashes object key is not a string")
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, fmt.Errorf("read artifact_hashes value for key %q: %w", key, err)
		}
		position = int(decoder.InputOffset())
		if position < keyStart || position > len(object) {
			return nil, fmt.Errorf("impossible artifact_hashes offsets for key %q", key)
		}
		if key != "receipt_integrity" {
			kept = append(kept, object[keyStart:position])
		}
	}
	if _, err := decoder.Token(); err != nil {
		return nil, fmt.Errorf("read closing artifact_hashes object: %w", err)
	}
	preimage := append([]byte{'{'}, bytes.Join(kept, []byte{','})...)
	return append(preimage, '}'), nil
}

func valueStartAfterKey(raw []byte, offset int) (int, error) {
	if offset < 0 || offset > len(raw) {
		return 0, fmt.Errorf("key offset is outside the receipt")
	}

	index := skipReceiptWhitespace(raw, offset)
	if index == len(raw) || raw[index] != ':' {
		return 0, fmt.Errorf("missing key-value separator")
	}
	index = skipReceiptWhitespace(raw, index+1)
	if index == len(raw) {
		return 0, fmt.Errorf("missing value")
	}
	return index, nil
}

func skipReceiptWhitespace(raw []byte, index int) int {
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

func validatedReceipt(ur UnvalidatedReceipt) ValidatedReceipt {
	var vr ValidatedReceipt
	vr.Gate = ur.Gate
	vr.Status = ur.Status
	vr.Tool = ur.Tool
	vr.Command = ur.Command
	vr.Commit = ur.Commit
	vr.Tree = ur.Tree
	vr.StartedAt = ur.StartedAt
	vr.EndedAt = ur.EndedAt
	vr.ExitCode = ur.ExitCode
	vr.TestCounts.Ok = ur.TestCounts.Ok
	vr.TestCounts.Fail = ur.TestCounts.Fail
	vr.TestCounts.NoTestFiles = ur.TestCounts.NoTestFiles
	vr.SkipNames = ur.SkipNames
	vr.ArtifactHashes.WorktreeState = ur.ArtifactHashes.WorktreeState
	vr.ArtifactHashes.ReceiptIntegrity = ur.ArtifactHashes.ReceiptIntegrity
	vr.Failure = ur.Failure
	return vr
}
