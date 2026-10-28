//go:build integration

package main

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/checklist"
	"github.com/google/uuid"
)

func checklistCriterion(id, kind, params string) string {
	return `{"id":"` + id + `","label":"Criterio","importance":"required","kind":"` + kind + `","params":` + params + `}`
}
func checklistCriteriaBody(criteria ...string) string {
	return `{"criteria":[` + strings.Join(criteria, ",") + `],"reminder_stage_ids":[]}`
}

func TestChecklistFlowVacancyRulesAndExactValidationFields(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, uid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, uid, sub)
	q, open, a, b := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	questions := fmt.Sprintf(`[{"id":%q,"type":"open","prompt":"Why?"},{"id":%q,"type":"single_choice_evaluated","prompt":"Choose","options":[{"id":%q,"label":"A"},{"id":%q,"label":"B"}],"correct_option_id":%q}]`, open, q, a, b, a)
	id := draftListFlowCreate(t, h, owner, `{"fields":{"screening_questions":`+questions+`}}`)
	path := draftFlowV2Path + "/" + id + "/checklist"
	cid := uuid.NewString()
	cases := []struct{ name, body, field, code string }{
		{"required", `{"reminder_stage_ids":[]}`, "criteria", "required"},
		{"unknown param", checklistCriteriaBody(checklistCriterion(cid, "manual", `{"x":1}`)), "criteria[0].params.x", "not_allowed"},
		{"invalid years", checklistCriteriaBody(checklistCriterion(cid, "min_years_experience", `{"min":3}`)), "criteria[0].params.min", "invalid"},
		{"long skill", checklistCriteriaBody(checklistCriterion(cid, "skill", `{"name":"`+strings.Repeat("á", 61)+`"}`)), "criteria[0].params.name", "too_long"},
		{"duplicate", checklistCriteriaBody(checklistCriterion(cid, "manual", `{}`), checklistCriterion(cid, "manual", `{}`)), "criteria[1].id", "duplicate"},
		{"unknown question", checklistCriteriaBody(checklistCriterion(cid, "screening_answer", `{"question_id":"`+uuid.NewString()+`","accepted_option_ids":["`+a+`"]}`)), "criteria[0].params.question_id", "invalid"},
		{"open question", checklistCriteriaBody(checklistCriterion(cid, "screening_answer", `{"question_id":"`+open+`","accepted_option_ids":["`+a+`"]}`)), "criteria[0].params.question_id", "invalid"},
		{"foreign option", checklistCriteriaBody(checklistCriterion(cid, "screening_answer", `{"question_id":"`+q+`","accepted_option_ids":["`+uuid.NewString()+`"]}`)), "criteria[0].params.accepted_option_ids[0]", "invalid"},
		{"unknown country", checklistCriteriaBody(checklistCriterion(cid, "location", `{"country":"ZZ","states":[]}`)), "criteria[0].params.country", "invalid"},
		{"foreign state", checklistCriteriaBody(checklistCriterion(cid, "location", `{"country":"MX","states":["ZZ"]}`)), "criteria[0].params.states[0]", "invalid"},
		{"unknown reminder", `{"criteria":[],"reminder_stage_ids":["` + uuid.NewString() + `"]}`, "reminder_stage_ids[0]", "invalid"},
	}
	before := checklistFlowSnapshot(t, h, id)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := h.do(t, "PUT", path, tc.body, owner.token, map[string]string{"If-Match": checklist.ETag(uuid.MustParse(id), 0)})
			draftFlowAssertNoStore(t, r)
			obj := draftFlowObject(t, r.body)
			want := []any{map[string]any{"field": tc.field, "code": tc.code}}
			if r.status != 400 || len(obj) != 3 || obj["error"] != "validation failed" || obj["code"] != "validation_error" || !reflect.DeepEqual(obj["fields"], want) {
				t.Fatalf("validation=%d %s want=%v", r.status, r.body, want)
			}
			if before != checklistFlowSnapshot(t, h, id) {
				t.Fatal("validation changed storage/audit")
			}
		})
	}
	kinds := []struct{ kind, params string }{
		{"min_years_experience", `{"min":"2.0"}`}, {"seniority", `{"accepted":["senior","lead"]}`}, {"education", `{"min_level":"bachelor","accepts_in_progress":true}`}, {"language", `{"code":"en","min_level":"B2"}`}, {"skill", `{"name":"SQL"}`}, {"location", `{"country":"MX","states":["09"]}`}, {"screening_answer", `{"question_id":"` + q + `","accepted_option_ids":["` + a + `"]}`}, {"manual", `{}`},
	}
	criteria := []string{}
	for _, kind := range kinds {
		criteria = append(criteria, checklistCriterion(uuid.NewString(), kind.kind, kind.params))
	}
	saved := h.do(t, "PUT", path, checklistCriteriaBody(criteria...), owner.token, map[string]string{"If-Match": checklist.ETag(uuid.MustParse(id), 0)})
	c := checklistFlowAssert(t, saved, id, 1)
	if len(c.Criteria) != 8 || string(c.Criteria[0].Params) != `{"min":"2"}` {
		t.Fatal(c)
	}
	before = checklistFlowSnapshot(t, h, id)
	noop := h.do(t, "PUT", path, checklistCriteriaBody(criteria...), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	checklistFlowAssert(t, noop, id, 1)
	if before != checklistFlowSnapshot(t, h, id) {
		t.Fatal("identical all-kind checklist changed storage/audit")
	}
	// A deleted screening question remains readable, but the next replacement rejects it.
	draft := h.do(t, "GET", draftFlowV2Path+"/"+id, "", owner.token, nil)
	patched := h.do(t, "PATCH", draftFlowV2Path+"/"+id, `{"fields":{"screening_questions":[]}}`, owner.token, map[string]string{"If-Match": draft.header.Get("ETag")})
	if patched.status != 200 {
		t.Fatal(patched.status, string(patched.body))
	}
	checklistFlowAssert(t, h.do(t, "GET", path, "", owner.token, nil), id, 1)
	rejected := h.do(t, "PUT", path, checklistCriteriaBody(criteria...), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	if rejected.status != 400 {
		t.Fatal(rejected.status, string(rejected.body))
	}
}
