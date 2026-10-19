package cvs

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/cvs"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type fakeLibrary struct {
	app.Library
	calls int
	err   error
	name  string
}

func (f *fakeLibrary) Upload(_ context.Context, _, name, _ string, data []byte) (app.CV, error) {
	f.calls++
	f.name = name
	return app.CV{ID: uuid.New(), Name: name, Size: int64(len(data)), ContentType: app.PDF}, f.err
}

type libraryStub struct {
	app.Library
	cv      app.CV
	err     error
	calls   int
	removed bool
}

func (s *libraryStub) List(context.Context, string) ([]app.CV, error) {
	s.calls++
	return []app.CV{s.cv}, s.err
}
func (s *libraryStub) Rename(_ context.Context, _ string, _ uuid.UUID, name string) (app.CV, error) {
	s.calls++
	s.cv.Name = name
	return s.cv, s.err
}
func (s *libraryStub) Remove(context.Context, string, uuid.UUID) error {
	s.calls++
	s.removed = true
	return s.err
}
func (s *libraryStub) File(context.Context, string, uuid.UUID) (app.CV, io.ReadCloser, error) {
	s.calls++
	if s.err != nil {
		return app.CV{}, nil, s.err
	}
	return s.cv, io.NopCloser(strings.NewReader("%PDF-1")), nil
}
func TestLibraryHTTPExactShapesAndAttachment(t *testing.T) {
	s := &libraryStub{cv: app.CV{ID: uuid.New(), Name: "CV", Size: 6, ContentType: app.PDF}}
	h := NewHandler(s, draftjson.Decode)
	r := chi.NewRouter()
	r.Get("/v2/me/cvs", h.List)
	r.Patch("/v2/me/cvs/{id}", h.Rename)
	r.Delete("/v2/me/cvs/{id}", h.Remove)
	r.Get("/v2/me/cvs/{id}/file", h.File)
	path := "/v2/me/cvs/" + s.cv.ID.String()
	request := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(method, path, strings.NewReader(body)))
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("missing no-store")
		}
		return w
	}
	w := request("GET", "/v2/me/cvs", "")
	var page map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page) != 2 || len(page["items"].([]any)[0].(map[string]any)) != 6 {
		t.Fatal(page)
	}
	limits := page["limits"].(map[string]any)
	if len(limits) != 3 || limits["max_cvs"] != float64(10) || limits["max_bytes"] != float64(5242880) || len(limits["content_types"].([]any)) != 2 {
		t.Fatal(limits)
	}
	w = request("PATCH", path, `{"name":"  Updated   label  "}`)
	if w.Code != 200 || s.cv.Name != "Updated label" {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, body := range []string{`{}`, `{"name":"a","name":"b"}`, `{"name":""}`, `{"name":"CV","other":1}`, `{"name":123}`} {
		before := s.calls
		w = request("PATCH", path, body)
		if w.Code != 400 || s.calls != before {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	w = request("GET", path+"/file", "")
	disposition, params, err := mime.ParseMediaType(w.Header().Get("Content-Disposition"))
	if err != nil || disposition != "attachment" || !strings.HasSuffix(params["filename"], ".pdf") || w.Header().Get("Content-Type") != app.PDF || w.Header().Get("Content-Length") != "6" || w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Body.String() != "%PDF-1" {
		t.Fatal(w.Header(), w.Body.String(), err)
	}
	w = request("DELETE", path, "")
	if w.Code != 204 || w.Body.Len() != 0 || !s.removed {
		t.Fatal(w.Code, w.Body.String())
	}
	s.err = app.ErrNotFound
	for _, method := range []string{"GET", "DELETE", "PATCH"} {
		target := path
		if method == "GET" {
			target += "/file"
		}
		w = request(method, target, `{"name":"Other"}`)
		var body map[string]any
		json.Unmarshal(w.Body.Bytes(), &body)
		if w.Code != 404 || len(body) != 2 || body["code"] != "not_found" {
			t.Fatal(w.Code, body)
		}
	}
}
func TestUploadLibraryFullIsConflict(t *testing.T) {
	f := &fakeLibrary{err: app.ErrLibraryFull}
	w := httptest.NewRecorder()
	NewHandler(f, draftjson.Decode).Upload(w, multipartRequest(t, 1, "cv.pdf", []byte("%PDF-1"), ""))
	var body map[string]any
	json.Unmarshal(w.Body.Bytes(), &body)
	if w.Code != 409 || body["code"] != "cv_library_full" || len(body) != 2 {
		t.Fatal(w.Code, body)
	}
}
func multipartRequest(t *testing.T, files int, filename string, data []byte, extra string) *http.Request {
	t.Helper()
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	for i := 0; i < files; i++ {
		part, err := w.CreateFormFile("file", filename)
		if err != nil {
			t.Fatal(err)
		}
		part.Write(data)
	}
	if extra != "" {
		w.WriteField(extra, "label")
	}
	w.Close()
	r := httptest.NewRequest("POST", "/v2/me/cvs", &b)
	r.Header.Set("Content-Type", w.FormDataContentType())
	return r
}
func TestUploadTransport(t *testing.T) {
	for _, tc := range []struct {
		name     string
		files    int
		filename string
		data     []byte
		extra    string
		status   int
		code     string
	}{
		{"pdf", 1, "cv.pdf", []byte("%PDF-1"), "", 201, ""},
		{"optional_name", 1, "cv.pdf", []byte("%PDF-1"), "name", 201, ""},
		{"missing", 0, "cv.pdf", nil, "", 400, "invalid_request"},
		{"multiple", 2, "cv.pdf", []byte("%PDF-1"), "", 400, "invalid_request"},
		{"unknown", 1, "cv.pdf", []byte("%PDF-1"), "other", 400, "invalid_request"},
		{"oversized", 1, "cv.pdf", []byte(strings.Repeat("x", app.MaxBytes+1)), "", 413, "cv_too_large"},
		{"spoofed", 1, "cv.pdf", []byte("garbage"), "", 400, "cv_content_mismatch"},
		{"unsupported", 1, "cv.txt", []byte("garbage"), "", 415, "cv_unsupported_type"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeLibrary{}
			h := NewHandler(f, draftjson.Decode)
			w := httptest.NewRecorder()
			h.Upload(w, multipartRequest(t, tc.files, tc.filename, tc.data, tc.extra))
			if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if tc.code != "" {
				if body["code"] != tc.code || f.calls != 0 {
					t.Fatal(body, f.calls)
				}
			} else if len(body) != 6 || f.calls != 1 {
				t.Fatal(body, f.calls)
			}
		})
	}
}
