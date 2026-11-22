package board_test

import (
	"encoding/json"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
)

// The mutation response gains `lifecycle` only on a Placement departure
// (docs/contracts/replacement-processes-v1.md, D7); every other response keeps its keys.
func TestMovedLifecycleKeyIsOptional(t *testing.T) {
	var absent map[string]json.RawMessage
	body, err := json.Marshal(app.Moved{})
	if err != nil || json.Unmarshal(body, &absent) != nil {
		t.Fatal(err, string(body))
	}
	if _, ok := absent["lifecycle"]; ok || len(absent) != 16 {
		t.Fatal("a response without a departure must keep its 16 keys (15 + carried_from_participation_id)", absent)
	}
	if string(absent["carried_from_participation_id"]) != "null" {
		t.Fatal("carried_from_participation_id must be present and null", absent)
	}
	var present map[string]json.RawMessage
	body, err = json.Marshal(app.Moved{Lifecycle: json.RawMessage(`{"can_start_replacement":true}`)})
	if err != nil || json.Unmarshal(body, &present) != nil {
		t.Fatal(err, string(body))
	}
	if string(present["lifecycle"]) != `{"can_start_replacement":true}` || len(present) != 17 {
		t.Fatal(present)
	}
}

func TestPipelineStageKind(t *testing.T) {
	p := app.Pipeline{Stages: []app.Stage{{ID: "a", Kind: "new"}, {ID: "b", Kind: "placement"}}, Exit: app.Stage{ID: "x", Kind: "discarded"}}
	for id, want := range map[string]string{"a": "new", "b": "placement", "x": "", "other": ""} {
		if got := p.StageKind(id); got != want {
			t.Fatalf("StageKind(%q) = %q, want %q", id, got, want)
		}
	}
}
