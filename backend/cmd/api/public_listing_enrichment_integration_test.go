//go:build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestPublicListingEnrichmentPublicationSaveAndAllApplicants(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	id := publicationFlowReady(t, h, owner)
	ctx := context.Background()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := h.pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	marker := "enrichment" + strings.ReplaceAll(uuid.NewString(), "-", "")
	skills := []string{"SQL", "Go", "e\u0301", "界", "TypeScript", "PostgreSQL", "Docker"}
	questions := []any{map[string]any{"id": uuid.NewString(), "type": "open", "prompt": "private-question-sentinel"}, map[string]any{"id": uuid.NewString(), "type": "open", "prompt": "second-question-sentinel"}}
	publicFlowPatch(t, h, id, owner, map[string]any{"title": marker, "location": marker, "skills": skills, "benefits": []string{"wellness", "health_insurance"}, "custom_benefits": []string{"Café", "Gym"}, "screening_questions": questions})
	at := publicFlowPublish(t, h, id, owner)
	legacy := publicFlowLegacy(t, h, company.companyID, marker, " \n\u00a0Detalle\t seguro  ", marker, at, nil)
	exec(`UPDATE companies SET logo_url='https://example.test/logo.png' WHERE id=$1`, company.companyID)
	check := func(wantRange string, wantScreening int) {
		t.Helper()
		list := publicFlowGet(t, h, "/v2/jobs?location="+url.QueryEscape(marker), 200)["items"].([]any)
		if len(list) != 2 {
			t.Fatalf("list=%v", list)
		}
		for _, value := range list {
			item := value.(map[string]any)
			publicFlowAssertKeys(t, item, false)
			detail := publicFlowGet(t, h, "/v2/jobs/"+item["id"].(string), 200)
			publicFlowAssertKeys(t, detail, true)
			for key, value := range item {
				if !reflect.DeepEqual(value, detail[key]) {
					t.Fatalf("list/detail differ at %s", key)
				}
			}
			if item["company"].(map[string]any)["logo_url"] != "https://example.test/logo.png" {
				t.Fatal("company logo missing")
			}
			raw, err := json.Marshal(detail)
			if err != nil {
				t.Fatal(err)
			}
			for _, private := range []string{"requester", "headcount", "request_date", "requestDate", "delivery", "pipeline", "correct_option_id", "answers_snapshot", "questions_snapshot", "applicant_count", "applicants_total", "candidate_id", "cv_version_id", "private-question-sentinel", "second-question-sentinel", "discard-internal-sentinel", "candidate-private-sentinel"} {
				if strings.Contains(string(raw), private) {
					t.Fatalf("public body leaked %s", private)
				}
			}
			if item["source"] == "legacy" {
				if item["id"] != legacy || item["applicants"] != nil || item["screening_questions"] != nil || item["benefits_total"] != float64(0) || item["skills_total"] != float64(0) || !reflect.DeepEqual(item["skills_preview"], []any{}) || !reflect.DeepEqual(detail["skills"], []any{}) || item["excerpt"] != "Detalle seguro" || item["excerpt_truncated"] != false {
					t.Fatalf("legacy=%v", detail)
				}
				if !reflect.DeepEqual(item["benefits_preview"], map[string]any{"predefined": []any{}, "custom": []any{}}) {
					t.Fatal("legacy benefits")
				}
				continue
			}
			if item["applicants"] != wantRange || item["screening_questions"] != float64(wantScreening) || item["skills_total"] != float64(7) || item["benefits_total"] != float64(4) {
				t.Fatalf("vacancy=%v", detail)
			}
			if !reflect.DeepEqual(item["skills_preview"], []any{"SQL", "Go", "e\u0301", "界", "TypeScript", "PostgreSQL"}) || !reflect.DeepEqual(detail["skills"], []any{"SQL", "Go", "e\u0301", "界", "TypeScript", "PostgreSQL", "Docker"}) {
				t.Fatal("skills lost ordering or full detail")
			}
			if !reflect.DeepEqual(item["benefits_preview"], map[string]any{"predefined": []any{"wellness", "health_insurance"}, "custom": []any{"Café"}}) || !reflect.DeepEqual(detail["benefits"], map[string]any{"predefined": []any{"wellness", "health_insurance"}, "custom": []any{"Café", "Gym"}}) {
				t.Fatal("benefits preview/full ordering")
			}
		}
	}
	candidates := []uuid.UUID{}
	t.Cleanup(func() {
		exec(`DELETE FROM process_participations WHERE process_id=$1`, id)
		exec(`DELETE FROM candidate_cv_versions WHERE candidate_id=ANY($1::uuid[])`, candidates)
		exec(`DELETE FROM users WHERE id=ANY($1::uuid[])`, candidates)
	})
	received := 0
	for _, tc := range []struct {
		count int
		want  string
	}{{0, "under_10"}, {9, "under_10"}, {10, "10_plus"}, {24, "10_plus"}, {25, "25_plus"}, {49, "25_plus"}, {50, "50_plus"}} {
		t.Run(fmt.Sprint(tc.count), func(t *testing.T) {
			for received < tc.count {
				candidate, cv := uuid.New(), uuid.New()
				candidates = append(candidates, candidate)
				exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'candidate-private-sentinel','candidate')`, candidate, uuid.NewString(), uuid.NewString()+"@example.test")
				exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, candidate, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
				// Every fixture is discarded: counting only active participations must fail.
				exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,previous_stage_id,reason_group,reason_code,comment,discarded_at) VALUES($1,$2,$3,$4,$5,'[]','[]','organic',$6,'candidate','unresponsive','discard-internal-sentinel',now())`, uuid.New(), id, candidate, uuid.New(), cv, uuid.New())
				received++
			}
			check(tc.want, 2)
		})
	}
	// Questionnaire edits on published saves update the projection in that transaction.
	for _, count := range []int{1, 0} {
		publicFlowPatch(t, h, id, owner, map[string]any{"screening_questions": questions[:count]})
		check("50_plus", count)
		var projected int
		var current bool
		if err := h.pool.QueryRow(ctx, `SELECT p.screening_questions,p.source_draft_version=d.version FROM vacancy_public_projections p JOIN job_drafts d USING(id) WHERE p.id=$1`, id).Scan(&projected, &current); err != nil || projected != count || !current {
			t.Fatal("stale count/version", projected, current, err)
		}
	}
	exec(`UPDATE companies SET logo_url='/relative.png' WHERE id=$1`, company.companyID)
	for _, job := range []string{id, legacy} {
		if publicFlowGet(t, h, "/v2/jobs/"+job, 200)["company"].(map[string]any)["logo_url"] != nil {
			t.Fatal("unsafe logo exposed")
		}
	}
	var stored string
	if err := h.pool.QueryRow(ctx, `SELECT logo_url FROM companies WHERE id=$1`, company.companyID).Scan(&stored); err != nil || stored != "/relative.png" {
		t.Fatal("public sanitization rewrote company", err)
	}
}
