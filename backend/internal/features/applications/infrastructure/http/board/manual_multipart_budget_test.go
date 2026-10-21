package board

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestManualMultipartEpilogueCountsAgainstBudget(t *testing.T) {
	w, body, contentType := manualMultipartRequest(t, []manualTestPart{
		{name: "data", content: "{}"},
		{name: "cv", filename: "resume.pdf", content: "%PDF-1.7\n"},
	})
	body.WriteString(strings.Repeat("x", 5_242_880+65536))
	r := httptest.NewRequest("POST", "/", body)
	r.Header.Set("Content-Type", contentType)
	if _, err := readManualMultipart(w, r); !errors.Is(err, errManualCVTooLarge) {
		t.Fatalf("error = %v, want CV too large", err)
	}
}

func TestManualMultipartPreservesUninspectedBytesAndNormalizesBasename(t *testing.T) {
	// Invalid CV content is deliberately accepted at this boundary: inspection
	// must happen only after the transactional write operation's duplicate checks.
	w, body, contentType := manualMultipartRequest(t, []manualTestPart{
		{name: "data", content: "{}"},
		{name: "cv", filename: "folder/sub/resume.pdf", content: "not a PDF"},
	})
	r := httptest.NewRequest("POST", "/", body)
	r.Header.Set("Content-Type", contentType)
	got, err := readManualMultipart(w, r)
	if err != nil || got.Filename != "resume.pdf" || string(got.CV) != "not a PDF" {
		t.Fatalf("got %q, %q, %v", got.Filename, got.CV, err)
	}
}
