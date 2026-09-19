// Binary-boundary characterization for the cmd/api executable (CE-02).
//
// The composition root must fail closed before it ever touches the database:
// an empty/invalid IDENTITY_JWT_MODE aborts startup in the verifier
// configuration gate, which runs before DATABASE_URL is read and long before
// pgxpool.New/Ping. This test builds the real executable, launches it in a
// fresh temporary working directory with a fully controlled runtime
// environment, and pins both the safe failure record and the boundary that
// must not have been crossed.
//
// Positive assertions alone would also pass on a binary that exits 1 with the
// right message after connecting, so each negative assertion exists to pin the
// pre-database boundary: neither the verifier-ready record nor the
// postgres-connected record may appear, and neither the DSN scheme text nor
// its unique credential marker may leak into the captured output.
//
// The bait DSN is additionally asserted to be parse-invalid for the exact
// pgxpool parser the executable uses, so the no-network guarantee does not
// depend on the configuration gates staying ahead of the database path.
//
// Failure messages never embed raw process output: that output is the exact
// artifact under leakage test.
package main

import (
	"context"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// binaryBoundaryAPISecretMarker is a unique, non-secret sentinel embedded
	// in the deliberately invalid DSN so any leakage into process output is
	// detectable by exact substring search.
	binaryBoundaryAPISecretMarker = "pf-ce02-api-dsn-marker-4f6a9c2d"

	// binaryBoundaryAPIDatabaseURL is intentionally parse-invalid, not merely
	// unreachable: the trailing "%zz" is an invalid URL escape, so
	// pgxpool.ParseConfig rejects it before any host, DNS, or connect path can
	// be derived from it. It therefore cannot become a connection attempt even
	// if the configuration gates regress, and exists only as leak bait.
	binaryBoundaryAPIDatabaseURL = "postgres://binaryboundary:" + binaryBoundaryAPISecretMarker +
		"@127.0.0.1:1/binaryboundary%zz"

	// binaryBoundaryAPITimeout bounds the launched process. A correct binary
	// exits in milliseconds, so crossing this bound is a timeout, not a
	// process failure.
	binaryBoundaryAPITimeout = 30 * time.Second
)

// TestBinaryAPISafeFailureBoundary pins the safe-failure boundary of the real
// cmd/api executable: exit code 1 with the stable `server failed` record, and
// no evidence that the verifier gate was passed or the database path reached.
func TestBinaryAPISafeFailureBoundary(t *testing.T) {
	// Hermeticity guard: the exact parser the executable uses must reject the
	// bait DSN, so no connection attempt can ever be derived from it. This runs
	// before the real build/run assertions below and opens no network or
	// database connection.
	_, parseErr := pgxpool.ParseConfig(binaryBoundaryAPIDatabaseURL)
	if parseErr == nil {
		t.Fatal("bait DSN must be rejected by pgxpool.ParseConfig, but it parsed successfully")
	}
	var escapeErr url.EscapeError
	if !errors.As(parseErr, &escapeErr) {
		t.Fatalf("bait DSN must be rejected as an invalid URL escape, got error type %T", parseErr)
	}

	bin := buildBinaryBoundaryAPIBinary(t)

	ctx, cancel := context.WithTimeout(context.Background(), binaryBoundaryAPITimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, bin)
	// Fresh temporary working directory: no .env can be picked up.
	cmd.Dir = t.TempDir()
	// Fully controlled runtime environment: only the explicit boundary inputs,
	// never the ambient inherited environment.
	cmd.Env = []string{
		"APP_ENV=local",
		"IDENTITY_JWT_MODE=",
		"DATABASE_URL=" + binaryBoundaryAPIDatabaseURL,
	}

	output, runErr := cmd.CombinedOutput()

	if ctx.Err() != nil {
		t.Fatalf("api binary did not exit on its own within %s and had to be killed: %v (%d bytes captured)",
			binaryBoundaryAPITimeout, ctx.Err(), len(output))
	}

	var exitErr *exec.ExitError
	if !errors.As(runErr, &exitErr) {
		t.Fatalf("api binary must fail with a process exit error, got %v (%d bytes captured)", runErr, len(output))
	}
	if code := exitErr.ExitCode(); code != 1 {
		t.Fatalf("api binary exit code = %d, want 1", code)
	}

	out := string(output)
	const wantFailureRecord = "server failed"
	if !strings.Contains(out, wantFailureRecord) {
		t.Fatalf("api binary output must contain the safe failure record %q (%d bytes captured)",
			wantFailureRecord, len(out))
	}

	// Negative assertions: each fragment pins one boundary that must not have
	// been crossed. The fragments are the test's own constants; raw output is
	// deliberately withheld from every failure message.
	for _, forbidden := range []struct {
		label    string
		fragment string
	}{
		{label: "verifier-ready record (verifier configuration gate did not fire)", fragment: "identity verifier ready"},
		{label: "postgres-connected record (the database path was reached)", fragment: "connected to postgres"},
		{label: "DSN scheme text", fragment: "postgres://"},
		{label: "DSN secret marker", fragment: binaryBoundaryAPISecretMarker},
	} {
		if strings.Contains(out, forbidden.fragment) {
			t.Errorf("api binary output must not contain the %s; raw output withheld because it is the artifact under leakage test",
				forbidden.label)
		}
	}
}

// buildBinaryBoundaryAPIBinary compiles the real cmd/api package into a fresh
// temporary executable. Compiler output is reported only as a byte count.
func buildBinaryBoundaryAPIBinary(t *testing.T) string {
	t.Helper()

	bin := filepath.Join(t.TempDir(), "api")
	build := exec.Command("go", "build", "-o", bin, ".")
	build.Dir = binaryBoundaryPackageDir(t)
	build.Env = binaryBoundaryBuildEnv()
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build cmd/api: %v (compiler output withheld, %d bytes)", err, len(out))
	}
	return bin
}

// binaryBoundaryPackageDir resolves the package source directory and fails
// loudly when the test does not run from it, so the build can never produce
// evidence for a different package.
func binaryBoundaryPackageDir(t *testing.T) string {
	t.Helper()

	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("resolving the package working directory: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "main.go")); err != nil {
		t.Fatalf("binary-boundary test must run with its package directory as the working directory: %v", err)
	}
	return dir
}

// binaryBoundaryBuildEnv returns the inherited toolchain environment with any
// existing GOPROXY, GOTOOLCHAIN, and GOFLAGS removed and re-pinned to the
// hermetic offline values, so a cold module cache fails instead of reaching the
// network.
func binaryBoundaryBuildEnv() []string {
	blocked := []string{"GOPROXY=", "GOTOOLCHAIN=", "GOFLAGS="}
	env := make([]string, 0, len(os.Environ())+3)
	for _, entry := range os.Environ() {
		keep := true
		for _, prefix := range blocked {
			if strings.HasPrefix(entry, prefix) {
				keep = false
				break
			}
		}
		if keep {
			env = append(env, entry)
		}
	}
	return append(env, "GOPROXY=off", "GOTOOLCHAIN=local", "GOFLAGS=-mod=readonly")
}
