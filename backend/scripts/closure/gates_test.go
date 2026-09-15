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
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

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
// -f against the copy and the stub is read-only by construction. Optional env
// overrides (used by TRIANGULATE tests to bind GATE_GIT_DIR to a disposable repo).
func runGate(t *testing.T, root, target string, env ...string) (stdout, stderr string, err error) {
	t.Helper()
	cmd := exec.Command("make", "-f", filepath.Join(root, "Makefile"), target)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), env...)
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
var fixtureInputs = []string{"Makefile", ".gitignore", "go.mod", "go.sum", "sqlc.yaml", "cmd", "internal", "db", "scripts"}

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
	initDisposableGitRepo(t, dst)
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
	name    string // "<target>: <violation class>" — the class name pinned by RED
	target  string
	prepare func(t *testing.T, dir string)
	seed    func(t *testing.T, dir string)
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

func prepareDBFailureShim(t *testing.T, dir string) {
	t.Helper()
	port := startFakePostgresListener(t)
	seedFile(t, dir, ".env", fmt.Sprintf("DATABASE_URL=postgres://fixture:fixture@127.0.0.1:%d/fixture?sslmode=disable\n", port))
	shimDir := t.TempDir()
	shim := `#!/bin/sh
if [ "$1" = list ]; then echo "github.com/aldrichcode45/peopleflow-vacantes/internal/fixtureskip"; exit 0; fi
if echo "$*" | grep -q -- "TestMigrateBinaryBoundary"; then
  echo '=== RUN   TestMigrateBinaryBoundary'
  echo '--- FAIL: TestMigrateBinaryBoundary (0.00s)'
  exit 1
fi
if echo "$*" | grep -q -- "-json"; then
  echo '{"Action":"skip","Package":"github.com/aldrichcode45/peopleflow-vacantes/internal/fixtureskip","Test":"TestFixtureSkip"}'
fi
exit 0
`
	if err := os.WriteFile(filepath.Join(shimDir, "go"), []byte(shim), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", shimDir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

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
		{name: "gate-integration: emitted skip", target: "gate-integration", prepare: prepareDBFailureShim, seed: func(t *testing.T, d string) {
			seedFile(t, d, filepath.Join("internal", "fixtureskip", "skip_test.go"), fixtureSkipPkg)
		}},
		{name: "gate-migrations: round-trip break", target: "gate-migrations", prepare: prepareDBFailureShim, seed: func(t *testing.T, d string) {
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
		if os.Getenv("GATE_ACTIVE") == "1" && (f.target == "gate-unit" || f.target == "closure-gate") {
			continue
		}
		t.Run(f.name, func(t *testing.T) {
			dir := t.TempDir()
			copyTree(t, root, dir, fixtureInputs...)
			if f.prepare != nil {
				f.prepare(t, dir)
			}
			f.seed(t, dir)
			requireGateFails(t, dir, f.target)
		})
	}
}

func TestGate_UnitRunsClosurePackage(t *testing.T) {
	if os.Getenv("GATE_ACTIVE") == "1" {
		return
	}
	root, dir := repoRoot(t), t.TempDir()
	copyTree(t, root, dir, fixtureInputs...)
	pattern := filepath.Join(dir, "scripts", "closure", "*")
	if out, err := exec.Command("find", dir, "-name", "*_test.go", "!", "-path", pattern, "-delete").CombinedOutput(); err != nil {
		t.Fatalf("remove non-closure tests: %v: %s", err, out)
	}
	seedFile(t, dir, filepath.Join("scripts", "closure", "zz_fixture_test.go"),
		strings.Replace(fixtureFailTest, "package httpjson", "package closure_test", 1))
	requireGateFails(t, dir, "gate-unit")
}

// TestGateReceipts_RealContractAndDelegation is the GREEN receipt control: every target delegates
// to the real gate script (make -n), and a live fast gate emits a deterministic self-verifying receipt.
// Receipt contract runs in a t.TempDir() copy so the real backend/quality/receipts/ directory is
// never replaced by tests.
func TestGateReceipts_RealContractAndDelegation(t *testing.T) {
	root := repoRoot(t)
	realStateBefore := repoSnapshot(t, root)
	for _, gate := range gateTargets {
		t.Run(gate+"/delegates_to_real_script", func(t *testing.T) {
			dir := t.TempDir()
			copyTree(t, root, dir, fixtureInputs...)
			cmd := exec.Command("make", "-n", gate)
			cmd.Dir = dir
			out, err := cmd.CombinedOutput()
			if err != nil || !strings.Contains(string(out), "scripts/closure/gate "+gate) {
				t.Fatalf("make -n %s must delegate in copy: err=%v out=%s", gate, err, out)
			}
		})
	}
	t.Run("gate-fmt/temp_copy_receipt_contract", func(t *testing.T) {
		dir := t.TempDir()
		copyTree(t, root, dir, fixtureInputs...)
		out1, errOut, err := runGate(t, dir, "gate-fmt")
		if err != nil {
			t.Fatalf("gate-fmt (temp copy): %v stderr=%s stdout=%s", err, errOut, out1)
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
		data, err := os.ReadFile(filepath.Join(dir, "quality", "receipts", "gate-fmt.json"))
		if err != nil {
			t.Fatalf("read receipt file: %v", err)
		}
		if got := strings.TrimSpace(string(data)); got != receiptLine(t, out1) {
			t.Errorf("receipt file does not mirror stdout:\n file:   %s\n stdout: %s", got, receiptLine(t, out1))
		}
		out2, _, err2 := runGate(t, dir, "gate-fmt")
		if err2 != nil {
			t.Fatalf("gate-fmt (second run): %v", err2)
		}
		r2 := parseReceipt(t, out2)
		if r2.Gate != r.Gate || r2.Status != r.Status || r2.Tool != r.Tool || r2.Command != r.Command || r2.Commit != r.Commit || r2.Tree != r.Tree {
			t.Errorf("stable receipt fields not deterministic:\n first:  %+v\n second: %+v", r, r2)
		}
		if got := repoSnapshot(t, root); got != realStateBefore {
			t.Errorf("real-root state changed by temp-copy run: before=%s after=%s", realStateBefore, got)
		}
	})
}

func TestGate_ReceiptFailsWithoutGitIdentity(t *testing.T) {
	root, dir := repoRoot(t), t.TempDir()
	copyTree(t, root, dir, fixtureInputs...)
	if err := os.RemoveAll(filepath.Join(dir, ".git")); err != nil {
		t.Fatal(err)
	}
	stdout, _, err := runGate(t, dir, "gate-fmt")
	if err == nil {
		t.Fatalf("gate-fmt without Git identity must fail: %s", stdout)
	}
	r := parseReceipt(t, stdout)
	if r.Status != "fail" || r.ExitCode == 0 || r.Commit != "git:unavailable" || r.Tree != "git:unavailable" || !strings.Contains(r.Failure, "git commit/tree identity unavailable") {
		t.Fatalf("receipt did not fail closed on missing Git identity: %+v", r)
	}
	verifyReceiptIntegrity(t, stdout)
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

// -- TRIANGULATE evidence (task 7.1) --
// Each test below seeds into its own t.TempDir() copy only; the disposable git
// repo used by the stale-receipt fixture is initialized inside that copy
// (initDisposableGitRepo), so the real backend/ tree is never mutated by any
// fixture, and the real backend/quality/receipts/ directory is only read,
// never written by tests.

func requireGateFailsWithMsg(t *testing.T, dir, target string, required ...string) {
	t.Helper()
	stdout, _, err := runGate(t, dir, target)
	if err == nil {
		t.Fatalf("mutated fixture reported pass: stdout=%q", stdout)
	}
	r := parseReceipt(t, stdout)
	if r.Status != "fail" || r.ExitCode == 0 {
		t.Fatalf("receipt must record fail+nonzero exit: %+v", r)
	}
	for _, kw := range required {
		if !strings.Contains(r.Failure, kw) {
			t.Fatalf("failure %q lacked required keyword %q", r.Failure, kw)
		}
	}
	verifyReceiptIntegrity(t, stdout)
}

// initDisposableGitRepo gives every copied fixture stable commit/tree identity.
func initDisposableGitRepo(t *testing.T, dir string) {
	t.Helper()
	for _, args := range [][]string{
		{"init", "--initial-branch=main", dir},
		{"-C", dir, "config", "user.email", "tri@example.com"},
		{"-C", dir, "config", "user.name", "T"},
		{"-C", dir, "config", "commit.gpgsign", "false"},
		{"-C", dir, "add", "-A"},
		{"-C", dir, "commit", "-m", "baseline"},
	} {
		if out, err := exec.Command("git", args...).CombinedOutput(); err != nil {
			t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, out)
		}
	}
	if out, err := exec.Command("git", "-C", dir, "status", "--porcelain").CombinedOutput(); err != nil || len(strings.TrimSpace(string(out))) > 0 {
		t.Fatalf("disposable repo not clean: err=%v out=%s", err, out)
	}
}

func repoSnapshot(t *testing.T, root string) string {
	t.Helper()
	cmd := exec.Command("git", "-C", root, "status", "--porcelain", "--untracked-files=all")
	status, err := cmd.Output()
	if err != nil {
		t.Fatalf("git status: %v", err)
	}
	cmd = exec.Command("git", "-C", root, "diff", "HEAD")
	diff, err := cmd.Output()
	if err != nil {
		t.Fatalf("git diff: %v", err)
	}
	h := sha256.New()
	h.Write(status)
	h.Write(diff)
	rd := filepath.Join(root, "quality", "receipts")
	filepath.Walk(rd, func(p string, info os.FileInfo, err error) error {
		if err == nil && info != nil && !info.IsDir() {
			b, e := os.ReadFile(p)
			if e == nil {
				fmt.Fprintf(h, "%s:%x", p, sha256.Sum256(b))
			}
		}
		return nil
	})
	return hex.EncodeToString(h.Sum(nil))
}

func TestGate_StaleReceiptIsRejected(t *testing.T) {
	root, dir := repoRoot(t), t.TempDir()
	assertRealStateRestored(t, root, repoSnapshot(t, root))
	copyTree(t, root, dir, fixtureInputs...)
	env := []string{"GATE_GIT_DIR=" + dir}

	out1, errOut, err := runGate(t, dir, "gate-build", env...)
	if err != nil {
		t.Fatalf("gate-build (first run): %v stderr=%s stdout=%s", err, errOut, out1)
	}
	r1 := parseReceipt(t, out1)
	if r1.Status != "pass" || r1.ExitCode != 0 || r1.Artifacts["worktree_state"] == "" {
		t.Fatalf("first gate-build must pass with worktree_state: %+v", r1)
	}

	seedEdit(t, dir, "Makefile", "# WS7A GREEN", "# WS7A GREEN (tracked disposable mutation)")
	fakeGo := filepath.Join(t.TempDir(), "go")
	if err := os.WriteFile(fakeGo, []byte("#!/bin/sh\necho independent build failed >&2\nexit 42\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	pathEnv := "PATH=" + filepath.Dir(fakeGo) + string(os.PathListSeparator) + os.Getenv("PATH")
	out2, _, err2 := runGate(t, dir, "gate-build", append(env, pathEnv)...)
	if err2 == nil {
		t.Fatalf("gate must fail when stale and build fail independently; stdout=%q", out2)
	}
	r2 := parseReceipt(t, out2)
	if r2.Status != "fail" || r2.ExitCode == 0 || !strings.Contains(r2.Failure, "stale receipt:") || !strings.Contains(r2.Failure, "check_exit=42") || !strings.Contains(r2.Failure, "independent build failed") {
		t.Fatalf("failure receipt must retain stale and independent check diagnostics: %+v", r2)
	}
	verifyReceiptIntegrity(t, out2)

	out3, _, err3 := runGate(t, dir, "gate-build", env...)
	if err3 == nil {
		t.Fatalf("stale receipt retry must remain blocked: %s", out3)
	}
	r3 := parseReceipt(t, out3)
	if !strings.Contains(r3.Failure, "stale receipt:") || r3.Artifacts["worktree_state"] != r1.Artifacts["worktree_state"] {
		t.Fatalf("retry must preserve the stale tree binding: first=%+v retry=%+v", r1, r3)
	}
	if err := os.Remove(filepath.Join(dir, "quality", "receipts", "gate-build.json")); err != nil {
		t.Fatal(err)
	}
	out4, errOut, err4 := runGate(t, dir, "gate-build", env...)
	if err4 != nil {
		t.Fatalf("explicit receipt removal must allow recovery: %v stderr=%s stdout=%s", err4, errOut, out4)
	}
	if r4 := parseReceipt(t, out4); r4.Status != "pass" || r4.ExitCode != 0 {
		t.Fatalf("recovered gate-build must pass: %+v", r4)
	}
}

func assertRealStateRestored(t *testing.T, root, before string) {
	t.Helper()
	t.Cleanup(func() {
		if after := repoSnapshot(t, root); after != before {
			t.Errorf("real repository state changed: before=%s after=%s", before, after)
		}
	})
}

func TestGate_IntegrationSkipEmitsSkipSpecificFailure(t *testing.T) {
	root, dir := repoRoot(t), t.TempDir()
	assertRealStateRestored(t, root, repoSnapshot(t, root))
	copyTree(t, root, dir, fixtureInputs...)
	prepareDBFailureShim(t, dir)
	seedFile(t, dir, filepath.Join("internal", "fixtureskip", "skip_test.go"), fixtureSkipPkg)
	stdout, _, err := runGate(t, dir, "gate-integration")
	if err == nil {
		t.Fatal("skip fixture must fail")
	}
	r := parseReceipt(t, stdout)
	requireGateFailsWithMsg(t, dir, "gate-integration", "skip", "Action:skip")
	if len(r.SkipNames) != 1 || r.SkipNames[0] != "TestFixtureSkip" {
		t.Fatalf("SkipNames=%v, want exactly [TestFixtureSkip]", r.SkipNames)
	}
}

func TestGate_SqlcDriftEmitsDriftSpecificFailure(t *testing.T) {
	root, dir := repoRoot(t), t.TempDir()
	assertRealStateRestored(t, root, repoSnapshot(t, root))
	copyTree(t, root, dir, fixtureInputs...)
	stdout, _, err := runGate(t, dir, "gate-sqlc")
	if err != nil {
		t.Fatalf("clean gate-sqlc: %v", err)
	}
	if clean := parseReceipt(t, stdout); clean.Status != "pass" || clean.ExitCode != 0 {
		t.Fatalf("clean receipt: status=%q exit_code=%d, want pass/0", clean.Status, clean.ExitCode)
	}
	seedEdit(t, dir, filepath.Join("db", "queries", "industries.sql"), "SELECT", "SELECT DISTINCT")
	requireGateFailsWithMsg(t, dir, "gate-sqlc", "sqlc drift", "differ", "internal/db")
}

func TestGate_UnreachablePostgresFailsAtPreflight(t *testing.T) {
	root, dir := repoRoot(t), t.TempDir()
	assertRealStateRestored(t, root, repoSnapshot(t, root))
	copyTree(t, root, dir, fixtureInputs...)
	seedFile(t, dir, ".env", "DATABASE_URL=postgres://fixture:fixture@127.0.0.1:1/fixture?sslmode=disable\n")
	requireGateFailsWithMsg(t, dir, "gate-integration", "preflight", "connection probe")
}

func TestGate_MissingDatabaseURLFailsAtPreflight(t *testing.T) {
	root, dir := repoRoot(t), t.TempDir()
	assertRealStateRestored(t, root, repoSnapshot(t, root))
	copyTree(t, root, dir, fixtureInputs...)
	seedFile(t, dir, ".env", "\n")
	requireGateFailsWithMsg(t, dir, "gate-integration", "preflight", "DATABASE_URL")
}

// TestGate_AllMutationsUseTempCopies is a deterministic before/after snapshot of
// the real backend worktree (forbidden paths) and the real quality/receipts/
// directory. It does NOT skip when the candidate tree is dirty; instead it
// asserts that running every mutation fixture leaves both sets byte-identical.
// Pre-existing ignored receipts are preserved exactly.
func TestGate_AllMutationsUseTempCopies(t *testing.T) {
	root := repoRoot(t)
	realStateBefore := repoSnapshot(t, root)
	for _, f := range mutationFixtures() {
		if os.Getenv("GATE_ACTIVE") == "1" && (f.target == "gate-unit" || f.target == "closure-gate") {
			continue
		}
		t.Run(f.name+"/no_real_root_residue", func(t *testing.T) {
			before := repoSnapshot(t, root)
			dir := t.TempDir()
			copyTree(t, root, dir, fixtureInputs...)
			if f.prepare != nil {
				f.prepare(t, dir)
			}
			f.seed(t, dir)
			runGate(t, dir, f.target)
			if after := repoSnapshot(t, root); after != before {
				t.Fatalf("real repository changed after %s: before=%s after=%s", f.name, before, after)
			}
		})
	}
	if got := repoSnapshot(t, root); got != realStateBefore {
		t.Fatalf("real-root state drifted: before=%s after=%s", realStateBefore, got)
	}
}

// TestGate_DBPreflightBindsValidatedDotenvURL — bounded RDD correction for review-05df619fccd92f3d,
// extended for the task-7.1 REFACTOR remediation (gate-integration `go tool goose up` self-containment).
//
// Findings covered:
//   - R1-DB-PREFLIGHT-SUBSHELL, R3-dotenv-not-exported, R4-db-preflight-binding: the gate script
//     (a) parses .env's DATABASE_URL, (b) probes that exact URL, (c) keeps the parsed/validated
//     DSN in the caller shell as `validated_database_url` (exported), (d) invokes goose,
//     integration package selection, integration tests, and migration boundary tests with
//     explicit `DATABASE_URL="$validated_database_url"` binding so an inherited DATABASE_URL
//     cannot redirect execution, and (e) preserves `database preflight:` diagnostics directly
//     from the function without a sed pipeline that loses them.
//   - R-REFACTOR-GOOSE-EXPLICIT (task-7.1 REFACTOR blocker from the first disposable-PostgreSQL
//     execution): the `go tool goose up` child invocation must receive explicit per-child
//     environment bindings so it never relies on ambient GOOSE_DRIVER/GOOSE_DBSTRING/
//     GOOSE_MIGRATION_DIR — DATABASE_URL=<validated dotenv DSN>, GOOSE_DRIVER=postgres,
//     GOOSE_DBSTRING=<same validated dotenv DSN>, GOOSE_MIGRATION_DIR=db/migrations.
//
// This test runs both gate-integration and gate-migrations with dotenv-only and
// conflicting inherited DATABASE_URL and GOOSE_*. A fake `go` shim in PATH records every
// child invocation's environment (TSV: child-invocation-no<TAB>DATABASE_URL<TAB>GOOSE_DRIVER<TAB>GOOSE_DBSTRING<TAB>GOOSE_MIGRATION_DIR<TAB>args); a local TCP listener passes the dotenv probe.
// Every recorded child must carry the dotenv URL exactly and the goose child specifically
// must carry the four required values.
func TestGate_DBPreflightBindsValidatedDotenvURL(t *testing.T) {
	root := repoRoot(t)
	port := startFakePostgresListener(t)
	dotenvURL := fmt.Sprintf("postgres://dotenv:dotenv@127.0.0.1:%d/dotenv?sslmode=disable", port)
	cases := []struct {
		name       string
		target     string
		inheritURL string
		// inherited GOOSE_* values — present if non-empty, absent when empty. The test sets them
		// on the parent process and explicitly unsets them for the dotenv-only rows so RED is
		// deterministic regardless of how the harness itself was invoked.
		inheritGooseDriver string
		inheritGooseDB     string
		inheritGooseDir    string
	}{
		{"gate-integration/dotenv-only", "gate-integration", "", "", "", ""},
		{"gate-integration/conflicting-inherited", "gate-integration",
			"postgres://inherited:inherited@127.0.0.1:1/inherited?sslmode=disable",
			"inherited-driver-from-parent", "postgres://inherited:inherited@127.0.0.1:1/inherited?sslmode=disable", "/tmp/inherited-migrations"},
		{"gate-migrations/dotenv-only", "gate-migrations", "", "", "", ""},
		{"gate-migrations/conflicting-inherited", "gate-migrations",
			"postgres://inherited:inherited@127.0.0.1:1/inherited?sslmode=disable",
			"inherited-driver-from-parent", "postgres://inherited:inherited@127.0.0.1:1/inherited?sslmode=disable", "/tmp/inherited-migrations"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			copyTree(t, root, dir, fixtureInputs...)
			// .env wraps the dotenv DSN in current supported double quotes.
			seedFile(t, dir, ".env", fmt.Sprintf("DATABASE_URL=%q\n", dotenvURL))
			// Replace `go` with a shim that records per-child env (DATABASE_URL + the three
			// GOOSE_* bindings) plus the full argv on one TSV line so the test can prove the
			// goose child specifically receives the validated bindings. The shim also emits
			// the minimum artifacts the gate parser consumes from each command (list output,
			// migrations lifecycle lines, integration -json event) and otherwise exits 0.
			shimDir := t.TempDir()
			recorded := filepath.Join(shimDir, "recorded.tsv")
			shimContent := fmt.Sprintf(`#!/bin/sh
# Record per-child env + argv on one TSV line. The first positional is treated as the
# invocation tag so the test can identify which child is which; $0 (the program name)
# is the shim path by construction, $1 is the first subcommand/flag (e.g. list, -json, test).
# We DO NOT shift before recording — the tag column must match the original argv.
printf '%%s\t%%s\t%%s\t%%s\t%%s\t%%s\n' "$1" "$DATABASE_URL" "$GOOSE_DRIVER" "$GOOSE_DBSTRING" "$GOOSE_MIGRATION_DIR" "$*" >> "%s"
if [ "$1" = list ]; then echo "github.com/aldrichcode45/peopleflow-vacantes/cmd/api"; exit 0; fi
if echo "$*" | grep -q -- "TestMigrateBinaryBoundary"; then
  echo '=== RUN   TestMigrateBinaryBoundary'
  echo '--- PASS: TestMigrateBinaryBoundary (0.00s)'
  exit 0
fi
if echo "$*" | grep -q -- "-json"; then
  echo '{"Time":"2024-01-01T00:00:00Z","Action":"pass","Package":"github.com/aldrichcode45/peopleflow-vacantes/cmd/api"}'
  exit 0
fi
exit 0
`, recorded)
			shimPath := filepath.Join(shimDir, "go")
			if err := os.WriteFile(shimPath, []byte(shimContent), 0o755); err != nil {
				t.Fatal(err)
			}
			// Save and restore PATH/DATABASE_URL/GOOSE_*: the test process's os.Setenv lets
			// the gate's children see the shim and the chosen inherited env cleanly.
			oldPath, hadPath := os.LookupEnv("PATH")
			oldURL, hadURL := os.LookupEnv("DATABASE_URL")
			oldDriver, hadDriver := os.LookupEnv("GOOSE_DRIVER")
			oldDB, hadDB := os.LookupEnv("GOOSE_DBSTRING")
			oldDir, hadDir := os.LookupEnv("GOOSE_MIGRATION_DIR")
			t.Cleanup(func() {
				restoreEnv("PATH", oldPath, hadPath)
				restoreEnv("DATABASE_URL", oldURL, hadURL)
				restoreEnv("GOOSE_DRIVER", oldDriver, hadDriver)
				restoreEnv("GOOSE_DBSTRING", oldDB, hadDB)
				restoreEnv("GOOSE_MIGRATION_DIR", oldDir, hadDir)
			})
			_ = os.Setenv("PATH", shimDir+string(os.PathListSeparator)+oldPath)
			_ = os.Unsetenv("DATABASE_URL")
			if tc.inheritURL != "" {
				_ = os.Setenv("DATABASE_URL", tc.inheritURL)
			}
			if tc.inheritGooseDriver != "" {
				_ = os.Setenv("GOOSE_DRIVER", tc.inheritGooseDriver)
			} else {
				_ = os.Unsetenv("GOOSE_DRIVER")
			}
			if tc.inheritGooseDB != "" {
				_ = os.Setenv("GOOSE_DBSTRING", tc.inheritGooseDB)
			} else {
				_ = os.Unsetenv("GOOSE_DBSTRING")
			}
			if tc.inheritGooseDir != "" {
				_ = os.Setenv("GOOSE_MIGRATION_DIR", tc.inheritGooseDir)
			} else {
				_ = os.Unsetenv("GOOSE_MIGRATION_DIR")
			}
			stdout, stderr, err := runGate(t, dir, tc.target)
			if err != nil {
				t.Fatalf("gate must pass with a valid dotenv URL: target=%s inherit=%q err=%v\nstdout=%s\nstderr=%s",
					tc.target, tc.inheritURL, err, stdout, stderr)
			}
			data, err := os.ReadFile(recorded)
			if err != nil {
				t.Fatalf("go shim never recorded a child invocation: %v", err)
			}
			body := strings.TrimSpace(string(data))
			if body == "" {
				t.Fatalf("go shim recorded zero invocations; expected goose/integration/package selection/migration children to all run")
			}
			// Order is deterministic per gate target: gate-integration runs goose up FIRST
			// (child #1), then `go list` (child #2), then `go test -json` (child #3).
			// gate-migrations runs only the boundary test. The first-invocation number per
			// child is appended by the shim itself.
			var gooseOK bool
			for i, line := range strings.Split(body, "\n") {
				fields := strings.SplitN(line, "\t", 6)
				if len(fields) != 6 {
					t.Fatalf("child #%d recorded line has %d fields, want 6: %q", i+1, len(fields), line)
				}
				_, recordedURL, recordedDriver, recordedDB, recordedDir, args := fields[0], fields[1], fields[2], fields[3], fields[4], fields[5]
				if recordedURL != dotenvURL {
					t.Fatalf("child #%d received DATABASE_URL=%q; want %q (validated dotenv) so an inherited URL cannot redirect execution\nargs=%s",
						i+1, recordedURL, dotenvURL, args)
				}
				// Only the `go tool goose up` child is required to carry the GOOSE_*
				// bindings — go list and go test don't need them. We detect that child
				// by argv containing "goose" with the "up" subcommand.
				if strings.Contains(args, " goose ") && strings.Contains(args, " up") {
					if recordedDriver != "postgres" {
						t.Fatalf("goose child #%d received GOOSE_DRIVER=%q; want %q\nargs=%s", i+1, recordedDriver, "postgres", args)
					}
					if recordedDB != dotenvURL {
						t.Fatalf("goose child #%d received GOOSE_DBSTRING=%q; want %q (same as validated dotenv)\nargs=%s", i+1, recordedDB, dotenvURL, args)
					}
					if recordedDir != "db/migrations" {
						t.Fatalf("goose child #%d received GOOSE_MIGRATION_DIR=%q; want %q\nargs=%s", i+1, recordedDir, "db/migrations", args)
					}
					gooseOK = true
				}
			}
			if tc.target == "gate-integration" && !gooseOK {
				t.Fatalf("recorded invocations did not include `go tool goose up`; cannot prove R-REFACTOR-GOOSE-EXPLICIT binding.\nrecorded:\n%s", body)
			}
		})
	}
}

// restoreEnv puts the test process back exactly as it was before os.Setenv/os.Unsetenv.
func restoreEnv(key, oldVal string, had bool) {
	if had {
		_ = os.Setenv(key, oldVal)
	} else {
		_ = os.Unsetenv(key)
	}
}

// startFakePostgresListener binds a TCP listener on 127.0.0.1:0 that accepts any
// connection and closes it immediately, letting db_probe's socket.create_connection
// succeed while the actual database remains absent.
func startFakePostgresListener(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	port := ln.Addr().(*net.TCPAddr).Port
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			_ = c.Close()
		}
	}()
	return port
}
