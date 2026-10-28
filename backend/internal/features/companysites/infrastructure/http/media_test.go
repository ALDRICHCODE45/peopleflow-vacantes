package http

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type mediaStub struct {
	m     app.StoredMedia
	data  []byte
	err   error
	calls int
	puts  int
	rows  int
}

func (s *mediaStub) InsertMedia(ctx context.Context, _, _ uuid.UUID, m app.StoredMedia, b []byte, files app.Storage) (app.StoredMedia, error) {
	s.calls++
	if s.err != nil {
		return app.StoredMedia{}, s.err
	}
	if _, err := files.Put(ctx, b); err != nil {
		return app.StoredMedia{}, err
	}
	s.rows++
	s.data = b
	m.ID = uuid.New()
	m.URL = "/v2/company-sites/media/" + m.ID.String()
	m.StorageKey = "key"
	m.ByteSize = int64(len(b))
	s.m = m
	return m, s.err
}
func (s *mediaStub) FindMedia(_ context.Context, id uuid.UUID) (app.StoredMedia, error) {
	if id != s.m.ID {
		return app.StoredMedia{}, app.ErrMediaNotFound
	}
	return s.m, nil
}
func (s *mediaStub) Put(context.Context, []byte) (string, error) { s.puts++; return "key", nil }
func (s *mediaStub) Open(context.Context, string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader(s.data)), nil
}
func (s *mediaStub) Delete(context.Context, string) error { return nil }
func testPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func uploadRequest(t *testing.T, h *Handler, data []byte, kind string, extra bool) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if err := mw.WriteField("kind", kind); err != nil {
		t.Fatal(err)
	}
	f, err := mw.CreateFormFile("file", "renamed.jpg")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.Write(data)
	if extra {
		_ = mw.WriteField("kind", "cover")
	}
	_ = mw.Close()
	r := httptest.NewRequest("POST", "/", &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	r = r.WithContext(security.ContextWithCompanyContext(r.Context(), security.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}))
	w := httptest.NewRecorder()
	h.UploadMedia(w, r)
	return w
}
func TestMediaUploadStatuses(t *testing.T) {
	valid := testPNG(t, 200, 200)
	for _, tc := range []struct {
		name   string
		data   []byte
		kind   string
		extra  bool
		err    error
		status int
		code   string
	}{
		{"ok renamed PNG", valid, "cover", false, nil, 201, ""},
		{"file too large", make([]byte, app.MaxMediaBytes+1), "cover", false, nil, 413, "payload_too_large"},
		{"envelope too large", make([]byte, app.MaxMediaBytes+65536), "cover", false, nil, 413, "payload_too_large"},
		{"unsupported", []byte("garbage"), "cover", false, nil, 415, "unsupported_media_type"},
		{"small", testPNG(t, 199, 200), "cover", false, nil, 422, "image_too_small"},
		{"large", testPNG(t, 6001, 200), "cover", false, nil, 422, "image_too_large"},
		{"limit", valid, "cover", false, app.ErrMediaLimit, 422, "media_limit_reached"},
		{"bad kind", valid, "unknown", false, nil, 400, "validation_error"},
		{"duplicate", valid, "cover", true, nil, 400, "invalid_request"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &mediaStub{err: tc.err}
			h := newTestHandler(&stubStore{}).WithMedia(s, s)
			w := uploadRequest(t, h, tc.data, tc.kind, tc.extra)
			if w.Code != tc.status {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
			if tc.code != "" && !strings.Contains(w.Body.String(), `"code":"`+tc.code+`"`) {
				t.Fatal(w.Body)
			}
			if w.Code != 201 && (s.puts != 0 || s.rows != 0) {
				t.Fatalf("rejected upload wrote: puts=%d rows=%d", s.puts, s.rows)
			}
			if w.Code == 201 && (s.puts != 1 || s.rows != 1) {
				t.Fatalf("missing storage/insert: puts=%d rows=%d", s.puts, s.rows)
			}
			if w.Code == 201 {
				var m map[string]any
				if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
					t.Fatal(err)
				}
				if len(m) != 6 || m["content_type"] != "image/png" {
					t.Fatal(m)
				}
			}
		})
	}
}
func TestPublicMedia(t *testing.T) {
	s := &mediaStub{m: app.StoredMedia{Media: app.Media{ID: uuid.New()}, ContentType: "image/png", StorageKey: "key", ByteSize: 3}, data: []byte{1, 2, 3}}
	h := newTestHandler(&stubStore{}).WithMedia(s, s)
	router := chi.NewRouter()
	router.Get("/media/{id}", h.GetMedia)
	for _, id := range []string{s.m.ID.String(), uuid.NewString(), "invalid"} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", "/media/"+id, nil))
		if id == s.m.ID.String() {
			if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), s.data) {
				t.Fatal(w)
			}
			for key, want := range map[string]string{"Content-Type": "image/png", "Content-Length": "3", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"} {
				if w.Header().Get(key) != want {
					t.Fatalf("%s: %s", key, w.Header())
				}
			}
		} else {
			if w.Code != 404 || w.Header().Get("Cache-Control") != "no-store" || !strings.Contains(w.Body.String(), `"code":"not_found"`) {
				t.Fatal(w)
			}
		}
	}
}
func TestMediaUnavailable(t *testing.T) {
	var h *Handler
	for _, f := range []func(*httptest.ResponseRecorder){func(w *httptest.ResponseRecorder) { h.UploadMedia(w, httptest.NewRequest("POST", "/", nil)) }, func(w *httptest.ResponseRecorder) { h.GetMedia(w, httptest.NewRequest("GET", "/", nil)) }} {
		w := httptest.NewRecorder()
		f(w)
		if w.Code != 503 || !strings.Contains(w.Body.String(), "cv_storage_unavailable") {
			t.Fatal(w)
		}
	}
}
