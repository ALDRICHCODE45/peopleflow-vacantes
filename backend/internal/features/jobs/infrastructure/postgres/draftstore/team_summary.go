package draftstore

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Shared by draft reads and the list's single page query. d is the draft alias;
// $3 is the caller, matching visibleV2Drafts. Only open tramos/functions count.
const teamSummarySQL = `(SELECT jsonb_build_object('mode',t.mode,
 'responsible',(SELECT jsonb_build_object('id',a.user_id,'name',u.full_name)
 FROM vacancy_assignments a JOIN vacancy_assignment_functions f ON f.assignment_id=a.id AND f.ended_at IS NULL AND f.function='responsible'
 LEFT JOIN users u ON u.id=a.user_id AND u.deleted_at IS NULL WHERE a.draft_id=d.id AND a.ended_at IS NULL),
 'members_count',(SELECT count(*) FROM vacancy_assignments a WHERE a.draft_id=d.id AND a.ended_at IS NULL),
 'viewer_function',(SELECT f.function FROM vacancy_assignments a JOIN vacancy_assignment_functions f ON f.assignment_id=a.id AND f.ended_at IS NULL WHERE a.draft_id=d.id AND a.ended_at IS NULL AND a.user_id=$3))
 FROM vacancy_teams t WHERE t.draft_id=d.id)`

func readTeamSummary(ctx context.Context, tx pgx.Tx, id, actor uuid.UUID) (vacancyteam.Summary, error) {
	var out vacancyteam.Summary
	var raw []byte
	query := `SELECT ` + strings.ReplaceAll(teamSummarySQL, "$3", "$2") + ` FROM job_drafts d WHERE d.id=$1`
	if err := tx.QueryRow(ctx, query, id, actor).Scan(&raw); err != nil {
		return out, fmt.Errorf("read team summary: %w", err)
	}
	if len(raw) == 0 {
		return out, fmt.Errorf("draftstore: missing team summary")
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, fmt.Errorf("decode team summary: %w", err)
	}
	return out, nil
}
