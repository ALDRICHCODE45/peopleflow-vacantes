package unsubscribe

import (
	"context"
	"errors"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// users.user_type of each tree (members are recruiter accounts, any role).
const (
	userTypeMember    = "recruiter"
	userTypeCandidate = "candidate"
)

// Store reads and writes the token's override row through sqlc. A key is
// served only when its user is live and of the tree's user type and, for a
// member key, its company exists (not soft-deleted); anything else is
// ErrNoTarget. Membership is not re-checked: the row is keyed by the token's
// company (D1), so it can only affect mail of that company.
type Store struct{ pool *pgxpool.Pool }

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Target reads the key's state in one statement; it never writes.
func (s *Store) Target(ctx context.Context, k domain.PreferenceKey) (Target, error) {
	return target(ctx, db.New(s.pool), k)
}

// TurnOff checks the key and upserts email = false in one transaction.
func (s *Store) TurnOff(ctx context.Context, k domain.PreferenceKey) (Target, error) {
	var out Target
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		q := db.New(tx)
		t, err := target(ctx, q, k)
		if err != nil {
			return err
		}
		if err := q.UnsubscribeNotificationEmail(ctx, db.UnsubscribeNotificationEmailParams{
			UserID: k.User, CompanyID: company(k), Type: string(k.Type),
		}); err != nil {
			return fmt.Errorf("unsubscribe notification email: %w", err)
		}
		off := false
		t.Email = &off
		out = t
		return nil
	})
	if err != nil {
		return Target{}, err
	}
	return out, nil
}

func target(ctx context.Context, q *db.Queries, k domain.PreferenceKey) (Target, error) {
	row, err := q.GetNotificationUnsubscribeTarget(ctx, db.GetNotificationUnsubscribeTargetParams{
		UserID: k.User, CompanyID: company(k), Type: string(k.Type),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Target{}, ErrNoTarget
	}
	if err != nil {
		return Target{}, fmt.Errorf("get notification unsubscribe target: %w", err)
	}
	var t Target
	if k.Company == uuid.Nil {
		if row.UserType != userTypeCandidate {
			return Target{}, ErrNoTarget
		}
	} else {
		if row.UserType != userTypeMember || !row.CompanyName.Valid {
			return Target{}, ErrNoTarget
		}
		name := row.CompanyName.String
		t.CompanyName = &name
	}
	if row.EmailOverride.Valid {
		v := row.EmailOverride.Bool
		t.Email = &v
	}
	return t, nil
}

func company(k domain.PreferenceKey) pgtype.UUID {
	if k.Company == uuid.Nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: k.Company, Valid: true}
}
