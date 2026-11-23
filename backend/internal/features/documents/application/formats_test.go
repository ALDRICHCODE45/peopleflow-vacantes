package documents_test

import (
	"encoding/json"
	"reflect"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
)

func TestLimitsMatchTheContract(t *testing.T) {
	if documents.MaxBytes != 10_485_760 || documents.MaxRequestBytes != 10_551_296 {
		t.Fatalf("bytes: %d request %d", documents.MaxBytes, documents.MaxRequestBytes)
	}
	if documents.MaxVacancyDocuments != 50 || documents.MaxParticipationDocuments != 20 || documents.MaxVersions != 25 {
		t.Fatalf("counts: %d %d %d", documents.MaxVacancyDocuments, documents.MaxParticipationDocuments, documents.MaxVersions)
	}
	if documents.HeadSize != 16 || documents.TailWindow != 2<<20 {
		t.Fatalf("window: %d %d", documents.HeadSize, documents.TailWindow)
	}
}

func TestFormatDescriptorsAreTheContractJSON(t *testing.T) {
	const want = `[
	 {"format":"pdf","extensions":[".pdf"],"content_type":"application/pdf"},
	 {"format":"docx","extensions":[".docx"],"content_type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
	 {"format":"xlsx","extensions":[".xlsx"],"content_type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
	 {"format":"jpg","extensions":[".jpg",".jpeg"],"content_type":"image/jpeg"},
	 {"format":"png","extensions":[".png"],"content_type":"image/png"}]`
	got, err := json.Marshal(documents.Formats())
	if err != nil {
		t.Fatal(err)
	}
	var a, b any
	if err := json.Unmarshal(got, &a); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(want), &b); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("descriptors:\n got %s\nwant %s", got, want)
	}
	if string(got[:len(`[{"format":"pdf"`)]) != `[{"format":"pdf"` {
		t.Fatalf("descriptor key order or list order drifted: %s", got)
	}
}

func TestFormatsReturnsACopy(t *testing.T) {
	first := documents.Formats()
	first[0].Format = "mutated"
	first[3].Extensions[0] = ".mutated"
	again := documents.Formats()
	if again[0].Format != "pdf" || again[3].Extensions[0] != ".jpg" {
		t.Fatalf("shared state leaked: %+v", again)
	}
}

func TestFormatTable(t *testing.T) {
	for _, tc := range []struct {
		format      documents.Format
		contentType string
		extension   string
	}{
		{documents.PDF, "application/pdf", ".pdf"},
		{documents.DOCX, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"},
		{documents.XLSX, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"},
		{documents.JPG, "image/jpeg", ".jpg"},
		{documents.PNG, "image/png", ".png"},
	} {
		if tc.format.ContentType() != tc.contentType || tc.format.Extension() != tc.extension {
			t.Fatalf("%s: %q %q", tc.format, tc.format.ContentType(), tc.format.Extension())
		}
		got, ok := documents.FormatFromContentType(tc.contentType)
		if !ok || got != tc.format {
			t.Fatalf("FormatFromContentType(%q)=%q %v", tc.contentType, got, ok)
		}
	}
	for _, unknown := range []string{"", "application/msword", "application/vnd.ms-excel", "image/gif", "APPLICATION/PDF"} {
		if got, ok := documents.FormatFromContentType(unknown); ok || got != "" {
			t.Fatalf("FormatFromContentType(%q)=%q %v", unknown, got, ok)
		}
	}
	if documents.Format("").ContentType() != "" || documents.Format("doc").Extension() != "" {
		t.Fatal("unknown format must have no content type or extension")
	}
}

func TestFormatForExtension(t *testing.T) {
	for ext, want := range map[string]documents.Format{
		".pdf": documents.PDF, ".PDF": documents.PDF, ".docx": documents.DOCX, ".Xlsx": documents.XLSX,
		".jpg": documents.JPG, ".JPEG": documents.JPG, ".jpeg": documents.JPG, ".png": documents.PNG,
	} {
		got, ok := documents.FormatForExtension(ext)
		if !ok || got != want {
			t.Fatalf("FormatForExtension(%q)=%q %v", ext, got, ok)
		}
	}
	for _, ext := range []string{"", ".", "pdf", ".doc", ".xls", ".zip", ".gif", ".pdf ", ".docx.pdf", ".jpe"} {
		if got, ok := documents.FormatForExtension(ext); ok || got != "" {
			t.Fatalf("FormatForExtension(%q)=%q %v", ext, got, ok)
		}
	}
}
