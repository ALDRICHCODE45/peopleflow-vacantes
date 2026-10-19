package cvs

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
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

var registerInspectionMethod sync.Once
var inspectionOpens atomic.Int64

// Raw entries deliberately use an instrumented, nonstandard compression method.
// Inspection must use only the directory, not even open an entry.
func directoryDOCX(t *testing.T, headers []zip.FileHeader) []byte {
	t.Helper()
	registerInspectionMethod.Do(func() {
		zip.RegisterDecompressor(65000, func(io.Reader) io.ReadCloser {
			inspectionOpens.Add(1)
			return io.NopCloser(strings.NewReader("not XML"))
		})
	})
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for _, header := range headers {
		header.Method = 65000
		header.CompressedSize64 = 1
		f, err := w.CreateRaw(&header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = f.Write([]byte{0}); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestInspectDOCXDirectoryHardeningWithoutOpeningEntries(t *testing.T) {
	for _, tc := range []struct {
		name                 string
		entries              int
		marker               string
		size                 uint64
		encrypted, duplicate bool
		want                 error
	}{
		{"directory_only", 2, "word/document.xml", 1, false, false, nil},
		{"entry_limit", 1024, "word/document.xml", 1, false, false, nil},
		{"too_many_entries", 1025, "word/document.xml", 1, false, false, ErrContentMismatch},
		{"marker_size_limit", 2, "word/document.xml", 8 << 20, false, false, nil},
		{"oversize_content_types", 2, "[Content_Types].xml", (8 << 20) + 1, false, false, ErrContentMismatch},
		{"oversize_document", 2, "word/document.xml", (8 << 20) + 1, false, false, ErrContentMismatch},
		{"encrypted_content_types", 2, "[Content_Types].xml", 1, true, false, ErrContentMismatch},
		{"encrypted_document", 2, "word/document.xml", 1, true, false, ErrContentMismatch},
		{"duplicate_content_types", 2, "[Content_Types].xml", 1, false, true, ErrContentMismatch},
		{"duplicate_document", 2, "word/document.xml", 1, false, true, ErrContentMismatch},
	} {
		t.Run(tc.name, func(t *testing.T) {
			headers := []zip.FileHeader{{Name: "[Content_Types].xml", UncompressedSize64: 1}, {Name: "word/document.xml", UncompressedSize64: 1}}
			for i := range headers {
				if headers[i].Name == tc.marker {
					headers[i].UncompressedSize64 = tc.size
					if tc.encrypted {
						headers[i].Flags |= 1
					}
				}
			}
			if tc.duplicate {
				headers = append(headers, zip.FileHeader{Name: tc.marker, UncompressedSize64: 1})
			}
			for len(headers) < tc.entries {
				headers = append(headers, zip.FileHeader{Name: fmt.Sprintf("unused/%d", len(headers)), UncompressedSize64: 1})
			}
			before := inspectionOpens.Load()
			typ, err := Inspect("cv.docx", directoryDOCX(t, headers))
			if !errors.Is(err, tc.want) || (err == nil && typ != DOCX) {
				t.Fatalf("type %q error %v; want %v", typ, err, tc.want)
			}
			if inspectionOpens.Load() != before {
				t.Fatal("inspection opened a ZIP entry")
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
