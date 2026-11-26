package http

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"strconv"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/testsupport/mp4fixture"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type videoPart struct {
	filename, contentType string
	data                  []byte
	fileFirst             bool
}

// postVideo sends kind + file through UploadMedia and returns the response,
// the request body counter and the body length.
func postVideo(t *testing.T, h *Handler, kind string, p videoPart) (*httptest.ResponseRecorder, *countedBody, int) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	writeFile := func() {
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition", `form-data; name="file"; filename="`+p.filename+`"`)
		if p.contentType != "" {
			header.Set("Content-Type", p.contentType)
		}
		f, err := mw.CreatePart(header)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = f.Write(p.data)
	}
	if p.fileFirst {
		writeFile()
	}
	_ = mw.WriteField("kind", kind)
	if !p.fileFirst {
		writeFile()
	}
	_ = mw.Close()
	counted := &countedBody{Reader: bytes.NewReader(body.Bytes())}
	r := httptest.NewRequest("POST", "/", counted)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	r = r.WithContext(security.ContextWithCompanyContext(r.Context(), security.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}))
	w := httptest.NewRecorder()
	h.UploadMedia(w, r)
	return w, counted, body.Len()
}

// spoolDir points os.TempDir (the upload spool) at an empty directory and
// fails the test if anything is left in it.
func spoolDir(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("TMPDIR", dir)
	t.Cleanup(func() {
		if entries, _ := os.ReadDir(dir); len(entries) != 0 {
			t.Errorf("spool left behind: %v", entries)
		}
	})
}

func TestMediaUploadHeroVideo(t *testing.T) {
	big := mp4fixture.Build(mp4fixture.Options{MoovLast: true, MdatBytes: app.MaxMediaBytes + 1024})
	for _, tc := range []struct {
		name          string
		part          videoPart
		width, height any
	}{
		{"kind first", videoPart{filename: "clip.mp4", contentType: "video/mp4", data: mp4fixture.Build(mp4fixture.Options{})}, float64(1280), float64(720)},
		{"file first", videoPart{filename: "clip.MP4", contentType: "application/octet-stream", data: mp4fixture.Build(mp4fixture.Options{}), fileFirst: true}, float64(1280), float64(720)},
		{"file first above the image cap", videoPart{filename: "clip.mp4", data: big, fileFirst: true}, float64(1280), float64(720)},
		{"kind first above the image cap", videoPart{filename: "clip.mp4", data: big}, float64(1280), float64(720)},
		{"moov after mdat", videoPart{filename: "clip.mp4", contentType: "video/mp4", data: mp4fixture.Build(mp4fixture.Options{MoovLast: true, Width: 640, Height: 360})}, float64(640), float64(360)},
		{"unknown dimensions", videoPart{filename: "clip.mp4", contentType: "video/mp4", data: mp4fixture.Build(mp4fixture.Options{NoVideo: true})}, nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			spoolDir(t)
			s := &mediaStub{}
			h := newTestHandler(&stubStore{}).WithMedia(s, s)
			w, _, _ := postVideo(t, h, "hero_video", tc.part)
			if w.Code != 201 {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
			var m map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
				t.Fatal(err)
			}
			if len(m) != 7 || m["kind"] != "hero_video" || m["content_type"] != "video/mp4" || m["duration_ms"] != float64(5000) || m["width"] != tc.width || m["height"] != tc.height || m["url"] != "/v2/company-sites/media/"+m["id"].(string) {
				t.Fatal(m)
			}
			if !bytes.Equal(s.streamed, tc.part.data) || s.puts != 1 || s.rows != 1 {
				t.Fatalf("stored %d bytes, puts=%d rows=%d", len(s.streamed), s.puts, s.rows)
			}
		})
	}
}

func TestMediaUploadHeroVideoErrors(t *testing.T) {
	valid := mp4fixture.Build(mp4fixture.Options{})
	tooLong := mp4fixture.Build(mp4fixture.Options{Duration: 30001})
	for _, tc := range []struct {
		name   string
		part   videoPart
		putErr error
		err    error
		status int
		body   string
	}{
		{"mov extension", videoPart{filename: "clip.mov", contentType: "video/mp4", data: valid}, nil, nil, 415, `{"error":"unsupported media type","code":"unsupported_media_type"}`},
		{"no extension", videoPart{filename: "clip", contentType: "video/mp4", data: valid}, nil, nil, 415, `{"error":"unsupported media type","code":"unsupported_media_type"}`},
		{"declared quicktime", videoPart{filename: "clip.mp4", contentType: "video/quicktime", data: valid}, nil, nil, 415, `{"error":"unsupported media type","code":"unsupported_media_type"}`},
		{"declared image", videoPart{filename: "clip.mp4", contentType: "image/png", data: valid}, nil, nil, 415, `{"error":"unsupported media type","code":"unsupported_media_type"}`},
		{"quicktime brand", videoPart{filename: "clip.mp4", contentType: "video/mp4", data: mp4fixture.Build(mp4fixture.Options{Brand: "qt  "})}, nil, nil, 415, `{"error":"unsupported media type","code":"unsupported_media_type"}`},
		{"png bytes", videoPart{filename: "clip.mp4", contentType: "video/mp4", data: testPNG(t, 200, 200)}, nil, nil, 415, `{"error":"unsupported media type","code":"unsupported_media_type"}`},
		{"too long", videoPart{filename: "clip.mp4", contentType: "video/mp4", data: tooLong}, nil, nil, 422, `{"error":"video too long","code":"video_too_long","data":{"max_ms":30000,"duration_ms":30001}}`},
		{"truncated", videoPart{filename: "clip.mp4", contentType: "video/mp4", data: valid[:len(valid)-1]}, nil, nil, 422, `{"error":"video invalid","code":"video_invalid"}`},
		{"zero timescale", videoPart{filename: "clip.mp4", contentType: "video/mp4", data: mp4fixture.Build(mp4fixture.Options{ZeroTimescale: true, Duration: 9})}, nil, nil, 422, `{"error":"video invalid","code":"video_invalid"}`},
		{"empty file", videoPart{filename: "clip.mp4", contentType: "video/mp4"}, nil, nil, 415, `{"error":"unsupported media type","code":"unsupported_media_type"}`},
		{"quota", videoPart{filename: "clip.mp4", contentType: "video/mp4", data: valid}, nil, app.ErrMediaLimit, 422, `{"error":"media limit reached","code":"media_limit_reached"}`},
		{"storage failure", videoPart{filename: "clip.mp4", contentType: "video/mp4", data: valid}, app.ErrStorageUnavailable, nil, 500, `{"error":"an internal error occurred","code":"internal_error"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			spoolDir(t)
			s := &mediaStub{err: tc.err, putErr: tc.putErr}
			h := newTestHandler(&stubStore{}).WithMedia(s, s)
			w, _, _ := postVideo(t, h, "hero_video", tc.part)
			if w.Code != tc.status || w.Body.String() != tc.body+"\n" {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
			if s.rows != 0 || (tc.err == nil && tc.putErr == nil && (s.calls != 0 || s.puts != 0)) {
				t.Fatalf("rejected upload wrote: %+v", s)
			}
		})
	}
}

// 413 stops reading at the cap (kind first) and never stores; a file-first
// image above 5 MiB is still 413 once its kind is known.
func TestMediaUploadHeroVideoTooLarge(t *testing.T) {
	spoolDir(t)
	s := &mediaStub{}
	h := newTestHandler(&stubStore{}).WithMedia(s, s)
	w, counted, total := postVideo(t, h, "hero_video", videoPart{filename: "clip.mp4", contentType: "video/mp4", data: make([]byte, app.MaxVideoBytes+256*1024)})
	if w.Code != 413 || w.Body.String() != `{"error":"payload too large","code":"payload_too_large"}`+"\n" || counted.read >= total || counted.read > app.MaxVideoBytes+64*1024 {
		t.Fatalf("status=%d read=%d total=%d %s", w.Code, counted.read, total, w.Body)
	}
	w, _, _ = postVideo(t, h, "hero_video", videoPart{filename: "clip.mp4", data: make([]byte, app.MaxVideoBytes+1), fileFirst: true})
	if w.Code != 413 {
		t.Fatalf("file first: %d %s", w.Code, w.Body)
	}
	w, _, _ = postVideo(t, h, "cover", videoPart{filename: "big.png", data: append(testPNG(t, 200, 200), make([]byte, app.MaxMediaBytes)...), fileFirst: true})
	if w.Code != 413 {
		t.Fatalf("file-first image: %d %s", w.Code, w.Body)
	}
	if s.calls != 0 || s.puts != 0 {
		t.Fatalf("oversize reached storage: %+v", s)
	}
}

// A spool that cannot be created is a server failure, not the client's.
func TestMediaUploadSpoolUnavailable(t *testing.T) {
	t.Setenv("TMPDIR", "/nonexistent-site-media-spool")
	s := &mediaStub{}
	h := newTestHandler(&stubStore{}).WithMedia(s, s)
	w, _, _ := postVideo(t, h, "hero_video", videoPart{filename: "clip.mp4", data: mp4fixture.Build(mp4fixture.Options{})})
	if w.Code != 500 || w.Body.String() != `{"error":"an internal error occurred","code":"internal_error"}`+"\n" || s.calls != 0 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

// A file-first image (kind after the file) keeps working.
func TestMediaUploadImageFileFirst(t *testing.T) {
	spoolDir(t)
	s := &mediaStub{}
	h := newTestHandler(&stubStore{}).WithMedia(s, s)
	png := testPNG(t, 200, 200)
	w, _, _ := postVideo(t, h, "cover", videoPart{filename: "x.png", data: png, fileFirst: true})
	if w.Code != 201 || !bytes.Equal(s.data, png) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

// --- GET /media/{id}: Range serving ---

func mediaRouter(h *Handler) *chi.Mux {
	router := chi.NewRouter()
	router.Get("/media/{id}", h.GetMedia)
	return router
}

func getMedia(router http.Handler, id uuid.UUID, rangeHeader string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", "/media/"+id.String(), nil)
	if rangeHeader != "" {
		r.Header.Set("Range", rangeHeader)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	return w
}

func TestPublicMediaRange(t *testing.T) {
	data := []byte("0123456789")
	for _, kind := range []string{"cover", "hero_video"} {
		contentType := map[string]string{"cover": "image/png", "hero_video": "video/mp4"}[kind]
		s := &mediaStub{m: app.StoredMedia{Media: app.Media{ID: uuid.New(), Kind: kind}, ContentType: contentType, StorageKey: "key", ByteSize: int64(len(data))}, data: data}
		router := mediaRouter(newTestHandler(&stubStore{}).WithMedia(s, s))
		for _, tc := range []struct {
			name, header string
			status       int
			body         string
			contentRange string
		}{
			{"no range", "", 200, "0123456789", ""},
			{"single range", "bytes=2-5", 206, "2345", "bytes 2-5/10"},
			{"open ended", "bytes=7-", 206, "789", "bytes 7-9/10"},
			{"suffix", "bytes=-3", 206, "789", "bytes 7-9/10"},
			{"past the end clamps", "bytes=8-99", 206, "89", "bytes 8-9/10"},
			{"multiple ranges are ignored", "bytes=0-1,4-5", 200, "0123456789", ""},
			{"malformed range", "bytes=x-y", 416, "", ""},
		} {
			t.Run(kind+"/"+tc.name, func(t *testing.T) {
				w := getMedia(router, s.m.ID, tc.header)
				if tc.status == 416 {
					if w.Code != 416 || w.Body.Len() != 0 || w.Header().Get("Cache-Control") != "no-store" {
						t.Fatalf("%d %q %v", w.Code, w.Body, w.Header())
					}
					return
				}
				if w.Code != tc.status || w.Body.String() != tc.body {
					t.Fatalf("%d %q", w.Code, w.Body)
				}
				for key, want := range map[string]string{"Content-Type": contentType, "Content-Length": strconv.Itoa(len(tc.body)), "Accept-Ranges": "bytes", "Content-Range": tc.contentRange, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"} {
					if got := w.Header().Get(key); got != want {
						t.Fatalf("%s=%q want %q (%v)", key, got, want, w.Header())
					}
				}
			})
		}
		t.Run(kind+"/unsatisfiable", func(t *testing.T) {
			for _, header := range []string{"bytes=10-", "bytes=50-60"} {
				w := getMedia(router, s.m.ID, header)
				if w.Code != 416 || w.Body.Len() != 0 || w.Header().Get("Content-Range") != "bytes */10" || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("Content-Security-Policy") != "default-src 'none'; sandbox" {
					t.Fatalf("%s: %d %q %v", header, w.Code, w.Body, w.Header())
				}
			}
		})
	}
}

// fakeObject is a lazily fetched reader (like the S3 OpenRange object).
type fakeObject struct {
	*bytes.Reader
	prefetchErr error
	prefetched  []int64 // offset, length
	closed      bool
}

func (o *fakeObject) Prefetch(n int64) error {
	pos, _ := o.Seek(0, io.SeekCurrent)
	o.prefetched = append(o.prefetched, pos, n)
	if o.prefetchErr != nil {
		o.Reader = bytes.NewReader(nil)
	}
	return o.prefetchErr
}
func (o *fakeObject) Close() error { o.closed = true; return nil }

func TestPublicVideoPrefetch(t *testing.T) {
	data := []byte("0123456789")
	newStub := func(err error) (*mediaStub, *fakeObject) {
		obj := &fakeObject{Reader: bytes.NewReader(data), prefetchErr: err}
		return &mediaStub{m: app.StoredMedia{Media: app.Media{ID: uuid.New(), Kind: "hero_video"}, ContentType: "video/mp4", StorageKey: "key", ByteSize: 10}, object: obj}, obj
	}
	s, obj := newStub(nil)
	router := mediaRouter(newTestHandler(&stubStore{}).WithMedia(s, s))
	if w := getMedia(router, s.m.ID, "bytes=4-6"); w.Code != 206 || w.Body.String() != "456" || len(obj.prefetched) != 2 || obj.prefetched[0] != 4 || obj.prefetched[1] != 3 || !obj.closed {
		t.Fatalf("%d %q %v", w.Code, w.Body, obj.prefetched)
	}
	s, obj = newStub(nil)
	router = mediaRouter(newTestHandler(&stubStore{}).WithMedia(s, s))
	if w := getMedia(router, s.m.ID, ""); w.Code != 200 || obj.prefetched[0] != 0 || obj.prefetched[1] != 10 {
		t.Fatalf("%d %v", w.Code, obj.prefetched)
	}
	for _, tc := range []struct {
		err    error
		status int
		body   string
	}{
		{app.ErrMediaNotFound, 404, `{"error":"not found","code":"not_found"}`},
		{app.ErrStorageUnavailable, 500, `{"error":"an internal error occurred","code":"internal_error"}`},
		{errors.New("boom"), 500, `{"error":"an internal error occurred","code":"internal_error"}`},
	} {
		s, _ := newStub(tc.err)
		router := mediaRouter(newTestHandler(&stubStore{}).WithMedia(s, s))
		w := getMedia(router, s.m.ID, "bytes=0-")
		if w.Code != tc.status || w.Body.String() != tc.body+"\n" || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Content-Range") != "" || w.Header().Get("Content-Type") != "application/json" {
			t.Fatalf("%d %q %v", w.Code, w.Body, w.Header())
		}
	}
}
