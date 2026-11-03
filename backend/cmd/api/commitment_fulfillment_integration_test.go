//go:build integration

package main

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestCommitmentPreservesFulfillmentSnapshot(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	base, path := boardCorrectionPaths(t, f)
	id := base[len(draftFlowV2Path)+1:]
	delivery := f.h.do(t, "GET", base+"/pipeline/delivery", "", f.owner.token, nil)
	c := draftFlowObject(t, delivery.body)
	raw, _ := json.Marshal(map[string]any{"cutoffStageId": c["cutoffStageId"], "targetQuantity": 1, "commitmentDate": c["commitmentDate"]})
	saved := f.h.do(t, "PUT", base+"/pipeline/delivery", string(raw), f.owner.token, map[string]string{"If-Match": delivery.header.Get("ETag")})
	if saved.status != 200 {
		t.Fatal(saved.status, string(saved.body))
	}
	item := boardCorrectionRead(t, f, path, f.owner)
	tag := draftFlowObject(t, item.body)["etag"].(string)
	cfg := pipelineconfig.Defaults(uuid.MustParse(id))
	for _, stage := range cfg.Stages[1:4] {
		r := f.h.do(t, "POST", path+"/moves", `{"to_stage_id":"`+stage.ID+`"}`, f.owner.token, map[string]string{"If-Match": tag})
		if r.status != 200 {
			t.Fatal(r.status, string(r.body))
		}
		tag = draftFlowObject(t, r.body)["etag"].(string)
	}
	status := f.h.do(t, "GET", base+"/pipeline/delivery/status", "", f.owner.token, nil)
	if status.status != 200 || draftFlowObject(t, status.body)["state"] != "fulfilled" {
		t.Fatal(status.status, string(status.body))
	}
	nextBody := `{"commitment_date":"2099-01-05","reason":"internal_delay"}`
	renegotiated := f.h.do(t, "POST", base+"/commitment", nextBody, f.owner.token, map[string]string{"If-Match": saved.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if renegotiated.status != 200 || draftFlowObject(t, renegotiated.body)["fulfilled"] != true {
		t.Fatal(renegotiated.status, string(renegotiated.body))
	}
	after := f.h.do(t, "GET", base+"/pipeline/delivery/status", "", f.owner.token, nil)
	if !bytes.Equal(status.body, after.body) {
		t.Fatal("frozen fulfillment changed", string(after.body))
	}
	// The published-date error takes precedence over the ordinary fulfilled lock.
	raw, _ = json.Marshal(map[string]any{"cutoffStageId": c["cutoffStageId"], "targetQuantity": 1, "commitmentDate": c["commitmentDate"]})
	before := commitmentSnapshot(t, f.h, id)
	rejected := f.h.do(t, "PUT", base+"/pipeline/delivery", string(raw), f.owner.token, map[string]string{"If-Match": renegotiated.header.Get("ETag")})
	draftFlowAssertCatalogError(t, rejected, 409, "commitment_change_requires_renegotiation")
	if before != commitmentSnapshot(t, f.h, id) {
		t.Fatal("rejected fulfilled PUT changed data")
	}
}
