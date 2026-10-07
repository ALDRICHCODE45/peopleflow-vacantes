package draftrich_test

import (
	"bytes"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftrich"
)

func envelope(nodes ...any) map[string]any {
	return map[string]any{"schema_version": int64(1), "document": map[string]any{"type": "doc", "content": nodes}}
}
func paragraph(nodes ...any) map[string]any {
	p := map[string]any{"type": "paragraph"}
	if nodes != nil {
		p["content"] = nodes
	}
	return p
}
func text(s string) map[string]any { return map[string]any{"type": "text", "text": s} }
func link(href string) map[string]any {
	return map[string]any{"type": "link", "attrs": map[string]any{"href": href, "target": nil, "rel": nil, "class": nil, "title": nil}}
}

func TestValidateDocument(t *testing.T) {
	marked := text(" <>&é\u2028\u2029 e\u0301 ")
	marked["marks"] = []any{map[string]any{"type": "italic"}, map[string]any{"type": "bold"}, map[string]any{"type": "fontSizePreset", "attrs": map[string]any{"preset": "normal"}}, link("HTTPS://例え.テスト/a")}
	br := map[string]any{"type": "hardBreak", "marks": []any{link("https://xn--.com/")}}
	list := map[string]any{"type": "orderedList", "attrs": map[string]any{"start": int64(2147483647), "type": nil}, "content": []any{map[string]any{"type": "listItem", "content": []any{paragraph(text("one")), map[string]any{"type": "bulletList", "content": []any{map[string]any{"type": "listItem", "content": []any{paragraph(text("two"))}}}}}}}}
	cases := []struct {
		name  string
		input any
		plain string
	}{
		{"null", nil, ""}, {"empty paragraph", envelope(paragraph()), ""}, {"empty content", envelope(paragraph([]any{}...)), ""},
		{"marks and breaks", envelope(paragraph(marked, br, text("end")), paragraph()), " <>&é\u2028\u2029 e\u0301 \nend\n"},
		{"nested list", envelope(list), "one\ntwo"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before, _ := draftjson.EncodeValidatedValue(tc.input)
			got, err := draftrich.ValidateDocument(tc.input)
			if err != nil {
				t.Fatal(err)
			}
			if tc.input == nil {
				if got != nil {
					t.Fatal("null must return nil")
				}
				return
			}
			if got == nil || got.Plain != tc.plain || !bytes.Equal(got.Canonical, before) {
				t.Fatalf("got %#v, want plain %q canonical %s", got, tc.plain, before)
			}
			after, _ := draftjson.EncodeValidatedValue(tc.input)
			if !bytes.Equal(before, after) {
				t.Fatal("mutated input")
			}
		})
	}
}

func TestValidateDocumentRejects(t *testing.T) {
	cases := map[string]any{
		"typed nil": map[string]any(nil), "scalar": "x", "missing envelope": map[string]any{},
		"version":       map[string]any{"schema_version": int64(2), "document": map[string]any{}},
		"float version": map[string]any{"schema_version": float64(1), "document": map[string]any{}},
		"empty doc":     envelope([]any{}...), "nil content": envelope(),
		"inline at root": envelope(text("x")), "nested doc": envelope(envelope(paragraph())["document"]),
		"empty text": envelope(paragraph(text(""))), "invalid utf8": envelope(paragraph(text(string([]byte{255})))),
		"unknown node":    envelope(map[string]any{"type": "heading"}),
		"paragraph attrs": envelope(map[string]any{"type": "paragraph", "attrs": map[string]any{}}),
		"block marks":     envelope(map[string]any{"type": "paragraph", "marks": []any{}}),
		"text attrs":      envelope(paragraph(map[string]any{"type": "text", "text": "x", "attrs": nil})),
		"text content":    envelope(paragraph(map[string]any{"type": "text", "text": "x", "content": []any{}})),
		"break text":      envelope(paragraph(map[string]any{"type": "hardBreak", "text": "x"})),
		"empty list":      envelope(map[string]any{"type": "bulletList", "content": []any{}}),
		"list child":      envelope(map[string]any{"type": "bulletList", "content": []any{paragraph()}}),
		"item first":      envelope(map[string]any{"type": "bulletList", "content": []any{map[string]any{"type": "listItem", "content": []any{text("x")}}}}),
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := draftrich.ValidateDocument(input)
			if got != nil || err == nil {
				t.Fatalf("got %#v, %v", got, err)
			}
		})
	}
	got, err := draftrich.ValidateDocument(cases["version"])
	if got != nil || !errors.Is(err, draftrich.ErrDocumentVersion) {
		t.Fatalf("version error: %v", err)
	}
}

func TestValidateDocumentMarks(t *testing.T) {
	for _, mark := range []any{map[string]any{"type": "unknown"}, map[string]any{"type": "bold", "attrs": nil}, map[string]any{"type": "fontSizePreset", "attrs": map[string]any{"preset": "huge"}}, link("http://example.com"), link("https://user@example.com")} {
		t.Run("invalid mark", func(t *testing.T) {
			n := text("x")
			n["marks"] = []any{mark}
			got, err := draftrich.ValidateDocument(envelope(paragraph(n)))
			if got != nil || err == nil {
				t.Fatalf("accepted %#v", mark)
			}
		})
	}
	for _, marks := range []any{nil, []any(nil), "bold", []any{map[string]any{"type": "bold"}, map[string]any{"type": "bold"}}} {
		t.Run("invalid marks", func(t *testing.T) {
			n := text("x")
			n["marks"] = marks
			got, err := draftrich.ValidateDocument(envelope(paragraph(n)))
			if got != nil || err == nil {
				t.Fatal("accepted invalid marks")
			}
		})
	}
	for _, key := range []string{"href", "target", "rel", "class", "title"} {
		t.Run("missing "+key, func(t *testing.T) {
			m := link("https://example.com")
			delete(m["attrs"].(map[string]any), key)
			n := text("x")
			n["marks"] = []any{m}
			got, err := draftrich.ValidateDocument(envelope(paragraph(n)))
			if got != nil || err == nil {
				t.Fatal("accepted missing attr")
			}
		})
	}
	for _, tc := range []struct {
		key   string
		value any
		valid bool
	}{
		{"target", "_blank", true}, {"target", "_self", true}, {"target", "other", false},
		{"class", "enlace-externo", true}, {"class", "evil", false},
		{"rel", strings.Repeat(" ", 120) + "noopener", true}, {"rel", strings.Repeat(" ", 121) + "noopener", false},
		{"rel", "noopener noreferrer nofollow", true}, {"rel", "opener", false}, {"rel", "noopener\tnoreferrer", false},
		{"title", strings.Repeat("😀", 200), true}, {"title", strings.Repeat("😀", 201), false},
	} {
		t.Run(tc.key, func(t *testing.T) {
			m := link("https://example.com")
			m["attrs"].(map[string]any)[tc.key] = tc.value
			n := text("x")
			n["marks"] = []any{m}
			got, err := draftrich.ValidateDocument(envelope(paragraph(n)))
			if (err == nil) != tc.valid || (!tc.valid && got != nil) {
				t.Fatalf("got %v", err)
			}
		})
	}
	n := text("x")
	n["marks"] = []any{}
	in := envelope(paragraph(n))
	got, err := draftrich.ValidateDocument(in)
	want, _ := draftjson.EncodeValidatedValue(in)
	if err != nil || !bytes.Equal(got.Canonical, want) {
		t.Fatal("empty marks not preserved")
	}
}

func TestValidateDocumentLimits(t *testing.T) {
	for _, count := range []int{1999, 2000} {
		t.Run("nodes", func(t *testing.T) {
			nodes := make([]any, count)
			for i := range nodes {
				nodes[i] = paragraph()
			}
			got, err := draftrich.ValidateDocument(envelope(nodes...))
			if (err == nil) != (count == 1999) || (err != nil && got != nil) {
				t.Fatalf("count %d: %v", count, err)
			}
		})
	}
	for _, depth := range []int{16, 17} {
		t.Run("depth", func(t *testing.T) {
			var node any = paragraph()
			if depth == 17 {
				node = paragraph(text("depth 17"))
			}
			for d := 15; d >= 2; d-- {
				if d%2 == 0 {
					node = map[string]any{"type": "bulletList", "content": []any{node}}
				} else {
					node = map[string]any{"type": "listItem", "content": []any{paragraph(), node}}
				}
			}
			got, err := draftrich.ValidateDocument(envelope(node))
			if depth == 16 && err != nil {
				t.Fatal(err)
			}
			if depth == 17 && (err == nil || got != nil) {
				t.Fatal("depth accepted")
			}
		})
	}
	base := envelope(paragraph(text("x")))
	encoded, _ := draftjson.EncodeValidatedValue(base)
	overhead := len(encoded) - 1
	for _, size := range []int{65536, 65537} {
		t.Run("bytes", func(t *testing.T) {
			got, err := draftrich.ValidateDocument(envelope(paragraph(text(strings.Repeat("x", size-overhead)))))
			if (err == nil) != (size == 65536) || (err != nil && got != nil) {
				t.Fatalf("size %d: %v", size, err)
			}
		})
	}
	cycle := map[string]any{"type": "bulletList"}
	cycle["content"] = []any{map[string]any{"type": "listItem", "content": []any{paragraph(), cycle}}}
	if got, err := draftrich.ValidateDocument(envelope(cycle)); got != nil || err == nil {
		t.Fatal("cycle accepted")
	}
}

func TestValidateDocumentStrictAttributes(t *testing.T) {
	for _, start := range []any{int64(0), int64(1), int64(2147483647), int64(2147483648), float64(1), nil} {
		t.Run("ordered start", func(t *testing.T) {
			list := map[string]any{"type": "orderedList", "attrs": map[string]any{"start": start, "type": nil}, "content": []any{map[string]any{"type": "listItem", "content": []any{paragraph()}}}}
			got, err := draftrich.ValidateDocument(envelope(list))
			valid := start == int64(1) || start == int64(2147483647)
			if (err == nil) != valid || (!valid && (got != nil || !errors.Is(err, draftrich.ErrInvalidDocument))) {
				t.Fatalf("start %v: %v", start, err)
			}
		})
	}
	for _, where := range []string{"envelope", "node", "mark", "attrs"} {
		t.Run("unknown "+where, func(t *testing.T) {
			mark := link("https://example.com")
			n := text("x")
			n["marks"] = []any{mark}
			in := envelope(paragraph(n))
			targets := map[string]map[string]any{"envelope": in, "node": n, "mark": mark, "attrs": mark["attrs"].(map[string]any)}
			targets[where]["unknown"] = nil
			before, _ := draftjson.EncodeValidatedValue(in)
			got, err := draftrich.ValidateDocument(in)
			after, _ := draftjson.EncodeValidatedValue(in)
			if got != nil || !errors.Is(err, draftrich.ErrInvalidDocument) || !bytes.Equal(before, after) {
				t.Fatalf("invalid rejection %v", err)
			}
		})
	}
	n := text("x")
	n["marks"] = []any{map[string]any{"type": "bold"}, map[string]any{"type": "italic"}, map[string]any{"type": "fontSizePreset", "attrs": map[string]any{"preset": "small"}}, link("https://example.com"), map[string]any{"type": "bold"}}
	if got, err := draftrich.ValidateDocument(envelope(paragraph(n))); got != nil || !errors.Is(err, draftrich.ErrInvalidDocument) {
		t.Fatal("five marks accepted")
	}
}

func TestValidateDocumentIndependentBytes(t *testing.T) {
	in := envelope(paragraph(text("before")))
	got, err := draftrich.ValidateDocument(in)
	if err != nil {
		t.Fatal(err)
	}
	saved := append([]byte(nil), got.Canonical...)
	in["document"].(map[string]any)["content"] = []any{paragraph(text("after"))}
	if !reflect.DeepEqual(saved, got.Canonical) || got.Plain != "before" {
		t.Fatal("output aliases input")
	}
}
