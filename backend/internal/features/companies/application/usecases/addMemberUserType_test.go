package usecases

import (
	"context"
	"errors"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identityvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	"github.com/google/uuid"
)

// TestAddMember_RecruiterIsAccepted is the GREEN baseline: a target user with
// user_type=recruiter is a valid member and the repository Create is reached.
func TestAddMember_RecruiterIsAccepted(t *testing.T) {
	targetID := uuid.New()
	mRepo := &stubMemberRepository{}
	uRepo := &stubUserRepository{
		byID: &identityentities.User{ID: targetID, UserType: identityvalueobjects.UserRecruiter},
	}
	cRepo := &stubMemberCompanyRepository{}
	svc := newSvc(mRepo, uRepo, cRepo)

	_, err := svc.AddMember(context.Background(), uuid.New(), dtos.AddMemberDto{
		UserID: targetID,
		Role:   "recruiter",
	})
	if err != nil {
		t.Fatalf("expected recruiter to be accepted, got: %v", err)
	}
	if mRepo.createCalls != 1 {
		t.Fatalf("expected Create called once, got %d", mRepo.createCalls)
	}
}

// TestAddMember_CandidateIsRejected is the core of business rule 3a: a
// user_type=candidate must NOT be addable as a company member. The use case
// surfaces entities.ErrTargetNotRecruiter and does NOT touch the repository.
func TestAddMember_CandidateIsRejected(t *testing.T) {
	targetID := uuid.New()
	mRepo := &stubMemberRepository{}
	uRepo := &stubUserRepository{
		byID: &identityentities.User{ID: targetID, UserType: identityvalueobjects.UserCandidate},
	}
	cRepo := &stubMemberCompanyRepository{}
	svc := newSvc(mRepo, uRepo, cRepo)

	_, err := svc.AddMember(context.Background(), uuid.New(), dtos.AddMemberDto{
		UserID: targetID,
		Role:   "recruiter",
	})
	if !errors.Is(err, entities.ErrTargetNotRecruiter) {
		t.Fatalf("expected ErrTargetNotRecruiter, got: %v", err)
	}
	if mRepo.createCalls != 0 {
		t.Fatalf("expected repository.Create NOT called, got %d", mRepo.createCalls)
	}
}

// TestAddMember_UnknownUserTypeIsRejected covers a target whose user_type is
// neither recruiter nor candidate (defensive: the closed set is enforced at
// the DB, but the service should still refuse before writing).
func TestAddMember_UnknownUserTypeIsRejected(t *testing.T) {
	targetID := uuid.New()
	mRepo := &stubMemberRepository{}
	uRepo := &stubUserRepository{
		byID: &identityentities.User{ID: targetID, UserType: identityvalueobjects.UnknownUserType},
	}
	cRepo := &stubMemberCompanyRepository{}
	svc := newSvc(mRepo, uRepo, cRepo)

	_, err := svc.AddMember(context.Background(), uuid.New(), dtos.AddMemberDto{
		UserID: targetID,
		Role:   "recruiter",
	})
	if !errors.Is(err, entities.ErrTargetNotRecruiter) {
		t.Fatalf("expected ErrTargetNotRecruiter, got: %v", err)
	}
	if mRepo.createCalls != 0 {
		t.Fatalf("expected repository.Create NOT called, got %d", mRepo.createCalls)
	}
}
