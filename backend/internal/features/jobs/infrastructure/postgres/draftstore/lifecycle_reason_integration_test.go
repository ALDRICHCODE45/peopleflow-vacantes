//go:build integration

package draftstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestLifecycleCloseFilledCoverageAtomic(t *testing.T) {
	pool := requireDraftPool(t)
	ctx := context.Background()
	for _, tc := range []struct {
		name     string
		required any
		covered  int64
		valid    bool
	}{
		{"below required", int64(2), 1, false},
		{"no target", nil, 1, false},
		{"at target", int64(1), 1, true},
		{"above target", int64(1), 2, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, p, id, current := lifecycleFixture(t, pool, "published")
			exec := func(q string, args ...any) {
				t.Helper()
				if _, err := pool.Exec(ctx, q, args...); err != nil {
					t.Fatal(err)
				}
			}
			exec(`UPDATE job_draft_management_configs SET hiring_headcount=$2 WHERE draft_id=$1`, id, tc.required)
			config := pipelineconfig.Defaults(id)
			var placement string
			for _, stage := range config.Stages {
				if stage.Kind == "placement" {
					placement = stage.ID
				}
			}
			for i := int64(0); i < tc.covered; i++ {
				candidate, cv, participation := uuid.New(), uuid.New(), uuid.New()
				t.Cleanup(func() {
					_, _ = pool.Exec(ctx, `DELETE FROM process_participations WHERE id=$1`, participation)
					_, _ = pool.Exec(ctx, `DELETE FROM candidate_cv_versions WHERE id=$1`, cv)
					_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, candidate)
				})
				exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate')`, candidate, uuid.NewString(), uuid.NewString()+"@example.test")
				exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, candidate, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
				exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`, participation, id, candidate, placement, cv)
			}
			before := lifecycleSnapshot(t, pool, id)
			got, err := s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, "close", uuid.NewString(), true, current.ETag, true, []byte(`{"process":"finish","reason":"filled","reason_note":null}`))
			if !tc.valid {
				var uncovered *lifecycle.CloseReasonNotCovered
				if !errors.As(err, &uncovered) || uncovered.Covered != tc.covered {
					t.Fatalf("coverage: %+v %v", uncovered, err)
				}
				if tc.required == nil && uncovered.Required != nil || tc.required != nil && (uncovered.Required == nil || *uncovered.Required != tc.required.(int64)) {
					t.Fatalf("required: %+v", uncovered)
				}
				if before != lifecycleSnapshot(t, pool, id) {
					t.Fatal("coverage rejection wrote state, versions, history, audit or idempotency")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			view := lifecycleViewOf(t, got)
			if view.CloseReason == nil || *view.CloseReason != "filled" || view.CloseReasonNote != nil {
				t.Fatalf("close reason: %+v", view)
			}
		})
	}
}

func TestLifecycleReasonReadsReplayAndFirstPublication(t *testing.T) {
	pool := requireDraftPool(t)
	ctx := context.Background()
	s, p, id, current := lifecycleFixture(t, pool, "published")
	first := *lifecycleViewOf(t, current).PublishedAt
	s.clock = func() time.Time { return fixedDeliveryClock().Add(24 * time.Hour) }
	transition := func(action, body string) {
		t.Helper()
		var err error
		current, err = s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, action, uuid.NewString(), true, current.ETag, true, []byte(body))
		if err != nil {
			t.Fatal(err)
		}
		if *lifecycleViewOf(t, current).PublishedAt != first {
			t.Fatal("changed first publication", action)
		}
	}
	transition("pause", `{}`)
	transition("resume", `{}`)
	key := uuid.NewString()
	var err error
	current, err = s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, "close", key, true, current.ETag, true, []byte(`{"process":"continue","reason":"other","reason_note":"  Cambio de planes  "}`))
	if err != nil {
		t.Fatal(err)
	}
	before := lifecycleSnapshot(t, pool, id)
	replay, err := s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, "close", key, true, "", false, []byte(`{"reason_note":"Cambio de planes","reason":"other","process":"continue"}`))
	if err != nil || !replay.Replayed || !bytes.Equal(current.Body, replay.Body) || before != lifecycleSnapshot(t, pool, id) {
		t.Fatal("canonical replay", err)
	}
	assertReads := func(reason, note any) {
		t.Helper()
		got, err := s.GetLifecycle(ctx, p.companyID, p.ownerID, id)
		if err != nil {
			t.Fatal(err)
		}
		var view map[string]any
		if err = json.Unmarshal(got.Body, &view); err != nil || len(view) != 10 || view["close_reason"] != reason || view["close_reason_note"] != note {
			t.Fatal("view keys/values", view, err)
		}
		for _, read := range []func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (drafts.Result, error){s.GetV2, s.GetPipeline} {
			embedded, err := read(ctx, p.companyID, p.ownerID, id)
			if err != nil {
				t.Fatal(err)
			}
			root := envelopeOf(t, embedded.Body)
			if !reflect.DeepEqual(root["lifecycle"], envelopeOf(t, got.Body)) {
				t.Fatal("embedded view differs")
			}
		}
		page, err := s.ListV2(ctx, p.companyID, p.ownerID, draftlist.Request{Limit: 20})
		if err != nil || len(page.Items) != 1 {
			t.Fatal("list", page, err)
		}
		item := page.Items[0]
		if reason == nil {
			if item.CloseReason != nil || item.CloseReasonNote != nil {
				t.Fatal("open list exposes reason")
			}
		} else if item.CloseReason == nil || *item.CloseReason != reason || item.CloseReasonNote == nil || *item.CloseReasonNote != note {
			t.Fatal("closed list reason", item)
		}
	}
	assertReads("other", "Cambio de planes")
	transition("finish_process", `{}`)
	assertReads("other", "Cambio de planes")
	transition("reopen", `{}`)
	assertReads(nil, nil)
	history, err := s.GetLifecycleHistory(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	var events struct {
		Items []map[string]any `json:"items"`
	}
	if err = json.Unmarshal(history.Body, &events); err != nil || len(events.Items) != 5 {
		t.Fatal(string(history.Body), err)
	}
	for _, event := range events.Items {
		if len(event) != 7 {
			t.Fatal("history keys", event)
		}
		if event["action"] == "close" {
			if event["reason"] != "other" || event["reason_note"] != "Cambio de planes" {
				t.Fatal(event)
			}
		} else if event["reason"] != nil || event["reason_note"] != nil {
			t.Fatal(event)
		}
	}
}
