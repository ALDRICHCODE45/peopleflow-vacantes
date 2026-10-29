//go:build integration

package main

import (
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/profile"
	"github.com/google/uuid"
)

func TestPsychometricProfileFlowPausedAndClosedOngoingRemainEditable(t *testing.T) {
	h := profileHarness(t)
	_, uid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, uid, sub)
	id := publicationFlowReady(t, h, owner)
	base := draftFlowV2Path + "/" + id
	path := base + "/psychometric-profile"
	publicFlowPublish(t, h, id, owner)
	tag := profile.ETag(uuid.MustParse(id), 0)
	version := int64(0)
	for _, tc := range []struct{ action, body string }{
		{"pause", `{}`},
		{"resume", `{}`},
		{"close", `{"process":"continue","reason":"cancelled","reason_note":null}`},
	} {
		t.Run(tc.action, func(t *testing.T) {
			current := h.do(t, "GET", base+"/lifecycle", "", owner.token, nil)
			changed := h.do(t, "POST", base+"/lifecycle/"+tc.action, tc.body, owner.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
			if changed.status != 200 {
				t.Fatalf("lifecycle=%d %s", changed.status, changed.body)
			}
			m := profileBody(t)
			m["enabled"] = version%2 == 0
			saved := h.do(t, "PUT", path, profileEncode(t, m), owner.token, map[string]string{"If-Match": tag})
			version++
			profileAssert(t, saved, id, version)
			tag = saved.header.Get("ETag")
			profileAssert(t, h.do(t, "GET", path, "", owner.token, nil), id, version)
		})
	}
}
