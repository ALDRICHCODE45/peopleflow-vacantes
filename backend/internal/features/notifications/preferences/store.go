package preferences

import (
	"context"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/inbox"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store reads and writes the caller's override rows through sqlc. The key is
// (scope user, scope company) for members and (scope user, NULL) for
// candidates (D1); nothing else in the scope is used.
type Store struct {
	pool  *pgxpool.Pool
	inbox *inbox.Store
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool, inbox: inbox.NewStore(pool)} }

var readOnly = pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}

// CandidateUser resolves the live candidate account of a session subject
// (inbox.ErrNoCandidate when there is none), as on the candidate inbox.
func (s *Store) CandidateUser(ctx context.Context, sub string) (uuid.UUID, error) {
	return s.inbox.CandidateUser(ctx, sub)
}

// Catalog returns the caller's catalog from one read-only snapshot.
func (s *Store) Catalog(ctx context.Context, scope inbox.Scope) (Catalog, error) {
	var out Catalog
	err := pgx.BeginTxFunc(ctx, s.pool, readOnly, func(tx pgx.Tx) error {
		var err error
		out, err = catalog(ctx, db.New(tx), scope)
		return err
	})
	if err != nil {
		return Catalog{}, err
	}
	return out, nil
}

// Put upserts every entry as an explicit settings row and returns the catalog
// after the change, all in one transaction: any failure writes nothing (D4).
// Entries come from ParsePut (distinct pairs of the caller's tree, no locked
// type).
func (s *Store) Put(ctx context.Context, scope inbox.Scope, entries []Entry) (Catalog, error) {
	var out Catalog
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		q := db.New(tx)
		for _, e := range entries {
			if err := q.UpsertNotificationPreference(ctx, db.UpsertNotificationPreferenceParams{
				UserID: scope.UserID, CompanyID: company(scope), Type: string(e.Type), Channel: string(e.Channel), Enabled: e.Enabled,
			}); err != nil {
				return fmt.Errorf("upsert notification preference: %w", err)
			}
		}
		var err error
		out, err = catalog(ctx, q, scope)
		return err
	})
	if err != nil {
		return Catalog{}, err
	}
	return out, nil
}

func catalog(ctx context.Context, q *db.Queries, scope inbox.Scope) (Catalog, error) {
	rows, err := q.ListNotificationPreferences(ctx, db.ListNotificationPreferencesParams{UserID: scope.UserID, CompanyID: company(scope)})
	if err != nil {
		return Catalog{}, fmt.Errorf("list notification preferences: %w", err)
	}
	overrides := make(map[Pair]bool, len(rows))
	for _, r := range rows {
		overrides[Pair{domain.Type(r.Type), domain.Channel(r.Channel)}] = r.Enabled
	}
	deliverable, err := q.GetNotificationEmailDeliverable(ctx, scope.UserID)
	if err != nil {
		return Catalog{}, fmt.Errorf("get notification email deliverable: %w", err)
	}
	return Build(kind(scope), overrides, deliverable), nil
}

func kind(scope inbox.Scope) domain.RecipientKind {
	if scope.Candidate {
		return domain.RecipientCandidate
	}
	return domain.RecipientMember
}

func company(scope inbox.Scope) pgtype.UUID {
	if scope.Candidate {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: scope.CompanyID, Valid: true}
}
