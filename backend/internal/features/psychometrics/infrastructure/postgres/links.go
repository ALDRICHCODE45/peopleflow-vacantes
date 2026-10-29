package postgres

import (
	"context"
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/invitations"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// LookupToken is intentionally not routed. Callers must not log raw tokens.
func (s *InvitationsStore) LookupToken(ctx context.Context, raw string) (uuid.UUID, error) {
	return invitations.LookupToken(ctx, s, raw)
}

// FindAvailableToken uses the same indexed query and result shape for malformed,
// unknown, revoked and expired tokens. Finished invitations remain readable.
// Candidate writes must recheck availability under the B4 locks (B7).
func (s *InvitationsStore) FindAvailableToken(ctx context.Context, hash [32]byte, valid bool) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `SELECT id FROM psychometric_invitations WHERE token_hash=$1 AND $2::boolean AND revoked_at IS NULL AND isfinite(purge_after) AND purge_after > clock_timestamp() AND expires_at > clock_timestamp()`, hash[:], valid).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, nil
	}
	if err != nil {
		return uuid.Nil, err
	}
	return id, nil
}
