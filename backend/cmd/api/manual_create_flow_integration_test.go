//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"os"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	cvstorage "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/storage"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// Uses the production router, real authorization, store, CV inspector and disk
// adapter. The existing harness requires an explicitly isolated draft_test DB.
func TestManualCreateHTTPFlow(t *testing.T) {
	if testing.Short() {
		t.Skip("isolated database integration")
	}
	root := t.TempDir()
	local, err := cvstorage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = local.Close() })
	h := newDraftFlowHarness(t, local)
	company, actorID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, actorID, sub)
	id := publicationFlowReady(t, h, actor)
	publicFlowPublish(t, h, id, actor)
	ctx := context.Background()
	tag, err := h.pool.Exec(ctx, `INSERT INTO geo_countries(code,name_es,name_en) VALUES('US','Estados Unidos','United States') ON CONFLICT DO NOTHING`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, q := range []string{
			`DELETE FROM audit_events WHERE entity_id IN (SELECT p.id FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE vp.company_id=$1)`,
			`DELETE FROM participation_stage_history WHERE participation_id IN (SELECT p.id FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE vp.company_id=$1)`,
			`DELETE FROM process_participations WHERE process_id IN (SELECT id FROM vacancy_processes WHERE company_id=$1)`,
			`DELETE FROM company_candidate_cvs WHERE company_id=$1`,
			`DELETE FROM company_candidate_languages WHERE company_candidate_id IN (SELECT id FROM company_candidates WHERE company_id=$1)`,
			`DELETE FROM company_candidates WHERE company_id=$1`,
		} {
			if _, err := h.pool.Exec(ctx, q, company.companyID); err != nil {
				t.Error(err)
			}
		}
		if tag.RowsAffected() == 1 {
			if _, err := h.pool.Exec(ctx, `DELETE FROM geo_countries WHERE code='US'`); err != nil {
				t.Error(err)
			}
		}
	})
	base := draftFlowV2Path + "/" + id
	// publicationFlowReady configures stage 3 as the delivery cutoff.
	stage := pipelineconfig.Defaults(uuid.MustParse(id)).Stages[3].ID
	data := fmt.Sprintf(`{"stage_id":%q,"existing":null,"confirmed_distinct":false,"candidate":{"full_name":"Manual Candidate","education_level":"bachelor","email":"manual-http@example.test","phone":null,"residence":{"country":"US"}}}`, stage)
	cv := []byte("%PDF-1 manual HTTP upload")
	post := func(data string, content []byte, key string) draftFlowResponse {
		t.Helper()
		var b bytes.Buffer
		m := multipart.NewWriter(&b)
		p, err := m.CreateFormField("data")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = p.Write([]byte(data)); err != nil {
			t.Fatal(err)
		}
		p, err = m.CreateFormFile("cv", "resume.pdf")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = p.Write(content); err != nil {
			t.Fatal(err)
		}
		if err = m.Close(); err != nil {
			t.Fatal(err)
		}
		out := h.do(t, "POST", base+"/pipeline/candidates/manual", b.String(), actor.token, map[string]string{"Idempotency-Key": key, "Content-Type": m.FormDataContentType()})
		draftFlowAssertNoStore(t, out)
		return out
	}
	snapshot := func() string {
		t.Helper()
		var out string
		err := h.pool.QueryRow(ctx, `SELECT jsonb_build_array(
          (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM company_candidates c WHERE company_id=$1),
          (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM company_candidate_cvs c WHERE company_id=$1),
          (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM process_participations p WHERE process_id=$2),
          (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM participation_stage_history h WHERE participation_id IN (SELECT id FROM process_participations WHERE process_id=$2)),
          (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM job_draft_idempotency i WHERE company_id=$1),
          (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_events a WHERE actor_id=$3),
          (SELECT to_jsonb(p) FROM vacancy_processes p WHERE id=$2))::text`, company.companyID, id, actorID).Scan(&out)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	before := snapshot()
	// Reject before any disk write or intake row exists.
	assertNoIntakes := func() {
		t.Helper()
		files, err := os.ReadDir(root)
		if err != nil || len(files) != 0 {
			t.Fatal(files, err)
		}
		if snapshot() != before {
			t.Fatal("rejection changed rows, history, audit, replay or counters")
		}
	}
	mismatch := post(data, []byte("not PDF"), uuid.NewString())
	if mismatch.status != 400 || draftFlowCatalogCode(t, mismatch.body) != "cv_content_mismatch" || len(draftFlowObject(t, mismatch.body)) != 2 {
		t.Fatal(mismatch.status, string(mismatch.body))
	}
	assertNoIntakes()
	invalid := post(fmt.Sprintf(`{"stage_id":%q,"existing":null,"confirmed_distinct":false,"candidate":null}`, stage), cv, uuid.NewString())
	fields := draftFlowObject(t, invalid.body)["fields"]
	wantFields := []any{map[string]any{"field": "candidate", "code": "required"}}
	gotFields, _ := json.Marshal(fields)
	expectedFields, _ := json.Marshal(wantFields)
	if invalid.status != 400 || draftFlowCatalogCode(t, invalid.body) != "validation_error" || !bytes.Equal(gotFields, expectedFields) {
		t.Fatal(invalid.status, string(invalid.body))
	}
	assertNoIntakes()
	key := uuid.NewString()
	created := post(data, cv, key)
	if created.status != 201 || created.header.Get("Idempotency-Replayed") != "false" {
		t.Fatal(created.status, string(created.body))
	}
	var item app.ManualCreatedBody
	if err := json.Unmarshal(created.body, &item); err != nil {
		t.Fatal(err)
	}
	if created.header.Get("ETag") != item.ETag || item.Source != "manual" || item.AddedBy == nil || item.AddedBy.ID != actorID || item.Candidate.Kind != "manual" {
		t.Fatal(string(created.body))
	}
	boardResponse := h.do(t, "GET", base+"/board", "", actor.token, nil)
	if boardResponse.status != 200 {
		t.Fatal(boardResponse.status, string(boardResponse.body))
	}
	var board app.Board
	if err := json.Unmarshal(boardResponse.body, &board); err != nil {
		t.Fatal(err)
	}
	if len(board.Participations) != 1 || board.Delivery.Delivered != 1 || board.Coverage.Covered != 0 || board.Coverage.Required == nil || *board.Coverage.Required != 2 {
		t.Fatal(string(boardResponse.body))
	}
	expected, err := json.Marshal(app.ManualCreatedBody{Item: board.Participations[0], Coverage: board.Coverage, Delivery: board.Delivery})
	if err != nil || !bytes.Equal(expected, created.body) {
		t.Fatalf("201 differs from GET: %s / %s (%v)", created.body, expected, err)
	}
	before = snapshot()
	replay := post(data, cv, key)
	if replay.status != 201 || replay.header.Get("Idempotency-Replayed") != "true" || replay.header.Get("ETag") != created.header.Get("ETag") || !bytes.Equal(replay.body, created.body) {
		t.Fatal(replay.status, string(replay.body), replay.header)
	}
	if snapshot() != before {
		t.Fatal("replay changed stored state")
	}
	download := h.do(t, "GET", base+"/participations/"+item.ID.String()+"/cv", "", actor.token, nil)
	draftFlowAssertNoStore(t, download)
	if download.status != 200 || download.header.Get("Content-Type") != "application/pdf" || !bytes.Equal(download.body, cv) {
		t.Fatal(download.status, string(download.body))
	}
	warning := post(data, cv, uuid.NewString())
	if warning.status != 409 || draftFlowCatalogCode(t, warning.body) != "possible_duplicates" {
		t.Fatal(warning.status, string(warning.body))
	}
	if snapshot() != before {
		t.Fatal("duplicate warning changed stored state")
	}
	matches := draftFlowObject(t, warning.body)["data"].(map[string]any)["matches"].([]any)
	if len(matches) != 1 {
		t.Fatal(string(warning.body))
	}
	files, err := os.ReadDir(root)
	if err != nil || len(files) != 1 {
		t.Fatal(files, err)
	}
	var distinct map[string]any
	if err := json.Unmarshal([]byte(data), &distinct); err != nil {
		t.Fatal(err)
	}
	distinct["confirmed_distinct"] = true
	raw, err := json.Marshal(distinct)
	if err != nil {
		t.Fatal(err)
	}
	confirmed := post(string(raw), cv, uuid.NewString())
	if confirmed.status != 201 {
		t.Fatal(confirmed.status, string(confirmed.body))
	}
	files, err = os.ReadDir(root)
	if err != nil || len(files) != 2 {
		t.Fatal(files, err)
	}
}
