package documents

import (
	"path"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
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
// then normalizeName (NFC, no control characters, spaces collapsed, at most
// 120 runes). A name with nothing left is ErrInvalidName.
func NormalizeGivenName(raw string) (string, error) {
	name, err := normalizeName(StripKnownExtension(raw))
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
	if name, err := normalizeName(base); err == nil {
		return name
	}
	if utf8.RuneCountInString(base) > MaxNameRunes {
		cut := []rune(base)[:MaxNameRunes]
		if name, err := normalizeName(string(cut)); err == nil {
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

// normalizeName applies the display-label rules of the CV library (same rules as
// cvs.NormalizeName, kept local because a feature may not import another
// feature's application package): valid UTF-8, NFC, no control characters other
// than white space, white space collapsed to single spaces, 1..MaxNameRunes runes.
func normalizeName(raw string) (string, error) {
	if !utf8.ValidString(raw) {
		return "", ErrInvalidName
	}
	raw = norm.NFC.String(raw)
	for _, r := range raw {
		if unicode.IsControl(r) && !unicode.Is(unicode.White_Space, r) {
			return "", ErrInvalidName
		}
	}
	name := strings.Join(strings.Fields(raw), " ")
	if name == "" || utf8.RuneCountInString(name) > MaxNameRunes {
		return "", ErrInvalidName
	}
	return name, nil
}
