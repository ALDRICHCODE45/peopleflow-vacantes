package usecases

import (
	"context"
	"errors"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
)

var (
	ErrAccountExists        = errors.New("account already exists")
	ErrInvalidCandidateName = errors.New("invalid candidate name")
	ErrEmailNotVerified     = errors.New("email not verified")
	ErrIdentityUnavailable  = errors.New("identity unavailable")
)

// CandidateAccountStore atomically creates a candidate and its audit event.
// A concurrent same-subject insert returns the existing row without an audit.
// It must never update an existing row or resolve identity by email.
type CandidateAccountStore interface {
	GetByCognitoSub(context.Context, string) (*entities.User, error)
	CreateCandidate(context.Context, *entities.User) (*entities.User, bool, error)
}

type VerifiedIdentity struct {
	Subject, Email string
	EmailVerified  bool
}
type UserInfoProvider interface {
	Fetch(context.Context, string) (VerifiedIdentity, error)
}

type CandidateIdentity struct {
	store    CandidateAccountStore
	provider UserInfoProvider
}

func NewCandidateIdentity(store CandidateAccountStore, provider UserInfoProvider) *CandidateIdentity {
	return &CandidateIdentity{store: store, provider: provider}
}

func (s *CandidateIdentity) Me(ctx context.Context, subject string) (*entities.User, error) {
	u, err := s.store.GetByCognitoSub(ctx, subject)
	if errors.Is(err, entities.ErrUserNotFound) {
		return nil, nil
	}
	return u, err
}

func candidateResult(u *entities.User, created bool) (*entities.User, bool, error) {
	if u.UserType != valueobjects.UserCandidate {
		return nil, false, ErrAccountExists
	}
	return u, created, nil
}

func (s *CandidateIdentity) Onboard(ctx context.Context, subject, accessToken, rawName string) (*entities.User, bool, error) {
	name, err := valueobjects.NewFullName(rawName)
	if err != nil || !utf8.ValidString(rawName) || utf8.RuneCountInString(name.Value()) < 2 || utf8.RuneCountInString(name.Value()) > 120 {
		return nil, false, ErrInvalidCandidateName
	}
	existing, err := s.Me(ctx, subject)
	if err != nil {
		return nil, false, err
	}
	if existing != nil {
		return candidateResult(existing, false)
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
	user, err := entities.NewUser(subject, email, name, valueobjects.UserCandidate)
	if err != nil {
		return nil, false, err
	}
	user, created, err := s.store.CreateCandidate(ctx, user)
	if err != nil {
		return nil, false, err
	}
	return candidateResult(user, created)
}
