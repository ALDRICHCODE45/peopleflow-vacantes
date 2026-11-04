package postgres

import (
	"context"
	"errors"

	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SessionStore resolves the member behind a JWT subject and appends the session
// event in one transaction. IP and browser come from the request context, as for
// every audit event.
type SessionStore struct {
	pool  *pgxpool.Pool
	audit auditrepositories.AuditEventRepository
}

var _ usecases.SessionStore = (*SessionStore)(nil)

func NewSessionStore(pool *pgxpool.Pool, audit auditrepositories.AuditEventRepository) *SessionStore {
	return &SessionStore{pool: pool, audit: audit}
}

func (s *SessionStore) RecordSession(ctx context.Context, subject, eventType string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var user, company uuid.UUID
	// The membership row is the only thing that makes a user recordable: a
	// candidate cannot have one, and an unknown or deleted user resolves to nothing.
	err = tx.QueryRow(ctx, `SELECT u.id, m.company_id FROM users u JOIN company_members m ON m.user_id = u.id WHERE u.cognito_sub = $1 AND u.deleted_at IS NULL`, subject).Scan(&user, &company)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err = s.audit.Append(ctx, tx, auditentities.AuditEvent{ID: uuid.Must(uuid.NewV7()), ActorType: auditentities.ActorTypeUser, ActorID: &user, EventType: eventType, EntityType: "user", EntityID: user, CompanyID: &company, Metadata: map[string]string{}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
