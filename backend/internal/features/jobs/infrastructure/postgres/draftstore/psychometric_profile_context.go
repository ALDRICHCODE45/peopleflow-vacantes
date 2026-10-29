package draftstore

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// PsychometricProfileContext retains the checklist's owner-or-principal gates
// and parent lock in the caller's transaction. No sibling feature is imported.
func (s *Store) PsychometricProfileContext(ctx context.Context, tx pgx.Tx, company, actor, id uuid.UUID, write bool) ([]string, error) {
	if _, err := s.authorizeChecklist(ctx, tx, company, actor, id); err != nil {
		return nil, err
	}
	if write {
		if err := requireActiveProcess(ctx, tx, id); err != nil {
			return nil, err
		}
	}
	return checklistStages(ctx, tx, id)
}

func (s *Store) PsychometricProfileCheckIfMatch(issued, value string, present bool) error {
	return pipelineconfig.CheckIfMatch(issued, value, present)
}

// AuditPsychometricProfile uses the existing PII-free event builder and audit
// port; the profile store owns the transaction's commit or rollback.
func (s *Store) AuditPsychometricProfile(ctx context.Context, tx pgx.Tx, actor, id uuid.UUID, version int64, previous, next []byte) error {
	event := newDraftEvent(actor, "JobDraftPsychometricProfileConfigured", id, version)
	event.Metadata["previous"] = string(previous)
	event.Metadata["new"] = string(next)
	return s.audit.Append(ctx, tx, event)
}
