package draftstore

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
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

// documentManageDecision is the manage verdict once the caller passed the read gate and the schema gate: only
// `authorizedManage` writes, and the one caller who reads without managing is a stakeholder, whom the contract
// answers 403 forbidden (the recruiter ladder refuses them on every write route, so the store agrees with it).
func documentManageDecision(auth authContext, actor uuid.UUID, record draftRecord) error {
	if !authorizedManage(auth, actor, record) {
		return drafts.ErrForbidden
	}
	return nil
}

// AuthorizeDocumentsManage authorizes actor to WRITE documents of draftID inside tx (upload, replace, delete, link).
// It is the documents counterpart of the draft save authorization and NEVER the board's beginMutation/beginTx: it needs
// no process row and refuses nothing for a closed or finished vacancy (S4), because it never reads the lifecycle.
//
// lock=false is the cheap pre-flight an upload runs before it stores a byte; lock=true takes `job_drafts … FOR UPDATE`
// (readDraft) for the short write transaction, which serializes the write with team changes, moves and lifecycle
// transitions, so a revoked recruiter cannot land it (D23). Failures are the draft ones: the gate errors, ErrNotFound
// (missing, foreign, v1 or never-on-the-team), ErrTeamAccessEnded (former member) and ErrForbidden (a stakeholder).
func (s *Store) AuthorizeDocumentsManage(ctx context.Context, tx pgx.Tx, companyID, actorID, draftID uuid.UUID, lock bool) (DocumentAccess, error) {
	auth, err := s.lockGates(ctx, tx, companyID, actorID)
	if err != nil {
		return DocumentAccess{}, err
	}
	record, found, err := readDraft(ctx, tx, companyID, draftID, lock, actorID)
	if err != nil {
		return DocumentAccess{}, err
	}
	if !found || !authorizedRead(auth, actorID, record) {
		return DocumentAccess{}, draftAccessError(ctx, tx, actorID, record, found)
	}
	if err := requireV2ReadDocument(record.fields); err != nil {
		return DocumentAccess{}, err
	}
	if err := documentManageDecision(auth, actorID, record); err != nil {
		return DocumentAccess{}, err
	}
	return DocumentAccess{Role: auth.role, CanManage: true}, nil
}
