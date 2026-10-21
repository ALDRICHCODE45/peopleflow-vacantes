//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func publicationFlowReady(t *testing.T, h *draftFlowHarness, actor draftFlowActor) string {
	t.Helper()
	requester := uuid.NewString()
	if _, err := h.pool.Exec(context.Background(), `INSERT INTO job_draft_requesters (id,company_id,kind,name,name_key,normalization_version) SELECT $1,company_id,'internal_area',$2,$3,1 FROM company_members WHERE user_id=$4`, requester, "Engineering "+requester, "engineering "+requester, actor.userID); err != nil {
		t.Fatal(err)
	}
	body := `{"fields":{"title":"Backend Go","location":null,"remote_scope":{"kind":"anywhere"},"work_mode":"remote","work_schedule":"full_time","contract_type":"indefinite","professional_area":"technology_systems","requester":{"kind":"internal_area","id":"` + requester + `"},"description":{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Build reliable APIs"}]}]}}}}`
	id := draftListFlowCreate(t, h, actor, body)
	base := draftFlowV2Path + "/" + id
	management := h.do(t, "GET", base+"/management", "", actor.token, nil)
	if management.status != 200 {
		t.Fatalf("management=%d %s", management.status, management.body)
	}
	today := draftFlowObject(t, management.body)["today"].(string)
	saved := h.do(t, "PUT", base+"/management", `{"requestDate":"`+today+`","hiringHeadcount":2}`, actor.token, map[string]string{"If-Match": management.header.Get("ETag")})
	if saved.status != 200 {
		t.Fatalf("management save=%d %s", saved.status, saved.body)
	}
	delivery := h.do(t, "GET", base+"/pipeline/delivery", "", actor.token, nil)
	_, cal := assertDeliveryFlowResponse(t, delivery, id, 0)
	cutoff := pipelineconfig.Defaults(uuid.MustParse(id)).Stages[3].ID
	date := deliveryFlowBusinessDate(t, cal)
	saved = h.do(t, "PUT", base+"/pipeline/delivery", `{"cutoffStageId":"`+cutoff+`","targetQuantity":5,"commitmentDate":"`+date+`"}`, actor.token, map[string]string{"If-Match": delivery.header.Get("ETag")})
	assertDeliveryFlowResponse(t, saved, id, 1)
	return id
}
func TestPublicationFlowReadyPublishReplayVersionsAuditAndList(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	id := publicationFlowReady(t, h, owner)
	base := draftFlowV2Path + "/" + id
	path := base + "/publication"
	originals := map[string]draftFlowResponse{}
	for _, suffix := range []string{"", "/pipeline", "/pipeline/substates", "/pipeline/delivery", "/management"} {
		originals[suffix] = h.do(t, "GET", base+suffix, "", owner.token, nil)
	}
	before := publicationFlowSnapshot(t, h, id)
	ready := h.do(t, "GET", path, "", owner.token, nil)
	draftFlowAssertNoStore(t, ready)
	if ready.status != 200 || string(ready.body) != `{"status":"draft","publishedAt":null,"missing":[]}` || ready.header.Get("ETag") != "" || ready.header.Get("Idempotency-Replayed") != "" || before != publicationFlowSnapshot(t, h, id) {
		t.Fatalf("readiness=%d %s", ready.status, ready.body)
	}
	// Publication uses the draft ETag and same id; list ordering is not changed.
	listBefore := h.do(t, "GET", draftFlowV2Path, "", owner.token, nil)
	key := uuid.NewString()
	published := h.do(t, "POST", path, `{}`, owner.token, map[string]string{"If-Match": originals[""].header.Get("ETag"), "Idempotency-Key": key})
	draftFlowAssertNoStore(t, published)
	obj := draftFlowObject(t, published.body)
	at, err := time.Parse(time.RFC3339Nano, obj["publishedAt"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if published.status != 201 || len(obj) != 3 || obj["id"] != id || obj["status"] != "published" || !strings.HasSuffix(obj["publishedAt"].(string), "Z") || published.header.Get("ETag") != originals[""].header.Get("ETag") || published.header.Get("Idempotency-Replayed") != "false" {
		t.Fatalf("publication=%d %s %v", published.status, published.body, published.header)
	}
	for suffix, original := range originals {
		got := h.do(t, "GET", base+suffix, "", owner.token, nil)
		if got.status != 200 || !bytes.Equal(lifecycleFlowWithoutView(t, got.body), lifecycleFlowWithoutView(t, original.body)) || got.header.Get("ETag") != original.header.Get("ETag") {
			t.Fatalf("publish changed %s", suffix)
		}
	}
	var actor string
	var storedAt time.Time
	var auditActor string
	var metadata []byte
	if err := h.pool.QueryRow(context.Background(), `SELECT published_by::text,published_at FROM vacancy_processes WHERE id=$1`, id).Scan(&actor, &storedAt); err != nil || actor != ownerID.String() || !storedAt.Equal(at) {
		t.Fatalf("process=%s %v", actor, err)
	}
	if err := h.pool.QueryRow(context.Background(), `SELECT actor_id::text,metadata FROM audit_events WHERE entity_id=$1 AND event_type='VacancyPublished'`, id).Scan(&auditActor, &metadata); err != nil || auditActor != actor {
		t.Fatalf("audit actor=%s %v", auditActor, err)
	}
	var meta map[string]string
	_ = json.Unmarshal(metadata, &meta)
	var snap map[string]any
	_ = json.Unmarshal([]byte(meta["snapshot"]), &snap)
	delivery := draftFlowObject(t, originals["/pipeline/delivery"].body)
	management := draftFlowObject(t, originals["/management"].body)
	want := map[string]any{"targetQuantity": delivery["targetQuantity"], "cutoffStageId": delivery["cutoffStageId"], "cutoffStageName": "En proceso", "commitmentDate": delivery["commitmentDate"], "hiringHeadcount": management["hiringHeadcount"], "requestDate": management["requestDate"]}
	if meta["publishedAt"] != obj["publishedAt"] || !reflect.DeepEqual(snap, want) {
		t.Fatalf("audit=%s", metadata)
	}
	var pageBefore, pageAfter map[string]any
	_ = json.Unmarshal(listBefore.body, &pageBefore)
	listAfter := h.do(t, "GET", draftFlowV2Path, "", owner.token, nil)
	_ = json.Unmarshal(listAfter.body, &pageAfter)
	items := pageBefore["items"].([]any)
	items[0].(map[string]any)["status"] = "published"
	items[0].(map[string]any)["process"] = "active"
	items[0].(map[string]any)["published_at"] = obj["publishedAt"]
	stages := []any{}
	for _, stage := range pipelineconfig.Defaults(uuid.MustParse(id)).Stages {
		stages = append(stages, map[string]any{"id": stage.ID, "kind": stage.Kind, "name": stage.Name, "count": float64(0)})
	}
	items[0].(map[string]any)["candidates"] = map[string]any{"total": float64(0), "in_process": float64(0), "discarded": float64(0), "by_stage": stages}
	if listAfter.status != 200 || !reflect.DeepEqual(pageBefore, pageAfter) {
		t.Fatalf("list changed beyond lifecycle list keys: %s", listAfter.body)
	}
	// Edit after publication, then replay without If-Match: frozen original 201.
	changed := h.do(t, "PATCH", base, `{"fields":{"title":"Updated offer"}}`, owner.token, map[string]string{"If-Match": published.header.Get("ETag")})
	if changed.status != 200 {
		t.Fatalf("edit after publication: %s", changed.body)
	}
	updatedDelivery, err := json.Marshal(map[string]any{"cutoffStageId": delivery["cutoffStageId"], "targetQuantity": 6, "commitmentDate": delivery["commitmentDate"]})
	if err != nil {
		t.Fatal(err)
	}
	cleared := h.do(t, "PUT", base+"/pipeline/delivery", string(updatedDelivery), owner.token, map[string]string{"If-Match": originals["/pipeline/delivery"].header.Get("ETag")})
	if cleared.status != 200 {
		t.Fatal(string(cleared.body))
	}
	before = publicationFlowSnapshot(t, h, id)
	replay := h.do(t, "POST", path, " { }\n", owner.token, map[string]string{"Idempotency-Key": key})
	draftFlowAssertNoStore(t, replay)
	if replay.status != 201 || replay.header.Get("Idempotency-Replayed") != "true" || replay.header.Get("ETag") != published.header.Get("ETag") || !bytes.Equal(replay.body, published.body) || before != publicationFlowSnapshot(t, h, id) {
		t.Fatalf("replay=%d %s", replay.status, replay.body)
	}
	readiness := h.do(t, "GET", path, "", owner.token, nil)
	readObj := draftFlowObject(t, readiness.body)
	if readiness.status != 200 || len(readObj) != 3 || readObj["status"] != "published" || readObj["publishedAt"] != obj["publishedAt"] || !reflect.DeepEqual(readObj["missing"], []any{}) || before != publicationFlowSnapshot(t, h, id) {
		t.Fatalf("published readiness=%s", readiness.body)
	}
}
func TestPublicationFlowRejectionOrderStrictBodiesAndNoEffects(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	recruiterID, recruiterSub := company.addUser(t, "recruiter")
	nonprincipal := h.actor(t, recruiterID, recruiterSub)
	_, foreignID, foreignSub := draftFlowNewPrincipal(t, h.pool, "active")
	foreign := h.actor(t, foreignID, foreignSub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	base := draftFlowV2Path + "/" + id
	path := base + "/publication"
	draft := h.do(t, "GET", base, "", owner.token, nil)
	tag := draft.header.Get("ETag")
	key := uuid.NewString()
	headers := map[string]string{"Idempotency-Key": key, "If-Match": tag}
	all := []string{"title_missing", "description_missing", "work_mode_missing", "work_schedule_missing", "contract_type_missing", "professional_area_missing", "requester_missing", "request_date_missing", "hiring_headcount_missing", "delivery_cutoff_missing", "delivery_target_missing", "commitment_date_missing"}
	before := publicationFlowSnapshot(t, h, id)
	read := h.do(t, "GET", path, "", owner.token, nil)
	readObj := draftFlowObject(t, read.body)
	wantMissing := make([]any, len(all))
	for i, v := range all {
		wantMissing[i] = v
	}
	if read.status != 200 || len(readObj) != 3 || readObj["status"] != "draft" || readObj["publishedAt"] != nil || !reflect.DeepEqual(readObj["missing"], wantMissing) || before != publicationFlowSnapshot(t, h, id) {
		t.Fatalf("readiness=%s", read.body)
	}
	for _, tc := range []struct {
		name, method, path, body, token string
		headers                         map[string]string
		status                          int
		code                            string
	}{
		{"incomplete", "POST", path, `{}`, owner.token, headers, 422, "publication_incomplete"},
		{"missing key", "POST", path, `{}`, owner.token, nil, 400, "idempotency_key_required"}, {"empty key", "POST", path, `{}`, owner.token, map[string]string{"Idempotency-Key": ""}, 400, "invalid_idempotency_key"}, {"bad key before ifmatch", "POST", path, `{}`, owner.token, map[string]string{"Idempotency-Key": "bad"}, 400, "invalid_idempotency_key"},
		{"missing precondition before incomplete", "POST", path, `{}`, owner.token, map[string]string{"Idempotency-Key": key}, 428, "precondition_required"}, {"weak", "POST", path, `{}`, owner.token, map[string]string{"Idempotency-Key": key, "If-Match": "W/" + tag}, 400, "invalid_request"}, {"stale", "POST", path, `{}`, owner.token, map[string]string{"Idempotency-Key": key, "If-Match": `"jd-r2-` + id + `-v9"`}, 412, "version_conflict"},
		{"unknown key", "POST", path, `{"extra":1}`, owner.token, headers, 400, "invalid_request"}, {"array", "POST", path, `[]`, owner.token, headers, 400, "invalid_request"}, {"null", "POST", path, `null`, owner.token, headers, 400, "invalid_request"}, {"duplicate", "POST", path, `{"x":1,"x":1}`, owner.token, headers, 400, "invalid_request"}, {"trailing", "POST", path, `{} {}`, owner.token, headers, 400, "invalid_request"}, {"malformed", "POST", path, `{`, owner.token, headers, 400, "invalid_request"}, {"utf8", "POST", path, "{\"x\":\"\xff\"}", owner.token, headers, 400, "invalid_request"}, {"surrogate", "POST", path, `{"x":"\uD800"}`, owner.token, headers, 400, "invalid_request"}, {"budget", "POST", path, strings.Repeat("x", 1048577), owner.token, headers, 413, "payload_too_large"},
		{"anonymous", "GET", path, "", "", nil, 401, "unauthenticated"}, {"nonprincipal before key", "POST", path, `{}`, nonprincipal.token, nil, 404, "not_found"}, {"foreign before key", "POST", path, `{}`, foreign.token, nil, 404, "not_found"}, {"missing before key", "POST", draftFlowV2Path + "/" + uuid.NewString() + "/publication", `{}`, owner.token, nil, 404, "not_found"}, {"bad path", "POST", draftFlowV2Path + "/bad/publication", `{}`, owner.token, headers, 400, "invalid_request"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := publicationFlowSnapshot(t, h, id)
			r := h.do(t, tc.method, tc.path, tc.body, tc.token, tc.headers)
			publicationFlowAssertError(t, r, tc.status, tc.code, all)
			if before != publicationFlowSnapshot(t, h, id) {
				t.Fatal("rejection wrote state")
			}
		})
	}
	id = publicationFlowReady(t, h, owner)
	base = draftFlowV2Path + "/" + id
	path = base + "/publication"
	draft = h.do(t, "GET", base, "", owner.token, nil)
	tag = draft.header.Get("ETag")
	key = uuid.NewString()
	success := h.do(t, "POST", path, `{}`, owner.token, map[string]string{"Idempotency-Key": key, "If-Match": tag})
	if success.status != 201 {
		t.Fatalf("publish=%s", success.body)
	}
	for _, tc := range []struct {
		name, key, tag, body string
		status               int
		code                 string
	}{
		{"conflict before missing ifmatch", key, "", `{"extra":1}`, 409, "idempotency_conflict"}, {"precondition before already", uuid.NewString(), "", `{}`, 428, "precondition_required"}, {"stale before already", uuid.NewString(), `"jd-r2-` + id + `-v9"`, `{}`, 412, "version_conflict"}, {"already", uuid.NewString(), tag, `{}`, 409, "already_published"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := publicationFlowSnapshot(t, h, id)
			hdr := map[string]string{"Idempotency-Key": tc.key}
			if tc.tag != "" {
				hdr["If-Match"] = tc.tag
			}
			r := h.do(t, "POST", path, tc.body, owner.token, hdr)
			publicationFlowAssertError(t, r, tc.status, tc.code, nil)
			if before != publicationFlowSnapshot(t, h, id) {
				t.Fatal("post-success rejection wrote state")
			}
		})
	}
}
