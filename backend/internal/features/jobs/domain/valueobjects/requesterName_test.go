package valueobjects

import (
	"errors"
	"runtime"
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

// B1 — contract section 7 name normalization: UTF-8 validate -> NFC ->
// trim/collapse Unicode White_Space -> nonempty display name of at most 160
// codepoints, plus a full-casefolded NFC key that keeps accents and has no
// 160 limit. No NFKC, no truncation, no fuzzy matching, no silent stripping
// of zero-width/format characters, and non-whitespace controls are rejected.

func TestNewRequesterName_NormalizesDisplay(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"trims surrounding ascii whitespace", "  Alice Smith  ", "Alice Smith"},
		{"collapses inner ascii whitespace runs", "Alice   Smith", "Alice Smith"},
		{"collapses tabs and newlines to one ascii space", "Alice\t\n Smith", "Alice Smith"},
		{"collapses no-break space to ascii space", "Alice\u00A0Smith", "Alice Smith"},
		{"collapses nel to ascii space", "Alice\u0085Smith", "Alice Smith"},
		{"collapses line and paragraph separators", "Alice\u2028\u2029Smith", "Alice Smith"},
		{"trims and collapses ideographic space", "\u3000Alice\u3000\u3000Smith", "Alice Smith"},
		{"nfc composes decomposed accents", "Jose\u0301", "Jos\u00E9"},
		{"preserves uppercase", "ALICE", "ALICE"},
		{"preserves lowercase", "alice", "alice"},
		{"keeps combining marks in place", "A\u0301lice", "\u00C1lice"},
		{"keeps zero width space", "Alice\u200BSmith", "Alice\u200BSmith"},
		{"keeps zero width non joiner and joiner", "Alice\u200C\u200DSmith", "Alice\u200C\u200DSmith"},
		{"keeps zero width no-break space inside name", "Alice\uFEFFSmith", "Alice\uFEFFSmith"},
		{"keeps soft hyphen", "Alice\u00ADSmith", "Alice\u00ADSmith"},
		{"keeps right-to-left mark", "Alice\u200FSmith", "Alice\u200FSmith"},
		{"does not apply compatibility normalization to ligatures", "\uFB01le", "\uFB01le"},
		{"does not apply compatibility normalization to fullwidth forms", "\uFF21lice", "\uFF21lice"},
		{"accepts a lone zero width space without stripping it", "\u200B", "\u200B"},
		{"accepts a lone ideographic name", "\u6B63", "\u6B63"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NewRequesterName(tc.raw)
			if err != nil {
				t.Fatalf("NewRequesterName(%q) returned unexpected error: %v", tc.raw, err)
			}
			if got.Value() != tc.want {
				t.Errorf("NewRequesterName(%q).Value() = %q, want %q", tc.raw, got.Value(), tc.want)
			}
		})
	}
}

func TestNewRequesterName_Key(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"full casefolds to lowercase", "ALICE", "alice"},
		{"preserves accents while folding", "Jos\u00E9", "jos\u00E9"},
		{"full casefolds sharp s", "Stra\u00DFe", "strasse"},
		{"full casefolds capital sharp s", "STRA\u1E9EE", "strasse"},
		{"full casefolds ligature", "\uFB01le", "file"},
		{"folds titlecase digraph", "\u01C5ungla", "\u01C6ungla"},
		{"recomposes sequences decomposed by the fold", "\u0390", "\u0390"},
		{"keeps non-composable mark produced by the fold", "\u0130", "i\u0307"},
		{"folds ascii whitespace collapsed by the display", "Alice\u00A0\u00A0Smith", "alice smith"},
		{"keeps zero width space in the key", "Alice\u200BSmith", "alice\u200bsmith"},
		{"keeps compatibility ligature folded but not nfkc-normalized", "\uFF21lice", "\uFF41lice"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NewRequesterName(tc.raw)
			if err != nil {
				t.Fatalf("NewRequesterName(%q) returned unexpected error: %v", tc.raw, err)
			}
			if got.Key() != tc.want {
				t.Errorf("NewRequesterName(%q).Key() = %q, want %q", tc.raw, got.Key(), tc.want)
			}
		})
	}
}

func TestNewRequesterName_KeyIgnoresCaseButDistinguishesAccents(t *testing.T) {
	lower, err := NewRequesterName("jose")
	if err != nil {
		t.Fatalf("NewRequesterName(%q) returned unexpected error: %v", "jose", err)
	}
	upper, err := NewRequesterName("JOSE")
	if err != nil {
		t.Fatalf("NewRequesterName(%q) returned unexpected error: %v", "JOSE", err)
	}
	accented, err := NewRequesterName("jos\u00E9")
	if err != nil {
		t.Fatalf("NewRequesterName(%q) returned unexpected error: %v", "jos\u00E9", err)
	}

	if lower.Key() != upper.Key() {
		t.Errorf("case variants must share a key: %q vs %q", lower.Key(), upper.Key())
	}
	if lower.Key() == accented.Key() {
		t.Errorf("accented and unaccented names must not share a key: both %q", lower.Key())
	}
	if lower.Value() == upper.Value() {
		t.Errorf("display names must preserve casing: %q vs %q", lower.Value(), upper.Value())
	}
}

func TestNewRequesterName_RejectsEmpty(t *testing.T) {
	cases := []struct {
		name string
		raw  string
	}{
		{"empty string", ""},
		{"ascii spaces", "     "},
		{"tab and newline only", "\t\n\r"},
		{"no-break space only", "\u00A0"},
		{"ideographic space only", "\u3000"},
		{"paragraph separator only", "\u2029"},
		{"nel only", "\u0085"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewRequesterName(tc.raw)
			if err == nil {
				t.Fatalf("NewRequesterName(%q) expected an error, got nil", tc.raw)
			}
			if !errors.Is(err, ErrRequesterNameEmpty) {
				t.Errorf("NewRequesterName(%q) error = %v, want ErrRequesterNameEmpty", tc.raw, err)
			}
		})
	}
}

func TestNewRequesterName_RejectsInvalidUTF8(t *testing.T) {
	cases := []struct {
		name string
		raw  string
	}{
		{"lone continuation byte", string([]byte{0x80})},
		{"invalid start byte", string([]byte{0xFF})},
		{"truncated two byte sequence", string([]byte{'a', 0xC3})},
		{"unexpected continuation after c3", string([]byte{'a', 0xC3, 0x28})},
		{"encoded surrogate", string([]byte{0xED, 0xA0, 0x80})},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewRequesterName(tc.raw)
			if err == nil {
				t.Fatalf("NewRequesterName(%q) expected an error, got nil", tc.raw)
			}
			if !errors.Is(err, ErrRequesterNameInvalidUTF8) {
				t.Errorf("NewRequesterName(%q) error = %v, want ErrRequesterNameInvalidUTF8", tc.raw, err)
			}
		})
	}
}

func TestNewRequesterName_RejectsNonWhitespaceControls(t *testing.T) {
	cases := []struct {
		name string
		raw  string
	}{
		{"null", "Alice\u0000Smith"},
		{"bell", "Alice\u0007Smith"},
		{"escape", "Alice\u001BSmith"},
		{"delete", "Alice\u007FSmith"},
		{"c1 control", "Alice\u009FSmith"},
		{"leading control", "\u0001Alice"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewRequesterName(tc.raw)
			if err == nil {
				t.Fatalf("NewRequesterName(%q) expected an error, got nil", tc.raw)
			}
			if !errors.Is(err, ErrRequesterNameControl) {
				t.Errorf("NewRequesterName(%q) error = %v, want ErrRequesterNameControl", tc.raw, err)
			}
		})
	}
}

func TestNewRequesterName_LengthLimitCountsCodepoints(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		wantErr error
	}{
		{"160 ascii codepoints", strings.Repeat("a", 160), nil},
		{"161 ascii codepoints", strings.Repeat("a", 161), ErrRequesterNameTooLong},
		{"160 two byte codepoints", strings.Repeat("\u00E9", 160), nil},
		{"161 two byte codepoints", strings.Repeat("\u00E9", 161), ErrRequesterNameTooLong},
		{"160 decomposed accents composed by nfc", strings.Repeat("e\u0301", 160), nil},
		{"trimmed input measured after trimming", "  " + strings.Repeat("a", 160) + "  ", nil},
		{"collapsed whitespace counts toward the limit", strings.Repeat("a", 80) + "  " + strings.Repeat("a", 80), ErrRequesterNameTooLong},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NewRequesterName(tc.raw)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("NewRequesterName(%d codepoints) error = %v, want %v", utf8.RuneCountInString(tc.raw), err, tc.wantErr)
			}
			if err != nil {
				return
			}
			if n := utf8.RuneCountInString(got.Value()); n > MaxRequesterNameCodepoints {
				t.Errorf("accepted display name of %d codepoints, limit is %d", n, MaxRequesterNameCodepoints)
			}
		})
	}
}

func TestNewRequesterName_KeyIsNotLengthLimited(t *testing.T) {
	raw := strings.Repeat("\u00DF", MaxRequesterNameCodepoints)

	got, err := NewRequesterName(raw)
	if err != nil {
		t.Fatalf("NewRequesterName(%d sharp s) returned unexpected error: %v", MaxRequesterNameCodepoints, err)
	}
	if n := utf8.RuneCountInString(got.Value()); n != MaxRequesterNameCodepoints {
		t.Errorf("display name has %d codepoints, want %d", n, MaxRequesterNameCodepoints)
	}

	wantKey := strings.Repeat("ss", MaxRequesterNameCodepoints)
	if got.Key() != wantKey {
		t.Errorf("expanded key = %q, want %q", got.Key(), wantKey)
	}
	if n := utf8.RuneCountInString(got.Key()); n != 2*MaxRequesterNameCodepoints {
		t.Errorf("expanded key has %d codepoints, want %d (no 160 limit on the key)", n, 2*MaxRequesterNameCodepoints)
	}

	if _, err := NewRequesterName(strings.Repeat("\u00DF", MaxRequesterNameCodepoints+1)); !errors.Is(err, ErrRequesterNameTooLong) {
		t.Errorf("161 sharp s error = %v, want ErrRequesterNameTooLong", err)
	}
}

func TestNewRequesterName_IsDeterministic(t *testing.T) {
	raw := "  Jos\u00E9\u00A0\u00A0Stra\u00DFe\u200B  \uFB01le  "

	first, err := NewRequesterName(raw)
	if err != nil {
		t.Fatalf("NewRequesterName(%q) returned unexpected error: %v", raw, err)
	}
	second, err := NewRequesterName(raw)
	if err != nil {
		t.Fatalf("second NewRequesterName(%q) returned unexpected error: %v", raw, err)
	}

	if first != second {
		t.Errorf("repeated normalization differs: %+v vs %+v", first, second)
	}
	// Value and Key are pure reads of the two normalized fields, so the struct
	// comparison above already covers repeated accessor calls.
	if first.Value() != "Jos\u00E9 Stra\u00DFe\u200B \uFB01le" {
		t.Errorf("normalized display = %q, want %q", first.Value(), "Jos\u00E9 Stra\u00DFe\u200B \uFB01le")
	}
	if first.Key() != "jos\u00E9 strasse\u200b file" {
		t.Errorf("normalized key = %q, want %q", first.Key(), "jos\u00E9 strasse\u200b file")
	}
}

// TestNewRequesterName_NormalizationIsIdempotent triangulates the contract
// boundary that a stored display name re-enters the normalizer unchanged: the
// display name is already NFC, trimmed and collapsed, so re-normalizing it must
// not drift (no further folding, stripping or compatibility rewriting) and the
// key must stay identical. Callers rely on this to store Display and key once
// and still match later submissions that repeat the same normalized value.
func TestNewRequesterName_NormalizationIsIdempotent(t *testing.T) {
	inputs := []string{
		"  Jos\u00E9\u00A0\u00A0Stra\u00DFe\u200B  \uFB01le  ",
		"Alice   Smith",
		"\uFF21lice",
		"\u0390",
		"\u0130",
		"\u200B",
	}

	for _, raw := range inputs {
		t.Run(raw, func(t *testing.T) {
			first, err := NewRequesterName(raw)
			if err != nil {
				t.Fatalf("NewRequesterName(%q) returned unexpected error: %v", raw, err)
			}

			second, err := NewRequesterName(first.Value())
			if err != nil {
				t.Fatalf("re-normalizing display %q returned unexpected error: %v", first.Value(), err)
			}
			if second.Value() != first.Value() {
				t.Errorf("display drifted on re-normalization: %q -> %q", first.Value(), second.Value())
			}
			if second.Key() != first.Key() {
				t.Errorf("key drifted on re-normalization: %q -> %q", first.Key(), second.Key())
			}
		})
	}
}

// TestRequesterName_UnicodeTableVersions records, from the packages actually
// linked at run time, which Unicode editions drive the normalization
// (norm.Version), the full casefold (cases.UnicodeVersion) and the
// White_Space/control classification (unicode.Version). The values are read
// from constants instead of being asserted from memory, so a toolchain or
// x/text bump shows up here.
func TestRequesterName_UnicodeTableVersions(t *testing.T) {
	if norm.Version == "" {
		t.Error("norm.Version is empty")
	}
	if cases.UnicodeVersion == "" {
		t.Error("cases.UnicodeVersion is empty")
	}
	if unicode.Version == "" {
		t.Error("unicode.Version is empty")
	}

	t.Logf("unicode tables: norm.Version=%s cases.UnicodeVersion=%s unicode.Version=%s go=%s",
		norm.Version, cases.UnicodeVersion, unicode.Version, runtime.Version())
}
