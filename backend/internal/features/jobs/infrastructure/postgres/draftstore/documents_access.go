package draftstore

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// roleStakeholder is the read-only membership role (stakeholder-metrics-v1): it reads, never writes.
const roleStakeholder = "stakeholder"

// Documents access (docs/contracts/placement-vacancy-documents-v1.md, «Authorization», D4, D6).
//
// The documents feature keeps its own store but not its own copy of the vacancy rules: it calls
// AuthorizeDocuments inside its transaction, so the live user/company/membership gates, the
// company-scoped draft read, the owner-or-active-tramo rule and the former-member answer are the
// ones every vacancy route already uses. The documents feature cannot import this package (archguard),
// so cmd/api adapts the result and the errors.

// DocumentAccess is what a documents store needs to know about the caller after authorization.
type DocumentAccess struct {
	// Role is the caller's live membership role (owner, recruiter, stakeholder).
	Role string
	// CanManage is the manage gate: the company owner or an active member of the vacancy's team, never a stakeholder.
	CanManage bool
}

// authorizedRead is the documents read gate: everyone `authorized` plus every stakeholder of the
// company. A stakeholder needs no tramo and no process row: the draft is read scoped to the session
// company, so the reach is the whole organization and never another company (D6).
func authorizedRead(auth authContext, actor uuid.UUID, record draftRecord) bool {
	return authorized(auth, actor, record) || auth.role == roleStakeholder
}

// authorizedManage is the documents manage gate: the draft rule (`authorized`), except that a
// stakeholder never manages, not even while a stale tramo of theirs is still open (D4).
func authorizedManage(auth authContext, actor uuid.UUID, record draftRecord) bool {
	return auth.role != roleStakeholder && authorized(auth, actor, record)
}

// AuthorizeDocuments authorizes actor to READ the documents of draftID inside tx (the caller's
// transaction, which keeps the FOR SHARE gate locks until it ends). It needs no process row, so a
// never-published draft authorizes too, and it takes no draft row lock: reads never wait for writers.
//
// The failures are the draft ones: drafts.ErrUnauthenticated / ErrCompanyInactive / ErrCompanyNotActive /
// ErrForbidden from the gates, drafts.ErrNotFound for a missing, foreign-company, v1-schema or
// not-visible draft, and drafts.ErrTeamAccessEnded for a recruiter whose tramo ended (draftAccessError).
func (s *Store) AuthorizeDocuments(ctx context.Context, tx pgx.Tx, companyID, actorID, draftID uuid.UUID) (DocumentAccess, error) {
	auth, err := s.lockGates(ctx, tx, companyID, actorID)
	if err != nil {
		return DocumentAccess{}, err
	}
	record, found, err := readDraft(ctx, tx, companyID, draftID, false, actorID)
	if err != nil {
		return DocumentAccess{}, err
	}
	if !found || !authorizedRead(auth, actorID, record) {
		return DocumentAccess{}, draftAccessError(ctx, tx, actorID, record, found)
	}
	// A draft of the v1 schema is hidden exactly like a missing one, as on every v2 draft route (A4).
	if err := requireV2ReadDocument(record.fields); err != nil {
		return DocumentAccess{}, err
	}
	return DocumentAccess{Role: auth.role, CanManage: authorizedManage(auth, actorID, record)}, nil
}
