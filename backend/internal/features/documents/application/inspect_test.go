package documents_test

import (
	"archive/zip"
	"bytes"
	"errors"
	"strings"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
)

var (
	pngBytes   = append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, make([]byte, 24)...)
	jpgBytes   = append([]byte{0xff, 0xd8, 0xff, 0xe0}, make([]byte, 24)...)
	pdfBytes   = []byte("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF")
	contentXML = "[Content_Types].xml"
)

// ooxml builds a zip whose entries are only declared: inspection never opens one.
func ooxml(t *testing.T, headers ...zip.FileHeader) []byte {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for _, h := range headers {
		h.Method = zip.Store
		h.CompressedSize64 = 1
		if h.UncompressedSize64 == 0 && h.Comment != "empty" {
			h.UncompressedSize64 = 1
		}
		f, err := w.CreateRaw(&h)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte{0}); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func parts(names ...string) []zip.FileHeader {
	out := make([]zip.FileHeader, len(names))
	for i, n := range names {
		out[i] = zip.FileHeader{Name: n}
	}
	return out
}

func docxBytes(t *testing.T) []byte { return ooxml(t, parts(contentXML, "word/document.xml")...) }
func xlsxBytes(t *testing.T) []byte { return ooxml(t, parts(contentXML, "xl/workbook.xml")...) }

// sample runs the bytes through the same collector the upload handler will use.
func sample(t *testing.T, data []byte) documents.Sample {
	t.Helper()
	c := documents.NewCollector()
	for len(data) > 0 {
		n := min(len(data), 7001)
		if _, err := c.Write(data[:n]); err != nil {
			t.Fatal(err)
		}
		data = data[n:]
	}
	return c.Sample()
}

func TestInspectAcceptsEveryFormatFromItsBytes(t *testing.T) {
	for _, tc := range []struct {
		filename string
		body     []byte
		want     documents.Format
	}{
		{"contrato.pdf", pdfBytes, documents.PDF},
		{"CONTRATO.PDF", pdfBytes, documents.PDF},
		{"oferta.docx", docxBytes(t), documents.DOCX},
		{"Oferta.DocX", docxBytes(t), documents.DOCX},
		{"sueldos.xlsx", xlsxBytes(t), documents.XLSX},
		{"foto.jpg", jpgBytes, documents.JPG},
		{"foto.jpeg", jpgBytes, documents.JPG},
		{"foto.JPEG", jpgBytes, documents.JPG},
		{"escaneo.png", pngBytes, documents.PNG},
		{"con.puntos.y espacios.pdf", pdfBytes, documents.PDF},
	} {
		got, err := documents.Inspect(tc.filename, sample(t, tc.body))
		if err != nil || got != tc.want {
			t.Errorf("%s: %q %v want %q", tc.filename, got, err, tc.want)
		}
	}
}

func TestInspectMagicBytesBoundaries(t *testing.T) {
	for name, tc := range map[string]struct {
		filename string
		body     []byte
		ok       bool
	}{
		"pdf magic alone":        {"a.pdf", []byte("%PDF-"), true},
		"pdf magic truncated":    {"a.pdf", []byte("%PDF"), false},
		"pdf lowercase":          {"a.pdf", []byte("%pdf-1.4"), false},
		"pdf magic not at start": {"a.pdf", []byte(" %PDF-1.4"), false},
		"jpg magic alone":        {"a.jpg", []byte{0xff, 0xd8, 0xff}, true},
		"jpg magic truncated":    {"a.jpg", []byte{0xff, 0xd8}, false},
		"jpg wrong third byte":   {"a.jpg", []byte{0xff, 0xd8, 0x00}, false},
		"png magic alone":        {"a.png", []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, true},
		"png magic truncated":    {"a.png", []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a}, false},
		"png wrong crlf":         {"a.png", []byte{0x89, 'P', 'N', 'G', 0x0a, 0x0d, 0x1a, 0x0a}, false},
		"one byte":               {"a.pdf", []byte("%"), false},
	} {
		_, err := documents.Inspect(tc.filename, sample(t, tc.body))
		if tc.ok && err != nil {
			t.Errorf("%s: %v", name, err)
		}
		if !tc.ok && !errors.Is(err, documents.ErrContentMismatch) {
			t.Errorf("%s: want mismatch, got %v", name, err)
		}
	}
}

func TestInspectMismatchCarriesDetectedFormatAndExtension(t *testing.T) {
	for _, tc := range []struct {
		name, filename string
		body           []byte
		detected       documents.Format
		extension      string
	}{
		{"pdf named docx", "a.docx", pdfBytes, documents.PDF, ".docx"},
		{"docx named pdf", "a.pdf", docxBytes(t), documents.DOCX, ".pdf"},
		{"docx named xlsx", "a.xlsx", docxBytes(t), documents.DOCX, ".xlsx"},
		{"xlsx named docx", "a.docx", xlsxBytes(t), documents.XLSX, ".docx"},
		{"png named jpg", "a.jpg", pngBytes, documents.PNG, ".jpg"},
		{"jpg named png", "a.png", jpgBytes, documents.JPG, ".png"},
		{"jpg named pdf", "a.pdf", jpgBytes, documents.JPG, ".pdf"},
		{"upper-case extension is lower-cased", "A.DOCX", pdfBytes, documents.PDF, ".docx"},
		{"jpeg extension kept as sent", "a.JPEG", pngBytes, documents.PNG, ".jpeg"},
		{"unknown bytes", "a.pdf", []byte("hello, world"), "", ".pdf"},
		{"plain zip", "a.docx", ooxml(t, parts("other.xml")...), "", ".docx"},
		{"zip without Content_Types", "a.xlsx", ooxml(t, parts("xl/workbook.xml")...), "", ".xlsx"},
		{"zip with only Content_Types", "a.docx", ooxml(t, parts(contentXML)...), "", ".docx"},
		{"powerpoint", "a.docx", ooxml(t, parts(contentXML, "ppt/presentation.xml")...), "", ".docx"},
		{"truncated zip", "a.docx", docxBytes(t)[:20], "", ".docx"},
		{"ole2 legacy word", "a.docx", append([]byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}, make([]byte, 600)...), "", ".docx"},
	} {
		_, err := documents.Inspect(tc.filename, sample(t, tc.body))
		var mismatch *documents.MismatchError
		if !errors.Is(err, documents.ErrContentMismatch) || !errors.As(err, &mismatch) {
			t.Errorf("%s: %v", tc.name, err)
			continue
		}
		if mismatch.Detected != tc.detected || mismatch.Extension != tc.extension {
			t.Errorf("%s: detected %q extension %q, want %q %q", tc.name, mismatch.Detected, mismatch.Extension, tc.detected, tc.extension)
		}
	}
}

func TestInspectExtensionsOutsideTheTable(t *testing.T) {
	for _, filename := range []string{"a.doc", "a.xls", "a.zip", "a.exe", "a", "", "a.", ".docx.bak", "a.pdf.exe", "a.jpe", "a.gif", "a.pdf "} {
		for _, body := range [][]byte{pdfBytes, docxBytes(t), []byte("x")} {
			got, err := documents.Inspect(filename, sample(t, body))
			if !errors.Is(err, documents.ErrUnsupportedType) || got != "" {
				t.Errorf("%q: %q %v", filename, got, err)
			}
			var mismatch *documents.MismatchError
			if errors.As(err, &mismatch) {
				t.Errorf("%q: unsupported type must not be a mismatch", filename)
			}
		}
	}
}

func TestInspectSizeBoundaries(t *testing.T) {
	head := []byte("%PDF-1.7")
	if _, err := documents.Inspect("a.pdf", documents.Sample{}); !errors.Is(err, documents.ErrEmpty) {
		t.Fatalf("empty: %v", err)
	}
	if _, err := documents.Inspect("a.exe", documents.Sample{}); !errors.Is(err, documents.ErrEmpty) {
		t.Fatalf("empty beats unsupported type: %v", err)
	}
	if got, err := documents.Inspect("a.pdf", documents.Sample{Size: 5, Head: []byte("%PDF-")}); err != nil || got != documents.PDF {
		t.Fatalf("smallest pdf: %q %v", got, err)
	}
	atLimit := documents.Sample{Size: documents.MaxBytes, Head: head, Tail: make([]byte, 1024)}
	if got, err := documents.Inspect("a.pdf", atLimit); err != nil || got != documents.PDF {
		t.Fatalf("10 MiB exactly: %q %v", got, err)
	}
	over := documents.Sample{Size: documents.MaxBytes + 1, Head: head, Tail: make([]byte, 1024)}
	if _, err := documents.Inspect("a.pdf", over); !errors.Is(err, documents.ErrTooLarge) {
		t.Fatalf("10 MiB + 1: %v", err)
	}
	if _, err := documents.Inspect("a.exe", over); !errors.Is(err, documents.ErrTooLarge) {
		t.Fatalf("too large beats unsupported type: %v", err)
	}
	if _, err := documents.Inspect("a.pdf", documents.Sample{Size: -1}); !errors.Is(err, documents.ErrEmpty) {
		t.Fatalf("negative size: %v", err)
	}
}

func TestInspectOOXMLDirectoryHardening(t *testing.T) {
	many := func(n int) []zip.FileHeader {
		hs := parts(contentXML, "word/document.xml")
		for i := 2; i < n; i++ {
			hs = append(hs, zip.FileHeader{Name: "word/media/" + strings.Repeat("a", i%7+1) + string(rune('A'+i%26)) + "/" + strings.Repeat("b", i/26+1)})
		}
		return hs
	}
	sized := func(marker string, size uint64, flags uint16) []zip.FileHeader {
		hs := parts(contentXML, "word/document.xml")
		for i := range hs {
			if hs[i].Name == marker {
				hs[i].UncompressedSize64 = size
				hs[i].Flags = flags
			}
		}
		return hs
	}
	for _, tc := range []struct {
		name    string
		headers []zip.FileHeader
		ok      bool
	}{
		{"1024 entries", many(1024), true},
		{"1025 entries", many(1025), false},
		{"marker at 8 MiB expanded", sized("word/document.xml", 8<<20, 0), true},
		{"marker above 8 MiB expanded", sized("word/document.xml", 8<<20+1, 0), false},
		{"content types above 8 MiB", sized(contentXML, 8<<20+1, 0), false},
		{"encrypted main part", sized("word/document.xml", 1, 1), false},
		{"encrypted content types", sized(contentXML, 1, 1), false},
		{"duplicate main part", append(parts(contentXML, "word/document.xml"), parts("word/document.xml")...), false},
		{"duplicate content types", append(parts(contentXML, "word/document.xml"), parts(contentXML)...), false},
		{"empty main part", []zip.FileHeader{{Name: contentXML}, {Name: "word/document.xml", Comment: "empty"}}, false},
	} {
		got, err := documents.Inspect("a.docx", sample(t, ooxml(t, tc.headers...)))
		if tc.ok && (err != nil || got != documents.DOCX) {
			t.Errorf("%s: %q %v", tc.name, got, err)
		}
		if !tc.ok && !errors.Is(err, documents.ErrContentMismatch) {
			t.Errorf("%s: want mismatch, got %q %v", tc.name, got, err)
		}
	}
	// The same rules apply to the xlsx main part.
	bad := ooxml(t, zip.FileHeader{Name: contentXML}, zip.FileHeader{Name: "xl/workbook.xml", UncompressedSize64: 8<<20 + 1})
	if _, err := documents.Inspect("a.xlsx", sample(t, bad)); !errors.Is(err, documents.ErrContentMismatch) {
		t.Fatalf("oversize workbook: %v", err)
	}
	// A package that claims to be both Word and Excel is neither.
	both := ooxml(t, parts(contentXML, "word/document.xml", "xl/workbook.xml")...)
	for _, name := range []string{"a.docx", "a.xlsx"} {
		if _, err := documents.Inspect(name, sample(t, both)); !errors.Is(err, documents.ErrContentMismatch) {
			t.Fatalf("%s: ambiguous package accepted: %v", name, err)
		}
	}
}

func TestInspectNeverOpensAnEntry(t *testing.T) {
	// An entry with an unregistered compression method fails on Open; inspection must not care.
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for _, name := range []string{contentXML, "word/document.xml"} {
		f, err := w.CreateRaw(&zip.FileHeader{Name: name, Method: 64999, CompressedSize64: 1, UncompressedSize64: 1})
		if err != nil {
			t.Fatal(err)
		}
		_, _ = f.Write([]byte{0})
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if got, err := documents.Inspect("a.docx", sample(t, b.Bytes())); err != nil || got != documents.DOCX {
		t.Fatalf("%q %v", got, err)
	}
}

// D9: a file larger than the tail window is decided by the head and the tail only.
func TestInspectLargeOOXMLUsesTheTailWindow(t *testing.T) {
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	filler, err := w.CreateHeader(&zip.FileHeader{Name: "xl/media/scan.bin", Method: zip.Store})
	if err != nil {
		t.Fatal(err)
	}
	chunk := bytes.Repeat([]byte{0x5a}, 1<<20)
	for i := 0; i < 8; i++ { // 8 MiB of stored data between the local header of the first entry and the directory
		if _, err := filler.Write(chunk); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{contentXML, "xl/workbook.xml"} {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = f.Write([]byte("<x/>"))
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	data := b.Bytes()
	if len(data) <= documents.TailWindow+documents.HeadSize {
		t.Fatalf("fixture too small to exercise the window: %d", len(data))
	}
	s := sample(t, data)
	if s.Size != int64(len(data)) || len(s.Head) != documents.HeadSize || len(s.Tail) != documents.TailWindow {
		t.Fatalf("sample size=%d head=%d tail=%d", s.Size, len(s.Head), len(s.Tail))
	}
	if got, err := documents.Inspect("a.xlsx", s); err != nil || got != documents.XLSX {
		t.Fatalf("%q %v", got, err)
	}
	if _, err := documents.Inspect("a.docx", s); !errors.Is(err, documents.ErrContentMismatch) {
		t.Fatalf("xlsx named docx: %v", err)
	}
}

// D9: a central directory that starts before the tail window is a mismatch, never a read outside the window.
func TestInspectDirectoryOutsideTheTailWindowIsAMismatch(t *testing.T) {
	data := docxBytes(t)
	full := sample(t, data)
	if got, err := documents.Inspect("a.docx", full); err != nil || got != documents.DOCX {
		t.Fatalf("control: %q %v", got, err)
	}
	// Keep only the last bytes: the end-of-central-directory record survives, the directory it points to does not.
	eocd := 22
	for cut := len(full.Tail) - eocd; cut >= len(full.Tail)-eocd-60 && cut > 0; cut -= 20 {
		s := documents.Sample{Size: full.Size, Head: full.Head, Tail: full.Tail[cut:]}
		_, err := documents.Inspect("a.docx", s)
		var mismatch *documents.MismatchError
		if !errors.As(err, &mismatch) || mismatch.Detected != "" || mismatch.Extension != ".docx" {
			t.Fatalf("tail of %d bytes: %v", len(s.Tail), err)
		}
	}
	// No tail at all: head says zip, nothing proves OOXML.
	if _, err := documents.Inspect("a.docx", documents.Sample{Size: full.Size, Head: full.Head}); !errors.Is(err, documents.ErrContentMismatch) {
		t.Fatalf("no tail: %v", err)
	}
	// A PDF or an image never needs the tail.
	if got, err := documents.Inspect("a.pdf", documents.Sample{Size: 5_000_000, Head: []byte("%PDF-1.7")}); err != nil || got != documents.PDF {
		t.Fatalf("pdf without tail: %q %v", got, err)
	}
}

func TestCollectorKeepsHeadTailAndSize(t *testing.T) {
	data := make([]byte, 3*documents.TailWindow+123)
	for i := range data {
		data[i] = byte(i * 7)
	}
	c := documents.NewCollector()
	for off := 0; off < len(data); {
		n := min(len(data)-off, 32*1024+off%977)
		if got, err := c.Write(data[off : off+n]); err != nil || got != n {
			t.Fatalf("write: %d %v", got, err)
		}
		off += n
	}
	s := c.Sample()
	if s.Size != int64(len(data)) {
		t.Fatalf("size=%d", s.Size)
	}
	if !bytes.Equal(s.Head, data[:documents.HeadSize]) {
		t.Fatalf("head=% x", s.Head)
	}
	if !bytes.Equal(s.Tail, data[len(data)-documents.TailWindow:]) {
		t.Fatal("tail is not the last TailWindow bytes")
	}
	// The sample is a snapshot: more writes do not mutate it.
	_, _ = c.Write([]byte("more"))
	if !bytes.Equal(s.Tail, data[len(data)-documents.TailWindow:]) {
		t.Fatal("sample aliases the collector buffer")
	}
}

func TestCollectorSmallFilesAreWhollyInBothWindows(t *testing.T) {
	for _, n := range []int{0, 1, 5, documents.HeadSize - 1, documents.HeadSize, documents.HeadSize + 1, documents.TailWindow - 1, documents.TailWindow, documents.TailWindow + 1} {
		data := bytes.Repeat([]byte{1, 2, 3, 4, 5, 6, 7}, n/7+1)[:n]
		s := sample(t, data)
		wantHead, wantTail := data[:min(n, documents.HeadSize)], data[max(0, n-documents.TailWindow):]
		if s.Size != int64(n) || !bytes.Equal(s.Head, wantHead) || !bytes.Equal(s.Tail, wantTail) {
			t.Fatalf("n=%d size=%d head=%d tail=%d", n, s.Size, len(s.Head), len(s.Tail))
		}
	}
}

func TestCollectorCountsBeyondTheLimitWithoutKeepingIt(t *testing.T) {
	c := documents.NewCollector()
	chunk := make([]byte, 1<<20)
	for i := 0; i < 11; i++ {
		_, _ = c.Write(chunk)
	}
	s := c.Sample()
	if s.Size != 11<<20 || len(s.Tail) != documents.TailWindow {
		t.Fatalf("size=%d tail=%d", s.Size, len(s.Tail))
	}
	if _, err := documents.Inspect("a.pdf", s); !errors.Is(err, documents.ErrTooLarge) {
		t.Fatalf("11 MiB: %v", err)
	}
}

func TestMismatchErrorMessageNeverEchoesBytes(t *testing.T) {
	err := &documents.MismatchError{Detected: documents.PDF, Extension: ".docx"}
	if !errors.Is(err, documents.ErrContentMismatch) || errors.Is(err, documents.ErrUnsupportedType) {
		t.Fatal("MismatchError must be ErrContentMismatch only")
	}
	if err.Error() != documents.ErrContentMismatch.Error() {
		t.Fatalf("message %q", err.Error())
	}
}
