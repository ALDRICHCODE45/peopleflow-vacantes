package board

import (
	"encoding/json"
	"testing"
)

func TestDeliverySummaryAlwaysOnBoardAndWrites(t *testing.T) {
	for _, value := range []any{Board{}, Moved{}} {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var root map[string]json.RawMessage
		if err = json.Unmarshal(raw, &root); err != nil {
			t.Fatal(err)
		}
		var summary map[string]any
		if err = json.Unmarshal(root["delivery"], &summary); err != nil || len(summary) != 3 {
			t.Fatalf("missing delivery summary: %s", raw)
		}
		for _, key := range []string{"state", "delivered", "target"} {
			if _, ok := summary[key]; !ok {
				t.Fatal(key, summary)
			}
		}
	}
}
