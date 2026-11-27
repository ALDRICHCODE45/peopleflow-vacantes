package fanout

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

// step names the fan-out phase that failed; logs carry it with the SQLSTATE
// and never an error message (messages can quote ids or values).
type step string

const (
	stepBegin       step = "begin"
	stepClaim       step = "claim"
	stepDecode      step = "decode"
	stepPlan        step = "plan"
	stepPreferences step = "preferences"
	stepInsert      step = "insert"
	stepEmail       step = "email"
	stepMark        step = "mark"
	stepCommit      step = "commit"
	stepPanic       step = "panic"
	stepUnknown     step = "unknown"
)

// errPanic stands in for a recovered panic; its value is never kept.
var errPanic = errors.New("fan-out event panicked")

type stepError struct {
	step step
	err  error
}

func (e *stepError) Error() string { return string(e.step) + ": " + e.err.Error() }
func (e *stepError) Unwrap() error { return e.err }

func stepErr(s step, err error) error {
	if err == nil {
		return nil
	}
	return &stepError{step: s, err: err}
}

// classify is the value-free class of an error: the failing step and the
// PostgreSQL SQLSTATE when the cause is a server error ("" otherwise).
func classify(err error) (string, string) {
	s := stepUnknown
	var se *stepError
	if errors.As(err, &se) {
		s = se.step
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return string(s), pgErr.Code
	}
	return string(s), ""
}
