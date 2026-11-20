package lifecycle

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

func view(publication, process string) View {
	v := View{Version: "3", Publication: &publication, Process: &process}
	return v
}

func TestApplyReplacementDerivesTheKeysOfEachProcessOfAChain(t *testing.T) {
	root, first, second := uuid.New(), uuid.New(), uuid.New()
	str := func(id uuid.UUID) *string { s := id.String(); return &s }
	blocker := func(s string) *string { return &s }
	seq := func(n int) *int { return &n }
	vis := func(s string) *string { return &s }
	closed := func(process string) View { return view("closed", process) }
	for _, tc := range []struct {
		name  string
		view  View
		facts ReplacementFacts
		want  View
	}{
		{
			name:  "a never-published draft is an original without visibility",
			view:  View{Version: "0"},
			facts: ReplacementFacts{ProcessID: root, RootID: root, LatestID: root},
			want:  View{Kind: "original", RootProcessID: root.String(), StartReplacementBlocker: blocker(BlockerSourceNotClosed), AllowedActions: []string{"publish"}},
		},
		{
			name:  "an open original is public and not startable",
			view:  view("published", "active"),
			facts: ReplacementFacts{ProcessID: root, RootID: root, LatestID: root, Published: true, HasProjection: true},
			want:  View{Kind: "original", Visibility: vis("public"), RootProcessID: root.String(), StartReplacementBlocker: blocker(BlockerSourceNotClosed), AllowedActions: []string{"pause", "close"}},
		},
		{
			name:  "closed covered with a fallen credit starts, and cannot reopen",
			view:  closed("finished"),
			facts: ReplacementFacts{ProcessID: root, RootID: root, LatestID: root, Published: true, HasProjection: true, ClosedCovered: true, StartableCredits: 2},
			want:  View{Kind: "original", Visibility: vis("public"), RootProcessID: root.String(), ClosedCovered: true, CanStartReplacement: true, StartableCreditsCount: 2, AllowedActions: []string{}},
		},
		{
			name:  "closed covered but still active keeps finish_process only",
			view:  closed("active"),
			facts: ReplacementFacts{ProcessID: root, RootID: root, LatestID: root, Published: true, HasProjection: true, ClosedCovered: true, StartableCredits: 1},
			want:  View{Kind: "original", Visibility: vis("public"), RootProcessID: root.String(), ClosedCovered: true, CanStartReplacement: true, StartableCreditsCount: 1, AllowedActions: []string{"finish_process"}},
		},
		{
			name:  "closed not covered without credits reopens as today",
			view:  closed("active"),
			facts: ReplacementFacts{ProcessID: root, RootID: root, LatestID: root, Published: true, HasProjection: true},
			want:  View{Kind: "original", Visibility: vis("public"), RootProcessID: root.String(), StartReplacementBlocker: blocker(BlockerNoStartableCredit), AllowedActions: []string{"finish_process", "reopen"}},
		},
		{
			name:  "the original with an active successor is replacement_active and cannot reopen",
			view:  closed("finished"),
			facts: ReplacementFacts{ProcessID: root, RootID: root, LatestID: first, ActiveID: first, SuccessorID: first, Published: true, HasProjection: true, StartableCredits: 1},
			want:  View{Kind: "original", Visibility: vis("public"), RootProcessID: root.String(), StartReplacementBlocker: blocker(BlockerReplacementActive), StartableCreditsCount: 1, ActiveReplacementID: str(first), AllowedActions: []string{}},
		},
		{
			name:  "an older process of a finished chain is not_latest",
			view:  closed("finished"),
			facts: ReplacementFacts{ProcessID: root, RootID: root, LatestID: first, SuccessorID: first, Published: true, HasProjection: true, StartableCredits: 1},
			want:  View{Kind: "original", Visibility: vis("public"), RootProcessID: root.String(), StartReplacementBlocker: blocker(BlockerNotLatest), StartableCreditsCount: 1, AllowedActions: []string{}},
		},
		{
			name:  "a closed-active latest replacement is its own active one and starts and reopens",
			view:  closed("active"),
			facts: ReplacementFacts{ProcessID: second, RootID: root, Sequence: 2, SourceID: first, LatestID: second, ActiveID: second, Published: true, StartableCredits: 1},
			want: View{Kind: "replacement", Sequence: seq(2), ReplacementOf: str(first), Visibility: vis("private"), RootProcessID: root.String(), CanStartReplacement: true, StartableCreditsCount: 1,
				ActiveReplacementID: str(second), AllowedActions: []string{"finish_process", "reopen"}},
		},
		{
			name:  "an active replacement elsewhere blocks even the latest",
			view:  closed("finished"),
			facts: ReplacementFacts{ProcessID: second, RootID: root, Sequence: 2, SourceID: first, LatestID: second, ActiveID: first, Published: true, HasProjection: true, StartableCredits: 1},
			want: View{Kind: "replacement", Sequence: seq(2), ReplacementOf: str(first), Visibility: vis("public"), RootProcessID: root.String(), StartReplacementBlocker: blocker(BlockerReplacementActive),
				StartableCreditsCount: 1, ActiveReplacementID: str(first), AllowedActions: []string{}},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.view
			got.ApplyReplacement(tc.facts)
			got.otherActive, got.successorID = false, "" // unexported inputs are checked through the actions below
			tc.want.Version, tc.want.Publication, tc.want.Process = tc.view.Version, tc.view.Publication, tc.view.Process
			if !reflect.DeepEqual(got, tc.want) {
				g, _ := json.Marshal(got)
				w, _ := json.Marshal(tc.want)
				t.Fatalf("got  %s\nwant %s", g, w)
			}
		})
	}
}

func TestReopenGuardOrderAndScope(t *testing.T) {
	root, active, successor := uuid.New(), uuid.New(), uuid.New()
	apply := func(publication string, f ReplacementFacts) View {
		v := view(publication, "active")
		f.ProcessID, f.RootID, f.LatestID, f.Published = root, root, successor, true
		v.ApplyReplacement(f)
		return v
	}
	var covered *ReopenRequiresReplacement
	if err := apply("closed", ReplacementFacts{ClosedCovered: true, ActiveID: active, SuccessorID: successor}).ReopenGuard(); !errors.As(err, &covered) || covered.Action != "reopen" {
		t.Fatalf("covered wins: %v", err)
	}
	var already *ReplacementAlreadyActive
	if err := apply("closed", ReplacementFacts{ActiveID: active, SuccessorID: successor}).ReopenGuard(); !errors.As(err, &already) || already.ProcessID != active.String() || already.RootProcessID != root.String() {
		t.Fatalf("active wins over successor: %v", err)
	}
	var superseded *ReopenSuperseded
	if err := apply("closed", ReplacementFacts{SuccessorID: successor}).ReopenGuard(); !errors.As(err, &superseded) || superseded.SuccessorProcessID != successor.String() || superseded.RootProcessID != root.String() {
		t.Fatalf("successor: %v", err)
	}
	if err := apply("closed", ReplacementFacts{}).ReopenGuard(); err != nil {
		t.Fatalf("a plain closed process: %v", err)
	}
	// The process itself being the active replacement never blocks its own reopen.
	if err := apply("closed", ReplacementFacts{ActiveID: root}).ReopenGuard(); err != nil {
		t.Fatalf("own active replacement: %v", err)
	}
	// Only a closed process has a replacement guard; the generic invalid-transition check covers the rest.
	if err := apply("published", ReplacementFacts{ClosedCovered: true, ActiveID: active, SuccessorID: successor}).ReopenGuard(); err != nil {
		t.Fatalf("open process: %v", err)
	}
	if err := (View{}).ReopenGuard(); err != nil {
		t.Fatalf("never published: %v", err)
	}
}

func TestReplacementViewKeysAndErrorEnvelopes(t *testing.T) {
	v := view("closed", "finished")
	v.ApplyReplacement(ReplacementFacts{ProcessID: uuid.New(), RootID: uuid.New(), Published: true})
	raw, _ := json.Marshal(v)
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(raw, &keys); err != nil || len(keys) != 20 {
		t.Fatalf("%d keys: %s", len(keys), raw)
	}
	for _, key := range []string{"visibility", "kind", "sequence", "replacement_of", "root_process_id", "closed_covered", "can_start_replacement", "start_replacement_blocker", "startable_credits_count", "active_replacement_id"} {
		if _, ok := keys[key]; !ok {
			t.Errorf("missing %s", key)
		}
	}
	for name, e := range map[string]any{
		"requires": &ReopenRequiresReplacement{Action: "reopen", Lifecycle: v},
		"active":   &ReplacementAlreadyActive{ProcessID: "p", RootProcessID: "r", Lifecycle: v},
		"super":    &ReopenSuperseded{SuccessorProcessID: "s", RootProcessID: "r", Lifecycle: v},
	} {
		raw, _ := json.Marshal(e)
		var data map[string]json.RawMessage
		if err := json.Unmarshal(raw, &data); err != nil || data["lifecycle"] == nil {
			t.Errorf("%s: %s", name, raw)
		}
	}
	// The unexported guard inputs never reach the wire.
	if _, leaked := keys["otherActive"]; leaked {
		t.Fatal("unexported input serialized")
	}
}
