//go:build integration

package draftstore

import (
	"context"
	poolpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/pool"
	dashboardapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dashboard"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"testing"
	"time"
)

func newDashboardTestStore(t *testing.T, pool *pgxpool.Pool) *DashboardStore {
	return NewDashboardStore(newStore(t, pool), func(ctx context.Context, tx pgx.Tx, company uuid.UUID) (int64, error) {
		summary, err := poolpostgres.ReadSummary(ctx, tx, company)
		return summary.AddedLast7Days, err
	})
}

func TestDashboardEntriesCoverageAndBoundary(t *testing.T) {
	pool := requireDraftPool(t)
	ctx := context.Background()
	p := newPrincipal(t, pool)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	people := []uuid.UUID{}
	manualCV := uuid.New()
	visible, hidden := uuid.New(), uuid.New()
	recruiter := addMember(t, pool, p.companyID, "recruiter")
	for _, v := range []struct{ id, principal uuid.UUID }{{visible, recruiter}, {hidden, p.ownerID}} {
		seedListV2(t, pool, p, v.principal, v.id, time.Now(), []byte(readV2Document))
		exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, v.id, p.companyID, p.ownerID)
	}
	exec(`INSERT INTO company_candidate_cvs(id,company_id,storage_key,size,content_type,file_name) VALUES($1,$2,$3,6,'application/pdf','manual.pdf')`, manualCV, p.companyID, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
	// Cleanup dependencies before the existing company fixture cleanup.
	t.Cleanup(func() {
		for _, q := range []string{`DELETE FROM process_participations WHERE process_id IN ($1,$2)`, `DELETE FROM company_candidate_cvs WHERE company_id=$1`, `DELETE FROM candidate_cv_versions WHERE candidate_id=ANY($1::uuid[])`, `DELETE FROM users WHERE id=ANY($1::uuid[])`} {
			var args []any
			switch {
			case strings.Contains(q, "process_id"):
				args = []any{visible, hidden}
			case strings.Contains(q, "company_id"):
				args = []any{p.companyID}
			default:
				args = []any{people}
			}
			if _, err := pool.Exec(ctx, q, args...); err != nil {
				t.Error(err)
			}
		}
	})
	loc, err := time.LoadLocation("America/Mexico_City")
	if err != nil {
		t.Fatal(err)
	}
	today := time.Now().In(loc)
	midnight := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, loc)
	config := pipelineconfig.Defaults(visible)
	insert := func(process uuid.UUID, stage, source string, at time.Time) uuid.UUID {
		id := uuid.New()
		person := insertUser(t, pool)
		people = append(people, person)
		if source == "organic" {
			ownCV := uuid.New()
			exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, ownCV, person, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
			exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,created_at) VALUES($1,$2,$3,$4,$5,'[]','[]','organic',$6)`, id, process, person, stage, ownCV, at)
		} else {
			exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,company_candidate_cv_id,added_by,questions_snapshot,answers_snapshot,source,created_at) VALUES($1,$2,$3,$4,$5,$6,'[]','[]','manual',$7)`, id, process, person, stage, manualCV, p.ownerID, at)
		}
		return id
	}
	insert(visible, config.Stages[0].ID, "organic", midnight.Add(-time.Microsecond))
	newest := insert(visible, config.Stages[4].ID, "manual", midnight)
	for i := 1; i <= 10; i++ {
		insert(visible, config.Stages[1].ID, "organic", midnight.Add(-time.Duration(i)*time.Minute))
	}
	insert(hidden, pipelineconfig.Defaults(hidden).Stages[1].ID, "organic", midnight.Add(time.Second))
	service := dashboardapp.NewService(newDashboardTestStore(t, pool), func() time.Time { return midnight.Add(time.Hour) })
	got, err := service.Read(ctx, p.companyID, recruiter)
	if err != nil {
		t.Fatal(err)
	}
	if got.PublishedVacancies != 1 || got.InProcess != 11 || got.Positions.Covered != 1 {
		t.Fatal(got)
	}
	if len(got.Recent) != 10 || got.Recent[0].ParticipationID != newest || got.Recent[0].Source != "manual" || got.Recent[0].AddedBy == nil {
		t.Fatal(got.Recent)
	}
	for i, item := range got.Recent {
		if item.Vacancy.ID != visible || (i > 0 && item.AppliedAt.After(got.Recent[i-1].AppliedAt)) {
			t.Fatal(item)
		}
		if item.Source == "organic" && item.AddedBy != nil {
			t.Fatal(item)
		}
	}
	if got.OriginByDay[88].Organic != 11 || got.OriginByDay[88].Manual != 0 || got.OriginByDay[89].Manual != 1 || got.OriginByDay[89].Organic != 0 {
		t.Fatal(got.OriginByDay[88:])
	}
	summary, err := poolpostgres.NewStore(pool, nil).Summary(ctx, p.companyID)
	if err != nil {
		t.Fatal(err)
	}
	if got.PoolAddedLast7Days != summary.AddedLast7Days {
		t.Fatal("pool summary differs")
	}
}

func TestDashboardEmptyVisibilityAndPublication(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)
	store := newDashboardTestStore(t, pool)
	ctx := context.Background()
	got, err := store.Dashboard(ctx, p.companyID, p.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if got.PublishedVacancies != 0 || got.InProcess != 0 || got.Positions.Covered != 0 || got.PoolAddedLast7Days != 0 || len(got.Recent) != 0 {
		t.Fatal(got)
	}
	for _, status := range []string{"draft", "published", "paused", "closed"} {
		id := uuid.New()
		seedListV2(t, pool, p, p.ownerID, id, time.Now(), []byte(readV2Document))
		if _, err = pool.Exec(ctx, `INSERT INTO job_draft_management_configs(draft_id,version,hiring_headcount) VALUES($1,1,2)`, id); err != nil {
			t.Fatal(err)
		}
		if status != "draft" {
			_, err = pool.Exec(ctx, `INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,$3,now(),$4)`, id, p.companyID, status, p.ownerID)
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	got, err = store.Dashboard(ctx, p.companyID, p.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if got.PublishedVacancies != 1 || got.Positions.Required != 2 {
		t.Fatal(got)
	}
	recruiter := addMember(t, pool, p.companyID, "recruiter")
	got, err = store.Dashboard(ctx, p.companyID, recruiter)
	if err != nil {
		t.Fatal(err)
	}
	if got.PublishedVacancies != 0 || got.InProcess != 0 || len(got.Recent) != 0 {
		t.Fatal("hidden vacancy leaked", got)
	}
}
