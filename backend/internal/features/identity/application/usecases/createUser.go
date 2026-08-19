package usecases

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
)

// CreateUserParams is the input shape for the CreateUser use case. The use
// case owns VO parsing so the transport layer (PostConfirmation, future
// HTTP handler) doesn't need to know about the domain VOs.
type CreateUserParams struct {
	CognitoSub string
	Email      string
	FullName   string
	UserType   string
}

// CreateUser validates the inputs through their VOs, builds the aggregate
// via entities.NewUser, and persists it through the repository. VO
// validation errors short-circuit before the repository is invoked.
func (s *UserService) CreateUser(ctx context.Context, params CreateUserParams) (*entities.User, error) {
	if params.CognitoSub == "" {
		return nil, entities.ErrEmptyCognitoSub
	}

	email, err := valueobjects.NewEmail(params.Email)
	if err != nil {
		return nil, err
	}

	fullName, err := valueobjects.NewFullName(params.FullName)
	if err != nil {
		return nil, err
	}

	userType, err := valueobjects.NewUserType(params.UserType)
	if err != nil {
		return nil, err
	}

	user, err := entities.NewUser(params.CognitoSub, email, fullName, userType)
	if err != nil {
		return nil, err
	}

	return s.repository.Create(ctx, user)
}
