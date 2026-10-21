package board

import (
	"encoding/json"
	"testing"
)

func TestOrganicItemOriginWire(t *testing.T) {
	var item Item
	if err := json.Unmarshal([]byte(`{"source":"organic","candidate":{"kind":"organic"}}`), &item); err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]any{"item": item, "mutation": Moved{Item: item}} {
		t.Run(name, func(t *testing.T) {
			raw, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			var got map[string]any
			if err := json.Unmarshal(raw, &got); err != nil {
				t.Fatal(err)
			}
			if v, ok := got["added_by"]; !ok || v != nil {
				t.Errorf("added_by = %v, present %v; want explicit null", v, ok)
			}
			if got["candidate"].(map[string]any)["kind"] != "organic" {
				t.Errorf("candidate = %v; want organic kind", got["candidate"])
			}
		})
	}
}
