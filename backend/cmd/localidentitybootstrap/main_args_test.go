// Tests for the command-line contract of main. Each case re-executes this test
// binary as the real command, so exit codes and output are observed through
// the process boundary. Only help and rejected arguments are exercised: no
// case reaches Run, so no listener, database or terminal is touched.
package main

import (
	"bytes"
	"errors"
	"flag"
	"os"
	"os/exec"
	"testing"
)

const mainArgsChildEnv = "LOCALIDENTITYBOOTSTRAP_TEST_MAIN_ARGS"

func TestMainArgsChild(t *testing.T) {
	if os.Getenv(mainArgsChildEnv) != "1" {
		t.Skip("child process helper for TestMain_Arguments")
	}
	// Arguments after "--" are left unparsed by the test binary.
	os.Args = append([]string{"localidentitybootstrap"}, flag.Args()...)
	main()
	os.Exit(0)
}

func runMainChild(t *testing.T, args ...string) (exitCode int, stdout, stderr string) {
	t.Helper()
	childArgs := append([]string{"-test.run=^TestMainArgsChild$", "--"}, args...)
	cmd := exec.Command(os.Args[0], childArgs...)
	cmd.Env = append(os.Environ(), mainArgsChildEnv+"=1")
	var outBuf, errBuf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &outBuf, &errBuf
	err := cmd.Run()
	var exitErr *exec.ExitError
	switch {
	case err == nil:
		exitCode = 0
	case errors.As(err, &exitErr):
		exitCode = exitErr.ExitCode()
	default:
		t.Fatalf("run child: %v", err)
	}
	return exitCode, outBuf.String(), errBuf.String()
}

func TestMain_Arguments(t *testing.T) {
	const rejected = "localidentitybootstrap: unknown argument; only -h/--help is supported\n"
	var usage bytes.Buffer
	Usage(&usage)

	cases := []struct {
		name       string
		args       []string
		wantCode   int
		wantStdout string
		wantStderr string
	}{
		{name: "short help", args: []string{"-h"}, wantCode: 0, wantStdout: usage.String()},
		{name: "long help", args: []string{"--help"}, wantCode: 0, wantStdout: usage.String()},
		{name: "help word", args: []string{"help"}, wantCode: 0, wantStdout: usage.String()},
		{name: "unknown argument", args: []string{"--unsupported"}, wantCode: 2, wantStderr: rejected},
		{name: "help followed by unsupported option", args: []string{"--help", "--unsupported"}, wantCode: 2, wantStderr: rejected},
		{name: "help repeated", args: []string{"-h", "-h"}, wantCode: 2, wantStderr: rejected},
		{name: "unknown followed by help", args: []string{"--unsupported", "--help"}, wantCode: 2, wantStderr: rejected},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, stdout, stderr := runMainChild(t, tc.args...)
			if code != tc.wantCode {
				t.Errorf("exit code = %d, want %d", code, tc.wantCode)
			}
			if stdout != tc.wantStdout {
				t.Errorf("stdout = %q, want %q", stdout, tc.wantStdout)
			}
			if stderr != tc.wantStderr {
				t.Errorf("stderr = %q, want %q", stderr, tc.wantStderr)
			}
		})
	}
}
