package usecases

import (
	"context"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
)

// SessionStore records a session event for the user behind a JWT subject
// (audit-log-v1 §3). Only a user with a company membership is recorded: for a
// candidate, a user without a membership, a deleted user or an unknown subject it
// writes nothing and returns nil.
type SessionStore interface {
	RecordSession(ctx context.Context, subject, eventType string) error
}

// Sessions reports the two session events the BFF sends: a sign-in and a clicked
// sign-out. A session that ends by token expiry has no event, by design.
type Sessions struct{ store SessionStore }

func NewSessions(store SessionStore) *Sessions { return &Sessions{store: store} }

// Started records a sign-in.
func (s *Sessions) Started(ctx context.Context, subject string) error {
	return s.store.RecordSession(ctx, subject, audit.EventSessionStarted)
}

// Ended records a clicked sign-out.
func (s *Sessions) Ended(ctx context.Context, subject string) error {
	return s.store.RecordSession(ctx, subject, audit.EventSessionEnded)
}
