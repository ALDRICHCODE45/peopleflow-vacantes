//go:build integration

package main

import (
	"fmt"
	"reflect"
	"testing"
)

func profileL25Body(t *testing.T) map[string]any {
	t.Helper()
	m := profileBody(t)
	for _, x := range m["competencies"].([]any) {
		x.(map[string]any)["rationale"] = nil
	}
	return m
}
func TestPsychometricProfileL25NullDefaultsAndForbiddenFields(t *testing.T) {
	h := profileHarness(t)
	_, uid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, uid, sub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	path := draftFlowV2Path + "/" + id + "/psychometric-profile"
	first := h.do(t, "GET", path, "", owner.token, nil)
	got := profileAssert(t, first, id, 0)
	for _, x := range got["competencies"].([]any) {
		c := x.(map[string]any)
		if c["desired_band"] != nil || c["rationale"] != nil || c["task"] != nil {
			t.Fatalf("non-null default: %v", c)
		}
	}
	m := profileL25Body(t)
	m["confirmed"] = true
	saved := h.do(t, "PUT", path, profileEncode(t, m), owner.token, map[string]string{"If-Match": first.header.Get("ETag")})
	got = profileAssert(t, saved, id, 1)
	if got["confirmed"] != true || got["confirmed_at"] == nil {
		t.Fatal(got)
	}
	before := profileSnapshot(t, h, id)
	for _, confirmed := range []bool{false, true} {
		for _, tc := range []struct {
			importance, key string
			value           any
		}{
			{"importance.no_relevante", "desired_band", "band.high"},
			{"importance.no_relevante", "rationale", ""}, {"importance.no_relevante", "rationale", "Trabajo"},
			{"importance.no_relevante", "task", ""}, {"importance.no_relevante", "task", "Trabajo"},
			{"importance.importante", "task", ""}, {"importance.importante", "task", "Trabajo"},
		} {
			t.Run(fmt.Sprintf("%s/%s/%t/%v", tc.importance, tc.key, confirmed, tc.value), func(t *testing.T) {
				m := profileL25Body(t)
				m["confirmed"] = confirmed
				c := profileEntry(m)
				c["importance"] = tc.importance
				if tc.importance == "importance.importante" {
					c["desired_band"] = "band.low"
					c["rationale"] = "Trabajo"
				}
				c[tc.key] = tc.value
				r := h.do(t, "PUT", path, profileEncode(t, m), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
				draftFlowAssertNoStore(t, r)
				obj := draftFlowObject(t, r.body)
				want := []any{map[string]any{"field": "competencies[0]." + tc.key, "code": "not_allowed"}}
				if r.status != 400 || len(obj) != 3 || obj["error"] != "validation failed" || obj["code"] != "validation_error" || !reflect.DeepEqual(obj["fields"], want) {
					t.Fatalf("%d %s want=%v", r.status, r.body, want)
				}
				if before != profileSnapshot(t, h, id) {
					t.Fatal("rejection changed profile, version or audit")
				}
			})
		}
	}
	profileAssert(t, h.do(t, "PUT", path, profileEncode(t, m), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")}), id, 1)
	if before != profileSnapshot(t, h, id) {
		t.Fatal("confirmed null no-op wrote data/audit")
	}
}

func TestPsychometricProfileL25RelevantDraftEmptyAndConfirmation(t *testing.T) {
	h := profileHarness(t)
	_, uid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, uid, sub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	path := draftFlowV2Path + "/" + id + "/psychometric-profile"
	first := h.do(t, "GET", path, "", owner.token, nil)
	tag := first.header.Get("ETag")
	version := int64(0)
	for _, importance := range []string{"importance.clave", "importance.importante"} {
		for _, empty := range []any{nil, ""} {
			t.Run(fmt.Sprintf("%s/%v", importance, empty), func(t *testing.T) {
				m := profileL25Body(t)
				c := profileEntry(m)
				c["importance"] = importance
				c["desired_band"] = "band.high"
				c["rationale"] = empty
				if importance == "importance.clave" {
					c["task"] = ""
				}
				if empty == nil {
					if importance == "importance.clave" {
						c["task"] = "Tarea"
					}
					before := profileSnapshot(t, h, id)
					for _, confirmed := range []bool{false, true} {
						m["confirmed"] = confirmed
						rejected := h.do(t, "PUT", path, profileEncode(t, m), owner.token, map[string]string{"If-Match": tag})
						draftFlowAssertNoStore(t, rejected)
						obj := draftFlowObject(t, rejected.body)
						want := []any{map[string]any{"field": "competencies[0].rationale", "code": "invalid"}}
						if rejected.status != 400 || len(obj) != 3 || obj["code"] != "validation_error" || obj["error"] != "validation failed" || !reflect.DeepEqual(obj["fields"], want) {
							t.Fatalf("%d %s", rejected.status, rejected.body)
						}
						if before != profileSnapshot(t, h, id) {
							t.Fatal("null relevant rationale changed storage/version/audit")
						}
					}
					return
				}
				r := h.do(t, "PUT", path, profileEncode(t, m), owner.token, map[string]string{"If-Match": tag})
				version++
				got := profileAssert(t, r, id, version)
				tag = r.header.Get("ETag")
				if profileEntry(got)["rationale"] != empty || got["confirmed_at"] != nil {
					t.Fatal(got)
				}
				before := profileSnapshot(t, h, id)
				m["confirmed"] = true
				if importance == "importance.clave" {
					c["task"] = "Tarea"
				}
				rejected := h.do(t, "PUT", path, profileEncode(t, m), owner.token, map[string]string{"If-Match": tag})
				obj := draftFlowObject(t, rejected.body)
				want := []any{map[string]any{"field": "competencies[0].rationale", "code": "required"}}
				if rejected.status != 400 || obj["code"] != "validation_error" || obj["error"] != "validation failed" || !reflect.DeepEqual(obj["fields"], want) {
					t.Fatalf("%d %s", rejected.status, rejected.body)
				}
				if before != profileSnapshot(t, h, id) {
					t.Fatal("empty confirmed rationale changed storage/audit")
				}
				c["rationale"] = " a "
				r = h.do(t, "PUT", path, profileEncode(t, m), owner.token, map[string]string{"If-Match": tag})
				version++
				got = profileAssert(t, r, id, version)
				tag = r.header.Get("ETag")
				if profileEntry(got)["rationale"] != "a" || got["confirmed"] != true || got["confirmed_at"] == nil {
					t.Fatal(got)
				}
			})
		}
	}
}
