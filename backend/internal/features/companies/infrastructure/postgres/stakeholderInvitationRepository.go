package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// StakeholderInvitationRepository stores stakeholder invitations
// (stakeholder-metrics-v1 §1.3). Each write and its audit event (§1.4) commit
// in one transaction.
type StakeholderInvitationRepository struct {
	database memberDatabase
	audit    auditrepositories.AuditEventRepository
}

var _ repositories.StakeholderInvitationRepository = (*StakeholderInvitationRepository)(nil)

// NewStakeholderInvitationRepository wraps a transaction-capable handle and
// the audit port.
func NewStakeholderInvitationRepository(database memberDatabase, audit auditrepositories.AuditEventRepository) *StakeholderInvitationRepository {
	return &StakeholderInvitationRepository{database: database, audit: audit}
}

func (r *StakeholderInvitationRepository) inTx(ctx context.Context, write func(pgx.Tx, *db.Queries) error) error {
	tx, err := r.database.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin stakeholder invitation tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if err := write(tx, db.New(tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit stakeholder invitation tx: %w", err)
	}
	return nil
}

func (r *StakeholderInvitationRepository) appendEvent(ctx context.Context, tx pgx.Tx, actor, company uuid.UUID, eventType, entityType string, entity uuid.UUID, metadata map[string]string) error {
	return r.audit.Append(ctx, tx, auditentities.AuditEvent{ID: uuid.Must(uuid.NewV7()), ActorType: auditentities.ActorTypeUser, ActorID: &actor, EventType: eventType, EntityType: entityType, EntityID: entity, CompanyID: &company, Metadata: metadata})
}

// Create locks the company row (the same lock as member mutations), so two
// concurrent creates cannot both pass the pending limit.
func (r *StakeholderInvitationRepository) Create(ctx context.Context, inv entities.StakeholderInvitation, tokenHash []byte, limit int) error {
	return r.inTx(ctx, func(tx pgx.Tx, q *db.Queries) error {
		if _, err := q.LockCompanyForMemberMutation(ctx, inv.CompanyID); err != nil {
			return fmt.Errorf("lock company: %w", err)
		}
		pending, err := q.CountPendingStakeholderInvitations(ctx, db.CountPendingStakeholderInvitationsParams{CompanyID: inv.CompanyID, ExpiresAt: timestamptz(inv.CreatedAt)})
		if err != nil {
			return err
		}
		if pending >= int64(limit) {
			return entities.ErrInvitationLimitReached
		}
		if err := q.CreateStakeholderInvitation(ctx, db.CreateStakeholderInvitationParams{ID: inv.ID, CompanyID: inv.CompanyID, TokenSha256: tokenHash, CreatedBy: inv.CreatedBy, CreatedAt: timestamptz(inv.CreatedAt), ExpiresAt: timestamptz(inv.ExpiresAt)}); err != nil {
			return err
		}
		return r.appendEvent(ctx, tx, inv.CreatedBy, inv.CompanyID, auditentities.EventStakeholderInvitationCreated, auditentities.EntityStakeholderInvitation, inv.ID,
			map[string]string{"invitation_id": inv.ID.String(), "expires_at": inv.ExpiresAt.UTC().Format(time.RFC3339Nano)})
	})
}

func (r *StakeholderInvitationRepository) ListPending(ctx context.Context, companyID uuid.UUID, now time.Time) ([]entities.StakeholderInvitation, error) {
	rows, err := db.New(r.database).ListPendingStakeholderInvitations(ctx, db.ListPendingStakeholderInvitationsParams{CompanyID: companyID, ExpiresAt: timestamptz(now)})
	if err != nil {
		return nil, err
	}
	out := make([]entities.StakeholderInvitation, 0, len(rows))
	for _, row := range rows {
		out = append(out, entities.StakeholderInvitation{ID: row.ID, CompanyID: companyID, CreatedBy: row.CreatedBy, CreatedAt: pgTimestamptzToTime(row.CreatedAt), ExpiresAt: pgTimestamptzToTime(row.ExpiresAt)})
	}
	return out, nil
}

// Revoke audits only an invitation it actually revoked.
func (r *StakeholderInvitationRepository) Revoke(ctx context.Context, companyID, actor, id uuid.UUID, now time.Time) error {
	return r.inTx(ctx, func(tx pgx.Tx, q *db.Queries) error {
		n, err := q.RevokeStakeholderInvitation(ctx, db.RevokeStakeholderInvitationParams{ID: id, CompanyID: companyID, RevokedAt: timestamptz(now)})
		if err != nil || n == 0 {
			return err
		}
		return r.appendEvent(ctx, tx, actor, companyID, auditentities.EventStakeholderInvitationRevoked, auditentities.EntityStakeholderInvitation, id, map[string]string{"invitation_id": id.String()})
	})
}

// Accept holds the invitation row lock for the whole transaction. A token
// already used by the same user whose membership still exists is a replay:
// the same result, nothing written.
func (r *StakeholderInvitationRepository) Accept(ctx context.Context, userID uuid.UUID, tokenHash []byte, now time.Time) (entities.StakeholderAcceptance, error) {
	var out entities.StakeholderAcceptance
	err := r.inTx(ctx, func(tx pgx.Tx, q *db.Queries) error {
		inv, err := q.GetStakeholderInvitationByTokenForUpdate(ctx, tokenHash)
		if errors.Is(err, pgx.ErrNoRows) {
			return entities.ErrInvitationInvalid
		}
		if err != nil {
			return err
		}
		if inv.UsedAt.Valid {
			if !inv.UsedBy.Valid || uuid.UUID(inv.UsedBy.Bytes) != userID || !inv.MemberID.Valid {
				return entities.ErrInvitationInvalid
			}
			member := uuid.UUID(inv.MemberID.Bytes)
			exists, err := q.StakeholderMembershipExists(ctx, db.StakeholderMembershipExistsParams{ID: member, UserID: userID, CompanyID: inv.CompanyID})
			if err != nil {
				return err
			}
			if !exists {
				return entities.ErrInvitationInvalid
			}
			out = entities.StakeholderAcceptance{CompanyID: inv.CompanyID, MemberID: member}
			return nil
		}
		if inv.RevokedAt.Valid || !pgTimestamptzToTime(inv.ExpiresAt).After(now) {
			return entities.ErrInvitationInvalid
		}
		if _, err := q.LockLiveCompanyForShare(ctx, inv.CompanyID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return entities.ErrInvitationInvalid
			}
			return err
		}
		if _, err := q.GetMembershipByUserID(ctx, userID); err == nil {
			return entities.ErrAlreadyCompanyMember
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		member, err := entities.NewCompanyMember(userID, inv.CompanyID, valueobjects.StakeholderRole)
		if err != nil {
			return err
		}
		if _, err := q.CreateCompanyMember(ctx, buildCreateMemberParams(member)); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return entities.ErrAlreadyCompanyMember
			}
			return err
		}
		if err := q.MarkStakeholderInvitationUsed(ctx, db.MarkStakeholderInvitationUsedParams{ID: inv.ID, UsedAt: timestamptz(now), UsedBy: pgtype.UUID{Bytes: userID, Valid: true}, MemberID: pgtype.UUID{Bytes: member.ID, Valid: true}}); err != nil {
			return err
		}
		if err := r.appendEvent(ctx, tx, userID, inv.CompanyID, auditentities.EventStakeholderInvitationAccepted, auditentities.EntityStakeholderInvitation, inv.ID, map[string]string{"invitation_id": inv.ID.String(), "member_user_id": userID.String()}); err != nil {
			return err
		}
		if err := r.appendEvent(ctx, tx, userID, inv.CompanyID, auditentities.EventCompanyMemberAdded, "company_member", member.ID, map[string]string{"member_user_id": userID.String(), "role": valueobjects.StakeholderRole.String()}); err != nil {
			return err
		}
		out = entities.StakeholderAcceptance{CompanyID: inv.CompanyID, MemberID: member.ID}
		return nil
	})
	return out, err
}

func timestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}
