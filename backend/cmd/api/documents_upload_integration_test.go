//go:build integration

package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"testing"

	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	documentspostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/infrastructure/postgres"
	documentsstorage "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/infrastructure/storage"
	"github.com/google/uuid"
)

// POST /v2/me/company/job-drafts/{id}/documents through the production router
// (docs/contracts/placement-vacancy-documents-v1.md, P4): real RequireAuth, real recruiter gate, the real documents
// store, service and local storage over a temp directory, isolated PostgreSQL. The vacancies, teams and lifecycle states are
// built through the existing routers; documents are read back through GET …/documents.

// docsStorage wraps the local adapter so a test can watch Open, the first byte served and whether every opened stream
// was closed.
type docsStorage struct {
	documents.Storage
	mu          sync.Mutex
	onFirstRead func()
	openErr     error
	opened      int
	closed      int
}

func (s *docsStorage) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	s.mu.Lock()
	hook, openErr := s.onFirstRead, s.openErr
	s.mu.Unlock()
	if openErr != nil {
		return nil, openErr
	}
	r, err := s.Storage.Open(ctx, key)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.opened++
	s.mu.Unlock()
	return &hookedReader{ReadCloser: r, hook: hook, owner: s}, nil
}

func (s *docsStorage) streams() (opened, closed int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.opened, s.closed
}

// hookedReader runs hook once, right before the first byte is read: the moment the response body starts.
type hookedReader struct {
	io.ReadCloser
	hook  func()
	owner *docsStorage
	once  sync.Once
}

func (r *hookedReader) Read(p []byte) (int, error) {
	if r.hook != nil {
		r.once.Do(r.hook)
	}
	return r.ReadCloser.Read(p)
}

func (r *hookedReader) Close() error {
	r.owner.mu.Lock()
	r.owner.closed++
	r.owner.mu.Unlock()
	return r.ReadCloser.Close()
}

func newDocsUploadFlow(t *testing.T) *docsFlow {
	t.Helper()
	dir := t.TempDir()
	local, err := documentsstorage.NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = local.Close() })
	storage := &docsStorage{Storage: local}
	f := newDocsFlowWith(t, storage)
	f.dir, f.storage = dir, storage
	return f
}

// objects counts the files in the storage directory: an object left behind by a failed upload shows here.
func (f *docsFlow) objects() int {
	f.t.Helper()
	entries, err := os.ReadDir(f.dir)
	if err != nil {
		f.t.Fatal(err)
	}
	return len(entries)
}

func (f *docsFlow) object(key string) []byte {
	f.t.Helper()
	data, err := os.ReadFile(filepath.Join(f.dir, key))
	if err != nil {
		f.t.Fatalf("object %s: %v", key, err)
	}
	return data
}

type docPart struct {
	name, filename string
	body           []byte
	headers        map[string]string
}

func filePart(filename string, body []byte) docPart {
	return docPart{name: "file", filename: filename, body: body}
}

func namePart(name string) docPart { return docPart{name: "name", body: []byte(name)} }

func docsMultipart(t *testing.T, parts ...docPart) (string, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for _, p := range parts {
		h := textproto.MIMEHeader{}
		disposition := `form-data; name="` + p.name + `"`
		if p.filename != "" {
			// Quoted-string escaping, as multipart.Writer.CreateFormFile does: a client path keeps its backslashes.
			disposition += `; filename="` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(p.filename) + `"`
		}
		h.Set("Content-Disposition", disposition)
		if p.filename != "" {
			h.Set("Content-Type", "application/octet-stream") // the client MIME type is never trusted
		}
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
	return buf.String(), w.FormDataContentType()
}

func (f *docsFlow) postPath(draft string) string { return draftFlowV2Path + "/" + draft + "/documents" }

// post sends a multipart upload; headers may add Idempotency-Key.
func (f *docsFlow) post(token, draft string, headers map[string]string, parts ...docPart) draftFlowResponse {
	f.t.Helper()
	body, ct := docsMultipart(f.t, parts...)
	h := map[string]string{"Content-Type": ct}
	for k, v := range headers {
		h[k] = v
	}
	return f.docs.do(f.t, "POST", f.postPath(draft), body, token, h)
}

// uploadOK uploads one file and returns the decoded 201 body.
func (f *docsFlow) uploadOK(token, draft, filename string, content []byte, extra ...docPart) map[string]any {
	f.t.Helper()
	got := f.post(token, draft, nil, append(extra, filePart(filename, content))...)
	if got.status != 201 {
		f.t.Fatalf("upload %s: %d %s", filename, got.status, got.body)
	}
	return draftFlowObject(f.t, got.body)
}

// --- file builders ----------------------------------------------------------------------------------------------

// bytesPDF is a PDF-looking file of exactly size bytes (size >= 9).
func bytesPDF(size int) []byte {
	return append([]byte("%PDF-1.7\n"), bytes.Repeat([]byte{'x'}, max(size-9, 0))...)
}

func bytesPNG() []byte {
	return append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, bytes.Repeat([]byte{7}, 64)...)
}

func bytesJPG() []byte {
	return append([]byte{0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'J', 'F', 'I', 'F', 0}, bytes.Repeat([]byte{9}, 64)...)
}

// bytesZip builds a ZIP with the given non-empty parts, in the order of names.
func bytesZip(t *testing.T, names ...string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range names {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte("<xml>content</xml>"))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func bytesDOCX(t *testing.T) []byte {
	return bytesZip(t, "[Content_Types].xml", "word/document.xml")
}

func bytesXLSX(t *testing.T) []byte {
	return bytesZip(t, "[Content_Types].xml", "xl/workbook.xml")
}

// bytesLegacyOffice is the OLE2 compound file magic shared by .doc/.xls/.ppt (rejected in v1, Q1).
func bytesLegacyOffice() []byte {
	return append([]byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}, bytes.Repeat([]byte{0}, 512)...)
}

// --- assertions -------------------------------------------------------------------------------------------------

var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)

var docItemKeys = []string{"allowed_actions", "content_type", "created_at", "created_by", "format", "id", "name", "participation_id", "size", "updated_at", "updated_by", "version", "version_count"}

func (f *docsFlow) docCount(draft string) int {
	return f.count(`SELECT count(*) FROM placement_documents WHERE draft_id=$1`, draft)
}

func (f *docsFlow) uploadedEvents(draft string) []auditRow {
	return auditRowsWhere(f.t, f.h.pool, `company_id=$1 AND event_type='DocumentUploaded' AND vacancy_id=$2`, f.company.companyID, draft)
}

// assertNothingStored: no row, no audit event, no idempotency row, no object (the failure table of the contract).
func (f *docsFlow) assertNothingStored(label, draft string) {
	f.t.Helper()
	if n := f.docCount(draft); n != 0 {
		f.t.Errorf("%s: %d document rows", label, n)
	}
	if n := len(f.uploadedEvents(draft)); n != 0 {
		f.t.Errorf("%s: %d DocumentUploaded events", label, n)
	}
	if n := f.count(`SELECT count(*) FROM job_draft_idempotency WHERE company_id=$1 AND operation='placement-document-upload:r1'`, f.company.companyID); n != 0 {
		f.t.Errorf("%s: %d idempotency rows", label, n)
	}
	if n := f.objects(); n != 0 {
		f.t.Errorf("%s: %d objects left in storage", label, n)
	}
}

// Every accepted format, through the router: the 201 `{item, scope}`, the rows, the stored bytes and the audit event.
func TestDocumentsUpload_SuccessPerFormat(t *testing.T) {
	f := newDocsUploadFlow(t)
	ana := f.name(f.member("recruiter"), "Ana López")
	draft := publicationFlowReady(t, f.h, ana) // a never-published draft: no process row is needed (S2)

	for i, tc := range []struct {
		file         string
		content      []byte
		format, ctyp string
		name         string
	}{
		{"Contrato marco.pdf", bytesPDF(2048), "pdf", docPDF, "Contrato marco"},
		{"Oferta.DOCX", bytesDOCX(t), "docx", docDOCX, "Oferta"},
		{"Presupuesto.xlsx", bytesXLSX(t), "xlsx", docXLSX, "Presupuesto"},
		{"Escaneo.jpg", bytesJPG(), "jpg", "image/jpeg", "Escaneo"},
		{"Escaneo dos.JPEG", bytesJPG(), "jpg", "image/jpeg", "Escaneo dos"},
		{"Foto.png", bytesPNG(), "png", "image/png", "Foto"},
	} {
		t.Run(tc.file, func(t *testing.T) {
			got := f.post(ana.token, draft, nil, filePart(tc.file, tc.content))
			draftFlowAssertNoStore(t, got)
			if got.status != 201 || got.header.Get("Content-Type") != "application/json" {
				t.Fatalf("%d %s %s", got.status, got.header.Get("Content-Type"), got.body)
			}
			if got.header.Get("Location") != "" || got.header.Get("Idempotency-Replayed") != "" {
				t.Fatalf("Location/Idempotency-Replayed on a keyless upload: %v", got.header)
			}
			body := draftFlowObject(t, got.body)
			if !reflect.DeepEqual(docsSorted(body), []string{"item", "scope"}) {
				t.Fatalf("keys: %v", docsSorted(body))
			}
			item := body["item"].(map[string]any)
			if !reflect.DeepEqual(docsSorted(item), docItemKeys) {
				t.Fatalf("item keys: %v", docsSorted(item))
			}
			want := map[string]any{
				"name": tc.name, "format": tc.format, "content_type": tc.ctyp, "size": float64(len(tc.content)),
				"version": float64(1), "version_count": float64(1), "participation_id": nil,
			}
			for k, v := range want {
				if item[k] != v {
					t.Errorf("%s = %v, want %v", k, item[k], v)
				}
			}
			person := map[string]any{"id": ana.userID.String(), "name": "Ana López"}
			if !reflect.DeepEqual(item["created_by"], person) || !reflect.DeepEqual(item["updated_by"], person) || item["created_at"] != item["updated_at"] {
				t.Errorf("people/times: %v", item)
			}
			if !reflect.DeepEqual(strs(item["allowed_actions"]), []string{"download", "replace", "delete"}) {
				t.Errorf("item actions: %v", item["allowed_actions"])
			}
			scope := docsScope(body)
			if scope["can_manage"] != true || !reflect.DeepEqual(strs(scope["allowed_actions"]), []string{"upload"}) || scope["upload_blocked_reason"] != nil ||
				!reflect.DeepEqual(scope["counts"], map[string]any{"documents": float64(i + 1), "links": float64(0)}) {
				t.Errorf("scope: %v", scope)
			}

			// The rows and the stored bytes.
			id := item["id"].(string)
			var key, ctype string
			var size int64
			var uploadedBy uuid.UUID
			if err := f.h.pool.QueryRow(context.Background(), `SELECT storage_key, content_type, size, uploaded_by FROM placement_document_versions WHERE document_id=$1 AND version=1`, id).Scan(&key, &ctype, &size, &uploadedBy); err != nil {
				t.Fatal(err)
			}
			if !hex64.MatchString(key) || ctype != tc.ctyp || size != int64(len(tc.content)) || uploadedBy != ana.userID {
				t.Errorf("version row: %s %s %d %s", key, ctype, size, uploadedBy)
			}
			if !bytes.Equal(f.object(key), tc.content) {
				t.Error("the stored object differs from the uploaded bytes")
			}
			if n := f.count(`SELECT count(*) FROM placement_documents WHERE id=$1 AND draft_id=$2 AND company_id=$3 AND participation_id IS NULL`, id, draft, f.company.companyID); n != 1 {
				t.Errorf("document rows: %d", n)
			}

			// DocumentUploaded: ids and enums only, never the name.
			events := auditRowsWhere(t, f.h.pool, `company_id=$1 AND event_type='DocumentUploaded' AND entity_id=$2`, f.company.companyID, id)
			if len(events) != 1 {
				t.Fatalf("audit rows: %d", len(events))
			}
			draftID := uuid.MustParse(draft)
			var versionID string
			if err := f.h.pool.QueryRow(context.Background(), `SELECT id::text FROM placement_document_versions WHERE document_id=$1`, id).Scan(&versionID); err != nil {
				t.Fatal(err)
			}
			assertAuditRow(t, events[0], wantAuditRow{
				actor: ana.userID, eventType: "DocumentUploaded", entityType: "document", entityID: uuid.MustParse(id), company: f.company.companyID, vacancy: &draftID,
				metadata: map[string]any{"company_id": f.company.companyID.String(), "vacancy_id": draft, "scope": "vacancy", "document_id": id, "version_id": versionID, "version": "1", "format": tc.format},
			})
			if strings.Contains(string(mustJSON(t, events[0].Metadata)), tc.name) {
				t.Error("the file name leaked into the audit metadata")
			}
		})
	}

	// The list reads back exactly what the 201 answered.
	list := f.ok(ana.token, draft)
	if len(list["items"].([]any)) != 6 || !reflect.DeepEqual(docsScope(list)["counts"], map[string]any{"documents": float64(6), "links": float64(0)}) {
		t.Fatalf("list: %v", list)
	}
}

// A 201 item equals the list's item for the same document, and the scope equals the list's scope.
func TestDocumentsUpload_ResponseMatchesTheList(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	body := f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(100))
	list := f.ok(f.owner.token, draft)
	if !reflect.DeepEqual(list["items"].([]any)[0], body["item"]) || !reflect.DeepEqual(list["scope"], body["scope"]) {
		t.Fatalf("201 %v\nlist %v", body, list)
	}
}

// The exact limit is accepted; the request cap and the limit plus one are 413.
func TestDocumentsUpload_SizeLimit(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	body := f.uploadOK(f.owner.token, draft, "limite.pdf", bytesPDF(documents.MaxBytes))
	if body["item"].(map[string]any)["size"] != float64(10485760) {
		t.Fatalf("size: %v", body["item"])
	}
	if f.objects() != 1 {
		t.Fatalf("objects: %d", f.objects())
	}
	for name, size := range map[string]int{"one byte over the limit": documents.MaxBytes + 1, "over the request cap": documents.MaxRequestBytes + 4096} {
		got := f.post(f.owner.token, draft, nil, filePart("grande.pdf", bytesPDF(size)))
		draftFlowAssertError(t, got, 413, "payload_too_large")
		if data := draftFlowObject(t, got.body)["data"]; !reflect.DeepEqual(data, map[string]any{"max_bytes": float64(10485760)}) {
			t.Fatalf("%s: data %v", name, data)
		}
		if f.docCount(draft) != 1 || f.objects() != 1 {
			t.Fatalf("%s: rows %d objects %d (the oversized object must be deleted)", name, f.docCount(draft), f.objects())
		}
	}
}

// The failure table of the contract: every case answers its code and stores NOTHING.
func TestDocumentsUpload_FailureTable(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	pdf := bytesPDF(200)
	type data = map[string]any
	for _, tc := range []struct {
		name   string
		parts  []docPart
		header map[string]string
		status int
		code   string
		data   data
		fields []data
	}{
		{name: "empty file", parts: []docPart{filePart("a.pdf", nil)}, status: 400, code: "validation_error", fields: []data{{"field": "file", "code": "empty"}}},
		{name: "legacy .doc", parts: []docPart{filePart("a.doc", bytesLegacyOffice())}, status: 415, code: "unsupported_media_type"},
		{name: "legacy .xls", parts: []docPart{filePart("a.xls", bytesLegacyOffice())}, status: 415, code: "unsupported_media_type"},
		{name: "a zip", parts: []docPart{filePart("a.zip", bytesZip(t, "a.txt"))}, status: 415, code: "unsupported_media_type"},
		{name: "no extension", parts: []docPart{filePart("contrato", pdf)}, status: 415, code: "unsupported_media_type"},
		{name: "pdf bytes named .png", parts: []docPart{filePart("a.png", pdf)}, status: 400, code: "document_content_mismatch", data: data{"detected_format": "pdf", "extension": ".png"}},
		{name: "garbage named .pdf", parts: []docPart{filePart("a.pdf", []byte("hello world"))}, status: 400, code: "document_content_mismatch", data: data{"detected_format": nil, "extension": ".pdf"}},
		{name: "docx bytes named .xlsx", parts: []docPart{filePart("a.xlsx", bytesDOCX(t))}, status: 400, code: "document_content_mismatch", data: data{"detected_format": "docx", "extension": ".xlsx"}},
		{name: "png bytes named .JPG: the extension is lower-cased", parts: []docPart{filePart("A.JPG", bytesPNG())}, status: 400, code: "document_content_mismatch", data: data{"detected_format": "png", "extension": ".jpg"}},
		{name: "a zip without the Office parts named .docx", parts: []docPart{filePart("a.docx", bytesZip(t, "a.txt"))}, status: 400, code: "document_content_mismatch", data: data{"detected_format": nil, "extension": ".docx"}},
		{name: "missing file part", parts: []docPart{namePart("solo nombre")}, status: 400, code: "invalid_request"},
		{name: "two file parts", parts: []docPart{filePart("a.pdf", pdf), filePart("b.pdf", pdf)}, status: 400, code: "invalid_request"},
		{name: "unknown part", parts: []docPart{filePart("a.pdf", pdf), {name: "extra", body: []byte("x")}}, status: 400, code: "invalid_request"},
		{name: "two name parts", parts: []docPart{namePart("a"), namePart("b"), filePart("a.pdf", pdf)}, status: 400, code: "invalid_request"},
		{name: "file part without a file name", parts: []docPart{{name: "file", body: pdf}}, status: 400, code: "invalid_request"},
		{name: "content transfer encoding", parts: []docPart{{name: "file", filename: "a.pdf", body: pdf, headers: map[string]string{"Content-Transfer-Encoding": "base64"}}}, status: 400, code: "invalid_request"},
		{name: "name over 2048 bytes", parts: []docPart{namePart(strings.Repeat("a", 2049)), filePart("a.pdf", pdf)}, status: 400, code: "invalid_request"},
		{name: "name with nothing but an extension", parts: []docPart{namePart(".pdf"), filePart("a.pdf", pdf)}, status: 400, code: "validation_error", fields: []data{{"field": "name", "code": "invalid"}}},
		{name: "name after the file, invalid", parts: []docPart{filePart("a.pdf", pdf), namePart("   ")}, status: 400, code: "validation_error", fields: []data{{"field": "name", "code": "invalid"}}},
		{name: "name over 120 characters", parts: []docPart{namePart(strings.Repeat("ñ", 121)), filePart("a.pdf", pdf)}, status: 400, code: "validation_error", fields: []data{{"field": "name", "code": "invalid"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := f.post(f.owner.token, draft, tc.header, tc.parts...)
			draftFlowAssertError(t, got, tc.status, tc.code)
			body := draftFlowObject(t, got.body)
			switch tc.code {
			case "document_content_mismatch":
				if !reflect.DeepEqual(body["data"], map[string]any(tc.data)) {
					t.Errorf("data = %v, want %v", body["data"], tc.data)
				}
			case "unsupported_media_type":
				formats := body["data"].(map[string]any)["formats"].([]any)
				if len(formats) != 5 || formats[0].(map[string]any)["format"] != "pdf" {
					t.Errorf("formats: %v", formats)
				}
			case "validation_error":
				var gotFields []data
				for _, raw := range body["fields"].([]any) {
					gotFields = append(gotFields, raw.(map[string]any))
				}
				if !reflect.DeepEqual(gotFields, tc.fields) {
					t.Errorf("fields = %v, want %v", gotFields, tc.fields)
				}
			}
			f.assertNothingStored(tc.name, draft)
		})
	}
	t.Run("not multipart", func(t *testing.T) {
		got := f.docs.do(t, "POST", f.postPath(draft), `{"name":"x"}`, f.owner.token, map[string]string{"Content-Type": "application/json"})
		draftFlowAssertError(t, got, 400, "invalid_request")
		f.assertNothingStored("not multipart", draft)
	})
}

// D11 and the contract's name rules.
func TestDocumentsUpload_NamingRules(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	long := strings.Repeat("ñ", 130)
	for _, tc := range []struct {
		label string
		parts []docPart
		want  string
	}{
		{"a known extension is stripped from the file name", []docPart{filePart("contrato.pdf", bytesPDF(50))}, "contrato"},
		{"case-insensitively", []docPart{filePart("Contrato Final.PDF", bytesPDF(50))}, "Contrato Final"},
		{"only one extension", []docPart{filePart("x.pdf.pdf", bytesPDF(50))}, "x.pdf"},
		{"a client path is reduced to its base (both separators)", []docPart{filePart(`C:\Users\ana\Oferta firmada.PDF`, bytesPDF(50))}, "Oferta firmada"},
		{"a unix path too", []docPart{filePart("../../etc/Informe año 2026.pdf", bytesPDF(50))}, "Informe año 2026"},
		{"NFC and collapsed spaces", []docPart{filePart("  Informe   an\u0303o .pdf", bytesPDF(50))}, "Informe año"},
		{"nothing left once the extension goes: Documento", []docPart{filePart(".pdf", bytesPDF(50))}, "Documento"},
		{"an over-long file name is cut to 120 characters", []docPart{filePart(long+".pdf", bytesPDF(50))}, strings.Repeat("ñ", 120)},
		{"a given name wins and loses its known extension", []docPart{namePart("Oferta firmada.docx"), filePart("x.pdf", bytesPDF(50))}, "Oferta firmada"},
		{"a given name after the file", []docPart{filePart("x.pdf", bytesPDF(50)), namePart("  Después   ")}, "Después"},
		{"a given name that merely ends like another extension keeps it", []docPart{namePart("balance.v2"), filePart("x.pdf", bytesPDF(50))}, "balance.v2"},
	} {
		t.Run(tc.label, func(t *testing.T) {
			item := f.post(f.owner.token, draft, nil, tc.parts...)
			if item.status != 201 {
				t.Fatalf("%d %s", item.status, item.body)
			}
			got := draftFlowObject(t, item.body)["item"].(map[string]any)
			if got["name"] != tc.want {
				t.Fatalf("name = %q, want %q", got["name"], tc.want)
			}
			var stored string
			if err := f.h.pool.QueryRow(context.Background(), `SELECT name FROM placement_documents WHERE id=$1`, got["id"]).Scan(&stored); err != nil || stored != tc.want {
				t.Fatalf("stored name %q %v", stored, err)
			}
		})
	}
}

// D15: 50 documents per vacancy, files plus links; the 51st is 409 with data, and the scope says why.
func TestDocumentsUpload_LimitReached(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	for i := 0; i < 49; i++ {
		f.insertDocument(draft, "", fmt.Sprintf("Documento %02d", i), f.owner, docVersion{docPDF, 1, docsAt(i), f.owner})
	}
	// The 50th still fits and the scope then says why nothing else does.
	body := f.uploadOK(f.owner.token, draft, "ultimo.pdf", bytesPDF(30))
	scope := docsScope(body)
	if len(strs(scope["allowed_actions"])) != 0 || scope["upload_blocked_reason"] != "limit_reached" || scope["can_manage"] != true ||
		!reflect.DeepEqual(scope["counts"], map[string]any{"documents": float64(50), "links": float64(0)}) {
		t.Fatalf("scope at the limit: %v", scope)
	}
	objects := f.objects()
	got := f.post(f.owner.token, draft, nil, filePart("sobra.pdf", bytesPDF(30)))
	draftFlowAssertError(t, got, 409, "document_limit_reached")
	if data := draftFlowObject(t, got.body)["data"]; !reflect.DeepEqual(data, map[string]any{"kind": "documents", "limit": float64(50)}) {
		t.Fatalf("data: %v", data)
	}
	if f.docCount(draft) != 50 || f.objects() != objects || len(f.uploadedEvents(draft)) != 1 {
		t.Fatalf("rows %d objects %d (want %d) events %d", f.docCount(draft), f.objects(), objects, len(f.uploadedEvents(draft)))
	}

	// Links count toward the same limit (D15): 49 files + 1 link is a full scope.
	root := f.published()
	f.closeIt(root, "finish")
	replacement := f.published()
	f.link(replacement, root, root, 1)
	source, versions := f.insertDocument(root, "", "Original", f.owner, docVersion{docPDF, 1, docsAt(0), f.owner})
	f.linkDocument(replacement, source, versions[0], f.owner, docsAt(1))
	for i := 0; i < 49; i++ {
		f.insertDocument(replacement, "", fmt.Sprintf("Documento %02d", i), f.owner, docVersion{docPDF, 1, docsAt(i), f.owner})
	}
	draftFlowAssertError(t, f.post(f.owner.token, replacement, nil, filePart("sobra.pdf", bytesPDF(30))), 409, "document_limit_reached")
	if f.docCount(replacement) != 49 {
		t.Fatalf("rows: %d", f.docCount(replacement))
	}
}

// The authorization matrix of the write side (D4) and the guarantee that nobody who is refused ever stores an object.
func TestDocumentsUpload_AuthorizationMatrix(t *testing.T) {
	f := newDocsUploadFlow(t)
	responsible := f.name(f.member("recruiter"), "Rita Responsable")
	draft := publicationFlowReady(t, f.h, responsible)
	collaborator := f.member("recruiter")
	teamAccessCollaborator(t, f.h, draft, f.company.companyID, collaborator.userID, f.owner.userID)
	outsider := f.member("recruiter")
	former := f.member("recruiter")
	teamAccessEndCollaborator(t, f.h, teamAccessCollaborator(t, f.h, draft, f.company.companyID, former.userID, f.owner.userID), f.owner.userID)
	stakeholder := f.member("stakeholder")
	_, otherOwnerID, otherSub := draftFlowNewPrincipal(t, f.h.pool, "active")
	otherOwner := f.h.actor(t, otherOwnerID, otherSub)

	for _, tc := range []struct {
		name  string
		actor draftFlowActor
	}{{"owner", f.owner}, {"responsible recruiter", responsible}, {"active collaborator", collaborator}} {
		t.Run(tc.name+" uploads", func(t *testing.T) {
			f.uploadOK(tc.actor.token, draft, tc.name+".pdf", bytesPDF(40))
		})
	}
	uploaded := f.docCount(draft)
	objects := f.objects()
	events := len(f.uploadedEvents(draft))
	for _, tc := range []struct {
		name   string
		actor  draftFlowActor
		status int
		code   string
	}{
		{"stakeholder (the recruiter ladder)", stakeholder, 403, "forbidden"},
		{"recruiter never on the team", outsider, 404, "not_found"},
		{"former member", former, 404, "team_access_ended"},
		{"owner of another company", otherOwner, 404, "not_found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			draftFlowAssertError(t, f.post(tc.actor.token, draft, nil, filePart("no.pdf", bytesPDF(40))), tc.status, tc.code)
			if f.docCount(draft) != uploaded || f.objects() != objects || len(f.uploadedEvents(draft)) != events {
				t.Fatalf("a refused caller changed state: rows %d objects %d events %d", f.docCount(draft), f.objects(), len(f.uploadedEvents(draft)))
			}
		})
	}
	t.Run("general gates", func(t *testing.T) {
		draftFlowAssertError(t, f.post("", draft, nil, filePart("no.pdf", bytesPDF(40))), 401, "unauthenticated")
		draftFlowAssertError(t, f.post(f.owner.token, uuid.NewString(), nil, filePart("no.pdf", bytesPDF(40))), 404, "not_found")
		draftFlowAssertError(t, f.docs.do(t, "POST", draftFlowV2Path+"/not-a-uuid/documents", "", f.owner.token, nil), 400, "invalid_request")
		if f.objects() != objects {
			t.Fatalf("objects: %d", f.objects())
		}
	})
	t.Run("a v1 draft is hidden like a missing one", func(t *testing.T) {
		id, _, _ := f.h.create(t, f.owner, uuid.NewString(), draftFlowMinimalCreate)
		draftFlowAssertError(t, f.post(f.owner.token, id, nil, filePart("no.pdf", bytesPDF(40))), 404, "not_found")
		if f.objects() != objects {
			t.Fatalf("objects: %d", f.objects())
		}
	})

	// The store agrees with the route group: a stakeholder who got past it is still forbidden (manage mode).
	t.Run("the store refuses a stakeholder itself", func(t *testing.T) {
		store := f.newStore(f.storage)
		if err := store.AuthorizeUpload(context.Background(), f.company.companyID, stakeholder.userID, uuid.MustParse(draft)); !errors.Is(err, documents.ErrForbidden) {
			t.Fatalf("stakeholder pre-flight: %v", err)
		}
		if err := store.AuthorizeUpload(context.Background(), f.company.companyID, former.userID, uuid.MustParse(draft)); !errors.Is(err, documents.ErrTeamAccessEnded) {
			t.Fatalf("former member pre-flight: %v", err)
		}
		if err := store.AuthorizeUpload(context.Background(), f.company.companyID, responsible.userID, uuid.MustParse(draft)); err != nil {
			t.Fatalf("team member pre-flight: %v", err)
		}
	})
}

func (f *docsFlow) newStore(storage documents.Storage) *documentspostgres.Store {
	access := documentAccess{drafts: f.h.store}
	return documentspostgres.NewStore(f.h.pool, access, access, auditpostgres.NewAuditEventRepository(), storage)
}

// A recruiter whose tramo ends between the pre-flight and the commit cannot land the write: the draft lock and the
// re-authorization refuse it and the object is removed (failure table: «Authorization revoked between pre-flight and commit»).
func TestDocumentsUpload_RevokedBetweenPreflightAndCommit(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	collaborator := f.member("recruiter")
	assignment := teamAccessCollaborator(t, f.h, draft, f.company.companyID, collaborator.userID, f.owner.userID)

	store := f.newStore(f.storage)
	svc := documents.NewService(f.storage, store)
	ctx := context.Background()
	if err := svc.PreflightUpload(ctx, f.company.companyID, collaborator.userID, uuid.MustParse(draft)); err != nil {
		t.Fatal(err)
	}
	staged, err := svc.Stage(ctx, "a.pdf", bytes.NewReader(bytesPDF(100)))
	if err != nil {
		t.Fatal(err)
	}
	if f.objects() != 1 {
		t.Fatalf("staged objects: %d", f.objects())
	}
	teamAccessEndCollaborator(t, f.h, assignment, f.owner.userID) // the owner removes them while the body streamed

	_, err = svc.Upload(ctx, documents.UploadCommand{CompanyID: f.company.companyID, ActorID: collaborator.userID, DraftID: uuid.MustParse(draft), Name: "a", Staged: staged})
	if !errors.Is(err, documents.ErrTeamAccessEnded) {
		t.Fatalf("err = %v", err)
	}
	f.assertNothingStored("revoked", draft)
}

// S4: uploads are accepted in every lifecycle state and touch nothing but the document tables and the audit trail.
func TestDocumentsUpload_EveryLifecycleStateLeavesTheVacancyByteIdentical(t *testing.T) {
	f := newDocsUploadFlow(t)
	states := map[string]func() string{
		"draft":     f.draft,
		"published": f.published,
		"paused": func() string {
			id := f.published()
			if got := f.transition(id, "pause", `{}`); got.status != 200 {
				t.Fatalf("pause: %d %s", got.status, got.body)
			}
			return id
		},
		"closed, process continues": func() string { id := f.published(); f.closeIt(id, "continue"); return id },
		"closed, covered":           func() string { id := f.published(); f.closeIt(id, "continue"); f.cover(id); return id },
		"closed, process finished":  func() string { id := f.published(); f.closeIt(id, "finish"); return id },
		"finished and then replaced": func() string {
			id := f.published()
			f.closeIt(id, "finish")
			f.link(f.published(), id, id, 1)
			return id
		},
	}
	for name, build := range states {
		t.Run(name, func(t *testing.T) {
			id := build()
			stakeholder := f.member("stakeholder")
			before := f.vacancySnapshot(id)
			auditBefore := auditCompanyCount(t, f.h.pool, f.company.companyID)

			got := f.post(f.owner.token, id, nil, filePart("Contrato "+name+".pdf", bytesPDF(300)))
			if got.status != 201 {
				t.Fatalf("%s: %d %s", name, got.status, got.body)
			}
			if after := f.vacancySnapshot(id); after != before {
				t.Fatalf("%s: the upload changed the vacancy\nbefore %s\nafter  %s", name, before, after)
			}
			// «audit the attachment» (S4): exactly one new event, the DocumentUploaded of this document.
			if n := auditCompanyCount(t, f.h.pool, f.company.companyID); n != auditBefore+1 || len(f.uploadedEvents(id)) != 1 {
				t.Fatalf("%s: audit rows %d -> %d, uploaded events %d", name, auditBefore, n, len(f.uploadedEvents(id)))
			}
			if body := f.ok(stakeholder.token, id); len(body["items"].([]any)) != 1 {
				t.Fatalf("%s: the stakeholder does not see the document", name)
			}
			// And again: the second upload is just as welcome.
			if got := f.post(f.owner.token, id, nil, filePart("Otro.pdf", bytesPDF(300))); got.status != 201 {
				t.Fatalf("%s: second upload: %d %s", name, got.status, got.body)
			}
			if f.vacancySnapshot(id) != before {
				t.Fatalf("%s: the second upload changed the vacancy", name)
			}
		})
	}
}

// vacancySnapshot is every vacancy, lifecycle, participation, team and credit row of a vacancy as JSON: byte-identical
// after a document upload means no lifecycle or metrics figure moved.
func (f *docsFlow) vacancySnapshot(id string) string {
	f.t.Helper()
	var s string
	if err := f.h.pool.QueryRow(context.Background(), `SELECT json_build_array(
		(SELECT to_json(d) FROM job_drafts d WHERE id=$1),
		(SELECT to_json(p) FROM vacancy_processes p WHERE id=$1),
		(SELECT json_agg(e ORDER BY id) FROM vacancy_lifecycle_events e WHERE process_id=$1),
		(SELECT json_agg(p ORDER BY id) FROM process_participations p WHERE process_id=$1),
		(SELECT json_agg(a ORDER BY id) FROM vacancy_assignments a WHERE draft_id=$1),
		(SELECT json_agg(c ORDER BY id) FROM placement_credits c WHERE process_id=$1),
		(SELECT json_agg(r ORDER BY process_id) FROM vacancy_replacements r WHERE $1 IN (process_id, source_process_id, root_process_id)))::text`, id).Scan(&s); err != nil {
		f.t.Fatal(err)
	}
	return s
}

// D26: optional Idempotency-Key with the semantics of the drafts.
func TestDocumentsUpload_IdempotencyReplayConflictAndInvalidKey(t *testing.T) {
	f := newDocsUploadFlow(t)
	responsible := f.member("recruiter")
	draft := publicationFlowReady(t, f.h, responsible)
	key := uuid.NewString()
	hdr := func(k string) map[string]string { return map[string]string{"Idempotency-Key": k} }
	pdf := bytesPDF(500)

	first := f.post(responsible.token, draft, hdr(key), filePart("Contrato.pdf", pdf))
	if first.status != 201 || first.header.Get("Idempotency-Replayed") != "false" {
		t.Fatalf("first: %d %q %s", first.status, first.header.Get("Idempotency-Replayed"), first.body)
	}
	var stored struct {
		Algorithm, Operation, Etag string
		Fingerprint, Body          []byte
	}
	if err := f.h.pool.QueryRow(context.Background(), `SELECT fingerprint_algorithm, operation, response_etag, fingerprint, response_body FROM job_draft_idempotency WHERE company_id=$1 AND actor_id=$2 AND idem_key=$3`,
		f.company.companyID, responsible.userID, key).Scan(&stored.Algorithm, &stored.Operation, &stored.Etag, &stored.Fingerprint, &stored.Body); err != nil {
		t.Fatal(err)
	}
	if stored.Operation != "placement-document-upload:r1" || stored.Algorithm != "go-json-v1+sha256" || stored.Etag != "" || len(stored.Fingerprint) != 32 || !bytes.Equal(stored.Body, first.body) {
		t.Fatalf("idempotency row: %+v", stored)
	}
	objects := f.objects()

	// The replay: the frozen body byte for byte, nothing new anywhere, and the second object is deleted.
	for _, spelling := range []string{key, strings.ToUpper(key), strings.ReplaceAll(key, "-", "")} {
		replay := f.post(responsible.token, draft, hdr(spelling), filePart("Contrato.pdf", pdf))
		draftFlowAssertNoStore(t, replay)
		if replay.status != 201 || replay.header.Get("Idempotency-Replayed") != "true" || !bytes.Equal(replay.body, first.body) {
			t.Fatalf("replay %q: %d %q %s", spelling, replay.status, replay.header.Get("Idempotency-Replayed"), replay.body)
		}
	}
	if f.docCount(draft) != 1 || len(f.uploadedEvents(draft)) != 1 || f.objects() != objects ||
		f.count(`SELECT count(*) FROM job_draft_idempotency WHERE company_id=$1 AND operation='placement-document-upload:r1'`, f.company.companyID) != 1 {
		t.Fatalf("a replay created something: rows %d events %d objects %d (want %d)", f.docCount(draft), len(f.uploadedEvents(draft)), f.objects(), objects)
	}

	// A different request under the same key is a conflict, and its object is deleted too.
	for name, parts := range map[string][]docPart{
		"another file":      {filePart("Contrato.pdf", bytesPDF(501))},
		"another name":      {namePart("Otro nombre"), filePart("Contrato.pdf", pdf)},
		"another file name": {filePart("Oferta.pdf", pdf)},
	} {
		got := f.post(responsible.token, draft, hdr(key), parts...)
		draftFlowAssertError(t, got, 409, "idempotency_conflict")
		if f.docCount(draft) != 1 || f.objects() != objects || len(f.uploadedEvents(draft)) != 1 {
			t.Fatalf("%s: a conflict stored something: rows %d objects %d", name, f.docCount(draft), f.objects())
		}
	}

	// The key belongs to (company, actor): another actor reusing it creates its own document.
	other := f.member("recruiter")
	teamAccessCollaborator(t, f.h, draft, f.company.companyID, other.userID, f.owner.userID)
	if got := f.post(other.token, draft, hdr(key), filePart("Contrato.pdf", pdf)); got.status != 201 || got.header.Get("Idempotency-Replayed") != "false" {
		t.Fatalf("another actor: %d %s", got.status, got.body)
	}
	if f.docCount(draft) != 2 {
		t.Fatalf("rows: %d", f.docCount(draft))
	}

	// No key: a double submit creates a second document and no replay header is ever sent.
	a, b := f.post(responsible.token, draft, nil, filePart("Doble.pdf", pdf)), f.post(responsible.token, draft, nil, filePart("Doble.pdf", pdf))
	if a.status != 201 || b.status != 201 || a.header.Get("Idempotency-Replayed") != "" || f.docCount(draft) != 4 {
		t.Fatalf("keyless: %d %d rows %d", a.status, b.status, f.docCount(draft))
	}
}

// A replay works even when the document was deleted afterwards (it creates nothing), but it re-authorizes first: a
// recruiter who lost the vacancy cannot replay (D26).
func TestDocumentsUpload_ReplayReauthorizesAndSurvivesDeletion(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	collaborator := f.member("recruiter")
	assignment := teamAccessCollaborator(t, f.h, draft, f.company.companyID, collaborator.userID, f.owner.userID)
	key, pdf := uuid.NewString(), bytesPDF(80)
	hdr := map[string]string{"Idempotency-Key": key}
	first := f.post(collaborator.token, draft, hdr, filePart("a.pdf", pdf))
	if first.status != 201 {
		t.Fatalf("%d %s", first.status, first.body)
	}

	f.exec(`DELETE FROM placement_documents WHERE draft_id=$1`, draft)
	replay := f.post(collaborator.token, draft, hdr, filePart("a.pdf", pdf))
	if replay.status != 201 || replay.header.Get("Idempotency-Replayed") != "true" || !bytes.Equal(replay.body, first.body) || f.docCount(draft) != 0 {
		t.Fatalf("replay after delete: %d %q rows %d", replay.status, replay.header.Get("Idempotency-Replayed"), f.docCount(draft))
	}

	teamAccessEndCollaborator(t, f.h, assignment, f.owner.userID)
	draftFlowAssertError(t, f.post(collaborator.token, draft, hdr, filePart("a.pdf", pdf)), 404, "team_access_ended")
	draftFlowAssertError(t, f.post(collaborator.token, draft, hdr, filePart("b.pdf", pdf)), 404, "team_access_ended") // not a conflict either
}

// An invalid key is refused before the body is read and before anything is stored.
func TestDocumentsUpload_InvalidIdempotencyKey(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	body, ct := docsMultipart(t, filePart("a.pdf", bytesPDF(50)))
	good := uuid.NewString()
	for name, headers := range map[string][]string{
		"not a uuid":    {"abc"},
		"empty":         {""},
		"repeated line": {good, good},
		"almost a uuid": {good + "0"},
	} {
		t.Run(name, func(t *testing.T) {
			req, err := newDocsRequest(f.docs.server.URL+f.postPath(draft), body, ct, f.owner.token, headers)
			if err != nil {
				t.Fatal(err)
			}
			resp, err := f.docs.client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			var env map[string]any
			_ = json.NewDecoder(resp.Body).Decode(&env)
			if resp.StatusCode != 400 || env["code"] != "invalid_idempotency_key" {
				t.Fatalf("%d %v", resp.StatusCode, env)
			}
			f.assertNothingStored(name, draft)
		})
	}
	// Refused even for a non-multipart body: the header is checked first. A denied caller still gets the gate's answer.
	got := f.docs.do(t, "POST", f.postPath(draft), "{}", f.owner.token, map[string]string{"Content-Type": "application/json", "Idempotency-Key": "abc"})
	draftFlowAssertError(t, got, 400, "invalid_idempotency_key")
}

// Two requests racing on one key: one creates, the other replays; one document, one event, one object.
func TestDocumentsUpload_ConcurrentSameKeyCreatesOnce(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	body, ct := docsMultipart(t, filePart("a.pdf", bytesPDF(2000)))
	key := uuid.NewString()
	const n = 4
	type result struct {
		status   int
		replayed string
		err      error
	}
	results := make(chan result, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, err := f.docs.roundTrip("POST", f.postPath(draft), body, f.owner.token, map[string]string{"Content-Type": ct, "Idempotency-Key": key})
			results <- result{resp.status, resp.header.Get("Idempotency-Replayed"), err}
		}()
	}
	wg.Wait()
	close(results)
	created, replayed := 0, 0
	for r := range results {
		if r.err != nil || r.status != 201 {
			t.Fatalf("racer: %d %v", r.status, r.err)
		}
		if r.replayed == "false" {
			created++
		} else if r.replayed == "true" {
			replayed++
		}
	}
	if created != 1 || replayed != n-1 || f.docCount(draft) != 1 || len(f.uploadedEvents(draft)) != 1 || f.objects() != 1 {
		t.Fatalf("created %d replayed %d rows %d events %d objects %d", created, replayed, f.docCount(draft), len(f.uploadedEvents(draft)), f.objects())
	}
}

// The audit append is part of the write: when it fails, no row, no idempotency record and no object remain, and the key is
// still usable afterwards.
func TestDocumentsUpload_AuditFailureStoresNothing(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	allow := auditBlock(t, f.h.pool, f.company.companyID, "DocumentUploaded")
	key := uuid.NewString()
	got := f.post(f.owner.token, draft, map[string]string{"Idempotency-Key": key}, filePart("a.pdf", bytesPDF(80)))
	draftFlowAssertError(t, got, 500, "internal_error")
	if strings.Contains(string(got.body), "audit") {
		t.Fatalf("driver detail leaked: %s", got.body)
	}
	f.assertNothingStored("audit failure", draft)
	allow()
	if retry := f.post(f.owner.token, draft, map[string]string{"Idempotency-Key": key}, filePart("a.pdf", bytesPDF(80))); retry.status != 201 || retry.header.Get("Idempotency-Replayed") != "false" {
		t.Fatalf("retry: %d %s", retry.status, retry.body)
	}
}

// With the storage disabled every route that moves a file answers 503 after its usual gates, and nothing is recorded.
func TestDocumentsUpload_StorageDisabled(t *testing.T) {
	f := newDocsFlow(t) // no storage
	draft := publicationFlowReady(t, f.h, f.owner)
	stakeholder := f.member("stakeholder")
	outsider := f.member("recruiter")
	draftFlowAssertError(t, f.post(f.owner.token, draft, nil, filePart("a.pdf", bytesPDF(80))), 503, "document_storage_unavailable")
	// The gates answer first: a refused caller never learns that the storage is down.
	draftFlowAssertError(t, f.post(stakeholder.token, draft, nil, filePart("a.pdf", bytesPDF(80))), 403, "forbidden")
	draftFlowAssertError(t, f.post(outsider.token, draft, nil, filePart("a.pdf", bytesPDF(80))), 404, "not_found")
	if f.docCount(draft) != 0 || len(f.uploadedEvents(draft)) != 0 {
		t.Fatal("something was recorded without storage")
	}
	// The list still works without storage (contract).
	if got := f.get(f.owner.token, draft); got.status != 200 {
		t.Fatalf("list: %d %s", got.status, got.body)
	}
}

// newDocsRequest builds an upload whose Idempotency-Key header lines are exactly keys (repeated, empty or malformed on purpose).
func newDocsRequest(url, body, contentType, token string, keys []string) (*http.Request, error) {
	req, err := http.NewRequest("POST", url, strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+token)
	for _, k := range keys {
		req.Header.Add("Idempotency-Key", k)
	}
	return req, nil
}
