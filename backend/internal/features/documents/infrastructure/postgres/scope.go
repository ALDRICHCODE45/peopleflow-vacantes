package postgres

import (
	"context"
	"errors"
	"fmt"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// scopeCanReceiveLinks resolves the scope of target inside tx and says whether it can receive links (D17).
//
// A vacancy scope always exists (the draft was authorized) and receives links when the process is a replacement. A participation
// scope exists only when the participation belongs to the draft's process: that is the ONLY participation rule (D3). Its stage,
// its hire credit and its discarded state play no role, so a discarded participation of a closed or finished process resolves
// like any other; a `pid` of another process, of another company or one that does not exist is ErrScopeNotFound (404 not_found,
// no leak). A participation receives links when it is a carried one (`carried_from_participation_id` set).
//
// Callers run it after the authorization (and, for a write, after the draft lock), so a caller who may not touch the vacancy
// never learns whether a `pid` exists.
func scopeCanReceiveLinks(ctx context.Context, tx pgx.Tx, companyID uuid.UUID, target documents.Target) (bool, error) {
	var receives bool
	if target.ParticipationID == nil {
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vacancy_replacements WHERE process_id=$1 AND company_id=$2)`, target.DraftID, companyID).Scan(&receives); err != nil {
			return false, fmt.Errorf("read replacement flag: %w", err)
		}
		return receives, nil
	}
	err := tx.QueryRow(ctx, `
SELECT p.carried_from_participation_id IS NOT NULL
  FROM process_participations p
  JOIN vacancy_processes vp ON vp.id = p.process_id
 WHERE p.id = $1 AND p.process_id = $2 AND vp.company_id = $3`, *target.ParticipationID, target.DraftID, companyID).Scan(&receives)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, documents.ErrScopeNotFound
	}
	if err != nil {
		return false, fmt.Errorf("read participation: %w", err)
	}
	return receives, nil
}
