package usecases

import (
	"context"
	"errors"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
)

var (
	ErrAccountExists       = errors.New("account already exists")
	ErrInvalidAccountName  = errors.New("invalid account name")
	ErrEmailNotVerified    = errors.New("email not verified")
	ErrIdentityUnavailable = errors.New("identity unavailable")
)

// AccountStore atomically creates a candidate or employer (recruiter) account
// and its audit event. A concurrent same-subject insert returns the existing
// row (any role) with created=false and no audit. It must never update an
// existing row or resolve identity by email.
type AccountStore interface {
	GetByCognitoSub(context.Context, string) (*entities.User, error)
	CreateAccount(context.Context, *entities.User) (*entities.User, bool, error)
}

type VerifiedIdentity struct {
	Subject, Email string
	EmailVerified  bool
}
type UserInfoProvider interface {
	Fetch(context.Context, string) (VerifiedIdentity, error)
}

// CandidateIdentity serves GET /v2/me and both self-service onboardings
// (candidate and employer, embedded-auth-v1 D1): one flow, two target roles.
type CandidateIdentity struct {
	store    AccountStore
	provider UserInfoProvider
}

func NewCandidateIdentity(store AccountStore, provider UserInfoProvider) *CandidateIdentity {
	return &CandidateIdentity{store: store, provider: provider}
}

func (s *CandidateIdentity) Me(ctx context.Context, subject string) (*entities.User, error) {
	u, err := s.store.GetByCognitoSub(ctx, subject)
	if errors.Is(err, entities.ErrUserNotFound) {
		return nil, nil
	}
	return u, err
}

// accountResult admits only an account of the target role; the other role is
// ErrAccountExists (an account never changes role).
func accountResult(u *entities.User, created bool, role valueobjects.UserType) (*entities.User, bool, error) {
	if u.UserType != role {
		return nil, false, ErrAccountExists
	}
	return u, created, nil
}

// Onboard creates the caller's candidate account (POST /v2/me/candidate-account).
func (s *CandidateIdentity) Onboard(ctx context.Context, subject, accessToken, rawName string) (*entities.User, bool, error) {
	return s.onboard(ctx, valueobjects.UserCandidate, subject, accessToken, rawName)
}

// OnboardEmployer creates the caller's employer (recruiter) account
// (POST /v2/me/employer-account). No company or membership is created (D3).
func (s *CandidateIdentity) OnboardEmployer(ctx context.Context, subject, accessToken, rawName string) (*entities.User, bool, error) {
	return s.onboard(ctx, valueobjects.UserRecruiter, subject, accessToken, rawName)
}

// onboard runs the order of checks shared by both roles: name → live account
// by subject (same role → retry, other role → exists; no provider call) →
// provider → subject/verification → email → atomic insert.
func (s *CandidateIdentity) onboard(ctx context.Context, role valueobjects.UserType, subject, accessToken, rawName string) (*entities.User, bool, error) {
	name, err := valueobjects.NewFullName(rawName)
	if err != nil || !utf8.ValidString(rawName) || utf8.RuneCountInString(name.Value()) < 2 || utf8.RuneCountInString(name.Value()) > 120 {
		return nil, false, ErrInvalidAccountName
	}
	existing, err := s.Me(ctx, subject)
	if err != nil {
		return nil, false, err
	}
	if existing != nil {
		return accountResult(existing, false, role)
	}
	if s.provider == nil {
		return nil, false, ErrIdentityUnavailable
	}
	info, err := s.provider.Fetch(ctx, accessToken)
	if err != nil {
		return nil, false, ErrIdentityUnavailable
	}
	if info.Subject != subject || !info.EmailVerified {
		return nil, false, ErrEmailNotVerified
	}
	email, err := valueobjects.NewEmail(info.Email)
	if err != nil {
		return nil, false, ErrIdentityUnavailable
	}
	user, err := entities.NewUser(subject, email, name, role)
	if err != nil {
		return nil, false, err
	}
	user, created, err := s.store.CreateAccount(ctx, user)
	if err != nil {
		return nil, false, err
	}
	return accountResult(user, created, role)
}
