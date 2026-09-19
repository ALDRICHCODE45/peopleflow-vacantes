// Package closurereport — BC-01 RED: structural receipt decoder tests.
//
// These tests define the exact gate-producer JSON schema and its structural
// rejection classes. Valid receipts decode into an UnvalidatedReceipt type that
// carries no trusted semantics — BC-02 validates identity, BC-03 binds the
// decoder to Generate. Decoder tests use in-process fixtures; no gate scripts
// or databases are invoked.
package closurereport

import (
	"testing"
)

// validPassReceipt is a syntactically valid pass receipt emitted by the gate
// producer. All 13 top-level fields are present with correct types; artifact
// hashes carry the sha256: prefix.
const validPassReceipt = `{
  "gate": "gate-unit",
  "status": "pass",
  "tool": "go test ./... -count=1 -v",
  "command": "make gate-unit",
  "commit": "a1b2c3d4e5f6789012345678901234567890abcd",
  "tree": "abc123def456789012345678901234567890abcd",
  "started_at": "2024-07-01T10:00:00Z",
  "ended_at": "2024-07-01T10:01:00Z",
  "exit_code": 0,
  "test_counts": {
    "ok": 42,
    "fail": 0,
    "no_test_files": 0
  },
  "skip_names": [],
  "artifact_hashes": {
    "worktree_state": "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    "receipt_integrity": "sha256:cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe"
  },
  "failure": ""
}`

// validFailReceipt is a syntactically valid fail receipt emitted by the gate
// producer.  Semantic invalidity (e.g. exit_code 0 with status "fail") is
// intentionally allowed here; BC-02 will reject it.
const validFailReceipt = `{
  "gate": "gate-build",
  "status": "fail",
  "tool": "go build ./...",
  "command": "make gate-build",
  "commit": "git:unavailable",
  "tree": "git:unavailable",
  "started_at": "2024-07-01T10:00:00Z",
  "ended_at": "2024-07-01T10:00:01Z",
  "exit_code": 1,
  "test_counts": {
    "ok": 0,
    "fail": 1,
    "no_test_files": 0
  },
  "skip_names": ["TestFlaky", "TestSkipped"],
  "artifact_hashes": {
    "worktree_state": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "receipt_integrity": "sha256:fedcbafedcbafedcbafedcbafedcbafedcbafedcbafedcbafedcbafedcbafedc"
  },
  "failure": "check_exit=1: build error: package not found"
}`

// validPassReceiptWithSkips mirrors the gate-unit pass receipt with one skip.
const validPassReceiptWithSkip = `{
  "gate": "gate-integration",
  "status": "fail",
  "tool": "go test -tags=integration -p 1 ./... -count=1 -json",
  "command": "make gate-integration",
  "commit": "b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9",
  "tree": "def456abc789012345678901234567890abcdef",
  "started_at": "2024-07-01T12:00:00Z",
  "ended_at": "2024-07-01T12:05:00Z",
  "exit_code": 1,
  "test_counts": {
    "ok": 10,
    "fail": 0,
    "no_test_files": 2
  },
  "skip_names": ["TestIntegrationOne"],
  "artifact_hashes": {
    "worktree_state": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    "receipt_integrity": "sha256:2222222222222222222222222222222222222222222222222222222222222222"
  },
  "failure": "emitted 1 test skip(s) (first: TestIntegrationOne); any Action:skip fails the gate"
}`

// validMinSkips is a receipt with the minimum field: one skip name.
const validMinSkips = `{
  "gate": "gate-integration",
  "status": "fail",
  "tool": "go test -tags=integration -p 1 ./... -count=1 -json",
  "command": "make gate-integration",
  "commit": "b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9",
  "tree": "def456abc789012345678901234567890abcdef",
  "started_at": "2024-07-01T12:00:00Z",
  "ended_at": "2024-07-01T12:05:00Z",
  "exit_code": 1,
  "test_counts": {
    "ok": 10,
    "fail": 0,
    "no_test_files": 0
  },
  "skip_names": ["TestSingleSkip"],
  "artifact_hashes": {
    "worktree_state": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    "receipt_integrity": "sha256:2222222222222222222222222222222222222222222222222222222222222222"
  },
  "failure": "emitted 1 test skip(s) (first: TestSingleSkip)"
}`

func TestDecodeReceipt_ValidPassReceipt(t *testing.T) {
	r, err := DecodeReceipt([]byte(validPassReceipt))
	if err != nil {
		t.Fatalf("expected valid receipt to decode, got error: %v", err)
	}
	if r.Gate != "gate-unit" {
		t.Errorf("Gate = %q, want %q", r.Gate, "gate-unit")
	}
	if r.Status != "pass" {
		t.Errorf("Status = %q, want %q", r.Status, "pass")
	}
	if r.Tool != "go test ./... -count=1 -v" {
		t.Errorf("Tool = %q, want %q", r.Tool, "go test ./... -count=1 -v")
	}
	if r.Command != "make gate-unit" {
		t.Errorf("Command = %q, want %q", r.Command, "make gate-unit")
	}
	if r.Commit != "a1b2c3d4e5f6789012345678901234567890abcd" {
		t.Errorf("Commit = %q, want %q", r.Commit, "a1b2c3d4e5f6789012345678901234567890abcd")
	}
	if r.Tree != "abc123def456789012345678901234567890abcd" {
		t.Errorf("Tree = %q, want %q", r.Tree, "abc123def456789012345678901234567890abcd")
	}
	if r.StartedAt != "2024-07-01T10:00:00Z" {
		t.Errorf("StartedAt = %q, want %q", r.StartedAt, "2024-07-01T10:00:00Z")
	}
	if r.EndedAt != "2024-07-01T10:01:00Z" {
		t.Errorf("EndedAt = %q, want %q", r.EndedAt, "2024-07-01T10:01:00Z")
	}
	if r.ExitCode != 0 {
		t.Errorf("ExitCode = %d, want %d", r.ExitCode, 0)
	}
	if r.TestCounts.Ok != 42 {
		t.Errorf("TestCounts.Ok = %d, want %d", r.TestCounts.Ok, 42)
	}
	if r.TestCounts.Fail != 0 {
		t.Errorf("TestCounts.Fail = %d, want %d", r.TestCounts.Fail, 0)
	}
	if r.TestCounts.NoTestFiles != 0 {
		t.Errorf("TestCounts.NoTestFiles = %d, want %d", r.TestCounts.NoTestFiles, 0)
	}
	if len(r.SkipNames) != 0 {
		t.Errorf("SkipNames = %v, want empty", r.SkipNames)
	}
	if r.ArtifactHashes.WorktreeState != "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" {
		t.Errorf("ArtifactHashes.WorktreeState = %q", r.ArtifactHashes.WorktreeState)
	}
	if r.ArtifactHashes.ReceiptIntegrity != "sha256:cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe" {
		t.Errorf("ArtifactHashes.ReceiptIntegrity = %q", r.ArtifactHashes.ReceiptIntegrity)
	}
	if r.Failure != "" {
		t.Errorf("Failure = %q, want %q", r.Failure, "")
	}
}

func TestDecodeReceipt_ValidFailReceipt(t *testing.T) {
	r, err := DecodeReceipt([]byte(validFailReceipt))
	if err != nil {
		t.Fatalf("expected valid fail receipt to decode, got error: %v", err)
	}
	if r.Gate != "gate-build" {
		t.Errorf("Gate = %q, want %q", r.Gate, "gate-build")
	}
	if r.Status != "fail" {
		t.Errorf("Status = %q, want %q", r.Status, "fail")
	}
	if r.ExitCode != 1 {
		t.Errorf("ExitCode = %d, want %d", r.ExitCode, 1)
	}
	if len(r.SkipNames) != 2 {
		t.Errorf("SkipNames len = %d, want %d", len(r.SkipNames), 2)
	}
	if r.SkipNames[0] != "TestFlaky" || r.SkipNames[1] != "TestSkipped" {
		t.Errorf("SkipNames = %v", r.SkipNames)
	}
	if r.Commit != "git:unavailable" {
		t.Errorf("Commit = %q, want %q (git:unavailable must decode)", r.Commit, "git:unavailable")
	}
	if r.Failure != "check_exit=1: build error: package not found" {
		t.Errorf("Failure = %q", r.Failure)
	}
}

func TestDecodeReceipt_ValidReceiptWithSkips(t *testing.T) {
	r, err := DecodeReceipt([]byte(validPassReceiptWithSkip))
	if err != nil {
		t.Fatalf("expected valid receipt with skip to decode, got error: %v", err)
	}
	if len(r.SkipNames) != 1 {
		t.Fatalf("SkipNames len = %d, want 1", len(r.SkipNames))
	}
	if r.SkipNames[0] != "TestIntegrationOne" {
		t.Errorf("SkipNames[0] = %q, want %q", r.SkipNames[0], "TestIntegrationOne")
	}
	if r.TestCounts.Ok != 10 {
		t.Errorf("TestCounts.Ok = %d, want %d", r.TestCounts.Ok, 10)
	}
	if r.TestCounts.NoTestFiles != 2 {
		t.Errorf("TestCounts.NoTestFiles = %d, want %d", r.TestCounts.NoTestFiles, 2)
	}
}

func TestDecodeReceipt_ValidReceiptMinSkipNames(t *testing.T) {
	r, err := DecodeReceipt([]byte(validMinSkips))
	if err != nil {
		t.Fatalf("expected receipt with single skip to decode, got error: %v", err)
	}
	if len(r.SkipNames) != 1 || r.SkipNames[0] != "TestSingleSkip" {
		t.Errorf("SkipNames = %v, want [TestSingleSkip]", r.SkipNames)
	}
}

// structuralRejectCases defines all structural rejection classes.
var structuralRejectCases = []struct {
	name  string
	input string
}{
	{
		name:  "missing required field gate",
		input: `{"status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "missing required field status",
		input: `{"gate":"gate-unit","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "missing required field started_at",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "missing required field exit_code",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "missing required field test_counts",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "missing required field artifact_hashes",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"failure":""}`,
	},
	{
		name:  "missing required field failure",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"}}`,
	},
	{
		name:  "unknown field extra_field",
		input: `{"extra_field":"oops","gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "unknown field in test_counts",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0,"unknown_count":1},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "unknown field in artifact_hashes",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00","extra_hash":"sha256:99"},"failure":""}`,
	},
	{
		name:  "null value for required string field gate",
		input: `{"gate":null,"status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "null value for required array field skip_names",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":null,"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "null value for required object field test_counts",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":null,"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "wrong type string for exit_code",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":"zero","test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "wrong type number for gate",
		input: `{"gate":42,"status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "wrong type array for test_counts",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":[],"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "wrong type int for artifact_hashes",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":0,"failure":""}`,
	},
	{
		name:  "wrong type string for test_counts.ok",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":"many","fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "exit_code as float 1.0",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":1.0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "exit_code as float 1e0",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":1e0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "exit_code exceeds int range float 1e18",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":1e18,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "non-object root array",
		input: `[{"gate":"gate-unit"}]`,
	},
	{
		name:  "non-object root string",
		input: `"gate-unit"`,
	},
	{
		name:  "non-object root number",
		input: `42`,
	},
	{
		name:  "non-object root bool",
		input: `true`,
	},
	{
		name:  "malformed JSON missing closing brace",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build"`,
	},
	{
		name:  "malformed JSON trailing garbage",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""} extra`,
	},
	{
		name:  "malformed JSON garbage prefix",
		input: `oops{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "empty input",
		input: ``,
	},
	{
		name:  "duplicate key gate",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":"","gate":"gate-vet"}`,
	},
	{
		name:  "duplicate key test_counts.ok",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0,"ok":99},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00"},"failure":""}`,
	},
	{
		name:  "duplicate key artifact_hashes.worktree_state",
		input: `{"gate":"gate-unit","status":"pass","tool":"go build","command":"make","commit":"abc","tree":"def","started_at":"2024-07-01T00:00:00Z","ended_at":"2024-07-01T00:01:00Z","exit_code":0,"test_counts":{"ok":0,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:00","receipt_integrity":"sha256:00","worktree_state":"sha256:01"},"failure":""}`,
	},
}

func TestDecodeReceipt_StructuralRejection(t *testing.T) {
	for _, tt := range structuralRejectCases {
		t.Run(tt.name, func(t *testing.T) {
			_, err := DecodeReceipt([]byte(tt.input))
			if err == nil {
				t.Errorf("input should have been rejected structurally, butDecodeReceipt returned (receipt, nil); want non-nil error")
			}
		})
	}
}

func TestDecodeReceipt_AcceptsSyntacticallyValidGitUnavailable(t *testing.T) {
	// A receipt with git:unavailable is syntactically valid; BC-02 will
	// validate that commit/tree are actual git hashes for GO eligibility.
	r, err := DecodeReceipt([]byte(validFailReceipt))
	if err != nil {
		t.Fatalf("git:unavailable receipt must decode structurally: %v", err)
	}
	if r.Commit != "git:unavailable" {
		t.Errorf("Commit = %q, want %q", r.Commit, "git:unavailable")
	}
	if r.Tree != "git:unavailable" {
		t.Errorf("Tree = %q, want %q", r.Tree, "git:unavailable")
	}
}

// fieldPreservationCases ensures all string/array/count/hash values are
// preserved accurately from the decoded receipt.
var fieldPreservationCases = []struct {
	name      string
	input     string
	wantField string
	wantValue string
}{
	{
		name:      "gate value preserved",
		input:     validPassReceipt,
		wantField: "Gate",
		wantValue: "gate-unit",
	},
	{
		name:      "status value preserved",
		input:     validPassReceipt,
		wantField: "Status",
		wantValue: "pass",
	},
	{
		name:      "tool value with spaces preserved",
		input:     validPassReceipt,
		wantField: "Tool",
		wantValue: "go test ./... -count=1 -v",
	},
	{
		name:      "command value preserved",
		input:     validPassReceipt,
		wantField: "Command",
		wantValue: "make gate-unit",
	},
	{
		name:      "commit long hex preserved",
		input:     validPassReceipt,
		wantField: "Commit",
		wantValue: "a1b2c3d4e5f6789012345678901234567890abcd",
	},
	{
		name:      "tree value preserved",
		input:     validPassReceipt,
		wantField: "Tree",
		wantValue: "abc123def456789012345678901234567890abcd",
	},
	{
		name:      "started_at ISO8601 preserved",
		input:     validPassReceipt,
		wantField: "StartedAt",
		wantValue: "2024-07-01T10:00:00Z",
	},
	{
		name:      "ended_at ISO8601 preserved",
		input:     validPassReceipt,
		wantField: "EndedAt",
		wantValue: "2024-07-01T10:01:00Z",
	},
	{
		name:      "exit_code zero preserved",
		input:     validPassReceipt,
		wantField: "ExitCode",
		wantValue: "0",
	},
	{
		name:      "exit_code one preserved",
		input:     validFailReceipt,
		wantField: "ExitCode",
		wantValue: "1",
	},
	{
		name:      "test_counts.ok preserved",
		input:     validPassReceipt,
		wantField: "TestCounts.Ok",
		wantValue: "42",
	},
	{
		name:      "test_counts.fail preserved",
		input:     validPassReceipt,
		wantField: "TestCounts.Fail",
		wantValue: "0",
	},
	{
		name:      "test_counts.no_test_files preserved",
		input:     validPassReceiptWithSkip,
		wantField: "TestCounts.NoTestFiles",
		wantValue: "2",
	},
	{
		name:      "skip_names single preserved",
		input:     validMinSkips,
		wantField: "SkipNames[0]",
		wantValue: "TestSingleSkip",
	},
	{
		name:      "skip_names multiple preserved",
		input:     validFailReceipt,
		wantField: "SkipNames[1]",
		wantValue: "TestSkipped",
	},
	{
		name:      "artifact_hashes.worktree_state sha256: prefix preserved",
		input:     validPassReceipt,
		wantField: "ArtifactHashes.WorktreeState",
		wantValue: "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
	},
	{
		name:      "artifact_hashes.receipt_integrity sha256: prefix preserved",
		input:     validPassReceipt,
		wantField: "ArtifactHashes.ReceiptIntegrity",
		wantValue: "sha256:cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
	},
	{
		name:      "failure string preserved",
		input:     validFailReceipt,
		wantField: "Failure",
		wantValue: "check_exit=1: build error: package not found",
	},
}

func TestDecodeReceipt_FieldPreservation(t *testing.T) {
	for _, tt := range fieldPreservationCases {
		t.Run(tt.name, func(t *testing.T) {
			r, err := DecodeReceipt([]byte(tt.input))
			if err != nil {
				t.Fatalf("DecodeReceipt failed: %v", err)
			}
			var got string
			switch tt.wantField {
			case "Gate":
				got = r.Gate
			case "Status":
				got = r.Status
			case "Tool":
				got = r.Tool
			case "Command":
				got = r.Command
			case "Commit":
				got = r.Commit
			case "Tree":
				got = r.Tree
			case "StartedAt":
				got = r.StartedAt
			case "EndedAt":
				got = r.EndedAt
			case "ExitCode":
				got = string(rune(r.ExitCode + '0'))
				// Use strconv for multi-digit
				got = itoa(r.ExitCode)
			case "TestCounts.Ok":
				got = itoa(r.TestCounts.Ok)
			case "TestCounts.Fail":
				got = itoa(r.TestCounts.Fail)
			case "TestCounts.NoTestFiles":
				got = itoa(r.TestCounts.NoTestFiles)
			case "SkipNames[0]":
				if len(r.SkipNames) > 0 {
					got = r.SkipNames[0]
				}
			case "SkipNames[1]":
				if len(r.SkipNames) > 1 {
					got = r.SkipNames[1]
				}
			case "ArtifactHashes.WorktreeState":
				got = r.ArtifactHashes.WorktreeState
			case "ArtifactHashes.ReceiptIntegrity":
				got = r.ArtifactHashes.ReceiptIntegrity
			case "Failure":
				got = r.Failure
			default:
				t.Fatalf("unknown field %q", tt.wantField)
			}
			if got != tt.wantValue {
				t.Errorf("field %s = %q, want %q", tt.wantField, got, tt.wantValue)
			}
		})
	}
}

// itoa converts an int to its decimal string representation without importing strconv.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		b = append([]byte{'-'}, b...)
	}
	return string(b)
}

func TestDecodeReceipt_NilSliceInput(t *testing.T) {
	// A nil byte slice is still a valid empty input; decode must reject it.
	_, err := DecodeReceipt(nil)
	if err == nil {
		t.Error("nil input must be rejected")
	}
}

// Regression tests for BC-01 correction: escaped-equivalent duplicate keys and
// null array element rejection. These must fail against the broken candidate.

func TestDecodeReceipt_EscapedEquivDuplicateRootRejected(t *testing.T) {
	// "gate" and "g\u0061te" decode to the same string; both must be rejected.
	input := `{"gate":"first","g\u0061te":"second","status":"pass","tool":"go test","command":"make gate-unit","commit":"git:unavailable","tree":"git:unavailable","started_at":"x","ended_at":"y","exit_code":0,"test_counts":{"ok":1,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"x","receipt_integrity":"y"},"failure":""}`
	_, err := DecodeReceipt([]byte(input))
	if err == nil {
		t.Error("escaped-equivalent duplicate root key must be rejected")
	}
}

func TestDecodeReceipt_EscapedEquivDuplicateNestedRejected(t *testing.T) {
	// "ok" and "\u006fk" decode to the same string inside test_counts; rejected.
	input := `{"gate":"gate-unit","status":"pass","tool":"go test","command":"make gate-unit","commit":"git:unavailable","tree":"git:unavailable","started_at":"x","ended_at":"y","exit_code":0,"test_counts":{"ok":1,"\u006fk":2,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"x","receipt_integrity":"y"},"failure":""}`
	_, err := DecodeReceipt([]byte(input))
	if err == nil {
		t.Error("escaped-equivalent duplicate nested key must be rejected")
	}
}

func TestDecodeReceipt_EscapedEquivDuplicateArtifactHashesRejected(t *testing.T) {
	// "worktree_state" and "worktree\u005fstate" decode to the same string.
	input := `{"gate":"gate-unit","status":"pass","tool":"go test","command":"make gate-unit","commit":"git:unavailable","tree":"git:unavailable","started_at":"x","ended_at":"y","exit_code":0,"test_counts":{"ok":1,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"sha256:deadbeef","worktree\u005fstate":"sha256:cafebabe"},"failure":""}`
	_, err := DecodeReceipt([]byte(input))
	if err == nil {
		t.Error("escaped-equivalent duplicate artifact_hashes key must be rejected")
	}
}

func TestDecodeReceipt_PositiveSingleEscapedKnownKeyAccepted(t *testing.T) {
	// A single escaped key that decodes to a known field name must be accepted.
	input := `{"\u0067ate":"gate-unit","status":"pass","tool":"go test","command":"make gate-unit","commit":"git:unavailable","tree":"git:unavailable","started_at":"x","ended_at":"y","exit_code":0,"test_counts":{"ok":1,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"x","receipt_integrity":"y"},"failure":""}`
	r, err := DecodeReceipt([]byte(input))
	if err != nil {
		t.Fatalf("single escaped known key must be accepted: %v", err)
	}
	if r.Gate != "gate-unit" {
		t.Errorf("Gate = %q, want %q", r.Gate, "gate-unit")
	}
}

func TestDecodeReceipt_OrdinaryEscapedStringContentsPreserved(t *testing.T) {
	// An escaped Unicode sequence inside a string VALUE (not key) must be preserved.
	input := `{"gate":"hello\u0020world","status":"pass","tool":"go test","command":"make gate-unit","commit":"git:unavailable","tree":"git:unavailable","started_at":"x","ended_at":"y","exit_code":0,"test_counts":{"ok":1,"fail":0,"no_test_files":0},"skip_names":[],"artifact_hashes":{"worktree_state":"x","receipt_integrity":"y"},"failure":""}`
	r, err := DecodeReceipt([]byte(input))
	if err != nil {
		t.Fatalf("escaped string contents must be preserved: %v", err)
	}
	if r.Gate != "hello world" {
		t.Errorf("Gate = %q, want %q", r.Gate, "hello world")
	}
}

func TestDecodeReceipt_NullSkipNamesElementRejected(t *testing.T) {
	// skip_names element null must be rejected, not silently become empty string.
	input := `{"gate":"gate-unit","status":"pass","tool":"go test","command":"make gate-unit","commit":"git:unavailable","tree":"git:unavailable","started_at":"x","ended_at":"y","exit_code":0,"test_counts":{"ok":1,"fail":0,"no_test_files":0},"skip_names":[null,"TestValid"],"artifact_hashes":{"worktree_state":"x","receipt_integrity":"y"},"failure":""}`
	_, err := DecodeReceipt([]byte(input))
	if err == nil {
		t.Error("null skip_names element must be rejected")
	}
}

func TestDecodeReceipt_EmptyStringSkipNamesAccepted(t *testing.T) {
	// Empty string "" is a valid skip name; only null is rejected.
	input := `{"gate":"gate-unit","status":"pass","tool":"go test","command":"make gate-unit","commit":"git:unavailable","tree":"git:unavailable","started_at":"x","ended_at":"y","exit_code":0,"test_counts":{"ok":1,"fail":0,"no_test_files":0},"skip_names":[""],"artifact_hashes":{"worktree_state":"x","receipt_integrity":"y"},"failure":""}`
	r, err := DecodeReceipt([]byte(input))
	if err != nil {
		t.Fatalf("empty string skip name must be accepted: %v", err)
	}
	if len(r.SkipNames) != 1 || r.SkipNames[0] != "" {
		t.Errorf("SkipNames = %v, want [\"\"]", r.SkipNames)
	}
}

func TestDecodeReceipt_EmptySliceInput(t *testing.T) {
	_, err := DecodeReceipt([]byte{})
	if err == nil {
		t.Error("empty input must be rejected")
	}
}
