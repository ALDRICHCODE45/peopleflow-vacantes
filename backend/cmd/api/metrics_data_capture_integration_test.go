//go:build integration

package main

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// stakeholder-metrics-v1 §2.7: requester columns mirror fields.requester.
func metricsRequesterColumns(t *testing.T, h *draftFlowHarness, id string) (any, any) {
	t.Helper()
	var kind, requester *string
	if err := h.pool.QueryRow(context.Background(), `SELECT requester_kind,requester_id::text FROM job_drafts WHERE id=$1`, id).Scan(&kind, &requester); err != nil {
		t.Fatal(err)
	}
	var k, r any
	if kind != nil {
		k = *kind
	}
	if requester != nil {
		r = *requester
	}
	return k, r
}

func TestMetricsRequesterColumnsFollowDraftWrites(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	client, area := uuid.NewString(), uuid.NewString()
	for _, r := range []struct{ id, kind string }{{client, "client"}, {area, "internal_area"}} {
		if _, err := h.pool.Exec(context.Background(), `INSERT INTO job_draft_requesters(id,company_id,kind,name,name_key,normalization_version) SELECT $1::uuid,company_id,$2,$4,$4,1 FROM company_members WHERE user_id=$3`, r.id, r.kind, ownerID, "Requester "+r.id); err != nil {
			t.Fatal(err)
		}
	}
	// v2 create with a requester, then every PATCH keeps the columns in sync.
	id := draftListFlowCreate(t, h, owner, `{"fields":{"title":"Go","requester":{"kind":"client","id":"`+client+`"}}}`)
	if k, r := metricsRequesterColumns(t, h, id); k != "client" || r != client {
		t.Fatal(k, r)
	}
	base := draftFlowV2Path + "/" + id
	for _, tc := range []struct {
		body       string
		kind, want any
	}{
		{`{"fields":{"title":"Unrelated"}}`, "client", client},
		{`{"fields":{"requester":{"kind":"internal_area","id":"` + area + `"}}}`, "internal_area", area},
		{`{"fields":{"requester":{"kind":"client","id":null}}}`, "client", nil},
		{`{"fields":{"requester":null}}`, nil, nil},
	} {
		draft := h.do(t, "GET", base, "", owner.token, nil)
		changed := h.do(t, "PATCH", base, tc.body, owner.token, map[string]string{"If-Match": draft.header.Get("ETag")})
		if changed.status != 200 {
			t.Fatal(tc.body, changed.status, string(changed.body))
		}
		if k, r := metricsRequesterColumns(t, h, id); k != tc.kind || r != tc.want {
			t.Fatal(tc.body, k, r)
		}
	}
	// A rejected requester (unknown id) leaves fields and columns unchanged.
	draft := h.do(t, "GET", base, "", owner.token, nil)
	if r := h.do(t, "PATCH", base, `{"fields":{"requester":{"kind":"client","id":"`+area+`"}}}`, owner.token, map[string]string{"If-Match": draft.header.Get("ETag")}); r.status != 400 {
		t.Fatal(r.status, string(r.body))
	}
	if k, r := metricsRequesterColumns(t, h, id); k != nil || r != nil {
		t.Fatal(k, r)
	}
	nullID := draftListFlowCreate(t, h, owner, `{"fields":{"requester":{"kind":"internal_area","id":null}}}`)
	if k, r := metricsRequesterColumns(t, h, nullID); k != "internal_area" || r != nil {
		t.Fatal(k, r)
	}
	// Existing behavior: drafts saved without a requester (v2 and v1) keep null columns.
	plain := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	legacy, etag, _ := h.create(t, owner, uuid.NewString(), draftFlowMinimalCreate)
	patched := h.do(t, http.MethodPatch, draftFlowPath+"/"+legacy, `{"fields":{"title":"Backend Rust"}}`, owner.token, map[string]string{"If-Match": etag, "Content-Type": "application/json"})
	if patched.status != 200 {
		t.Fatal(patched.status, string(patched.body))
	}
	for _, draftID := range []string{plain, legacy} {
		if k, r := metricsRequesterColumns(t, h, draftID); k != nil || r != nil {
			t.Fatal(draftID, k, r)
		}
	}
}

type metricsCloseChange struct{ previous, next any }

func metricsCloseChanges(t *testing.T, h *draftFlowHarness, id string, actor uuid.UUID) []metricsCloseChange {
	t.Helper()
	rows, err := h.pool.Query(context.Background(), `SELECT previous_date::text,new_date::text,performed_by,company_id=(SELECT company_id FROM job_drafts WHERE id=$1) FROM vacancy_close_target_changes WHERE draft_id=$1 ORDER BY performed_at,id`, id)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []metricsCloseChange{}
	for rows.Next() {
		var previous, next *string
		var by uuid.UUID
		var sameCompany bool
		if err := rows.Scan(&previous, &next, &by, &sameCompany); err != nil {
			t.Fatal(err)
		}
		if by != actor || !sameCompany {
			t.Fatal("change actor/company", by)
		}
		c := metricsCloseChange{}
		if previous != nil {
			c.previous = *previous
		}
		if next != nil {
			c.next = *next
		}
		out = append(out, c)
	}
	return out
}

// stakeholder-metrics-v1 §2.2 / D7: optional targetCloseDate with a change log.
func TestMetricsManagementTargetCloseDate(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	path := draftFlowV2Path + "/" + id + "/management"
	put := func(body, etag string) draftFlowResponse {
		t.Helper()
		return h.do(t, "PUT", path, body, owner.token, map[string]string{"If-Match": etag})
	}
	first := h.do(t, "GET", path, "", owner.token, nil)
	if _, present := draftFlowObject(t, first.body)["targetCloseDate"]; present {
		t.Fatal("unset targetCloseDate exposed", string(first.body))
	}
	set := put(`{"requestDate":null,"hiringHeadcount":2,"targetCloseDate":"2026-12-15"}`, first.header.Get("ETag"))
	obj := assertManagementFlowTarget(t, set, id, 1)
	if obj["targetCloseDate"] != "2026-12-15" || obj["hiringHeadcount"] != float64(2) {
		t.Fatal(obj)
	}
	// Existing clients omit the key: the stored date is kept, no change logged.
	kept := put(`{"requestDate":null,"hiringHeadcount":3}`, set.header.Get("ETag"))
	obj = assertManagementFlowTarget(t, kept, id, 2)
	if obj["targetCloseDate"] != "2026-12-15" || obj["hiringHeadcount"] != float64(3) {
		t.Fatal(obj)
	}
	read := h.do(t, "GET", path, "", owner.token, nil)
	if string(read.body) != string(kept.body) {
		t.Fatal("GET differs", string(read.body))
	}
	// Rejected dates leave configuration, change log and audit unchanged.
	before := publicationFlowSnapshot(t, h, id)
	for _, body := range []string{`{"requestDate":null,"hiringHeadcount":3,"targetCloseDate":"2026-02-30"}`, `{"requestDate":null,"hiringHeadcount":3,"targetCloseDate":15}`} {
		r := put(body, kept.header.Get("ETag"))
		obj := draftFlowObject(t, r.body)
		if r.status != 400 || obj["code"] != "invalid_request" || len(obj) != 2 {
			t.Fatal(r.status, string(r.body))
		}
	}
	if publicationFlowSnapshot(t, h, id) != before || len(metricsCloseChanges(t, h, id, ownerID)) != 1 {
		t.Fatal("rejected targetCloseDate wrote")
	}
	moved := put(`{"requestDate":null,"hiringHeadcount":3,"targetCloseDate":"2027-01-31"}`, kept.header.Get("ETag"))
	assertManagementFlowTarget(t, moved, id, 3)
	cleared := put(`{"requestDate":null,"hiringHeadcount":3,"targetCloseDate":null}`, moved.header.Get("ETag"))
	if _, present := draftFlowObject(t, assertManagementFlowRaw(t, cleared, id, 4).body)["targetCloseDate"]; present {
		t.Fatal(string(cleared.body))
	}
	want := []metricsCloseChange{{nil, "2026-12-15"}, {"2026-12-15", "2027-01-31"}, {"2027-01-31", nil}}
	if got := metricsCloseChanges(t, h, id, ownerID); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatal(got)
	}
	var meta string
	if err := h.pool.QueryRow(context.Background(), `SELECT metadata->>'new' FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftManagementConfigured' AND metadata->>'version'='3'`, id).Scan(&meta); err != nil || meta != `{"requestDate":null,"hiringHeadcount":3,"targetCloseDate":"2027-01-31"}` {
		t.Fatal(meta, err)
	}
}

func assertManagementFlowRaw(t *testing.T, r draftFlowResponse, id string, version int64) draftFlowResponse {
	t.Helper()
	assertManagementFlow(t, r, id, version)
	return r
}

// assertManagementFlowTarget is assertManagementFlow plus the optional sixth key.
func assertManagementFlowTarget(t *testing.T, r draftFlowResponse, id string, version int64) map[string]any {
	t.Helper()
	draftFlowAssertNoStore(t, r)
	obj := draftFlowObject(t, r.body)
	if r.status != 200 || len(obj) != 6 || obj["version"] != fmt.Sprint(version) {
		t.Fatalf("management=%d %s", r.status, r.body)
	}
	return obj
}

// D8 regression: a delivery fulfilled by a configuration save records the save
// time in fulfilled_at; «Mi rendimiento» must judge by the N-th reached_at.
func TestOwnAssignmentHistoryDeadlineFollowsReachedAt(t *testing.T) {
	const start = "2026-01-05T18:00:00Z" // Monday
	const now = "2026-01-16T18:00:00Z"
	for _, tc := range []struct {
		name, fulfilled, reached, result string
		delta                            float64
	}{
		// Saved late on Jan 14; the 2nd candidate reached the cutoff Jan 7.
		{"save time after deadline", "2026-01-14T18:00:00Z", "2026-01-07T18:00:00Z", "on_time", 1},
		// Existing behavior: when both instants match, the result is unchanged.
		{"normal fulfillment", "2026-01-07T18:00:00Z", "2026-01-07T18:00:00Z", "on_time", 1},
		{"late by reached_at", "2026-01-12T18:00:00Z", "2026-01-12T18:00:00Z", "late", -2},
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
			exec(`UPDATE vacancy_assignments SET started_at=$2,recruiter_deadline='2026-01-08',closing_deadline='2026-01-08' WHERE draft_id=$1`, id, began)
			exec(`UPDATE vacancy_assignment_functions SET started_at=$2 WHERE draft_id=$1`, id, began)
			candidates := fmt.Sprintf(`[{"participation_id":%q,"candidate":{"id":%q,"full_name":"First"},"reached_at":"2026-01-06T18:00:00Z"},{"participation_id":%q,"candidate":{"id":%q,"full_name":"Second"},"reached_at":%q}]`, uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), tc.reached)
			exec(`INSERT INTO process_delivery_fulfillments(process_id,fulfilled_at,result,business_days_delta,target,delivered,cutoff_stage_id,cutoff_stage_name,commitment_date,candidates) VALUES($1,$2,'late',-4,2,3,$3,'Screening','2026-01-08',$4::jsonb)`, id, historyMetricTime(tc.fulfilled), pipelineconfig.Defaults(uuid.MustParse(id)).Stages[2].ID, candidates)
			t.Cleanup(func() { exec(`DELETE FROM process_delivery_fulfillments WHERE process_id=$1`, id) })
			before := publicationFlowSnapshot(t, h, id)
			item := ownHistory(t, h, owner, "")["items"].([]any)[0].(map[string]any)
			if item["deadline_result"] != tc.result || item["deadline_delta_business_days"] != tc.delta || item["delivery_target"] != float64(2) || item["effective_deadline"] != "2026-01-08" {
				t.Fatalf("item=%v", item)
			}
			if publicationFlowSnapshot(t, h, id) != before {
				t.Fatal("read changed stored state")
			}
		})
	}
}
