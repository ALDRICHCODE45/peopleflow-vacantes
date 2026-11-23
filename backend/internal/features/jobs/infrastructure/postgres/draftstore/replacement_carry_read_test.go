package draftstore

import (
	"encoding/json"
	"reflect"
	"testing"
)

// discard_reason is always present: {group,key} (the board item's discard.reason shape) or null.
func TestCarryCandidateDiscardReasonWire(t *testing.T) {
	for name, tc := range map[string]struct {
		in   carryCandidate
		want any
	}{
		"discarded":     {carryCandidate{Discarded: true, DiscardReason: &carryReason{Group: "candidate", Key: "unresponsive"}}, map[string]any{"group": "candidate", "key": "unresponsive"}},
		"not discarded": {carryCandidate{}, nil},
	} {
		raw, err := json.Marshal(tc.in)
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err = json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		reason, present := got["discard_reason"]
		if !present || !reflect.DeepEqual(reason, tc.want) {
			t.Fatalf("%s: discard_reason = %v (present %v), want %v in %s", name, reason, present, tc.want, raw)
		}
	}
}
