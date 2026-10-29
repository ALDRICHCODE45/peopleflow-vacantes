//go:build integration

package main

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
	"github.com/google/uuid"
)

type assessmentFixture struct {
	invitationFixture
	iid, public, account, session string
}

func assessmentSetup(t *testing.T) assessmentFixture {
	t.Helper()
	f := invitationSetup(t)
	f.enable(t, 7)
	i := invitationObject(t, f.h.do(t, "POST", f.send, "", f.actor.token, nil), 201)
	iid := i["id"].(string)
	link := invitationObject(t, f.h.do(t, "POST", f.base+"/psychometric-invitations/"+iid+"/link", "", f.actor.token, nil), 200)
	var sub string
	if err := f.h.pool.QueryRow(context.Background(), `SELECT u.cognito_sub FROM users u JOIN process_participations p ON p.candidate_id=u.id WHERE p.id=$1`, f.pid).Scan(&sub); err != nil {
		t.Fatal(err)
	}
	return assessmentFixture{f, iid, "/v2/assessments/" + link["token"].(string), "/v2/me/assessments/" + iid, f.h.signer.validToken(t, sub)}
}
func assessmentHeaders(t *testing.T, r draftFlowResponse) {
	t.Helper()
	draftFlowAssertNoStore(t, r)
	if r.header.Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("missing referrer policy: %v", r.header)
	}
}
func (f assessmentFixture) snapshot(t *testing.T) string {
	t.Helper()
	var s string
	err := f.h.pool.QueryRow(context.Background(), `SELECT json_build_array((SELECT row_to_json(i) FROM psychometric_invitations i WHERE id=$1),(SELECT json_agg(c) FROM psychometric_consents c WHERE invitation_id=$1),(SELECT json_agg(a ORDER BY position) FROM psychometric_answers a WHERE invitation_id=$1),(SELECT json_agg(e ORDER BY server_sequence) FROM psychometric_answer_events e WHERE invitation_id=$1),(SELECT json_agg(a ORDER BY id) FROM audit_events a WHERE entity_id=$1))::text`, f.iid).Scan(&s)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func noticeBody(t *testing.T) string {
	t.Helper()
	a, e := content.Load(content.Version)
	if e != nil {
		t.Fatal(e)
	}
	n := a.Snapshot().Notice
	return fmt.Sprintf(`{"notice_version":%q,"text_sha256":%q}`, n.Version, n.SHA256)
}
func (f assessmentFixture) reject(t *testing.T, method, path, body, session string, status int, code, message string) {
	t.Helper()
	before := f.snapshot(t)
	r := f.h.do(t, method, path, body, session, nil)
	assessmentHeaders(t, r)
	want := fmt.Sprintf("{\"error\":%q,\"code\":%q}\n", message, code)
	if r.status != status || string(r.body) != want {
		t.Fatalf("%s %s: %d %s want %d %s", method, path, r.status, r.body, status, want)
	}
	if before != f.snapshot(t) {
		t.Fatal("rejected request changed state")
	}
}
func TestPsychometricCandidateReadConsentItems(t *testing.T) {
	f := assessmentSetup(t)
	a, _ := content.Load(content.Version)
	d := a.Snapshot()
	public := f.h.do(t, "GET", f.public, "", "", nil)
	assessmentHeaders(t, public)
	if public.status != 200 {
		t.Fatalf("%d %s", public.status, public.body)
	}
	m := draftFlowObject(t, public.body)
	var company, title string
	if err := f.h.pool.QueryRow(context.Background(), `SELECT c.name,v.title FROM vacancy_public_projections v JOIN companies c ON c.id=v.company_id WHERE v.id=$1`, f.id).Scan(&company, &title); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"company_name": company, "vacancy_title": title, "estimated_minutes": float64(10), "status": "created", "answered_count": float64(0), "total_count": float64(63), "expires_at": m["expires_at"], "consent": map[string]any{"notice_version": d.Notice.Version, "text": d.Notice.Text, "text_sha256": d.Notice.SHA256}}
	if !reflect.DeepEqual(m, want) {
		t.Fatalf("%v != %v", m, want)
	}
	account := f.h.do(t, "GET", f.account, "", f.session, nil)
	assessmentHeaders(t, account)
	if account.status != 200 || !reflect.DeepEqual(draftFlowObject(t, account.body), want) {
		t.Fatal(string(account.body))
	}
	for _, p := range []struct{ base, session string }{{f.public, ""}, {f.account, f.session}} {
		f.reject(t, "GET", p.base+"/items", "", p.session, 403, "consent_required", "psychometric consent required")
		f.reject(t, "PUT", p.base+"/answers/1", fmt.Sprintf(`{"event_id":%q,"value":3}`, uuid.NewString()), p.session, 403, "consent_required", "psychometric consent required")
		f.reject(t, "POST", p.base+"/consent", `{"notice_version":"wrong","text_sha256":"wrong"}`, p.session, 409, "notice_changed", "psychometric notice changed")
	}
	r := f.h.do(t, "POST", f.public+"/consent", noticeBody(t), "", nil)
	assessmentHeaders(t, r)
	if r.status != 204 || len(r.body) != 0 {
		t.Fatal(r.status, string(r.body))
	}
	before := f.snapshot(t)
	r = f.h.do(t, "POST", f.account+"/consent", noticeBody(t), f.session, nil)
	if r.status != 204 || before != f.snapshot(t) {
		t.Fatal("consent retry not a no-op")
	}
	var actor string
	var metadata map[string]string
	var n int
	if err := f.h.pool.QueryRow(context.Background(), `SELECT actor_type,metadata FROM audit_events WHERE entity_id=$1 AND event_type='PsychometricConsentGiven'`, f.iid).Scan(&actor, &metadata); err != nil || actor != "system" || len(metadata) != 2 {
		t.Fatal(actor, metadata, err)
	}
	if err := f.h.pool.QueryRow(context.Background(), `SELECT count(*) FROM psychometric_consents WHERE invitation_id=$1 AND notice_version=$2 AND text_sha256=$3`, f.iid, d.Notice.Version, d.Notice.SHA256).Scan(&n); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	r = f.h.do(t, "GET", f.account, "", f.session, nil)
	m = draftFlowObject(t, r.body)
	if m["consent"] != nil || m["status"] != "in_progress" {
		t.Fatal(m)
	}
	texts := map[string]string{}
	for _, i := range d.Items {
		texts[i.ID] = i.Text
	}
	for _, i := range d.Attention {
		texts[i.ID] = i.Text
	}
	r = f.h.do(t, "GET", f.public+"/items", "", "", nil)
	assessmentHeaders(t, r)
	if r.status != 200 {
		t.Fatal(r.status, string(r.body))
	}
	m = draftFlowObject(t, r.body)
	items := []any{}
	for _, p := range d.Order {
		items = append(items, map[string]any{"position": float64(p.Position), "text": texts[p.ID], "value": nil})
	}
	scale := []any{}
	for _, o := range d.Scale {
		scale = append(scale, map[string]any{"value": float64(o.Value), "label": o.Label})
	}
	if !reflect.DeepEqual(m, map[string]any{"scale": scale, "items": items}) {
		t.Fatal("unsafe or incorrect item projection", m)
	}
}
func TestPsychometricCandidateAnswersReplayAndConcurrency(t *testing.T) {
	f := assessmentSetup(t)
	r := f.h.do(t, "POST", f.account+"/consent", noticeBody(t), f.session, nil)
	if r.status != 204 {
		t.Fatal(r.status)
	}
	event := uuid.NewString()
	write := func(method, body string) {
		t.Helper()
		r := f.h.do(t, method, f.public+"/answers/1", body, "", nil)
		assessmentHeaders(t, r)
		if r.status != 204 || len(r.body) != 0 {
			t.Fatal(r.status, string(r.body))
		}
	}
	write("PUT", fmt.Sprintf(`{"event_id":%q,"value":2,"client_elapsed_ms":0}`, event))
	before := f.snapshot(t)
	write("PUT", fmt.Sprintf(`{"event_id":%q,"value":5,"client_elapsed_ms":999}`, event))
	if before != f.snapshot(t) {
		t.Fatal("replay changed data")
	}
	for _, b := range []string{`{"value":4,"client_elapsed_ms":3600000}`, `{"value":4,"client_elapsed_ms":4200}`} {
		write("PUT", `{"event_id":"`+uuid.NewString()+`",`+b[1:])
	}
	write("DELETE", fmt.Sprintf(`{"event_id":%q}`, uuid.NewString()))
	write("DELETE", fmt.Sprintf(`{"event_id":%q}`, uuid.NewString()))
	write("PUT", fmt.Sprintf(`{"event_id":%q,"value":3}`, uuid.NewString()))
	r = f.h.do(t, "GET", f.account+"/items", "", f.session, nil)
	items := draftFlowObject(t, r.body)["items"].([]any)
	if items[0].(map[string]any)["value"] != float64(3) {
		t.Fatal(items[0])
	}
	var count int
	var elapsed *int64
	if err := f.h.pool.QueryRow(context.Background(), `SELECT i.answered_count,a.client_elapsed_ms FROM psychometric_invitations i JOIN psychometric_answers a ON a.invitation_id=i.id WHERE i.id=$1 AND a.position=1`, f.iid).Scan(&count, &elapsed); err != nil || count != 1 || elapsed != nil {
		t.Fatal(count, elapsed, err)
	}
	start := make(chan struct{})
	results := make(chan draftFlowResponse, 2)
	var wg sync.WaitGroup
	for _, v := range []int{1, 5} {
		wg.Add(1)
		go func(v int) {
			defer wg.Done()
			<-start
			results <- f.h.do(t, "PUT", f.public+"/answers/1", fmt.Sprintf(`{"event_id":%q,"value":%d}`, uuid.NewString(), v), "", nil)
		}(v)
	}
	close(start)
	wg.Wait()
	close(results)
	for r := range results {
		if r.status != 204 {
			t.Fatal(r.status, string(r.body))
		}
	}
	var final, last int
	if err := f.h.pool.QueryRow(context.Background(), `SELECT a.value,(SELECT value FROM psychometric_answer_events WHERE invitation_id=$1 ORDER BY server_sequence DESC LIMIT 1) FROM psychometric_answers a WHERE invitation_id=$1 AND position=1`, f.iid).Scan(&final, &last); err != nil || final != last {
		t.Fatal(final, last, err)
	}
}
func TestPsychometricCandidateValidationAndClosed(t *testing.T) {
	f := assessmentSetup(t)
	r := f.h.do(t, "POST", f.public+"/consent", noticeBody(t), "", nil)
	if r.status != 204 {
		t.Fatal(r.status)
	}
	for _, tc := range []struct{ method, body, field, code string }{
		{"PUT", `{"value":3}`, "event_id", "required"}, {"PUT", `{"event_id":"bad","value":3}`, "event_id", "invalid"},
		{"PUT", `{"event_id":"%s"}`, "value", "required"}, {"PUT", `{"event_id":"%s","value":0}`, "value", "invalid"}, {"PUT", `{"event_id":"%s","value":6}`, "value", "invalid"}, {"PUT", `{"event_id":"%s","value":1.5}`, "value", "invalid"},
		{"PUT", `{"event_id":"%s","value":3,"client_elapsed_ms":-1}`, "client_elapsed_ms", "invalid"}, {"PUT", `{"event_id":"%s","value":3,"client_elapsed_ms":3600001}`, "client_elapsed_ms", "invalid"},
		{"PUT", `{"event_id":"%s","value":3,"client_elapsed_ms":null}`, "client_elapsed_ms", "invalid"}, {"PUT", `{"event_id":"%s","value":3,"changes":2}`, "changes", "not_allowed"},
		{"DELETE", `{}`, "event_id", "required"}, {"DELETE", `{"event_id":"%s","value":3}`, "value", "not_allowed"},
	} {
		t.Run(tc.method+tc.field+tc.code+tc.body, func(t *testing.T) {
			before := f.snapshot(t)
			body := strings.ReplaceAll(tc.body, "%s", uuid.NewString())
			r := f.h.do(t, tc.method, f.public+"/answers/1", body, "", nil)
			assessmentHeaders(t, r)
			want := fmt.Sprintf("{\"error\":\"validation failed\",\"code\":\"validation_error\",\"fields\":[{\"field\":%q,\"code\":%q}]}\n", tc.field, tc.code)
			if r.status != 400 || string(r.body) != want || before != f.snapshot(t) {
				t.Fatalf("%d %s want %s", r.status, r.body, want)
			}
		})
	}
	for _, pos := range []string{"0", "64", "bad"} {
		f.reject(t, "PUT", f.public+"/answers/"+pos, fmt.Sprintf(`{"event_id":%q,"value":3}`, uuid.NewString()), "", 404, "not_found", "not found")
	}
	for _, state := range []string{"finished", "expired", "revoked"} {
		q := map[string]string{"finished": `UPDATE psychometric_invitations SET finished_at=created_at WHERE id=$1`, "expired": `UPDATE psychometric_invitations SET expires_at=created_at WHERE id=$1`, "revoked": `UPDATE psychometric_invitations SET revoked_at=created_at WHERE id=$1`}[state]
		if _, err := f.h.pool.Exec(context.Background(), q, f.iid); err != nil {
			t.Fatal(err)
		}
		code, msg := "invitation_closed", "psychometric invitation closed"
		if state == "finished" {
			code, msg = "assessment_finished", "psychometric assessment finished"
		}
		for _, method := range []string{"PUT", "DELETE"} {
			body := fmt.Sprintf(`{"event_id":%q`, uuid.NewString())
			if method == "PUT" {
				body += `,"value":3`
			}
			body += "}"
			f.reject(t, method, f.account+"/answers/1", body, f.session, 409, code, msg)
		}
		f.reject(t, "POST", f.account+"/consent", noticeBody(t), f.session, 409, code, msg)
		if _, err := f.h.pool.Exec(context.Background(), `UPDATE psychometric_invitations SET finished_at=NULL,revoked_at=NULL,expires_at=created_at+interval '7 days' WHERE id=$1`, f.iid); err != nil {
			t.Fatal(err)
		}
	}
}
func TestPsychometricCandidateIdenticalUnavailable(t *testing.T) {
	f := assessmentSetup(t)
	for _, suffix := range []string{"", "/items", "/consent", "/answers/1"} {
		method := "GET"
		body := ""
		if suffix == "/consent" {
			method = "POST"
			body = noticeBody(t)
		}
		if suffix == "/answers/1" {
			method = "PUT"
			body = fmt.Sprintf(`{"event_id":%q,"value":3}`, uuid.NewString())
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
			}
			before := f.snapshot(t)
			r := f.h.do(t, method, path+suffix, body, "", nil)
			assessmentHeaders(t, r)
			if r.status != 404 || string(r.body) != "{\"error\":\"psychometric assessment unavailable\",\"code\":\"assessment_unavailable\"}\n" || before != f.snapshot(t) {
				t.Fatal(r.status, string(r.body))
			}
			// Date is transport-generated; all application/transport headers otherwise match.
			r.header.Del("Date")
			if i == 0 {
				first = r
			} else if !reflect.DeepEqual(first, r) {
				t.Fatalf("distinguishable 404: %v %v", first, r)
			}
		}
		if _, err := f.h.pool.Exec(context.Background(), `UPDATE psychometric_invitations SET revoked_at=NULL,expires_at=created_at+interval '7 days' WHERE id=$1`, f.iid); err != nil {
			t.Fatal(err)
		}
	}
}
func TestPsychometricCandidateAccountListAndOwnership(t *testing.T) {
	f := assessmentSetup(t)
	other := assessmentSetup(t)
	f.reject(t, "GET", f.account, "", other.session, 404, "not_found", "not found")
	r := f.h.do(t, "GET", "/v2/me/assessments", "", f.session, nil)
	assessmentHeaders(t, r)
	if r.status != 200 {
		t.Fatal(r.status, string(r.body))
	}
	items := draftFlowObject(t, r.body)["items"].([]any)
	if len(items) != 1 {
		t.Fatal(items)
	}
	item := items[0].(map[string]any)
	detail := draftFlowObject(t, f.h.do(t, "GET", f.account, "", f.session, nil).body)
	var companyID string
	if err := f.h.pool.QueryRow(context.Background(), `SELECT company_id FROM vacancy_processes WHERE id=$1`, f.id).Scan(&companyID); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"id": f.iid, "application_id": f.pid, "vacancy": map[string]any{"id": f.id, "title": detail["vacancy_title"]}, "company": map[string]any{"id": companyID, "name": detail["company_name"]}, "status": "created", "created_at": item["created_at"], "expires_at": detail["expires_at"], "finished_at": nil, "answered_count": float64(0), "total_count": float64(63), "estimated_minutes": float64(10)}
	if !reflect.DeepEqual(item, want) {
		t.Fatalf("%v != %v", item, want)
	}
	f.reject(t, "GET", f.account, "", "", 401, "unauthenticated", "unauthorized")
	f.reject(t, "GET", f.account, "", f.actor.token, 403, "wrong_role", "candidate role required")
}
