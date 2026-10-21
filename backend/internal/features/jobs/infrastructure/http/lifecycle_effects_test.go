package http

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
)

func TestConfigurationFinishedErrorExactWire(t *testing.T) {
	pub, process := "closed", "finished"
	view := lifecycle.View{Publication: &pub, Process: &process, Version: "7", AllowedActions: []string{"reopen"}}
	for _, writer := range []struct {
		name  string
		write func(*httptest.ResponseRecorder, error)
	}{
		{"draft/management", func(w *httptest.ResponseRecorder, e error) { writeDraftError(w, e) }},
		{"pipeline", func(w *httptest.ResponseRecorder, e error) { writePipelineError(w, e) }},
		{"delivery", func(w *httptest.ResponseRecorder, e error) { writeDeliveryError(w, e) }},
	} {
		t.Run(writer.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			writer.write(w, fmt.Errorf("private: %w", &lifecycle.ProcessFinished{Lifecycle: view}))
			var root map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &root); err != nil {
				t.Fatal(err)
			}
			raw, err := json.Marshal(map[string]any{"lifecycle": view})
			if err != nil {
				t.Fatal(err)
			}
			var want any
			if err = json.Unmarshal(raw, &want); err != nil {
				t.Fatal(err)
			}
			if w.Code != 409 || len(root) != 3 || root["code"] != "process_finished" || root["error"] != "process finished" || !reflect.DeepEqual(root["data"], want) || w.Header().Get("ETag") != "" {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
}
