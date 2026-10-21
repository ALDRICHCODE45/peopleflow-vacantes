//go:build integration

package draftstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/google/uuid"
)

// GET gains a read-only view; write/replay envelopes intentionally stay unchanged.
func withoutLifecycle(t *testing.T, body []byte) []byte {
	t.Helper()
	root := envelopeOf(t, body)
	delete(root, "lifecycle")
	return mustCanonical(t, root)
}

func withoutLifecycleResult(t *testing.T, result drafts.Result) drafts.Result {
	t.Helper()
	result.Body = withoutLifecycle(t, result.Body)
	return result
}

// Publication may change only the embedded view on editor/pipeline GETs, not
// their resource body, version, ETag or replay metadata.
func assertPublicationResourceUnchanged(t *testing.T, before, after drafts.Result, embedded bool) {
	t.Helper()
	if embedded {
		initial := lifecycleViewOf(t, drafts.Result{Body: mustCanonical(t, envelopeOf(t, before.Body)["lifecycle"])})
		current := lifecycleViewOf(t, drafts.Result{Body: mustCanonical(t, envelopeOf(t, after.Body)["lifecycle"])})
		publication, process, at := "published", "active", fixedDeliveryClock().UTC().Format(timestampLayout)
		wantBefore := lifecycle.View{Version: "0", AllowedActions: []string{"publish"}}
		wantAfter := lifecycle.View{Publication: &publication, Process: &process, Version: "1", PublishedAt: &at, AllowedActions: []string{"pause", "close"}}
		if !reflect.DeepEqual(initial, wantBefore) || !reflect.DeepEqual(current, wantAfter) {
			t.Fatalf("publication lifecycle: before=%+v after=%+v", initial, current)
		}
		before = withoutLifecycleResult(t, before)
		after = withoutLifecycleResult(t, after)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("publication changed resource: before=%+v after=%+v", before, after)
	}
}

func TestLifecycleEffectsConfigurationAndEmbeddedViews(t *testing.T) {
	pool := requireDraftPool(t)
	ctx := context.Background()
	for _, state := range []string{"draft", "published", "paused", "closed active", "closed finished"} {
		t.Run(state, func(t *testing.T) {
			s, p, id, current := lifecycleFixture(t, pool, state)
			before := lifecycleSnapshot(t, pool, id)
			for _, read := range []func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (drafts.Result, error){s.GetV2, s.GetPipeline} {
				result, err := read(ctx, p.companyID, p.ownerID, id)
				if err != nil {
					t.Fatal(err)
				}
				var root map[string]json.RawMessage
				if err = json.Unmarshal(result.Body, &root); err != nil {
					t.Fatal(err)
				}
				var embedded lifecycle.View
				if err = json.Unmarshal(root["lifecycle"], &embedded); err != nil || !reflect.DeepEqual(embedded, lifecycleViewOf(t, current)) {
					t.Fatal("embedded view drift", err, string(result.Body))
				}
				var keys map[string]any
				if err = json.Unmarshal(root["lifecycle"], &keys); err != nil || len(keys) != 8 {
					t.Fatal("lifecycle wire keys", keys, err)
				}
			}
			if before != lifecycleSnapshot(t, pool, id) {
				t.Fatal("GET embedded views wrote state")
			}
			// Invalid bodies and absent tags intentionally prove finished wins before
			// configuration validation; active/draft resources must reach validation.
			operations := []struct {
				name string
				call func() error
			}{
				{"pipeline PUT", func() error {
					_, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, "", false, []byte(`{}`))
					return err
				}},
				{"pipeline preview", func() error { _, err := s.PreviewPipeline(ctx, p.companyID, p.ownerID, id, []byte(`{}`)); return err }},
				{"substates PUT", func() error {
					_, err := s.PutSubstates(ctx, p.companyID, p.ownerID, id, "", false, []byte(`{}`))
					return err
				}},
				{"delivery PUT", func() error {
					_, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, "", false, []byte(`{}`))
					return err
				}},
				{"management PUT", func() error {
					_, err := s.PutManagement(ctx, p.companyID, p.ownerID, id, "", false, []byte(`{}`))
					return err
				}},
			}
			for _, op := range operations {
				t.Run(op.name, func(t *testing.T) {
					err := op.call()
					var finished *lifecycle.ProcessFinished
					if state == "closed finished" {
						if !errors.As(err, &finished) || !reflect.DeepEqual(finished.Lifecycle, lifecycleViewOf(t, current)) {
							t.Fatal("wrong finished error/view", err)
						}
					} else if err == nil || errors.As(err, &finished) {
						t.Fatal("active process did not reach validation", err)
					}
					if before != lifecycleSnapshot(t, pool, id) {
						t.Fatal("rejection wrote state")
					}
				})
			}
			page, err := s.ListV2(ctx, p.companyID, p.ownerID, draftlist.Request{Limit: 50})
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, item := range page.Items {
				if item.ID == id {
					found = true
					view := lifecycleViewOf(t, current)
					status := "draft"
					if view.Publication != nil {
						status = *view.Publication
					}
					if item.Status != status || !reflect.DeepEqual(item.Process, view.Process) {
						t.Fatal("list state drift", item)
					}
				}
			}
			if !found {
				t.Fatal("draft missing from list")
			}
			if state == "closed finished" {
				editor, err := s.GetV2(ctx, p.companyID, p.ownerID, id)
				if err != nil {
					t.Fatal(err)
				}
				saved, err := s.SaveV2(ctx, p.companyID, p.ownerID, id, editor.ETag, true, []byte(`{"fields":{"title":"Corrected closed vacancy"}}`))
				if err != nil || bytes.Equal(withoutLifecycle(t, editor.Body), saved.Body) {
					t.Fatal("finished content PATCH blocked", err)
				}
				after, err := s.GetLifecycle(ctx, p.companyID, p.ownerID, id)
				if err != nil || !bytes.Equal(after.Body, current.Body) {
					t.Fatal("content PATCH changed lifecycle", err)
				}
			}
		})
	}
}
