package http

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// P6: the same handlers serve V/participations/{pid}/documents. The `{pid}` URL parameter is the only thing that makes the
// scope a participation; every shape and every rule is the vacancy scope's (placement-vacancy-documents-v1, D1, D3).

// participationRouter mounts every handler under the participation prefix, exactly as cmd/api's route table does.
func participationRouter(h *Handler) chi.Router {
	p := "/v/{id}/participations/{pid}/documents"
	router := chi.NewRouter()
	router.Get(p, h.List)
	router.Post(p, h.Upload)
	router.Get(p+"/{doc}/file", h.File)
	router.Post(p+"/{doc}/versions", h.Replace)
	router.Get(p+"/{doc}/versions", h.Versions)
	router.Get(p+"/{doc}/versions/{n}/file", h.FileVersion)
	router.Delete(p+"/{doc}", h.Delete)
	return router
}

// sameTarget compares two targets by value (ParticipationID is a pointer).
func sameTarget(a, b documents.Target) bool {
	if a.DraftID != b.DraftID || (a.ParticipationID == nil) != (b.ParticipationID == nil) {
		return false
	}
	return a.ParticipationID == nil || *a.ParticipationID == *b.ParticipationID
}

func doParticipation(t *testing.T, router chi.Router, method, path string, cc *identitysecurity.CompanyContext) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if cc != nil {
		req = req.WithContext(identitysecurity.ContextWithCompanyContext(req.Context(), *cc))
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestParticipationRoutesBuildAParticipationTarget(t *testing.T) {
	draft, pid, doc := uuid.New(), uuid.New(), uuid.New()
	want := documents.ParticipationTarget(draft, pid)
	base := "/v/" + draft.String() + "/participations/" + pid.String() + "/documents"

	reader := &fakeReader{list: documents.List{Items: []documents.Item{}, Links: []documents.Link{}}}
	files := &fakeFiles{file: documents.File{Name: "a.pdf", ContentType: "application/pdf", Size: 1, Reader: io.NopCloser(strings.NewReader("x"))}, current: 1}
	router := participationRouter(NewHandler(reader, files))

	if rec := doParticipation(t, router, http.MethodGet, base, sessionCtx); rec.Code != 200 || !sameTarget(reader.target, want) {
		t.Fatalf("list: %d %s target %+v", rec.Code, rec.Body, reader.target)
	}
	if rec := doParticipation(t, router, http.MethodGet, base+"/"+doc.String()+"/versions", sessionCtx); rec.Code != 200 || !sameTarget(reader.target, want) {
		t.Fatalf("versions: %d %s target %+v", rec.Code, rec.Body, reader.target)
	}
	if rec := doParticipation(t, router, http.MethodGet, base+"/"+doc.String()+"/file", sessionCtx); rec.Code != 200 || !sameTarget(files.target, want) {
		t.Fatalf("file: %d %s target %+v", rec.Code, rec.Body, files.target)
	}
	files.file.Reader = io.NopCloser(strings.NewReader("x"))
	if rec := doParticipation(t, router, http.MethodGet, base+"/"+doc.String()+"/versions/2/file", sessionCtx); rec.Code != 200 || !sameTarget(files.target, want) || files.versionNumber != 2 {
		t.Fatalf("version file: %d %s target %+v", rec.Code, rec.Body, files.target)
	}
	if rec := doParticipation(t, router, http.MethodDelete, base+"/"+doc.String(), sessionCtx); rec.Code != 200 || !sameTarget(files.target, want) || files.deleteIDs[0] != draft || files.deleteIDs[1] != doc {
		t.Fatalf("delete: %d %s target %+v", rec.Code, rec.Body, files.target)
	}

	// Upload and replace carry the target into the pre-flight and into the command.
	body, ct := multipartBody(t, filePart("a.pdf", []byte("%PDF-1.7 data")))
	up := httptest.NewRequest(http.MethodPost, base, body)
	up.Header.Set("Content-Type", ct)
	up = up.WithContext(identitysecurity.ContextWithCompanyContext(up.Context(), *sessionCtx))
	rec := httptest.NewRecorder()
	files.result = documents.UploadResult{Body: []byte(`{}`)}
	router.ServeHTTP(rec, up)
	if rec.Code != 201 || !sameTarget(files.target, want) || !sameTarget(files.cmd.Target, want) {
		t.Fatalf("upload: %d %s target %+v cmd %+v", rec.Code, rec.Body, files.target, files.cmd.Target)
	}
	body, ct = multipartBody(t, part{name: "expected_version", body: []byte("1")}, filePart("b.pdf", []byte("%PDF-1.7 data")))
	rp := httptest.NewRequest(http.MethodPost, base+"/"+doc.String()+"/versions", body)
	rp.Header.Set("Content-Type", ct)
	rp = rp.WithContext(identitysecurity.ContextWithCompanyContext(rp.Context(), *sessionCtx))
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, rp)
	if rec.Code != 201 || !sameTarget(files.replaceCmd.Target, want) || files.replaceCmd.DocID != doc {
		t.Fatalf("replace: %d %s cmd %+v", rec.Code, rec.Body, files.replaceCmd)
	}
}

// The vacancy routes never carry a pid: their target is the vacancy scope, whatever the participation routes do.
func TestVacancyRoutesKeepTheVacancyTarget(t *testing.T) {
	draft := uuid.New()
	reader := &fakeReader{list: documents.List{}}
	if rec := serve(t, NewHandler(reader, nil), draft.String(), sessionCtx); rec.Code != 200 || !sameTarget(reader.target, documents.VacancyTarget(draft)) {
		t.Fatalf("%d %s target %+v", rec.Code, rec.Body, reader.target)
	}
}

// A malformed pid is a malformed request like a malformed id; a well-formed pid is never judged here (the store decides).
func TestParticipationRoutesRejectAMalformedPidBeforeTheStore(t *testing.T) {
	reader, files := &fakeReader{}, &fakeFiles{}
	router := participationRouter(NewHandler(reader, files))
	draft, doc := uuid.NewString(), uuid.NewString()
	base := "/v/" + draft + "/participations/not-a-uuid/documents"
	for method, path := range map[string]string{
		http.MethodGet + " list":     base,
		http.MethodPost + " upload":  base,
		http.MethodGet + " file":     base + "/" + doc + "/file",
		http.MethodGet + " versions": base + "/" + doc + "/versions",
		http.MethodDelete + " del":   base + "/" + doc,
	} {
		rec := doParticipation(t, router, strings.Fields(method)[0], path, sessionCtx)
		if rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" {
			t.Fatalf("%s: %d %s", method, rec.Code, rec.Body)
		}
	}
	if reader.calls != 0 || len(files.calls) != 0 {
		t.Fatalf("the store was reached: reader %d files %v", reader.calls, files.calls)
	}
}

// Store answers pass through the usual mapping: a pid that is not of the process is the generic 404.
func TestParticipationRoutesMapAWrongPidToNotFound(t *testing.T) {
	reader := &fakeReader{err: documents.ErrScopeNotFound}
	files := &fakeFiles{preflightErr: documents.ErrScopeNotFound, downloadErr: documents.ErrScopeNotFound, deleteErr: documents.ErrScopeNotFound}
	router := participationRouter(NewHandler(reader, files))
	base := "/v/" + uuid.NewString() + "/participations/" + uuid.NewString() + "/documents"
	doc := uuid.NewString()
	for name, tc := range map[string][2]string{
		"list":   {http.MethodGet, base},
		"file":   {http.MethodGet, base + "/" + doc + "/file"},
		"delete": {http.MethodDelete, base + "/" + doc},
	} {
		rec := doParticipation(t, router, tc[0], tc[1], sessionCtx)
		if rec.Code != 404 || decode(t, rec)["code"] != "not_found" {
			t.Fatalf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
	// Upload: refused by the pre-flight before one byte is read.
	body, ct := multipartBody(t, filePart("a.pdf", []byte("%PDF-1.7 data")))
	req := httptest.NewRequest(http.MethodPost, base, body)
	req.Header.Set("Content-Type", ct)
	req = req.WithContext(identitysecurity.ContextWithCompanyContext(req.Context(), *sessionCtx))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 404 || decode(t, rec)["code"] != "not_found" || files.calls[len(files.calls)-1] != "preflight" {
		t.Fatalf("upload: %d %s calls %v", rec.Code, rec.Body, files.calls)
	}
	for _, c := range files.calls {
		if c == "stage" || c == "upload" {
			t.Fatalf("a refused pre-flight still streamed: %v", files.calls)
		}
	}
}
