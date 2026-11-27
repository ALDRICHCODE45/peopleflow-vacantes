package unsubscribe

import (
	"context"
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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
			return turnOffFailure(err)
		}
		off := false
		t.Email = &off
		out = t
		return nil
	})
	var se *storeError
	switch {
	case err == nil:
		return out, nil
	case errors.Is(err, ErrNoTarget), errors.As(err, &se):
		return Target{}, err
	default:
		return Target{}, &storeError{step: "tx", err: err} // begin / commit
	}
}

// storeError tags a store failure with its step for the log (step and
// SQLSTATE only, failureAttrs); the wrapped error never reaches the response.
type storeError struct {
	step string
	err  error
}

func (e *storeError) Error() string {
	return "notification unsubscribe " + e.step + ": " + e.err.Error()
}
func (e *storeError) Unwrap() error { return e.err }

// sqlstateForeignKeyViolation is PostgreSQL's foreign_key_violation.
const sqlstateForeignKeyViolation = "23503"

// turnOffFailure maps an upsert failure: a foreign-key violation (23503) means
// the user or company was deleted after the check — the uniform invalid
// outcome; anything else is a step failure.
func turnOffFailure(err error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == sqlstateForeignKeyViolation {
		return ErrNoTarget
	}
	return &storeError{step: "unsubscribe_upsert", err: err}
}

// failureAttrs returns the step and the SQLSTATE ("" when not a database
// error) of a store failure; "unknown" when untagged.
func failureAttrs(err error) (step, sqlstate string) {
	step = "unknown"
	var se *storeError
	if errors.As(err, &se) {
		step = se.step
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		sqlstate = pg.Code
	}
	return step, sqlstate
}

func target(ctx context.Context, q *db.Queries, k domain.PreferenceKey) (Target, error) {
	row, err := q.GetNotificationUnsubscribeTarget(ctx, db.GetNotificationUnsubscribeTargetParams{
		UserID: k.User, CompanyID: company(k), Type: string(k.Type),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Target{}, ErrNoTarget
	}
	if err != nil {
		return Target{}, &storeError{step: "target_read", err: err}
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
