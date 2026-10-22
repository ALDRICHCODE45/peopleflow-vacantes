package pool

import (
	"context"
	"encoding/json"
	"errors"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Store) History(ctx context.Context, company uuid.UUID, kind string, id uuid.UUID, q app.HistoryQuery) (app.HistoryPage, error) {
	out := app.HistoryPage{Items: []app.HistoryEntry{}}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	var exists bool
	err = tx.QueryRow(ctx, `SELECT CASE WHEN $2='manual' THEN EXISTS(SELECT 1 FROM company_candidates WHERE company_id=$1 AND id=$3) ELSE EXISTS(SELECT 1 FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE vp.company_id=$1 AND p.company_candidate_id IS NULL AND p.candidate_id=$3) END`, company, kind, id).Scan(&exists)
	if err != nil {
		return out, err
	}
	if !exists {
		return out, board.ErrNotFound
	}
	var at, idAfter any
	if q.After != nil {
		at = q.After.At
		idAfter = q.After.ID
	}
	rows, err := tx.Query(ctx, `SELECT h.id,h.at,h.actor_id,u.full_name,h.changes,h.kind,h.participation_id,h.file_name FROM company_candidate_history h LEFT JOIN users u ON u.id=h.actor_id AND u.deleted_at IS NULL WHERE h.company_id=$1 AND h.candidate_kind=$2 AND h.candidate_id=$3 AND ($4::timestamptz IS NULL OR (h.at,h.id)<($4::timestamptz,$5::uuid)) ORDER BY h.at DESC,h.id DESC LIMIT $6`, company, kind, id, at, idAfter, q.Limit+1)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		entry := app.HistoryEntry{Kind: "edit"}
		var raw []byte
		if err = rows.Scan(&entry.ID, &entry.At, &entry.Actor.ID, &entry.Actor.Name, &raw, &entry.Kind, &entry.ParticipationID, &entry.FileName); err != nil {
			return out, err
		}
		if err = json.Unmarshal(raw, &entry.Changes); err != nil {
			return out, err
		}
		// Fail closed if storage ever contains contact values from another writer.
		for _, c := range entry.Changes {
			if c.Field == "email" || c.Field == "phone" || c.Field == "full_name" {
				if !c.Contact || len(c.From) > 0 || len(c.To) > 0 {
					return out, errors.New("invalid contact history")
				}
			}
		}
		entry.At = entry.At.UTC()
		out.Items = append(out.Items, entry)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	rows.Close()
	return out, tx.Commit(ctx)
}
