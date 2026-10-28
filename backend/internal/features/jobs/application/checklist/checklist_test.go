package checklist

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

const (
	c1       = "11111111-1111-4111-8111-111111111111"
	c2       = "22222222-2222-4222-8222-222222222222"
	question = "33333333-3333-4333-8333-333333333333"
	optionA  = "44444444-4444-4444-8444-444444444444"
	optionB  = "55555555-5555-4555-8555-555555555555"
	stage    = "66666666-6666-4666-8666-666666666666"
)

type fakeGeo struct{}

func (fakeGeo) CountryExists(code string) (bool, error) { return code == "MX", nil }
func (fakeGeo) StateExists(country, state string) (bool, error) {
	return country == "MX" && (state == "09" || state == "15"), nil
}

func rules() Rules {
	return Rules{
		Questions: []Question{{ID: strings.ToUpper(question), Options: []string{optionA, optionB}}},
		Stages:    []string{stage},
		Geo:       fakeGeo{},
	}
}

func criterion(id, kind, params string) string {
	return `{"id":"` + id + `","label":"  Criterio  ","importance":"required","kind":"` + kind + `","params":` + params + `}`
}

func body(criteria ...string) []byte {
	return []byte(`{"criteria":[` + strings.Join(criteria, ",") + `],"reminder_stage_ids":[]}`)
}

func fieldsOf(t *testing.T, err error) []Field {
	t.Helper()
	var invalid *Invalid
	if !errors.As(err, &invalid) {
		t.Fatalf("want *Invalid, got %v", err)
	}
	return invalid.Fields
}

func wantField(t *testing.T, err error, field, code string) {
	t.Helper()
	for _, f := range fieldsOf(t, err) {
		if f.Field == field && f.Code == code {
			return
		}
	}
	t.Fatalf("want field %s=%s, got %+v", field, code, fieldsOf(t, err))
}

func TestReplaceNormalizesEveryKind(t *testing.T) {
	ids := []string{
		"a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000002",
		"a0000000-0000-4000-8000-000000000003", "a0000000-0000-4000-8000-000000000004",
		"a0000000-0000-4000-8000-000000000005", "a0000000-0000-4000-8000-000000000006",
		"a0000000-0000-4000-8000-000000000007", strings.ToUpper("a0000000-0000-4000-8000-000000000008"),
	}
	raw := []byte(`{"criteria":[` + strings.Join([]string{
		criterion(ids[0], "min_years_experience", `{"min":"2.0"}`),
		criterion(ids[1], "seniority", `{"accepted":["senior","lead"]}`),
		criterion(ids[2], "education", `{"min_level":"bachelor","accepts_in_progress":true}`),
		criterion(ids[3], "language", `{"code":"en","min_level":"B2"}`),
		criterion(ids[4], "skill", `{"name":"  SQL "}`),
		criterion(ids[5], "location", `{"country":"MX","states":["09"]}`),
		criterion(ids[6], "screening_answer", `{"question_id":"`+question+`","accepted_option_ids":["`+strings.ToUpper(optionA)+`"]}`),
		criterion(ids[7], "manual", `{}`),
	}, ",") + `],"reminder_stage_ids":["` + strings.ToUpper(stage) + `"]}`)
	got, err := Replace(raw, rules())
	if err != nil {
		t.Fatalf("Replace: %v", err)
	}
	encoded, _ := json.Marshal(got)
	want := `{"criteria":[` +
		`{"id":"` + ids[0] + `","label":"Criterio","importance":"required","kind":"min_years_experience","params":{"min":"2"}},` +
		`{"id":"` + ids[1] + `","label":"Criterio","importance":"required","kind":"seniority","params":{"accepted":["senior","lead"]}},` +
		`{"id":"` + ids[2] + `","label":"Criterio","importance":"required","kind":"education","params":{"min_level":"bachelor","accepts_in_progress":true}},` +
		`{"id":"` + ids[3] + `","label":"Criterio","importance":"required","kind":"language","params":{"code":"en","min_level":"B2"}},` +
		`{"id":"` + ids[4] + `","label":"Criterio","importance":"required","kind":"skill","params":{"name":"SQL"}},` +
		`{"id":"` + ids[5] + `","label":"Criterio","importance":"required","kind":"location","params":{"country":"MX","states":["09"]}},` +
		`{"id":"` + ids[6] + `","label":"Criterio","importance":"required","kind":"screening_answer","params":{"question_id":"` + strings.ToUpper(question) + `","accepted_option_ids":["` + optionA + `"]}},` +
		`{"id":"` + strings.ToLower(ids[7]) + `","label":"Criterio","importance":"required","kind":"manual","params":{}}` +
		`],"reminder_stage_ids":["` + stage + `"]}`
	if string(encoded) != want {
		t.Fatalf("normalized checklist\n got %s\nwant %s", encoded, want)
	}
}

func TestReplaceRejectsWithFieldErrors(t *testing.T) {
	cases := []struct {
		name, body, field, code string
	}{
		{"missing criteria", `{"reminder_stage_ids":[]}`, "criteria", "required"},
		{"unknown top key", `{"criteria":[],"reminder_stage_ids":[],"x":1}`, "x", "not_allowed"},
		{"missing reminders", `{"criteria":[]}`, "reminder_stage_ids", "required"},
		{"bad id", string(body(criterion("nope", "manual", `{}`))), "criteria[0].id", "invalid"},
		{"duplicate id", string(body(criterion(c1, "manual", `{}`), criterion(c1, "manual", `{}`))), "criteria[1].id", "duplicate"},
		{"empty label", `{"criteria":[{"id":"` + c1 + `","label":"  ","importance":"required","kind":"manual","params":{}}],"reminder_stage_ids":[]}`, "criteria[0].label", "required"},
		{"long label", `{"criteria":[{"id":"` + c1 + `","label":"` + strings.Repeat("á", 201) + `","importance":"required","kind":"manual","params":{}}],"reminder_stage_ids":[]}`, "criteria[0].label", "too_long"},
		{"bad importance", `{"criteria":[{"id":"` + c1 + `","label":"x","importance":"high","kind":"manual","params":{}}],"reminder_stage_ids":[]}`, "criteria[0].importance", "invalid"},
		{"bad kind", string(body(criterion(c1, "salary", `{}`))), "criteria[0].kind", "invalid"},
		{"unknown criterion key", `{"criteria":[{"id":"` + c1 + `","label":"x","importance":"required","kind":"manual","params":{},"extra":1}],"reminder_stage_ids":[]}`, "criteria[0].extra", "not_allowed"},
		{"manual param", string(body(criterion(c1, "manual", `{"a":1}`))), "criteria[0].params.a", "not_allowed"},
		{"missing params", `{"criteria":[{"id":"` + c1 + `","label":"x","importance":"required","kind":"manual"}],"reminder_stage_ids":[]}`, "criteria[0].params", "required"},
		{"bad years", string(body(criterion(c1, "min_years_experience", `{"min":"61"}`))), "criteria[0].params.min", "invalid"},
		{"years number", string(body(criterion(c1, "min_years_experience", `{"min":3}`))), "criteria[0].params.min", "invalid"},
		{"empty seniority", string(body(criterion(c1, "seniority", `{"accepted":[]}`))), "criteria[0].params.accepted", "required"},
		{"bad seniority", string(body(criterion(c1, "seniority", `{"accepted":["guru"]}`))), "criteria[0].params.accepted[0]", "invalid"},
		{"dup seniority", string(body(criterion(c1, "seniority", `{"accepted":["lead","lead"]}`))), "criteria[0].params.accepted[1]", "duplicate"},
		{"education flag", string(body(criterion(c1, "education", `{"min_level":"bachelor"}`))), "criteria[0].params.accepts_in_progress", "required"},
		{"education level", string(body(criterion(c1, "education", `{"min_level":"x","accepts_in_progress":false}`))), "criteria[0].params.min_level", "invalid"},
		{"language code case", string(body(criterion(c1, "language", `{"code":"EN","min_level":"B2"}`))), "criteria[0].params.code", "invalid"},
		{"language level", string(body(criterion(c1, "language", `{"code":"en","min_level":"B3"}`))), "criteria[0].params.min_level", "invalid"},
		{"dup language", string(body(criterion(c1, "language", `{"code":"en","min_level":"B2"}`), criterion(c2, "language", `{"code":"en","min_level":"C1"}`))), "criteria[1].params.code", "duplicate"},
		{"long skill", string(body(criterion(c1, "skill", `{"name":"`+strings.Repeat("x", 61)+`"}`))), "criteria[0].params.name", "too_long"},
		{"dup skill accents", string(body(criterion(c1, "skill", `{"name":"Diseño"}`), criterion(c2, "skill", `{"name":" DISENO "}`))), "criteria[1].params.name", "duplicate"},
		{"bad country", string(body(criterion(c1, "location", `{"country":"US","states":[]}`))), "criteria[0].params.country", "invalid"},
		{"bad state", string(body(criterion(c1, "location", `{"country":"MX","states":["99"]}`))), "criteria[0].params.states[0]", "invalid"},
		{"missing states", string(body(criterion(c1, "location", `{"country":"MX"}`))), "criteria[0].params.states", "required"},
		{"second location", string(body(criterion(c1, "location", `{"country":"MX","states":[]}`), criterion(c2, "location", `{"country":"MX","states":["15"]}`))), "criteria[1].kind", "duplicate"},
		{"unknown question", string(body(criterion(c1, "screening_answer", `{"question_id":"`+c2+`","accepted_option_ids":["`+optionA+`"]}`))), "criteria[0].params.question_id", "invalid"},
		{"unknown option", string(body(criterion(c1, "screening_answer", `{"question_id":"`+question+`","accepted_option_ids":["`+c2+`"]}`))), "criteria[0].params.accepted_option_ids[0]", "invalid"},
		{"no options", string(body(criterion(c1, "screening_answer", `{"question_id":"`+question+`","accepted_option_ids":[]}`))), "criteria[0].params.accepted_option_ids", "required"},
		{"dup question", string(body(criterion(c1, "screening_answer", `{"question_id":"`+question+`","accepted_option_ids":["`+optionA+`"]}`), criterion(c2, "screening_answer", `{"question_id":"`+question+`","accepted_option_ids":["`+optionB+`"]}`))), "criteria[1].params.question_id", "duplicate"},
		{"bad stage", `{"criteria":[],"reminder_stage_ids":["` + c1 + `"]}`, "reminder_stage_ids[0]", "invalid"},
		{"dup stage", `{"criteria":[],"reminder_stage_ids":["` + stage + `","` + stage + `"]}`, "reminder_stage_ids[1]", "duplicate"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Replace([]byte(tc.body), rules())
			wantField(t, err, tc.field, tc.code)
		})
	}
}

func TestReplaceLimitsCriteria(t *testing.T) {
	items := make([]string, MaxCriteria+1)
	for i := range items {
		items[i] = criterion(uuid.NewString(), "manual", `{}`)
	}
	_, err := Replace(body(items...), rules())
	wantField(t, err, "criteria", "too_long")
}

func TestReplaceRejectsNonObjectBody(t *testing.T) {
	for _, raw := range []string{`[]`, `nope`, `{"criteria":[]} x`} {
		if _, err := Replace([]byte(raw), rules()); !errors.Is(err, drafts.ErrInvalidRequest) {
			t.Fatalf("%q: want ErrInvalidRequest, got %v", raw, err)
		}
	}
}

func TestVisibleDropsRetiredReminderStages(t *testing.T) {
	c := Checklist{Criteria: []Criterion{}, ReminderStageIDs: []string{stage, c1}}
	got := c.Visible([]string{stage})
	if len(got.ReminderStageIDs) != 1 || got.ReminderStageIDs[0] != stage || len(c.ReminderStageIDs) != 2 {
		t.Fatalf("Visible = %+v (source %+v)", got, c)
	}
}

func TestEmptyEncodesArrays(t *testing.T) {
	encoded, _ := json.Marshal(Empty())
	if string(encoded) != `{"criteria":[],"reminder_stage_ids":[]}` {
		t.Fatalf("Empty = %s", encoded)
	}
}

func TestETagIsOpaqueAndVersioned(t *testing.T) {
	id := uuid.MustParse(c1)
	a, b := ETag(id, 0), ETag(id, 1)
	if a == b || !strings.HasPrefix(a, `"vc1-`) || !strings.HasSuffix(a, `"`) || strings.Contains(a, c1) {
		t.Fatalf("ETag = %s / %s", a, b)
	}
}

func TestDecodeMark(t *testing.T) {
	got, err := DecodeMark([]byte(`{"verdict":"met","note":"  buen nivel  "}`))
	if err != nil || got.Verdict != "met" || got.Note == nil || *got.Note != "buen nivel" {
		t.Fatalf("DecodeMark = %+v, %v", got, err)
	}
	got, err = DecodeMark([]byte(`{"verdict":"not_met","note":"   "}`))
	if err != nil || got.Note != nil {
		t.Fatalf("blank note = %+v, %v", got, err)
	}
	got, err = DecodeMark([]byte(`{"verdict":"not_met"}`))
	if err != nil || got.Note != nil {
		t.Fatalf("missing note = %+v, %v", got, err)
	}
	cases := []struct{ body, field, code string }{
		{`{}`, "verdict", "required"},
		{`{"verdict":"maybe"}`, "verdict", "invalid"},
		{`{"verdict":"met","note":` + `"` + strings.Repeat("ñ", 501) + `"}`, "note", "too_long"},
		{`{"verdict":"met","note":5}`, "note", "invalid"},
		{`{"verdict":"met","x":1}`, "x", "not_allowed"},
	}
	for _, tc := range cases {
		_, err := DecodeMark([]byte(tc.body))
		wantField(t, err, tc.field, tc.code)
	}
	if _, err := DecodeMark([]byte(`[]`)); !errors.Is(err, drafts.ErrInvalidRequest) {
		t.Fatalf("array mark: %v", err)
	}
}
