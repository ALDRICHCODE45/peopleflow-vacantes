package postgres

import (
	"context"
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Identity owns these additive audit literals; no migration is needed because
// event_type/entity_type have no DB CHECK. Metadata contains no identity PII.
const CandidateAccountCreated = auditentities.EventCandidateAccountCreated
const EmployerAccountCreated = auditentities.EventEmployerAccountCreated
const accountEntity = "user"

// accountCreatedEvent is the audit type of a self-service account creation,
// chosen by the account's role (embedded-auth-v1 D4).
func accountCreatedEvent(role valueobjects.UserType) (string, bool) {
	switch role {
	case valueobjects.UserCandidate:
		return CandidateAccountCreated, true
	case valueobjects.UserRecruiter:
		return EmployerAccountCreated, true
	default:
		return "", false
	}
}

// CandidateAccountStore creates candidate and employer accounts (the name is
// kept from the candidate-only origin; see usecases.AccountStore).
type CandidateAccountStore struct {
	pool  *pgxpool.Pool
	audit auditrepositories.AuditEventRepository
}

var _ usecases.AccountStore = (*CandidateAccountStore)(nil)

func NewCandidateAccountStore(pool *pgxpool.Pool, audit auditrepositories.AuditEventRepository) *CandidateAccountStore {
	return &CandidateAccountStore{pool: pool, audit: audit}
}
func (s *CandidateAccountStore) GetByCognitoSub(ctx context.Context, subject string) (*entities.User, error) {
	return NewUserRepository(db.New(s.pool)).GetByCognitoSub(ctx, subject)
}

// CreateAccount inserts the user and appends its account-created audit event
// in one transaction; an audit failure rolls the insert back.
func (s *CandidateAccountStore) CreateAccount(ctx context.Context, user *entities.User) (*entities.User, bool, error) {
	eventType, ok := accountCreatedEvent(user.UserType)
	if !ok {
		return nil, false, entities.ErrInvalidUserType
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	created, err := NewUserRepository(db.New(tx)).Create(ctx, user)
	if err != nil {
		// A unique violation aborts the transaction. A concurrent same-subject
		// winner still takes precedence over its now-irrelevant email collision.
		if errors.Is(err, entities.ErrEmailTaken) {
			if rollbackErr := tx.Rollback(ctx); rollbackErr != nil {
				return nil, false, rollbackErr
			}
			existing, getErr := s.GetByCognitoSub(ctx, user.CognitoSub)
			if getErr == nil {
				return existing, false, nil
			}
			if !errors.Is(getErr, entities.ErrUserNotFound) {
				return nil, false, getErr
			}
		}
		return nil, false, err
	}
	if created.ID != user.ID {
		return created, false, nil
	}
	eventID, err := uuid.NewV7()
	if err != nil {
		return nil, false, err
	}
	if err := s.audit.Append(ctx, tx, auditentities.AuditEvent{ID: eventID, ActorType: auditentities.ActorTypeUser, ActorID: &created.ID, EventType: eventType, EntityType: accountEntity, EntityID: created.ID, Metadata: map[string]string{}}); err != nil {
		return nil, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	return created, true, nil
}
