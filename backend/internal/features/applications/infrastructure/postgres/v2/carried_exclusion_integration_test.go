//go:build integration

package v2

import (
	"context"
	"errors"
	"testing"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// A candidate reused by a replacement process (docs/contracts/replacement-processes-v1.md,
// «Implementation notes»: candidate-facing reads exclude carried rows) never sees the
// carried participation as an application they made, even when the replacement is public.
func TestCandidateApplicationsExcludeCarriedParticipations(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := m.pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	replacement, carried := uuid.New(), uuid.New()
	exec(cloneDraftWithTeam, replacement, m.vacancy)
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, replacement, m.company, m.recruiter)
	// A replacement published later has a projection of its own: the same ad, another process.
	exec(`INSERT INTO vacancy_public_projections(id,company_id,title,description_plain,work_mode,work_schedule,contract_type,professional_area,benefits,published_at,source_draft_version,skills,screening_questions,requirements_profile)
 SELECT $1,company_id,title,description_plain,work_mode,work_schedule,contract_type,professional_area,benefits,now(),source_draft_version,skills,screening_questions,requirements_profile FROM vacancy_public_projections WHERE id=$2`, replacement, m.vacancy)
	defaults := pipelineconfig.Defaults(replacement)
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,source,profile_snapshot,questions_snapshot,answers_snapshot,origin_channel,created_at,carried_from_participation_id)
 SELECT $1,$2,candidate_id,$3,cv_version_id,source,profile_snapshot,questions_snapshot,answers_snapshot,origin_channel,now(),id FROM process_participations WHERE id=$4`, carried, replacement, defaults.Stages[0].ID, m.item.ID)

	page, err := m.store.List(ctx, m.sub, app.Query{Limit: 20})
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != m.item.ID {
		t.Fatalf("my applications = %+v, %v; want only the application the candidate made", page.Items, err)
	}

	// The recruiter discards the carried participation with a message: the candidate cannot reach it.
	exec(`UPDATE process_participations SET stage_id=$2,previous_stage_id=$3,reason_group='candidate',reason_code='unresponsive',candidate_message='Gracias',discarded_at=now() WHERE id=$1`, carried, defaults.Exit.ID, defaults.Stages[0].ID)
	if err = m.store.MarkMessageRead(ctx, m.sub, carried, time.Now()); !errors.Is(err, app.ErrNotFound) {
		t.Fatalf("message-read of a carried participation: %v, want not found", err)
	}
	page, err = m.store.List(ctx, m.sub, app.Query{Limit: 20})
	if err != nil || len(page.Items) != 1 || page.Items[0].Message != nil {
		t.Fatalf("my applications after the discard = %+v, %v", page.Items, err)
	}
}
