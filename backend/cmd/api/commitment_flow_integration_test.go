//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/google/uuid"
)

func commitmentSnapshot(t *testing.T, h *draftFlowHarness, id string) string {
	t.Helper()
	var out string
	err := h.pool.QueryRow(context.Background(), `SELECT jsonb_build_array(
 (SELECT row_to_json(d) FROM job_draft_delivery_configs d WHERE draft_id=$1),
 (SELECT jsonb_agg(c ORDER BY id) FROM vacancy_commitment_changes c WHERE draft_id=$1),
 (SELECT jsonb_agg(a ORDER BY id) FROM audit_events a WHERE entity_id=$1),
 (SELECT jsonb_agg(i ORDER BY id) FROM job_draft_idempotency i WHERE company_id=(SELECT company_id FROM job_drafts WHERE id=$1) AND operation='vacancy-commitment:r1'),
 (SELECT row_to_json(f) FROM process_delivery_fulfillments f WHERE process_id=$1))::text`, id).Scan(&out)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestCommitmentFlow(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	memberID, memberSub := company.addUser(t, "recruiter")
	member := h.actor(t, memberID, memberSub)
	outsiderID, outsiderSub := company.addUser(t, "recruiter")
	outsider := h.actor(t, outsiderID, outsiderSub)
	id := publicationFlowReady(t, h, member)
	base := draftFlowV2Path + "/" + id
	path := base + "/commitment"
	delivery := h.do(t, "GET", base+"/pipeline/delivery", "", member.token, nil)
	original := draftFlowObject(t, delivery.body)["commitmentDate"].(string)
	body := `{"commitment_date":"2099-01-05","reason":"other","note":"  private explanation  "}`
	headers := func(tag, key string) map[string]string {
		return map[string]string{"If-Match": tag, "Idempotency-Key": key}
	}
	tag := delivery.header.Get("ETag")
	reject := func(name, method, url, payload, token string, hdr map[string]string, status int, code string) {
		t.Helper()
		t.Run(name, func(t *testing.T) {
			before := commitmentSnapshot(t, h, id)
			r := h.do(t, method, url, payload, token, hdr)
			draftFlowAssertCatalogError(t, r, status, code)
			if len(draftFlowObject(t, r.body)) != 2 || r.header.Get("ETag") != "" || r.header.Get("Idempotency-Replayed") != "" || before != commitmentSnapshot(t, h, id) {
				t.Fatalf("rejected request changed state: %d %s", r.status, r.body)
			}
		})
	}
	reject("unpublished", "POST", path, body, member.token, headers(tag, uuid.NewString()), 409, "vacancy_not_published")
	publicFlowPublish(t, h, id, member)
	for _, tc := range []struct {
		name, body, tag, key, token string
		status                      int
		code                        string
	}{
		{"stale", body, `"stale"`, uuid.NewString(), member.token, 412, "version_conflict"},
		{"stale before invalid body", `broken`, `"stale"`, uuid.NewString(), member.token, 412, "version_conflict"},
		{"malformed tag", body, "bad", uuid.NewString(), member.token, 400, "invalid_request"},
		{"bad key", body, tag, "bad", member.token, 400, "invalid_idempotency_key"},
		{"unchanged", `{"commitment_date":"` + original + `","reason":"client_request"}`, tag, uuid.NewString(), member.token, 409, "commitment_unchanged"},
		{"note missing", `{"commitment_date":"2099-01-05","reason":"other"}`, tag, uuid.NewString(), member.token, 422, "commitment_note_required"},
		{"note blank", `{"commitment_date":"2099-01-05","reason":"other","note":"  "}`, tag, uuid.NewString(), member.token, 422, "commitment_note_required"},
		{"bad reason", `{"commitment_date":"2099-01-05","reason":"unknown"}`, tag, uuid.NewString(), member.token, 400, "invalid_request"},
		{"bad date", `{"commitment_date":"2099-02-30","reason":"client_request"}`, tag, uuid.NewString(), member.token, 400, "invalid_request"},
		{"unknown", `{"commitment_date":"2099-01-05","reason":"client_request","extra":1}`, tag, uuid.NewString(), member.token, 400, "invalid_request"},
		{"nonmember", body, tag, uuid.NewString(), outsider.token, 404, "not_found"},
	} {
		reject(tc.name, "POST", path, tc.body, tc.token, headers(tc.tag, tc.key), tc.status, tc.code)
	}
	reject("missing tag", "POST", path, body, member.token, map[string]string{"Idempotency-Key": uuid.NewString()}, 428, "precondition_required")
	reject("missing key", "POST", path, body, member.token, map[string]string{"If-Match": tag}, 400, "idempotency_key_required")
	changed := draftFlowObject(t, delivery.body)
	putBody, _ := json.Marshal(map[string]any{"cutoffStageId": changed["cutoffStageId"], "targetQuantity": 6, "commitmentDate": "2099-01-05"})
	reject("put date blocked", "PUT", base+"/pipeline/delivery", string(putBody), member.token, map[string]string{"If-Match": tag}, 409, "commitment_change_requires_renegotiation")
	// Force the audit insert to fail after the domain writes, through HTTP.
	constraint := "commitment_test_" + uuid.NewString()[:8]
	if _, err := h.pool.Exec(context.Background(), fmt.Sprintf(`ALTER TABLE audit_events ADD CONSTRAINT %s CHECK (entity_id <> '%s'::uuid OR event_type <> 'VacancyCommitmentRenegotiated') NOT VALID`, constraint, id)); err != nil {
		t.Fatal(err)
	}
	cleanup := func() {
		t.Helper()
		if _, err := h.pool.Exec(context.Background(), fmt.Sprintf(`ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS %s`, constraint)); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(cleanup)
	reject("audit rollback", "POST", path, body, member.token, headers(tag, uuid.NewString()), 500, "internal_error")
	cleanup()
	key := uuid.NewString()
	success := h.do(t, "POST", path, body, member.token, headers(tag, key))
	if success.status != 200 || success.header.Get("ETag") == tag || success.header.Get("Idempotency-Replayed") != "false" {
		t.Fatalf("success %d %s %v", success.status, success.body, success.header)
	}
	got := h.do(t, "GET", base+"/pipeline/delivery", "", member.token, nil)
	if !bytes.Equal(success.body, got.body) || success.header.Get("ETag") != got.header.Get("ETag") {
		t.Fatal("not delivery representation")
	}
	expected := draftFlowObject(t, delivery.body)
	expected["commitmentDate"] = "2099-01-05"
	expected["version"] = "2"
	if !reflect.DeepEqual(expected, draftFlowObject(t, success.body)) {
		t.Fatalf("body %s", success.body)
	}
	var changeID, note, previous, date, reason, actor string
	if err := h.pool.QueryRow(context.Background(), `SELECT id::text,note,previous_date::text,new_date::text,reason,performed_by::text FROM vacancy_commitment_changes WHERE draft_id=$1`, id).Scan(&changeID, &note, &previous, &date, &reason, &actor); err != nil {
		t.Fatal(err)
	}
	if note != "private explanation" || previous != original || date != "2099-01-05" || reason != "other" || actor != memberID.String() {
		t.Fatal("change row", note, previous, date, reason, actor)
	}
	var raw []byte
	if err := h.pool.QueryRow(context.Background(), `SELECT metadata FROM audit_events WHERE entity_id=$1 AND entity_type='vacancy' AND event_type='VacancyCommitmentRenegotiated'`, id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var meta map[string]string
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(meta, map[string]string{"company_id": company.companyID.String(), "change_id": changeID, "previous_date": original, "new_date": "2099-01-05", "reason": "other"}) {
		t.Fatal(meta)
	}
	before := commitmentSnapshot(t, h, id)
	replay := h.do(t, "POST", path, body, member.token, map[string]string{"Idempotency-Key": key})
	if replay.status != 200 || replay.header.Get("Idempotency-Replayed") != "true" || replay.header.Get("ETag") != success.header.Get("ETag") || !bytes.Equal(replay.body, success.body) || before != commitmentSnapshot(t, h, id) {
		t.Fatalf("replay %d %s", replay.status, replay.body)
	}
	reject("key conflict", "POST", path, `{"commitment_date":"2099-01-06","reason":"scope_change"}`, member.token, headers(tag, key), 409, "idempotency_conflict")
	// Owner outside the team can renegotiate; ordinary fields still use PUT with the unchanged date.
	second := h.do(t, "POST", path, `{"commitment_date":"2099-01-06","reason":"scope_change"}`, owner.token, headers(success.header.Get("ETag"), uuid.NewString()))
	if second.status != 200 {
		t.Fatalf("owner %d %s", second.status, second.body)
	}
	putBody, _ = json.Marshal(map[string]any{"cutoffStageId": changed["cutoffStageId"], "targetQuantity": 6, "commitmentDate": "2099-01-06"})
	put := h.do(t, "PUT", base+"/pipeline/delivery", string(putBody), member.token, map[string]string{"If-Match": second.header.Get("ETag")})
	if put.status != 200 {
		t.Fatalf("unchanged date put %d %s", put.status, put.body)
	}
	before = commitmentSnapshot(t, h, id)
	replay = h.do(t, "POST", path, body, member.token, map[string]string{"Idempotency-Key": key})
	if replay.status != 200 || !bytes.Equal(replay.body, success.body) || replay.header.Get("ETag") != success.header.Get("ETag") || replay.header.Get("Idempotency-Replayed") != "true" || before != commitmentSnapshot(t, h, id) {
		t.Fatal("later update changed frozen replay")
	}
	if n := draftFlowCount(t, h.pool, `SELECT count(*) FROM vacancy_commitment_changes WHERE draft_id=$1`, id); n != 2 {
		t.Fatal("replay cardinality", n)
	}
	// Missing configuration is tested on an intentionally incomplete published fixture.
	if _, err := h.pool.Exec(context.Background(), `DELETE FROM job_draft_delivery_configs WHERE draft_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	reject("no delivery", "POST", path, body, member.token, headers(deliveryconfig.ETag(uuid.MustParse(id), 0), uuid.NewString()), 409, "delivery_not_configured")
}
