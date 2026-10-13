package valueobjects

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

// MaxRequesterNameCodepoints is the contract's display-name limit: a
// normalized display name is at most 160 Unicode codepoints. The limit is
// checked against codepoints (not bytes, not grapheme clusters) and applies
// only to RequesterName.Value; RequesterName.Key is the expanded casefolded
// lookup key and is deliberately not length-limited.
const MaxRequesterNameCodepoints = 160

var (
	// ErrRequesterNameInvalidUTF8 rejects input that is not valid UTF-8.
	ErrRequesterNameInvalidUTF8 = errors.New("requester name must be valid utf-8")
	// ErrRequesterNameControl rejects non-whitespace control characters.
	ErrRequesterNameControl = errors.New("requester name must not contain control characters")
	// ErrRequesterNameEmpty rejects names that normalize to nothing.
	ErrRequesterNameEmpty = errors.New("requester name must not be empty")
	// ErrRequesterNameTooLong rejects display names above the codepoint limit.
	ErrRequesterNameTooLong = errors.New("requester name must be at most 160 unicode codepoints")
)

// RequesterName is the normalized name supplied by the person requesting a
// private vacancy draft.
//
// Normalization (contract section 7) is deliberately narrow: validate UTF-8,
// apply NFC, then trim and collapse Unicode White_Space runs to a single ASCII
// space. The display name keeps the caller's casing, accents, format
// characters and compatibility forms: no NFKC, no truncation, no fuzzy
// matching and no silent removal of zero-width or other format characters.
// Non-whitespace control characters are rejected instead of stripped.
type RequesterName struct {
	display string
	key     string
}

// NewRequesterName validates and normalizes raw into a RequesterName.
func NewRequesterName(raw string) (RequesterName, error) {
	if !utf8.ValidString(raw) {
		return RequesterName{}, ErrRequesterNameInvalidUTF8
	}

	// NFC first: composition must happen before the length check so that a
	// decomposed spelling of a 160-codepoint name is measured as written.
	display, err := normalizeRequesterDisplay(norm.NFC.String(raw))
	if err != nil {
		return RequesterName{}, err
	}
	if display == "" {
		return RequesterName{}, ErrRequesterNameEmpty
	}
	if utf8.RuneCountInString(display) > MaxRequesterNameCodepoints {
		return RequesterName{}, ErrRequesterNameTooLong
	}

	// Full Unicode case folding (not ToLower) keeps accents while folding
	// every cased character, and can expand the key (ß -> ss, ﬁ -> fi), which
	// is exactly why the key has no 160-codepoint limit. NFC afterwards
	// re-composes sequences the fold may have decomposed. cases.Caser is
	// stateful, so a fresh folder is created per call and never shared.
	key := norm.NFC.String(cases.Fold().String(display))

	return RequesterName{display: display, key: key}, nil
}

// Value returns the normalized display name: NFC, trimmed, with inner
// Unicode White_Space runs collapsed to a single ASCII space.
func (n RequesterName) Value() string {
	return n.display
}

// Key returns the lookup key: full Unicode case folding of the normalized
// display name, re-normalized to NFC, with accents preserved.
func (n RequesterName) Key() string {
	return n.key
}

// normalizeRequesterDisplay trims and collapses Unicode White_Space runs to a
// single ASCII space. Whitespace controls (tab, newline, NEL) are collapsed
// like any other White_Space character; every other control character is
// rejected. Format characters (category Cf), including zero-width spaces and
// soft hyphens, are preserved as-is.
func normalizeRequesterDisplay(s string) (string, error) {
	var b strings.Builder
	b.Grow(len(s))

	pendingSpace := false
	for _, r := range s {
		if unicode.Is(unicode.White_Space, r) {
			// Leading whitespace is dropped (nothing buffered yet) and a
			// trailing run is never flushed, which trims both ends.
			pendingSpace = b.Len() > 0
			continue
		}
		if unicode.IsControl(r) {
			return "", fmt.Errorf("%w: %U", ErrRequesterNameControl, r)
		}
		if pendingSpace {
			b.WriteByte(' ')
			pendingSpace = false
		}
		b.WriteRune(r)
	}

	return b.String(), nil
}
