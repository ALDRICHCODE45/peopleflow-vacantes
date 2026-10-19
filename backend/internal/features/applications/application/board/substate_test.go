package board

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/google/uuid"
)

func TestSubstateDecodeAndStageRules(t *testing.T) {
	id := uuid.NewString()
	for _, tc := range []struct {
		name, body string
		valid      bool
	}{
		{"set", `{"substate_id":"` + id + `"}`, true}, {"clear", `{"substate_id":null}`, true},
		{"missing", `{}`, false}, {"unknown", `{"substate_id":null,"extra":true}`, false},
		{"duplicate", `{"substate_id":null,"substate_id":null}`, false}, {"escaped duplicate", `{"substate_id":null,"substate_\u0069d":null}`, false},
		{"wrong type", `{"substate_id":1}`, false}, {"array", `[]`, false}, {"null root", `null`, false},
		{"malformed uuid", `{"substate_id":"bad"}`, false}, {"nil uuid", `{"substate_id":"00000000-0000-0000-0000-000000000000"}`, false},
		{"trailing", `{"substate_id":null}{}`, false}, {"invalid unicode", `{"substate_id":"\ud800"}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			target, err := DecodeSubstate([]byte(tc.body), draftjson.Decode)
			if (err == nil) != tc.valid || (!tc.valid && !errors.Is(err, ErrInvalidRequest)) {
				t.Fatal(target, err)
			}
			if tc.name == "set" && (target == nil || *target != id) {
				t.Fatal(target)
			}
		})
	}
	for _, kind := range []string{"new", "screening", "screening_ok", "custom", "in_process", "placement", "discarded"} {
		t.Run(kind, func(t *testing.T) {
			p := Pipeline{Stages: []Stage{{ID: "stage", Kind: kind, Name: "Renamed"}}}
			err := RequiresInProcess(p, "stage")
			if (err == nil) != (kind == "in_process") {
				t.Fatal(err)
			}
		})
	}
}

func TestSubstateHistoryExactUnion(t *testing.T) {
	// Decode a stored entry through the public history model, then assert its wire union.
	var e Entry
	if err := json.Unmarshal([]byte(`{"kind":"substate","from_substate_id":null,"from_substate_name":null,"to_substate_id":"a","to_substate_name":"Interview","actor":{"kind":"recruiter","id":"00000000-0000-0000-0000-000000000001","full_name":"Recruiter"}}`), &e); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}
	var obj map[string]any
	if err = json.Unmarshal(raw, &obj); err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{"kind": true, "from_substate_id": true, "from_substate_name": true, "to_substate_id": true, "to_substate_name": true, "actor": true, "at": true}
	got := map[string]bool{}
	for key := range obj {
		got[key] = true
	}
	if !reflect.DeepEqual(got, want) || obj["to_substate_name"] != "Interview" || obj["from_substate_id"] != nil {
		t.Fatalf("substate union: %s", raw)
	}
}
