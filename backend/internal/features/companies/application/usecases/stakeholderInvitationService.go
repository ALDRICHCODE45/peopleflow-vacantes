package usecases

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identityrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	identityvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	"github.com/google/uuid"
)

// Invitation rules (stakeholder-metrics-v1 §1.3).
const (
	StakeholderInvitationTTL          = 7 * 24 * time.Hour
	StakeholderInvitationPendingLimit = 20
	stakeholderTokenBytes             = 32
)

// IssuedStakeholderInvitation is the create result: the only time the url
// token exists outside the inviter's channel.
type IssuedStakeholderInvitation struct {
	entities.StakeholderInvitation
	URLToken string
}

// StakeholderInvitationService creates, lists, revokes and accepts
// stakeholder invitations. The database keeps only the token's SHA-256.
type StakeholderInvitationService struct {
	repo   repositories.StakeholderInvitationRepository
	users  identityrepositories.UserRepository
	now    func() time.Time
	random io.Reader
}

// NewStakeholderInvitationService wires the service with the real clock and
// crypto/rand.
func NewStakeholderInvitationService(repo repositories.StakeholderInvitationRepository, users identityrepositories.UserRepository) *StakeholderInvitationService {
	return &StakeholderInvitationService{repo: repo, users: users, now: time.Now, random: rand.Reader}
}

// clock truncates to the database's microsecond precision, so the create
// response and later reads print the same instant.
func (s *StakeholderInvitationService) clock() time.Time {
	return s.now().UTC().Truncate(time.Microsecond)
}

// Create issues a single-use invitation for the caller's company.
func (s *StakeholderInvitationService) Create(ctx context.Context, companyID, actor uuid.UUID) (IssuedStakeholderInvitation, error) {
	raw := make([]byte, stakeholderTokenBytes)
	if _, err := io.ReadFull(s.random, raw); err != nil {
		return IssuedStakeholderInvitation{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	id, err := uuid.NewV7()
	if err != nil {
		return IssuedStakeholderInvitation{}, err
	}
	now := s.clock()
	inv := entities.StakeholderInvitation{ID: id, CompanyID: companyID, CreatedBy: actor, CreatedAt: now, ExpiresAt: now.Add(StakeholderInvitationTTL)}
	if err := s.repo.Create(ctx, inv, tokenHash(token), StakeholderInvitationPendingLimit); err != nil {
		return IssuedStakeholderInvitation{}, err
	}
	return IssuedStakeholderInvitation{StakeholderInvitation: inv, URLToken: token}, nil
}

// ListPending returns the company's pending invitations, newest first.
func (s *StakeholderInvitationService) ListPending(ctx context.Context, companyID uuid.UUID) ([]entities.StakeholderInvitation, error) {
	return s.repo.ListPending(ctx, companyID, s.clock())
}

// Revoke is idempotent: an already used, expired, revoked or unknown
// invitation is not an error.
func (s *StakeholderInvitationService) Revoke(ctx context.Context, companyID, actor, id uuid.UUID) error {
	return s.repo.Revoke(ctx, companyID, actor, id, s.clock())
}

// Accept joins the signed-in employer account as a stakeholder. A candidate
// account is refused before the token is looked at; a malformed token is
// as invalid as an unknown one.
func (s *StakeholderInvitationService) Accept(ctx context.Context, cognitoSub, token string) (entities.StakeholderAcceptance, error) {
	user, err := s.users.GetByCognitoSub(ctx, cognitoSub)
	if err != nil {
		if errors.Is(err, identityentities.ErrUserNotFound) {
			return entities.StakeholderAcceptance{}, entities.ErrUnknownSubject
		}
		return entities.StakeholderAcceptance{}, err
	}
	if user.UserType != identityvalueobjects.UserRecruiter {
		return entities.StakeholderAcceptance{}, entities.ErrCandidateAccount
	}
	if raw, err := base64.RawURLEncoding.DecodeString(token); err != nil || len(raw) != stakeholderTokenBytes {
		return entities.StakeholderAcceptance{}, entities.ErrInvitationInvalid
	}
	return s.repo.Accept(ctx, user.ID, tokenHash(token), s.clock())
}

func tokenHash(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
