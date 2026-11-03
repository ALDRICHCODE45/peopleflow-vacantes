package board

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
)

type CreditRecipient struct {
	UserID uuid.UUID `json:"user_id"`
	Name   string    `json:"name"`
	Kind   string    `json:"kind"`
}
type PlacementCredit struct {
	ID         uuid.UUID         `json:"id"`
	Status     string            `json:"status"`
	TeamMode   string            `json:"team_mode"`
	HiredAt    string            `json:"hired_at"`
	HiredBy    AddedBy           `json:"hired_by"`
	ExitReason *string           `json:"exit_reason"`
	Recipients []CreditRecipient `json:"recipients"`
}
type CreditCapabilities struct {
	Void    bool `json:"void_credit"`
	Restore bool `json:"restore_credit"`
}

func CreditCan(owner bool, credit *PlacementCredit) CreditCapabilities {
	if !owner || credit == nil {
		return CreditCapabilities{}
	}
	return CreditCapabilities{Void: credit.Status == "active" || credit.Status == "did_not_hold", Restore: credit.Status == "voided"}
}

type CreditList struct {
	Items json.RawMessage `json:"items"`
}
type CreditReader interface {
	PlacementCredits(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (CreditList, error)
}
