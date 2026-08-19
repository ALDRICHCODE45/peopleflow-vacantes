package entities

import (
	"errors"
	"testing"
)

// TestSentinelsArePairwiseDistinct enforces the spec scenario "sentinels are
// pairwise distinct": every pair of the 7 listed sentinels must compare
// unequal under errors.Is. This is the canary that catches accidental
// pointer reuse from a future refactor.
func TestSentinelsArePairwiseDistinct(t *testing.T) {
	sentinels := map[string]error{
		"ErrEmptyCognitoSub":  ErrEmptyCognitoSub,
		"ErrInvalidEmail":     ErrInvalidEmail,
		"ErrFullNameTooShort": ErrFullNameTooShort,
		"ErrInvalidUserType":  ErrInvalidUserType,
		"ErrUserNotFound":     ErrUserNotFound,
		"ErrUserExists":       ErrUserExists,
		"ErrEmailTaken":       ErrEmailTaken,
	}

	for nameA, errA := range sentinels {
		for nameB, errB := range sentinels {
			if nameA == nameB {
				continue
			}
			if errors.Is(errA, errB) {
				t.Errorf("sentinels must be distinct: %s == %s under errors.Is", nameA, nameB)
			}
		}
	}
}

// TestSentinelsIsUsableWithErrorsIs is the companion check: each sentinel
// must be reachable from a wrapped error so middleware/HTTP layer can
// dispatch on errors.Is alone.
func TestSentinelsIsUsableWithErrorsIs(t *testing.T) {
	for name, sentinel := range map[string]error{
		"ErrEmptyCognitoSub":  ErrEmptyCognitoSub,
		"ErrInvalidEmail":     ErrInvalidEmail,
		"ErrFullNameTooShort": ErrFullNameTooShort,
		"ErrInvalidUserType":  ErrInvalidUserType,
		"ErrUserNotFound":     ErrUserNotFound,
		"ErrUserExists":       ErrUserExists,
		"ErrEmailTaken":       ErrEmailTaken,
	} {
		t.Run(name, func(t *testing.T) {
			wrapped := errors.New("ctx: " + name)
			wrapped = errorsWrap(wrapped, sentinel)
			if !errors.Is(wrapped, sentinel) {
				t.Errorf("expected errors.Is to find %s in wrapped chain", name)
			}
		})
	}
}

// errorsWrap returns a new error that wraps `target` and carries `prefix`'s
// message. We do this in-test so the test doesn't import fmt just for one
// call.
func errorsWrap(prefix, target error) error {
	return &wrappedErr{prefix: prefix, target: target}
}

type wrappedErr struct {
	prefix error
	target error
}

func (w *wrappedErr) Error() string { return w.prefix.Error() + ": " + w.target.Error() }
func (w *wrappedErr) Unwrap() error { return w.target }
