// Unit test for the companies-write sentinels (design D9).
//
// The two new sentinels live in their own file so company.go stays
// byte-for-byte unchanged. The test asserts:
//
//   - ErrConcurrencyConflict exists and is distinct.
//   - ErrInvalidCompanyStatusTransition exists and is distinct.
//   - Neither sentinel aliases a jobs sentinel — the companies slice
//     owns its own copy (no cross-feature import for the HTTP
//     classifier; jobs already has its own ErrConcurrencyConflict).
//
// This file is the RED source for task 3.1; the GREEN lands in
// sentinels.go in the same WU3 atomic commit (the strict-TDD RED
// here is the undefined-symbol compile error before sentinels.go
// exists).
package entities

import (
	"errors"
	"testing"

	jobsentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
)

func TestSentinels_ConcurrencyConflictIsDefined(t *testing.T) {
	if ErrConcurrencyConflict == nil {
		t.Fatal("ErrConcurrencyConflict must be defined (sentinels.go missing)")
	}
	if ErrConcurrencyConflict.Error() == "" {
		t.Errorf("ErrConcurrencyConflict must have a non-empty message")
	}
}

func TestSentinels_InvalidCompanyStatusTransitionIsDefined(t *testing.T) {
	if ErrInvalidCompanyStatusTransition == nil {
		t.Fatal("ErrInvalidCompanyStatusTransition must be defined (sentinels.go missing)")
	}
	if ErrInvalidCompanyStatusTransition.Error() == "" {
		t.Errorf("ErrInvalidCompanyStatusTransition must have a non-empty message")
	}
}

func TestSentinels_AreDistinct(t *testing.T) {
	if errors.Is(ErrConcurrencyConflict, ErrInvalidCompanyStatusTransition) {
		t.Errorf("the two sentinels must be distinct; got %v aliases %v",
			ErrConcurrencyConflict, ErrInvalidCompanyStatusTransition)
	}
}

// TestSentinels_NotAliasedToJobsSentinels guards the design decision
// (D9) that companies owns its own ErrConcurrencyConflict rather than
// importing the jobs slice's. Cross-feature sentinel reuse couples the
// slices: the companies HTTP classifier would have to import the jobs
// entities package, inverting the hexagonal boundary and dragging the
// jobs vocabulary into companies.
func TestSentinels_NotAliasedToJobsSentinels(t *testing.T) {
	if ErrConcurrencyConflict == jobsentities.ErrConcurrencyConflict {
		t.Errorf("companies.ErrConcurrencyConflict must NOT alias jobs.ErrConcurrencyConflict (D9 — each feature owns its sentinels)")
	}
}
