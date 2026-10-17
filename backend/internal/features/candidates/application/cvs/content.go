package cvs

import (
	"archive/zip"
	"bytes"
	"errors"
	"golang.org/x/text/unicode/norm"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	MaxBytes = 5_242_880
	MaxCVs   = 10
	PDF      = "application/pdf"
	DOCX     = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)

var (
	ErrInvalidRequest  = errors.New("invalid CV request")
	ErrTooLarge        = errors.New("CV too large")
	ErrUnsupportedType = errors.New("unsupported CV type")
	ErrContentMismatch = errors.New("CV content mismatch")
	ErrLibraryFull     = errors.New("CV library full")
	ErrNotFound        = errors.New("CV not found")
)

// Inspect ignores the client MIME header. ZIP inspection reads only the bounded
// central directory, never decompresses an entry and never extracts a path.
func Inspect(filename string, data []byte) (string, error) {
	if len(data) > MaxBytes {
		return "", ErrTooLarge
	}
	ext := strings.ToLower(path.Ext(filename))
	if ext != ".pdf" && ext != ".docx" {
		return "", ErrUnsupportedType
	}
	actual := ""
	if bytes.HasPrefix(data, []byte("%PDF-")) {
		actual = PDF
	} else if z, err := zip.NewReader(bytes.NewReader(data), int64(len(data))); err == nil && len(z.File) <= 1024 {
		found := map[string]bool{}
		valid := true
		for _, f := range z.File {
			if f.Name == "[Content_Types].xml" || f.Name == "word/document.xml" {
				// Reject duplicate/empty/encrypted markers and implausible expanded sizes.
				if found[f.Name] || f.FileInfo().IsDir() || f.UncompressedSize64 == 0 || f.UncompressedSize64 > 8<<20 || f.Flags&1 != 0 {
					valid = false
					break
				}
				found[f.Name] = true
			}
		}
		if valid && found["[Content_Types].xml"] && found["word/document.xml"] {
			actual = DOCX
		}
	}
	if (ext == ".pdf" && actual != PDF) || (ext == ".docx" && actual != DOCX) {
		return "", ErrContentMismatch
	}
	return actual, nil
}
func NormalizeName(raw string) (string, error) {
	if !utf8.ValidString(raw) {
		return "", ErrInvalidRequest
	}
	// Same NFC/White_Space rules as other display labels, without coupling
	// candidates to the employer feature's requester value object.
	raw = norm.NFC.String(raw)
	for _, r := range raw {
		if unicode.IsControl(r) && !unicode.Is(unicode.White_Space, r) {
			return "", ErrInvalidRequest
		}
	}
	name := strings.Join(strings.Fields(raw), " ")
	if name == "" || utf8.RuneCountInString(name) > 120 {
		return "", ErrInvalidRequest
	}
	return name, nil
}
