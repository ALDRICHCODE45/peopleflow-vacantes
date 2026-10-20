package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"strings"
	"testing"
)

func TestSkipPostalCodesFlag(t *testing.T) {
	var out bytes.Buffer
	if err := run(context.Background(), []string{"-skip-postal-codes", "-h"}, &out); !errors.Is(err, flag.ErrHelp) || !strings.Contains(out.String(), "skip-postal-codes") {
		t.Fatalf("skip flag must be recognized without database access: %v %s", err, &out)
	}
	out.Reset()
	err := run(context.Background(), []string{"-skip-postal-codes", "-reduce", "not-opened"}, &out)
	if err == nil || !strings.Contains(err.Error(), "only applies to imports") {
		t.Fatalf("reduction must not silently ignore skip flag: %v", err)
	}
}
