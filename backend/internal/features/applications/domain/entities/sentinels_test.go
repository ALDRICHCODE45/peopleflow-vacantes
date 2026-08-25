package entities

import (
	"errors"
	"testing"
)

// TestApplicationSentinels_Distinct mirrors the identity-layer sentinels
// test (TestSentinelsArePairwiseDistinct). Every pair of the 7 entity
// sentinels must compare unequal under errors.Is so the HTTP classifier
// can dispatch on a single errors.Is chain without ambiguity.
//
// Adding a new sentinel to this list MUST update the HTTP classifier
// (classifyApplicationError) at the same time — the two are paired by
// design.
func TestApplicationSentinels_Distinct(t *testing.T) {
	sentinels := map[string]error{
		"ErrApplicationNotFound":         ErrApplicationNotFound,
		"ErrJobNotApplicable":            ErrJobNotApplicable,
		"ErrAlreadyApplied":              ErrAlreadyApplied,
		"ErrInvalidApplicationReference": ErrInvalidApplicationReference,
		"ErrCoverLetterEmpty":            ErrCoverLetterEmpty,
		"ErrCoverLetterTooLong":          ErrCoverLetterTooLong,
		"ErrStatusRequired":              ErrStatusRequired,
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
