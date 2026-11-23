package documents

import (
	"archive/zip"
	"bytes"
	"errors"
	"io"
)

var (
	// ErrEmpty is an empty file (validation_error file/empty).
	ErrEmpty = errors.New("document is empty")
	// ErrTooLarge is a file over MaxBytes (payload_too_large).
	ErrTooLarge = errors.New("document too large")
	// ErrUnsupportedType is an extension outside the format table (unsupported_media_type).
	ErrUnsupportedType = errors.New("unsupported document type")
	// ErrContentMismatch is a file whose bytes do not match its extension (document_content_mismatch).
	ErrContentMismatch = errors.New("document content mismatch")
	// ErrInvalidName is a display name that cannot be stored (validation_error name).
	ErrInvalidName = errors.New("invalid document name")
)

// MismatchError is ErrContentMismatch with the data the answer carries:
// the format the bytes decide ("" when none) and the lower-cased extension with its dot.
type MismatchError struct {
	Detected  Format
	Extension string
}

func (e *MismatchError) Error() string { return ErrContentMismatch.Error() }

func (e *MismatchError) Is(target error) bool { return target == ErrContentMismatch }

// Sample is what streaming keeps of a file: its total size, its first bytes and
// its last bytes. Tail covers [Size-len(Tail), Size).
type Sample struct {
	Size int64
	Head []byte
	Tail []byte
}

// Collector is an io.Writer that keeps a Sample while a file streams to storage:
// the first HeadSize bytes and a rolling tail of the last TailWindow bytes.
type Collector struct {
	size  int64
	head  []byte
	ring  []byte // grows to TailWindow, then is overwritten circularly from start
	start int
}

// NewCollector returns an empty Collector.
func NewCollector() *Collector { return &Collector{} }

// Write never fails; it counts every byte, even past MaxBytes.
func (c *Collector) Write(p []byte) (int, error) {
	n := len(p)
	c.size += int64(n)
	if room := HeadSize - len(c.head); room > 0 {
		c.head = append(c.head, p[:min(room, len(p))]...)
	}
	if len(p) >= TailWindow {
		c.ring = append(c.ring[:0], p[len(p)-TailWindow:]...)
		c.start = 0
		return n, nil
	}
	if room := TailWindow - len(c.ring); room > 0 {
		k := min(room, len(p))
		c.ring = append(c.ring, p[:k]...)
		p = p[k:]
	}
	for len(p) > 0 {
		k := copy(c.ring[c.start:], p)
		p = p[k:]
		c.start = (c.start + k) % TailWindow
	}
	return n, nil
}

// Sample snapshots what was written so far; later writes do not change it.
func (c *Collector) Sample() Sample {
	tail := make([]byte, 0, len(c.ring))
	tail = append(tail, c.ring[c.start:]...)
	tail = append(tail, c.ring[:c.start]...)
	return Sample{Size: c.size, Head: append([]byte(nil), c.head...), Tail: tail}
}

var (
	magicPDF = []byte("%PDF-")
	magicJPG = []byte{0xff, 0xd8, 0xff}
	magicPNG = []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}
	magicZIP = []byte{'P', 'K', 0x03, 0x04}
)

const (
	partContentTypes = "[Content_Types].xml"
	partWord         = "word/document.xml"
	partExcel        = "xl/workbook.xml"

	maxZipEntries  = 1024
	maxPartExpands = 8 << 20
)

// Inspect decides the format of a file from its bytes, never from a client MIME
// type, and checks it against the extension of filename. Order: empty, too large,
// extension outside the table (ErrUnsupportedType), then bytes versus extension
// (*MismatchError). PDF, JPG and PNG are decided by the head; OOXML (DOCX/XLSX)
// by reading the ZIP central directory from the tail window only, without
// decompressing or opening any entry. A directory outside the window is a mismatch.
func Inspect(filename string, s Sample) (Format, error) {
	if s.Size <= 0 {
		return "", ErrEmpty
	}
	if s.Size > MaxBytes {
		return "", ErrTooLarge
	}
	ext := fileExtension(filename)
	want, ok := FormatForExtension(ext)
	if !ok {
		return "", ErrUnsupportedType
	}
	detected := detect(s)
	if detected != want {
		return "", &MismatchError{Detected: detected, Extension: ext}
	}
	return detected, nil
}

func detect(s Sample) Format {
	switch {
	case bytes.HasPrefix(s.Head, magicPDF):
		return PDF
	case bytes.HasPrefix(s.Head, magicJPG):
		return JPG
	case bytes.HasPrefix(s.Head, magicPNG):
		return PNG
	case bytes.HasPrefix(s.Head, magicZIP):
		return detectOOXML(s)
	}
	return ""
}

func detectOOXML(s Sample) Format {
	if len(s.Tail) == 0 {
		return ""
	}
	z, err := zip.NewReader(tailReader{tail: s.Tail, size: s.Size}, s.Size)
	if err != nil || len(z.File) > maxZipEntries {
		return ""
	}
	found := map[string]bool{}
	for _, f := range z.File {
		switch f.Name {
		case partContentTypes, partWord, partExcel:
			// Reject duplicate, directory, empty and encrypted markers and implausible expanded sizes.
			if found[f.Name] || f.FileInfo().IsDir() || f.UncompressedSize64 == 0 || f.UncompressedSize64 > maxPartExpands || f.Flags&1 != 0 {
				return ""
			}
			found[f.Name] = true
		}
	}
	switch {
	case !found[partContentTypes], found[partWord] == found[partExcel]:
		return ""
	case found[partWord]:
		return DOCX
	}
	return XLSX
}

var errOutsideTail = errors.New("read outside the inspection window")

// tailReader serves only the bytes of the tail window; any other offset is an error,
// so a directory that starts before the window fails instead of being guessed.
type tailReader struct {
	tail []byte
	size int64
}

func (r tailReader) ReadAt(p []byte, off int64) (int, error) {
	start := r.size - int64(len(r.tail))
	if off < start || off > r.size {
		return 0, errOutsideTail
	}
	n := copy(p, r.tail[off-start:])
	if n < len(p) {
		return n, io.EOF
	}
	return n, nil
}
