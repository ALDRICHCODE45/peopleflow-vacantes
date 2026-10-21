package board

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type manualStoreFake struct {
	app.Store
	err    error
	result app.ManualCreated
	calls  int
	input  app.ManualInput
}

func (s *manualStoreFake) CreateManual(_ context.Context, _, _, _ uuid.UUID, in app.ManualInput, _ app.ManualCVInspector, _ app.ManualFileStorage) (app.ManualCreated, error) {
	s.calls++
	s.input = in
	return s.result, s.err
}

func TestManualCreateHandler(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
		extra  string
	}{
		{"success", nil, 201, "", ""},
		{"invalid", app.ErrInvalidRequest, 400, "invalid_request", ""},
		{"fields", &app.ManualValidationError{Fields: []app.ManualFieldError{{Field: "candidate.phone", Code: "invalid"}}}, 400, "validation_error", "fields"},
		{"unpublished", app.ErrNotPublished, 409, "vacancy_not_published", ""},
		{"finished", &app.ProcessFinished{}, 409, "process_finished", "data"},
		{"duplicates", &app.PossibleDuplicates{Matches: []app.DuplicateMatch{}}, 409, "possible_duplicates", "data"},
		{"already", &app.CandidateAlreadyInProcess{ParticipationID: uuid.New()}, 409, "candidate_already_in_process", "data"},
		{"conflict", app.ErrManualIdempotencyConflict, 409, "idempotency_conflict", ""},
		{"mismatch", app.ErrManualCVContentMismatch, 400, "cv_content_mismatch", ""},
		{"unsupported", app.ErrManualCVUnsupportedType, 415, "cv_unsupported_type", ""},
		{"large", app.ErrManualCVTooLarge, 413, "cv_too_large", ""},
		{"storage", app.ErrStorageUnavailable, 503, "cv_storage_unavailable", ""},
		{"missing", app.ErrNotFound, 404, "not_found", ""},
		{"auth", app.ErrUnauthenticated, 401, "unauthenticated", ""},
		{"forbidden", app.ErrForbidden, 403, "forbidden", ""},
		{"inactive", app.ErrCompanyInactive, 403, "company_inactive", ""},
		{"not_active", app.ErrCompanyNotActive, 409, "company_not_active", ""},
		{"internal", errors.New("private"), 500, "internal_error", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, replay := range []bool{false, true} {
				s := &manualStoreFake{err: tc.err, result: app.ManualCreated{Body: []byte(`{"frozen":true}`), ETag: `"tag"`, Replayed: replay}}
				r := manualRequest(t)
				w := httptest.NewRecorder()
				NewHandler(s).CreateManual(w, r)
				if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" {
					t.Fatal(w.Code, w.Header(), w.Body.String())
				}
				if s.calls != 1 || s.input.IdempotencyKey.String() != r.Header.Get("Idempotency-Key") || string(s.input.CV) != "%PDF-1" || string(s.input.Data) != "{}" || s.input.FileName != "cv.pdf" {
					t.Fatal(s)
				}
				if tc.status == 201 {
					want := "false"
					if replay {
						want = "true"
					}
					if w.Body.String() != string(s.result.Body) || w.Header().Get("ETag") != s.result.ETag || w.Header().Get("Idempotency-Replayed") != want {
						t.Fatal(w.Header(), w.Body.String())
					}
					continue
				}
				var body map[string]json.RawMessage
				if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if string(body["code"]) != `"`+tc.code+`"` {
					t.Fatal(w.Body.String())
				}
				expected := 2
				if tc.extra != "" {
					expected++
					if body[tc.extra] == nil {
						t.Fatal(w.Body.String())
					}
				}
				if len(body) != expected || w.Header().Get("ETag") != "" || w.Header().Get("Idempotency-Replayed") != "" {
					t.Fatal(w.Header(), w.Body.String())
				}
				if tc.extra == "data" {
					expectedData, err := json.Marshal(tc.err)
					if err != nil || !bytes.Equal(body["data"], expectedData) {
						t.Fatal(w.Body.String(), err)
					}
				}
				if tc.name == "fields" && string(body["fields"]) != `[{"field":"candidate.phone","code":"invalid"}]` {
					t.Fatal(w.Body.String())
				}
			}
		})
	}
}

func manualRequest(t *testing.T) *http.Request {
	t.Helper()
	var b bytes.Buffer
	m := multipart.NewWriter(&b)
	p, _ := m.CreateFormField("data")
	_, _ = p.Write([]byte(`{}`))
	p, _ = m.CreateFormFile("cv", "cv.pdf")
	_, _ = p.Write([]byte("%PDF-1"))
	_ = m.Close()
	r := httptest.NewRequest("POST", "/", &b)
	r.Header.Set("Content-Type", m.FormDataContentType())
	r.Header.Set("Idempotency-Key", uuid.NewString())
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", uuid.NewString())
	ctx := context.WithValue(r.Context(), chi.RouteCtxKey, rc)
	ctx = security.ContextWithCompanyContext(ctx, security.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()})
	return r.WithContext(ctx)
}

func TestManualCreateMultipartErrors(t *testing.T) {
	for _, tc := range []struct {
		name   string
		cv     []byte
		status int
		code   string
	}{
		{"missing", nil, 400, "validation_error"},
		{"too_large", bytes.Repeat([]byte("x"), maxManualCVBytes+1), 413, "cv_too_large"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var b bytes.Buffer
			m := multipart.NewWriter(&b)
			p, _ := m.CreateFormField("data")
			_, _ = p.Write([]byte(`{}`))
			if tc.cv != nil {
				p, _ = m.CreateFormFile("cv", "cv.pdf")
				_, _ = p.Write(tc.cv)
			}
			_ = m.Close()
			r := manualRequest(t)
			r.Body = io.NopCloser(&b)
			r.Header.Set("Content-Type", m.FormDataContentType())
			s := &manualStoreFake{}
			w := httptest.NewRecorder()
			NewHandler(s).CreateManual(w, r)
			var body map[string]json.RawMessage
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if w.Code != tc.status || string(body["code"]) != `"`+tc.code+`"` || s.calls != 0 || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal(w.Code, w.Body.String(), s.calls)
			}
			if tc.cv == nil {
				if string(body["fields"]) != `[{"field":"cv","code":"required"}]` {
					t.Fatal(w.Body.String())
				}
			} else if len(body) != 2 {
				t.Fatal(w.Body.String())
			}
		})
	}
}

func TestManualCreateTransportErrors(t *testing.T) {
	for _, tc := range []struct {
		name      string
		keys      []string
		malformed bool
		code      string
	}{
		{"missing", nil, false, "idempotency_key_required"}, {"empty", []string{""}, false, "invalid_idempotency_key"}, {"invalid", []string{"bad"}, false, "invalid_idempotency_key"}, {"multiple", []string{uuid.NewString(), uuid.NewString()}, false, "invalid_idempotency_key"}, {"multipart", []string{uuid.NewString()}, true, "invalid_request"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &manualStoreFake{}
			r := manualRequest(t)
			r.Header.Del("Idempotency-Key")
			for _, key := range tc.keys {
				r.Header.Add("Idempotency-Key", key)
			}
			if tc.malformed {
				r.Header.Set("Content-Type", "application/json")
			}
			w := httptest.NewRecorder()
			NewHandler(s).CreateManual(w, r)
			var body map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &body)
			if w.Code != 400 || body["code"] != tc.code || s.calls != 0 || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal(w.Code, w.Body.String(), s.calls)
			}
		})
	}
}
