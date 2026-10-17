//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	boardstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/board"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
	"github.com/google/uuid"
)

func movementPipelineBody(t *testing.T, c pipelineconfig.Configuration) []byte {
	t.Helper()
	stages := []map[string]string{}
	for _, s := range c.Stages {
		value := map[string]string{"name": s.Name}
		if s.ID != "" {
			value["id"] = s.ID
		}
		stages = append(stages, value)
	}
	raw, err := json.Marshal(map[string]any{"stages": stages, "exit": map[string]string{"id": c.Exit.ID, "name": c.Exit.Name}})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func TestMovementConcurrentHiresOneMilestonePerReach(t *testing.T) {
	for _, required := range []int{1, 2} {
		t.Run(string(rune('0'+required)), func(t *testing.T) {
			m := setupMovement(t)
			ctx := context.Background()
			stages := pipelineconfig.Defaults(m.vacancy).Stages
			cv, err := m.library.Upload(ctx, m.other, "Other CV", "cv.pdf", []byte("%PDF-1 other"))
			if err != nil {
				t.Fatal(err)
			}
			created, err := m.store.Apply(ctx, m.other, m.vacancy, uuid.New(), m.request(cv.ID))
			if err != nil {
				t.Fatal(err)
			}
			var other app.Submitted
			if err = json.Unmarshal(created.Body, &other); err != nil {
				t.Fatal(err)
			}
			detail, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, other.ID)
			if err != nil {
				t.Fatal(err)
			}
			items := []board.Item{m.item, detail.Item}
			if _, err = m.pool.Exec(ctx, `INSERT INTO job_draft_management_configs(draft_id,version,hiring_headcount) VALUES($1,1,$2)`, m.vacancy, required); err != nil {
				t.Fatal(err)
			}
			for j, item := range items {
				for i := 1; i < 4; i++ {
					result, err := m.move(t, item, stages[i].ID, false)
					if err != nil {
						t.Fatal(err)
					}
					item = result.Item
				}
				items[j] = item
			}
			start := make(chan struct{})
			errs := make(chan error, 2)
			var wg sync.WaitGroup
			for _, item := range items {
				wg.Add(1)
				go func(item board.Item) {
					defer wg.Done()
					<-start
					_, err := m.move(t, item, stages[4].ID, false)
					errs <- err
				}(item)
			}
			close(start)
			wg.Wait()
			close(errs)
			for err := range errs {
				if err != nil {
					t.Fatal(err)
				}
			}
			view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil || view.Coverage.Covered != 2 || view.Coverage.FullCoverageReachedAt == nil {
				t.Fatal(view, err)
			}
			var count int
			var covered, gotRequired int64
			if err = m.pool.QueryRow(ctx, `SELECT count(*),min(covered),min(required) FROM process_coverage_milestones WHERE process_id=$1`, m.vacancy).Scan(&count, &covered, &gotRequired); err != nil || count != 1 || covered != int64(required) || gotRequired != int64(required) {
				t.Fatal(count, covered, gotRequired, err)
			}
			first := *view.Coverage.FullCoverageReachedAt
			// Drop below the threshold (not merely from overfull to full), then rehire.
			current := view.Participations
			for _, item := range current {
				if _, err = m.move(t, item, stages[3].ID, true); err != nil {
					t.Fatal(err)
				}
			}
			view, err = m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil {
				t.Fatal(err)
			}
			for _, item := range view.Participations {
				if _, err = m.move(t, item, stages[4].ID, false); err != nil {
					t.Fatal(err)
				}
			}
			if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM process_coverage_milestones WHERE process_id=$1`, m.vacancy).Scan(&count); err != nil || count != 2 {
				t.Fatal(count, err)
			}
			view, err = m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil || !view.Coverage.FullCoverageReachedAt.Equal(first) {
				t.Fatal("first milestone changed", err)
			}
		})
	}
}
func TestMovementAuthorizationDraftAndCVIsolation(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	otherRecruiter := uuid.New()
	draft := uuid.New()
	if _, err := m.pool.Exec(ctx, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Other recruiter','recruiter')`, otherRecruiter, uuid.NewString(), uuid.NewString()+"@example.test"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, entry := range []struct {
			sql string
			id  uuid.UUID
		}{{`DELETE FROM job_drafts WHERE id=$1`, draft}, {`DELETE FROM company_members WHERE user_id=$1`, otherRecruiter}, {`DELETE FROM users WHERE id=$1`, otherRecruiter}} {
			if _, err := m.pool.Exec(context.Background(), entry.sql, entry.id); err != nil {
				t.Error(err)
			}
		}
	})
	if _, err := m.pool.Exec(ctx, `INSERT INTO company_members(id,company_id,user_id,role) VALUES($1,$2,$3,'recruiter')`, uuid.New(), m.company, otherRecruiter); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name                         string
		company, actor, vacancy, pid uuid.UUID
	}{{"nonprincipal", m.company, otherRecruiter, m.vacancy, m.item.ID}, {"foreign", m.company, m.recruiter, uuid.New(), m.item.ID}, {"foreign participation", m.company, m.recruiter, m.vacancy, uuid.New()}} {
		t.Run(tc.name, func(t *testing.T) {
			before := m.snapshot(t)
			if tc.name != "foreign participation" {
				if _, err := m.board.Board(ctx, tc.company, tc.actor, tc.vacancy); !errors.Is(err, board.ErrNotFound) {
					t.Fatal(err)
				}
			}
			if _, err := m.board.Detail(ctx, tc.company, tc.actor, tc.vacancy, tc.pid); !errors.Is(err, board.ErrNotFound) {
				t.Fatal(err)
			}
			if _, err := m.board.History(ctx, tc.company, tc.actor, tc.vacancy, tc.pid); !errors.Is(err, board.ErrNotFound) {
				t.Fatal(err)
			}
			if _, err := m.board.File(ctx, tc.company, tc.actor, tc.vacancy, tc.pid); !errors.Is(err, board.ErrNotFound) {
				t.Fatal(err)
			}
			if _, err := m.board.Move(ctx, tc.company, tc.actor, tc.vacancy, tc.pid, "", false, []byte(`broken`)); !errors.Is(err, board.ErrNotFound) {
				t.Fatal("authorization must precede preconditions", err)
			}
			if before != m.snapshot(t) {
				t.Fatal("denied request changed state")
			}
		})
	}
	if _, err := m.pool.Exec(ctx, `INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) SELECT $1,company_id,created_by,principal_recruiter_id,fields FROM job_drafts WHERE id=$2`, draft, m.vacancy); err != nil {
		t.Fatal(err)
	}
	if _, err := m.board.Board(ctx, m.company, m.recruiter, draft); !errors.Is(err, board.ErrNotPublished) {
		t.Fatal("draft board", err)
	}
	// Principal access works even when not an owner; owner can read another principal's board.
	if _, err := m.pool.Exec(ctx, `UPDATE company_members SET role='recruiter' WHERE user_id=$1`, m.recruiter); err != nil {
		t.Fatal(err)
	}
	if _, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy); err != nil {
		t.Fatal("principal rejected", err)
	}
	if _, err := m.pool.Exec(ctx, `UPDATE company_members SET role='owner' WHERE user_id=$1`, otherRecruiter); err != nil {
		t.Fatal(err)
	}
	if _, err := m.board.Board(ctx, m.company, otherRecruiter, m.vacancy); err != nil {
		t.Fatal("owner rejected", err)
	}
	disabled := boardstore.NewStore(m.pool, audit.NewAuditEventRepository(), movementContext{m.drafts}, nil, draftjson.Decode)
	if _, err := disabled.File(ctx, m.company, m.recruiter, m.vacancy, m.item.ID); !errors.Is(err, board.ErrStorageUnavailable) {
		t.Fatal(err)
	}
	if _, err := disabled.File(ctx, m.company, m.recruiter, m.vacancy, uuid.New()); !errors.Is(err, board.ErrNotFound) {
		t.Fatal("storage availability leaked before isolation", err)
	}
	cv, err := m.library.Upload(ctx, m.other, "Other", "cv.pdf", []byte("%PDF-1 other"))
	if err != nil {
		t.Fatal(err)
	}
	result, err := m.store.Apply(ctx, m.other, m.vacancy, uuid.New(), m.request(cv.ID))
	if err != nil {
		t.Fatal(err)
	}
	var other app.Submitted
	if err = json.Unmarshal(result.Body, &other); err != nil {
		t.Fatal(err)
	}
	file, err := m.board.File(ctx, m.company, m.recruiter, m.vacancy, other.ID)
	if err != nil {
		t.Fatal(err)
	}
	file.Reader.Close()
	if file.Name != "Other" {
		t.Fatal("wrong participation CV", file.Name)
	}
}
func TestMovementPipelineStructureLocked(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	// Existing custom column predates intake, as permitted by the earlier cuts.
	c := pipelineconfig.Defaults(m.vacancy)
	custom := pipelineconfig.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Custom"}
	c.Stages = append(c.Stages[:4], custom, c.Stages[4])
	encoded, _ := json.Marshal(c)
	if _, err := m.pool.Exec(ctx, `INSERT INTO job_draft_pipeline_configs(draft_id,version,configuration) VALUES($1,1,$2)`, m.vacancy, encoded); err != nil {
		t.Fatal(err)
	}
	got, err := m.drafts.GetPipeline(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil {
		t.Fatal(err)
	}
	var obj map[string]any
	if err = json.Unmarshal(got.Body, &obj); err != nil || obj["structure_locked"] != true {
		t.Fatal(obj, err)
	}
	for _, tc := range []struct {
		name   string
		mutate func(*pipelineconfig.Configuration)
	}{
		{"reorder", func(c *pipelineconfig.Configuration) { c.Stages[1], c.Stages[2] = c.Stages[2], c.Stages[1] }},
		{"add", func(c *pipelineconfig.Configuration) {
			last := c.Stages[len(c.Stages)-1]
			c.Stages = append(c.Stages[:len(c.Stages)-1], pipelineconfig.Stage{Name: "Extra"}, last)
		}},
		{"remove", func(c *pipelineconfig.Configuration) { c.Stages = append(c.Stages[:4], c.Stages[5:]...) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			next := pipelineconfig.Configuration{Stages: append([]pipelineconfig.Stage{}, c.Stages...), Exit: c.Exit}
			tc.mutate(&next)
			before := m.snapshot(t)
			out, err := m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, got.ETag, true, movementPipelineBody(t, next))
			if !errors.Is(err, pipelineconfig.ErrStructureLocked) || len(out.Body) != 0 || before != m.snapshot(t) {
				t.Fatal("structure rejection", err)
			}
			after, err := m.drafts.GetPipeline(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil || !reflect.DeepEqual(after, got) {
				t.Fatal("locked write changed pipeline", err)
			}
		})
	}
	c.Stages[1].Name = "Filter"
	c.Exit.Name = "Outside"
	renamed, err := m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, got.ETag, true, movementPipelineBody(t, c))
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(renamed.Body, &obj); err != nil || obj["structure_locked"] != true {
		t.Fatal(obj, err)
	}
	// A custom stage really participates in next-stage validation after reordering.
	item := m.item
	for i := 1; i < 4; i++ {
		out, err := m.move(t, item, c.Stages[i].ID, false)
		if err != nil {
			t.Fatal(err)
		}
		item = out.Item
	}
	before := m.snapshot(t)
	if _, err = m.move(t, item, c.Stages[5].ID, false); !errors.Is(err, board.ErrStageSkip) || before != m.snapshot(t) {
		t.Fatal("custom stage skipped", err)
	}
	if _, err = m.move(t, item, custom.ID, false); err != nil {
		t.Fatal(err)
	}
}
func TestMovementEmptyPipelineStructureRemainsEditable(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	d := audit.NewAuditEventRepository()
	s := movementContext{draftstore.NewStore(f.pool, d)}
	var actor uuid.UUID
	if err := f.pool.QueryRow(ctx, `SELECT principal_recruiter_id FROM job_drafts WHERE id=$1`, f.vacancy).Scan(&actor); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO company_members(id,company_id,user_id,role) VALUES($1,$2,$3,'owner')`, uuid.New(), f.company, actor); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, query := range []string{`DELETE FROM audit_events WHERE entity_id=$1`, `DELETE FROM company_members WHERE company_id=(SELECT company_id FROM job_drafts WHERE id=$1)`} {
			if _, err := f.pool.Exec(context.Background(), query, f.vacancy); err != nil {
				t.Error(err)
			}
		}
	})
	c := pipelineconfig.Defaults(f.vacancy)
	for _, change := range []string{"rename", "reorder", "add", "remove"} {
		get, err := s.s.GetPipeline(ctx, f.company, actor, f.vacancy)
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(get.Body, &c); err != nil {
			t.Fatal(err)
		}
		switch change {
		case "rename":
			c.Stages[1].Name = "Filter"
		case "reorder":
			c.Stages[1], c.Stages[2] = c.Stages[2], c.Stages[1]
		case "add":
			last := c.Stages[len(c.Stages)-1]
			c.Stages = append(c.Stages[:len(c.Stages)-1], pipelineconfig.Stage{Name: "Extra"}, last)
		case "remove":
			c.Stages = append(c.Stages[:4], c.Stages[5:]...)
		}
		out, err := s.s.PutPipeline(ctx, f.company, actor, f.vacancy, get.ETag, true, movementPipelineBody(t, c))
		if err != nil {
			t.Fatal(change, err)
		}
		var body map[string]any
		if err = json.Unmarshal(out.Body, &body); err != nil || body["structure_locked"] != false {
			t.Fatal(body, err)
		}
	}
}
func TestMovementBoardOrderingAndLimit(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	// Generate only synthetic fixtures, scoped by this vacancy's random namespace.
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := m.pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		for _, query := range []string{
			`DELETE FROM participation_stage_history WHERE participation_id IN (SELECT id FROM process_participations WHERE process_id=$1 AND candidate_id<>$2)`,
			`DELETE FROM process_participations WHERE process_id=$1 AND candidate_id<>$2`,
			`DELETE FROM candidate_cv_library WHERE candidate_id IN (SELECT md5($1::text||'candidate'||g)::uuid FROM generate_series(1,1000) g) AND candidate_id<>$2`,
			`DELETE FROM candidate_cv_versions WHERE candidate_id IN (SELECT md5($1::text||'candidate'||g)::uuid FROM generate_series(1,1000) g) AND candidate_id<>$2`,
			`DELETE FROM users WHERE id IN (SELECT md5($1::text||'candidate'||g)::uuid FROM generate_series(1,1000) g) AND id<>$2`,
		} {
			if _, err := m.pool.Exec(context.Background(), query, m.vacancy, m.actor); err != nil {
				t.Error(err)
			}
		}
	})
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) SELECT md5($1::text||'candidate'||g)::uuid,$1::text||g,$1::text||g||'@example.test','Synthetic','candidate' FROM generate_series(1,1000) g`, m.vacancy)
	exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) SELECT md5($1::text||'version'||g)::uuid,md5($1::text||'candidate'||g)::uuid,md5($1::text||g)||md5($1::text||g),6,'application/pdf' FROM generate_series(1,1000) g`, m.vacancy)
	exec(`INSERT INTO candidate_cv_library(id,candidate_id,version_id,name) SELECT md5($1::text||'cv'||g)::uuid,md5($1::text||'candidate'||g)::uuid,md5($1::text||'version'||g)::uuid,'Synthetic CV' FROM generate_series(1,1000) g`, m.vacancy)
	c := pipelineconfig.Defaults(m.vacancy)
	at := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,created_at) SELECT md5($1::text||'participation'||g)::uuid,$1::uuid,md5($1::text||'candidate'||g)::uuid,$2,md5($1::text||'version'||g)::uuid,'[]','[]','organic',$3 FROM generate_series(1,999) g`, m.vacancy, c.Stages[1].ID, at)
	view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil || len(view.Participations) != 1000 || view.Participations[0].ID != m.item.ID || view.Stages[1].Count != 999 {
		t.Fatal("1000 boundary", len(view.Participations), err)
	}
	for i := 2; i < len(view.Participations); i++ {
		if strings.Compare(view.Participations[i-1].ID.String(), view.Participations[i].ID.String()) >= 0 {
			t.Fatal("tie order")
		}
	}
	var newest uuid.UUID
	later := at.AddDate(0, 0, 1)
	if err = m.pool.QueryRow(ctx, `UPDATE process_participations SET created_at=$2 WHERE process_id=$1 AND candidate_id=md5($1::text||'candidate42')::uuid RETURNING id`, m.vacancy, later).Scan(&newest); err != nil {
		t.Fatal(err)
	}
	reordered, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil || reordered.Participations[0].ID != m.item.ID || reordered.Participations[1].ID != newest || !reordered.Participations[1].MovedAt.Equal(later) {
		t.Fatal("stage/time ordering", err)
	}
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES(md5($1::text||'participation1000')::uuid,$1::uuid,md5($1::text||'candidate1000')::uuid,$2,md5($1::text||'version1000')::uuid,'[]','[]','organic')`, m.vacancy, c.Stages[0].ID)
	if _, err = m.board.Board(ctx, m.company, m.recruiter, m.vacancy); !errors.Is(err, board.ErrTooLarge) {
		t.Fatal("1001 must reject", err)
	}
}
