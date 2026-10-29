package v2

import (
	"context"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// StageEntryHook runs in the entry transaction after the process and participation
// are exclusively owned (new rows count). It must not acquire parent locks.
// Only move, recovery, intake and apply are stage entries; not relocation/substate.
type StageEntryHook interface {
	OnStageEntered(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, uuid.UUID, string) error
}
