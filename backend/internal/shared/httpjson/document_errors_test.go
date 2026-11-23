package httpjson

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func documentBody(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
	return body
}

// The family of «Error codes» (placement-vacancy-documents-v1): six codes, their statuses, resolved from Resolve.
func TestDocumentCatalog(t *testing.T) {
	want := []Code{"document_content_mismatch", "document_limit_reached", "document_version_conflict", "document_already_linked", "document_link_invalid", "document_storage_unavailable"}
	if !reflect.DeepEqual(DocumentErrorCodes(), want) {
		t.Fatalf("codes: %v", DocumentErrorCodes())
	}
	DocumentErrorCodes()[0] = "mutated"
	if DocumentErrorCodes()[0] != CodeDocumentContentMismatch {
		t.Fatal("the code list must be a fresh slice")
	}
	status := map[Code]int{
		CodeDocumentContentMismatch: 400, CodeDocumentLimitReached: 409, CodeDocumentVersionConflict: 409,
		CodeDocumentAlreadyLinked: 409, CodeDocumentLinkInvalid: 422, CodeDocumentStorageUnavailable: 503,
	}
	for _, code := range DocumentErrorCodes() {
		def := Resolve(code)
		if def.Code != code || def.Status != status[code] || def.Message == "" {
			t.Errorf("%s resolves to %+v", code, def)
		}
		// Plain catalog write: the code and status survive normalization and no data rides along.
		w := httptest.NewRecorder()
		WriteCatalogError(w, def)
		body := documentBody(t, w)
		if w.Code != status[code] || body["code"] != string(code) || body["data"] != nil {
			t.Errorf("%s: %d %s", code, w.Code, w.Body)
		}
	}
	// None of the codes this contract deliberately does not use exists.
	for _, code := range []Code{"document_upload_not_allowed", "document_not_found", "document_too_large"} {
		if def := Resolve(code); def.Code != CodeInternalError {
			t.Errorf("%s must not exist: %+v", code, def)
		}
	}
}

func TestWriteDocumentContentMismatch(t *testing.T) {
	for _, tc := range []struct {
		name, detected, extension string
		wantDetected              any
	}{
		{"bytes of another format", "docx", ".pdf", "docx"},
		{"bytes of no accepted format", "", ".pdf", nil},
		{"every format of the closed enum", "jpg", ".png", "jpg"},
		{"no extension at all", "pdf", "", "pdf"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			WriteDocumentContentMismatch(w, tc.detected, tc.extension)
			body := documentBody(t, w)
			data, _ := body["data"].(map[string]any)
			if w.Code != 400 || body["code"] != "document_content_mismatch" || len(body) != 3 {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
			// detected_format is always present (null when the bytes match nothing); extension always present.
			if v, present := data["detected_format"]; !present || v != tc.wantDetected {
				t.Fatalf("detected_format = %v (present=%v)", v, present)
			}
			if data["extension"] != tc.extension || len(data) != 2 {
				t.Fatalf("data: %v", data)
			}
		})
	}
	// A value outside the closed enum is a server bug, never sent to the frontend.
	for _, bad := range []string{"doc", "xls", "PDF", "zip"} {
		w := httptest.NewRecorder()
		WriteDocumentContentMismatch(w, bad, ".pdf")
		if w.Code != 500 || documentBody(t, w)["code"] != "internal_error" {
			t.Errorf("detected_format %q accepted: %d %s", bad, w.Code, w.Body)
		}
	}
}

func TestWriteDocumentLimitReachedVersionConflictAlreadyLinked(t *testing.T) {
	w := httptest.NewRecorder()
	WriteDocumentLimitReached(w, "documents", 50)
	body := documentBody(t, w)
	if w.Code != 409 || body["code"] != "document_limit_reached" || !reflect.DeepEqual(body["data"], map[string]any{"kind": "documents", "limit": float64(50)}) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	w = httptest.NewRecorder()
	WriteDocumentLimitReached(w, "versions", 25)
	if body := documentBody(t, w); !reflect.DeepEqual(body["data"], map[string]any{"kind": "versions", "limit": float64(25)}) {
		t.Fatalf("%s", w.Body)
	}
	w = httptest.NewRecorder()
	WriteDocumentLimitReached(w, "files", 50)
	if w.Code != 500 {
		t.Fatalf("kind outside the closed enum accepted: %d %s", w.Code, w.Body)
	}

	w = httptest.NewRecorder()
	WriteDocumentVersionConflict(w, 3)
	body = documentBody(t, w)
	if w.Code != 409 || body["code"] != "document_version_conflict" || !reflect.DeepEqual(body["data"], map[string]any{"current_version": float64(3)}) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}

	w = httptest.NewRecorder()
	WriteDocumentAlreadyLinked(w, "0193b7e0-0000-7000-8000-000000000001")
	body = documentBody(t, w)
	if w.Code != 409 || body["code"] != "document_already_linked" || !reflect.DeepEqual(body["data"], map[string]any{"link_id": "0193b7e0-0000-7000-8000-000000000001"}) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestWriteDocumentLinkInvalid(t *testing.T) {
	for _, reason := range []string{"not_replacement", "source_not_in_chain", "version_not_found"} {
		w := httptest.NewRecorder()
		WriteDocumentLinkInvalid(w, reason)
		body := documentBody(t, w)
		if w.Code != 422 || body["code"] != "document_link_invalid" || !reflect.DeepEqual(body["data"], map[string]any{"reason": reason}) {
			t.Fatalf("%s: %d %s", reason, w.Code, w.Body)
		}
	}
	w := httptest.NewRecorder()
	WriteDocumentLinkInvalid(w, "not_in_placement") // the reason Q7 removed
	if w.Code != 500 {
		t.Fatalf("reason outside the closed enum accepted: %d %s", w.Code, w.Body)
	}
}

// unsupported_media_type and payload_too_large are generic catalog codes that the document routes answer with data.
func TestWriteDocumentGenericCodesWithData(t *testing.T) {
	formats := []DocumentFormat{
		{Format: "pdf", Extensions: []string{".pdf"}, ContentType: "application/pdf"},
		{Format: "jpg", Extensions: []string{".jpg", ".jpeg"}, ContentType: "image/jpeg"},
	}
	w := httptest.NewRecorder()
	WriteDocumentUnsupportedType(w, formats)
	body := documentBody(t, w)
	if w.Code != http.StatusUnsupportedMediaType || body["code"] != "unsupported_media_type" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	data := body["data"].(map[string]any)
	got := data["formats"].([]any)
	if len(data) != 1 || len(got) != 2 || !reflect.DeepEqual(got[1], map[string]any{"format": "jpg", "extensions": []any{".jpg", ".jpeg"}, "content_type": "image/jpeg"}) {
		t.Fatalf("data: %s", w.Body)
	}
	// Never null: a missing list is an empty one.
	w = httptest.NewRecorder()
	WriteDocumentUnsupportedType(w, nil)
	if !strings.Contains(w.Body.String(), `"formats":[]`) {
		t.Fatalf("%s", w.Body)
	}

	w = httptest.NewRecorder()
	WriteDocumentPayloadTooLarge(w, 10485760)
	body = documentBody(t, w)
	if w.Code != http.StatusRequestEntityTooLarge || body["code"] != "payload_too_large" || !reflect.DeepEqual(body["data"], map[string]any{"max_bytes": float64(10485760)}) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

// Data only travels through the document writers: the generic writers still strip it and a forged status is refused.
func TestDocumentDataNeverLeaksThroughGenericWriters(t *testing.T) {
	w := httptest.NewRecorder()
	WriteCatalogErrorData(w, Resolve(CodeDocumentLimitReached), map[string]any{"leak": true})
	if _, has := documentBody(t, w)["data"]; has {
		t.Fatalf("data leaked: %s", w.Body)
	}
	w = httptest.NewRecorder()
	WriteLifecycleError(w, Resolve(CodeDocumentLimitReached), map[string]any{"leak": true})
	if _, has := documentBody(t, w)["data"]; has {
		t.Fatalf("data leaked through the lifecycle seam: %s", w.Body)
	}
	w = httptest.NewRecorder()
	writeDocumentEnvelope(w, Definition{Code: CodeDocumentVersionConflict, Status: 200}, map[string]any{"current_version": 1})
	if w.Code != 500 {
		t.Fatalf("forged status accepted: %d", w.Code)
	}
	// Only the document family and the two generic codes it decorates may carry data here.
	w = httptest.NewRecorder()
	writeDocumentEnvelope(w, Resolve(CodeNotFound), map[string]any{"leak": true})
	if w.Code != 404 || documentBody(t, w)["data"] != nil {
		t.Fatalf("not_found carried data: %d %s", w.Code, w.Body)
	}
}

func TestDocumentClosedEnums(t *testing.T) {
	if got := DocumentFormatValues(); !reflect.DeepEqual(got, []string{"pdf", "docx", "xlsx", "jpg", "png"}) {
		t.Fatalf("formats: %v", got)
	}
	if got := DocumentLimitKinds(); !reflect.DeepEqual(got, []string{"documents", "versions"}) {
		t.Fatalf("kinds: %v", got)
	}
	if got := DocumentLinkInvalidReasons(); !reflect.DeepEqual(got, []string{"not_replacement", "source_not_in_chain", "version_not_found"}) {
		t.Fatalf("reasons: %v", got)
	}
}
