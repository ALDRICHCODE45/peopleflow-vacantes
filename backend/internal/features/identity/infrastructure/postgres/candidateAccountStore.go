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
const CandidateAccountCreated = "CandidateAccountCreated"
const candidateAccountEntity = "user"

type CandidateAccountStore struct {
	pool  *pgxpool.Pool
	audit auditrepositories.AuditEventRepository
}

var _ usecases.CandidateAccountStore = (*CandidateAccountStore)(nil)

func NewCandidateAccountStore(pool *pgxpool.Pool, audit auditrepositories.AuditEventRepository) *CandidateAccountStore {
	return &CandidateAccountStore{pool: pool, audit: audit}
}
func (s *CandidateAccountStore) GetByCognitoSub(ctx context.Context, subject string) (*entities.User, error) {
	return NewUserRepository(db.New(s.pool)).GetByCognitoSub(ctx, subject)
}

func (s *CandidateAccountStore) CreateCandidate(ctx context.Context, user *entities.User) (*entities.User, bool, error) {
	if user.UserType != valueobjects.UserCandidate {
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
	if err := s.audit.Append(ctx, tx, auditentities.AuditEvent{ID: eventID, ActorType: auditentities.ActorTypeUser, ActorID: &created.ID, EventType: CandidateAccountCreated, EntityType: candidateAccountEntity, EntityID: created.ID, Metadata: map[string]string{}}); err != nil {
		return nil, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	return created, true, nil
}
