package fanout

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// Review finding 6: errors are classified by failing step and SQLSTATE only;
// the message (which can quote values) never reaches the logs.
func TestClassifyReportsStepAndSQLStateOnly(t *testing.T) {
	pgErr := &pgconn.PgError{Code: "23503", Message: "secret-value violates fk", Detail: "Key (id)=(secret-value)"}
	cases := []struct {
		err            error
		step, sqlstate string
	}{
		{stepErr(stepInsert, fmt.Errorf("insert x: %w", pgErr)), "insert", "23503"},
		{fmt.Errorf("wrapped: %w", stepErr(stepClaim, errors.New("conn refused secret-value"))), "claim", ""},
		{errors.New("plain secret-value"), "unknown", ""},
		{stepErr(stepPanic, errPanic), "panic", ""},
	}
	for _, tc := range cases {
		step, sqlstate := classify(tc.err)
		if step != tc.step || sqlstate != tc.sqlstate {
			t.Fatalf("%v: step=%s sqlstate=%s", tc.err, step, sqlstate)
		}
	}
}

func TestLoopLogsTickFailureClassWithoutContent(t *testing.T) {
	var logs bytes.Buffer
	pgErr := &pgconn.PgError{Code: "57P01", Message: "terminating secret-value"}
	loop := &Loop{Ticker: &countingTicker{err: stepErr(stepClaim, fmt.Errorf("claim: %w", pgErr))}, Logger: slog.New(slog.NewJSONHandler(&logs, nil))}
	loop.runOnce(context.Background())
	out := logs.String()
	if !strings.Contains(out, `"step":"claim"`) || !strings.Contains(out, `"sqlstate":"57P01"`) || strings.Contains(out, "secret-value") {
		t.Fatalf("logs: %s", out)
	}
}
