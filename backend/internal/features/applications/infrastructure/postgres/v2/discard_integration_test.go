//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"testing"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	boardstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

const discardBody = `{"reason":{"group":"recruiter","key":"other"},"comment":"  Internal explanation 😀  ","candidate_message":"  Thank you\nfor applying.  ","confirm_placement_exit":true}`

func (m movementFixture) discard(t *testing.T, item board.Item, body string) (board.Moved, error) {
	t.Helper()
	return m.board.Discard(context.Background(), m.company, m.recruiter, m.vacancy, item.ID, item.ETag, true, []byte(body))
}
func (m movementFixture) recover(t *testing.T, item board.Item, body string) (board.Moved, error) {
	t.Helper()
	return m.board.Recover(context.Background(), m.company, m.recruiter, m.vacancy, item.ID, item.ETag, true, []byte(body))
}

func TestDiscardRecoveryEachStageAndCoverage(t *testing.T) {
	for _, kind := range []string{"new", "screening", "screening_ok", "in_process", "custom", "placement"} {
		t.Run(kind, func(t *testing.T) {
			m := setupMovement(t)
			ctx := context.Background()
			config := pipelineconfig.Defaults(m.vacancy)
			// Materialize a custom progression stage using the same validated pipeline shape.
			if kind == "custom" {
				stage := pipelineconfig.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Interview"}
				config.Stages = append(config.Stages[:len(config.Stages)-1], stage, config.Stages[len(config.Stages)-1])
				raw, _ := json.Marshal(config)
				if _, err := m.pool.Exec(ctx, `INSERT INTO job_draft_pipeline_configs(draft_id,version,configuration) VALUES($1,1,$2)`, m.vacancy, raw); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := m.pool.Exec(ctx, `INSERT INTO job_draft_management_configs(draft_id,version,hiring_headcount) VALUES($1,1,1)`, m.vacancy); err != nil {
				t.Fatal(err)
			}
			item := m.item
			for i := 1; config.Stages[i-1].Kind != kind; i++ {
				out, err := m.move(t, item, config.Stages[i].ID, false)
				if err != nil {
					t.Fatal(err)
				}
				item = out.Item
			}
			beforeBoard, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil {
				t.Fatal(err)
			}
			if kind == "placement" {
				before := m.snapshot(t)
				_, err = m.discard(t, item, strings.ReplaceAll(discardBody, `"confirm_placement_exit":true`, `"confirm_placement_exit":false`))
				if !errors.Is(err, board.ErrPlacementExit) || before != m.snapshot(t) {
					t.Fatal("unconfirmed departure wrote effects", err)
				}
			}
			discarded, err := m.discard(t, item, discardBody)
			if err != nil || discarded.StageID != config.Exit.ID || discarded.Discard == nil || discarded.Discard.PreviousStageID != item.StageID || !discarded.MovedAt.Equal(discarded.Discard.DiscardedAt) || discarded.Version != incrementVersion(t, item.Version) || discarded.ETag != board.ETag(item.ID, mustVersion(t, discarded.Version)) || discarded.Coverage.Covered != 0 || !reflect.DeepEqual(discarded.Coverage.FullCoverageReachedAt, beforeBoard.Coverage.FullCoverageReachedAt) {
				t.Fatal(discarded, err)
			}
			view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil || view.Exit.Count != 1 || !reflect.DeepEqual(view.Participations[0], discarded.Item) {
				t.Fatal(view, err)
			}
			for _, stage := range view.Stages {
				if stage.Count != 0 {
					t.Fatal("discard did not remove progression occupancy", view)
				}
			}
			detail, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, item.ID)
			if err != nil || detail.Comment == nil || *detail.Comment != "Internal explanation 😀" || detail.CandidateMessage == nil || *detail.CandidateMessage != "Thank you\nfor applying." || !reflect.DeepEqual(detail.Item, discarded.Item) {
				t.Fatal(detail, err)
			}
			page, err := m.store.List(ctx, m.sub, app.Query{Limit: 20})
			if err != nil || page.Items[0].Status != "closed" || page.Items[0].Message == nil || *page.Items[0].Message != *detail.CandidateMessage {
				t.Fatal(page, err)
			}
			// Every rejected operation must preserve all persisted effects, including private fields.
			for _, tc := range []struct {
				name string
				call func() (board.Moved, error)
				want error
			}{
				{"already", func() (board.Moved, error) { return m.discard(t, discarded.Item, discardBody) }, board.ErrAlreadyDiscarded},
				{"move out", func() (board.Moved, error) { return m.move(t, discarded.Item, item.StageID, true) }, board.ErrValidation},
			} {
				t.Run(tc.name, func(t *testing.T) {
					before := m.snapshot(t)
					_, err := tc.call()
					if !errors.Is(err, tc.want) || before != m.snapshot(t) {
						t.Fatal(err)
					}
				})
			}
			if kind == "placement" {
				for _, body := range []string{`{}`, `{"confirm_placement_reentry":false}`} {
					before := m.snapshot(t)
					_, err = m.recover(t, discarded.Item, body)
					if !errors.Is(err, board.ErrPlacementReentry) || before != m.snapshot(t) {
						t.Fatal("unconfirmed rehire wrote effects", err)
					}
				}
			}
			recoveryBody := `{}`
			if kind == "placement" {
				recoveryBody = `{"confirm_placement_reentry":true}`
			}
			recovered, err := m.recover(t, discarded.Item, recoveryBody)
			if err != nil || recovered.StageID != item.StageID || recovered.Discard != nil || recovered.Version != incrementVersion(t, discarded.Version) || recovered.Coverage.Covered != beforeBoard.Coverage.Covered || !reflect.DeepEqual(recovered.Coverage.FullCoverageReachedAt, beforeBoard.Coverage.FullCoverageReachedAt) {
				t.Fatal(recovered, err)
			}
			detail, err = m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, item.ID)
			if err != nil || detail.Discard != nil || detail.Comment != nil || detail.CandidateMessage != nil {
				t.Fatal(detail, err)
			}
			var cleared bool
			if err = m.pool.QueryRow(ctx, `SELECT previous_stage_id IS NULL AND reason_group IS NULL AND reason_code IS NULL AND comment IS NULL AND candidate_message IS NULL AND discarded_at IS NULL FROM process_participations WHERE id=$1`, item.ID).Scan(&cleared); err != nil || !cleared {
				t.Fatal("recovery retained current discard fields", err)
			}
			view, err = m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil || view.Exit.Count != 0 || !reflect.DeepEqual(view.Participations[0], recovered.Item) {
				t.Fatal(view, err)
			}
			for _, stage := range view.Stages {
				want := 0
				if stage.ID == item.StageID {
					want = 1
				}
				if stage.Count != want {
					t.Fatal(view)
				}
			}
			page, err = m.store.List(ctx, m.sub, app.Query{Limit: 20})
			wantStatus := "in_process"
			if kind == "new" {
				wantStatus = "submitted"
			}
			if err != nil || page.Items[0].Status != wantStatus || page.Items[0].Message != nil {
				t.Fatal(page, err)
			}
			history, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, item.ID)
			if err != nil {
				t.Fatal(err)
			}
			d, r := history.Items[len(history.Items)-2], history.Items[len(history.Items)-1]
			if d.Kind != "discard" || d.FromStageID == nil || *d.FromStageID != item.StageID || d.ToStageID != config.Exit.ID || d.Hire || d.Departure != (kind == "placement") || d.Reason == nil || d.Reason.Group != "recruiter" || d.Reason.Key != "other" || *d.Comment != "Internal explanation 😀" || *d.CandidateMessage != "Thank you\nfor applying." || !d.At.Equal(discarded.MovedAt) || d.Actor.ID != m.recruiter {
				t.Fatal(d)
			}
			if r.Kind != "recovery" || r.FromStageID == nil || *r.FromStageID != config.Exit.ID || r.ToStageID != item.StageID || r.Hire != (kind == "placement") || r.Departure || r.Reason != nil || r.Comment != nil || r.CandidateMessage != nil || !r.At.Equal(recovered.MovedAt) || r.Actor.ID != m.recruiter {
				t.Fatal(r)
			}
			var milestones, audits int
			if err = m.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM process_coverage_milestones WHERE process_id=$1),(SELECT count(*) FROM audit_events WHERE entity_id=$2 AND event_type IN ('ParticipationDiscarded','ParticipationRecovered'))`, m.vacancy, item.ID).Scan(&milestones, &audits); err != nil || audits != 2 || (kind == "placement" && milestones != 2) || (kind != "placement" && milestones != 0) {
				t.Fatal(milestones, audits, err)
			}
			var verifiedAudits int
			if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events a WHERE entity_id=$1 AND event_type IN ('ParticipationDiscarded','ParticipationRecovered') AND actor_id=$2 AND metadata->>'vacancy_id'=$3::text AND EXISTS(SELECT 1 FROM participation_stage_history h WHERE h.participation_id=a.entity_id AND h.event_kind=CASE a.event_type WHEN 'ParticipationDiscarded' THEN 'discard' ELSE 'recovery' END AND h.from_stage_id::text=a.metadata->>'from_stage_id' AND h.stage_id::text=a.metadata->>'to_stage_id' AND h.hire::text=a.metadata->>'hire' AND h.departure::text=a.metadata->>'departure') AND metadata->>'version' IN ($4,$5)`, item.ID, m.recruiter, m.vacancy, discarded.Version, recovered.Version).Scan(&verifiedAudits); err != nil || verifiedAudits != 2 {
				t.Fatal("audit event does not match history/version", verifiedAudits, err)
			}
			var privateCount int
			if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND (metadata::text LIKE '%explanation%' OR metadata::text LIKE '%applying%')`, item.ID).Scan(&privateCount); err != nil || privateCount != 0 {
				t.Fatal("audit leaked private text", err)
			}
			before := m.snapshot(t)
			_, err = m.recover(t, recovered.Item, `{}`)
			if !errors.Is(err, board.ErrNotDiscarded) || before != m.snapshot(t) {
				t.Fatal(err)
			}
			// A second cycle replaces current discard details, never prior history.
			second, err := m.discard(t, recovered.Item, `{"reason":{"group":"candidate","key":"unresponsive"},"confirm_placement_exit":true}`)
			if err != nil {
				t.Fatal(err)
			}
			detail, err = m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, item.ID)
			if err != nil || detail.Comment != nil || detail.CandidateMessage != nil || second.Discard.Reason.Group != "candidate" {
				t.Fatal(detail, err)
			}
			page, err = m.store.List(ctx, m.sub, app.Query{Limit: 20})
			if err != nil || page.Items[0].Message != nil || page.Items[0].Status != "closed" {
				t.Fatal(page, err)
			}
			if kind != "placement" {
				if _, err = m.recover(t, second.Item, `{"confirm_placement_reentry":true}`); err != nil {
					t.Fatal("non-placement recovery also accepts the optional flag", err)
				}
			}
		})
	}
}
func mustVersion(t *testing.T, s string) int64 {
	t.Helper()
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	return v
}
func incrementVersion(t *testing.T, s string) string {
	t.Helper()
	return strconv.FormatInt(mustVersion(t, s)+1, 10)
}

func TestDiscardRecoveryRejectedRequestsAndAuditFailureAreAtomic(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	type operation func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, []byte) (board.Moved, error)
	for _, op := range []struct {
		name string
		fn   operation
		body string
	}{{"discard", m.board.Discard, discardBody}, {"recover", m.board.Recover, `{}`}} {
		t.Run(op.name, func(t *testing.T) {
			for _, tc := range []struct {
				name, tag string
				present   bool
				want      error
			}{
				{"missing", "", false, board.ErrPreconditionRequired}, {"empty", "", true, board.ErrInvalidRequest}, {"weak", "W/" + m.item.ETag, true, board.ErrInvalidRequest}, {"list", m.item.ETag + "," + m.item.ETag, true, board.ErrInvalidRequest}, {"stale", board.ETag(m.item.ID, 99), true, board.ErrVersionConflict}, {"foreign", board.ETag(uuid.New(), 1), true, board.ErrVersionConflict},
			} {
				t.Run(tc.name, func(t *testing.T) {
					before := m.snapshot(t)
					_, err := op.fn(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, tc.tag, tc.present, []byte(op.body))
					if !errors.Is(err, tc.want) || before != m.snapshot(t) {
						t.Fatal(err)
					}
				})
			}
		})
	}
	for _, body := range []string{`{}`, `{"reason":{"group":"candidate","key":"profile_mismatch"}}`, `{"reason":{"group":"recruiter","key":"other"}}`, `{"reason":{"group":"candidate","key":"other"},"comment":"  "}`, `{"reason":{"group":"candidate","key":"unresponsive"},"candidate_message":"a\u0000b"}`} {
		before := m.snapshot(t)
		_, err := m.discard(t, m.item, body)
		if err == nil || before != m.snapshot(t) {
			t.Fatal("invalid discard changed state", err)
		}
	}
	failing := boardstore.NewStore(m.pool, rejectAudit{}, movementContext{m.drafts}, m.storage, draftjson.Decode)
	before := m.snapshot(t)
	_, err := failing.Discard(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(discardBody))
	if err == nil || before != m.snapshot(t) {
		t.Fatal("discard audit not atomic", err)
	}
	stages := pipelineconfig.Defaults(m.vacancy).Stages
	item := m.item
	for i := 1; i < len(stages); i++ {
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
	_, err = failing.Discard(ctx, m.company, m.recruiter, m.vacancy, item.ID, item.ETag, true, []byte(discardBody))
	if err == nil || before != m.snapshot(t) {
		t.Fatal("failed departure changed coverage", err)
	}
	discarded, err := m.discard(t, item, discardBody)
	if err != nil {
		t.Fatal(err)
	}
	before = m.snapshot(t)
	_, err = failing.Recover(ctx, m.company, m.recruiter, m.vacancy, item.ID, discarded.ETag, true, []byte(`{"confirm_placement_reentry":true}`))
	if err == nil || before != m.snapshot(t) {
		t.Fatal("failed recovery retained hire/milestone/private data changes", err)
	}
}
