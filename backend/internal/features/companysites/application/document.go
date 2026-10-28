// Package application owns the careers-site document grammar and persistence port.
package application

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

type Field = httpjson.ValidationField
type MediaRef struct {
	ID    string
	Kind  string
	Field string
}
type LocationRef struct {
	Value map[string]any
	Field string
}
type Document struct {
	Canonical  json.RawMessage
	Value      map[string]any
	Media      []MediaRef
	Locations  []LocationRef
	StoryPlain map[string]string
}

type blockRule struct {
	variants         []string
	strings          map[string]int
	special          []string
	itemStrings      map[string]int
	itemSpecial      []string
	maximum, minimum int
	required         []string
}

var rules = map[string]blockRule{
	"hero":         {variants: []string{"photo", "split", "centered"}, strings: map[string]int{"title": 80, "subtitle": 200}, special: []string{"cover"}},
	"story":        {variants: []string{"text", "text_image"}, strings: map[string]int{"title": 80}, special: []string{"body", "image"}},
	"values":       {variants: []string{"grid", "list"}, strings: map[string]int{"mission": 300}, itemStrings: map[string]int{"title": 60, "description": 240}, itemSpecial: []string{"icon"}, maximum: 8, minimum: 1, required: []string{"title"}},
	"benefits":     {variants: []string{"grid", "compact"}, itemStrings: map[string]int{"title": 60, "description": 160}, itemSpecial: []string{"icon"}, maximum: 24, minimum: 1, required: []string{"title"}},
	"stats":        {variants: []string{"row", "cards"}, itemStrings: map[string]int{"value": 12, "label": 60}, maximum: 6, minimum: 1, required: []string{"value", "label"}},
	"process":      {variants: []string{"steps", "timeline"}, itemStrings: map[string]int{"title": 60, "description": 200, "duration": 30}, maximum: 8, minimum: 2, required: []string{"title"}},
	"gallery":      {variants: []string{"grid", "mosaic", "carousel"}, itemStrings: map[string]int{"alt": 160, "caption": 120}, itemSpecial: []string{"image"}, maximum: 12, minimum: 2, required: []string{"image", "alt"}},
	"testimonials": {variants: []string{"cards", "quote"}, itemStrings: map[string]int{"quote": 400, "name": 80, "role": 80}, itemSpecial: []string{"photo", "consent"}, maximum: 6, minimum: 1, required: []string{"quote", "name", "consent"}},
	"video":        {variants: []string{"wide", "split"}, strings: map[string]int{"title": 80, "description": 200}, special: []string{"video"}},
	"offices":      {variants: []string{"list", "cards"}, itemStrings: map[string]int{"name": 80, "address": 200, "map_url": 500}, itemSpecial: []string{"location"}, maximum: 20, minimum: 1, required: []string{"name", "location"}},
	"jobs":         {variants: []string{"list", "cards", "by_area"}, strings: map[string]int{"title": 80, "intro": 200}},
	"faq":          {variants: []string{"accordion", "two_columns"}, itemStrings: map[string]int{"question": 160, "answer": 1000}, maximum: 20, minimum: 1, required: []string{"question", "answer"}},
	"closing":      {variants: []string{"banner", "simple"}, strings: map[string]int{"title": 80, "text": 240}},
}
var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
var colorPattern = regexp.MustCompile(`^#[a-fA-F0-9]{6}$`)
var youtubePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
var vimeoPattern = regexp.MustCompile(`^[0-9]{1,12}$`)
var icons = strings.Fields("heart users rocket target lightbulb shield leaf globe graduation-cap briefcase laptop clock calendar coffee dumbbell stethoscope piggy-bank gift plane home sparkles handshake trophy smile")

func SlugReason(s string) string {
	if len(s) < 3 || len(s) > 60 || !slugPattern.MatchString(s) {
		return "invalid"
	}
	if slices.Contains(strings.Fields("admin api empresa empresas vacantes candidato login nuevo nueva peopleflow soporte ayuda"), s) {
		return "reserved"
	}
	return ""
}
func DefaultDocument() json.RawMessage {
	m := map[string]any{"slug": nil, "theme": map[string]any{"brand_color": "#7835DB", "font_pair": "classic"}, "seo": map[string]any{"title": nil, "description": nil}, "blocks": []any{map[string]any{"id": uuid.NewString(), "type": "hero", "variant": "photo", "hidden": false, "content": map[string]any{"title": nil, "subtitle": nil, "cover": nil}}, map[string]any{"id": uuid.NewString(), "type": "jobs", "variant": "list", "hidden": false, "content": map[string]any{"title": nil, "intro": nil}}}}
	b, _ := json.Marshal(m)
	return b
}

// Decode and ValidateRich are capabilities supplied by the composition root.
type Decode func([]byte) (any, error)
type RichDocument struct {
	Canonical []byte
	Plain     string
}
type ValidateRich func(any) (*RichDocument, error)
type Validator struct{ rich ValidateRich }

func NewValidator(rich ValidateRich) *Validator { return &Validator{rich: rich} }

type validator struct {
	fields []Field
	doc    Document
	rich   ValidateRich
}

func (v *validator) fail(p, c string) { v.fields = append(v.fields, Field{Field: p, Code: c}) }
func path(p, k string) string {
	if p == "" {
		return k
	}
	return p + "." + k
}
func (v *validator) object(x any, p string, keys []string) map[string]any {
	m, ok := x.(map[string]any)
	if !ok || m == nil {
		v.fail(p, "required")
		return map[string]any{}
	}
	for k := range m {
		if !slices.Contains(keys, k) {
			v.fail(path(p, k), "unknown_key")
		}
	}
	return m
}
func (v *validator) text(m map[string]any, k, p string, max int) {
	x := m[k]
	if x == nil {
		m[k] = nil
		return
	}
	s, ok := x.(string)
	if !ok {
		v.fail(path(p, k), "invalid")
		return
	}
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > max {
		v.fail(path(p, k), "too_long")
	}
	if s == "" {
		m[k] = nil
	} else {
		m[k] = s
	}
}
func text(m map[string]any, k string) string { s, _ := m[k].(string); return s }
func (v *validator) enum(m map[string]any, k, p string, allowed []string, optional bool) {
	v.text(m, k, p, 100)
	if m[k] == nil && optional {
		return
	}
	if !slices.Contains(allowed, text(m, k)) {
		v.fail(path(p, k), "invalid")
	}
}
func keys(limits map[string]int, special []string) []string {
	out := slices.Clone(special)
	for k := range limits {
		out = append(out, k)
	}
	return out
}
func (v *validator) media(m map[string]any, k, p, kind string) {
	if m[k] == nil {
		m[k] = nil
		return
	}
	q := path(p, k)
	ref := v.object(m[k], q, []string{"media_id"})
	v.text(ref, "media_id", q, 36)
	s := text(ref, "media_id")
	id, err := uuid.Parse(s)
	if err != nil || len(s) != 36 {
		v.fail(q+".media_id", "invalid")
		return
	}
	ref["media_id"] = id.String()
	v.doc.Media = append(v.doc.Media, MediaRef{id.String(), kind, q})
}
func (v *validator) content(m map[string]any, p, kind string, limits map[string]int, special []string) {
	for k, max := range limits {
		v.text(m, k, p, max)
	}
	for _, k := range special {
		switch k {
		case "cover":
			v.media(m, k, p, "cover")
		case "image":
			mediaKind := "story"
			if kind == "gallery" {
				mediaKind = "gallery"
			}
			v.media(m, k, p, mediaKind)
		case "photo":
			v.media(m, k, p, "portrait")
		case "icon":
			v.enum(m, k, p, icons, true)
		case "consent":
			if x, exists := m[k]; exists {
				if _, ok := x.(bool); !ok {
					v.fail(path(p, k), "invalid")
				}
			}
		case "body":
			if m[k] == nil {
				m[k] = nil
				continue
			}
			if v.rich == nil {
				v.fail(path(p, k), "invalid")
				continue
			}
			r, err := v.rich(m[k])
			if err != nil {
				v.fail(path(p, k), "invalid")
			} else if r != nil {
				if utf8.RuneCountInString(r.Plain) > 5000 {
					v.fail(path(p, k), "too_long")
				}
				m[k] = json.RawMessage(r.Canonical)
				v.doc.StoryPlain[p] = r.Plain
			} else {
				m[k] = nil
			}
		case "video":
			if m[k] == nil {
				m[k] = nil
				continue
			}
			q := path(p, k)
			a := v.object(m[k], q, []string{"provider", "video_id"})
			v.enum(a, "provider", q, []string{"youtube", "vimeo"}, false)
			v.text(a, "video_id", q, 12)
			id := text(a, "video_id")
			if (text(a, "provider") == "youtube" && !youtubePattern.MatchString(id)) || (text(a, "provider") == "vimeo" && !vimeoPattern.MatchString(id)) {
				v.fail(q+".video_id", "invalid")
			}
		case "location":
			if m[k] == nil {
				m[k] = nil
				continue
			}
			q := path(p, k)
			a := v.object(m[k], q, []string{"country", "state", "municipality", "postal_code"})
			for _, key := range []string{"country", "state", "municipality", "postal_code"} {
				v.text(a, key, q, 20)
			}
			if a["country"] == nil && a["state"] == nil && a["municipality"] == nil && a["postal_code"] == nil {
				m[k] = nil
			} else {
				v.doc.Locations = append(v.doc.Locations, LocationRef{a, q})
			}
		}
	}
	if s := text(m, "map_url"); s != "" {
		u, err := url.Parse(s)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
			v.fail(path(p, "map_url"), "invalid")
		}
	}
}

// ValidateDocument is pure: it never accesses storage and returns a canonical
// document only when grammar is valid. Catalog and ownership checks use refs.
func (validatorPort *Validator) ValidateDocument(value any) (*Document, []Field) {
	// Validation normalizes the caller-owned decoded input in place.
	v := &validator{rich: validatorPort.rich, doc: Document{StoryPlain: map[string]string{}}}
	m := v.object(value, "", []string{"slug", "theme", "seo", "blocks"})
	v.text(m, "slug", "", 60)
	if s := text(m, "slug"); s != "" && SlugReason(s) == "invalid" {
		v.fail("slug", "invalid")
	}
	theme := v.object(m["theme"], "theme", []string{"brand_color", "font_pair"})
	v.text(theme, "brand_color", "theme", 7)
	if !colorPattern.MatchString(text(theme, "brand_color")) {
		v.fail("theme.brand_color", "invalid")
	}
	if s := text(theme, "brand_color"); s != "" {
		theme["brand_color"] = strings.ToUpper(s)
	}
	v.enum(theme, "font_pair", "theme", []string{"classic", "editorial", "modern"}, false)
	seo := v.object(m["seo"], "seo", []string{"title", "description"})
	v.text(seo, "title", "seo", 60)
	v.text(seo, "description", "seo", 160)
	blocks, ok := m["blocks"].([]any)
	if !ok || len(blocks) < 2 {
		v.fail("blocks", "required")
	}
	if len(blocks) > 30 {
		v.fail("blocks", "too_long")
	}
	counts := map[string]int{}
	ids := map[string]bool{}
	for i, x := range blocks {
		p := fmt.Sprintf("blocks[%d]", i)
		b := v.object(x, p, []string{"id", "type", "variant", "hidden", "content"})
		v.text(b, "id", p, 36)
		id, err := uuid.Parse(text(b, "id"))
		if err != nil || len(text(b, "id")) != 36 {
			v.fail(p+".id", "invalid")
		} else {
			b["id"] = id.String()
			if ids[id.String()] {
				v.fail(p+".id", "duplicate")
			}
			ids[id.String()] = true
		}
		v.text(b, "type", p, 20)
		kind := text(b, "type")
		rule, exists := rules[kind]
		if !exists {
			v.fail(p+".type", "invalid")
			continue
		}
		counts[kind]++
		v.enum(b, "variant", p, rule.variants, false)
		hidden, ok := b["hidden"].(bool)
		if !ok {
			v.fail(p+".hidden", "invalid")
		}
		if (kind == "hero" || kind == "jobs") && hidden {
			v.fail(p+".hidden", "not_allowed")
		}
		allowed := keys(rule.strings, rule.special)
		if rule.maximum > 0 {
			allowed = append(allowed, "items")
		}
		c := v.object(b["content"], p+".content", allowed)
		v.content(c, p+".content", kind, rule.strings, rule.special)
		if rule.maximum > 0 {
			items, ok := c["items"].([]any)
			if c["items"] == nil {
				items = []any{}
				c["items"] = items
			} else if !ok {
				v.fail(p+".content.items", "invalid")
			}
			if len(items) > rule.maximum {
				v.fail(p+".content.items", "too_long")
			}
			for j, x := range items {
				q := fmt.Sprintf("%s.content.items[%d]", p, j)
				a := v.object(x, q, keys(rule.itemStrings, rule.itemSpecial))
				v.content(a, q, kind, rule.itemStrings, rule.itemSpecial)
			}
		}
	}
	for _, kind := range []string{"hero", "jobs"} {
		if counts[kind] == 0 {
			v.fail("blocks", "required")
		} else if counts[kind] > 1 {
			v.fail("blocks", "duplicate")
		}
	}
	sort.Slice(v.fields, func(i, j int) bool {
		if v.fields[i].Field == v.fields[j].Field {
			return v.fields[i].Code < v.fields[j].Code
		}
		return v.fields[i].Field < v.fields[j].Field
	})
	v.fields = slices.Compact(v.fields)
	if len(v.fields) > 0 {
		return nil, v.fields
	}
	v.doc.Value = m
	v.doc.Canonical, _ = json.Marshal(m)
	return &v.doc, nil
}

type Issue = httpjson.SitePublishIssue

func PublishIssues(doc *Document, companyLogo, companyName bool) []Issue {
	out := []Issue{}
	add := func(code, p string) {
		var f *string
		if p != "" {
			f = &p
		}
		out = append(out, Issue{Code: code, Field: f})
	}
	m := doc.Value
	if text(m, "slug") == "" {
		add("slug_missing", "slug")
	}
	contentBlock := false
	for i, x := range m["blocks"].([]any) {
		b := x.(map[string]any)
		if b["hidden"] == true {
			continue
		}
		kind := text(b, "type")
		c := b["content"].(map[string]any)
		p := fmt.Sprintf("blocks[%d]", i)
		if kind == "hero" {
			if text(c, "title") == "" {
				add("hero_title_missing", p)
			}
			continue
		}
		if kind == "jobs" {
			continue
		}
		contentBlock = true
		complete := true
		rule := rules[kind]
		switch kind {
		case "story":
			complete = strings.TrimSpace(doc.StoryPlain[p+".content"]) != ""
		case "video":
			complete = c["video"] != nil
		case "closing":
			complete = text(c, "title") != ""
		default:
			items, _ := c["items"].([]any)
			complete = len(items) >= rule.minimum && len(items) <= rule.maximum
			for _, x := range items {
				a := x.(map[string]any)
				for _, k := range rule.required {
					switch k {
					case "image":
						complete = complete && a[k] != nil
					case "location":
						loc, _ := a[k].(map[string]any)
						complete = complete && text(loc, "country") != ""
					case "consent":
						complete = complete && a[k] == true
					default:
						complete = complete && text(a, k) != ""
					}
				}
			}
		}
		if !complete {
			add("block_incomplete", p)
		}
	}
	if !contentBlock {
		add("no_content_block", "")
	}
	if !companyLogo {
		add("company_logo_missing", "")
	}
	if !companyName {
		add("company_name_missing", "")
	}
	return out
}
