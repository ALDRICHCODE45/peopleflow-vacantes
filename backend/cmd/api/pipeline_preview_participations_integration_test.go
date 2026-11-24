//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"sort"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres/audittest"
	"github.com/google/uuid"
)

// Bugfix pipeline-preview-500 (odd/tasks/pipeline-preview-500.md S1-S2): on a
// published vacancy whose board holds company-added (manual) candidates in
// new/screening/placement, a discarded one and a Placement departure
// (did_not_hold credit), preview of a rename, an add and a reorder answers its
// contract (docs/pipeline-column-editing.md), never 500, and writes nothing; the
// confirmed PUT applies the same impact. Observed through the production router.

func pipelinePreviewManual(t *testing.T, d *departureFlow, name, stage string) string {
	t.Helper()
	data := fmt.Sprintf(`{"stage_id":%q,"existing":null,"confirmed_distinct":false,"candidate":{"full_name":%q,"education":[{"level":"bachelor","institution":null,"field":null,"status":"completed","start_year":null,"end_year":null}],"years_of_experience":"1.5","seniority":"junior","languages":[{"code":"es","level":"native"}],"email":"preview-%s@example.test","phone":null,"residence":{"country":"US"}}}`, stage, name, uuid.NewString())
	var b bytes.Buffer
	m := multipart.NewWriter(&b)
	p, _ := m.CreateFormField("data")
	_, _ = p.Write([]byte(data))
	p, _ = m.CreateFormFile("cv", "resume.pdf")
	_, _ = p.Write([]byte("%PDF-1 preview"))
	_ = m.Close()
	r := d.h.do(t, "POST", d.base+"/pipeline/candidates/manual", b.String(), d.owner.token, map[string]string{"Idempotency-Key": uuid.NewString(), "Content-Type": m.FormDataContentType()})
	if r.status != 201 {
		t.Fatalf("manual create: %d %s", r.status, r.body)
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(r.body, &created); err != nil || created.ID == "" {
		t.Fatalf("manual create body: %v %s", err, r.body)
	}
	return created.ID
}

func pipelinePreviewPost(t *testing.T, d *departureFlow, pid, op, body string) {
	t.Helper()
	path := d.base + "/participations/" + pid
	tag := draftFlowObject(t, boardCorrectionRead(t, d.candidateCVFixture, path, d.owner).body)["etag"].(string)
	if r := d.h.do(t, "POST", path+"/"+op, body, d.owner.token, map[string]string{"If-Match": tag}); r.status != 200 {
		t.Fatalf("%s %s: %d %s", op, pid, r.status, r.body)
	}
}

func pipelinePreviewIDs(t *testing.T, root map[string]any, key string) []string {
	t.Helper()
	out := []string{}
	for _, raw := range root[key].([]any) {
		item := raw.(map[string]any)
		candidate := item["candidate"].(map[string]any)
		if candidate["id"] == "" || candidate["full_name"] == "" || candidate["id"] == nil || candidate["full_name"] == nil {
			t.Fatalf("%s candidate is incomplete: %v", key, item)
		}
		out = append(out, item["participation_id"].(string)+"@"+item["stage_id"].(string))
	}
	sort.Strings(out)
	return out
}

// pipelinePreviewCleanup removes the extra manual candidates before the fixture's
// own cleanup (t.Cleanup is LIFO) so the vacancy and company can be deleted.
func pipelinePreviewCleanup(t *testing.T, d *departureFlow) {
	t.Cleanup(func() {
		ctx := context.Background()
		vacancy := d.base[len(draftFlowV2Path)+1:]
		var candidates []uuid.UUID
		if err := d.h.pool.QueryRow(ctx, `SELECT coalesce(array_agg(company_candidate_id),'{}') FROM process_participations WHERE process_id=$1 AND id<>$2 AND company_candidate_id IS NOT NULL`, vacancy, d.pid).Scan(&candidates); err != nil {
			t.Error(err)
		}
		others := `SELECT id FROM process_participations WHERE process_id=$1 AND id<>$2`
		if err := audittest.Delete(ctx, d.h.pool, `DELETE FROM audit_events WHERE entity_id IN (`+others+`)`, vacancy, d.pid); err != nil {
			t.Error(err)
		}
		for _, q := range []string{
			`DELETE FROM company_candidate_history WHERE participation_id IN (` + others + `)`,
			`DELETE FROM participation_stage_history WHERE participation_id IN (` + others + `)`,
			`DELETE FROM process_participations WHERE id IN (` + others + `)`,
		} {
			if _, err := d.h.pool.Exec(ctx, q, vacancy, d.pid); err != nil {
				t.Error(err)
			}
		}
		for _, q := range []string{
			`DELETE FROM company_candidate_cvs WHERE company_candidate_id=ANY($1)`,
			`DELETE FROM company_candidate_languages WHERE company_candidate_id=ANY($1)`,
			`DELETE FROM company_candidate_educations WHERE company_candidate_id=ANY($1)`,
			`DELETE FROM company_candidates WHERE id=ANY($1)`,
		} {
			if _, err := d.h.pool.Exec(ctx, q, candidates); err != nil {
				t.Error(err)
			}
		}
	})
}

func TestPipelinePreviewAndApplyOnBoardWithManualCandidatesAndDeparture(t *testing.T) {
	d := newDepartureFlow(t)
	pipelinePreviewCleanup(t, d)
	// The fixture inserts its participation directly; give it the intake row a
	// real manual creation writes, so its history matches production data.
	d.exec(t, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,from_stage_id,hire,departure,actor_kind,event_kind) SELECT $1,id,stage_id,$2,created_at,NULL,false,false,'recruiter','intake' FROM process_participations WHERE id=$3`, uuid.New(), d.owner.userID, d.pid)
	// The fixture's own manual candidate reaches Placement and leaves (did_not_hold).
	d.advance("placement")
	if r := d.post("discard", `{"reason":`+departureDiscardReasonCandidate+`,"placement_exit_reason":"candidate_left"}`); r.status != 200 {
		t.Fatalf("departure: %d %s", r.status, r.body)
	}
	if _, status, _ := d.credit(); status != "did_not_hold" {
		t.Fatal("departure credit", status)
	}
	departed := d.pid.String()
	fresh := pipelinePreviewManual(t, d, "Nueva Persona", d.stage["new"])
	screening := pipelinePreviewManual(t, d, "Persona Screening", d.stage["new"])
	pipelinePreviewPost(t, d, screening, "moves", `{"to_stage_id":"`+d.stage["screening"]+`"}`)
	placed := pipelinePreviewManual(t, d, "Persona Placement", d.stage["new"])
	for _, id := range d.order[1:] {
		pipelinePreviewPost(t, d, placed, "moves", `{"to_stage_id":"`+id+`"}`)
	}
	discarded := pipelinePreviewManual(t, d, "Persona Descartada", d.stage["new"])
	pipelinePreviewPost(t, d, discarded, "discard", `{"reason":`+departureDiscardReasonCandidate+`}`)

	path := d.base + "/pipeline"
	current := d.h.do(t, "GET", path, "", d.owner.token, nil)
	if current.status != 200 {
		t.Fatalf("GET pipeline: %d %s", current.status, current.body)
	}
	c := pipelineFlowConfig(t, current.body)
	rename := c
	rename.Stages = append(rename.Stages[:0:0], c.Stages...)
	rename.Stages[1].Name = "Filtro telefónico"
	reorder := c
	reorder.Stages = append(reorder.Stages[:0:0], c.Stages...)
	reorder.Stages[2], reorder.Stages[3] = reorder.Stages[3], reorder.Stages[2]
	placementRef := `{"id":"` + d.stage["placement"] + `"`
	add := strings.Replace(pipelineFlowBody(t, c), placementRef, `{"name":"Prueba técnica"},`+placementRef, 1)

	before := d.snapshot(true) + pipelineFlowSnapshot(t, d.h, d.base[len(draftFlowV2Path)+1:])
	cases := []struct {
		name, body string
		// Participations positioned after the inserted stage get a not_applicable mark.
		marked []string
	}{
		{"rename", pipelineFlowBody(t, rename), nil},
		{"reorder", pipelineFlowBody(t, reorder), nil},
		{"add", add, []string{departed, placed}},
	}
	var addPreview map[string]any
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := d.h.do(t, "POST", path+"/preview", tc.body, d.owner.token, nil)
			if r.status != 200 {
				t.Fatalf("preview %s: %d %s", tc.name, r.status, r.body)
			}
			if r.header.Get("ETag") != "" {
				t.Fatal("preview emits no ETag")
			}
			root := draftFlowObject(t, r.body)
			if len(root) != 4 || root["stages"] == nil {
				t.Fatalf("preview keys: %s", r.body)
			}
			got := pipelinePreviewIDs(t, root, "not_applicable")
			if len(pipelinePreviewIDs(t, root, "recovery_reassigned")) != 0 {
				t.Fatalf("no stage was removed: %s", r.body)
			}
			if len(got) != len(tc.marked) || root["has_impact"] != (len(tc.marked) > 0) {
				t.Fatalf("impact %s: %s", tc.name, r.body)
			}
			if tc.name == "add" {
				stages := root["stages"].([]any)
				inserted := stages[len(stages)-2].(map[string]any)["id"].(string)
				want := []string{}
				for _, pid := range tc.marked {
					want = append(want, pid+"@"+inserted)
				}
				sort.Strings(want)
				if strings.Join(got, ",") != strings.Join(want, ",") {
					t.Fatalf("not_applicable = %v, want %v", got, want)
				}
				addPreview = root
			}
		})
	}
	if after := d.snapshot(true) + pipelineFlowSnapshot(t, d.h, d.base[len(draftFlowV2Path)+1:]); after != before {
		t.Fatal("preview wrote data")
	}
	if addPreview == nil {
		t.Fatal("add preview did not succeed")
	}

	// Apply: an impactful PUT needs confirmation, then echoes the same impact.
	tag := current.header.Get("ETag")
	unconfirmed := d.h.do(t, "PUT", path, add, d.owner.token, map[string]string{"If-Match": tag})
	draftFlowAssertCatalogError(t, unconfirmed, 409, "impact_confirmation_required")
	confirmed := d.h.do(t, "PUT", path, strings.TrimSuffix(add, "}")+`,"confirm_impact":true}`, d.owner.token, map[string]string{"If-Match": tag})
	if confirmed.status != 200 {
		t.Fatalf("PUT: %d %s", confirmed.status, confirmed.body)
	}
	applied := draftFlowObject(t, confirmed.body)["applied_impact"].(map[string]any)
	if strings.Join(pipelinePreviewIDs(t, applied, "not_applicable"), ",") != strings.Join(pipelinePreviewIDs(t, addPreview, "not_applicable"), ",") {
		t.Fatalf("applied %v differs from preview %v", applied, addPreview)
	}
	if n := draftFlowCount(t, d.h.pool, `SELECT count(*) FROM participation_stage_history h JOIN process_participations p ON p.id=h.participation_id WHERE p.process_id=$1 AND h.event_kind='not_applicable'`, d.base[len(draftFlowV2Path)+1:]); n != 2 {
		t.Fatal("not_applicable history rows", n)
	}
	// A rename after the apply still previews (the marks count as positioned history).
	again := d.h.do(t, "GET", path, "", d.owner.token, nil)
	next := pipelineFlowConfig(t, again.body)
	next.Stages[1].Name = "Otra vez"
	if r := d.h.do(t, "POST", path+"/preview", pipelineFlowBody(t, next), d.owner.token, nil); r.status != 200 {
		t.Fatalf("preview after apply: %d %s", r.status, r.body)
	}
	_ = fresh
	_ = screening
	_ = discarded
}

// A board mixing an organic applicant (users) with a company-added candidate
// (company_candidates) computes impact for both: before the fix the manual
// candidate was dropped from the locked set and its history was attributed to
// the organic participation, so the preview silently under-reported impact.
func TestPipelinePreviewCountsManualCandidatesNextToOrganicOnes(t *testing.T) {
	f := newCandidateCVFixture(t, "organic")
	base, path := boardCorrectionPaths(t, f)
	d := &departureFlow{candidateCVFixture: f, t: t, base: base, path: path, stage: map[string]string{}}
	board := draftFlowObject(t, boardCorrectionRead(t, f, base+"/board", f.owner).body)
	for _, raw := range board["stages"].([]any) {
		s := raw.(map[string]any)
		d.order = append(d.order, s["id"].(string))
		d.stage[s["kind"].(string)] = s["id"].(string)
	}
	pipelinePreviewCleanup(t, d)
	organic := d.pid.String()
	var organicStage string
	if err := d.h.pool.QueryRow(t.Context(), `SELECT stage_id::text FROM process_participations WHERE id=$1`, d.pid).Scan(&organicStage); err != nil {
		t.Fatal(err)
	}
	if organicStage != d.stage["new"] {
		t.Fatalf("organic fixture expected in new, got %s", organicStage)
	}
	manual := pipelinePreviewManual(t, d, "Persona Manual", d.stage["new"])
	for _, id := range d.order[1:4] {
		pipelinePreviewPost(t, d, manual, "moves", `{"to_stage_id":"`+id+`"}`)
	}
	current := d.h.do(t, "GET", base+"/pipeline", "", d.owner.token, nil)
	if current.status != 200 {
		t.Fatalf("GET pipeline: %d %s", current.status, current.body)
	}
	screeningRef := `{"id":"` + d.stage["screening"] + `"`
	add := strings.Replace(pipelineFlowBody(t, pipelineFlowConfig(t, current.body)), screeningRef, `{"name":"Llamada inicial"},`+screeningRef, 1)
	r := d.h.do(t, "POST", base+"/pipeline/preview", add, d.owner.token, nil)
	if r.status != 200 {
		t.Fatalf("preview: %d %s", r.status, r.body)
	}
	root := draftFlowObject(t, r.body)
	inserted := root["stages"].([]any)[1].(map[string]any)["id"].(string)
	items := root["not_applicable"].([]any)
	if len(items) != 1 || root["has_impact"] != true {
		t.Fatalf("only the manual candidate (in En proceso) gets the mark: %s", r.body)
	}
	item := items[0].(map[string]any)
	candidate := item["candidate"].(map[string]any)
	if item["participation_id"] != manual || item["stage_id"] != inserted || candidate["full_name"] != "Persona Manual" || candidate["id"] == nil || candidate["id"] == "" {
		t.Fatalf("manual mark: %v", item)
	}
	_ = organic
}
