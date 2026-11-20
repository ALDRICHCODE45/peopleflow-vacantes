package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
)

func TestWriteLifecycleErrorReplacementFamily(t *testing.T) {
	closed, active := "closed", "active"
	view := lifecycle.View{Publication: &closed, Process: &active, Version: "4", AllowedActions: []string{"finish_process"}}
	for name, tc := range map[string]struct {
		err  error
		code string
		keys []string
	}{
		"requires replacement": {&lifecycle.ReopenRequiresReplacement{Action: "reopen", Lifecycle: view}, "reopen_requires_replacement", []string{"action", "lifecycle"}},
		"already active":       {&lifecycle.ReplacementAlreadyActive{ProcessID: "p", RootProcessID: "r", Lifecycle: view}, "replacement_already_active", []string{"process_id", "root_process_id", "lifecycle"}},
		"superseded":           {&lifecycle.ReopenSuperseded{SuccessorProcessID: "s", RootProcessID: "r", Lifecycle: view}, "reopen_superseded", []string{"successor_process_id", "root_process_id", "lifecycle"}},
		"wrapped":              {fmt.Errorf("tx: %w", &lifecycle.ReopenSuperseded{SuccessorProcessID: "s", RootProcessID: "r", Lifecycle: view}), "reopen_superseded", []string{"successor_process_id", "root_process_id", "lifecycle"}},
	} {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			writeLifecycleError(rec, tc.err)
			var body struct {
				Code string                     `json:"code"`
				Data map[string]json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if rec.Code != 409 || body.Code != tc.code || len(body.Data) != len(tc.keys) {
				t.Fatalf("%d %s", rec.Code, rec.Body.String())
			}
			for _, key := range tc.keys {
				if body.Data[key] == nil {
					t.Fatalf("data lacks %s: %s", key, rec.Body.String())
				}
			}
		})
	}
	rec := httptest.NewRecorder()
	writeLifecycleError(rec, errors.New("boom"))
	if rec.Code != 500 {
		t.Fatalf("unknown error: %d", rec.Code)
	}
}
