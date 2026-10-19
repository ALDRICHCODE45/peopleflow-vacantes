//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strconv"
	"sync"
	"testing"
	"time"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	boardstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/board"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type movementContext struct{ s *draftstore.Store }

func (m movementContext) Screening(fields []byte) (app.Screening, error) {
	return (testVacancyRules{}).Screening(fields)
}

func (m movementContext) Load(ctx context.Context, tx pgx.Tx, company, actor, id uuid.UUID) (board.Pipeline, error) {
	c, required, err := m.s.MovementContext(ctx, tx, company, actor, id)
	for _, pair := range [][2]error{{drafts.ErrNotFound, board.ErrNotFound}, {drafts.ErrUnauthenticated, board.ErrUnauthenticated}, {drafts.ErrForbidden, board.ErrForbidden}, {drafts.ErrCompanyInactive, board.ErrCompanyInactive}, {drafts.ErrCompanyNotActive, board.ErrCompanyNotActive}} {
		if errors.Is(err, pair[0]) {
			err = pair[1]
			break
		}
	}
	p := board.Pipeline{Required: required, Exit: board.Stage{ID: c.Exit.ID, Name: c.Exit.Name, Kind: c.Exit.Kind}}
	p.Retired = make([]board.RetiredStage, len(c.Retired))
	for i, r := range c.Retired {
		p.Retired[i] = board.RetiredStage{ID: r.ID, Kind: r.Kind, Name: r.Name, Position: r.Position}
	}
	for _, s := range c.Stages {
		p.Stages = append(p.Stages, board.Stage{ID: s.ID, Kind: s.Kind, Name: s.Name})
	}
	return p, err
}

func (m movementContext) RecordDelivery(ctx context.Context, tx pgx.Tx, id, actor, stage uuid.UUID, at time.Time) error {
	return m.s.RecordDelivery(ctx, tx, id, actor, stage, at)
}
func (m movementContext) DeliverySummary(ctx context.Context, tx pgx.Tx, id uuid.UUID) (string, int64, int64, error) {
	return m.s.DeliverySummary(ctx, tx, id)
}

type movementFixture struct {
	fixture
	recruiter uuid.UUID
	board     *boardstore.Store
	drafts    *draftstore.Store
	item      board.Item
}

func setupMovement(t *testing.T) movementFixture {
	t.Helper()
	f := setup(t)
	ctx := context.Background()
	a := audit.NewAuditEventRepository()
	d := draftstore.NewStore(f.pool, a)
	m := movementFixture{fixture: f, drafts: d}
	if err := f.pool.QueryRow(ctx, `SELECT principal_recruiter_id FROM job_drafts WHERE id=$1`, f.vacancy).Scan(&m.recruiter); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO company_members(id,company_id,user_id,role) VALUES(gen_random_uuid(),$1,$2,'owner')`, f.company, m.recruiter); err != nil {
		t.Fatal(err)
	}
	// Delete only this fixture's milestones before the existing P2b cleanup.
	t.Cleanup(func() {
		for _, query := range []string{`DELETE FROM process_coverage_milestones WHERE process_id=$1`, `DELETE FROM audit_events WHERE entity_id=$1`, `DELETE FROM company_members WHERE company_id=(SELECT company_id FROM job_drafts WHERE id=$1)`} {
			if _, err := f.pool.Exec(context.Background(), query, f.vacancy); err != nil {
				t.Error(err)
			}
		}
	})
	m.board = boardstore.NewStore(f.pool, a, movementContext{d}, f.storage, draftjson.Decode)
	cv, err := f.library.Upload(ctx, f.sub, "Resume", "cv.pdf", []byte("%PDF-1 exact"))
	if err != nil {
		t.Fatal(err)
	}
	result, err := f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), f.request(cv.ID))
	if err != nil {
		t.Fatal(err)
	}
	var submitted app.Submitted
	if err = json.Unmarshal(result.Body, &submitted); err != nil {
		t.Fatal(err)
	}
	view, err := m.board.Detail(ctx, f.company, m.recruiter, f.vacancy, submitted.ID)
	if err != nil {
		t.Fatal(err)
	}
	m.item = view.Item
	return m
}
func (m movementFixture) move(t *testing.T, item board.Item, target string, confirm bool) (board.Moved, error) {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"to_stage_id": target, "confirm_placement_exit": confirm})
	return m.board.Move(context.Background(), m.company, m.recruiter, m.vacancy, item.ID, item.ETag, true, raw)
}
func (m movementFixture) snapshot(t *testing.T) string {
	t.Helper()
	var raw string
	err := m.pool.QueryRow(context.Background(), `SELECT json_build_array(
 (SELECT json_agg(p ORDER BY id) FROM process_participations p WHERE process_id=$1),
 (SELECT json_agg(h ORDER BY h.id) FROM participation_stage_history h JOIN process_participations p ON p.id=h.participation_id WHERE p.process_id=$1),
 (SELECT json_agg(a ORDER BY id) FROM audit_events a WHERE metadata->>'vacancy_id'=$1::text OR entity_id=$1),
 (SELECT row_to_json(c) FROM job_draft_pipeline_configs c WHERE draft_id=$1),
 (SELECT json_agg(m ORDER BY id) FROM process_coverage_milestones m WHERE process_id=$1))::text`, m.vacancy).Scan(&raw)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func TestMovementBoardMovesHistoryCoverageAndRetention(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	stages := pipelineconfig.Defaults(m.vacancy).Stages
	boardView, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil || len(boardView.Participations) != 1 || boardView.Stages[0].Count != 1 || boardView.Exit.Count != 0 || boardView.Coverage.Required != nil || boardView.Coverage.Covered != 0 || boardView.Participations[0].Version != "1" {
		t.Fatal(boardView, err)
	}
	detail, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
	if err != nil || len(detail.Screening) != 1 || detail.Screening[0].Prompt != "Why?" || detail.Screening[0].Answer.Text == nil || *detail.Screening[0].Answer.Text != "Because" {
		t.Fatal(detail, err)
	}
	if _, err = m.pool.Exec(ctx, `UPDATE job_drafts SET fields=convert_to(replace(convert_from(fields,'UTF8'),'Why?','Changed?'),'UTF8') WHERE id=$1`, m.vacancy); err != nil {
		t.Fatal(err)
	}
	again, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
	if err != nil || !reflect.DeepEqual(detail, again) {
		t.Fatal("snapshot drift", err)
	}
	if _, err = m.pool.Exec(ctx, `INSERT INTO job_draft_management_configs(draft_id,version,hiring_headcount) VALUES($1,1,1)`, m.vacancy); err != nil {
		t.Fatal(err)
	}
	item := m.item
	for i := 1; i < len(stages); i++ {
		result, err := m.move(t, item, stages[i].ID, false)
		if err != nil || result.Item.ETag != board.ETag(item.ID, int64(i+1)) || result.Version != strconv.Itoa(i+1) || result.StageID != stages[i].ID || result.Candidate != item.Candidate || result.CV != item.CV || !result.AppliedAt.Equal(item.AppliedAt) {
			t.Fatal(result, err)
		}
		item = result.Item
	}
	full, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil || full.Coverage.Covered != 1 || full.Coverage.Required == nil || *full.Coverage.Required != 1 || full.Coverage.FullCoverageReachedAt == nil {
		t.Fatal(full, err)
	}
	first := *full.Coverage.FullCoverageReachedAt
	before := m.snapshot(t)
	if _, err = m.move(t, item, stages[0].ID, false); !errors.Is(err, board.ErrPlacementExit) || before != m.snapshot(t) {
		t.Fatal("unconfirmed exit changed state", err)
	}
	result, err := m.move(t, item, stages[0].ID, true)
	if err != nil || result.Coverage.Covered != 0 || !result.Coverage.FullCoverageReachedAt.Equal(first) {
		t.Fatal(result, err)
	}
	item = result.Item
	page, err := m.store.List(ctx, m.sub, app.Query{Limit: 20})
	if err != nil || page.Items[0].Status != "submitted" {
		t.Fatal(page, err)
	}
	for i := 1; i < len(stages); i++ {
		result, err = m.move(t, item, stages[i].ID, false)
		if err != nil {
			t.Fatal(err)
		}
		item = result.Item
	}
	final, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, item.ID)
	if err != nil || final.Version != "10" || final.ETag != board.ETag(item.ID, 10) || final.StageID != stages[4].ID {
		t.Fatal("final persisted item", final, err)
	}
	page, err = m.store.List(ctx, m.sub, app.Query{Limit: 20})
	if err != nil || page.Items[0].Status != "in_process" {
		t.Fatal(page, err)
	}
	var milestones int
	if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM process_coverage_milestones WHERE process_id=$1 AND covered=1 AND required=1`, m.vacancy).Scan(&milestones); err != nil || milestones != 2 {
		t.Fatal(milestones, err)
	}
	history, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, item.ID)
	if err != nil || len(history.Items) != 10 {
		t.Fatal(history, err)
	}
	for i, h := range history.Items {
		if i == 0 {
			if h.Kind != "intake" || h.FromStageID != nil || h.Actor.Kind != "candidate" || h.Actor.ID != m.actor || h.Hire || h.Departure {
				t.Fatal(h)
			}
		} else {
			if h.Kind != "move" || h.FromStageID == nil || h.Actor.Kind != "recruiter" || h.Actor.ID != m.recruiter {
				t.Fatal(h)
			}
		}
		if i > 0 && (h.At.Before(history.Items[i-1].At) || *h.FromStageID != history.Items[i-1].ToStageID) {
			t.Fatal("history not ordered or disconnected")
		}
		expectedStage := i % 5
		if h.ToStageID != stages[expectedStage].ID || h.Actor.FullName == "" || h.Hire != (i == 4 || i == 9) || h.Departure != (i == 5) {
			t.Fatal("history projection mismatch", h)
		}
	}
	if !history.Items[4].Hire || !history.Items[5].Departure || !history.Items[9].Hire {
		t.Fatal("missing hire/departure")
	}
	var audits int
	if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='ParticipationMoved'`, item.ID).Scan(&audits); err != nil || audits != 9 {
		t.Fatal(audits, err)
	}
	var verifiedAudits int
	if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events a WHERE a.entity_id=$1 AND a.event_type='ParticipationMoved' AND a.actor_id=$2 AND a.metadata->>'vacancy_id'=$3::text AND EXISTS (SELECT 1 FROM participation_stage_history h WHERE h.participation_id=a.entity_id AND h.actor_id=a.actor_id AND h.from_stage_id::text=a.metadata->>'from_stage_id' AND h.stage_id::text=a.metadata->>'to_stage_id' AND h.hire::text=a.metadata->>'hire' AND h.departure::text=a.metadata->>'departure')`, item.ID, m.recruiter, m.vacancy).Scan(&verifiedAudits); err != nil || verifiedAudits != 9 {
		t.Fatal("audit snapshots mismatch", verifiedAudits, err)
	}
	if err = m.library.Remove(ctx, m.sub, item.CV.ID); err != nil {
		t.Fatal(err)
	}
	file, err := m.board.File(ctx, m.company, m.recruiter, m.vacancy, item.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Reader.Close()
	data, err := io.ReadAll(file.Reader)
	if err != nil || string(data) != "%PDF-1 exact" || file.ContentType != "application/pdf" {
		t.Fatal("wrong retained version", err)
	}
}
func TestMovementRejectedRequestsAreAtomic(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	stages := pipelineconfig.Defaults(m.vacancy).Stages
	for _, tc := range []struct {
		name, tag, body string
		present         bool
		want            error
	}{
		{"missing", "", `{}`, false, board.ErrPreconditionRequired}, {"empty", "", `{}`, true, board.ErrInvalidRequest}, {"weak", "W/" + m.item.ETag, `{}`, true, board.ErrInvalidRequest}, {"list", m.item.ETag + "," + m.item.ETag, `{}`, true, board.ErrInvalidRequest}, {"stale", board.ETag(m.item.ID, 2), `{}`, true, board.ErrVersionConflict}, {"foreign", board.ETag(uuid.New(), 1), `{}`, true, board.ErrVersionConflict},
		{"skip", m.item.ETag, `{"to_stage_id":"` + stages[2].ID + `"}`, true, board.ErrStageSkip}, {"same", m.item.ETag, `{"to_stage_id":"` + m.item.StageID + `"}`, true, board.ErrValidation}, {"discarded", m.item.ETag, `{"to_stage_id":"` + pipelineconfig.Defaults(m.vacancy).Exit.ID + `"}`, true, board.ErrValidation}, {"unknown", m.item.ETag, `{"to_stage_id":"` + uuid.NewString() + `"}`, true, board.ErrValidation}, {"unknown key", m.item.ETag, `{"actor":"spoof"}`, true, board.ErrInvalidRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := m.snapshot(t)
			_, err := m.board.Move(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, tc.tag, tc.present, []byte(tc.body))
			if !errors.Is(err, tc.want) || before != m.snapshot(t) {
				t.Fatal("rejection changed effects", err)
			}
		})
	}
	failing := boardstore.NewStore(m.pool, rejectAudit{}, movementContext{m.drafts}, m.storage, draftjson.Decode)
	before := m.snapshot(t)
	_, err := failing.Move(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"to_stage_id":"`+stages[1].ID+`"}`))
	if err == nil || before != m.snapshot(t) {
		t.Fatal("audit failure not atomic", err)
	}
	item := m.item
	for i := 1; i < 4; i++ {
		out, err := m.move(t, item, stages[i].ID, false)
		if err != nil {
			t.Fatal(err)
		}
		item = out.Item
	}
	if _, err = m.pool.Exec(ctx, `INSERT INTO job_draft_management_configs(draft_id,version,hiring_headcount) VALUES($1,1,1)`, m.vacancy); err != nil {
		t.Fatal(err)
	}
	before = m.snapshot(t)
	_, err = failing.Move(ctx, m.company, m.recruiter, m.vacancy, item.ID, item.ETag, true, []byte(`{"to_stage_id":"`+stages[4].ID+`"}`))
	if err == nil || before != m.snapshot(t) {
		t.Fatal("failed hire left coverage/milestone/history/audit/version effects", err)
	}
}
func TestMovementConcurrentSameParticipation(t *testing.T) {
	m := setupMovement(t)
	stage := pipelineconfig.Defaults(m.vacancy).Stages[1].ID
	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); <-start; _, err := m.move(t, m.item, stage, false); errs <- err }()
	}
	close(start)
	wg.Wait()
	close(errs)
	wins, stale := 0, 0
	for err := range errs {
		if err == nil {
			wins++
		} else if errors.Is(err, board.ErrVersionConflict) {
			stale++
		} else {
			t.Fatal(err)
		}
	}
	if wins != 1 || stale != 1 {
		t.Fatal(wins, stale)
	}
	history, err := m.board.History(context.Background(), m.company, m.recruiter, m.vacancy, m.item.ID)
	if err != nil || len(history.Items) != 2 {
		t.Fatal(history, err)
	}
}
