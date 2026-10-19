package v2

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type fakeStore struct {
	calls  int
	replay bool
	err    error
}

func (f *fakeStore) Apply(context.Context, string, uuid.UUID, uuid.UUID, app.Request) (app.Result, error) {
	f.calls++
	return app.Result{Body: []byte(`{"id":"11111111-1111-4111-8111-111111111111","vacancy_id":"22222222-2222-4222-8222-222222222222","status":"submitted","applied_at":"2026-10-16T10:00:00Z"}`), Replayed: f.replay}, f.err
}
func (f *fakeStore) List(context.Context, string, app.Query) (app.Page, error) {
	f.calls++
	return app.Page{Items: []app.Item{{ID: uuid.New(), Vacancy: app.Vacancy{ID: uuid.New(), Title: "Role"}, Company: app.Company{ID: uuid.New(), Name: "Acme"}, Status: "submitted"}}}, f.err
}
func TestCandidateListHTTPStrictQueryAndShape(t *testing.T) {
	for _, query := range []string{"", "?limit=0", "?limit=1&limit=2", "?unknown=1", "?cursor=bad"} {
		t.Run(query, func(t *testing.T) {
			f := &fakeStore{}
			w := httptest.NewRecorder()
			NewHandler(f, draftjson.Decode).List(w, httptest.NewRequest("GET", "/v2/me/applications"+query, nil))
			if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("ETag") != "" || w.Header().Get("Idempotency-Replayed") != "" {
				t.Fatal(w.Header())
			}
			var body map[string]any
			json.Unmarshal(w.Body.Bytes(), &body)
			if query != "" {
				if w.Code != 400 || body["code"] != "invalid_request" || f.calls != 0 {
					t.Fatal(w.Code, body, f.calls)
				}
				return
			}
			if w.Code != 200 || len(body) != 2 || body["next_cursor"] != nil {
				t.Fatal(w.Code, body)
			}
			item := body["items"].([]any)[0].(map[string]any)
			if len(item) != 6 || item["message"] != nil || item["status"] != "submitted" || len(item["vacancy"].(map[string]any)) != 2 || len(item["company"].(map[string]any)) != 2 {
				t.Fatal(item)
			}
		})
	}
}
func TestApplyTransport(t *testing.T) {
	body := `{"cv_id":"` + uuid.NewString() + `","questionnaire_revision":"r","answers":[]}`
	for _, tc := range []struct {
		name, key, body string
		repeat          bool
		err             error
		status          int
		code            string
		replay          bool
	}{
		{"success", uuid.NewString(), body, false, nil, 201, "", false}, {"replay", uuid.NewString(), body, false, nil, 201, "", true},
		{"missing_key", "", body, false, nil, 400, "idempotency_key_required", false},
		{"bad_key", "bad", body, false, nil, 400, "invalid_idempotency_key", false},
		{"repeated", uuid.NewString(), body, true, nil, 400, "invalid_idempotency_key", false},
		{"shape", uuid.NewString(), `{}`, false, nil, 400, "invalid_request", false},
		{"oversized", uuid.NewString(), strings.Repeat("x", 1048577), false, nil, 413, "payload_too_large", false},
		{"stale", uuid.NewString(), body, false, app.ErrQuestionnaireChanged, 409, "questionnaire_changed", false},
		{"duplicate", uuid.NewString(), body, false, app.ErrAlreadyApplied, 409, "already_applied", false},
		{"cv", uuid.NewString(), body, false, app.ErrCVUnavailable, 422, "cv_unavailable", false},
		{"answers", uuid.NewString(), body, false, &app.InvalidAnswers{Details: []httpjson.AnswerDetail{{QuestionID: "q", Reason: "required"}}}, 422, "invalid_answers", false},
		{"conflict", uuid.NewString(), body, false, app.ErrIdempotencyConflict, 409, "idempotency_conflict", false},
		{"missing", uuid.NewString(), body, false, app.ErrNotFound, 404, "not_found", false},
		{"unexpected", uuid.NewString(), body, false, errors.New("private failure"), 500, "internal_error", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeStore{err: tc.err, replay: tc.replay}
			h := NewHandler(f, draftjson.Decode)
			r := chi.NewRouter()
			r.Post("/v2/jobs/{id}/applications", h.Apply)
			req := httptest.NewRequest("POST", "/v2/jobs/22222222-2222-4222-8222-222222222222/applications", strings.NewReader(tc.body))
			if tc.key != "" {
				req.Header.Add("Idempotency-Key", tc.key)
			}
			if tc.repeat {
				req.Header.Add("Idempotency-Key", uuid.NewString())
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
			var got map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if tc.code != "" {
				if got["code"] != tc.code || strings.Contains(w.Body.String(), "private failure") {
					t.Fatal(got)
				}
				_, details := got["details"]
				if details != (tc.code == "invalid_answers") {
					t.Fatal(got)
				}
			} else {
				if len(got) != 4 || w.Header().Get("Idempotency-Replayed") != map[bool]string{true: "true", false: "false"}[tc.replay] {
					t.Fatal(got, w.Header())
				}
			}
		})
	}
}
