package draftjson

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// The rich fixture is a small synthetic set of whole private vacancy draft
// envelopes ({schema_version, document}) whose canonical go-json-v1 bytes are
// authored as literals before EncodeValidatedValue is ever compared against
// them. The document shape is only intended to be rich-draft grammar-valid:
// this package never executes a rich grammar, so the tests below prove byte
// encoding and never grammar conformance.

const (
	richFixtureID            = "go-json-v1-rich"
	richFixtureProducer      = "backend/internal/features/jobs/application/draftjson"
	richFixtureSchemaVersion = 1
	richFixtureUnit          = "rich-document"
	richFixtureCaseCount     = 16
)

// richFixturePinnedIDs is the exact pinned case-name set. The names are listed
// in fixture order for readability only: validateRichFixtureDocument compares
// membership as a set, so it rejects missing, extra, renamed or duplicated
// cases but does not enforce the array order.
var richFixturePinnedIDs = []string{
	"paragraph_content_omitted",
	"paragraph_content_empty_array",
	"text_marks_omitted",
	"text_marks_empty_array",
	"marks_bold_then_italic",
	"marks_italic_then_bold",
	"text_emoji",
	"text_nfc_e_acute",
	"text_decomposed_e_acute",
	"text_html_characters",
	"text_real_line_separators",
	"text_literal_line_separator_escapes",
	"ordered_list_start_three",
	"ordered_list_start_max_int32",
	"hard_break_bold_between_text",
	"text_font_size_preset_normal",
}

var (
	errRichFixtureID       = errors.New("rich fixture: unexpected fixtureId")
	errRichFixtureSchema   = errors.New("rich fixture: unexpected schemaVersion")
	errRichFixtureCount    = errors.New("rich fixture: case count must be 16")
	errRichFixtureName     = errors.New("rich fixture: case names must match the pinned set exactly")
	errRichFixtureUnit     = errors.New("rich fixture: unexpected unit")
	errRichFixturePositive = errors.New("rich fixture: cases must be positive with a literal expectedUtf8")
	errRichFixtureEnvelope = errors.New("rich fixture: input must be exactly {schema_version:1, document:{content, type:doc}}")
)

// TestRichFixtures_Membership pins the fixture envelope and the exact 16-case
// membership before any other rich fixture test relies on it.
func TestRichFixtures_Membership(t *testing.T) {
	doc := readRichFixtureDocument(t)
	if err := validateRichFixtureDocument(doc); err != nil {
		t.Fatalf("fixture guard rejected the fixture: %v", err)
	}
	if doc.Producer != richFixtureProducer {
		t.Fatalf("producer = %q, want %q", doc.Producer, richFixtureProducer)
	}
	if richFixtureUnit == "encoder-unit" || richFixtureUnit == "rich-shaped" {
		t.Fatalf("rich fixture unit %q must be distinct from the B2 units", richFixtureUnit)
	}
}

// TestRichFixtures_LiteralCanonicalBytes compares the encoder output against
// the authored expectedUtf8 literals only. It is intentionally narrower than
// TestRichFixtures_EncodedRepresentations so the literal match can be observed
// before the derived hex/length/sha256 representations exist.
func TestRichFixtures_LiteralCanonicalBytes(t *testing.T) {
	doc := readRichFixtureDocument(t)
	if err := validateRichFixtureDocument(doc); err != nil {
		t.Fatalf("fixture guard rejected the fixture: %v", err)
	}

	for _, tc := range doc.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			value := fixtureInputValue(t, tc.Input)
			assertWhitelistedFixtureTypes(t, value)

			got, err := EncodeValidatedValue(value)
			if err != nil {
				t.Fatalf("EncodeValidatedValue() error = %v, want nil", err)
			}
			if !bytes.Equal(got, []byte(tc.ExpectedUTF8)) {
				t.Fatalf("bytes = %q, want literal %q", got, tc.ExpectedUTF8)
			}
		})
	}
}

// TestRichFixtures_EncodedRepresentations compares every pinned representation
// of each case: the literal expectedUtf8, the encoder output, and the derived
// hex, byte length and sha256. It then re-verifies the fixture literals against
// each other so a hand-edited or silently regenerated fixture is detected
// without ever rewriting testdata.
func TestRichFixtures_EncodedRepresentations(t *testing.T) {
	doc := readRichFixtureDocument(t)
	if err := validateRichFixtureDocument(doc); err != nil {
		t.Fatalf("fixture guard rejected the fixture: %v", err)
	}

	for _, tc := range doc.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			value := fixtureInputValue(t, tc.Input)
			assertWhitelistedFixtureTypes(t, value)

			got, err := EncodeValidatedValue(value)
			if err != nil {
				t.Fatalf("EncodeValidatedValue() error = %v, want nil", err)
			}

			wantBytes := []byte(tc.ExpectedUTF8)
			if !bytes.Equal(got, wantBytes) {
				t.Fatalf("bytes = %q, want literal %q", got, wantBytes)
			}
			if gotHex := hex.EncodeToString(got); gotHex != tc.ExpectedHex {
				t.Fatalf("output hex = %s, want literal %s", gotHex, tc.ExpectedHex)
			}
			if len(got) != tc.ExpectedByteLength {
				t.Fatalf("byte length = %d, want literal %d", len(got), tc.ExpectedByteLength)
			}
			if gotSum := sha256Hex(got); gotSum != tc.ExpectedSHA256 {
				t.Fatalf("sha256 = %s, want literal %s", gotSum, tc.ExpectedSHA256)
			}

			fixtureHex, err := hex.DecodeString(tc.ExpectedHex)
			if err != nil {
				t.Fatalf("fixture expectedHex %q is invalid: %v", tc.ExpectedHex, err)
			}
			if !bytes.Equal(fixtureHex, wantBytes) {
				t.Fatalf("fixture expectedHex %s does not match expectedUtf8 %q", tc.ExpectedHex, tc.ExpectedUTF8)
			}
			if len(wantBytes) != tc.ExpectedByteLength {
				t.Fatalf("fixture expectedByteLength %d does not match expectedUtf8 length %d", tc.ExpectedByteLength, len(wantBytes))
			}
			if wantSum := sha256Hex(wantBytes); wantSum != tc.ExpectedSHA256 {
				t.Fatalf("fixture expectedSha256 %s does not match expectedUtf8 sha256 %s", tc.ExpectedSHA256, wantSum)
			}
		})
	}
}

// TestRichFixtures_PairedDistinctions proves the intentional pairs really are
// distinguishable in the canonical bytes: presence versus [] on an optional
// key, mark order, NFC versus decomposed Unicode, and real line separators
// versus their literal backslash escape text.
func TestRichFixtures_PairedDistinctions(t *testing.T) {
	doc := readRichFixtureDocument(t)
	if err := validateRichFixtureDocument(doc); err != nil {
		t.Fatalf("fixture guard rejected the fixture: %v", err)
	}

	encoded := make(map[string][]byte, len(doc.Cases))
	for _, tc := range doc.Cases {
		value := fixtureInputValue(t, tc.Input)
		assertWhitelistedFixtureTypes(t, value)
		got, err := EncodeValidatedValue(value)
		if err != nil {
			t.Fatalf("case %q: EncodeValidatedValue() error = %v, want nil", tc.Name, err)
		}
		encoded[tc.Name] = got
	}

	assertDistinct := func(first, second string) {
		t.Helper()
		if bytes.Equal(encoded[first], encoded[second]) {
			t.Fatalf("cases %q and %q encoded identically, want distinct bytes", first, second)
		}
	}

	t.Run("paragraph content omitted versus empty array", func(t *testing.T) {
		assertDistinct("paragraph_content_omitted", "paragraph_content_empty_array")
		omitted := encoded["paragraph_content_omitted"]
		if !bytes.Contains(omitted, []byte(`{"type":"paragraph"}`)) {
			t.Fatalf("omitted case = %q, want a paragraph without a content key", omitted)
		}
		if bytes.Contains(omitted, []byte(`"content":[]`)) {
			t.Fatalf("omitted case = %q, want no content key", omitted)
		}
		if empty := encoded["paragraph_content_empty_array"]; !bytes.Contains(empty, []byte(`{"content":[],"type":"paragraph"}`)) {
			t.Fatalf("empty array case = %q, want an explicit empty content array", empty)
		}
	})

	t.Run("text marks omitted versus empty array", func(t *testing.T) {
		assertDistinct("text_marks_omitted", "text_marks_empty_array")
		omitted := encoded["text_marks_omitted"]
		if bytes.Contains(omitted, []byte(`"marks"`)) {
			t.Fatalf("omitted case = %q, want no marks key in the text node", omitted)
		}
		if empty := encoded["text_marks_empty_array"]; !bytes.Contains(empty, []byte(`{"marks":[],"text":"Hola","type":"text"}`)) {
			t.Fatalf("empty array case = %q, want an explicit empty marks array", empty)
		}
	})

	t.Run("bold then italic versus italic then bold", func(t *testing.T) {
		assertDistinct("marks_bold_then_italic", "marks_italic_then_bold")
		boldItalic := encoded["marks_bold_then_italic"]
		italicBold := encoded["marks_italic_then_bold"]
		if !bytes.Contains(boldItalic, []byte(`"marks":[{"type":"bold"},{"type":"italic"}]`)) {
			t.Fatalf("bold then italic = %q, want the authored mark order", boldItalic)
		}
		if !bytes.Contains(italicBold, []byte(`"marks":[{"type":"italic"},{"type":"bold"}]`)) {
			t.Fatalf("italic then bold = %q, want the authored mark order", italicBold)
		}
	})

	t.Run("nfc e acute versus decomposed e acute", func(t *testing.T) {
		assertDistinct("text_nfc_e_acute", "text_decomposed_e_acute")
		nfc := encoded["text_nfc_e_acute"]
		nfd := encoded["text_decomposed_e_acute"]
		if !bytes.Contains(nfc, []byte("caf\u00e9")) {
			t.Fatalf("nfc case = %q, want precomposed U+00E9", nfc)
		}
		if !bytes.Contains(nfd, []byte("cafe\u0301")) {
			t.Fatalf("nfd case = %q, want combining U+0301", nfd)
		}
		if len(nfc) == len(nfd) {
			t.Fatalf("nfc length %d equals nfd length %d, want distinct byte lengths", len(nfc), len(nfd))
		}
	})

	t.Run("real line separators versus literal escape text", func(t *testing.T) {
		assertDistinct("text_real_line_separators", "text_literal_line_separator_escapes")
		real := encoded["text_real_line_separators"]
		literal := encoded["text_literal_line_separator_escapes"]
		if !bytes.Contains(real, []byte(`"text":"\u2028\u2029"`)) {
			t.Fatalf("real separators = %q, want them escaped to literal backslash-u2028 sequences", real)
		}
		if !bytes.Contains(literal, []byte(`"text":"\\u2028\\u2029"`)) {
			t.Fatalf("literal escapes = %q, want the backslashes themselves escaped", literal)
		}
	})

	t.Run("ordered list start values", func(t *testing.T) {
		assertDistinct("ordered_list_start_three", "ordered_list_start_max_int32")
		attrs := []struct {
			name string
			want string
		}{
			{name: "ordered_list_start_three", want: `{"attrs":{"start":3,"type":null},`},
			{name: "ordered_list_start_max_int32", want: `{"attrs":{"start":2147483647,"type":null},`},
		}
		for _, attr := range attrs {
			got := encoded[attr.name]
			// presence: attrs carries start followed by an explicit type key
			if !bytes.Contains(got, []byte(attr.want)) {
				t.Fatalf("%s = %q, want attrs %s", attr.name, got, attr.want)
			}
			// null: the explicit type key is null and is never omitted
			if !bytes.Contains(got, []byte(`"type":null`)) {
				t.Fatalf("%s = %q, want an explicit null type in attrs", attr.name, got)
			}
		}
	})

	t.Run("emoji and html characters", func(t *testing.T) {
		if emoji := encoded["text_emoji"]; !bytes.Contains(emoji, []byte("\U0001F600")) {
			t.Fatalf("emoji case = %q, want raw utf8 emoji bytes", emoji)
		}
		html := encoded["text_html_characters"]
		if !bytes.Contains(html, []byte(`\u003cb\u003e\u0026`)) {
			t.Fatalf("html case = %q, want html characters escaped", html)
		}
	})

	t.Run("hard break keeps its bold mark between text nodes", func(t *testing.T) {
		hardBreak := encoded["hard_break_bold_between_text"]
		want := []byte(`[{"text":"a","type":"text"},{"marks":[{"type":"bold"}],"type":"hardBreak"},{"text":"b","type":"text"}]`)
		if !bytes.Contains(hardBreak, want) {
			t.Fatalf("hard break case = %q, want a bold hardBreak between the two text nodes", hardBreak)
		}
	})

	t.Run("font size preset mark carries attrs", func(t *testing.T) {
		preset := encoded["text_font_size_preset_normal"]
		want := []byte(`{"marks":[{"attrs":{"preset":"normal"},"type":"fontSizePreset"}],"text":"Normal","type":"text"}`)
		if !bytes.Contains(preset, want) {
			t.Fatalf("font size preset case = %q, want the authored mark shape", preset)
		}
	})
}

// TestRichFixtures_MembershipGuardNegativeControl proves the membership guard
// actually rejects count, duplicate, unknown, unit and positivity violations.
// Every case mutates an in-memory copy, so the on-disk fixture and the B2
// fixture are never rewritten.
func TestRichFixtures_MembershipGuardNegativeControl(t *testing.T) {
	base := readRichFixtureDocument(t)
	if err := validateRichFixtureDocument(base); err != nil {
		t.Fatalf("baseline fixture must validate before the controls: %v", err)
	}

	tests := []struct {
		name    string
		mutate  func(doc *fixtureDocument)
		wantErr error
	}{
		{
			name:    "wrong fixture id",
			mutate:  func(doc *fixtureDocument) { doc.FixtureID = "go-json-v1" },
			wantErr: errRichFixtureID,
		},
		{
			name:    "wrong schema version",
			mutate:  func(doc *fixtureDocument) { doc.SchemaVersion = 2 },
			wantErr: errRichFixtureSchema,
		},
		{
			name:    "fifteen cases",
			mutate:  func(doc *fixtureDocument) { doc.Cases = doc.Cases[:15] },
			wantErr: errRichFixtureCount,
		},
		{
			name:    "seventeen cases",
			mutate:  func(doc *fixtureDocument) { doc.Cases = append(doc.Cases, doc.Cases[0]) },
			wantErr: errRichFixtureCount,
		},
		{
			name:    "duplicate case name",
			mutate:  func(doc *fixtureDocument) { doc.Cases[1].Name = doc.Cases[0].Name },
			wantErr: errRichFixtureName,
		},
		{
			name:    "unknown case name",
			mutate:  func(doc *fixtureDocument) { doc.Cases[0].Name = "unknown_case" },
			wantErr: errRichFixtureName,
		},
		{
			name:    "wrong unit",
			mutate:  func(doc *fixtureDocument) { doc.Cases[0].Unit = "encoder-unit" },
			wantErr: errRichFixtureUnit,
		},
		{
			name:    "missing expected utf8",
			mutate:  func(doc *fixtureDocument) { doc.Cases[0].ExpectedUTF8 = "" },
			wantErr: errRichFixturePositive,
		},
		{
			name:    "unexpected expected error",
			mutate:  func(doc *fixtureDocument) { doc.Cases[0].ExpectedError = "ErrUnsupportedType" },
			wantErr: errRichFixturePositive,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			doc := cloneRichFixtureDocument(base)
			tt.mutate(&doc)
			err := validateRichFixtureDocument(doc)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("guard error = %v, want %v", err, tt.wantErr)
			}
		})
	}

	if err := validateRichFixtureDocument(base); err != nil {
		t.Fatalf("baseline fixture changed during negative controls: %v", err)
	}
}

// TestRichFixtures_EnvelopeRootShape checks only the whole-envelope root shape
// every rich fixture case claims: exactly schema_version and document,
// schema_version 1, and document.type "doc" with a content array. It does not
// validate the rich draft grammar or any nested node shape.
func TestRichFixtures_EnvelopeRootShape(t *testing.T) {
	doc := readRichFixtureDocument(t)
	if err := validateRichFixtureDocument(doc); err != nil {
		t.Fatalf("fixture guard rejected the fixture: %v", err)
	}

	for _, tc := range doc.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			value := fixtureInputValue(t, tc.Input)
			assertWhitelistedFixtureTypes(t, value)
			if err := validateRichFixtureEnvelope(value); err != nil {
				t.Fatalf("envelope guard: %v", err)
			}
		})
	}
}

// TestRichFixtures_EnvelopeGuardNegativeControl proves the envelope guard
// rejects a missing root document type using an in-memory copy only.
func TestRichFixtures_EnvelopeGuardNegativeControl(t *testing.T) {
	doc := readRichFixtureDocument(t)
	if err := validateRichFixtureDocument(doc); err != nil {
		t.Fatalf("fixture guard rejected the fixture: %v", err)
	}

	value := fixtureInputValue(t, doc.Cases[0].Input)
	envelope, ok := cloneValidatedValue(value).(map[string]any)
	if !ok {
		t.Fatalf("envelope is %T, not an object", value)
	}
	document, ok := envelope["document"].(map[string]any)
	if !ok {
		t.Fatalf("document is %T, not an object", envelope["document"])
	}
	delete(document, "type")

	if err := validateRichFixtureEnvelope(envelope); !errors.Is(err, errRichFixtureEnvelope) {
		t.Fatalf("guard error = %v, want %v", err, errRichFixtureEnvelope)
	}
}

// readRichFixtureDocument decodes the rich fixture with UseNumber, so every
// fixture number arrives as a json.Number and is converted through the same
// bounded strconv.ParseInt path used by the B2 fixture.
func readRichFixtureDocument(t *testing.T) fixtureDocument {
	t.Helper()

	raw, err := os.ReadFile(filepath.Join("testdata", "go-json-v1-rich.json"))
	if err != nil {
		t.Fatalf("read rich fixture: %v", err)
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()

	var doc fixtureDocument
	if err := decoder.Decode(&doc); err != nil {
		t.Fatalf("decode rich fixture: %v", err)
	}
	return doc
}

// validateRichFixtureDocument is a pure guard over the decoded fixture. It is
// separated from the file read so the negative control can exercise it with
// in-memory copies only.
func validateRichFixtureDocument(doc fixtureDocument) error {
	if doc.FixtureID != richFixtureID {
		return fmt.Errorf("%w: got %q", errRichFixtureID, doc.FixtureID)
	}
	if doc.SchemaVersion != richFixtureSchemaVersion {
		return fmt.Errorf("%w: got %d", errRichFixtureSchema, doc.SchemaVersion)
	}
	if len(doc.Cases) != richFixtureCaseCount {
		return fmt.Errorf("%w: got %d", errRichFixtureCount, len(doc.Cases))
	}

	pinned := make(map[string]bool, len(richFixturePinnedIDs))
	for _, name := range richFixturePinnedIDs {
		pinned[name] = true
	}

	seen := make(map[string]bool, len(doc.Cases))
	for _, tc := range doc.Cases {
		if seen[tc.Name] {
			return fmt.Errorf("%w: duplicate %q", errRichFixtureName, tc.Name)
		}
		seen[tc.Name] = true
		if !pinned[tc.Name] {
			return fmt.Errorf("%w: unexpected %q", errRichFixtureName, tc.Name)
		}
		if tc.Unit != richFixtureUnit {
			return fmt.Errorf("%w: case %q has unit %q", errRichFixtureUnit, tc.Name, tc.Unit)
		}
		if tc.ExpectedError != "" || tc.ExpectedUTF8 == "" {
			return fmt.Errorf("%w: case %q", errRichFixturePositive, tc.Name)
		}
	}
	if len(seen) != len(pinned) {
		return fmt.Errorf("%w: %d seen of %d pinned", errRichFixtureName, len(seen), len(pinned))
	}
	return nil
}

// validateRichFixtureEnvelope is a pure guard for the whole-envelope root shape
// every rich fixture case claims: exactly the keys schema_version and document,
// schema_version 1, and document.type "doc" with a content array. It is
// deliberately shallow and never validates the rich draft grammar.
func validateRichFixtureEnvelope(value any) error {
	envelope, ok := value.(map[string]any)
	if !ok {
		return fmt.Errorf("%w: envelope is %T, not an object", errRichFixtureEnvelope, value)
	}
	if len(envelope) != 2 {
		return fmt.Errorf("%w: envelope has %d keys", errRichFixtureEnvelope, len(envelope))
	}
	if version, ok := envelope["schema_version"].(int64); !ok || version != richFixtureSchemaVersion {
		return fmt.Errorf("%w: schema_version is %v", errRichFixtureEnvelope, envelope["schema_version"])
	}
	document, ok := envelope["document"].(map[string]any)
	if !ok {
		return fmt.Errorf("%w: document is %T, not an object", errRichFixtureEnvelope, envelope["document"])
	}
	if document["type"] != "doc" {
		return fmt.Errorf("%w: document type is %v", errRichFixtureEnvelope, document["type"])
	}
	if _, ok := document["content"].([]any); !ok {
		return fmt.Errorf("%w: document content is %T, not an array", errRichFixtureEnvelope, document["content"])
	}
	return nil
}

func cloneRichFixtureDocument(doc fixtureDocument) fixtureDocument {
	clone := doc
	clone.Cases = make([]fixtureCase, len(doc.Cases))
	copy(clone.Cases, doc.Cases)
	return clone
}
