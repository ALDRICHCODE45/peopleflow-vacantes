package usecases

import (
	"context"
	"fmt"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	"github.com/google/uuid"
)

// TransitionApplication is the recruiter's PATCH /jobs/{jobId}/applications/{id}/transition
// handler. The request-first validation order is pinned by design D8:
//
//  1. Empty / whitespace-only status → ErrStatusRequired (400).
//  2. ParseApplicationStatus (unknown value) → unwrapped
//     valueobjects.ErrInvalidStatusTransition (400 "invalid status transition").
//  3. repo.GetByID (404 on cross-company / non-existent / mismatched job).
//  4. Matrix enforcement: from.CanTransitionTo(to) → wrapped
//     ErrInvalidStatusTransition with the "<from> -> <to>" body.
//  5. D8 actor guard: userID == uuid.Nil → ErrMissingActorIdentity (fail-closed
//     500 — no status change, no audit event). Unreachable via the designed
//     flow: RequireCompanyRole always resolves a real users.id.
//  6. repo.Transition (guarded write + co-write audit append; lost race →
//     ErrApplicationNotFound → 404).
//
// Validation order rationale: the request shape (status required +
// parseable) is checked BEFORE the DB read so a malformed request never
// costs a query and never leaks whether the target exists. 400 is not
// existence-leaking, so this ordering is safe. The actor guard sits after
// the matrix so an illegal transition 400 is never masked by a 500 — the
// matrix is reachable with the same actor in production.
func (s *ApplicationService) TransitionApplication(
	ctx context.Context,
	companyID, userID, jobID, applicationID uuid.UUID,
	in dtos.TransitionRequestDto,
) (*entities.Application, error) {
	if strings.TrimSpace(in.Status) == "" {
		return nil, entities.ErrStatusRequired
	}

	to, err := valueobjects.ParseApplicationStatus(in.Status)
	if err != nil {
		// unwrapped: the body is the bare sentinel message
		// ("invalid status transition"), not the named "<from> -> <to>"
		// form (we never learned `from` here).
		return nil, valueobjects.ErrInvalidStatusTransition
	}

	current, err := s.repo.GetByID(ctx, applicationID, jobID, companyID)
	if err != nil {
		return nil, err // ErrApplicationNotFound
	}

	from := current.Status
	if !from.CanTransitionTo(to) {
		// wrapped: the HTTP classifier renders err.Error() as the body,
		// producing exactly "invalid status transition: <from> -> <to>".
		return nil, fmt.Errorf("%w: %s -> %s",
			valueobjects.ErrInvalidStatusTransition, from, to)
	}

	// D8 fail-closed actor guard: no status change, no event.
	if userID == uuid.Nil {
		return nil, ErrMissingActorIdentity
	}

	// D7 event intent: the audit event id is a fresh UUID v7 owned by the use
	// case; the actor is the CompanyContext.UserID; the metadata is PII-free
	// ({job_id, from_status, to_status}). The adapter only appends the event
	// inside the co-write transaction.
	eventID, err := uuid.NewV7()
	if err != nil {
		return nil, err
	}
	event := newTransitionedEvent(eventID, applicationID, userID, jobID, from, to)

	return s.repo.Transition(ctx, applicationID, jobID, companyID, from, to, event)
}
