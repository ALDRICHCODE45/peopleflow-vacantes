package http

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/google/uuid"
)

type countedBody struct {
	io.Reader
	read int
}

func (b *countedBody) Read(p []byte) (int, error) {
	n, err := b.Reader.Read(p)
	b.read += n
	return n, err
}
func (b *countedBody) Close() error { return nil }
func TestMediaFileReadBound(t *testing.T) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("kind", "cover")
	f, err := mw.CreateFormFile("file", "oversize.png")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.Write(make([]byte, app.MaxMediaBytes+32*1024))
	_ = mw.Close()
	counted := &countedBody{Reader: bytes.NewReader(body.Bytes())}
	r := httptest.NewRequest("POST", "/", counted)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	r = r.WithContext(security.ContextWithCompanyContext(r.Context(), security.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}))
	s := &mediaStub{}
	h := newTestHandler(&stubStore{}).WithMedia(s, s)
	w := httptest.NewRecorder()
	h.UploadMedia(w, r)
	if w.Code != 413 || counted.read >= body.Len() || counted.read > app.MaxMediaBytes+8192 {
		t.Fatalf("status=%d bytes read=%d total=%d", w.Code, counted.read, body.Len())
	}
	if s.calls != 0 || s.puts != 0 || s.rows != 0 {
		t.Fatalf("rejected upload reached write: %+v", s)
	}
}
func TestMediaMultipartRejectionsDoNotWrite(t *testing.T) {
	valid := testPNG(t, 200, 200)
	for _, name := range []string{"multiple files", "unknown field", "missing kind"} {
		t.Run(name, func(t *testing.T) {
			var body bytes.Buffer
			mw := multipart.NewWriter(&body)
			if name != "missing kind" {
				_ = mw.WriteField("kind", "cover")
			}
			f, err := mw.CreateFormFile("file", "image.png")
			if err != nil {
				t.Fatal(err)
			}
			_, _ = f.Write(valid)
			if name == "multiple files" {
				f, err = mw.CreateFormFile("file", "second.png")
				if err != nil {
					t.Fatal(err)
				}
				_, _ = f.Write(valid)
			}
			if name == "unknown field" {
				_ = mw.WriteField("unknown", "x")
			}
			_ = mw.Close()
			r := httptest.NewRequest("POST", "/", &body)
			r.Header.Set("Content-Type", mw.FormDataContentType())
			r = r.WithContext(security.ContextWithCompanyContext(r.Context(), security.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}))
			s := &mediaStub{}
			h := newTestHandler(&stubStore{}).WithMedia(s, s)
			w := httptest.NewRecorder()
			h.UploadMedia(w, r)
			if w.Code != 400 || s.calls != 0 || s.puts != 0 || s.rows != 0 {
				t.Fatalf("status=%d store=%+v body=%s", w.Code, s, w.Body)
			}
		})
	}
}
