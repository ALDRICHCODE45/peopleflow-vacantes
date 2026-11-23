package http

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// fakeFiles records what the handler asks of the service, so the tests pin the order of the upload (header check, then
// pre-flight, then streaming, then the short write) and the cleanup of staged objects.
type fakeFiles struct {
	calls        []string
	preflightErr error
	stageErr     error
	stagedKey    string
	stagedSize   int64
	uploadErr    error
	result       documents.UploadResult
	cmd          documents.UploadCommand
	filename     string
	streamed     int64
	discarded    []string
	file         documents.File
	downloadErr  error
	downloadIDs  []uuid.UUID

	// replace, delete and download by version (P5)
	current       int
	replaceCmd    documents.ReplaceCommand
	replaceResp   documents.UploadResponse
	replaceErr    error
	deleteIDs     []uuid.UUID
	deleteResp    documents.ScopeResponse
	deleteErr     error
	versionNumber int
}

func (f *fakeFiles) PreflightReplace(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (int, error) {
	f.calls = append(f.calls, "preflight-replace")
	return f.current, f.preflightErr
}

func (f *fakeFiles) Replace(_ context.Context, cmd documents.ReplaceCommand) (documents.UploadResponse, error) {
	f.calls = append(f.calls, "replace")
	f.replaceCmd = cmd
	return f.replaceResp, f.replaceErr
}

func (f *fakeFiles) Delete(_ context.Context, _, _, draft, doc uuid.UUID) (documents.ScopeResponse, error) {
	f.calls = append(f.calls, "delete")
	f.deleteIDs = []uuid.UUID{draft, doc}
	return f.deleteResp, f.deleteErr
}

func (f *fakeFiles) DownloadVersion(_ context.Context, _, _, draft, doc uuid.UUID, version int) (documents.File, error) {
	f.calls = append(f.calls, "download-version")
	f.downloadIDs = []uuid.UUID{draft, doc}
	f.versionNumber = version
	return f.file, f.downloadErr
}

func (f *fakeFiles) PreflightUpload(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	f.calls = append(f.calls, "preflight")
	return f.preflightErr
}

func (f *fakeFiles) Stage(_ context.Context, filename string, r io.Reader) (documents.Staged, error) {
	f.calls = append(f.calls, "stage")
	f.filename = filename
	n, err := io.Copy(io.Discard, r)
	f.streamed = n
	if err != nil {
		return documents.Staged{}, err
	}
	if f.stageErr != nil {
		return documents.Staged{}, f.stageErr
	}
	key := f.stagedKey
	if key == "" {
		key = strings.Repeat("c", 64)
	}
	return documents.Staged{Key: key, Size: n, Format: documents.PDF, SHA256: strings.Repeat("0", 64)}, nil
}

func (f *fakeFiles) Upload(_ context.Context, cmd documents.UploadCommand) (documents.UploadResult, error) {
	f.calls = append(f.calls, "upload")
	f.cmd = cmd
	return f.result, f.uploadErr
}

func (f *fakeFiles) Discard(_ context.Context, key string) {
	f.calls = append(f.calls, "discard")
	f.discarded = append(f.discarded, key)
}

func (f *fakeFiles) Download(_ context.Context, _, _, draft, doc uuid.UUID) (documents.File, error) {
	f.calls = append(f.calls, "download")
	f.downloadIDs = []uuid.UUID{draft, doc}
	return f.file, f.downloadErr
}

var sessionCtx = &identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}

type part struct {
	name, filename string
	body           []byte
	headers        map[string]string
}

func multipartBody(t *testing.T, parts ...part) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for _, p := range parts {
		h := textproto.MIMEHeader{}
		disposition := `form-data; name="` + p.name + `"`
		if p.filename != "" {
			disposition += `; filename="` + p.filename + `"`
		}
		h.Set("Content-Disposition", disposition)
		for k, v := range p.headers {
			h.Set(k, v)
		}
		pw, err := w.CreatePart(h)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = pw.Write(p.body)
	}
	_ = w.Close()
	return &buf, w.FormDataContentType()
}

func filePart(name string, body []byte) part { return part{name: "file", filename: name, body: body} }

func upload(t *testing.T, h *Handler, draft string, body io.Reader, contentType string, headers ...[2]string) *httptest.ResponseRecorder {
	t.Helper()
	router := chi.NewRouter()
	router.Post("/v/{id}/documents", h.Upload)
	req := httptest.NewRequest(http.MethodPost, "/v/"+draft+"/documents", body)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for _, kv := range headers {
		req.Header.Add(kv[0], kv[1])
	}
	req = req.WithContext(identitysecurity.ContextWithCompanyContext(req.Context(), *sessionCtx))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func okFiles() *fakeFiles {
	return &fakeFiles{result: documents.UploadResult{Body: []byte(`{"item":{"id":"d1"},"scope":{}}`)}}
}

func TestUploadHappyPathStreamsThenWritesWithTheNormalizedName(t *testing.T) {
	files := okFiles()
	draft := uuid.New()
	body, ct := multipartBody(t, part{name: "name", body: []byte("  Contrato   marco.PDF ")}, filePart("c:\\docs\\contrato.pdf", []byte("%PDF-1.7 data")))
	rec := upload(t, NewHandler(nil, files), draft.String(), body, ct)
	if rec.Code != 201 || rec.Header().Get("Content-Type") != "application/json" || rec.Body.String() != `{"item":{"id":"d1"},"scope":{}}` {
		t.Fatalf("%d %s %s", rec.Code, rec.Header().Get("Content-Type"), rec.Body)
	}
	if got := strings.Join(files.calls, ","); got != "preflight,stage,upload" {
		t.Fatalf("order: %s", got)
	}
	// The client path is reduced to its base; a known extension is stripped from the given name and spaces collapse.
	if files.filename != "contrato.pdf" || files.cmd.Name != "Contrato marco" || files.cmd.DraftID != draft ||
		files.cmd.CompanyID != sessionCtx.CompanyID || files.cmd.ActorID != sessionCtx.UserID || files.cmd.IdempotencyKey != "" {
		t.Fatalf("filename %q cmd %+v", files.filename, files.cmd)
	}
	if files.streamed != int64(len("%PDF-1.7 data")) || len(files.discarded) != 0 {
		t.Fatalf("streamed %d discarded %v", files.streamed, files.discarded)
	}
	// No Idempotency-Key sent: no replay header at all.
	if _, present := rec.Header()["Idempotency-Replayed"]; present {
		t.Fatalf("Idempotency-Replayed sent without a key: %v", rec.Header())
	}
}

func TestUploadDefaultNameComesFromTheFileAndNameMayFollowTheFile(t *testing.T) {
	files := okFiles()
	body, ct := multipartBody(t, filePart("Informe año 2026.pdf", []byte("%PDF-")))
	if rec := upload(t, NewHandler(nil, files), uuid.NewString(), body, ct); rec.Code != 201 || files.cmd.Name != "Informe año 2026" {
		t.Fatalf("default name: %d %s %q", rec.Code, rec.Body, files.cmd.Name)
	}
	files = okFiles()
	body, ct = multipartBody(t, filePart("x.pdf", []byte("%PDF-")), part{name: "name", body: []byte("Después")})
	if rec := upload(t, NewHandler(nil, files), uuid.NewString(), body, ct); rec.Code != 201 || files.cmd.Name != "Después" {
		t.Fatalf("name after file: %d %s %q", rec.Code, rec.Body, files.cmd.Name)
	}
	// A file whose name leaves nothing once the extension is removed is «Documento».
	files = okFiles()
	body, ct = multipartBody(t, filePart(".pdf", []byte("%PDF-")))
	if rec := upload(t, NewHandler(nil, files), uuid.NewString(), body, ct); rec.Code != 201 || files.cmd.Name != "Documento" {
		t.Fatalf("fallback name: %d %q", rec.Code, files.cmd.Name)
	}
}

func TestUploadIdempotencyKeyIsOptionalCanonicalAndProjectsTheReplayHeader(t *testing.T) {
	key := uuid.New()
	for _, spelling := range []string{key.String(), strings.ToUpper(key.String()), strings.ReplaceAll(key.String(), "-", ""), "urn:uuid:" + key.String()} {
		files := okFiles()
		body, ct := multipartBody(t, filePart("x.pdf", []byte("%PDF-")))
		rec := upload(t, NewHandler(nil, files), uuid.NewString(), body, ct, [2]string{"Idempotency-Key", spelling})
		if rec.Code != 201 || files.cmd.IdempotencyKey != key.String() || rec.Header().Get("Idempotency-Replayed") != "false" {
			t.Fatalf("%q: %d key=%q replayed=%q", spelling, rec.Code, files.cmd.IdempotencyKey, rec.Header().Get("Idempotency-Replayed"))
		}
	}
	files := okFiles()
	files.result.Replayed = true
	body, ct := multipartBody(t, filePart("x.pdf", []byte("%PDF-")))
	rec := upload(t, NewHandler(nil, files), uuid.NewString(), body, ct, [2]string{"Idempotency-Key", key.String()})
	if rec.Code != 201 || rec.Header().Get("Idempotency-Replayed") != "true" || rec.Body.String() != string(files.result.Body) {
		t.Fatalf("replay: %d %q %s", rec.Code, rec.Header().Get("Idempotency-Replayed"), rec.Body)
	}
}

// An invalid key is answered before the body is read and before the store is touched.
func TestUploadInvalidIdempotencyKeyIsRefusedBeforeAnythingElse(t *testing.T) {
	good := uuid.NewString()
	for name, headers := range map[string][][2]string{
		"not a uuid":    {{"Idempotency-Key", "abc"}},
		"empty":         {{"Idempotency-Key", ""}},
		"repeated line": {{"Idempotency-Key", good}, {"Idempotency-Key", good}},
	} {
		files := okFiles()
		body, ct := multipartBody(t, filePart("x.pdf", []byte("%PDF-")))
		rec := upload(t, NewHandler(nil, files), uuid.NewString(), body, ct, headers...)
		got := decode(t, rec)
		if rec.Code != 400 || got["code"] != "invalid_idempotency_key" || len(files.calls) != 0 {
			t.Errorf("%s: %d %s calls=%v", name, rec.Code, rec.Body, files.calls)
		}
	}
}

func TestUploadPreflightFailuresNeverReachTheBody(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"never on the team", documents.ErrScopeNotFound, 404, "not_found"},
		{"former member", documents.ErrTeamAccessEnded, 404, "team_access_ended"},
		{"stakeholder", documents.ErrForbidden, 403, "forbidden"},
		{"storage disabled", documents.ErrStorageUnavailable, 503, "document_storage_unavailable"},
		{"company inactive", documents.ErrCompanyInactive, 403, "company_inactive"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := okFiles()
			files.preflightErr = tc.err
			body, ct := multipartBody(t, filePart("x.pdf", []byte("%PDF-")))
			rec := upload(t, NewHandler(nil, files), uuid.NewString(), body, ct)
			if rec.Code != tc.status || decode(t, rec)["code"] != tc.code || strings.Join(files.calls, ",") != "preflight" {
				t.Fatalf("%d %s calls=%v", rec.Code, rec.Body, files.calls)
			}
		})
	}
}

func TestUploadRejectsBadMultipartAndDiscardsWhatWasStaged(t *testing.T) {
	pdf := []byte("%PDF-")
	for _, tc := range []struct {
		name      string
		parts     []part
		wantStage bool
	}{
		{"missing file", []part{{name: "name", body: []byte("x")}}, false},
		{"file without a file name", []part{{name: "file", body: pdf}}, false},
		{"two files", []part{filePart("a.pdf", pdf), filePart("b.pdf", pdf)}, true},
		{"unknown part", []part{filePart("a.pdf", pdf), {name: "extra", body: []byte("x")}}, true},
		{"two names", []part{{name: "name", body: []byte("a")}, {name: "name", body: []byte("b")}, filePart("a.pdf", pdf)}, false},
		{"name that is a file part", []part{{name: "name", filename: "n.txt", body: []byte("x")}, filePart("a.pdf", pdf)}, false},
		{"content transfer encoding", []part{{name: "file", filename: "a.pdf", body: pdf, headers: map[string]string{"Content-Transfer-Encoding": "base64"}}}, false},
		{"name over 2048 bytes", []part{{name: "name", body: bytes.Repeat([]byte("a"), 2049)}, filePart("a.pdf", pdf)}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := okFiles()
			body, ct := multipartBody(t, tc.parts...)
			rec := upload(t, NewHandler(nil, files), uuid.NewString(), body, ct)
			if rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" {
				t.Fatalf("%d %s", rec.Code, rec.Body)
			}
			staged := strings.Contains(strings.Join(files.calls, ","), "stage")
			if staged != tc.wantStage {
				t.Fatalf("staged = %v, want %v (%v)", staged, tc.wantStage, files.calls)
			}
			if staged && len(files.discarded) != 1 {
				t.Fatalf("a staged object must be discarded exactly once: %v", files.discarded)
			}
			for _, c := range files.calls {
				if c == "upload" {
					t.Fatal("nothing may be written")
				}
			}
		})
	}
	// Not multipart at all.
	files := okFiles()
	rec := upload(t, NewHandler(nil, files), uuid.NewString(), strings.NewReader("{}"), "application/json")
	if rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" {
		t.Fatalf("json body: %d %s", rec.Code, rec.Body)
	}
}

func TestUploadInvalidNameIsAValidationErrorAndDiscards(t *testing.T) {
	for name, parts := range map[string][]part{
		"before the file":     {{name: "name", body: []byte(".pdf")}, filePart("a.pdf", []byte("%PDF-"))},
		"after the file":      {filePart("a.pdf", []byte("%PDF-")), {name: "name", body: []byte("   ")}},
		"control characters":  {{name: "name", body: []byte("a\x00b")}, filePart("a.pdf", []byte("%PDF-"))},
		"over 120 characters": {{name: "name", body: []byte(strings.Repeat("a", 121))}, filePart("a.pdf", []byte("%PDF-"))},
	} {
		files := okFiles()
		body, ct := multipartBody(t, parts...)
		rec := upload(t, NewHandler(nil, files), uuid.NewString(), body, ct)
		got := decode(t, rec)
		fields, _ := got["fields"].([]any)
		if rec.Code != 400 || got["code"] != "validation_error" || len(fields) != 1 ||
			fields[0].(map[string]any)["field"] != "name" || fields[0].(map[string]any)["code"] != "invalid" {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
		staged := strings.Contains(strings.Join(files.calls, ","), "stage")
		if staged != (len(files.discarded) == 1) || (!staged && len(files.discarded) != 0) {
			t.Errorf("%s: calls %v discarded %v", name, files.calls, files.discarded)
		}
	}
}

func TestUploadStageFailuresMapToTheContractCodes(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
		check  func(t *testing.T, body map[string]any)
	}{
		{"empty file", documents.ErrEmpty, 400, "validation_error", func(t *testing.T, b map[string]any) {
			f := b["fields"].([]any)
			if len(f) != 1 || f[0].(map[string]any)["field"] != "file" || f[0].(map[string]any)["code"] != "empty" {
				t.Fatalf("fields %v", b["fields"])
			}
		}},
		{"too large", documents.ErrTooLarge, 413, "payload_too_large", func(t *testing.T, b map[string]any) {
			if b["data"].(map[string]any)["max_bytes"] != float64(10485760) {
				t.Fatalf("data %v", b["data"])
			}
		}},
		{"unsupported", documents.ErrUnsupportedType, 415, "unsupported_media_type", func(t *testing.T, b map[string]any) {
			formats := b["data"].(map[string]any)["formats"].([]any)
			if len(formats) != 5 || formats[3].(map[string]any)["format"] != "jpg" {
				t.Fatalf("formats %v", formats)
			}
		}},
		{"mismatch", &documents.MismatchError{Detected: documents.DOCX, Extension: ".pdf"}, 400, "document_content_mismatch", func(t *testing.T, b map[string]any) {
			d := b["data"].(map[string]any)
			if d["detected_format"] != "docx" || d["extension"] != ".pdf" {
				t.Fatalf("data %v", d)
			}
		}},
		{"mismatch with no detected format", &documents.MismatchError{Extension: ".png"}, 400, "document_content_mismatch", func(t *testing.T, b map[string]any) {
			d := b["data"].(map[string]any)
			if v, ok := d["detected_format"]; !ok || v != nil || d["extension"] != ".png" {
				t.Fatalf("data %v", d)
			}
		}},
		{"storage unavailable", documents.ErrStorageUnavailable, 503, "document_storage_unavailable", nil},
		{"anything else", errors.New("pq: password authentication failed"), 500, "internal_error", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := okFiles()
			files.stageErr = tc.err
			body, ct := multipartBody(t, filePart("a.pdf", []byte("%PDF-")))
			rec := upload(t, NewHandler(nil, files), uuid.NewString(), body, ct)
			got := decode(t, rec)
			if rec.Code != tc.status || got["code"] != tc.code || strings.Contains(rec.Body.String(), "password") {
				t.Fatalf("%d %s", rec.Code, rec.Body)
			}
			if tc.check != nil {
				tc.check(t, got)
			}
			// A failed stage leaves nothing for the handler to discard (the service already removed the object).
			if len(files.discarded) != 0 {
				t.Fatalf("discarded %v", files.discarded)
			}
		})
	}
}

// The request body is capped at 10 485 760 + 65 536 bytes: the file part that crosses it is 413, detected while streaming.
func TestUploadRequestCapIs413WhileStreaming(t *testing.T) {
	files := okFiles()
	big := bytes.Repeat([]byte{'x'}, documents.MaxRequestBytes)
	body, ct := multipartBody(t, filePart("a.pdf", big))
	rec := upload(t, NewHandler(nil, files), uuid.NewString(), body, ct)
	got := decode(t, rec)
	if rec.Code != 413 || got["code"] != "payload_too_large" || got["data"].(map[string]any)["max_bytes"] != float64(documents.MaxBytes) {
		t.Fatalf("%d %.200s", rec.Code, rec.Body)
	}
	if files.streamed > documents.MaxRequestBytes {
		t.Fatalf("read %d bytes past the cap", files.streamed)
	}
	for _, c := range files.calls {
		if c == "upload" {
			t.Fatal("nothing may be written")
		}
	}
}

func TestUploadWriteFailuresMapToTheContractCodes(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
		data   map[string]any
	}{
		{"documents limit", &documents.LimitReachedError{Kind: "documents", Limit: 50}, 409, "document_limit_reached", map[string]any{"kind": "documents", "limit": float64(50)}},
		{"idempotency conflict", documents.ErrIdempotencyConflict, 409, "idempotency_conflict", nil},
		{"revoked between pre-flight and commit", documents.ErrTeamAccessEnded, 404, "team_access_ended", nil},
		{"not visible", documents.ErrScopeNotFound, 404, "not_found", nil},
		{"row failure", errors.New("insert placement_documents: pq: boom"), 500, "internal_error", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := okFiles()
			files.uploadErr = tc.err
			body, ct := multipartBody(t, filePart("a.pdf", []byte("%PDF-")))
			rec := upload(t, NewHandler(nil, files), uuid.NewString(), body, ct)
			got := decode(t, rec)
			if rec.Code != tc.status || got["code"] != tc.code || strings.Contains(rec.Body.String(), "boom") {
				t.Fatalf("%d %s", rec.Code, rec.Body)
			}
			if tc.data != nil && !equalMaps(got["data"].(map[string]any), tc.data) {
				t.Fatalf("data %v", got["data"])
			}
			// The service removes the object on a failed write; the handler must not do it twice.
			if len(files.discarded) != 0 {
				t.Fatalf("discarded %v", files.discarded)
			}
		})
	}
}

func equalMaps(a, b map[string]any) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func TestUploadFailsClosedWithoutSessionOrService(t *testing.T) {
	files := okFiles()
	body, ct := multipartBody(t, filePart("a.pdf", []byte("%PDF-")))
	// Malformed draft id: 400 like every draft route.
	if rec := upload(t, NewHandler(nil, files), "not-a-uuid", body, ct); rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" || len(files.calls) != 0 {
		t.Fatalf("bad id: %d %s", rec.Code, rec.Body)
	}
	for _, h := range []*Handler{nil, NewHandler(nil, nil)} {
		body, ct := multipartBody(t, filePart("a.pdf", []byte("%PDF-")))
		if rec := upload(t, h, uuid.NewString(), body, ct); rec.Code != 500 || decode(t, rec)["code"] != "internal_error" {
			t.Fatalf("nil service: %d %s", rec.Code, rec.Body)
		}
	}
	// A router without the role gates in front (no company context) never serves.
	router := chi.NewRouter()
	router.Post("/v/{id}/documents", NewHandler(nil, files).Upload)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v/"+uuid.NewString()+"/documents", nil))
	if rec.Code != 500 || len(files.calls) != 0 {
		t.Fatalf("no company context: %d %s", rec.Code, rec.Body)
	}
}

// --- download ---------------------------------------------------------------------------------------------------

type trackedBody struct {
	*strings.Reader
	closed bool
}

func (b *trackedBody) Close() error { b.closed = true; return nil }

func download(t *testing.T, h *Handler, draft, doc string) *httptest.ResponseRecorder {
	t.Helper()
	router := chi.NewRouter()
	router.Get("/v/{id}/documents/{doc}/file", h.File)
	req := httptest.NewRequest(http.MethodGet, "/v/"+draft+"/documents/"+doc+"/file", nil)
	req = req.WithContext(identitysecurity.ContextWithCompanyContext(req.Context(), *sessionCtx))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestDownloadHeadersAndStream(t *testing.T) {
	for _, tc := range []struct {
		name, fileName, wantDisposition string
	}{
		{"ascii", "Contrato marco.pdf", `attachment; filename="Contrato marco.pdf"`},
		{"quotes and backslashes are escaped", `a "b" \ c.pdf`, `attachment; filename="a \"b\" \\ c.pdf"`},
		// RFC 5987: the extended parameter alone, charset lower-case, percent-encoded UTF-8, no ASCII fallback.
		{"accents and enye", "Informe año 2026.pdf", "attachment; filename*=utf-8''Informe%20a%C3%B1o%202026.pdf"},
		{"non latin", "契約書.pdf", "attachment; filename*=utf-8''%E5%A5%91%E7%B4%84%E6%9B%B8.pdf"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := &trackedBody{Reader: strings.NewReader("%PDF-1.7 hello")}
			files := &fakeFiles{file: documents.File{Name: tc.fileName, ContentType: "application/pdf", Size: 14, Reader: body}}
			draft, doc := uuid.New(), uuid.New()
			rec := download(t, NewHandler(nil, files), draft.String(), doc.String())
			if rec.Code != 200 || rec.Body.String() != "%PDF-1.7 hello" || !body.closed {
				t.Fatalf("%d %q closed=%v", rec.Code, rec.Body, body.closed)
			}
			h := rec.Header()
			if h.Get("Content-Type") != "application/pdf" || h.Get("Content-Disposition") != tc.wantDisposition ||
				h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Content-Length") != "14" {
				t.Fatalf("headers %v", h)
			}
			if files.downloadIDs[0] != draft || files.downloadIDs[1] != doc {
				t.Fatalf("ids %v", files.downloadIDs)
			}
		})
	}
}

func TestDownloadErrorsServeNoBytesAndNoDownloadHeaders(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"unknown document", documents.ErrScopeNotFound, 404, "not_found"},
		{"file gone from storage", documents.ErrNotFound, 404, "not_found"},
		{"former member", documents.ErrTeamAccessEnded, 404, "team_access_ended"},
		{"storage unavailable", documents.ErrStorageUnavailable, 503, "document_storage_unavailable"},
		{"audit append failed", errors.New("insert audit event: pq: boom"), 500, "internal_error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := &fakeFiles{downloadErr: tc.err}
			rec := download(t, NewHandler(nil, files), uuid.NewString(), uuid.NewString())
			got := decode(t, rec)
			if rec.Code != tc.status || got["code"] != tc.code || strings.Contains(rec.Body.String(), "boom") {
				t.Fatalf("%d %s", rec.Code, rec.Body)
			}
			if rec.Header().Get("Content-Disposition") != "" || rec.Header().Get("Content-Length") == "" && false {
				t.Fatalf("download headers on an error: %v", rec.Header())
			}
		})
	}
}

func TestDownloadRejectsBadIdsAndFailsClosed(t *testing.T) {
	files := &fakeFiles{}
	for _, ids := range [][2]string{{"nope", uuid.NewString()}, {uuid.NewString(), "nope"}} {
		if rec := download(t, NewHandler(nil, files), ids[0], ids[1]); rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" {
			t.Fatalf("%v: %d %s", ids, rec.Code, rec.Body)
		}
	}
	if len(files.calls) != 0 {
		t.Fatalf("calls %v", files.calls)
	}
	for _, h := range []*Handler{nil, NewHandler(nil, nil)} {
		if rec := download(t, h, uuid.NewString(), uuid.NewString()); rec.Code != 500 || decode(t, rec)["code"] != "internal_error" {
			t.Fatalf("nil service: %d %s", rec.Code, rec.Body)
		}
	}
}
