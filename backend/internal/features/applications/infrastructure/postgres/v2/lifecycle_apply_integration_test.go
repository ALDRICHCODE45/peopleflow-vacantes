//go:build integration

package v2

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/google/uuid"
)

func lifecycleApplyEffects(t *testing.T, f fixture) string {
	t.Helper()
	var rows string
	if err := f.pool.QueryRow(context.Background(), `SELECT jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM process_participations p WHERE process_id=$1),
 (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM participation_stage_history h JOIN process_participations p ON p.id=h.participation_id WHERE p.process_id=$1),
 (SELECT jsonb_agg(to_jsonb(i) ORDER BY candidate_id,idem_key) FROM participation_idempotency i WHERE process_id=$1),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_events a WHERE metadata->>'vacancy_id'=$1::text))::text`, f.vacancy).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	return rows + f.geoApplyEffects(t)
}

func TestLifecycleApplyReplayAndAvailabilityPrecedenceNoWrites(t *testing.T) {
	for _, state := range []struct{ publication, process string }{{"paused", "active"}, {"closed", "active"}, {"closed", "finished"}} {
		t.Run(state.publication+"/"+state.process, func(t *testing.T) {
			f := setup(t)
			seedApplyGeo(t, f)
			ctx := context.Background()
			cv, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
			if err != nil {
				t.Fatal(err)
			}
			key := uuid.New()
			req := f.request(cv.ID)
			success, err := f.store.Apply(ctx, f.sub, f.vacancy, key, req)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = f.pool.Exec(ctx, `UPDATE vacancy_processes SET status=$2,process_status=$3 WHERE id=$1`, f.vacancy, state.publication, state.process); err != nil {
				t.Fatal(err)
			}
			before := lifecycleApplyEffects(t, f)
			replay, err := f.store.Apply(ctx, f.sub, f.vacancy, key, req)
			if err != nil || !replay.Replayed || !bytes.Equal(replay.Body, success.Body) {
				t.Fatal("replay after hiding", err)
			}
			// Country, stale questionnaire, absent CV and duplicate would all reject;
			// availability must win over every one of them, without recording anything.
			if _, err = f.pool.Exec(ctx, `UPDATE vacancy_public_projections SET work_mode='remote',remote_scope_kind='countries',remote_countries=ARRAY['CO'] WHERE id=$1`, f.vacancy); err != nil {
				t.Fatal(err)
			}
			req.Revision = "stale"
			req.CVID = uuid.New()
			var unavailable *app.NotAcceptingApplications
			result, err := f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), req)
			if !errors.As(err, &unavailable) || unavailable.Availability != state.publication || len(result.Body) != 0 {
				t.Fatal(result, err)
			}
			conflict := req
			if _, err = f.store.Apply(ctx, f.sub, f.vacancy, key, conflict); !errors.Is(err, app.ErrIdempotencyConflict) {
				t.Fatal("replay conflict precedence", err)
			}
			if lifecycleApplyEffects(t, f) != before {
				t.Fatal("rejection/replay wrote effects")
			}
		})
	}
}

// Prove the original join's snapshot predates the lifecycle writer's commit.
// This is the G4 forced-interleaving pattern, with the same draft-first lock as L1.
func TestLifecycleApplyAvailabilityAfterWaitingForDraftLock(t *testing.T) {
	for _, tc := range []struct {
		name, oldState, newState string
		reject                   bool
	}{
		{"pause while waiting", "published", "paused", true},
		{"close while waiting", "published", "closed", true},
		{"resume while waiting", "paused", "published", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := setup(t)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			if _, err := f.pool.Exec(ctx, `UPDATE vacancy_processes SET status=$2 WHERE id=$1`, f.vacancy, tc.oldState); err != nil {
				t.Fatal(err)
			}
			cv, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
			if err != nil {
				t.Fatal(err)
			}
			before := lifecycleApplyEffects(t, f)
			applyPool, applyPID := operationPool(t, ctx, f.pool)
			intake := NewStore(applyPool, f.store.audit, f.store.rules, f.store.delivery)
			writer, err := f.pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer writer.Rollback(context.Background())
			var writerPID int
			if err = writer.QueryRow(ctx, `SELECT pg_backend_pid() FROM job_drafts WHERE id=$1 FOR UPDATE`, f.vacancy).Scan(&writerPID); err != nil {
				t.Fatal(err)
			}
			if _, err = writer.Exec(ctx, `UPDATE vacancy_processes SET status=$2,lifecycle_version=lifecycle_version+1 WHERE id=$1`, f.vacancy, tc.newState); err != nil {
				t.Fatal(err)
			}
			type outcome struct {
				result app.Result
				err    error
			}
			done := make(chan outcome, 1)
			go func() {
				result, err := intake.Apply(ctx, f.sub, f.vacancy, uuid.New(), f.request(cv.ID))
				done <- outcome{result, err}
			}()
			waitBlockedBy(t, ctx, f.pool, applyPID, writerPID)
			if err = writer.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			var got outcome
			select {
			case got = <-done:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			if tc.reject {
				var unavailable *app.NotAcceptingApplications
				if !errors.As(got.err, &unavailable) || unavailable.Availability != tc.newState || len(got.result.Body) != 0 {
					t.Fatalf("stale availability: %s %v", got.result.Body, got.err)
				}
				if lifecycleApplyEffects(t, f) != before {
					t.Fatal("rejected apply wrote effects")
				}
			} else {
				if got.err != nil || got.result.Replayed {
					t.Fatal("resume was not observed", got.err)
				}
				f.assertSingleEffects(t)
			}
		})
	}
}
