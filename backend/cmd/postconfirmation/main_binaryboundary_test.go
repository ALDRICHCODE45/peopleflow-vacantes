// Binary-boundary characterization for the cmd/postconfirmation executable
// (CE-02).
//
// loadConfig must reject an unknown APP_ENV before any dependency is created:
// no pool is opened and no ping is attempted. This test builds the real
// executable, launches it in a fresh temporary working directory with a fully
// controlled runtime environment, and pins both the safe failure record with
// its exact static validation message and the boundary that must not have been
// crossed.
//
// Positive assertions alone would also pass on a binary that exits 1 after
// opening the pool, so the negative assertions exist to pin the pre-pool
// boundary: neither the DSN scheme text nor its unique credential marker may
// leak into the captured output, and the raw APP_ENV value must not be echoed
// back. The bait DSN is additionally asserted to be parse-invalid for the
// exact pgxpool parser the executable uses, so the no-network guarantee does
// not depend on loadConfig staying ahead of the pool path. Failure messages
// never embed raw process output: that output is the exact artifact under
// leakage test.
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
	// binaryBoundaryPostConfirmationSecretMarker is a unique, non-secret
	// sentinel embedded in the deliberately invalid DSN so any leakage into
	// process output is detectable by exact substring search.
	binaryBoundaryPostConfirmationSecretMarker = "pf-ce02-postconfirmation-dsn-marker-8b1e5d37"

	// binaryBoundaryPostConfirmationDatabaseURL is intentionally parse-invalid,
	// not merely unreachable: the trailing "%zz" is an invalid URL escape, so
	// pgxpool.ParseConfig rejects it before any host, DNS, or connect path can
	// be derived from it. It therefore cannot become a connection attempt even
	// if loadConfig regresses, and exists only as leak bait.
	binaryBoundaryPostConfirmationDatabaseURL = "postgres://binaryboundary:" + binaryBoundaryPostConfirmationSecretMarker +
		"@127.0.0.1:1/binaryboundary%zz"

	// binaryBoundaryPostConfirmationTimeout bounds the launched process. A
	// correct binary exits in milliseconds, so crossing this bound is a
	// timeout, not a process failure.
	binaryBoundaryPostConfirmationTimeout = 30 * time.Second
)

// TestBinaryPostConfirmationSafeFailureBoundary pins the safe-failure boundary
// of the real cmd/postconfirmation executable: exit code 1 with the stable
// `post confirmation executable failed` record carrying the exact static
// APP_ENV validation message, and no evidence that the database path was
// reached.
func TestBinaryPostConfirmationSafeFailureBoundary(t *testing.T) {
	// Hermeticity guard: the exact parser the executable uses must reject the
	// bait DSN, so no connection attempt can ever be derived from it. This runs
	// before the real build/run assertions below and opens no network or
	// database connection.
	_, parseErr := pgxpool.ParseConfig(binaryBoundaryPostConfirmationDatabaseURL)
	if parseErr == nil {
		t.Fatal("bait DSN must be rejected by pgxpool.ParseConfig, but it parsed successfully")
	}
	var escapeErr url.EscapeError
	if !errors.As(parseErr, &escapeErr) {
		t.Fatalf("bait DSN must be rejected as an invalid URL escape, got error type %T", parseErr)
	}

	bin := buildBinaryBoundaryPostConfirmationBinary(t)

	ctx, cancel := context.WithTimeout(context.Background(), binaryBoundaryPostConfirmationTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, bin)
	// Fresh temporary working directory.
	cmd.Dir = t.TempDir()
	// Fully controlled runtime environment: only the explicit boundary inputs,
	// never the ambient inherited environment.
	cmd.Env = []string{
		"APP_ENV=staging",
		"DATABASE_URL=" + binaryBoundaryPostConfirmationDatabaseURL,
	}

	output, runErr := cmd.CombinedOutput()

	if ctx.Err() != nil {
		t.Fatalf("post confirmation binary did not exit on its own within %s and had to be killed: %v (%d bytes captured)",
			binaryBoundaryPostConfirmationTimeout, ctx.Err(), len(output))
	}

	var exitErr *exec.ExitError
	if !errors.As(runErr, &exitErr) {
		t.Fatalf("post confirmation binary must fail with a process exit error, got %v (%d bytes captured)", runErr, len(output))
	}
	if code := exitErr.ExitCode(); code != 1 {
		t.Fatalf("post confirmation binary exit code = %d, want 1", code)
	}

	out := string(output)
	for _, want := range []struct {
		label    string
		fragment string
	}{
		{label: "executable failure record", fragment: "post confirmation executable failed"},
		{label: "static APP_ENV validation message", fragment: "APP_ENV is required and must be exactly production, local, or test"},
	} {
		if !strings.Contains(out, want.fragment) {
			t.Fatalf("post confirmation binary output must contain the %s (%d bytes captured)", want.label, len(out))
		}
	}

	// Negative assertions: each fragment pins one boundary that must not have
	// been crossed. The fragments are the test's own constants; raw output is
	// deliberately withheld from every failure message.
	for _, forbidden := range []struct {
		label    string
		fragment string
	}{
		{label: "DSN scheme text", fragment: "postgres://"},
		{label: "DSN secret marker", fragment: binaryBoundaryPostConfirmationSecretMarker},
		{label: "raw APP_ENV value echoed back", fragment: "staging"},
	} {
		if strings.Contains(out, forbidden.fragment) {
			t.Errorf("post confirmation binary output must not contain the %s; raw output withheld because it is the artifact under leakage test",
				forbidden.label)
		}
	}
}

// buildBinaryBoundaryPostConfirmationBinary compiles the real
// cmd/postconfirmation package into a fresh temporary executable. Compiler
// output is reported only as a byte count.
func buildBinaryBoundaryPostConfirmationBinary(t *testing.T) string {
	t.Helper()

	bin := filepath.Join(t.TempDir(), "postconfirmation")
	build := exec.Command("go", "build", "-o", bin, ".")
	build.Dir = binaryBoundaryPackageDir(t)
	build.Env = binaryBoundaryBuildEnv()
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build cmd/postconfirmation: %v (compiler output withheld, %d bytes)", err, len(out))
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
