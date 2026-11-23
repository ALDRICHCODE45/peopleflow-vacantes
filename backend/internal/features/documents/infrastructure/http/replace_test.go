package http

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// P5 handlers: replace (POST …/{doc}/versions), the version list, download by version and delete.

func replace(t *testing.T, h *Handler, draft, doc string, body io.Reader, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	router := chi.NewRouter()
	router.Post("/v/{id}/documents/{doc}/versions", h.Replace)
	req := httptest.NewRequest(http.MethodPost, "/v/"+draft+"/documents/"+doc+"/versions", body)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req = req.WithContext(identitysecurity.ContextWithCompanyContext(req.Context(), *sessionCtx))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func expectedPart(v string) part { return part{name: "expected_version", body: []byte(v)} }

func replaceFiles() *fakeFiles {
	f := okFiles()
	f.current = 2
	f.replaceResp = documents.UploadResponse{Item: documents.Item{ID: "d1", Version: 3, AllowedActions: []documents.Action{documents.ActionDownload}}, Scope: documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true, Documents: 1})}
	return f
}

func TestReplaceHappyPathPassesTheCommandAndAnswersItemAndScope(t *testing.T) {
	files := replaceFiles()
	draft, doc := uuid.New(), uuid.New()
	body, ct := multipartBody(t, expectedPart("2"), part{name: "name", body: []byte("  Contrato   v2.DOCX ")}, filePart("c:\\x\\contrato.docx", []byte("PK data")))
	rec := replace(t, NewHandler(nil, files), draft.String(), doc.String(), body, ct)
	if rec.Code != 201 || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("%d %s %s", rec.Code, rec.Header().Get("Content-Type"), rec.Body)
	}
	if !reflect.DeepEqual(files.calls, []string{"preflight-replace", "stage", "replace"}) {
		t.Fatalf("calls %v", files.calls)
	}
	got := files.replaceCmd
	if got.CompanyID != sessionCtx.CompanyID || got.ActorID != sessionCtx.UserID || got.DraftID != draft || got.DocID != doc || got.ExpectedVersion != 2 {
		t.Fatalf("command %+v", got)
	}
	if got.Name == nil || *got.Name != "Contrato v2" || got.Staged.Size != int64(len("PK data")) {
		t.Fatalf("name/staged %v %+v", got.Name, got.Staged)
	}
	if files.filename != "contrato.docx" {
		t.Fatalf("filename %q", files.filename)
	}
	out := decode(t, rec)
	if len(out) != 2 || out["item"] == nil || out["scope"] == nil {
		t.Fatalf("body %s", rec.Body)
	}
	if rec.Header().Get("Idempotency-Replayed") != "" {
		t.Fatal("replace takes no Idempotency-Key: no replay header")
	}
	if len(files.discarded) != 0 {
		t.Fatalf("a successful replace must keep its object: %v", files.discarded)
	}
}

func TestReplaceWithoutNameKeepsTheName(t *testing.T) {
	files := replaceFiles()
	body, ct := multipartBody(t, filePart("a.pdf", []byte("%PDF-")), expectedPart("2")) // parts after the file are honored
	rec := replace(t, NewHandler(nil, files), uuid.NewString(), uuid.NewString(), body, ct)
	if rec.Code != 201 || files.replaceCmd.Name != nil || files.replaceCmd.ExpectedVersion != 2 {
		t.Fatalf("%d %s name=%v expected=%d", rec.Code, rec.Body, files.replaceCmd.Name, files.replaceCmd.ExpectedVersion)
	}
}

// expected_version before the file: a stale replace is answered before one byte of the file is read.
func TestReplaceStaleVersionBeforeTheFileIsAnsweredWithoutStreaming(t *testing.T) {
	for _, tc := range []struct {
		name     string
		current  int
		expected string
		code     string
		data     map[string]any
	}{
		{"behind", 3, "2", "document_version_conflict", map[string]any{"current_version": float64(3)}},
		{"ahead", 3, "4", "document_version_conflict", map[string]any{"current_version": float64(3)}},
		{"at the version cap", documents.MaxVersions, "25", "document_limit_reached", map[string]any{"kind": "versions", "limit": float64(documents.MaxVersions)}},
		// The stale value is answered first, then the cap.
		{"stale at the version cap", documents.MaxVersions, "24", "document_version_conflict", map[string]any{"current_version": float64(documents.MaxVersions)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := replaceFiles()
			files.current = tc.current
			body, ct := multipartBody(t, expectedPart(tc.expected), filePart("a.pdf", []byte("%PDF-1.7 never read")))
			rec := replace(t, NewHandler(nil, files), uuid.NewString(), uuid.NewString(), body, ct)
			out := decode(t, rec)
			if rec.Code != 409 || out["code"] != tc.code || !equalMaps(out["data"].(map[string]any), tc.data) {
				t.Fatalf("%d %s", rec.Code, rec.Body)
			}
			if !reflect.DeepEqual(files.calls, []string{"preflight-replace"}) || files.streamed != 0 {
				t.Fatalf("the body must not be streamed: calls %v streamed %d", files.calls, files.streamed)
			}
		})
	}
}

func TestReplaceExpectedVersionValidation(t *testing.T) {
	pdf := filePart("a.pdf", []byte("%PDF-"))
	for _, tc := range []struct {
		name   string
		parts  []part
		reason string
	}{
		{"missing", []part{pdf}, "required"},
		{"empty", []part{expectedPart(""), pdf}, "invalid"},
		{"text", []part{expectedPart("abc"), pdf}, "invalid"},
		{"zero", []part{expectedPart("0"), pdf}, "invalid"},
		{"negative", []part{expectedPart("-1"), pdf}, "invalid"},
		{"decimal", []part{expectedPart("1.5"), pdf}, "invalid"},
		{"padded", []part{expectedPart(" 2"), pdf}, "invalid"},
		{"plus sign", []part{expectedPart("+2"), pdf}, "invalid"},
		{"overflow", []part{expectedPart("99999999999999999999"), pdf}, "invalid"},
		{"after the file", []part{pdf, expectedPart("two")}, "invalid"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := replaceFiles()
			body, ct := multipartBody(t, tc.parts...)
			rec := replace(t, NewHandler(nil, files), uuid.NewString(), uuid.NewString(), body, ct)
			out := decode(t, rec)
			fields, _ := out["fields"].([]any)
			if rec.Code != 400 || out["code"] != "validation_error" || len(fields) != 1 ||
				fields[0].(map[string]any)["field"] != "expected_version" || fields[0].(map[string]any)["code"] != tc.reason {
				t.Fatalf("%d %s", rec.Code, rec.Body)
			}
			if containsCall(files.calls, "replace") {
				t.Fatal("nothing may be written")
			}
			// A file that was already streamed must not be left behind.
			if containsCall(files.calls, "stage") && len(files.discarded) != 1 {
				t.Fatalf("staged object not discarded: %v", files.discarded)
			}
		})
	}
}

func containsCall(calls []string, want string) bool {
	for _, c := range calls {
		if c == want {
			return true
		}
	}
	return false
}

func TestReplaceMalformedRequestsAreInvalidAndDiscardWhatWasStaged(t *testing.T) {
	pdf := func() part { return filePart("a.pdf", []byte("%PDF-")) }
	for _, tc := range []struct {
		name   string
		parts  []part
		staged bool
	}{
		{"duplicate expected_version", []part{expectedPart("2"), expectedPart("2"), pdf()}, false},
		{"expected_version as a file", []part{{name: "expected_version", filename: "v.txt", body: []byte("2")}, pdf()}, false},
		{"duplicate file", []part{expectedPart("2"), pdf(), pdf()}, true},
		{"unknown part", []part{expectedPart("2"), pdf(), {name: "extra", body: []byte("x")}}, true},
		{"duplicate name", []part{expectedPart("2"), {name: "name", body: []byte("a")}, {name: "name", body: []byte("b")}, pdf()}, false},
		{"transfer encoding", []part{expectedPart("2"), {name: "file", filename: "a.pdf", body: []byte("%PDF-"), headers: map[string]string{"Content-Transfer-Encoding": "base64"}}}, false},
		{"no file", []part{expectedPart("2")}, false},
		{"no file name", []part{expectedPart("2"), {name: "file", body: []byte("%PDF-")}}, false},
		{"name over 2048 bytes", []part{expectedPart("2"), {name: "name", body: bytes.Repeat([]byte("a"), 2049)}, pdf()}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := replaceFiles()
			body, ct := multipartBody(t, tc.parts...)
			rec := replace(t, NewHandler(nil, files), uuid.NewString(), uuid.NewString(), body, ct)
			if rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" {
				t.Fatalf("%d %s", rec.Code, rec.Body)
			}
			if tc.staged != (len(files.discarded) == 1) || containsCall(files.calls, "replace") {
				t.Fatalf("staged=%v discarded=%v calls=%v", tc.staged, files.discarded, files.calls)
			}
		})
	}
	// Not multipart at all.
	files := replaceFiles()
	if rec := replace(t, NewHandler(nil, files), uuid.NewString(), uuid.NewString(), strings.NewReader("x"), "application/json"); rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" {
		t.Fatalf("not multipart: %d %s", rec.Code, rec.Body)
	}
}

func TestReplaceInvalidNameAndFileAreAnsweredLikeAnUpload(t *testing.T) {
	// A bad name that arrives first is answered before the file streams.
	files := replaceFiles()
	body, ct := multipartBody(t, expectedPart("2"), part{name: "name", body: []byte("  .pdf ")}, filePart("a.pdf", []byte("%PDF-")))
	rec := replace(t, NewHandler(nil, files), uuid.NewString(), uuid.NewString(), body, ct)
	if rec.Code != 400 || decode(t, rec)["code"] != "validation_error" || containsCall(files.calls, "stage") {
		t.Fatalf("%d %s calls %v", rec.Code, rec.Body, files.calls)
	}
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"empty file", documents.ErrEmpty, 400, "validation_error"},
		{"too large", documents.ErrTooLarge, 413, "payload_too_large"},
		{"unsupported", documents.ErrUnsupportedType, 415, "unsupported_media_type"},
		{"mismatch", &documents.MismatchError{Detected: documents.DOCX, Extension: ".pdf"}, 400, "document_content_mismatch"},
		{"storage down", documents.ErrStorageUnavailable, 503, "document_storage_unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := replaceFiles()
			files.stageErr = tc.err
			body, ct := multipartBody(t, expectedPart("2"), filePart("a.pdf", []byte("%PDF-")))
			rec := replace(t, NewHandler(nil, files), uuid.NewString(), uuid.NewString(), body, ct)
			if rec.Code != tc.status || decode(t, rec)["code"] != tc.code || containsCall(files.calls, "replace") {
				t.Fatalf("%d %s calls %v", rec.Code, rec.Body, files.calls)
			}
		})
	}
}

func TestReplacePreflightFailuresAreAnsweredBeforeTheBodyIsRead(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"stakeholder in the store", documents.ErrForbidden, 403, "forbidden"},
		{"former member", documents.ErrTeamAccessEnded, 404, "team_access_ended"},
		{"unknown document", documents.ErrScopeNotFound, 404, "not_found"},
		{"storage disabled", documents.ErrStorageUnavailable, 503, "document_storage_unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := replaceFiles()
			files.preflightErr = tc.err
			body, ct := multipartBody(t, expectedPart("2"), filePart("a.pdf", []byte("%PDF-")))
			rec := replace(t, NewHandler(nil, files), uuid.NewString(), uuid.NewString(), body, ct)
			if rec.Code != tc.status || decode(t, rec)["code"] != tc.code || !reflect.DeepEqual(files.calls, []string{"preflight-replace"}) {
				t.Fatalf("%d %s calls %v", rec.Code, rec.Body, files.calls)
			}
		})
	}
}

func TestReplaceWriteFailuresMapToTheContractCodes(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
		data   map[string]any
	}{
		{"stale under the lock", &documents.VersionConflictError{Current: 4}, 409, "document_version_conflict", map[string]any{"current_version": float64(4)}},
		{"version limit", &documents.LimitReachedError{Kind: "versions", Limit: 25}, 409, "document_limit_reached", map[string]any{"kind": "versions", "limit": float64(25)}},
		{"revoked between pre-flight and commit", documents.ErrTeamAccessEnded, 404, "team_access_ended", nil},
		{"document deleted meanwhile", documents.ErrScopeNotFound, 404, "not_found", nil},
		{"row failure", errors.New("insert placement_document_versions: pq: boom"), 500, "internal_error", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := replaceFiles()
			files.replaceErr = tc.err
			body, ct := multipartBody(t, expectedPart("2"), filePart("a.pdf", []byte("%PDF-")))
			rec := replace(t, NewHandler(nil, files), uuid.NewString(), uuid.NewString(), body, ct)
			out := decode(t, rec)
			if rec.Code != tc.status || out["code"] != tc.code || strings.Contains(rec.Body.String(), "boom") {
				t.Fatalf("%d %s", rec.Code, rec.Body)
			}
			if tc.data != nil && !equalMaps(out["data"].(map[string]any), tc.data) {
				t.Fatalf("data %v", out["data"])
			}
			if len(files.discarded) != 0 { // the service removes the object on a failed write
				t.Fatalf("discarded %v", files.discarded)
			}
		})
	}
}

func TestReplaceFailsClosed(t *testing.T) {
	files := replaceFiles()
	body, ct := multipartBody(t, expectedPart("2"), filePart("a.pdf", []byte("%PDF-")))
	for _, ids := range [][2]string{{"nope", uuid.NewString()}, {uuid.NewString(), "nope"}} {
		if rec := replace(t, NewHandler(nil, files), ids[0], ids[1], bytes.NewReader(body.Bytes()), ct); rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" {
			t.Fatalf("%v: %d %s", ids, rec.Code, rec.Body)
		}
	}
	if len(files.calls) != 0 {
		t.Fatalf("calls %v", files.calls)
	}
	for _, h := range []*Handler{nil, NewHandler(nil, nil)} {
		if rec := replace(t, h, uuid.NewString(), uuid.NewString(), bytes.NewReader(body.Bytes()), ct); rec.Code != 500 || decode(t, rec)["code"] != "internal_error" {
			t.Fatalf("nil service: %d %s", rec.Code, rec.Body)
		}
	}
	router := chi.NewRouter()
	router.Post("/v/{id}/documents/{doc}/versions", NewHandler(nil, files).Replace)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v/"+uuid.NewString()+"/documents/"+uuid.NewString()+"/versions", nil))
	if rec.Code != 500 || len(files.calls) != 0 {
		t.Fatalf("no company context: %d %s", rec.Code, rec.Body)
	}
}

// --- version list -----------------------------------------------------------------------------------------------

func serveVersions(t *testing.T, h *Handler, draft, doc string) *httptest.ResponseRecorder {
	t.Helper()
	router := chi.NewRouter()
	router.Get("/v/{id}/documents/{doc}/versions", h.Versions)
	req := httptest.NewRequest(http.MethodGet, "/v/"+draft+"/documents/"+doc+"/versions", nil)
	req = req.WithContext(identitysecurity.ContextWithCompanyContext(req.Context(), *sessionCtx))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestVersionsWritesTheList(t *testing.T) {
	reader := &fakeReader{versions: documents.VersionList{DocumentID: "d1", Name: "Contrato", Versions: []documents.VersionItem{{Version: 2, Format: documents.PDF, IsCurrent: true}, {Version: 1, Format: documents.DOCX}}}}
	draft, doc := uuid.New(), uuid.New()
	rec := serveVersions(t, NewHandler(reader, nil), draft.String(), doc.String())
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if reader.company != sessionCtx.CompanyID || reader.actor != sessionCtx.UserID || reader.v != draft || reader.versionsDoc != doc {
		t.Fatalf("store called with %+v", reader)
	}
	versions := decode(t, rec)["versions"].([]any)
	if len(versions) != 2 || versions[0].(map[string]any)["is_current"] != true || versions[1].(map[string]any)["is_current"] != false {
		t.Fatalf("%s", rec.Body)
	}
}

func TestVersionsErrorsAndBadInput(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"foreign document", documents.ErrScopeNotFound, 404, "not_found"},
		{"former member", documents.ErrTeamAccessEnded, 404, "team_access_ended"},
		{"anything else", errors.New("pq: boom"), 500, "internal_error"},
	} {
		rec := serveVersions(t, NewHandler(&fakeReader{versionsErr: tc.err}, nil), uuid.NewString(), uuid.NewString())
		if rec.Code != tc.status || decode(t, rec)["code"] != tc.code || strings.Contains(rec.Body.String(), "boom") {
			t.Fatalf("%s: %d %s", tc.name, rec.Code, rec.Body)
		}
	}
	reader := &fakeReader{}
	for _, ids := range [][2]string{{"nope", uuid.NewString()}, {uuid.NewString(), "nope"}} {
		if rec := serveVersions(t, NewHandler(reader, nil), ids[0], ids[1]); rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" {
			t.Fatalf("%v: %d %s", ids, rec.Code, rec.Body)
		}
	}
	if reader.calls != 0 {
		t.Fatal("the store was reached with a bad id")
	}
	for _, h := range []*Handler{nil, NewHandler(nil, nil)} {
		if rec := serveVersions(t, h, uuid.NewString(), uuid.NewString()); rec.Code != 500 {
			t.Fatalf("nil store: %d", rec.Code)
		}
	}
}

// --- download by version ----------------------------------------------------------------------------------------

func downloadVersion(t *testing.T, h *Handler, draft, doc, n string) *httptest.ResponseRecorder {
	t.Helper()
	router := chi.NewRouter()
	router.Get("/v/{id}/documents/{doc}/versions/{n}/file", h.FileVersion)
	req := httptest.NewRequest(http.MethodGet, "/v/"+draft+"/documents/"+doc+"/versions/"+n+"/file", nil)
	req = req.WithContext(identitysecurity.ContextWithCompanyContext(req.Context(), *sessionCtx))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestFileVersionStreamsTheNumberedVersionWithTheDownloadHeaders(t *testing.T) {
	body := &trackedBody{Reader: strings.NewReader("PK-old")}
	files := &fakeFiles{file: documents.File{Name: "Informe año.docx", ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Size: 6, Reader: body}}
	draft, doc := uuid.New(), uuid.New()
	rec := downloadVersion(t, NewHandler(nil, files), draft.String(), doc.String(), "3")
	if rec.Code != 200 || rec.Body.String() != "PK-old" || !body.closed || files.versionNumber != 3 {
		t.Fatalf("%d %q closed=%v version=%d", rec.Code, rec.Body, body.closed, files.versionNumber)
	}
	h := rec.Header()
	if h.Get("Content-Disposition") != "attachment; filename*=utf-8''Informe%20a%C3%B1o.docx" || h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Content-Length") != "6" {
		t.Fatalf("headers %v", h)
	}
	if files.downloadIDs[0] != draft || files.downloadIDs[1] != doc {
		t.Fatalf("ids %v", files.downloadIDs)
	}
}

func TestFileVersionRejectsAMalformedNumberBeforeTheStore(t *testing.T) {
	files := &fakeFiles{}
	for _, n := range []string{"abc", "0", "-1", "1.5", "+2", "99999999999999999999", "2e1"} {
		rec := downloadVersion(t, NewHandler(nil, files), uuid.NewString(), uuid.NewString(), n)
		if rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" {
			t.Fatalf("n=%q: %d %s", n, rec.Code, rec.Body)
		}
	}
	if len(files.calls) != 0 {
		t.Fatalf("calls %v", files.calls)
	}
}

func TestFileVersionErrorsServeNoBytes(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"unknown version", documents.ErrScopeNotFound, 404, "not_found"},
		{"file gone from storage", documents.ErrNotFound, 404, "not_found"},
		{"storage unavailable", documents.ErrStorageUnavailable, 503, "document_storage_unavailable"},
		{"audit failed", errors.New("insert audit: boom"), 500, "internal_error"},
	} {
		rec := downloadVersion(t, NewHandler(nil, &fakeFiles{downloadErr: tc.err}), uuid.NewString(), uuid.NewString(), "1")
		if rec.Code != tc.status || decode(t, rec)["code"] != tc.code || rec.Header().Get("Content-Disposition") != "" || strings.Contains(rec.Body.String(), "boom") {
			t.Fatalf("%s: %d %s", tc.name, rec.Code, rec.Body)
		}
	}
	for _, h := range []*Handler{nil, NewHandler(nil, nil)} {
		if rec := downloadVersion(t, h, uuid.NewString(), uuid.NewString(), "1"); rec.Code != 500 {
			t.Fatalf("nil service: %d", rec.Code)
		}
	}
}

// --- delete -----------------------------------------------------------------------------------------------------

func deleteDoc(t *testing.T, h *Handler, draft, doc string) *httptest.ResponseRecorder {
	t.Helper()
	router := chi.NewRouter()
	router.Delete("/v/{id}/documents/{doc}", h.Delete)
	req := httptest.NewRequest(http.MethodDelete, "/v/"+draft+"/documents/"+doc, nil)
	req = req.WithContext(identitysecurity.ContextWithCompanyContext(req.Context(), *sessionCtx))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestDeleteAnswers200WithTheScopeOnly(t *testing.T) {
	files := &fakeFiles{deleteResp: documents.ScopeResponse{Scope: documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true})}}
	draft, doc := uuid.New(), uuid.New()
	rec := deleteDoc(t, NewHandler(nil, files), draft.String(), doc.String())
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	out := decode(t, rec)
	if len(out) != 1 || out["scope"] == nil {
		t.Fatalf("body %s", rec.Body)
	}
	if files.deleteIDs[0] != draft || files.deleteIDs[1] != doc {
		t.Fatalf("ids %v", files.deleteIDs)
	}
}

func TestDeleteErrorsAndFailClosed(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"unknown or already deleted", documents.ErrScopeNotFound, 404, "not_found"},
		{"former member", documents.ErrTeamAccessEnded, 404, "team_access_ended"},
		{"stakeholder in the store", documents.ErrForbidden, 403, "forbidden"},
		{"row failure", errors.New("delete placement_documents: boom"), 500, "internal_error"},
	} {
		rec := deleteDoc(t, NewHandler(nil, &fakeFiles{deleteErr: tc.err}), uuid.NewString(), uuid.NewString())
		if rec.Code != tc.status || decode(t, rec)["code"] != tc.code || strings.Contains(rec.Body.String(), "boom") {
			t.Fatalf("%s: %d %s", tc.name, rec.Code, rec.Body)
		}
	}
	files := &fakeFiles{}
	for _, ids := range [][2]string{{"nope", uuid.NewString()}, {uuid.NewString(), "nope"}} {
		if rec := deleteDoc(t, NewHandler(nil, files), ids[0], ids[1]); rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" {
			t.Fatalf("%v: %d %s", ids, rec.Code, rec.Body)
		}
	}
	if len(files.calls) != 0 {
		t.Fatalf("calls %v", files.calls)
	}
	for _, h := range []*Handler{nil, NewHandler(nil, nil)} {
		if rec := deleteDoc(t, h, uuid.NewString(), uuid.NewString()); rec.Code != 500 {
			t.Fatalf("nil service: %d", rec.Code)
		}
	}
}
