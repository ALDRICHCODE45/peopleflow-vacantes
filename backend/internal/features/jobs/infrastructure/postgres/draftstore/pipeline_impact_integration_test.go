//go:build integration

package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	pc "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestColumnsDraftPreviewIDsRetirementAndAuthorization(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	ctx := context.Background()
	base := pc.Defaults(id)
	body := []byte(strings.Replace(string(pipelineWriteBody(t, base)), `{"id":"`+base.Stages[1].ID+`"`, `{"name":"Custom"},{"id":"`+base.Stages[1].ID+`"`, 1))
	before := pipelineSnapshot(t, pool, id)
	preview, err := s.PreviewPipeline(ctx, p.companyID, p.ownerID, id, body)
	if err != nil || preview.HasImpact || len(preview.Stages) != 6 || before != pipelineSnapshot(t, pool, id) {
		t.Fatal(preview, err)
	}
	foreign := newPrincipal(t, pool)
	nonprincipal := addMember(t, pool, p.companyID, "recruiter")
	for _, caller := range []struct{ company, actor, id uuid.UUID }{{foreign.companyID, foreign.ownerID, id}, {p.companyID, nonprincipal, id}, {p.companyID, p.ownerID, uuid.New()}} {
		_, err := s.PreviewPipeline(ctx, caller.company, caller.actor, caller.id, []byte(`broken`))
		if !errors.Is(err, drafts.ErrNotFound) || before != pipelineSnapshot(t, pool, id) {
			t.Fatal(err)
		}
	}
	saved, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, pc.ETag(id, 0), true, body)
	if err != nil {
		t.Fatal(err)
	}
	c := pipelineConfigOf(t, saved.Body)
	if !reflect.DeepEqual(c.Stages, preview.Stages) {
		t.Fatal(c, preview)
	}
	var out map[string]any
	_ = json.Unmarshal(saved.Body, &out)
	if out["structure_locked"] != false || out["applied_impact"] == nil {
		t.Fatal(out)
	}
	firstID := c.Stages[1].ID
	removed, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, saved.ETag, true, pipelineWriteBody(t, base))
	if err != nil {
		t.Fatal(err)
	}
	r := pipelineConfigOf(t, removed.Body)
	if len(r.Retired) != 1 || r.Retired[0].ID != firstID || r.Retired[0].Name != "Custom" {
		t.Fatal(r)
	}
	preview, err = s.PreviewPipeline(ctx, p.companyID, p.ownerID, id, body)
	if err != nil {
		t.Fatal(err)
	}
	recreated, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, removed.ETag, true, body)
	if err != nil {
		t.Fatal(err)
	}
	c = pipelineConfigOf(t, recreated.Body)
	if c.Stages[1].ID == firstID || c.Stages[1].ID != preview.Stages[1].ID || len(c.Retired) != 1 {
		t.Fatal(c, preview)
	}
	before = pipelineSnapshot(t, pool, id)
	resurrection := pipelineWriteBody(t, c)
	resurrection = []byte(strings.Replace(string(resurrection), c.Stages[1].ID, firstID, 1))
	if _, err = s.PutPipeline(ctx, p.companyID, p.ownerID, id, recreated.ETag, true, resurrection); !errors.Is(err, drafts.ErrValidation) || before != pipelineSnapshot(t, pool, id) {
		t.Fatal(err)
	}
}
