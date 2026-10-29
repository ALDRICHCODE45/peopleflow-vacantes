// Package invitations defines the employer-only assessment lifecycle boundary.
package invitations

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrUnavailable           = errors.New("psychometric assessment unavailable")
	ErrNotFound              = errors.New("psychometric invitation not found")
	ErrProfileDisabled       = errors.New("psychometric profile disabled")
	ErrAlreadyFinished       = errors.New("psychometric assessment already finished")
	ErrParticipationInactive = errors.New("participation inactive")
	ErrInvitationClosed      = errors.New("psychometric invitation closed")
)

type Actor struct {
	ID       uuid.UUID `json:"id"`
	FullName string    `json:"full_name"`
}
type Invitation struct {
	ID              uuid.UUID  `json:"id"`
	ParticipationID uuid.UUID  `json:"participation_id"`
	Test            string     `json:"test"`
	ContentVersion  string     `json:"content_version"`
	ScoringVersion  string     `json:"scoring_version"`
	Status          string     `json:"status"`
	Origin          string     `json:"origin"`
	CreatedBy       *Actor     `json:"created_by"`
	TriggerStageID  *uuid.UUID `json:"trigger_stage_id"`
	CreatedAt       time.Time  `json:"created_at"`
	ExpiresAt       time.Time  `json:"expires_at"`
	ConsentedAt     *time.Time `json:"consented_at"`
	AnsweredCount   int        `json:"answered_count"`
	TotalCount      int        `json:"total_count"`
	FinishedAt      *time.Time `json:"finished_at"`
	LastRemindedAt  *time.Time `json:"last_reminded_at"`
	ReminderCount   int        `json:"reminder_count"`
}

// StatusAt is computed, never persisted. Revocation wins over finish; neither
// a finished nor a revoked invitation changes status when its expiry passes.
func StatusAt(now, expires time.Time, consented, finished, revoked *time.Time) string {
	switch {
	case revoked != nil:
		return "revoked"
	case finished != nil:
		return "finished"
	case !now.Before(expires):
		return "expired"
	case consented != nil:
		return "in_progress"
	default:
		return "created"
	}
}
func (i Invitation) Active() bool { return i.Status == "created" || i.Status == "in_progress" }

type Result struct {
	Body   []byte
	Status int
}
type Link struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

type Store interface {
	MintLink(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (Result, error)
	ListInvitations(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (Result, error)
	CreateInvitation(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (Result, error)
	RemindInvitation(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (Result, error)
	RevokeInvitation(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (Result, error)
}
