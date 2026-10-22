//go:build integration

package main

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestPublicRequirementsProfileListDetailAndPublishedSave(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	id := publicationFlowReady(t, h, owner)
	marker := "requirements" + strings.ReplaceAll(uuid.NewString(), "-", "")
	empty := map[string]any{"languages": []any{}, "min_years_of_experience": nil, "min_education_level": nil, "accepts_in_progress_education": false}
	populated := map[string]any{"languages": []any{map[string]any{"code": "en", "min_level": "B2"}, map[string]any{"code": "nah", "min_level": "native"}}, "min_years_of_experience": "1.5", "min_education_level": "bachelor", "accepts_in_progress_education": true}
	fields := map[string]any{"title": marker, "seniority": "semi_senior"}
	for k, v := range populated {
		fields[k] = v
	}
	publicFlowPatch(t, h, id, owner, fields)
	at := publicFlowPublish(t, h, id, owner)
	legacy := publicFlowLegacy(t, h, company.companyID, marker, "Description", "México", at, nil)
	assert := func(want map[string]any, legacySeniority string) {
		t.Helper()
		page := publicFlowGet(t, h, "/v2/jobs?q="+marker, 200)
		items := page["items"].([]any)
		if len(items) != 2 {
			t.Fatalf("items=%v", items)
		}
		for _, raw := range items {
			item := raw.(map[string]any)
			detail := publicFlowGet(t, h, "/v2/jobs/"+item["id"].(string), 200)
			publicFlowAssertKeys(t, item, false)
			publicFlowAssertKeys(t, detail, true)
			expected, seniority := want, "semi_senior"
			if item["id"] == legacy {
				expected, seniority = empty, legacySeniority
			}
			for _, body := range []map[string]any{item, detail} {
				if !reflect.DeepEqual(body["requirements_profile"], expected) || body["seniority"] != seniority {
					t.Fatalf("profile/seniority=%v / %v want %v / %s", body["requirements_profile"], body["seniority"], expected, seniority)
				}
			}
		}
	}
	for _, seniority := range []string{"intern", "junior", "mid", "senior", "lead"} {
		if _, err := h.pool.Exec(context.Background(), `UPDATE jobs SET seniority=$2 WHERE id=$1`, legacy, seniority); err != nil {
			t.Fatal(err)
		}
		mapped := seniority
		if mapped == "mid" {
			mapped = "semi_senior"
		}
		assert(populated, mapped)
	}
	// Published saves, including clearing optional requirements, update both public surfaces.
	publicFlowPatch(t, h, id, owner, empty)
	assert(empty, "lead")
	publicFlowPatch(t, h, id, owner, populated)
	assert(populated, "lead")
	var current bool
	if err := h.pool.QueryRow(context.Background(), `SELECT p.source_draft_version=d.version FROM vacancy_public_projections p JOIN job_drafts d USING(id) WHERE id=$1`, id).Scan(&current); err != nil || !current {
		t.Fatal("stale projection", err)
	}
}
