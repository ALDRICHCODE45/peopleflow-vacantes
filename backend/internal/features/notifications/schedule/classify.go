package schedule

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

// step names the scheduler phase that failed; logs carry it with the
// SQLSTATE and never an error message (messages can quote ids or values).
type step string

const (
	stepLock        step = "lock"
	stepBegin       step = "begin"
	stepDelivery    step = "list_delivery"
	stepAssignment  step = "list_assignment"
	stepPreferences step = "preferences"
	stepInsert      step = "insert"
	stepResolve     step = "resolve"
	stepCommit      step = "commit"
	stepUnknown     step = "unknown"
)

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
