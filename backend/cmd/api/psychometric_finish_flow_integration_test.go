//go:build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/scoring"
	"github.com/google/uuid"
)

func finishSnapshot(t *testing.T, f assessmentFixture) string {
	t.Helper()
	var snapshots string
	err := f.h.pool.QueryRow(context.Background(), `SELECT json_build_array((SELECT row_to_json(r) FROM psychometric_results r WHERE invitation_id=$1),(SELECT json_agg(c ORDER BY created_at,id) FROM psychometric_comparisons c WHERE invitation_id=$1))::text`, f.iid).Scan(&snapshots)
	if err != nil {
		t.Fatal(err)
	}
	return f.snapshot(t) + snapshots
}
func finishConsent(t *testing.T, f assessmentFixture) {
	t.Helper()
	r := f.h.do(t, "POST", f.public+"/consent", noticeBody(t), "", nil)
	assessmentHeaders(t, r)
	if r.status != 204 || len(r.body) != 0 {
		t.Fatal(r.status, string(r.body))
	}
}
func finishAnswer(t *testing.T, f assessmentFixture, in *scoring.Input, position int, value *int, elapsed *int64) string {
	t.Helper()
	id := uuid.NewString()
	method := "DELETE"
	body := fmt.Sprintf(`{"event_id":%q}`, id)
	if value != nil {
		method = "PUT"
		body = fmt.Sprintf(`{"event_id":%q,"value":%d`, id, *value)
		if elapsed != nil {
			body += fmt.Sprintf(`,"client_elapsed_ms":%d`, *elapsed)
		}
		body += "}"
	}
	r := f.h.do(t, method, fmt.Sprintf("%s/answers/%d", f.public, position), body, "", nil)
	assessmentHeaders(t, r)
	if r.status != 204 || len(r.body) != 0 {
		t.Fatal(r.status, string(r.body))
	}
	in.Events = append(in.Events, scoring.AnswerEvent{Position: position, Value: value, ElapsedMS: elapsed})
	if value == nil {
		delete(in.Answers, position)
	} else {
		in.Answers[position] = *value
	}
	return body
}
func finishAnswers(t *testing.T, f assessmentFixture) scoring.Input {
	t.Helper()
	in := scoring.Input{Answers: map[int]int{}}
	for position := 1; position <= 63; position++ {
		v := position%5 + 1
		elapsed := int64(4000 + position)
		finishAnswer(t, f, &in, position, &v, &elapsed)
	}
	return in
}
func finishResponse(t *testing.T, r draftFlowResponse) {
	t.Helper()
	assessmentHeaders(t, r)
	if r.status != 200 || string(r.body) != `{"status":"finished"}` || r.header.Get("Content-Type") != "application/json" {
		t.Fatalf("finish %d %s %v", r.status, r.body, r.header)
	}
}
func finishReject(t *testing.T, f assessmentFixture, path, session string, status int, code, message string) {
	t.Helper()
	before := finishSnapshot(t, f)
	r := f.h.do(t, "POST", path+"/finish", "", session, nil)
	assessmentHeaders(t, r)
	want := fmt.Sprintf("{\"error\":%q,\"code\":%q}\n", message, code)
	if r.status != status || string(r.body) != want || before != finishSnapshot(t, f) {
		t.Fatalf("finish %d %s want %d %s", r.status, r.body, status, want)
	}
}
func TestPsychometricFinishIncompleteUnchanged(t *testing.T) {
	f := assessmentSetup(t)
	finishConsent(t, f)
	in := scoring.Input{Answers: map[int]int{}}
	v := 3
	for _, position := range []int{63, 2, 32} {
		finishAnswer(t, f, &in, position, &v, nil)
	}
	// A deleted answer is missing, regardless of its retained nullable row.
	finishAnswer(t, f, &in, 2, nil, nil)
	missing := []int{}
	for position := 1; position <= 63; position++ {
		if position != 32 && position != 63 {
			missing = append(missing, position)
		}
	}
	data, _ := json.Marshal(missing)
	want := fmt.Sprintf("{\"error\":\"psychometric assessment incomplete\",\"code\":\"incomplete\",\"data\":{\"missing_positions\":%s}}\n", data)
	for _, p := range []struct{ base, session string }{{f.public, ""}, {f.account, f.session}} {
		before := finishSnapshot(t, f)
		r := f.h.do(t, "POST", p.base+"/finish", "", p.session, nil)
		assessmentHeaders(t, r)
		if r.status != 422 || string(r.body) != want || before != finishSnapshot(t, f) {
			t.Fatalf("%d %s want %s", r.status, r.body, want)
		}
	}
}
func TestPsychometricFinishSnapshotAndProfile(t *testing.T) {
	for _, confirmed := range []bool{false, true} {
		t.Run(fmt.Sprint(confirmed), func(t *testing.T) {
			f := assessmentSetup(t)
			finishConsent(t, f)
			in := finishAnswers(t, f)
			// Change the profile after invitation creation and answering. Finish must use
			// this version, independent of enabled (which now becomes false).
			path := f.base + "/psychometric-profile"
			r := f.h.do(t, "GET", path, "", f.actor.token, nil)
			p := profileBody(t)
			p["enabled"] = false
			entry := profileEntry(p)
			entry["importance"] = "importance.clave"
			entry["desired_band"] = "band.high"
			entry["rationale"] = "Seguimiento de acuerdos"
			entry["task"] = "Verificar entregas"
			p["confirmed"] = confirmed
			r = f.h.do(t, "PUT", path, profileEncode(t, p), f.actor.token, map[string]string{"If-Match": r.header.Get("ETag")})
			if r.status != 200 {
				t.Fatal(r.status, string(r.body))
			}
			profileAtFinish := draftFlowObject(t, r.body)
			var pinnedProfile *scoring.Profile
			if confirmed {
				raw, _ := json.Marshal(profileAtFinish["competencies"])
				pinnedProfile = &scoring.Profile{Version: profileAtFinish["version"].(string)}
				if err := json.Unmarshal(raw, &pinnedProfile.Competencies); err != nil {
					t.Fatal(err)
				}
			}
			in.Profile = pinnedProfile
			artifact, _ := content.Load(content.Version)
			want, err := scoring.Score(artifact, in)
			if err != nil {
				t.Fatal(err)
			}
			base, session := f.public, ""
			if !confirmed {
				base, session = f.account, f.session
			}
			started := time.Now()
			finishResponse(t, f.h.do(t, "POST", base+"/finish", "", session, nil))
			var snapshot, comparison, profileJSON []byte
			var finished, comparisonAt, purge time.Time
			var version *string
			var cv, sv string
			var n int
			if err = f.h.pool.QueryRow(context.Background(), `SELECT r.snapshot,r.finished_at,r.content_version,r.scoring_version,c.snapshot,c.profile_snapshot,c.profile_version,c.created_at,i.purge_after FROM psychometric_results r JOIN psychometric_comparisons c ON c.invitation_id=r.invitation_id JOIN psychometric_invitations i ON i.id=r.invitation_id WHERE r.invitation_id=$1`, f.iid).Scan(&snapshot, &finished, &cv, &sv, &comparison, &profileJSON, &version, &comparisonAt, &purge); err != nil {
				t.Fatal(err)
			}
			expected, _ := json.Marshal(want)
			expectedComparison, _ := json.Marshal(want.Comparison)
			if !reflect.DeepEqual(draftFlowObject(t, snapshot), draftFlowObject(t, expected)) || !reflect.DeepEqual(draftFlowObject(t, comparison), draftFlowObject(t, expectedComparison)) {
				t.Fatal("stored snapshots differ from B2 output")
			}
			if cv != content.Version || sv != content.ScoringVersion || finished.Before(started) || finished.After(time.Now()) || !finished.Equal(comparisonAt) {
				t.Fatal("wrong pins/timestamps", cv, sv, finished, comparisonAt)
			}
			var retentionOK bool
			if err = f.h.pool.QueryRow(context.Background(), `SELECT finished_at=$2 AND purge_after=((finished_at AT TIME ZONE 'UTC')+interval '12 months') AT TIME ZONE 'UTC' FROM psychometric_invitations WHERE id=$1`, f.iid, finished).Scan(&retentionOK); err != nil || !retentionOK {
				t.Fatal("wrong finish retention", purge, err)
			}
			if confirmed {
				if version == nil || *version != pinnedProfile.Version || !reflect.DeepEqual(draftFlowObject(t, profileJSON), profileAtFinish) {
					t.Fatal("missing full confirmed profile snapshot")
				}
			} else if version != nil || (len(profileJSON) > 0 && string(profileJSON) != "null") {
				t.Fatal("unconfirmed profile leaked into comparison", version, string(profileJSON))
			}
			var actorType string
			var actor *uuid.UUID
			var metadata map[string]string
			if err = f.h.pool.QueryRow(context.Background(), `SELECT actor_type,actor_id,metadata FROM audit_events WHERE entity_id=$1 AND event_type='PsychometricAssessmentFinished'`, f.iid).Scan(&actorType, &actor, &metadata); err != nil {
				t.Fatal(err)
			}
			wantMetadata := map[string]string{"vacancy_id": f.id, "participation_id": f.pid}
			if !reflect.DeepEqual(metadata, wantMetadata) {
				t.Fatal(metadata)
			}
			if confirmed {
				if actorType != "system" || actor != nil {
					t.Fatal(actorType, actor)
				}
			} else {
				var candidate uuid.UUID
				if err = f.h.pool.QueryRow(context.Background(), `SELECT candidate_id FROM process_participations WHERE id=$1`, f.pid).Scan(&candidate); err != nil || actorType != "user" || actor == nil || *actor != candidate {
					t.Fatal(actorType, actor, err)
				}
			}
			if err = f.h.pool.QueryRow(context.Background(), `SELECT count(*) FROM psychometric_comparisons WHERE invitation_id=$1`, f.iid).Scan(&n); err != nil || n != 1 {
				t.Fatal(n, err)
			}
			before := finishSnapshot(t, f)
			// Subsequent profile edits cannot rewrite result or comparison snapshots.
			f.enable(t, 30)
			if before != finishSnapshot(t, f) {
				t.Fatal("profile save rewrote snapshots")
			}
			for _, p := range []struct{ base, session string }{{f.public, ""}, {f.account, f.session}} {
				finishReject(t, f, p.base, p.session, 409, "assessment_finished", "psychometric assessment finished")
				for _, method := range []string{"PUT", "DELETE"} {
					body := fmt.Sprintf(`{"event_id":%q}`, uuid.NewString())
					if method == "PUT" {
						body = fmt.Sprintf(`{"event_id":%q,"value":1}`, uuid.NewString())
					}
					f.reject(t, method, p.base+"/answers/1", body, p.session, 409, "assessment_finished", "psychometric assessment finished")
				}
				f.reject(t, "POST", p.base+"/consent", noticeBody(t), p.session, 409, "assessment_finished", "psychometric assessment finished")
			}
			if before != finishSnapshot(t, f) {
				t.Fatal("post-finish writes changed snapshots")
			}
			// Existing reads remain status-only and saved item projection stays available.
			r = f.h.do(t, "GET", f.account, "", f.session, nil)
			m := draftFlowObject(t, r.body)
			if r.status != 200 || len(m) != 8 || m["status"] != "finished" || m["answered_count"] != float64(63) || m["consent"] != nil {
				t.Fatal(m)
			}
			r = f.h.do(t, "GET", f.public+"/items", "", "", nil)
			if r.status != 200 || len(draftFlowObject(t, r.body)["items"].([]any)) != 63 {
				t.Fatal(r.status)
			}
		})
	}
}
func TestPsychometricFinishQualityTransitions(t *testing.T) {
	f := assessmentSetup(t)
	finishConsent(t, f)
	in := scoring.Input{Answers: map[int]int{}}
	elapsed := int64(5000)
	v := 2
	body := finishAnswer(t, f, &in, 1, &v, &elapsed)
	r := f.h.do(t, "PUT", f.public+"/answers/1", body, "", nil)
	if r.status != 204 {
		t.Fatal(r.status)
	}
	v = 4
	finishAnswer(t, f, &in, 1, &v, &elapsed)
	finishAnswer(t, f, &in, 1, nil, nil)
	v = 3
	finishAnswer(t, f, &in, 1, &v, &elapsed)
	// Same-value saves and empty deletes are events but not additional changes.
	finishAnswer(t, f, &in, 1, &v, &elapsed)
	for position := 2; position <= 63; position++ {
		value := position%5 + 1
		finishAnswer(t, f, &in, position, &value, &elapsed)
	}
	finishResponse(t, f.h.do(t, "POST", f.public+"/finish", "", "", nil))
	var raw []byte
	if err := f.h.pool.QueryRow(context.Background(), `SELECT snapshot->'quality' FROM psychometric_results WHERE invitation_id=$1`, f.iid).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	quality := draftFlowObject(t, raw)
	found := false
	for _, s := range quality["signals"].([]any) {
		signal := s.(map[string]any)
		if signal["id"] == "signal.changes" {
			found = true
			want := map[string]any{"value_changes": float64(1), "clears": float64(1), "reanswers": float64(1), "total": float64(3)}
			if !reflect.DeepEqual(signal["counts"], want) {
				t.Fatal(signal)
			}
		}
	}
	if !found {
		t.Fatal("missing change signal")
	}
}
func TestPsychometricFinishConcurrentExactlyOnce(t *testing.T) {
	f := assessmentSetup(t)
	finishConsent(t, f)
	finishAnswers(t, f)
	start := make(chan struct{})
	out := make(chan draftFlowResponse, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); <-start; out <- f.h.do(t, "POST", f.public+"/finish", "", "", nil) }()
	}
	close(start)
	wg.Wait()
	close(out)
	statuses := map[int]int{}
	for r := range out {
		assessmentHeaders(t, r)
		statuses[r.status]++
		if r.status == 200 {
			finishResponse(t, r)
		} else if r.status != 409 || string(r.body) != "{\"error\":\"psychometric assessment finished\",\"code\":\"assessment_finished\"}\n" {
			t.Fatal(r.status, string(r.body))
		}
	}
	if statuses[200] != 1 || statuses[409] != 1 {
		t.Fatal(statuses)
	}
	var results, comparisons, audits int
	if err := f.h.pool.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM psychometric_results WHERE invitation_id=$1),(SELECT count(*) FROM psychometric_comparisons WHERE invitation_id=$1),(SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='PsychometricAssessmentFinished')`, f.iid).Scan(&results, &comparisons, &audits); err != nil || results != 1 || comparisons != 1 || audits != 1 {
		t.Fatal(results, comparisons, audits, err)
	}
}
func TestPsychometricFinishAuditFailureRollback(t *testing.T) {
	f := assessmentSetup(t)
	finishConsent(t, f)
	finishAnswers(t, f)
	name := "finish_audit_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	exec := func(q string) {
		t.Helper()
		if _, err := f.h.pool.Exec(context.Background(), q); err != nil {
			t.Fatal(err)
		}
	}
	allow := func() { exec(`ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS ` + name) }
	t.Cleanup(allow)
	exec(fmt.Sprintf(`ALTER TABLE audit_events ADD CONSTRAINT %s CHECK (event_type <> 'PsychometricAssessmentFinished' OR entity_id <> '%s'::uuid) NOT VALID`, name, f.iid))
	finishReject(t, f, f.account, f.session, 500, "internal_error", "an internal error occurred")
	allow()
	finishResponse(t, f.h.do(t, "POST", f.account+"/finish", "", f.session, nil))
}
func TestPsychometricFinishAccessAndConsent(t *testing.T) {
	f := assessmentSetup(t)
	other := assessmentSetup(t)
	finishReject(t, f, f.account, other.session, 404, "not_found", "not found")
	finishReject(t, f, f.account, "", 401, "unauthenticated", "unauthorized")
	for _, p := range []struct{ base, session string }{{f.public, ""}, {f.account, f.session}} {
		finishReject(t, f, p.base, p.session, 403, "consent_required", "psychometric consent required")
	}
	var first draftFlowResponse
	for i, state := range []string{"unknown", "malformed", "revoked", "expired"} {
		path := "/v2/assessments/" + strings.Repeat("A", 43)
		if state == "malformed" {
			path = "/v2/assessments/short"
		}
		if state == "revoked" || state == "expired" {
			path = f.public
			q := `UPDATE psychometric_invitations SET revoked_at=created_at WHERE id=$1`
			if state == "expired" {
				q = `UPDATE psychometric_invitations SET revoked_at=NULL,expires_at=created_at WHERE id=$1`
			}
			if _, err := f.h.pool.Exec(context.Background(), q, f.iid); err != nil {
				t.Fatal(err)
			}
			finishReject(t, f, f.account, f.session, 409, "invitation_closed", "psychometric invitation closed")
		}
		before := finishSnapshot(t, f)
		r := f.h.do(t, "POST", path+"/finish", "", "", nil)
		assessmentHeaders(t, r)
		if r.status != 404 || string(r.body) != "{\"error\":\"psychometric assessment unavailable\",\"code\":\"assessment_unavailable\"}\n" || before != finishSnapshot(t, f) {
			t.Fatal(r.status, string(r.body))
		}
		r.header.Del("Date")
		if i == 0 {
			first = r
		} else if !reflect.DeepEqual(first, r) {
			t.Fatal("distinguishable unavailable finish")
		}
	}
}
