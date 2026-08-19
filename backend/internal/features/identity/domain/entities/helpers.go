// Package entities holds the identity bounded-context domain entities.
package entities

import "errors"

// IsErrUserExists is a small helper the application layer uses to keep
// the domain-level imports pgx-free. It exists so idempotent re-delivery
// of the PostConfirmation trigger can short-circuit on the doctrine's
// "already persisted" sentinel.
func IsErrUserExists(err error) bool {
	return errors.Is(err, ErrUserExists)
}
