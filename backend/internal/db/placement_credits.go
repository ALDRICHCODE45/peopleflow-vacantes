package db

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
)

// ReadPlacementCredits hydrates names from users, like existing actor summaries.
// Attribution and mode always come from the frozen credit, never the live team.
func ReadPlacementCredits(ctx context.Context, q DBTX, process, participation uuid.UUID) (json.RawMessage, error) {
	var raw []byte
	err := q.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(item ORDER BY hired_at DESC,id DESC),'[]'::jsonb) FROM (
 SELECT c.id,c.hired_at,jsonb_build_object('id',c.id,'status',c.status,'team_mode',c.team_mode,'hired_at',to_char(c.hired_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'hired_by',jsonb_build_object('id',u.id,'name',u.full_name),'exit_reason',c.exit_reason,
 'recipients',COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id',r.user_id,'name',ru.full_name,'kind',r.kind) ORDER BY r.user_id)
 FROM placement_credit_recipients r JOIN users ru ON ru.id=r.user_id WHERE r.credit_id=c.id),'[]'::jsonb)) item
 FROM placement_credits c JOIN users u ON u.id=c.hired_by WHERE c.process_id=$1 AND c.participation_id=$2) credits`, process, participation).Scan(&raw)
	return json.RawMessage(raw), err
}
