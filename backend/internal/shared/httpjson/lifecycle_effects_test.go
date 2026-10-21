package httpjson

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLifecycleEffectsCatalogAndExactData(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		data   any
		want   string
	}{
		{"vacancy_unavailable", 410, map[string]any{"id": "v", "title": "Role", "company": map[string]string{"id": "c", "name": "Acme"}, "availability": "paused"}, `{"error":"vacancy unavailable","code":"vacancy_unavailable","data":{"availability":"paused","company":{"id":"c","name":"Acme"},"id":"v","title":"Role"}}`},
		{"vacancy_not_accepting_applications", 409, map[string]string{"availability": "closed"}, `{"error":"vacancy not accepting applications","code":"vacancy_not_accepting_applications","data":{"availability":"closed"}}`},
		{"process_finished", 409, map[string]any{"lifecycle": map[string]string{"process": "finished"}}, `{"error":"process finished","code":"process_finished","data":{"lifecycle":{"process":"finished"}}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			WriteLifecycleError(w, Resolve(Code(tc.name)), tc.data)
			if w.Code != tc.status || strings.TrimSpace(w.Body.String()) != tc.want {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
		})
	}
}
