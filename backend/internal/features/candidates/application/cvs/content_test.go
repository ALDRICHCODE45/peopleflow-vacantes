package cvs

import (
	"archive/zip"
	"bytes"
	"errors"
	"strings"
	"testing"
)

func docx(t *testing.T, names ...string) []byte {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for _, name := range names {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = f.Write([]byte("<document/>")); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// §10.5: file signatures, extension spoofing, and the exact upload budget.
func TestInspect(t *testing.T) {
	valid := docx(t, "[Content_Types].xml", "word/document.xml")
	for _, tc := range []struct {
		name, filename string
		body           []byte
		typ            string
		err            error
	}{
		{"pdf", "cv.pdf", []byte("%PDF-1.7"), PDF, nil},
		{"docx", "cv.docx", valid, DOCX, nil},
		{"spoofed_pdf", "cv.pdf", valid, "", ErrContentMismatch},
		{"spoofed_docx", "cv.docx", []byte("%PDF-1"), "", ErrContentMismatch},
		{"arbitrary_zip", "cv.docx", docx(t, "other.xml"), "", ErrContentMismatch},
		{"garbage", "cv.pdf", []byte("garbage"), "", ErrContentMismatch},
		{"unsupported", "cv.exe", []byte("%PDF-1"), "", ErrUnsupportedType},
		{"oversize", "cv.pdf", []byte(strings.Repeat("x", MaxBytes+1)), "", ErrTooLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Inspect(tc.filename, tc.body)
			if got != tc.typ || !errors.Is(err, tc.err) {
				t.Fatalf("got %q %v", got, err)
			}
		})
	}
}
func TestNormalizeName(t *testing.T) {
	for _, tc := range []struct {
		name, raw, want string
		bad             bool
	}{
		{"normalized", "  CV\u00a0  Jose\u0301 ", "CV José", false},
		{"empty", " \t", "", true}, {"control", "a\x00b", "", true},
		{"unicode_limit", strings.Repeat("界", 120), strings.Repeat("界", 120), false},
		{"over_limit", strings.Repeat("界", 121), "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NormalizeName(tc.raw)
			if (err != nil) != tc.bad || got != tc.want {
				t.Fatalf("got %q %v", got, err)
			}
		})
	}
}
