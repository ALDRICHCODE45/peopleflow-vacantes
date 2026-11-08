package v2

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func TestApplyInvalidChannelValidationEnvelope(t *testing.T) {
	f := &fakeStore{}
	r := chi.NewRouter()
	r.Post("/v2/jobs/{id}/applications", NewHandler(f, draftjson.Decode).Apply)
	body := `{"channel":"newsletter","cv_id":"` + uuid.NewString() + `","questionnaire_revision":"r","answers":[]}`
	req := httptest.NewRequest("POST", "/v2/jobs/22222222-2222-4222-8222-222222222222/applications", strings.NewReader(body))
	req.Header.Add("Idempotency-Key", uuid.NewString())
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	want := `{"error":"validation failed","code":"validation_error","fields":[{"field":"channel","code":"invalid"}]}`
	if w.Code != 400 || strings.TrimSpace(w.Body.String()) != want || f.calls != 0 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s calls=%d", w.Code, w.Body.String(), f.calls)
	}
}
