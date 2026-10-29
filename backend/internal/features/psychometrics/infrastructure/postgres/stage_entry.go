package postgres

import (
	"context"
	"errors"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/invitations"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type AutoInvitationContext interface {
	PsychometricStageCurrent(context.Context, pgx.Tx, uuid.UUID, uuid.UUID) (bool, error)
	AuditPsychometricInvitation(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string) error
}

type StageEntryHook struct{ jobs AutoInvitationContext }

func NewStageEntryHook(jobs AutoInvitationContext) *StageEntryHook {
	return &StageEntryHook{jobs: jobs}
}

// OnStageEntered never opens/commits a transaction or locks a parent. The caller
// owns draft -> process -> participation (or has just inserted the participation).
// The only additional row locks are invitation slots, exactly as in manual send.
func (h *StageEntryHook) OnStageEntered(ctx context.Context, tx pgx.Tx, process, participation, stage uuid.UUID, kind string) error {
	switch kind {
	case "move", "recovery", "intake", "apply":
	default:
		return nil
	}
	p, _, err := read(ctx, tx, process)
	if err != nil || !p.Enabled {
		return err
	}
	configured := false
	for _, id := range p.AutoSendStageIDs {
		if id == stage.String() {
			configured = true
			break
		}
	}
	if !configured {
		return nil
	}
	current, err := h.jobs.PsychometricStageCurrent(ctx, tx, process, stage)
	if err != nil || !current {
		return err
	}
	var active bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM process_participations WHERE id=$1 AND process_id=$2 AND stage_id=$3 AND discarded_at IS NULL)`, participation, process, stage).Scan(&active); err != nil || !active {
		return err
	}
	i, created, err := (&InvitationsStore{}).createForParticipation(ctx, tx, participation, p, nil, &stage)
	if errors.Is(err, invitations.ErrAlreadyFinished) {
		return nil
	}
	if err != nil || !created {
		return err
	}
	return h.jobs.AuditPsychometricInvitation(ctx, tx, uuid.Nil, process, participation, i.ID, "PsychometricInvitationCreated")
}
