// Package usecases orchestrates the companies application logic. The
// CompanyMemberService is the composition target for the company_membership
// subdomain: it owns the per-request resolver chain
// (`sub → users.id → company_members`) and the five use cases the spec
// calls out (AddMember / GetMyMembership / ListMembers / UpdateRole /
// RemoveMember).
//
// Every public use case takes a `cognitoSub string` as the second
// argument. The service resolves it to a stable users.id at the edge so
// the entity layer never sees the JWT subject — that is the
// IDOR-resistant boundary (design D6). Membership role comes from the
// company_members row, never from the JWT, and the `company_id` used in
// every mutation comes from the caller's own membership row — path and
// body company_ids are ignored.
package usecases

import (
	"context"
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identityrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	"github.com/google/uuid"
)

// CompanyMemberService bundles the five company_membership use cases that
// share the same repository ports. Construct it once at the composition
// root with the real adapters and pass it around.
//
// The service is the only place that resolves the JWT subject to a
// users.id; the repository layer never sees the `sub` string.
type CompanyMemberService struct {
	memberRepo  repositories.CompanyMemberRepository
	userRepo    identityrepositories.UserRepository
	companyRepo repositories.CompanyRepository
}

// NewCompanyMemberService wires the use cases around the three repository
// ports. The user repository is the identity slice's UserRepository; the
// service calls GetByCognitoSub at the edge of every use case so the rest
// of the code never sees the JWT subject. The company repository is the
// same companies slice's CompanyRepository — only GetMyMembership uses it
// to fetch the company record the spec scenario asks for.
func NewCompanyMemberService(
	memberRepo repositories.CompanyMemberRepository,
	userRepo identityrepositories.UserRepository,
	companyRepo repositories.CompanyRepository,
) *CompanyMemberService {
	return &CompanyMemberService{
		memberRepo:  memberRepo,
		userRepo:    userRepo,
		companyRepo: companyRepo,
	}
}

// resolveMember is the IDOR-resistant boundary (design D6). Every public
// use case MUST call it before touching the membership port; the JWT
// subject never leaves this function.
//
// Mapping contract:
//   - unknown sub (users.ErrUserNotFound) → entities.ErrUnknownSubject
//     so the HTTP layer can map to 401.
//   - resolved user has no membership row → entities.ErrNotAMember so the
//     HTTP layer can map to 404 (GetMyMembership) or 403 (RequireCompanyRole).
//   - any other error is propagated unchanged so a real DB outage isn't
//     hidden behind a sentinel.
func (s *CompanyMemberService) resolveMember(ctx context.Context, cognitoSub string) (*entities.CompanyMember, error) {
	user, err := s.userRepo.GetByCognitoSub(ctx, cognitoSub)
	if err != nil {
		// Unknown sub is a spec scenario, not an internal failure —
		// surface it as the canonical sentinel so the HTTP layer
		// has a single switch to dispatch on.
		if errors.Is(err, identityentities.ErrUserNotFound) {
			return nil, entities.ErrUnknownSubject
		}
		return nil, err
	}

	member, err := s.memberRepo.GetMembershipByUserID(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	return member, nil
}

// GetMyMembership returns the caller's (company_id, role) AND the company
// record so the HTTP layer can shape the response per the spec scenario
// "owner gets their membership". Membership lookup goes through
// resolveMember; company lookup goes through the companies repo (no
// membership cross-domain read).
//
// Non-members surface as entities.ErrNotAMember (→ 404). Unknown sub
// surfaces as entities.ErrUnknownSubject (→ 401). A company lookup
// failure propagates unchanged so an outage isn't hidden.
func (s *CompanyMemberService) GetMyMembership(ctx context.Context, cognitoSub string) (*entities.CompanyMember, *entities.Company, error) {
	member, err := s.resolveMember(ctx, cognitoSub)
	if err != nil {
		return nil, nil, err
	}

	company, err := s.companyRepo.GetByID(ctx, member.CompanyID)
	if err != nil {
		return nil, nil, err
	}

	return member, company, nil
}

// ListMembers returns every member of the caller's company. The
// company_id passed to the repository comes from resolveMember, never
// from any caller-controlled path or body value.
//
// Empty result is a non-nil empty slice so JSON encoding produces `[]`
// rather than `null` — the same invariant ListMyLanguages enforces.
func (s *CompanyMemberService) ListMembers(ctx context.Context, cognitoSub string) ([]entities.CompanyMember, error) {
	member, err := s.resolveMember(ctx, cognitoSub)
	if err != nil {
		return nil, err
	}

	got, err := s.memberRepo.ListByCompanyID(ctx, member.CompanyID)
	if err != nil {
		return nil, err
	}
	if got == nil {
		return []entities.CompanyMember{}, nil
	}
	return got, nil
}

// AddMember creates a new membership row attached to the CALLER's company
// (design D6 — body company_id is ignored). The use case resolves the
// caller's company_id from the membership row, validates the role through
// the VO, builds the entity, and hands it to the repository.
//
// Validation failures (unknown sub, invalid role) short-circuit BEFORE
// the repository is invoked; the repository's role is to persist a
// well-formed entity, not to police domain invariants.
func (s *CompanyMemberService) AddMember(ctx context.Context, cognitoSub string, params dtos.AddMemberDto) (*entities.CompanyMember, error) {
	caller, err := s.resolveMember(ctx, cognitoSub)
	if err != nil {
		return nil, err
	}

	role, err := valueobjects.ParseMemberRole(params.Role)
	if err != nil {
		return nil, err
	}

	target, err := entities.NewCompanyMember(params.UserID, caller.CompanyID, role)
	if err != nil {
		return nil, err
	}

	if err := s.memberRepo.Create(ctx, target); err != nil {
		return nil, err
	}
	return target, nil
}

// UpdateRole replaces the target member's role. The target id comes from
// the URL path; the company_id comes from resolveMember (the caller's
// own company). The repository's same-company guard (design D7) makes
// cross-company targets surface as entities.ErrMemberNotFound, which the
// service propagates unchanged so the HTTP layer can map to 404.
func (s *CompanyMemberService) UpdateRole(ctx context.Context, cognitoSub string, memberID uuid.UUID, params dtos.UpdateMemberRoleDto) error {
	caller, err := s.resolveMember(ctx, cognitoSub)
	if err != nil {
		return err
	}

	role, err := valueobjects.ParseMemberRole(params.Role)
	if err != nil {
		return err
	}

	return s.memberRepo.UpdateRole(ctx, memberID, caller.CompanyID, role)
}

// RemoveMember hard-deletes the target row. The same-company guard
// contract is identical to UpdateRole: target id from the path, company_id
// from the caller's row, and a cross-company target surfaces as
// entities.ErrMemberNotFound → 404.
func (s *CompanyMemberService) RemoveMember(ctx context.Context, cognitoSub string, memberID uuid.UUID) error {
	caller, err := s.resolveMember(ctx, cognitoSub)
	if err != nil {
		return err
	}

	return s.memberRepo.Remove(ctx, memberID, caller.CompanyID)
}
