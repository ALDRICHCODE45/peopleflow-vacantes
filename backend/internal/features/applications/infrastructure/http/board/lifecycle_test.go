package board

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
)

func TestFinishedProcessErrorExactWire(t *testing.T) {
	view := json.RawMessage(`{"publication":"closed","process":"finished","version":"4","published_at":null,"paused_at":null,"closed_at":null,"process_finished_at":null,"allowed_actions":["reopen"]}`)
	w := httptest.NewRecorder()
	writeError(w, fmt.Errorf("private wrapper: %w", &app.ProcessFinished{Lifecycle: view}))
	var got map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if w.Code != 409 || len(got) != 3 || string(got["code"]) != `"process_finished"` || string(got["error"]) != `"process finished"` || string(got["data"]) != `{"lifecycle":`+string(view)+`}` {
		t.Fatal(w.Code, w.Body.String())
	}
	if w.Header().Get("ETag") != "" {
		t.Fatal(w.Header())
	}
}
