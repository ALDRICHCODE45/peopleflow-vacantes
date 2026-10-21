package board

import (
	"bytes"
	"errors"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
)

type manualTestPart struct{ name, filename, content, encoding string }

func manualMultipartRequest(t *testing.T, parts []manualTestPart) (*httptest.ResponseRecorder, *bytes.Buffer, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, p := range parts {
		header := make(textproto.MIMEHeader)
		disposition := `form-data; name="` + p.name + `"`
		if p.filename != "" {
			disposition += `; filename="` + p.filename + `"`
		}
		header.Set("Content-Disposition", disposition)
		if p.encoding != "" {
			header.Set("Content-Transfer-Encoding", p.encoding)
		}
		part, err := writer.CreatePart(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(part, p.content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return httptest.NewRecorder(), &body, writer.FormDataContentType()
}

func TestManualMultipartBoundary(t *testing.T) {
	data := manualTestPart{name: "data", content: `{"stage_id":null,"existing":null,"confirmed_distinct":false,"candidate":null}`}
	cv := manualTestPart{name: "cv", filename: "resume.pdf", content: "%PDF-1.7\n"}
	tests := []struct {
		name      string
		parts     []manualTestPart
		want      error
		missingCV bool
	}{
		{name: "data then cv", parts: []manualTestPart{data, cv}},
		{name: "cv then data", parts: []manualTestPart{cv, data}},
		{name: "missing cv", parts: []manualTestPart{data}, missingCV: true},
		{name: "missing data", parts: []manualTestPart{cv}, want: app.ErrInvalidRequest},
		{name: "empty multipart", want: app.ErrInvalidRequest},
		{name: "repeated data", parts: []manualTestPart{data, data, cv}, want: app.ErrInvalidRequest},
		{name: "repeated cv", parts: []manualTestPart{data, cv, cv}, want: app.ErrInvalidRequest},
		{name: "unknown part", parts: []manualTestPart{data, cv, {name: "other"}}, want: app.ErrInvalidRequest},
		{name: "data is file", parts: []manualTestPart{{name: "data", filename: "data.json", content: "{}"}, cv}, want: app.ErrInvalidRequest},
		{name: "cv lacks filename", parts: []manualTestPart{data, {name: "cv", content: cv.content}}, want: app.ErrInvalidRequest},
		{name: "transfer encoding", parts: []manualTestPart{data, {name: "cv", filename: "resume.pdf", content: cv.content, encoding: "base64"}}, want: app.ErrInvalidRequest},
		{name: "data too large", parts: []manualTestPart{{name: "data", content: strings.Repeat(" ", 65537)}, cv}, want: app.ErrInvalidRequest},
		{name: "cv too large", parts: []manualTestPart{data, {name: "cv", filename: "resume.pdf", content: strings.Repeat("x", 5_242_881)}}, want: errManualCVTooLarge},
		{name: "raw multipart budget", parts: []manualTestPart{{name: "data", content: strings.Repeat(" ", 65536)}, {name: "cv", filename: "resume.pdf", content: strings.Repeat("x", 5_242_880)}}, want: errManualCVTooLarge},
		{name: "cv at limit", parts: []manualTestPart{data, {name: "cv", filename: "resume.pdf", content: strings.Repeat("x", 5_242_880)}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w, body, contentType := manualMultipartRequest(t, tt.parts)
			r := httptest.NewRequest("POST", "/", body)
			r.Header.Set("Content-Type", contentType)
			got, err := readManualMultipart(w, r)
			if tt.missingCV {
				var validation *app.ManualValidationError
				if !errors.As(err, &validation) || len(validation.Fields) != 1 || validation.Fields[0] != (app.ManualFieldError{Field: "cv", Code: "required"}) {
					t.Fatalf("missing CV: %v", err)
				}
				return
			}
			if !errors.Is(err, tt.want) {
				t.Fatalf("error = %v, want %v", err, tt.want)
			}
			if err != nil {
				return
			}
			if string(got.Data) != data.content || got.Filename != "resume.pdf" {
				t.Fatalf("unexpected multipart data: %q / %q", got.Data, got.Filename)
			}
			for _, p := range tt.parts {
				if p.name == "cv" && string(got.CV) != p.content {
					t.Fatal("CV bytes changed")
				}
			}
		})
	}
}

func TestManualMultipartMalformedAndRawBudget(t *testing.T) {
	tests := []struct {
		name, contentType, body string
		want                    error
	}{
		{"not multipart", "application/json", "{}", app.ErrInvalidRequest},
		{"missing boundary", "multipart/form-data", "", app.ErrInvalidRequest},
		{"truncated", "multipart/form-data; boundary=x", "--x\r\nContent-Disposition: form-data; name=\"data\"\r\n\r\n{}", app.ErrInvalidRequest},
		{"invalid preamble", "multipart/form-data; boundary=x", strings.Repeat(" ", 5_242_880+65537), app.ErrInvalidRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := httptest.NewRequest("POST", "/", strings.NewReader(tt.body))
			r.Header.Set("Content-Type", tt.contentType)
			_, err := readManualMultipart(w, r)
			if !errors.Is(err, tt.want) {
				t.Fatalf("error = %v, want %v", err, tt.want)
			}
		})
	}
}
