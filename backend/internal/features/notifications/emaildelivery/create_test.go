package emaildelivery

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// L20 (R4): only non-transient email failures are isolated by the savepoint;
// transient ones (serialization, deadlock, lock timeout, statement timeout /
// cancel, connection class 08, and non-database errors such as a cancelled
// context or a lost connection) must fail the caller's tx so its retry absorbs
// them.
func TestTransientEmailFailures(t *testing.T) {
	pg := func(code string) error { return fmt.Errorf("email delivery: %w", &pgconn.PgError{Code: code}) }
	for _, tc := range []struct {
		name      string
		err       error
		transient bool
	}{
		{"serialization 40001", pg("40001"), true},
		{"deadlock 40P01", pg("40P01"), true},
		{"lock timeout 55P03", pg("55P03"), true},
		{"query canceled 57014", pg("57014"), true},
		{"connection failure 08006", pg("08006"), true},
		{"connection does not exist 08003", pg("08003"), true},
		{"context canceled", fmt.Errorf("x: %w", context.Canceled), true},
		{"network error", errors.New("read tcp: connection reset by peer"), true},
		{"check violation 23514", pg("23514"), false},
		{"foreign key 23503", pg("23503"), false},
		{"undefined table 42P01", pg("42P01"), false},
		{"not linkable", fmt.Errorf("email delivery for x: %w", errNotLinked), false},
	} {
		if got := transient(tc.err); got != tc.transient {
			t.Errorf("%s: transient=%v want %v", tc.name, got, tc.transient)
		}
	}
}
