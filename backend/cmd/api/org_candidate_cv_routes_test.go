package main

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	pool "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	poolhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http/pool"
	companies "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

// This fake exercises transport/composition only; SQL effects have separate
// integration tests, not an in-memory imitation of transactions.
type orgCVReader struct {
	orgDetailReader
	failure error
	input   board.ManualInput
}

func (s *orgCVReader) CorrectCV(ctx context.Context, c, a uuid.UUID, kind string, id, pid uuid.UUID, tag string, in board.ManualInput, inspector board.ManualCVInspector, storage board.ManualFileStorage) (pool.Detail, error) {
	if c != routeTestCompanyID || a == uuid.Nil {
		return pool.Detail{}, errors.New("scope")
	}
	if id != routeTestDraftID || pid != routeTestDraftID {
		return pool.Detail{}, board.ErrNotFound
	}
	if tag != pool.ETag(kind, id, 1) {
		return pool.Detail{}, pool.ErrPreconditionFailed
	}
	if s.failure != nil {
		return pool.Detail{}, s.failure
	}
	if _, err := inspector.Inspect(in.FileName, in.CV); err != nil {
		return pool.Detail{}, err
	}
	s.input = in
	d, err := s.Detail(ctx, c, kind, id)
	d.ETag = pool.ETag(kind, id, 2)
	d.Participations = []pool.DetailParticipation{{ID: pid, CV: &pool.CurrentCV{CV: pool.CV{FileName: in.FileName, UploadedAt: time.Unix(1, 0).UTC()}, Source: "company"}, OriginalCV: &pool.CV{FileName: "original.pdf", UploadedAt: time.Unix(0, 0).UTC()}}}
	return d, err
}
func (s *orgCVReader) OriginalFile(ctx context.Context, c uuid.UUID, kind string, id, pid uuid.UUID) (board.File, error) {
	return s.File(ctx, c, kind, id, pid)
}
func orgCVDocx(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for _, name := range []string{"[Content_Types].xml", "word/document.xml"} {
		p, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = p.Write([]byte("<xml/>")); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func orgCVMultipart(t *testing.T, name string, data []byte, extra string) (string, string) {
	t.Helper()
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	if name != "" {
		p, err := w.CreateFormFile("cv", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = p.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if extra != "" {
		p, err := w.CreateFormField(extra)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = p.Write([]byte("extra"))
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.String(), w.FormDataContentType()
}
func TestOrgCandidateCVHTTP(t *testing.T) {
	for _, kind := range []string{"manual", "organic"} {
		t.Run(kind, func(t *testing.T) {
			reader := &orgCVReader{}
			router := newRouter(routerDeps{candidatePoolHandler: poolhttp.NewHandler(pool.NewService(reader)).WithManualCVPorts(manualCVInspector{}, manualCVStorage{}), requireAuth: routeRequireAuth, requireOwner: routeRoleGate(companies.OwnerRole, routeTestOwnerHeader), requireRecruiter: routeRoleGate(companies.RecruiterRole, routeTestRecruiterHeader)})
			path := orgCandidatesPath + "/" + kind + "/" + routeTestDraftID.String() + "/participations/" + routeTestDraftID.String() + "/cv"
			for _, tc := range []struct {
				name, file, data, extra, tag string
				status                       int
				code                         string
				failure                      error
			}{
				{name: "success", file: "corrected.pdf", data: "%PDF-1", status: 200},
				{name: "docx", file: "corrected.docx", data: string(orgCVDocx(t)), status: 200},
				{name: "sniffing", file: "corrected.pdf", data: "not pdf", status: 400, code: "cv_content_mismatch"},
				{name: "unsupported", file: "corrected.txt", data: "%PDF-1", status: 415, code: "cv_unsupported_type"},
				{name: "oversize", file: "corrected.pdf", data: strings.Repeat("x", 5242881), status: 413, code: "cv_too_large"},
				{name: "empty", file: "corrected.pdf", status: 400, code: "cv_content_mismatch"},
				{name: "missing", status: 400, code: "validation_error"},
				{name: "unknown part", file: "corrected.pdf", data: "%PDF-1", extra: "other", status: 400, code: "invalid_request"},
				{name: "repeated part", file: "corrected.pdf", data: "%PDF-1", extra: "cv", status: 400, code: "invalid_request"},
				{name: "weak tag", file: "corrected.pdf", data: "%PDF-1", tag: "W/\"weak\"", status: 412, code: "precondition_failed"},
				{name: "missing participation", file: "corrected.pdf", data: "%PDF-1", status: 404, code: "not_found", failure: board.ErrNotFound},
				{name: "storage", file: "corrected.pdf", data: "%PDF-1", status: 503, code: "cv_storage_unavailable", failure: board.ErrStorageUnavailable},
				{name: "private failure", file: "corrected.pdf", data: "%PDF-1", status: 500, code: "internal_error", failure: errors.New("PRIVATE")},
			} {
				t.Run(tc.name, func(t *testing.T) {
					reader.failure = tc.failure
					body, contentType := orgCVMultipart(t, tc.file, []byte(tc.data), tc.extra)
					tag := tc.tag
					if tag == "" {
						tag = pool.ETag(kind, routeTestDraftID, 1)
					}
					w := doRouteRequest(t, router, "POST", path, body, map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": tag, "Content-Type": contentType})
					assertDraftRouteNoStore(t, w)
					if w.Code != tc.status {
						t.Fatalf("%d %s", w.Code, w.Body.String())
					}
					if tc.code != "" && routeCatalogCode(t, w) != tc.code {
						t.Fatal(w.Body.String())
					}
					if strings.Contains(w.Body.String(), "PRIVATE") {
						t.Fatal(w.Body.String())
					}
					if tc.status == 200 {
						if w.Header().Get("ETag") != pool.ETag(kind, routeTestDraftID, 2) || !strings.Contains(w.Body.String(), `"source":"company"`) || !strings.Contains(w.Body.String(), `"original_cv":{"file_name":"original.pdf"`) {
							t.Fatal(w.Header(), w.Body.String())
						}
					}
				})
			}
			reader.failure = nil
			w := doRouteRequest(t, router, "GET", path+"/original", "", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader})
			assertDraftRouteNoStore(t, w)
			if w.Code != 200 || w.Body.String() != "%PDF-x" || w.Header().Get("Content-Disposition") != `attachment; filename="Exact CV.pdf"` || w.Header().Get("Content-Type") != "application/pdf" || w.Header().Get("Content-Length") != "6" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatal(w.Code, w.Header(), w.Body.String())
			}
			// A malformed body still receives the private contract envelope.
			req := httptest.NewRequest(http.MethodPost, path, io.NopCloser(strings.NewReader("bad")))
			req.Header.Set("X-Test-Sub", "sub")
			req.Header.Set("X-Test-Role", routeTestRecruiterHeader)
			req.Header.Set("If-Match", pool.ETag(kind, routeTestDraftID, 1))
			out := httptest.NewRecorder()
			router.ServeHTTP(out, req)
			if out.Code != 400 {
				t.Fatal(out.Code)
			}
		})
	}
}

func TestOrgCandidateCVRoutes(t *testing.T) {
	path := orgCandidatesPath + "/manual/" + routeTestDraftID.String() + "/participations/" + routeTestDraftID.String() + "/cv"
	recruiter := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	for _, tc := range []struct {
		name, method, suffix string
		headers              map[string]string
		status               int
		code                 string
	}{
		{"upload anonymous", "POST", "", nil, 401, "unauthenticated"},
		{"upload candidate", "POST", "", map[string]string{"X-Test-Sub": "candidate"}, 403, "forbidden"},
		{"upload precondition", "POST", "", recruiter, 428, "precondition_required"},
		{"original anonymous", "GET", "/original", nil, 401, "unauthenticated"},
		{"original candidate", "GET", "/original", map[string]string{"X-Test-Sub": "candidate"}, 403, "forbidden"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := doRouteRequest(t, orgCandidatesRouter(&orgDetailReader{}), tc.method, path+tc.suffix, "", tc.headers)
			assertDraftRouteNoStore(t, w)
			if w.Code != tc.status || routeCatalogCode(t, w) != tc.code {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
		})
	}
}
