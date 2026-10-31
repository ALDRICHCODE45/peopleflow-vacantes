package v2

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func (f *fakeStore) MarkMessageRead(_ context.Context, _ string, _ uuid.UUID, at time.Time) error {
	f.calls++
	if !at.Equal(time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)) {
		return errors.New("wrong timestamp")
	}
	return f.err
}

func TestMessageReadHTTP(t *testing.T) {
	const valid = `{"updated_at":"2026-10-01T09:00:00Z"}`
	for _, tc := range []struct {
		name, id, body string
		err            error
		status         int
		response       string
		calls          int
	}{
		{"success", uuid.NewString(), valid, nil, 204, "", 1},
		{"missing", uuid.NewString(), `{}`, nil, 400, "invalid_request", 0},
		{"null", uuid.NewString(), `{"updated_at":null}`, nil, 400, "invalid_request", 0},
		{"type", uuid.NewString(), `{"updated_at":1}`, nil, 400, "invalid_request", 0},
		{"invalid", uuid.NewString(), `{"updated_at":"yesterday"}`, nil, 400, "invalid_request", 0},
		{"unknown", uuid.NewString(), `{"updated_at":"2026-10-01T09:00:00Z","extra":1}`, nil, 400, "invalid_request", 0},
		{"duplicate", uuid.NewString(), `{"updated_at":"2026-10-01T09:00:00Z","updated_at":"2026-10-01T09:00:00Z"}`, nil, 400, "invalid_request", 0},
		{"trailing", uuid.NewString(), valid + `{}`, nil, 400, "invalid_request", 0},
		{"array", uuid.NewString(), `[]`, nil, 400, "invalid_request", 0},
		{"empty", uuid.NewString(), ``, nil, 400, "invalid_request", 0},
		{"bad id", "bad", valid, nil, 400, "invalid_request", 0},
		{"not found", uuid.NewString(), valid, app.ErrNotFound, 404, "not_found", 1},
		{"unavailable", uuid.NewString(), valid, app.ErrMessageUnavailable, 409, "message_unavailable", 1},
		{"changed", uuid.NewString(), valid, app.ErrMessageChanged, 409, "message_changed", 1},
		{"invalid store", uuid.NewString(), valid, app.ErrInvalidRequest, 400, "invalid_request", 1},
		{"failure", uuid.NewString(), valid, errors.New("private"), 500, "internal_error", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeStore{err: tc.err}
			h := NewHandler(f, draftjson.Decode)
			r := chi.NewRouter()
			r.Put("/v2/me/applications/{id}/message-read", h.MarkMessageRead)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/v2/me/applications/"+tc.id+"/message-read", strings.NewReader(tc.body)))
			message := map[string]string{"invalid_request": "invalid request", "not_found": "not found", "message_unavailable": "message unavailable", "message_changed": "message changed", "internal_error": "an internal error occurred"}[tc.response]
			want := ""
			if tc.response != "" {
				want = `{"error":"` + message + `","code":"` + tc.response + `"}` + "\n"
			}
			if w.Code != tc.status || w.Body.String() != want || f.calls != tc.calls || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("ETag") != "" || w.Header().Get("Idempotency-Replayed") != "" {
				t.Fatal(w.Code, w.Body.String(), w.Header(), f.calls)
			}
			if tc.status != 204 && w.Header().Get("Content-Type") != "application/json" {
				t.Fatal(w.Header())
			}
		})
	}
}
