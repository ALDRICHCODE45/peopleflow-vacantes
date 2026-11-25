package application

import (
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"

	"github.com/google/uuid"
)

// Sections v2 (contract §2.3): per-block style, hero buttons and collage
// images, testimonial video URLs and the areas overrides.
//
// Wire rule (deployment order): keys added to existing envelopes and types
// (`style`, the hero keys, `video_url`) are never inserted into a document
// that lacks them, on save or on read; absent means "use the default" and the
// validation and publish logic below treat it that way. New block types are
// normalized like every other block.

// ProfessionalAreas copies the vacancy `professional_area` literals
// (jobs draftfields). Slices never import each other; cmd/api pins parity.
var ProfessionalAreas = []string{
	"technology_systems",
	"engineering",
	"product",
	"design_creative",
	"sales_business_development",
	"marketing_communications",
	"administration_finance",
	"human_resources",
	"operations_production",
	"logistics_transport",
	"customer_service_support",
	"healthcare",
	"education_training",
	"legal",
	"construction_maintenance",
	"tourism_hospitality_gastronomy",
}

const (
	maxHeroImages     = 3
	minCollageImages  = 2
	maxButtonLabel    = 24
	maxAreaOverrides  = 16
	maxVideoURLLength = 500
)

var (
	styleKeys        = []string{"background", "spacing", "align", "overlay", "image"}
	styleBackgrounds = []string{"default", "tint", "brand", "image"}
	styleSpacings    = []string{"compact", "airy"}
	styleAligns      = []string{"center", "start"}
	styleOverlays    = []string{"soft", "medium", "strong"}
	youtubeVideoPath = regexp.MustCompile(`^/(?:embed|shorts)/([^/]+)/?$`)
	youtuBePath      = regexp.MustCompile(`^/([^/]+)/?$`)
	vimeoPath        = regexp.MustCompile(`^/(\d+)/?$`)
	vimeoPlayerPath  = regexp.MustCompile(`^/video/(\d+)/?$`)
)

// DefaultStyle is what an absent `style` (or an absent key inside it) means.
func DefaultStyle() map[string]any {
	return map[string]any{"background": "default", "spacing": "airy", "align": "start", "overlay": nil, "image": nil}
}

// style validates the optional block envelope key. Absent stays absent; null
// is dropped (same meaning); a present object fills only its missing keys.
func (v *validator) style(b map[string]any, p string) {
	x, exists := b["style"]
	if !exists {
		return
	}
	if x == nil {
		delete(b, "style")
		return
	}
	q := path(p, "style")
	s, ok := x.(map[string]any)
	if !ok {
		v.fail(q, "invalid")
		return
	}
	for k := range s {
		if !slices.Contains(styleKeys, k) {
			v.fail(path(q, k), "unknown_key")
		}
	}
	defaults := DefaultStyle()
	for _, rule := range []struct {
		key     string
		allowed []string
	}{{"background", styleBackgrounds}, {"spacing", styleSpacings}, {"align", styleAligns}} {
		if _, exists := s[rule.key]; !exists {
			s[rule.key] = defaults[rule.key]
			continue
		}
		v.enum(s, rule.key, q, rule.allowed, false)
	}
	v.enum(s, "overlay", q, styleOverlays, true)
	if text(s, "background") != "image" {
		if s["overlay"] != nil {
			v.fail(path(q, "overlay"), "not_allowed")
		}
		if s["image"] != nil {
			v.fail(path(q, "image"), "not_allowed")
		}
		if s["image"] == nil {
			s["image"] = nil
		}
		return
	}
	// A missing image with background "image" is a publish issue, not a save error.
	v.media(s, "image", q, "cover")
}

// heroField validates the hero keys added by sections v2; absent stays absent.
func (v *validator) heroField(m map[string]any, k, p string) {
	if _, exists := m[k]; !exists {
		return
	}
	switch k {
	case "primary_label", "secondary_label":
		v.text(m, k, p, maxButtonLabel)
	case "secondary_visible":
		if _, ok := m[k].(bool); !ok {
			v.fail(path(p, k), "invalid")
		}
	case "secondary_target":
		x := m[k]
		if x == nil {
			return
		}
		s, ok := x.(string)
		id, err := uuid.Parse(s)
		if !ok || err != nil || len(s) != 36 {
			v.fail(path(p, k), "invalid")
			return
		}
		m[k] = id.String()
	case "images":
		v.mediaList(m, k, p, maxHeroImages, "gallery")
	}
}

// mediaList validates a list of non-null media refs; null reads as [].
func (v *validator) mediaList(m map[string]any, k, p string, max int, kind string) {
	q := path(p, k)
	if m[k] == nil {
		m[k] = []any{}
		return
	}
	list, ok := m[k].([]any)
	if !ok {
		v.fail(q, "invalid")
		return
	}
	if len(list) > max {
		v.fail(q, "too_long")
	}
	for i, x := range list {
		field := fmt.Sprintf("%s[%d]", q, i)
		if x == nil {
			v.fail(field, "required")
			continue
		}
		v.mediaRef(x, field, kind)
	}
}

// videoURL validates a testimonial `video_url` exactly as the editor parses a
// video block URL (known YouTube/Vimeo share and embed paths only).
func (v *validator) videoURL(m map[string]any, k, p string) {
	if _, exists := m[k]; !exists {
		return
	}
	v.text(m, k, p, maxVideoURLLength)
	if s := text(m, k); s != "" && !validVideoURL(s) {
		v.fail(path(p, k), "invalid")
	}
}

func validVideoURL(input string) bool {
	u, err := url.Parse(strings.TrimSpace(input))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.Port() != "" {
		return false
	}
	match := func(re *regexp.Regexp) string {
		if m := re.FindStringSubmatch(u.Path); m != nil {
			return m[1]
		}
		return ""
	}
	switch strings.ToLower(u.Hostname()) {
	case "youtube.com", "www.youtube.com":
		id := match(youtubeVideoPath)
		if u.Path == "/watch" {
			id = u.Query().Get("v")
		}
		return youtubePattern.MatchString(strings.TrimSpace(id))
	case "youtu.be":
		return youtubePattern.MatchString(strings.TrimSpace(match(youtuBePath)))
	case "vimeo.com", "www.vimeo.com":
		return vimeoPattern.MatchString(match(vimeoPath))
	case "player.vimeo.com":
		return vimeoPattern.MatchString(match(vimeoPlayerPath))
	}
	return false
}

// secondaryTarget must name another block of the document. Stored reads (and
// the public projection, which drops hidden blocks) fall back to null.
func (v *validator) secondaryTarget(hero map[string]any, p, heroID string, ids map[string]bool) {
	target := text(hero, "secondary_target")
	if target == "" || (ids[target] && target != heroID) {
		return
	}
	if v.stored {
		hero["secondary_target"] = nil
		return
	}
	v.fail(path(p, "secondary_target"), "invalid")
}

// areaOverrides validates `areas.content.overrides`: up to 16 objects with a
// catalog `key`, unique within the block, and exactly one of icon or photo.
func (v *validator) areaOverrides(m map[string]any, p string) {
	q := path(p, "overrides")
	if m["overrides"] == nil {
		m["overrides"] = []any{}
		return
	}
	list, ok := m["overrides"].([]any)
	if !ok {
		v.fail(q, "invalid")
		return
	}
	if len(list) > maxAreaOverrides {
		v.fail(q, "too_long")
	}
	seen := map[string]bool{}
	for i, x := range list {
		field := fmt.Sprintf("%s[%d]", q, i)
		a := v.object(x, field, []string{"key", "icon", "photo"})
		v.text(a, "key", field, 100)
		key := text(a, "key")
		switch {
		case a["key"] == nil:
			v.fail(path(field, "key"), "required")
		case !slices.Contains(ProfessionalAreas, key):
			v.fail(path(field, "key"), "invalid")
		case seen[key]:
			v.fail(path(field, "key"), "duplicate")
		default:
			seen[key] = true
		}
		v.enum(a, "icon", field, icons, true)
		v.media(a, "photo", field, "gallery")
		if a["icon"] != nil && a["photo"] != nil {
			v.fail(path(field, "photo"), "not_allowed")
		} else if a["icon"] == nil && a["photo"] == nil {
			v.fail(path(field, "icon"), "required")
		}
	}
}

// heroIssues are the hero publish issues added by sections v2. Absent keys
// carry their defaults: secondary_visible true, images [].
func heroIssues(b map[string]any, blocks []any, p string, add func(string, string)) {
	c := b["content"].(map[string]any)
	switch text(b, "variant") {
	case "background_loop":
		// Slice B adds the uploaded video; until then the variant cannot publish.
		add("hero_video_missing", p)
	case "collage":
		if images, _ := c["images"].([]any); len(images) < minCollageImages {
			add("hero_collage_images_missing", p)
		}
	}
	target := text(c, "secondary_target")
	if visible, ok := c["secondary_visible"].(bool); (ok && !visible) || target == "" {
		return
	}
	for _, x := range blocks {
		if other := x.(map[string]any); text(other, "id") == target && other["hidden"] == true {
			add("secondary_target_hidden", path(p, "content.secondary_target"))
		}
	}
}

// styleIssues: background "image" needs its image to publish.
func styleIssues(b map[string]any, p string, add func(string, string)) {
	if s, ok := b["style"].(map[string]any); ok && text(s, "background") == "image" && s["image"] == nil {
		add("style_image_missing", path(p, "style.image"))
	}
}
