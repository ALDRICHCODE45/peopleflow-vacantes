// Package closure_test — WS7A RED mutation fixtures, compact table-driven form.
//
// Nine independently named violation classes (task 7.1) are each seeded into a
// TEMPORARY COPY of the tree inputs (t.TempDir; the working tree is never
// mutated) and the matching gate target must FAIL with a failure receipt.
// Against the RED pass-through stub every gate reports {"status":"pass"} on a
// mutated fixture, so every mutation row fails behaviorally — that is the RED
// evidence; the receipt contract test is the control that passes at RED.
package closure_test

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
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
	Gate     string `json:"gate"`
	Status   string `json:"status"`
	Tool     string `json:"tool"`
	ExitCode int    `json:"exit_code"`
	Failure  string `json:"failure,omitempty"`
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
// make's recipe echo lines by scanning for the first line beginning with '{'.
func parseReceipt(t *testing.T, stdout string) receipt {
	t.Helper()
	var jsonLine string
	for _, line := range strings.Split(stdout, "\n") {
		if strings.HasPrefix(line, "{") {
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
	// fixtureSkipPkg seeds a test that emits an integration Action:"skip" when
	// DATABASE_URL is unset (R4: zero unexpected skips).
	fixtureSkipPkg = `package fixtureskip

import (
	"os"
	"testing"
)

func TestFixtureSkip(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("integration fixture: DATABASE_URL unset")
	}
}
`
)

// mutationFixtures returns the nine rows, one per violation class. Every seed
// operates only inside the fixture's t.TempDir copy.
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
			seedFile(t, d, filepath.Join("internal", "fixturerace", "race_test.go"), fixtureRacePkg)
		}},
		{name: "gate-integration: emitted skip", target: "gate-integration", seed: func(t *testing.T, d string) {
			seedFile(t, d, filepath.Join("internal", "fixtureskip", "skip_test.go"), fixtureSkipPkg)
		}},
		{name: "gate-migrations: round-trip break", target: "gate-migrations", seed: func(t *testing.T, d string) {
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

// requireGateFails is the core RED assertion: a mutated fixture MUST make the
// gate fail (non-zero exit AND a non-pass receipt). Against the stub the gate
// passes and this helper fails the test — the exact behavioral RED reason.
func requireGateFails(t *testing.T, root, target string) {
	t.Helper()
	stdout, stderr, err := runGate(t, root, target)
	if err == nil {
		r := parseReceipt(t, stdout)
		t.Fatalf("mutated fixture was incorrectly reported as pass: gate=%q status=%q exit=0 receipt=%s stderr=%q",
			r.Gate, r.Status, stdout, stderr)
	}
	if r := parseReceipt(t, stdout); r.Status == "pass" && r.ExitCode == 0 {
		t.Fatalf("gate exited non-zero but the receipt still records pass: %s", stdout)
	}
}

// TestGate_MutationFixturesFailAgainstStub drives the nine violation classes
// through one scenario table; each subtest is one independently named class.
func TestGate_MutationFixturesFailAgainstStub(t *testing.T) {
	root := repoRoot(t)
	for _, f := range mutationFixtures() {
		t.Run(f.name, func(t *testing.T) {
			dir := t.TempDir()
			copyTree(t, root, dir, fixtureInputs...)
			f.seed(t, dir)
			requireGateFails(t, dir, f.target)
		})
	}
}

// TestGateReceipts_ShapeAndDeterminism is the control that passes at RED: per
// gate it pins the stub's contract through the make layer — deterministic
// pass receipt, exit 0, exactly one JSON line with the fixed fields, and the
// target existing and delegating to the stub. GREEN must evolve this alongside
// the real scripts.
func TestGateReceipts_ShapeAndDeterminism(t *testing.T) {
	root := repoRoot(t)
	for _, gate := range gateTargets {
		t.Run(gate+"/receipt_contract", func(t *testing.T) {
			out1, _, err := runGate(t, root, gate)
			if err != nil {
				t.Fatalf("make %s: %v (RED contract: the stub target passes)", gate, err)
			}
			r := parseReceipt(t, out1)
			if r.Gate != gate || r.Status != "pass" || r.Tool != "stub" || r.ExitCode != 0 {
				t.Errorf("%s: receipt = %+v (want gate=%q status=pass tool=stub exit_code=0)", gate, r, gate)
			}
			if n := strings.Count(out1[strings.Index(out1, "{"):], "\n{"); n != 0 {
				t.Errorf("%s: want exactly one JSON receipt line, got %d additional (%q)", gate, n, out1)
			}
			out2, _, err2 := runGate(t, root, gate)
			if err2 != nil || out1 != out2 {
				t.Errorf("%s: receipt not deterministic (err2=%v):\n first: %s\n second: %s", gate, err2, out1, out2)
			}
		})
	}
}
