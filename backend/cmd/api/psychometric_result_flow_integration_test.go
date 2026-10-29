//go:build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/scoring"
	"github.com/google/uuid"
)

func resultPath(f assessmentFixture) string { return f.base + "/psychometric-invitations/" + f.iid }
func resultKeys(t *testing.T, v map[string]any, keys string) {
	t.Helper()
	got := []string{}
	for k := range v {
		got = append(got, k)
	}
	want := strings.Fields(keys)
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("keys=%v want=%v", got, want)
	}
}
func resultProfile(t *testing.T, f assessmentFixture, confirmed bool) *scoring.Profile {
	t.Helper()
	path := f.base + "/psychometric-profile"
	r := f.h.do(t, "GET", path, "", f.actor.token, nil)
	p := profileBody(t)
	p["enabled"] = false
	p["confirmed"] = confirmed
	e := profileEntry(p)
	e["importance"] = "importance.clave"
	e["desired_band"] = "band.high"
	e["rationale"] = "Seguimiento"
	e["task"] = "Verificar entregas"
	r = f.h.do(t, "PUT", path, profileEncode(t, p), f.actor.token, map[string]string{"If-Match": r.header.Get("ETag")})
	if r.status != 200 {
		t.Fatal(r.status, string(r.body))
	}
	m := draftFlowObject(t, r.body)
	raw, _ := json.Marshal(m["competencies"])
	out := &scoring.Profile{Version: m["version"].(string)}
	if err := json.Unmarshal(raw, &out.Competencies); err != nil {
		t.Fatal(err)
	}
	return out
}
func resultReject(t *testing.T, f assessmentFixture, method, path, token string, status int, code, message string) {
	t.Helper()
	before := finishSnapshot(t, f)
	r := f.h.do(t, method, path, "", token, nil)
	draftFlowAssertNoStore(t, r)
	want := fmt.Sprintf("{\"error\":%q,\"code\":%q}\n", message, code)
	if r.status != status || string(r.body) != want {
		t.Fatalf("%s %s: %d %s want %d %s", method, path, r.status, r.body, status, want)
	}
	if before != finishSnapshot(t, f) {
		t.Fatal("rejection changed retained data or audits")
	}
}
func resultComparison(t *testing.T, m map[string]any) {
	t.Helper()
	resultKeys(t, m, "id profile_version created_at content_version scoring_version competencies focus_areas guide")
	if _, err := uuid.Parse(m["id"].(string)); err != nil {
		t.Fatal(err)
	}
	if m["content_version"] != content.Version || m["scoring_version"] != content.ScoringVersion {
		t.Fatal(m)
	}
	cs := m["competencies"].([]any)
	if len(cs) != 7 {
		t.Fatal(len(cs))
	}
	for _, v := range cs {
		resultKeys(t, v.(map[string]any), "competency_id facet_ids oriented_sums oriented_sum facet_count index band desired_band importance direction fit")
	}
	for _, v := range m["focus_areas"].([]any) {
		f := v.(map[string]any)
		if f["type"] == "focus.quality" {
			resultKeys(t, f, "type competency_id tier signal_ids routed_competency_id")
		} else {
			resultKeys(t, f, "type competency_id observed_band desired_band importance fit profile_version")
		}
	}
	guide := m["guide"].([]any)
	if len(guide) > 8 || len(guide) == 0 {
		t.Fatal(len(guide))
	}
	seen := map[string]bool{}
	for _, v := range guide {
		q := v.(map[string]any)
		resultKeys(t, q, "question_id competency_id text good_answer_checklist observed_band desired_band importance fit selector originating_focus_type signal_ids")
		id := q["question_id"].(string)
		if seen[id] {
			t.Fatal("duplicate question", id)
		}
		seen[id] = true
	}
}
func resultRead(t *testing.T, f assessmentFixture) map[string]any {
	t.Helper()
	r := f.h.do(t, "GET", resultPath(f)+"/result", "", f.actor.token, nil)
	draftFlowAssertNoStore(t, r)
	if r.status != 200 {
		t.Fatalf("result %d %s", r.status, r.body)
	}
	m := draftFlowObject(t, r.body)
	resultKeys(t, m, "invitation_id content_version scoring_version finished_at facets competencies interpretations quality latest_comparison comparisons")
	if m["invitation_id"] != f.iid || m["content_version"] != content.Version || m["scoring_version"] != content.ScoringVersion {
		t.Fatal(m)
	}
	facets := m["facets"].([]any)
	if len(facets) != 15 {
		t.Fatal(len(facets))
	}
	for _, v := range facets {
		x := v.(map[string]any)
		resultKeys(t, x, "facet_id sum band")
		if x["sum"].(float64) < 4 || x["sum"].(float64) > 20 {
			t.Fatal(x)
		}
	}
	cs := m["competencies"].([]any)
	if len(cs) != 7 {
		t.Fatal(len(cs))
	}
	for _, v := range cs {
		resultKeys(t, v.(map[string]any), "competency_id facet_ids oriented_sums oriented_sum facet_count index band")
	}
	is := m["interpretations"].([]any)
	if len(is) != 7 {
		t.Fatal(len(is))
	}
	var stored []byte
	if err := f.h.pool.QueryRow(context.Background(), `SELECT snapshot FROM psychometric_results WHERE invitation_id=$1`, f.iid).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	snapshot := draftFlowObject(t, stored)
	for n, v := range is {
		x := v.(map[string]any)
		resultKeys(t, x, "id competency_id band intro_text work_text strengths_text development_text hypothesis_text")
		original := snapshot["interpretations"].([]any)[n].(map[string]any)
		for _, key := range []string{"id", "competency_id", "band", "work_text", "strengths_text", "development_text"} {
			if x[key] != original[key] {
				t.Fatal("changed stored interpretation", key)
			}
		}
		if x["intro_text"] != original["prepend"] || x["hypothesis_text"] != original["hypothesis"] {
			t.Fatal("lost framing")
		}
	}
	q := m["quality"].(map[string]any)
	resultKeys(t, q, "tier partial signals")
	for _, v := range q["signals"].([]any) {
		s := v.(map[string]any)
		resultKeys(t, s, "id severity counts")
		if s["counts"] != nil {
			keys := map[string]string{"signal.attention": "misses total", "signal.long_string": "run", "signal.fast": "fast_count total", "signal.changes": "value_changes clears reanswers total"}
			resultKeys(t, s["counts"].(map[string]any), keys[s["id"].(string)])
		}
	}
	resultComparison(t, m["latest_comparison"].(map[string]any))
	seen := map[string]bool{}
	for _, v := range m["comparisons"].([]any) {
		c := v.(map[string]any)
		resultKeys(t, c, "id profile_version")
		id := c["id"].(string)
		if seen[id] {
			t.Fatal("duplicate comparison")
		}
		seen[id] = true
	}
	return m
}
func TestPsychometricResultReadAndComparison(t *testing.T) {
	f := assessmentSetup(t)
	finishConsent(t, f)
	in := finishAnswers(t, f)
	finishResponse(t, f.h.do(t, "POST", f.account+"/finish", "", f.session, nil))
	initial := resultRead(t, f)
	history := initial["comparisons"].([]any)
	if len(history) != 1 || initial["latest_comparison"].(map[string]any)["profile_version"] != nil {
		t.Fatal(initial)
	}
	var resultBefore, firstBefore string
	if err := f.h.pool.QueryRow(context.Background(), `SELECT r.snapshot::text,c.snapshot::text FROM psychometric_results r JOIN psychometric_comparisons c ON c.invitation_id=r.invitation_id WHERE r.invitation_id=$1`, f.iid).Scan(&resultBefore, &firstBefore); err != nil {
		t.Fatal(err)
	}
	resultReject(t, f, "POST", resultPath(f)+"/comparisons", f.actor.token, 409, "profile_unconfirmed", "psychometric profile unconfirmed")
	in.Profile = resultProfile(t, f, true)
	// A read after a profile change still returns the identical stored report.
	if got := resultRead(t, f); !reflect.DeepEqual(got, initial) {
		t.Fatal("GET recomputed comparison")
	}
	r := f.h.do(t, "POST", resultPath(f)+"/comparisons", "", f.actor.token, nil)
	draftFlowAssertNoStore(t, r)
	if r.status != 201 {
		t.Fatalf("comparison %d %s", r.status, r.body)
	}
	comparison := draftFlowObject(t, r.body)
	resultComparison(t, comparison)
	artifact, _ := content.Load(content.Version)
	expected, err := scoring.Score(artifact, in)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(expected.Comparison)
	expectedMap := draftFlowObject(t, raw)
	for _, key := range []string{"profile_version", "competencies", "focus_areas"} {
		if !reflect.DeepEqual(comparison[key], expectedMap[key]) {
			t.Fatal("not B2 current profile output", key)
		}
	}
	got := resultRead(t, f)
	if !reflect.DeepEqual(got["latest_comparison"], comparison) {
		t.Fatal("wrong latest")
	}
	wantHistory := append(history, map[string]any{"id": comparison["id"], "profile_version": in.Profile.Version})
	if !reflect.DeepEqual(got["comparisons"], wantHistory) {
		t.Fatal("wrong history order", got["comparisons"])
	}
	for _, key := range []string{"facets", "competencies", "interpretations", "quality", "finished_at"} {
		if !reflect.DeepEqual(got[key], initial[key]) {
			t.Fatal("rewrote result", key)
		}
	}
	var resultAfter, firstAfter, created string
	var profileJSON []byte
	if err = f.h.pool.QueryRow(context.Background(), `SELECT r.snapshot::text,old.snapshot::text,new.snapshot::text,new.profile_snapshot FROM psychometric_results r JOIN psychometric_comparisons old ON old.invitation_id=r.invitation_id AND old.id=$2 JOIN psychometric_comparisons new ON new.invitation_id=r.invitation_id AND new.id=$3 WHERE r.invitation_id=$1`, f.iid, history[0].(map[string]any)["id"], comparison["id"]).Scan(&resultAfter, &firstAfter, &created, &profileJSON); err != nil {
		t.Fatal(err)
	}
	if resultAfter != resultBefore || firstAfter != firstBefore || !reflect.DeepEqual(draftFlowObject(t, []byte(created)), expectedMap) {
		t.Fatal("snapshots changed or incomplete scoring snapshot")
	}
	if draftFlowObject(t, profileJSON)["version"] != in.Profile.Version {
		t.Fatal("missing full profile snapshot")
	}
	var views, creates int
	var metadata map[string]string
	var actor uuid.UUID
	if err = f.h.pool.QueryRow(context.Background(), `SELECT count(*) FILTER(WHERE event_type='PsychometricResultViewed'),count(*) FILTER(WHERE event_type='PsychometricComparisonCreated') FROM audit_events WHERE entity_id=$1 AND actor_id=$2`, f.iid, f.actor.userID).Scan(&views, &creates); err != nil || views != 3 || creates != 1 {
		t.Fatal(views, creates, err)
	}
	if err = f.h.pool.QueryRow(context.Background(), `SELECT actor_id,metadata FROM audit_events WHERE entity_id=$1 AND event_type='PsychometricComparisonCreated'`, f.iid).Scan(&actor, &metadata); err != nil {
		t.Fatal(err)
	}
	wantMetadata := map[string]string{"vacancy_id": f.id, "participation_id": f.pid, "comparison_id": comparison["id"].(string), "profile_version": in.Profile.Version}
	if actor != f.actor.userID || !reflect.DeepEqual(metadata, wantMetadata) {
		t.Fatal(actor, metadata)
	}
}
func TestPsychometricResultGuardsAndRetention(t *testing.T) {
	f := assessmentSetup(t)
	other := assessmentSetup(t)
	for _, method := range []string{"GET", "POST"} {
		suffix := "/result"
		if method == "POST" {
			suffix = "/comparisons"
		}
		path := resultPath(f) + suffix
		resultReject(t, f, method, path, f.actor.token, 404, "not_found", "not found")
		resultReject(t, f, method, path, other.actor.token, 404, "not_found", "not found")
		resultReject(t, f, method, other.base+"/psychometric-invitations/"+f.iid+suffix, other.actor.token, 404, "not_found", "not found")
		resultReject(t, f, method, strings.Replace(path, f.id, uuid.NewString(), 1), f.actor.token, 404, "not_found", "not found")
		resultReject(t, f, method, strings.Replace(path, f.iid, uuid.NewString(), 1), f.actor.token, 404, "not_found", "not found")
		resultReject(t, f, method, path, "", 401, "unauthenticated", "unauthorized")
		resultReject(t, f, method, path, f.session, 403, "forbidden", "not a member of any company")
	}
	finishConsent(t, f)
	finishAnswers(t, f)
	finishResponse(t, f.h.do(t, "POST", f.account+"/finish", "", f.session, nil))
	if _, err := f.h.pool.Exec(context.Background(), `UPDATE psychometric_invitations SET purge_after=clock_timestamp()-interval '1 second' WHERE id=$1`, f.iid); err != nil {
		t.Fatal(err)
	}
	resultReject(t, f, "GET", resultPath(f)+"/result", f.actor.token, 404, "not_found", "not found")
	resultReject(t, f, "POST", resultPath(f)+"/comparisons", f.actor.token, 404, "not_found", "not found")
}
func TestPsychometricResultAuditRollback(t *testing.T) {
	f := assessmentSetup(t)
	finishConsent(t, f)
	finishAnswers(t, f)
	finishResponse(t, f.h.do(t, "POST", f.account+"/finish", "", f.session, nil))
	resultProfile(t, f, true)
	name := "result_audit_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	exec := func(q string) {
		t.Helper()
		if _, err := f.h.pool.Exec(context.Background(), q); err != nil {
			t.Fatal(err)
		}
	}
	allow := func() { exec(`ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS ` + name) }
	t.Cleanup(allow)
	exec(fmt.Sprintf(`ALTER TABLE audit_events ADD CONSTRAINT %s CHECK (event_type NOT IN ('PsychometricResultViewed','PsychometricComparisonCreated') OR entity_id <> '%s'::uuid) NOT VALID`, name, f.iid))
	resultReject(t, f, "GET", resultPath(f)+"/result", f.actor.token, 500, "internal_error", "an internal error occurred")
	resultReject(t, f, "POST", resultPath(f)+"/comparisons", f.actor.token, 500, "internal_error", "an internal error occurred")
	allow()
	resultRead(t, f)
}
func TestPsychometricResultFinishedProcess(t *testing.T) {
	f := assessmentSetup(t)
	finishConsent(t, f)
	finishAnswers(t, f)
	finishResponse(t, f.h.do(t, "POST", f.account+"/finish", "", f.session, nil))
	resultProfile(t, f, true)
	current := f.h.do(t, "GET", f.base+"/lifecycle", "", f.actor.token, nil)
	closed := f.h.do(t, "POST", f.base+"/lifecycle/close", `{"process":"finish","reason":"cancelled","reason_note":null}`, f.actor.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if closed.status != 200 {
		t.Fatal(closed.status, string(closed.body))
	}
	before := finishSnapshot(t, f)
	r := f.h.do(t, "POST", resultPath(f)+"/comparisons", "", f.actor.token, nil)
	draftFlowAssertNoStore(t, r)
	want := map[string]any{"error": "process finished", "code": "process_finished", "data": map[string]any{"lifecycle": draftFlowObject(t, closed.body)}}
	if r.status != 409 || !reflect.DeepEqual(draftFlowObject(t, r.body), want) || before != finishSnapshot(t, f) {
		t.Fatal(r.status, string(r.body))
	}
	resultRead(t, f)
}
