package sender

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

// step names the sender phase that failed; logs carry it with the SQLSTATE
// and never an error message (messages can quote ids, addresses or provider
// text).
type step string

const (
	stepClaim    step = "claim"
	stepRecheck  step = "recheck"
	stepView     step = "view"
	stepRender   step = "render"
	stepThrottle step = "throttle"
	stepSend     step = "send"
	stepFinalize step = "finalize"
	stepPanic    step = "panic"
	stepUnknown  step = "unknown"
)

// errPanic stands in for a recovered panic; its value is never kept.
var errPanic = errors.New("email delivery panicked")

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
