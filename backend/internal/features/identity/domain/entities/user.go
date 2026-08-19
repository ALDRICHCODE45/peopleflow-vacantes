// Package entities holds the identity bounded-context domain entities.
package entities

import (
	"errors"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	"github.com/google/uuid"
)

// Identity-domain sentinel errors. The 7 sentinels are pairwise distinct so
// callers can dispatch on a single errors.Is chain. The three VO-shaped
// errors (Email, FullName, UserType) re-export the valueobjects sentinels by
// value reference so callers can match either package's name against the
// same pointer.
var (
	ErrEmptyCognitoSub  = errors.New("cognito_sub is required")
	ErrInvalidEmail     = valueobjects.ErrInvalidEmail
	ErrFullNameTooShort = valueobjects.ErrFullNameTooShort
	ErrInvalidUserType  = valueobjects.ErrInvalidUserType
	ErrUserNotFound     = errors.New("user not found")
	ErrUserExists       = errors.New("user already exists")
	ErrEmailTaken       = errors.New("email already in use")
)

// User is the aggregate root of the identity bounded context. Required
// inputs are encoded as value objects (Email, FullName, UserType); the
// cognito_sub is the bridge between Cognito and the local Postgres row and
// is treated as an opaque string owned by Cognito.
type User struct {
	ID         uuid.UUID
	CognitoSub string
	Email      valueobjects.Email
	FullName   valueobjects.FullName
	UserType   valueobjects.UserType

	CreatedAt time.Time
	UpdatedAt time.Time
	DeletedAt *time.Time
}

// NewUser creates a new User aggregate in its initial state. It validates
// each input (cognito_sub first, then VO validation) and assigns ID +
// timestamps. The constructor returns the same sentinel errors as the VO
// constructors so callers can dispatch on a single errors.Is chain.
func NewUser(cognitoSub string, email valueobjects.Email, fullName valueobjects.FullName, userType valueobjects.UserType) (*User, error) {
	if strings.TrimSpace(cognitoSub) == "" {
		return nil, ErrEmptyCognitoSub
	}

	if userType == valueobjects.UnknownUserType {
		return nil, ErrInvalidUserType
	}

	id, err := uuid.NewV7()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()

	return &User{
		ID:         id,
		CognitoSub: cognitoSub,
		Email:      email,
		FullName:   fullName,
		UserType:   userType,
		CreatedAt:  now,
		UpdatedAt:  now,
	}, nil
}
