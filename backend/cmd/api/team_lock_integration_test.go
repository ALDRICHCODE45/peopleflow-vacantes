//go:build integration

package main

import (
	"context"
	"fmt"
	"github.com/google/uuid"
	"strings"
	"testing"
	"time"
)

func TestTeamWriteRechecksAccessAfterWaitingForDraftLock(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	memberID, memberSub := company.addUser(t, "recruiter")
	member := h.actor(t, memberID, memberSub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	base := draftFlowV2Path + "/" + id + "/team"
	tag := h.do(t, "GET", base, "", owner.token, nil).header.Get("ETag")
	added := h.do(t, "POST", base+"/members", fmt.Sprintf(`{"user_id":%q}`, memberID), owner.token, map[string]string{"If-Match": tag, "Idempotency-Key": uuid.NewString()})
	if added.status != 200 {
		t.Fatal(added.status, string(added.body))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(ctx, `SELECT id FROM job_drafts WHERE id=$1 FOR UPDATE`, id); err != nil {
		t.Fatal(err)
	}
	outcomes := make(chan draftFlowCall, 1)
	go func() {
		r, err := h.roundTrip("PATCH", base+"/members/"+memberID.String(), `{"recruiter_deadline":null}`, member.token, map[string]string{"If-Match": added.header.Get("ETag")})
		outcomes <- draftFlowCall{r, err}
	}()
	for {
		var waiting bool
		if err := h.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT id FROM job_drafts WHERE id=$1 AND company_id=$2 FOR UPDATE%')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		if ctx.Err() != nil {
			t.Fatal("request never waited for draft lock")
		}
		time.Sleep(10 * time.Millisecond)
	}
	// Complete a removal while the write's SELECT is waiting on the parent row.
	if _, err := tx.Exec(ctx, `UPDATE vacancy_assignment_functions SET ended_at=clock_timestamp(),end_cause='tramo_ended' WHERE assignment_id IN (SELECT id FROM vacancy_assignments WHERE draft_id=$1 AND user_id=$2 AND ended_at IS NULL)`, id, memberID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE vacancy_assignments SET ended_at=clock_timestamp(),end_cause='removed',ended_by=$3 WHERE draft_id=$1 AND user_id=$2 AND ended_at IS NULL`, id, memberID, ownerID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case call := <-outcomes:
		if call.err != nil {
			t.Fatal(call.err)
		}
		draftFlowAssertCatalogError(t, call.resp, 404, "team_access_ended")
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
}

func TestTeamConcurrentMutationsSerialize(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	a, _ := company.addUser(t, "recruiter")
	b, _ := company.addUser(t, "recruiter")
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	base := draftFlowV2Path + "/" + id + "/team"
	for _, action := range []string{"add", "remove", "reassign"} {
		tag := h.do(t, "GET", base, "", owner.token, nil).header.Get("ETag")
		// Prepare both targets for removal, without touching them for reassignment.
		if action == "remove" {
			for _, user := range []uuid.UUID{a, b} {
				r := h.do(t, "POST", base+"/members", fmt.Sprintf(`{"user_id":%q}`, user), owner.token, map[string]string{"If-Match": tag, "Idempotency-Key": uuid.NewString()})
				if r.status == 200 {
					tag = r.header.Get("ETag")
				} else if !strings.Contains(string(r.body), "team_member_already_active") {
					t.Fatal(r.status, string(r.body))
				}
			}
		}
		start := make(chan struct{})
		out := make(chan draftFlowCall, 2)
		for _, user := range []uuid.UUID{a, b} {
			go func(user uuid.UUID) {
				<-start
				path := base + "/members"
				body := fmt.Sprintf(`{"user_id":%q}`, user)
				if action == "remove" {
					path += "/" + user.String() + "/remove"
					body = "{}"
				}
				if action == "reassign" {
					path = base + "/reassign-responsible"
					body = fmt.Sprintf(`{"to_user_id":%q,"reason":"workload"}`, user)
				}
				r, err := h.roundTrip("POST", path, body, owner.token, map[string]string{"If-Match": tag, "Idempotency-Key": uuid.NewString()})
				out <- draftFlowCall{r, err}
			}(user)
		}
		close(start)
		success, conflict := 0, 0
		for i := 0; i < 2; i++ {
			call := <-out
			if call.err != nil {
				t.Fatal(call.err)
			}
			switch call.resp.status {
			case 200:
				success++
			case 412:
				conflict++
				draftFlowAssertCatalogError(t, call.resp, 412, "team_version_conflict")
			default:
				t.Fatal(action, call.resp.status, string(call.resp.body))
			}
		}
		if success != 1 || conflict != 1 {
			t.Fatal(action, success, conflict)
		}
		var responsible int
		if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM vacancy_assignment_functions WHERE draft_id=$1 AND function='responsible' AND ended_at IS NULL`, id).Scan(&responsible); err != nil || responsible != 1 {
			t.Fatal(responsible, err)
		}
	}
}
