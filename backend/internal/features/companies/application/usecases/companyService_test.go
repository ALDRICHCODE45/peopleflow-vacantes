// Unit tests for the companies application-level sentinels
// (companies-audit WU2). The single sentinel added this slice is
// ErrMissingActorIdentity (design D6): the use-case guard for a
// zero-actor request on the owner-only write paths
// (PATCH /me/company, DELETE /me/company). Fail-closed 500.
package usecases

import (
	"errors"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
)

// TestErrMissingActorIdentity_IsDistinct pins the sentinel's existence
// and distinctness (companies-audit design D6 / spec R5-S11).
// The sentinel MUST:
//
//   - exist in the usecases package at the name ErrMissingActorIdentity;
//   - be a non-nil error;
//   - carry the canonical message "missing actor identity"
//     (no existence leak; classifier maps to 500 generic body);
//   - be distinct from the existing entity / VO sentinels — NO
//     reuse or alias of entities.ErrCompanyNotFound,
//     entities.ErrConcurrencyConflict, or
//     valueobjects.ErrCompanyNameTooShort.
func TestErrMissingActorIdentity_IsDistinct(t *testing.T) {
	if ErrMissingActorIdentity == nil {
		t.Fatal("ErrMissingActorIdentity must be a non-nil sentinel")
	}
	if ErrMissingActorIdentity.Error() != "missing actor identity" {
		t.Errorf("ErrMissingActorIdentity.Error(): want %q, got %q",
			"missing actor identity", ErrMissingActorIdentity.Error())
	}
	distinctFrom := []error{
		entities.ErrCompanyNotFound,
		entities.ErrConcurrencyConflict,
		entities.ErrInvalidCompanyStatusTransition,
		valueobjects.ErrCompanyNameTooShort,
		valueobjects.ErrCompanyDescriptionTooLong,
		valueobjects.ErrInvalidCompanySize,
		valueobjects.ErrFoundedYearOutOfRange,
	}
	for _, other := range distinctFrom {
		if errors.Is(ErrMissingActorIdentity, other) {
			t.Errorf("ErrMissingActorIdentity must NOT alias or share sentinel identity with %v", other)
		}
	}
}
