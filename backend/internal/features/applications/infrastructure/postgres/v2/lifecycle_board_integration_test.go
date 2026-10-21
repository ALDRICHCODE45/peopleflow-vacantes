//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	boardstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
)

func TestLifecycleBoardActiveAnyPublicationAndFinishedReadOnly(t *testing.T) {
	for _, state := range []string{"published", "paused", "closed"} {
		t.Run(state, func(t *testing.T) {
			m := setupMovement(t)
			ctx := context.Background()
			if _, err := m.pool.Exec(ctx, `UPDATE vacancy_processes SET status=$2 WHERE id=$1`, m.vacancy, state); err != nil {
				t.Fatal(err)
			}
			stages := pipelineconfig.Defaults(m.vacancy).Stages
			// Reach in_process, then prove all four mutation families remain available.
			for _, stage := range stages[1:4] {
				moved, err := m.move(t, m.item, stage.ID, false)
				if err != nil {
					t.Fatal(err)
				}
				m.item = moved.Item
			}
			set, err := m.board.SetSubstate(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"substate_id":null}`))
			if err != nil {
				t.Fatal("active substate", err)
			}
			discarded, err := m.discard(t, set.Item, discardBody)
			if err != nil {
				t.Fatal("active discard", err)
			}
			recovered, err := m.recover(t, discarded.Item, `{}`)
			if err != nil {
				t.Fatal("active recover", err)
			}
			m.item = recovered.Item
			page, err := m.store.List(ctx, m.sub, app.Query{Limit: 20})
			if err != nil || page.Items[0].Vacancy.State != "open" {
				t.Fatal("active vacancy must remain open for candidate", page, err)
			}
			if _, err = m.pool.Exec(ctx, `UPDATE vacancy_processes SET status='closed',process_status='finished',lifecycle_version=lifecycle_version+1,closed_at=now(),process_finished_at=now() WHERE id=$1`, m.vacancy); err != nil {
				t.Fatal(err)
			}
			current, err := m.drafts.GetLifecycle(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil {
				t.Fatal(err)
			}
			before := m.snapshot(t) + movementAuthoringSnapshot(t, m) + m.geoApplyEffects(t)
			operations := []struct {
				name string
				call func() (board.Moved, error)
			}{
				{"move", func() (board.Moved, error) { return m.move(t, m.item, stages[0].ID, false) }},
				{"discard", func() (board.Moved, error) { return m.discard(t, m.item, discardBody) }},
				{"recover", func() (board.Moved, error) { return m.recover(t, m.item, `{}`) }},
				{"substate", func() (board.Moved, error) {
					return m.board.SetSubstate(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"substate_id":null}`))
				}},
			}
			for _, op := range operations {
				t.Run(op.name, func(t *testing.T) {
					_, err := op.call()
					var finished *board.ProcessFinished
					if !errors.As(err, &finished) {
						t.Fatal("finished mutation accepted", err)
					}
					var want, got any
					if err = json.Unmarshal(current.Body, &want); err != nil {
						t.Fatal(err)
					}
					if err = json.Unmarshal(finished.Lifecycle, &got); err != nil || !reflect.DeepEqual(got, want) {
						t.Fatal("finished view drift", got, want, err)
					}
				})
			}
			view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil {
				t.Fatal("finished board read", err)
			}
			if string(view.Lifecycle) != string(current.Body) {
				t.Fatal("board lifecycle drift")
			}
			if _, err = m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, m.item.ID); err != nil {
				t.Fatal("finished detail read", err)
			}
			if _, err = m.board.History(ctx, m.company, m.recruiter, m.vacancy, m.item.ID); err != nil {
				t.Fatal("finished history read", err)
			}
			file, err := m.board.File(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
			if err != nil {
				t.Fatal("finished CV read", err)
			}
			file.Reader.Close()
			page, err = m.store.List(ctx, m.sub, app.Query{Limit: 20})
			if err != nil || page.Items[0].Vacancy.State != "closed" || page.Items[0].Status != "in_process" {
				t.Fatal("finished candidate state/status", page, err)
			}
			if before != m.snapshot(t)+movementAuthoringSnapshot(t, m)+m.geoApplyEffects(t) {
				t.Fatal("finished rejections/reads wrote data")
			}
		})
	}
}

// A process-only lock and an availability predicate in the original join are
// insufficient: finish_process owns the parent lock. Force a move to wait on it.
func TestLifecycleMoveObservesFinishProcessAfterDraftLockWait(t *testing.T) {
	m := setupMovement(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if _, err := m.pool.Exec(ctx, `UPDATE vacancy_processes SET status='closed' WHERE id=$1`, m.vacancy); err != nil {
		t.Fatal(err)
	}
	movePool, movePID := operationPool(t, ctx, m.pool)
	mover := boardstore.NewStore(movePool, m.store.audit, movementContext{m.drafts}, m.storage, draftjson.Decode)
	writer, err := m.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Rollback(context.Background())
	var writerPID int
	if err = writer.QueryRow(ctx, `SELECT pg_backend_pid() FROM job_drafts WHERE id=$1 FOR UPDATE`, m.vacancy).Scan(&writerPID); err != nil {
		t.Fatal(err)
	}
	if _, err = writer.Exec(ctx, `UPDATE vacancy_processes SET process_status='finished',lifecycle_version=lifecycle_version+1,process_finished_at=now() WHERE id=$1`, m.vacancy); err != nil {
		t.Fatal(err)
	}
	before := m.snapshot(t) + m.geoApplyEffects(t)
	done := make(chan error, 1)
	go func() {
		_, err := mover.Move(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"to_stage_id":"`+pipelineconfig.Defaults(m.vacancy).Stages[1].ID+`"}`))
		done <- err
	}()
	waitBlockedBy(t, ctx, m.pool, movePID, writerPID)
	if err = writer.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err = <-done:
		var finished *board.ProcessFinished
		if !errors.As(err, &finished) {
			t.Fatal("move missed concurrent finish_process", err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if before != m.snapshot(t)+m.geoApplyEffects(t) {
		t.Fatal("rejected move wrote effects")
	}
	// Reopening re-enables the same participation and preserves its ETag/history.
	if _, err = m.pool.Exec(ctx, `UPDATE vacancy_processes SET status='published',process_status='active' WHERE id=$1`, m.vacancy); err != nil {
		t.Fatal(err)
	}
	if _, err = m.move(t, m.item, pipelineconfig.Defaults(m.vacancy).Stages[1].ID, false); err != nil {
		t.Fatal("reopened move", err)
	}
}
