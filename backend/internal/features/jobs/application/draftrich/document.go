package draftrich

import (
	"errors"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
)

// ErrInvalidDocument indicates invalid grammar, attributes or resource limits.
var ErrInvalidDocument = errors.New("invalid rich document")

// ErrDocumentVersion lets an HTTP adapter distinguish unsupported schema versions.
var ErrDocumentVersion = errors.New("unsupported rich document version")

// Document owns the canonical description envelope and its derived plain text.
// A nil *Document represents a null description, not an empty paragraph.
type Document struct {
	Canonical []byte
	Plain     string
}

// ValidateDocument validates decoded draftjson values without mutating them.
// Numbers must be int64. Unknown keys are rejected; strings and array order are
// preserved. Callers must enforce request-body limits before decoding and must
// not mutate the input concurrently. No HTML rendering or persistence occurs.
func ValidateDocument(value any) (*Document, error) {
	if value == nil {
		return nil, nil
	}
	m, ok := value.(map[string]any)
	if !ok || !documentKeys(m, "schema_version", "document") || len(m) != 2 {
		return nil, ErrInvalidDocument
	}
	version, ok := m["schema_version"].(int64)
	if !ok || version != 1 {
		return nil, ErrDocumentVersion
	}
	nodes := 0
	if !validateNode(m["document"], "", 0, 1, &nodes) {
		return nil, ErrInvalidDocument
	}
	canonical, err := draftjson.EncodeValidatedValue(value)
	if err != nil || len(canonical) > 65536 {
		return nil, ErrInvalidDocument
	}
	// Extraction only runs after the entire tree and its byte budget are valid.
	plain := documentPlain(m["document"].(map[string]any))
	if len(plain) > 65536 {
		return nil, ErrInvalidDocument
	}
	return &Document{Canonical: canonical, Plain: plain}, nil
}

func documentKeys(m map[string]any, allowed ...string) bool {
	if m == nil || len(m) > len(allowed) {
		return false
	}
	for key := range m {
		if !slices.Contains(allowed, key) {
			return false
		}
	}
	return true
}

func validateNode(value any, parent string, index, depth int, nodes *int) bool {
	if depth > 16 || *nodes >= 2000 {
		return false
	}
	*nodes++
	m, ok := value.(map[string]any)
	if !ok || m == nil {
		return false
	}
	kind, ok := m["type"].(string)
	if !ok {
		return false
	}
	switch parent {
	case "":
		if kind != "doc" {
			return false
		}
	case "doc":
		if !slices.Contains([]string{"paragraph", "bulletList", "orderedList"}, kind) {
			return false
		}
	case "paragraph":
		if kind != "text" && kind != "hardBreak" {
			return false
		}
	case "bulletList", "orderedList":
		if kind != "listItem" {
			return false
		}
	case "listItem":
		if index == 0 && kind != "paragraph" {
			return false
		}
		if !slices.Contains([]string{"paragraph", "bulletList", "orderedList"}, kind) {
			return false
		}
	default:
		return false
	}
	switch kind {
	case "text":
		if !documentKeys(m, "type", "text", "marks") {
			return false
		}
		s, ok := m["text"].(string)
		if !ok || s == "" || len(s) > 65536 || !utf8.ValidString(s) {
			return false
		}
		return validateMarks(m)
	case "hardBreak":
		return documentKeys(m, "type", "marks") && validateMarks(m)
	case "orderedList":
		if !documentKeys(m, "type", "attrs", "content") {
			return false
		}
		attrs, ok := m["attrs"].(map[string]any)
		if !ok || !documentKeys(attrs, "start", "type") || len(attrs) != 2 || attrs["type"] != nil {
			return false
		}
		start, ok := attrs["start"].(int64)
		if !ok || start < 1 || start > 2147483647 {
			return false
		}
	default:
		if !documentKeys(m, "type", "content") {
			return false
		}
	}
	raw, present := m["content"]
	if !present {
		return kind == "paragraph"
	}
	children, ok := raw.([]any)
	if !ok || children == nil || len(children) > 2000-*nodes {
		return false
	}
	if len(children) == 0 && kind != "paragraph" {
		return false
	}
	for i, child := range children {
		if !validateNode(child, kind, i, depth+1, nodes) {
			return false
		}
	}
	return true
}

func validateMarks(node map[string]any) bool {
	raw, present := node["marks"]
	if !present {
		return true
	}
	marks, ok := raw.([]any)
	if !ok || marks == nil || len(marks) > 4 {
		return false
	}
	seen := make(map[string]bool, 4)
	for _, raw := range marks {
		mark, ok := raw.(map[string]any)
		if !ok || mark == nil {
			return false
		}
		kind, ok := mark["type"].(string)
		if !ok || seen[kind] {
			return false
		}
		seen[kind] = true
		switch kind {
		case "bold", "italic":
			if !documentKeys(mark, "type") {
				return false
			}
		case "fontSizePreset":
			if !documentKeys(mark, "type", "attrs") || len(mark) != 2 {
				return false
			}
			attrs, ok := mark["attrs"].(map[string]any)
			if !ok || !documentKeys(attrs, "preset") || len(attrs) != 1 {
				return false
			}
			preset, ok := attrs["preset"].(string)
			if !ok || !slices.Contains([]string{"small", "normal", "large"}, preset) {
				return false
			}
		case "link":
			if !documentKeys(mark, "type", "attrs") || len(mark) != 2 {
				return false
			}
			attrs, ok := mark["attrs"].(map[string]any)
			if !ok || !validateLinkAttrs(attrs) {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func validateLinkAttrs(attrs map[string]any) bool {
	if !documentKeys(attrs, "href", "target", "rel", "class", "title") || len(attrs) != 5 {
		return false
	}
	href, ok := attrs["href"].(string)
	if !ok {
		return false
	}
	if _, err := ValidateHref(href); err != nil {
		return false
	}
	if !nullableChoice(attrs["target"], "_blank", "_self") || !nullableChoice(attrs["class"], "enlace-externo") {
		return false
	}
	if attrs["title"] != nil {
		s, ok := attrs["title"].(string)
		if !ok || len(s) > 800 || !utf8.ValidString(s) || utf8.RuneCountInString(s) > 200 {
			return false
		}
	}
	if attrs["rel"] != nil {
		s, ok := attrs["rel"].(string)
		if !ok || len(s) > 128 {
			return false
		}
		for _, token := range strings.Split(s, " ") {
			if token != "" && !slices.Contains([]string{"noopener", "noreferrer", "nofollow"}, token) {
				return false
			}
		}
	}
	return true
}

func nullableChoice(value any, choices ...string) bool {
	if value == nil {
		return true
	}
	s, ok := value.(string)
	return ok && slices.Contains(choices, s)
}

// documentPlain receives only an already validated bounded tree.
func documentPlain(node map[string]any) string {
	kind := node["type"].(string)
	if kind == "text" {
		return node["text"].(string)
	}
	if kind == "hardBreak" {
		return "\n"
	}
	children, _ := node["content"].([]any)
	var out strings.Builder
	for i, child := range children {
		if i > 0 && kind != "paragraph" {
			out.WriteByte('\n')
		}
		out.WriteString(documentPlain(child.(map[string]any)))
	}
	return out.String()
}
