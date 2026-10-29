//go:build integration

package main

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPsychometricCandidateConsentAuditRollbackAndActor(t *testing.T) {
	f := assessmentSetup(t)
	name := "assessment_audit_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	exec := func(q string) {
		t.Helper()
		if _, err := f.h.pool.Exec(context.Background(), q); err != nil {
			t.Fatal(err)
		}
	}
	allow := func() { exec(`ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS ` + name) }
	t.Cleanup(allow)
	exec(fmt.Sprintf(`ALTER TABLE audit_events ADD CONSTRAINT %s CHECK (event_type <> 'PsychometricConsentGiven' OR entity_id <> '%s'::uuid) NOT VALID`, name, f.iid))
	f.reject(t, "POST", f.account+"/consent", noticeBody(t), f.session, 500, "internal_error", "an internal error occurred")
	allow()
	r := f.h.do(t, "POST", f.account+"/consent", noticeBody(t), f.session, nil)
	assessmentHeaders(t, r)
	if r.status != 204 || len(r.body) != 0 {
		t.Fatal(r.status, string(r.body))
	}
	var actorType string
	var actor, owner uuid.UUID
	if err := f.h.pool.QueryRow(context.Background(), `SELECT a.actor_type,a.actor_id,p.candidate_id FROM audit_events a JOIN psychometric_invitations i ON i.id=a.entity_id JOIN process_participations p ON p.id=i.participation_id WHERE a.entity_id=$1 AND a.event_type='PsychometricConsentGiven'`, f.iid).Scan(&actorType, &actor, &owner); err != nil || actorType != "user" || actor != owner {
		t.Fatal(actorType, actor, owner, err)
	}
}

func TestPsychometricCandidateRechecksAfterLockWait(t *testing.T) {
	for _, state := range []string{"expired", "rotated", "revoked", "finished"} {
		t.Run(state, func(t *testing.T) {
			f := assessmentSetup(t)
			r := f.h.do(t, "POST", f.public+"/consent", noticeBody(t), "", nil)
			if r.status != 204 {
				t.Fatal(r.status)
			}
			ctx := context.Background()
			tx, err := f.h.pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			var id uuid.UUID
			if err = tx.QueryRow(ctx, `SELECT id FROM job_drafts WHERE id=$1 FOR UPDATE`, f.id).Scan(&id); err != nil {
				t.Fatal(err)
			}
			done := make(chan draftFlowResponse, 1)
			go func() {
				done <- f.h.do(t, "PUT", f.public+"/answers/1", fmt.Sprintf(`{"event_id":%q,"value":3}`, uuid.NewString()), "", nil)
			}()
			// Observe the writer blocked on our parent lock, not a timing-only sleep.
			deadline := time.Now().Add(5 * time.Second)
			for {
				var waiting bool
				if err = f.h.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM job_drafts WHERE id=$1 FOR UPDATE%')`).Scan(&waiting); err != nil {
					t.Fatal(err)
				}
				if waiting {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("candidate did not wait on parent lock")
				}
				time.Sleep(10 * time.Millisecond)
			}
			q := map[string]string{"expired": `UPDATE psychometric_invitations SET expires_at=created_at WHERE id=$1`, "rotated": `UPDATE psychometric_invitations SET token_hash=decode(repeat('ab',32),'hex') WHERE id=$1`, "revoked": `UPDATE psychometric_invitations SET revoked_at=created_at WHERE id=$1`, "finished": `UPDATE psychometric_invitations SET finished_at=created_at WHERE id=$1`}[state]
			if _, err = tx.Exec(ctx, q, f.iid); err != nil {
				t.Fatal(err)
			}
			if err = tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			// State after the deliberate closure must remain byte-for-byte unchanged.
			before := f.snapshot(t)
			r = <-done
			assessmentHeaders(t, r)
			status, code, message := 404, "assessment_unavailable", "psychometric assessment unavailable"
			if state == "finished" {
				status, code, message = 409, "assessment_finished", "psychometric assessment finished"
			}
			want := fmt.Sprintf("{\"error\":%q,\"code\":%q}\n", message, code)
			if r.status != status || string(r.body) != want || before != f.snapshot(t) {
				t.Fatalf("%d %s want %d %s", r.status, r.body, status, want)
			}
		})
	}
}

func TestPsychometricCandidateListLatestOrderingAndProjection(t *testing.T) {
	f := assessmentSetup(t)
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := f.h.pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	var candidate uuid.UUID
	if err := f.h.pool.QueryRow(ctx, `SELECT candidate_id FROM process_participations WHERE id=$1`, f.pid).Scan(&candidate); err != nil {
		t.Fatal(err)
	}
	// Use distinct test slots on the same participation to isolate both tie-breaks.
	ids := []string{"00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"}
	// UUIDs stay fixture-unique even if this test is run concurrently by another process.
	for i := range ids {
		ids[i] = uuid.NewString()
	}
	if ids[0] > ids[1] {
		ids[0], ids[1] = ids[1], ids[0]
	}
	if ids[2] < ids[3] {
		ids[2], ids[3] = ids[3], ids[2]
	}
	exec(`UPDATE psychometric_invitations SET expires_at=created_at WHERE id=$1`, f.iid)
	replacement := invitationObject(t, f.h.do(t, "POST", f.send, "", f.actor.token, nil), 201)["id"].(string)
	for i, id := range ids {
		exec(`INSERT INTO psychometric_invitations(id,participation_id,test,content_version,scoring_version,total_count,origin,created_at,expires_at,purge_after,revoked_at) VALUES($1,$2,$3,'psychometrics.content.v1','psychometrics.scoring.v1',63,'auto',clock_timestamp()-interval '1 day',date_trunc('day',clock_timestamp())+interval '2 days',clock_timestamp()+interval '12 months',CASE WHEN $4 THEN clock_timestamp() ELSE NULL END)`, id, f.pid, fmt.Sprintf("ordering-%d", i), i >= 2)
	}
	exec(`UPDATE psychometric_invitations SET created_at=date_trunc('day',clock_timestamp())-interval '1 day' WHERE id=ANY($1::uuid[])`, ids)
	exec(`UPDATE vacancy_public_projections SET title='Public assessment title' WHERE id=$1`, f.id)
	r := f.h.do(t, "GET", "/v2/me/assessments", "", f.session, nil)
	assessmentHeaders(t, r)
	if r.status != 200 {
		t.Fatal(r.status, string(r.body))
	}
	items := draftFlowObject(t, r.body)["items"].([]any)
	got := []string{}
	for _, raw := range items {
		item := raw.(map[string]any)
		got = append(got, item["id"].(string))
		if item["vacancy"].(map[string]any)["title"] != "Public assessment title" {
			t.Fatal(item)
		}
	}
	want := []string{ids[0], ids[1], replacement, ids[2], ids[3]}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%v != %v", got, want)
	}
	// Same participation/test chooses the newer id when creation timestamps tie.
	exec(`UPDATE psychometric_invitations SET revoked_at=created_at WHERE id=$1`, replacement)
	newer := uuid.NewString()
	if newer < replacement {
		newer, replacement = replacement, newer
		exec(`UPDATE psychometric_invitations SET id=$2 WHERE id=$1`, newer, replacement)
	}
	exec(`INSERT INTO psychometric_invitations(id,participation_id,test,content_version,scoring_version,total_count,origin,created_at,expires_at,purge_after) SELECT $1,participation_id,test,content_version,scoring_version,total_count,origin,created_at,expires_at,purge_after FROM psychometric_invitations WHERE id=$2`, newer, replacement)
	r = f.h.do(t, "GET", "/v2/me/assessments", "", f.session, nil)
	items = draftFlowObject(t, r.body)["items"].([]any)
	found := false
	for _, raw := range items {
		id := raw.(map[string]any)["id"]
		if id == replacement || id == f.iid {
			t.Fatal("stale invitation listed")
		}
		if id == newer {
			found = true
		}
	}
	if !found {
		t.Fatal("latest id omitted")
	}
}
func TestPsychometricCandidateTokenNeverLogged(t *testing.T) {
	f := assessmentSetup(t)
	old := slog.Default()
	var logs bytes.Buffer
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	defer slog.SetDefault(old)
	r := f.h.do(t, "GET", f.public, "", "", nil)
	if r.status != 200 {
		t.Fatal(r.status)
	}
	if strings.Contains(logs.String(), strings.TrimPrefix(f.public, "/v2/assessments/")) || !strings.Contains(logs.String(), "/v2/assessments/{token}") {
		t.Fatal("unsafe request logging")
	}
}
