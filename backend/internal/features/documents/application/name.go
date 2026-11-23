package documents

import (
	"path"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/cvs"
)

// StripKnownExtension removes ONE trailing known extension (.pdf, .docx, .xlsx,
// .jpg, .jpeg, .png, case-insensitive) before normalization (D11), so the UI icon
// comes from `format` and a download never reads «contrato.pdf.docx». Trailing
// whitespace is ignored when looking for the extension. Anything else is returned as is.
func StripKnownExtension(name string) string {
	trimmed := strings.TrimRightFunc(name, unicode.IsSpace)
	ext := path.Ext(trimmed)
	if _, known := FormatForExtension(ext); !known {
		return name
	}
	return trimmed[:len(trimmed)-len(ext)]
}

// NormalizeGivenName normalizes a name the user typed: known extension stripped,
// then cvs.NormalizeName (NFC, no control characters, spaces collapsed, at most
// 120 runes). A name with nothing left is ErrInvalidName.
func NormalizeGivenName(raw string) (string, error) {
	name, err := cvs.NormalizeName(StripKnownExtension(raw))
	if err != nil {
		return "", ErrInvalidName
	}
	return name, nil
}

// DefaultName derives the display name of an upload without `name` from the
// client file name: its base (either path separator), known extension stripped,
// normalized. It never fails: an over-long base is cut to 120 runes, and a base
// with nothing left or with control characters becomes FallbackName.
func DefaultName(filename string) string {
	base := filename
	if i := strings.LastIndexAny(base, `/\`); i >= 0 {
		base = base[i+1:]
	}
	base = StripKnownExtension(base)
	if name, err := cvs.NormalizeName(base); err == nil {
		return name
	}
	if utf8.RuneCountInString(base) > MaxNameRunes {
		cut := []rune(base)[:MaxNameRunes]
		if name, err := cvs.NormalizeName(string(cut)); err == nil {
			return name
		}
	}
	return FallbackName
}

// DownloadName is the file name served for a version: the display name plus the
// extension of that version's stored format, by plain concatenation (D11).
func DownloadName(name string, format Format) string {
	return name + format.Extension()
}
