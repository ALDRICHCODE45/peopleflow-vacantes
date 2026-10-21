package lifecycle

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

func TestTransitionMatrix(t *testing.T) {
	states := []struct {
		name, publication, process string
		allowed                    []string
	}{
		{"draft", "", "", []string{"publish"}},
		{"published", "published", "active", []string{"pause", "close"}},
		{"paused", "paused", "active", []string{"resume", "close"}},
		{"closed active", "closed", "active", []string{"finish_process", "reopen"}},
		{"closed finished", "closed", "finished", []string{"reopen"}},
	}
	actions := []struct{ action, choice string }{{"pause", ""}, {"resume", ""}, {"close", "continue"}, {"close", "finish"}, {"finish_process", ""}, {"reopen", ""}}
	now := time.Date(2026, 10, 16, 18, 0, 0, 0, time.UTC)
	for _, state := range states {
		t.Run(state.name, func(t *testing.T) {
			current := View{Version: "1"}
			if state.publication != "" {
				current.Publication = &state.publication
				current.Process = &state.process
			}
			if got := AllowedActions(current); !reflect.DeepEqual(got, state.allowed) {
				t.Fatal(got, state.allowed)
			}
			for _, action := range actions {
				t.Run(action.action+action.choice, func(t *testing.T) {
					next, err := Transition(current, action.action, action.choice, now)
					valid := false
					for _, allowed := range state.allowed {
						if allowed == action.action {
							valid = true
						}
					}
					if !valid {
						var invalid *InvalidTransition
						if !errors.As(err, &invalid) || invalid.Action != action.action || !reflect.DeepEqual(invalid.Lifecycle, current) {
							t.Fatalf("invalid=%+v %v", invalid, err)
						}
						return
					}
					if err != nil || next.Version != "2" {
						t.Fatalf("next=%+v %v", next, err)
					}
					pub, process := state.publication, "active"
					switch action.action {
					case "pause":
						pub = "paused"
						if next.PausedAt == nil {
							t.Fatal("pause timestamp")
						}
					case "resume", "reopen":
						pub = "published"
						if next.PublishedAt == nil {
							t.Fatal("published timestamp")
						}
					case "close":
						pub = "closed"
						if action.choice == "finish" {
							process = "finished"
						}
						if next.ClosedAt == nil {
							t.Fatal("closed timestamp")
						}
					case "finish_process":
						process = "finished"
					}
					if *next.Publication != pub || *next.Process != process || !reflect.DeepEqual(next.AllowedActions, AllowedActions(next)) {
						t.Fatalf("next=%+v", next)
					}
					if process == "finished" && next.ProcessFinishedAt == nil {
						t.Fatal("finished timestamp")
					}
				})
			}
		})
	}
}
func TestETagAndPrecondition(t *testing.T) {
	id := uuid.New()
	tag := ETag(id, 1)
	if tag != `"vl-`+id.String()+`-v1"` {
		t.Fatal(tag)
	}
	for _, tc := range []struct {
		name, raw string
		present   bool
		want      error
	}{
		{"valid", tag, true, nil}, {"ows", " \t" + tag + " \t", true, nil}, {"missing", "", false, drafts.ErrPreconditionRequired},
		{"stale", ETag(id, 2), true, drafts.ErrVersionConflict}, {"foreign", ETag(uuid.New(), 1), true, drafts.ErrVersionConflict},
		{"unpublished tag stale", ETag(id, 0), true, drafts.ErrVersionConflict}, {"foreign unpublished", ETag(uuid.New(), 0), true, drafts.ErrVersionConflict},
		{"leading zero", strings.Replace(tag, "-v1", "-v01", 1), true, drafts.ErrInvalidRequest}, {"overflow", strings.Replace(tag, "-v1", "-v9223372036854775808", 1), true, drafts.ErrInvalidRequest},
		{"empty", "", true, drafts.ErrInvalidRequest}, {"weak", "W/" + tag, true, drafts.ErrInvalidRequest}, {"star", "*", true, drafts.ErrInvalidRequest}, {"list", tag + "," + tag, true, drafts.ErrInvalidRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := CheckPrecondition(id, 1, tc.raw, tc.present); !errors.Is(err, tc.want) {
				t.Fatal(err, tc.want)
			}
		})
	}
}
