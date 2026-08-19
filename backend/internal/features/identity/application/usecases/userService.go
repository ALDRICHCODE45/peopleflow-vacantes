// Package usecases orchestrates the identity application logic.
package usecases

import (
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
)

// UserService bundles the identity use cases that share the same repository
// port. Construct it once at the composition root and pass it around.
type UserService struct {
	repository repositories.UserRepository
}

// NewUserService builds the service around the repository port.
func NewUserService(repository repositories.UserRepository) *UserService {
	return &UserService{repository: repository}
}
