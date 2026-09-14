// Package closure_test — WS7A RED mutation fixtures, compact table-driven form.
//
// Ten independently named violation classes (task 7.1) are each seeded into a
// TEMPORARY COPY of the tree inputs (t.TempDir; the working tree is never
// mutated) and the matching gate target must FAIL with a failure receipt.
// RED (a6e52b8): the pass-through stub reported pass on every mutation, so
// every row failed behaviorally. GREEN: the real scripts make every row pass.
package closure_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestMain(m *testing.M) {
	if os.Getenv("GATE_ACTIVE") == "1" {
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// gateTargets lists the nine scaffold targets in canonical order.
var gateTargets = []string{
	"gate-build", "gate-vet", "gate-fmt", "gate-unit", "gate-race",
	"gate-integration", "gate-migrations", "gate-sqlc", "closure-gate",
}

// receipt is the JSON object a gate emits on stdout. The RED stub always emits
// status "pass"; GREEN must emit "fail" with a failure record on mutation.
type receipt struct {
	Gate       string            `json:"gate"`
	Status     string            `json:"status"`
	Tool       string            `json:"tool"`
	Command    string            `json:"command"`
	Commit     string            `json:"commit"`
	Tree       string            `json:"tree"`
	StartedAt  string            `json:"started_at"`
	EndedAt    string            `json:"ended_at"`
	ExitCode   int               `json:"exit_code"`
	TestCounts map[string]int    `json:"test_counts"`
	SkipNames  []string          `json:"skip_names"`
	Artifacts  map[string]string `json:"artifact_hashes"`
	Failure    string            `json:"failure"`
}

// repoRoot is the backend module root, resolved from the test's location.
func repoRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	root := filepath.Dir(filepath.Dir(wd))
	if fi, err := os.Stat(filepath.Join(root, "go.mod")); err != nil || fi.IsDir() {
		t.Fatalf("backend module root not found at %s", root)
	}
	return root
}

// runGate runs `make <target>` inside a disposable temp working directory that
// contains a copied Makefile plus the fixture inputs the caller seeded, and
// captures stdout/stderr. The real repo tree is never mutated: make runs with
// -f against the copy and the stub is read-only by construction.
func runGate(t *testing.T, root, target string) (stdout, stderr string, err error) {
	t.Helper()
	cmd := exec.Command("make", "-f", filepath.Join(root, "Makefile"), target)
	cmd.Dir = root
	var out, errBuf strings.Builder
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	err = cmd.Run()
	return out.String(), errBuf.String(), err
}

// parseReceipt decodes exactly one JSON receipt line from stdout, skipping
// make's recipe echo lines by scanning for the first line beginning with
// '{"gate"' — go test -json events and captured logs are never receipts.
func parseReceipt(t *testing.T, stdout string) receipt {
	t.Helper()
	var jsonLine string
	for _, line := range strings.Split(stdout, "\n") {
		if strings.HasPrefix(line, `{"gate"`) {
			jsonLine = line
			break
		}
	}
	if jsonLine == "" {
		t.Fatalf("no JSON receipt found in output: %q", stdout)
	}
	var r receipt
	if err := json.Unmarshal([]byte(jsonLine), &r); err != nil {
		t.Fatalf("decode receipt %q: %v", jsonLine, err)
	}
	return r
}

func receiptLine(t *testing.T, stdout string) string {
	t.Helper()
	for _, line := range strings.Split(stdout, "\n") {
		if strings.HasPrefix(line, `{"gate"`) {
			return line
		}
	}
	t.Fatalf("no JSON receipt found in output: %q", stdout)
	return ""
}

// fixtureInputs is the common superset every fixture copies into its temp dir
// (sqlc.yaml included so the sqlc row shares one input list).
var fixtureInputs = []string{"Makefile", "go.mod", "go.sum", "sqlc.yaml", "cmd", "internal", "db", "scripts"}

// copyTree copies the named paths from root into dst preserving relative
// structure (cp -a over each path; destination parents are created first).
func copyTree(t *testing.T, root, dst string, rels ...string) {
	t.Helper()
	for _, rel := range rels {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(dst, rel)), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", rel, err)
		}
		if out, err := exec.Command("cp", "-a", filepath.Join(root, rel), filepath.Join(dst, rel)).CombinedOutput(); err != nil {
			t.Fatalf("copy %s: %v: %s", rel, err, out)
		}
	}
}

// seedEdit rewrites one copied file via a single strings.Replace.
func seedEdit(t *testing.T, dir, rel, old, new string) {
	t.Helper()
	p := filepath.Join(dir, rel)
	src, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("seed %s: %v", rel, err)
	}
	if !strings.Contains(string(src), old) {
		t.Fatalf("seed %s: anchor %q not found", rel, old)
	}
	if err := os.WriteFile(p, []byte(strings.Replace(string(src), old, new, 1)), 0o644); err != nil {
		t.Fatalf("seed %s: %v", rel, err)
	}
}

// seedFile writes one new file into the copy.
func seedFile(t *testing.T, dir, rel, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, rel)), 0o755); err != nil {
		t.Fatalf("seed dir %s: %v", rel, err)
	}
	if err := os.WriteFile(filepath.Join(dir, rel), []byte(content), 0o644); err != nil {
		t.Fatalf("seed %s: %v", rel, err)
	}
}

// mutationFixture is one independently named violation class from task 7.1.
type mutationFixture struct {
	name   string // "<target>: <violation class>" — the class name pinned by RED
	target string
	extra  []string // additional inputs copied from root (e.g. ".env")
	seed   func(t *testing.T, dir string)
}

const (
	// fixtureFailTest seeds a failing unit test into a copied package.
	fixtureFailTest = `package httpjson

import "testing"

func TestFixtureMustFail(t *testing.T) { t.Fatal("seeded") }
`
	// fixtureRacePkg seeds a small package with a deterministic data race.
	fixtureRacePkg = `package fixturerace

import (
	"sync"
	"testing"
)

func TestFixtureRace(t *testing.T) {
	var n int
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			n++
		}()
	}
	wg.Wait()
	_ = n
}
`
	fixtureSkipPkg = `package fixtureskip

import "testing"

func TestFixtureSkip(t *testing.T) { t.Skip("fixture: skip evidence is rejected") }
`
)

func mutationFixtures() []mutationFixture {
	return []mutationFixture{
		{name: "gate-build: build break", target: "gate-build", seed: func(t *testing.T, d string) {
			seedEdit(t, d, filepath.Join("internal", "runtime", "server", "server.go"), "func ", "func !!!broken ")
		}},
		{name: "gate-vet: vet finding", target: "gate-vet", seed: func(t *testing.T, d string) {
			seedEdit(t, d, filepath.Join("cmd", "migrate", "main.go"), "package main", "package main\n\nimport \"fmt\"")
			seedEdit(t, d, filepath.Join("cmd", "migrate", "main.go"), "func main() {", "func main() { var x int; _ = fmt.Sprintf(\"static\", x)")
		}},
		{name: "gate-fmt: unformatted file", target: "gate-fmt", seed: func(t *testing.T, d string) {
			seedFile(t, d, filepath.Join("scripts", "closure", "gofmt_target.go"), "package closure\n\nfunc Unformatted( ) int {\nreturn\t1\n}\n")
		}},
		{name: "gate-unit: failing unit test", target: "gate-unit", seed: func(t *testing.T, d string) {
			seedFile(t, d, filepath.Join("internal", "shared", "httpjson", "zz_fixture_test.go"), fixtureFailTest)
		}},
		{name: "gate-race: unsynchronized counter", target: "gate-race", seed: func(t *testing.T, d string) {
			// Seed into a covered package: the race gate races the WS6C-proven packages, so the violation must live inside one of them.
			seedFile(t, d, filepath.Join("internal", "runtime", "middleware", "zz_fixture_race_test.go"), "package middleware_test\n\n"+strings.TrimPrefix(fixtureRacePkg, "package fixturerace\n\n"))
		}},
		{name: "gate-race: skipped test", target: "gate-race", seed: func(t *testing.T, d string) {
			seedFile(t, d, filepath.Join("internal", "runtime", "middleware", "zz_fixture_skip_test.go"), strings.Replace(fixtureSkipPkg, "package fixtureskip", "package middleware_test", 1))
		}},
		{name: "gate-integration: emitted skip", target: "gate-integration", extra: []string{".env"}, seed: func(t *testing.T, d string) {
			seedFile(t, d, filepath.Join("internal", "fixtureskip", "skip_test.go"), fixtureSkipPkg)
		}},
		{name: "gate-migrations: round-trip break", target: "gate-migrations", extra: []string{".env"}, seed: func(t *testing.T, d string) {
			seedFile(t, d, filepath.Join("db", "migrations", "00001_init.up.sql"), "SELECT !!!broken_migration_sql;\n")
		}},
		{name: "gate-sqlc: sqlc drift", target: "gate-sqlc", seed: func(t *testing.T, d string) {
			seedEdit(t, d, filepath.Join("db", "queries", "industries.sql"), "SELECT", "SELECT DISTINCT")
		}},
		{name: "closure-gate: aggregate build break", target: "closure-gate", seed: func(t *testing.T, d string) {
			seedEdit(t, d, filepath.Join("internal", "shared", "httpjson", "httpjson.go"), "package httpjson", "package httpjson\n\nvar !!!brokenAggregate = undefinedSymbol")
		}},
	}
}

// requireGateFails: a mutated fixture MUST fail the gate — non-zero process exit,
// a failure receipt whose exit_code mirrors it (skip-only failures included), and a self-verifying receipt_integrity digest.
func requireGateFails(t *testing.T, root, target string) {
	t.Helper()
	stdout, stderr, err := runGate(t, root, target)
	if err == nil {
		r := parseReceipt(t, stdout)
		t.Fatalf("mutated fixture was incorrectly reported as pass: gate=%q status=%q exit=0 receipt=%s stderr=%q",
			r.Gate, r.Status, stdout, stderr)
	}
	r := parseReceipt(t, stdout)
	if r.Status == "pass" && r.ExitCode == 0 {
		t.Fatalf("gate exited non-zero but the receipt still records pass: %s", stdout)
	}
	if r.Status != "fail" {
		t.Fatalf("failure receipt status = %q, want fail (receipt=%s)", r.Status, stdout)
	}
	if r.ExitCode == 0 {
		t.Fatalf("failure receipt records exit_code 0; want the gate's nonzero process exit mirrored: %s", stdout)
	}
	verifyReceiptIntegrity(t, stdout)
	t.Logf("gate correctly failed on the mutated fixture: %s", r.Failure)
}

// verifyReceiptIntegrity recomputes the receipt's self-digest: receipt_integrity must equal the sha256 of the receipt line with artifact_hashes reset to {} (documented substitution).
func verifyReceiptIntegrity(t *testing.T, stdout string) {
	t.Helper()
	line := receiptLine(t, stdout)
	stripped := regexp.MustCompile(`"artifact_hashes":\{[^{}]*\}`).ReplaceAllString(line, `"artifact_hashes":{}`)
	sum := sha256.Sum256([]byte(stripped))
	var r receipt
	if err := json.Unmarshal([]byte(line), &r); err != nil {
		t.Fatalf("decode receipt: %v", err)
	}
	if want := "sha256:" + hex.EncodeToString(sum[:]); r.Artifacts["receipt_integrity"] != want {
		t.Fatalf("receipt_integrity mismatch:\n recorded:  %s\n recomputed: %s", r.Artifacts["receipt_integrity"], want)
	}
	if !strings.HasPrefix(r.Artifacts["worktree_state"], "sha256:") {
		t.Fatalf("receipt must bind a sha256 worktree_state, got %q", r.Artifacts["worktree_state"])
	}
}

func TestGate_MutationFixturesForceGateFailure(t *testing.T) {
	root := repoRoot(t)
	for _, f := range mutationFixtures() {
		t.Run(f.name, func(t *testing.T) {
			dir := t.TempDir()
			copyTree(t, root, dir, append(fixtureInputs, f.extra...)...)
			f.seed(t, dir)
			requireGateFails(t, dir, f.target)
		})
	}
}

// TestGateReceipts_RealContractAndDelegation is the GREEN receipt control: every target delegates
// to the real gate script (make -n), and a live fast gate emits a deterministic self-verifying receipt.
func TestGateReceipts_RealContractAndDelegation(t *testing.T) {
	root := repoRoot(t)
	for _, gate := range gateTargets {
		t.Run(gate+"/delegates_to_real_script", func(t *testing.T) {
			cmd := exec.Command("make", "-n", gate)
			cmd.Dir = root
			out, err := cmd.CombinedOutput()
			if err != nil || !strings.Contains(string(out), "scripts/closure/gate "+gate) {
				t.Fatalf("make -n %s must delegate to scripts/closure/gate: err=%v out=%s", gate, err, out)
			}
		})
	}
	t.Run("gate-fmt/real_receipt_contract", func(t *testing.T) {
		out1, _, err := runGate(t, root, "gate-fmt")
		if err != nil {
			t.Fatalf("make gate-fmt: %v (the real tree must pass its own fmt gate)", err)
		}
		r := parseReceipt(t, out1)
		if r.Gate != "gate-fmt" || r.Status != "pass" || r.ExitCode != 0 {
			t.Errorf("gate-fmt receipt = %+v (want gate=gate-fmt status=pass exit_code=0)", r)
		}
		if r.Tool != "gofmt -l ." || r.Command != "make gate-fmt" {
			t.Errorf("gate-fmt receipt tool/command = %q/%q (want gofmt -l . / make gate-fmt)", r.Tool, r.Command)
		}
		if r.Commit == "" || r.Tree == "" || r.StartedAt == "" || r.EndedAt == "" {
			t.Errorf("gate-fmt receipt identity/timestamps incomplete: %+v", r)
		}
		if len(r.SkipNames) != 0 || r.Failure != "" {
			t.Errorf("passing receipt must carry zero skips and empty failure: %+v", r)
		}
		data, err := os.ReadFile(filepath.Join(root, "quality", "receipts", "gate-fmt.json"))
		if err != nil {
			t.Fatalf("read receipt file: %v", err)
		}
		if got := strings.TrimSpace(string(data)); got != receiptLine(t, out1) {
			t.Errorf("receipt file does not mirror stdout:\n file:   %s\n stdout: %s", got, receiptLine(t, out1))
		}
		out2, _, err2 := runGate(t, root, "gate-fmt")
		if err2 != nil {
			t.Fatalf("make gate-fmt (second run): %v", err2)
		}
		r2 := parseReceipt(t, out2)
		if r2.Gate != r.Gate || r2.Status != r.Status || r2.Tool != r.Tool || r2.Command != r.Command || r2.Commit != r.Commit || r2.Tree != r.Tree {
			t.Errorf("stable receipt fields not deterministic:\n first:  %+v\n second: %+v", r, r2)
		}
	})
}

// TestGate_DBPreflight_NeverExecutesDotenv (R1): a malicious .env (valid unreachable DSN + shell side effect) must fail the gate but NOT create the marker.
func TestGate_DBPreflight_NeverExecutesDotenv(t *testing.T) {
	root, dir := repoRoot(t), t.TempDir()
	copyTree(t, root, dir, fixtureInputs...)
	seedFile(t, dir, ".env", "DATABASE_URL=postgres://fixture:fixture@127.0.0.1:1/fixture?sslmode=disable\ntouch \"$PWD/pwned-marker\"\n")
	requireGateFails(t, dir, "gate-integration")
	if _, err := os.Stat(filepath.Join(dir, "pwned-marker")); err == nil {
		t.Fatal(".env side-effect marker was created: dotenv was sourced as shell, not parsed as data")
	}
}

// TestGate_GoFmtFailureFailsGate (R3): a failing gofmt -l command (exit status discarded by the mutation) must fail the gate.
func TestGate_GoFmtFailureFailsGate(t *testing.T) {
	root, dir := repoRoot(t), t.TempDir()
	copyTree(t, root, dir, fixtureInputs...)
	seedEdit(t, dir, filepath.Join("scripts", "closure", "gate"), `unformatted="$(gofmt -l .)"`, `unformatted="$(false)"`)
	requireGateFails(t, dir, "gate-fmt")
}
