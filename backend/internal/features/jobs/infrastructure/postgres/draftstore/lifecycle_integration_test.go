//go:build integration

package draftstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publication"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func lifecycleViewOf(t *testing.T, result drafts.Result) lifecycle.View {
	t.Helper()
	var view lifecycle.View
	if err := json.Unmarshal(result.Body, &view); err != nil {
		t.Fatal(err)
	}
	return view
}
func lifecycleSnapshot(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) string {
	t.Helper()
	var raw string
	if err := pool.QueryRow(context.Background(), `SELECT jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(e) ORDER BY lifecycle_version) FROM vacancy_lifecycle_events e WHERE process_id=$1),
 (SELECT to_jsonb(p) FROM vacancy_public_projections p WHERE id=$1),
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM process_participations p WHERE process_id=$1),
 (SELECT to_jsonb(f) FROM process_delivery_fulfillments f WHERE process_id=$1))::text`, id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	return publicationSnapshot(t, pool, id) + raw
}
func lifecycleFixture(t *testing.T, pool *pgxpool.Pool, state string) (*Store, principal, uuid.UUID, drafts.Result) {
	t.Helper()
	s, p, draft := readyPublication(t, pool)
	id := draftIDOf(t, draft)
	ctx := context.Background()
	if state != "draft" {
		if _, err := s.Publish(ctx, p.companyID, p.ownerID, id, uuid.NewString(), true, draft.ETag, true, []byte(`{}`)); err != nil {
			t.Fatal(err)
		}
	}
	current, err := s.GetLifecycle(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	action, body := "", `{}`
	switch state {
	case "paused":
		action = "pause"
	case "closed active":
		action = "close"
		body = `{"process":"continue","reason":"cancelled","reason_note":null}`
	case "closed finished":
		action = "close"
		body = `{"process":"finish","reason":"cancelled","reason_note":null}`
	}
	if action != "" {
		current, err = s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, action, uuid.NewString(), true, current.ETag, true, []byte(body))
		if err != nil {
			t.Fatal(err)
		}
	}
	return s, p, id, current
}
func TestLifecycleDBEveryTransitionAndRejectionAtomic(t *testing.T) {
	pool := requireDraftPool(t)
	ctx := context.Background()
	for _, state := range []string{"draft", "published", "paused", "closed active", "closed finished"} {
		t.Run(state, func(t *testing.T) {
			for _, test := range []struct{ action, body string }{{"pause", `{}`}, {"resume", `{}`}, {"close", `{"process":"continue","reason":"cancelled","reason_note":null}`}, {"close", `{"process":"finish","reason":"cancelled","reason_note":null}`}, {"finish_process", `{}`}, {"reopen", `{}`}} {
				t.Run(test.action+test.body, func(t *testing.T) {
					s, p, id, current := lifecycleFixture(t, pool, state)
					view := lifecycleViewOf(t, current)
					before := lifecycleSnapshot(t, pool, id)
					valid := false
					for _, action := range view.AllowedActions {
						if action == test.action {
							valid = true
						}
					}
					got, err := s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, test.action, uuid.NewString(), true, current.ETag, true, []byte(test.body))
					if !valid {
						var invalid *lifecycle.InvalidTransition
						if !errors.As(err, &invalid) || !reflect.DeepEqual(invalid.Lifecycle, view) || invalid.Action != test.action || before != lifecycleSnapshot(t, pool, id) || !reflect.DeepEqual(got, drafts.Result{}) {
							t.Fatalf("rejection=%+v %v", got, err)
						}
						return
					}
					choice := ""
					if test.action == "close" {
						choice = "continue"
						if strings.Contains(test.body, "finish") {
							choice = "finish"
						}
					}
					want, errWant := lifecycle.Transition(view, test.action, choice, fixedDeliveryClock())
					metadataKeys := 3
					if test.action == "close" {
						reason := "cancelled"
						want.CloseReason = &reason
						metadataKeys++
					}
					if err != nil || errWant != nil || got.Replayed || !reflect.DeepEqual(lifecycleViewOf(t, got), want) {
						t.Fatalf("got=%s %v want=%+v %v", got.Body, err, want, errWant)
					}
					after, err := s.GetLifecycle(ctx, p.companyID, p.ownerID, id)
					if err != nil || !bytes.Equal(after.Body, got.Body) || after.ETag != got.ETag {
						t.Fatal("GET differs", err)
					}
					var actor uuid.UUID
					var entity string
					var raw []byte
					if err := pool.QueryRow(ctx, `SELECT actor_id,entity_type,metadata FROM audit_events WHERE entity_id=$1 AND event_type=$2 ORDER BY occurred_at DESC LIMIT 1`, id, lifecycleAuditType(test.action)).Scan(&actor, &entity, &raw); err != nil {
						t.Fatal(err)
					}
					var metadata map[string]string
					if err := json.Unmarshal(raw, &metadata); err != nil {
						t.Fatal(err)
					}
					if actor != p.ownerID || entity != "vacancy_process" || len(metadata) != metadataKeys || metadata["version"] != want.Version || metadata["publication"] != *want.Publication || metadata["process"] != *want.Process {
						t.Fatalf("audit=%s %s %s", actor, entity, raw)
					}
				})
			}
		})
	}
}
func TestLifecycleDBReplayOrderStrictBodyAndAuditRollback(t *testing.T) {
	pool := requireDraftPool(t)
	ctx := context.Background()
	s, p, id, current := lifecycleFixture(t, pool, "published")
	for _, tc := range []struct {
		name, action, key, tag, body string
		keyPresent, present          bool
		want                         error
	}{
		{"missing key", "pause", "", current.ETag, `{}`, false, true, drafts.ErrIdempotencyKeyRequired},
		{"empty key", "pause", "", current.ETag, `{}`, true, true, drafts.ErrInvalidIdempotencyKey},
		{"malformed key before precondition", "pause", "x", "", `{}`, true, false, drafts.ErrInvalidIdempotencyKey},
		{"missing precondition before body", "pause", uuid.NewString(), "", `{"extra":1}`, true, false, drafts.ErrPreconditionRequired},
		{"stale precondition", "pause", uuid.NewString(), lifecycle.ETag(id, 99), `{}`, true, true, drafts.ErrVersionConflict},
		{"weak precondition", "pause", uuid.NewString(), "W/" + current.ETag, `{}`, true, true, drafts.ErrInvalidRequest},
		{"extra key", "pause", uuid.NewString(), current.ETag, `{"process":"continue"}`, true, true, drafts.ErrInvalidRequest},
		{"null", "pause", uuid.NewString(), current.ETag, `null`, true, true, drafts.ErrInvalidRequest},
		{"close required", "close", uuid.NewString(), current.ETag, `{}`, true, true, drafts.ErrInvalidRequest},
		{"close null", "close", uuid.NewString(), current.ETag, `{"process":null}`, true, true, drafts.ErrInvalidRequest},
		{"close bad choice", "close", uuid.NewString(), current.ETag, `{"process":"active"}`, true, true, drafts.ErrInvalidRequest},
		{"close duplicate", "close", uuid.NewString(), current.ETag, `{"process":"continue","process":"finish"}`, true, true, drafts.ErrInvalidRequest},
		{"close extra", "close", uuid.NewString(), current.ETag, `{"process":"continue","x":1}`, true, true, drafts.ErrInvalidRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := lifecycleSnapshot(t, pool, id)
			got, err := s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, tc.action, tc.key, tc.keyPresent, tc.tag, tc.present, []byte(tc.body))
			if !errors.Is(err, tc.want) || !reflect.DeepEqual(got, drafts.Result{}) || before != lifecycleSnapshot(t, pool, id) {
				t.Fatalf("%+v %v want %v", got, err, tc.want)
			}
		})
	}
	before := lifecycleSnapshot(t, pool, id)
	failed := NewStore(pool, failingAudit{})
	failed.clock = fixedDeliveryClock
	if _, err := failed.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, "pause", uuid.NewString(), true, current.ETag, true, []byte(`{}`)); err == nil || before != lifecycleSnapshot(t, pool, id) {
		t.Fatal("audit failure leaked writes", err)
	}
	key := uuid.NewString()
	paused, err := s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, "pause", key, true, current.ETag, true, []byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	before = lifecycleSnapshot(t, pool, id)
	replay, err := s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, "pause", strings.ToUpper(key), true, "", false, []byte(" \n { } "))
	if err != nil || !replay.Replayed || !bytes.Equal(replay.Body, paused.Body) || replay.ETag != paused.ETag || before != lifecycleSnapshot(t, pool, id) {
		t.Fatal("replay", err)
	}
	if _, err = s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, "resume", key, true, "", false, []byte(`{}`)); !errors.Is(err, drafts.ErrIdempotencyConflict) || before != lifecycleSnapshot(t, pool, id) {
		t.Fatal("key reused across actions", err)
	}
	// Replay remains the original result even after a later transition.
	if _, err = s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, "resume", uuid.NewString(), true, paused.ETag, true, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	replay, err = s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, "pause", key, true, "", false, []byte(`{}`))
	if err != nil || !replay.Replayed || !bytes.Equal(replay.Body, paused.Body) {
		t.Fatal(err)
	}
}
func TestLifecycleDBConcurrencyExactlyOneWrite(t *testing.T) {
	pool := requireDraftPool(t)
	ctx := context.Background()
	for _, sameKey := range []bool{false, true} {
		t.Run(map[bool]string{false: "distinct keys", true: "same key"}[sameKey], func(t *testing.T) {
			s, p, id, current := lifecycleFixture(t, pool, "published")
			key := uuid.NewString()
			start := make(chan struct{})
			var wg sync.WaitGroup
			results := make(chan drafts.Result, 2)
			errs := make(chan error, 2)
			for range 2 {
				k := key
				if !sameKey {
					k = uuid.NewString()
				}
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					got, err := s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, "pause", k, true, current.ETag, true, []byte(`{}`))
					results <- got
					errs <- err
				}()
			}
			close(start)
			wg.Wait()
			close(results)
			close(errs)
			wins, conflicts, replays := 0, 0, 0
			for err := range errs {
				if err == nil {
					wins++
				} else if errors.Is(err, drafts.ErrVersionConflict) {
					conflicts++
				} else {
					t.Fatal(err)
				}
			}
			for got := range results {
				if got.Replayed {
					replays++
				}
			}
			var rows int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM vacancy_lifecycle_events WHERE process_id=$1`, id).Scan(&rows); err != nil {
				t.Fatal(err)
			}
			current, err := s.GetLifecycle(ctx, p.companyID, p.ownerID, id)
			if err != nil || rows != 1 || lifecycleViewOf(t, current).Version != "2" || auditCount(t, pool, id, lifecycleAuditType("pause")) != 1 || sameKey && (wins != 2 || replays != 1) || !sameKey && (wins != 1 || conflicts != 1) {
				t.Fatalf("wins=%d conflicts=%d replays=%d rows=%d %v", wins, conflicts, replays, rows, err)
			}
		})
	}
}
func TestLifecycleDBReadinessResumeReopenAndClockExemption(t *testing.T) {
	pool := requireDraftPool(t)
	ctx := context.Background()
	for _, state := range []string{"paused", "closed active", "closed finished"} {
		t.Run(state, func(t *testing.T) {
			s, p, id, current := lifecycleFixture(t, pool, state)
			action := "reopen"
			if state == "paused" {
				action = "resume"
			}
			// Simulate an incomplete hidden vacancy; no HTTP route bypasses its guard.
			if _, err := pool.Exec(ctx, `UPDATE job_draft_management_configs SET hiring_headcount=NULL WHERE draft_id=$1`, id); err != nil {
				t.Fatal(err)
			}
			before := lifecycleSnapshot(t, pool, id)
			_, err := s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, action, uuid.NewString(), true, current.ETag, true, []byte(`{}`))
			var incomplete *publication.Incomplete
			if !errors.As(err, &incomplete) || !reflect.DeepEqual(incomplete.Missing, []string{"hiring_headcount_missing"}) || before != lifecycleSnapshot(t, pool, id) {
				t.Fatalf("readiness=%+v %v", incomplete, err)
			}
			if _, err := pool.Exec(ctx, `UPDATE job_draft_management_configs SET hiring_headcount=2 WHERE draft_id=$1`, id); err != nil {
				t.Fatal(err)
			}
			s.clock = func() time.Time { return fixedDeliveryClock().Add(48 * time.Hour) }
			if _, err = s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, action, uuid.NewString(), true, current.ETag, true, []byte(`{}`)); err != nil {
				t.Fatal("clock passage must be exempt", err)
			}
		})
	}
}
func TestLifecycleDBHistoryActorSnapshotAndPreservedAuthoring(t *testing.T) {
	pool := requireDraftPool(t)
	ctx := context.Background()
	s, p, id, current := lifecycleFixture(t, pool, "published")
	authoring, err := s.GetV2(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	var name string
	if err := pool.QueryRow(ctx, `SELECT full_name FROM users WHERE id=$1`, p.ownerID).Scan(&name); err != nil {
		t.Fatal(err)
	}
	actions := []string{"pause", "resume", "close", "finish_process", "reopen", "close", "reopen"}
	for i, action := range actions {
		body := `{}`
		if action == "close" {
			body = `{"process":"continue","reason":"cancelled","reason_note":null}`
			if i == 5 {
				body = `{"process":"finish","reason":"cancelled","reason_note":null}`
			}
		}
		// Same timestamp deliberately exercises lifecycle-version tie ordering.
		current, err = s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, action, uuid.NewString(), true, current.ETag, true, []byte(body))
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET full_name='Changed actor' WHERE id=$1`, p.ownerID); err != nil {
		t.Fatal(err)
	}
	history, err := s.GetLifecycleHistory(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	var response struct {
		Items []lifecycle.Event `json:"items"`
	}
	if err := json.Unmarshal(history.Body, &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Items) != len(actions) {
		t.Fatal(string(history.Body))
	}
	for i, e := range response.Items {
		if e.Action != actions[len(actions)-1-i] || e.Actor.ID != p.ownerID.String() || e.Actor.Name != name || e.CreatedAt != "2026-10-16T18:00:00.000000Z" {
			t.Fatalf("event=%+v", e)
		}
		if e.Action == "close" && (e.Process == nil || *e.Process != "continue" && *e.Process != "finish") || e.Action != "close" && e.Process != nil {
			t.Fatalf("choice=%+v", e)
		}
	}
	view := lifecycleViewOf(t, current)
	if *view.Publication != "published" || *view.Process != "active" || view.PausedAt == nil || view.ClosedAt == nil || view.ProcessFinishedAt == nil {
		t.Fatal(view)
	}
	after, err := s.GetV2(ctx, p.companyID, p.ownerID, id)
	if err != nil || !bytes.Equal(withoutLifecycle(t, after.Body), withoutLifecycle(t, authoring.Body)) || after.ETag != authoring.ETag {
		t.Fatal("lifecycle changed authoring", err)
	}
}
func TestLifecycleDBAuthorizationAndLiveGates(t *testing.T) {
	pool := requireDraftPool(t)
	ctx := context.Background()
	for _, role := range []string{"owner", "principal", "other recruiter", "foreign company", "deleted user", "missing membership", "suspended company", "deleted company"} {
		t.Run(role, func(t *testing.T) {
			s, p, id, current := lifecycleFixture(t, pool, "published")
			company, actor := p.companyID, p.ownerID
			var want error
			switch role {
			case "principal":
				actor = addMember(t, pool, p.companyID, "recruiter")
				if _, err := pool.Exec(ctx, `UPDATE job_drafts SET principal_recruiter_id=$2 WHERE id=$1`, id, actor); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					_, _ = pool.Exec(ctx, `UPDATE job_drafts SET principal_recruiter_id=$2 WHERE id=$1`, id, p.ownerID)
					_, _ = pool.Exec(ctx, `DELETE FROM vacancy_lifecycle_events WHERE process_id=$1`, id)
					_, _ = pool.Exec(ctx, `DELETE FROM job_draft_idempotency WHERE actor_id=$1`, actor)
					_, _ = pool.Exec(ctx, `DELETE FROM audit_events WHERE actor_id=$1`, actor)
				})
			case "other recruiter":
				actor = addMember(t, pool, p.companyID, "recruiter")
				want = drafts.ErrNotFound
			case "foreign company":
				foreign := newPrincipal(t, pool)
				company, actor = foreign.companyID, foreign.ownerID
				want = drafts.ErrNotFound
			case "deleted user":
				_, err := pool.Exec(ctx, `UPDATE users SET deleted_at=now() WHERE id=$1`, actor)
				if err != nil {
					t.Fatal(err)
				}
				want = drafts.ErrUnauthenticated
			case "missing membership":
				_, err := pool.Exec(ctx, `DELETE FROM company_members WHERE user_id=$1`, actor)
				if err != nil {
					t.Fatal(err)
				}
				want = drafts.ErrForbidden
			case "suspended company":
				_, err := pool.Exec(ctx, `UPDATE companies SET status='suspended' WHERE id=$1`, company)
				if err != nil {
					t.Fatal(err)
				}
				want = drafts.ErrCompanyNotActive
			case "deleted company":
				_, err := pool.Exec(ctx, `UPDATE companies SET deleted_at=now() WHERE id=$1`, company)
				if err != nil {
					t.Fatal(err)
				}
				want = drafts.ErrCompanyInactive
			}
			before := lifecycleSnapshot(t, pool, id)
			for _, read := range []func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (drafts.Result, error){s.GetLifecycle, s.GetLifecycleHistory} {
				_, err := read(ctx, company, actor, id)
				if !errors.Is(err, want) {
					t.Fatal("read auth", err, want)
				}
			}
			key, tag := uuid.NewString(), current.ETag
			if want != nil {
				key, tag = "", ""
			}
			_, err := s.TransitionLifecycle(ctx, company, actor, id, "pause", key, want == nil, tag, want == nil, []byte(`{}`))
			if !errors.Is(err, want) {
				t.Fatal("write auth", err, want)
			}
			if want != nil && before != lifecycleSnapshot(t, pool, id) {
				t.Fatal("authorization failure wrote")
			}
		})
	}
}
