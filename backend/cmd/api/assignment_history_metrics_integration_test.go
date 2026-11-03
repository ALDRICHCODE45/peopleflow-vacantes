//go:build integration

package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func historyMetricTime(value string) time.Time {
	at, err := time.Parse(time.RFC3339, value)
	if err != nil {
		panic(err)
	}
	return at
}

func TestOwnAssignmentHistoryDeadlineMetrics(t *testing.T) {
	// Jan 5 is Monday. Jan 9 03:00 UTC is still Jan 8 in Mexico City.
	const start = "2026-01-05T18:00:00Z"
	const now = "2026-01-10T03:00:00Z" // Friday Jan 9, not Saturday.
	for _, tc := range []struct {
		name, deadline, end, fulfilled, result string
		delta                                  any
		days                                   float64
		unconfigured                           bool
	}{
		{"on time before deadline", "2026-01-08", "", "2026-01-06T18:00:00Z", "on_time", float64(2), 4, false},
		{"on deadline Mexico City date", "2026-01-08", "", "2026-01-09T03:00:00Z", "on_time", float64(0), 4, false},
		{"late fulfilled", "2026-01-07", "", "2026-01-09T18:00:00Z", "late", float64(-2), 4, false},
		{"late active unfulfilled", "2026-01-07", "", "", "late", float64(-2), 4, false},
		{"late ended unfulfilled", "2026-01-06", "2026-01-08T18:00:00Z", "", "late", float64(-2), 3, false},
		{"pending", "2026-01-13", "", "", "pending", float64(2), 4, false},
		{"pending today", "2026-01-09", "", "", "pending", float64(0), 4, false},
		{"unfinished", "2026-01-08", "2026-01-07T18:00:00Z", "", "unfinished", float64(1), 2, false},
		{"unfinished on deadline date", "2026-01-08", "2026-01-09T03:00:00Z", "", "unfinished", float64(0), 3, false},
		{"already fulfilled", "2026-01-08", "", "2026-01-04T18:00:00Z", "not_applicable", nil, 4, false},
		{"none no deadline", "", "", "", "none", nil, 4, false},
		{"none delivery not configured", "2026-01-08", "", "", "none", nil, 4, true},
		{"none takes precedence over already fulfilled", "", "", "2026-01-04T18:00:00Z", "none", nil, 4, false},
		{"fulfilled inclusive start", "2026-01-08", "", start, "on_time", float64(3), 4, false},
		{"fulfilled exclusive end", "2026-01-08", "2026-01-07T18:00:00Z", "2026-01-07T18:00:00Z", "unfinished", float64(1), 2, false},
		{"fulfilled after end", "2026-01-08", "2026-01-07T18:00:00Z", "2026-01-09T18:00:00Z", "unfinished", float64(1), 2, false},
		{"fulfilled exclusive now", "2026-01-13", "", now, "pending", float64(2), 4, false},
		{"weekend late zero delta", "2026-01-09", "2026-01-11T18:00:00Z", "", "late", float64(0), 4, false},
		{"holiday excluded", "2026-01-08", "2026-01-02T18:00:00Z", "", "unfinished", float64(4), 1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newDraftFlowHarness(t)
			_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
			owner := h.actor(t, ownerID, sub)
			id := publicationFlowReady(t, h, owner)
			publicFlowPublish(t, h, id, owner)
			exec := func(q string, args ...any) {
				t.Helper()
				if _, err := h.pool.Exec(context.Background(), q, args...); err != nil {
					t.Fatal(err)
				}
			}
			h.store.WithClock(func() time.Time { return historyMetricTime(now) })
			began := historyMetricTime(start)
			if tc.name == "holiday excluded" {
				began = historyMetricTime("2025-12-31T18:00:00Z")
			}
			var ended *time.Time
			if tc.end != "" {
				v := historyMetricTime(tc.end)
				ended = &v
			}
			var deadline *string
			if tc.deadline != "" {
				deadline = &tc.deadline
			}
			// Different current commitment proves recruiter precedence and frozen closing deadlines.
			exec(`UPDATE job_draft_delivery_configs SET commitment_date='2026-02-10',target_quantity=7 WHERE draft_id=$1`, id)
			if deadline == nil {
				exec(`UPDATE job_draft_delivery_configs SET commitment_date=NULL WHERE draft_id=$1`, id)
			}
			if tc.unconfigured {
				exec(`UPDATE job_draft_delivery_configs SET cutoff_stage_id=NULL,target_quantity=NULL WHERE draft_id=$1`, id)
			}
			var cause *string
			if ended != nil {
				v := "removed"
				cause = &v
			}
			exec(`UPDATE vacancy_assignments SET started_at=$2,ended_at=$3,end_cause=$4,recruiter_deadline=$5,closing_deadline=$5 WHERE draft_id=$1`, id, began, ended, cause, deadline)
			var functionCause *string
			if ended != nil {
				v := "tramo_ended"
				functionCause = &v
			}
			exec(`UPDATE vacancy_assignment_functions SET started_at=$2,ended_at=$3,end_cause=$4 WHERE draft_id=$1`, id, began, ended, functionCause)
			target := any(float64(7))
			if tc.unconfigured {
				target = nil
			}
			if tc.fulfilled != "" {
				// A real snapshot-shaped candidate sentinel must never enter the history payload.
				exec(`INSERT INTO process_delivery_fulfillments(process_id,fulfilled_at,result,business_days_delta,target,delivered,cutoff_stage_id,cutoff_stage_name,commitment_date,candidates) VALUES($1,$2,'on_time',0,1,1,$3,'Screening','2026-02-10', $4::jsonb)`, id, historyMetricTime(tc.fulfilled), pipelineconfig.Defaults(uuid.MustParse(id)).Stages[2].ID, fmt.Sprintf(`[{"participation_id":%q,"candidate":{"id":%q,"full_name":"candidate-private-sentinel"},"reached_at":%q}]`, uuid.NewString(), uuid.NewString(), tc.fulfilled))
				target = float64(1)
				t.Cleanup(func() { exec(`DELETE FROM process_delivery_fulfillments WHERE process_id=$1`, id) })
			}
			before := publicationFlowSnapshot(t, h, id)
			item := ownHistory(t, h, owner, "")["items"].([]any)[0].(map[string]any)
			wantID := any(id)
			if ended != nil {
				wantID = nil
			}
			for key, want := range map[string]any{"draft_id": wantID, "effective_deadline": nil, "deadline_result": tc.result, "deadline_delta_business_days": tc.delta, "business_days_in_tramo": tc.days, "delivery_target": target} {
				if key == "effective_deadline" && deadline != nil {
					want = *deadline
				}
				if item[key] != want {
					t.Errorf("%s = %#v, want %#v; item=%v", key, item[key], want, item)
				}
			}
			if after := publicationFlowSnapshot(t, h, id); after != before {
				t.Fatal("read changed stored state")
			}
		})
	}
}

func TestOwnAssignmentHistoryRequesterAndLifecycle(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	item := ownHistory(t, h, owner, "")["items"].([]any)[0].(map[string]any)
	if item["requester"] != nil || item["draft_id"] != id || item["delivery_target"] != nil {
		t.Fatal(item)
	}
	editJSONEqual(t, item["vacancy_status"], map[string]any{"publication": "draft", "process": nil})
	for _, kind := range []string{"internal_area", "client"} {
		requester := uuid.NewString()
		name := "Current " + kind
		if _, err := h.pool.Exec(context.Background(), `INSERT INTO job_draft_requesters(id,company_id,kind,name,name_key,normalization_version) SELECT $1,company_id,$2,$3,$3,1 FROM company_members WHERE user_id=$4`, requester, kind, name, ownerID); err != nil {
			t.Fatal(err)
		}
		base := draftFlowV2Path + "/" + id
		draft := h.do(t, "GET", base, "", owner.token, nil)
		changed := h.do(t, "PATCH", base, fmt.Sprintf(`{"fields":{"requester":{"kind":%q,"id":%q}}}`, kind, requester), owner.token, map[string]string{"If-Match": draft.header.Get("ETag")})
		if changed.status != 200 {
			t.Fatal(changed.status, string(changed.body))
		}
		item = ownHistory(t, h, owner, "")["items"].([]any)[0].(map[string]any)
		editJSONEqual(t, item["requester"], map[string]any{"kind": kind, "name": name})
	}
	// The current lifecycle is independent of the tramo's active/ended state.
	readyID := publicationFlowReady(t, h, owner)
	publicFlowPublish(t, h, readyID, owner)
	for _, tc := range []struct{ publication, process string }{{"published", "active"}, {"paused", "active"}, {"closed", "active"}, {"closed", "finished"}} {
		if _, err := h.pool.Exec(context.Background(), `UPDATE vacancy_processes SET status=$2,process_status=$3 WHERE id=$1`, readyID, tc.publication, tc.process); err != nil {
			t.Fatal(err)
		}
		found := false
		for _, raw := range ownHistory(t, h, owner, "")["items"].([]any) {
			item := raw.(map[string]any)
			if item["draft_id"] == readyID {
				found = true
				editJSONEqual(t, item["vacancy_status"], map[string]any{"publication": tc.publication, "process": tc.process})
			}
		}
		if !found {
			t.Fatal("missing published vacancy")
		}
	}
}
