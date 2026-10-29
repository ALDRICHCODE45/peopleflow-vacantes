package invitations

import (
	"context"
	"crypto/sha256"

	"github.com/google/uuid"
)

// TokenFinder returns uuid.Nil for every unavailable state. It must use one
// query shape, including for invalid input; database failures remain internal errors.
type TokenFinder interface {
	FindAvailableToken(context.Context, [32]byte, bool) (uuid.UUID, error)
}

// LookupToken hashes the exact ASCII/UTF-8 bytes sent on the wire, NOT the
// decoded entropy. Malformed, unknown, expired and revoked share one outcome.
// This is constant-shape processing, not a constant-time database guarantee.
func LookupToken(ctx context.Context, finder TokenFinder, raw string) (uuid.UUID, error) {
	valid := len(raw) == 43
	for n := 0; n < len(raw); n++ {
		c := raw[n]
		allowed := (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_'
		valid = allowed && valid
	}
	hash := sha256.Sum256([]byte(raw))
	id, err := finder.FindAvailableToken(ctx, hash, valid)
	if err != nil {
		return uuid.Nil, err
	}
	if !valid || id == uuid.Nil {
		return uuid.Nil, ErrUnavailable
	}
	return id, nil
}
