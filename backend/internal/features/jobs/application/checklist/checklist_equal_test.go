package checklist

import (
	"encoding/json"
	"testing"
)

func TestEqualIgnoresStoredJSONBObjectKeyOrder(t *testing.T) {
	original := Checklist{Criteria: []Criterion{{ID: c1, Label: "Location", Importance: "required", Kind: "location", Params: json.RawMessage(`{"country":"MX","states":["09","15"]}`)}}, ReminderStageIDs: []string{}}
	stored, err := Decode([]byte(`{"criteria":[{"id":"` + c1 + `","label":"Location","importance":"required","kind":"location","params":{"states":["09","15"],"country":"MX"}}],"reminder_stage_ids":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	if !original.Equal(stored) || !stored.Equal(original) {
		t.Fatal("JSONB reordered object keys must remain identical")
	}
	stored.Criteria[0].Params = json.RawMessage(`{"states":["15","09"],"country":"MX"}`)
	if original.Equal(stored) {
		t.Fatal("array order must remain significant")
	}
	stored.Criteria[0].Params = json.RawMessage(`{"states":["09","15"],"country":"US"}`)
	if original.Equal(stored) {
		t.Fatal("changed value must remain significant")
	}
}
