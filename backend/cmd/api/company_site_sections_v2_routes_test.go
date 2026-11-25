package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	roles "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	siteshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/infrastructure/http"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftfields"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/google/uuid"
)

// siteV2Store keeps one stored draft and mirrors the Postgres store contract the
// handler relies on: reads re-validate the stored bytes in stored mode, saves
// check media ownership by kind and are no-ops for identical canonical bytes,
// publish runs PublishIssues on the stored draft.
type siteV2Store struct {
	t         *testing.T
	draft     []byte
	version   int64
	published []byte
	media     map[string]string
	saves     int
}

func (s *siteV2Store) current() (app.Current, error) {
	value, err := draftjson.Decode(s.draft)
	if err != nil {
		return app.Current{}, err
	}
	doc, fields := companySiteValidator().ValidateStoredDocument(value)
	if len(fields) > 0 {
		return app.Current{}, fmt.Errorf("stored invalid: %v", fields)
	}
	return app.Current{Draft: doc.Canonical, DraftVersion: s.version, Media: []app.Media{}}, nil
}
func (s *siteV2Store) Get(context.Context, uuid.UUID, uuid.UUID) (app.Current, error) {
	return s.current()
}
func (s *siteV2Store) Save(_ context.Context, _, _ uuid.UUID, version int64, doc *app.Document) (app.Current, error) {
	current, err := s.current()
	if err != nil || version != s.version {
		return current, app.ErrVersionConflict
	}
	fields := []app.Field{}
	for _, ref := range doc.Media {
		if s.media[ref.ID] != ref.Kind {
			fields = append(fields, app.Field{Field: ref.Field, Code: "invalid"})
		}
	}
	if len(fields) > 0 {
		return current, &app.InvalidFields{Fields: fields}
	}
	if string(current.Draft) == string(doc.Canonical) {
		return current, nil
	}
	s.saves++
	s.draft, s.version = doc.Canonical, s.version+1
	return s.current()
}
func (s *siteV2Store) Publish(_ context.Context, _, _ uuid.UUID, version int64) (app.Current, error) {
	current, err := s.current()
	if err != nil || version != s.version {
		return current, app.ErrVersionConflict
	}
	value, _ := draftjson.Decode(s.draft)
	doc, _ := companySiteValidator().ValidateStoredDocument(value)
	if issues := app.PublishIssues(doc, true, true); len(issues) > 0 {
		return current, &app.PublishBlocked{Issues: issues}
	}
	s.published = append([]byte{}, s.draft...)
	return current, nil
}
func (s *siteV2Store) Unpublish(ctx context.Context, c, u uuid.UUID) (app.Current, error) {
	return s.Get(ctx, c, u)
}
func (s *siteV2Store) SlugAvailable(context.Context, uuid.UUID, string) (bool, error) {
	return true, nil
}

func newSiteV2Router(t *testing.T, store *siteV2Store) func(method, path, body, match string) *httptest.ResponseRecorder {
	t.Helper()
	r := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(roles.RecruiterRole, "recruiter"), requireOwner: routeRoleGate(roles.OwnerRole, "owner"), siteHandler: siteshttp.New(store, draftjson.Decode, companySiteValidator())})
	return func(method, path, body, match string) *httptest.ResponseRecorder {
		role := "recruiter"
		if strings.HasSuffix(path, "/publish") {
			role = "owner"
		}
		return doRouteRequest(t, r, method, path, body, map[string]string{"X-Test-Sub": "s", "X-Test-Role": role, "If-Match": match})
	}
}

func siteV2Media(store *siteV2Store, kind string) map[string]any {
	id := uuid.NewString()
	store.media[id] = kind
	return map[string]any{"media_id": id}
}

func siteV2Draft(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var env map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	return env["draft"].(map[string]any)
}

func siteV2Fields(t *testing.T, w *httptest.ResponseRecorder) []app.Field {
	t.Helper()
	if w.Code != 400 || routeCatalogCode(t, w) != "validation_error" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var env struct {
		Fields []app.Field `json:"fields"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	return env.Fields
}

// siteV2Complete is a publishable document using every slice A addition.
func siteV2Complete(store *siteV2Store) map[string]any {
	jobs := uuid.NewString()
	return map[string]any{
		"slug":  "nexo",
		"theme": map[string]any{"brand_color": "#0F766E", "accent_color": nil, "background_color": nil, "font_pair": "modern"},
		"seo":   map[string]any{"title": nil, "description": nil},
		"blocks": []any{
			map[string]any{"id": uuid.NewString(), "type": "hero", "variant": "collage", "hidden": false,
				"style":   map[string]any{"background": "image", "spacing": "compact", "align": "center", "overlay": "medium", "image": siteV2Media(store, "cover")},
				"content": map[string]any{"title": "Únete", "subtitle": nil, "cover": siteV2Media(store, "cover"), "images": []any{siteV2Media(store, "gallery"), siteV2Media(store, "gallery")}, "primary_label": "Ver puestos", "secondary_visible": true, "secondary_label": "Conócenos", "secondary_target": jobs}},
			map[string]any{"id": jobs, "type": "jobs", "variant": "by_area", "hidden": false, "content": map[string]any{"title": nil, "intro": nil}},
			map[string]any{"id": uuid.NewString(), "type": "benefits", "variant": "bento", "hidden": false, "style": map[string]any{"background": "tint"}, "content": map[string]any{"items": []any{map[string]any{"title": "Salud", "icon": "heart"}}}},
			map[string]any{"id": uuid.NewString(), "type": "values", "variant": "big_icons", "hidden": false, "style": map[string]any{"background": "brand", "align": "center"}, "content": map[string]any{"items": []any{map[string]any{"title": "Cuidado", "emoji": "❤️"}}}},
			map[string]any{"id": uuid.NewString(), "type": "stats", "variant": "brand_band", "hidden": false, "content": map[string]any{"items": []any{map[string]any{"value": "+300", "label": "personas"}}}},
			map[string]any{"id": uuid.NewString(), "type": "testimonials", "variant": "carousel", "hidden": false, "content": map[string]any{"items": []any{map[string]any{"quote": "Gran lugar", "name": "Ana", "photo": siteV2Media(store, "portrait"), "consent": true, "video_url": "https://youtu.be/abcdefgh_-1"}}}},
			map[string]any{"id": uuid.NewString(), "type": "gallery", "variant": "photo_strip", "hidden": false, "content": map[string]any{"items": []any{map[string]any{"alt": "a", "image": siteV2Media(store, "gallery")}, map[string]any{"alt": "b", "image": siteV2Media(store, "gallery")}}}},
			map[string]any{"id": uuid.NewString(), "type": "team", "variant": "portraits", "hidden": false, "content": map[string]any{"title": "Líderes", "intro": "Quienes guían", "items": []any{map[string]any{"name": "Luis", "role": "CEO", "photo": siteV2Media(store, "portrait"), "consent": true}}}},
			map[string]any{"id": uuid.NewString(), "type": "logos", "variant": "strip", "hidden": false, "content": map[string]any{"title": "Reconocimientos", "items": []any{map[string]any{"name": "Great Place", "image": siteV2Media(store, "logo"), "caption": "2026"}}}},
			map[string]any{"id": uuid.NewString(), "type": "areas", "variant": "photo_cards", "hidden": false, "content": map[string]any{"title": "Áreas", "intro": nil, "overrides": []any{map[string]any{"key": "engineering", "photo": siteV2Media(store, "gallery")}, map[string]any{"key": "legal", "icon": "scale"}}}},
			map[string]any{"id": uuid.NewString(), "type": "talent_cta", "variant": "split", "hidden": false, "content": map[string]any{"title": "¿No hay vacante para ti?", "text": "Déjanos tu CV", "button_label": "Dejar mi CV"}},
		},
	}
}

func siteV2Body(t *testing.T, m map[string]any) string {
	t.Helper()
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestCompanySiteSectionsV2SaveReadPublish(t *testing.T) {
	store := &siteV2Store{t: t, draft: app.DefaultDocument(), version: 1, media: map[string]string{}}
	do := newSiteV2Router(t, store)
	doc := siteV2Complete(store)
	saved := siteV2Draft(t, do("PUT", "/v2/me/company/site/draft", siteV2Body(t, doc), `"1"`))
	read := siteV2Draft(t, do("GET", "/v2/me/company/site", "", ""))
	if !reflect.DeepEqual(saved, read) {
		t.Fatal("read differs from save")
	}
	blocks := read["blocks"].([]any)
	if len(blocks) != 11 {
		t.Fatal(len(blocks))
	}
	for i, x := range blocks {
		b := x.(map[string]any)
		in := doc["blocks"].([]any)[i].(map[string]any)
		style, styled := b["style"].(map[string]any)
		_, sent := in["style"]
		if b["type"] != in["type"] || b["variant"] != in["variant"] || styled != sent || (styled && len(style) != 5) {
			t.Fatal(i, b)
		}
	}
	h := blocks[0].(map[string]any)
	if !reflect.DeepEqual(h["style"], doc["blocks"].([]any)[0].(map[string]any)["style"]) {
		t.Fatal(h["style"])
	}
	content := h["content"].(map[string]any)
	if content["primary_label"] != "Ver puestos" || content["secondary_label"] != "Conócenos" || content["secondary_visible"] != true || content["secondary_target"] != blocks[1].(map[string]any)["id"] || len(content["images"].([]any)) != 2 {
		t.Fatal(content)
	}
	if got := blocks[2].(map[string]any)["style"]; !reflect.DeepEqual(got, map[string]any{"background": "tint", "spacing": "airy", "align": "start", "overlay": nil, "image": nil}) {
		t.Fatal(got)
	}
	if got := blocks[10].(map[string]any)["content"]; !reflect.DeepEqual(got, map[string]any{"title": "¿No hay vacante para ti?", "text": "Déjanos tu CV", "button_label": "Dejar mi CV"}) {
		t.Fatal(got)
	}
	// Echoing the read back is a no-op.
	if w := do("PUT", "/v2/me/company/site/draft", siteV2Body(t, read), `"2"`); w.Code != 200 || w.Header().Get("ETag") != `"2"` || store.saves != 1 {
		t.Fatalf("%d %s saves=%d", w.Code, w.Header(), store.saves)
	}
	if w := do("POST", "/v2/me/company/site/publish", "", `"2"`); w.Code != 200 || store.published == nil {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestCompanySiteSectionsV2EachVariantRoundTrips(t *testing.T) {
	for kind, variants := range map[string][]string{
		"hero": {"background_loop", "photo_jobs", "collage"}, "benefits": {"bento", "big_icons"}, "values": {"bento", "big_icons"},
		"stats": {"brand_band"}, "testimonials": {"carousel"}, "gallery": {"photo_strip"}, "team": {"grid", "portraits"},
		"logos": {"strip", "grid"}, "areas": {"icon_cards", "photo_cards"}, "talent_cta": {"banner", "split"},
	} {
		for _, variant := range variants {
			t.Run(kind+"/"+variant, func(t *testing.T) {
				store := &siteV2Store{t: t, draft: app.DefaultDocument(), version: 1, media: map[string]string{}}
				do := newSiteV2Router(t, store)
				doc := siteV2Draft(t, do("GET", "/v2/me/company/site", "", ""))
				index := 0
				if kind == "hero" {
					doc["blocks"].([]any)[0].(map[string]any)["variant"] = variant
				} else {
					index = 2
					doc["blocks"] = append(doc["blocks"].([]any), map[string]any{"id": uuid.NewString(), "type": kind, "variant": variant, "hidden": false, "content": map[string]any{}})
				}
				read := siteV2Draft(t, do("PUT", "/v2/me/company/site/draft", siteV2Body(t, doc), `"1"`))
				got := read["blocks"].([]any)[index].(map[string]any)
				if got["type"] != kind || got["variant"] != variant {
					t.Fatal(got)
				}
				again := siteV2Draft(t, do("GET", "/v2/me/company/site", "", ""))
				if !reflect.DeepEqual(again, read) {
					t.Fatal("read differs")
				}
			})
		}
	}
}

func TestCompanySiteSectionsV2ValidationErrors(t *testing.T) {
	type mutate func(doc map[string]any, store *siteV2Store)
	blockAt := func(doc map[string]any, i int) map[string]any { return doc["blocks"].([]any)[i].(map[string]any) }
	contentAt := func(doc map[string]any, i int) map[string]any { return blockAt(doc, i)["content"].(map[string]any) }
	item := func(doc map[string]any, i int) map[string]any {
		return contentAt(doc, i)["items"].([]any)[0].(map[string]any)
	}
	override := func(doc map[string]any, j int) map[string]any {
		return contentAt(doc, 9)["overrides"].([]any)[j].(map[string]any)
	}
	for _, tt := range []struct {
		name        string
		change      mutate
		field, code string
	}{
		{"unknown variant", func(d map[string]any, _ *siteV2Store) { blockAt(d, 7)["variant"] = "cards" }, "blocks[7].variant", "invalid"},
		{"unknown type", func(d map[string]any, _ *siteV2Store) { blockAt(d, 10)["type"] = "talent" }, "blocks[10].type", "invalid"},
		{"style background", func(d map[string]any, _ *siteV2Store) { blockAt(d, 2)["style"] = map[string]any{"background": "video"} }, "blocks[2].style.background", "invalid"},
		{"style spacing", func(d map[string]any, _ *siteV2Store) { blockAt(d, 2)["style"] = map[string]any{"spacing": "wide"} }, "blocks[2].style.spacing", "invalid"},
		{"style align", func(d map[string]any, _ *siteV2Store) { blockAt(d, 2)["style"] = map[string]any{"align": "end"} }, "blocks[2].style.align", "invalid"},
		{"style overlay value", func(d map[string]any, _ *siteV2Store) { blockAt(d, 0)["style"].(map[string]any)["overlay"] = "max" }, "blocks[0].style.overlay", "invalid"},
		{"style overlay not allowed", func(d map[string]any, _ *siteV2Store) {
			blockAt(d, 2)["style"] = map[string]any{"background": "brand", "overlay": "soft"}
		}, "blocks[2].style.overlay", "not_allowed"},
		{"style image not allowed", func(d map[string]any, s *siteV2Store) {
			blockAt(d, 2)["style"] = map[string]any{"background": "tint", "image": siteV2Media(s, "cover")}
		}, "blocks[2].style.image", "not_allowed"},
		{"style image foreign", func(d map[string]any, _ *siteV2Store) {
			blockAt(d, 0)["style"].(map[string]any)["image"] = map[string]any{"media_id": uuid.NewString()}
		}, "blocks[0].style.image", "invalid"},
		{"style image wrong kind", func(d map[string]any, s *siteV2Store) {
			blockAt(d, 0)["style"].(map[string]any)["image"] = siteV2Media(s, "logo")
		}, "blocks[0].style.image", "invalid"},
		{"style unknown key", func(d map[string]any, _ *siteV2Store) { blockAt(d, 2)["style"] = map[string]any{"color": "red"} }, "blocks[2].style.color", "unknown_key"},
		{"primary label", func(d map[string]any, _ *siteV2Store) { contentAt(d, 0)["primary_label"] = strings.Repeat("a", 25) }, "blocks[0].content.primary_label", "too_long"},
		{"secondary label", func(d map[string]any, _ *siteV2Store) { contentAt(d, 0)["secondary_label"] = strings.Repeat("a", 25) }, "blocks[0].content.secondary_label", "too_long"},
		{"secondary visible", func(d map[string]any, _ *siteV2Store) { contentAt(d, 0)["secondary_visible"] = "no" }, "blocks[0].content.secondary_visible", "invalid"},
		{"secondary target unknown", func(d map[string]any, _ *siteV2Store) { contentAt(d, 0)["secondary_target"] = uuid.NewString() }, "blocks[0].content.secondary_target", "invalid"},
		{"secondary target self", func(d map[string]any, _ *siteV2Store) { contentAt(d, 0)["secondary_target"] = blockAt(d, 0)["id"] }, "blocks[0].content.secondary_target", "invalid"},
		{"hero images over", func(d map[string]any, s *siteV2Store) {
			contentAt(d, 0)["images"] = []any{siteV2Media(s, "gallery"), siteV2Media(s, "gallery"), siteV2Media(s, "gallery"), siteV2Media(s, "gallery")}
		}, "blocks[0].content.images", "too_long"},
		{"hero image wrong kind", func(d map[string]any, s *siteV2Store) { contentAt(d, 0)["images"] = []any{siteV2Media(s, "cover")} }, "blocks[0].content.images[0]", "invalid"},
		{"testimonial video url", func(d map[string]any, _ *siteV2Store) { item(d, 5)["video_url"] = "https://vimeo.com/abc" }, "blocks[5].content.items[0].video_url", "invalid"},
		{"testimonial video url length", func(d map[string]any, _ *siteV2Store) {
			item(d, 5)["video_url"] = "https://vimeo.com/1?" + strings.Repeat("a", 481)
		}, "blocks[5].content.items[0].video_url", "too_long"},
		{"team name", func(d map[string]any, _ *siteV2Store) { item(d, 7)["name"] = strings.Repeat("a", 81) }, "blocks[7].content.items[0].name", "too_long"},
		{"team consent", func(d map[string]any, _ *siteV2Store) { item(d, 7)["consent"] = "si" }, "blocks[7].content.items[0].consent", "invalid"},
		{"team photo kind", func(d map[string]any, s *siteV2Store) { item(d, 7)["photo"] = siteV2Media(s, "logo") }, "blocks[7].content.items[0].photo", "invalid"},
		{"team items", func(d map[string]any, _ *siteV2Store) {
			items := []any{}
			for i := 0; i < 13; i++ {
				items = append(items, map[string]any{})
			}
			contentAt(d, 7)["items"] = items
		}, "blocks[7].content.items", "too_long"},
		{"logo image kind", func(d map[string]any, s *siteV2Store) { item(d, 8)["image"] = siteV2Media(s, "gallery") }, "blocks[8].content.items[0].image", "invalid"},
		{"logo caption", func(d map[string]any, _ *siteV2Store) { item(d, 8)["caption"] = strings.Repeat("a", 81) }, "blocks[8].content.items[0].caption", "too_long"},
		{"area unknown", func(d map[string]any, _ *siteV2Store) { override(d, 0)["key"] = "space" }, "blocks[9].content.overrides[0].key", "invalid"},
		{"area missing", func(d map[string]any, _ *siteV2Store) { delete(override(d, 0), "key") }, "blocks[9].content.overrides[0].key", "required"},
		{"area duplicate", func(d map[string]any, _ *siteV2Store) { override(d, 1)["key"] = "engineering" }, "blocks[9].content.overrides[1].key", "duplicate"},
		{"area both", func(d map[string]any, _ *siteV2Store) { override(d, 0)["icon"] = "heart" }, "blocks[9].content.overrides[0].photo", "not_allowed"},
		{"area neither", func(d map[string]any, _ *siteV2Store) { delete(override(d, 0), "photo") }, "blocks[9].content.overrides[0].icon", "required"},
		{"area bad icon", func(d map[string]any, _ *siteV2Store) { override(d, 1)["icon"] = "rocket-ship" }, "blocks[9].content.overrides[1].icon", "invalid"},
		{"area photo kind", func(d map[string]any, s *siteV2Store) { override(d, 0)["photo"] = siteV2Media(s, "portrait") }, "blocks[9].content.overrides[0].photo", "invalid"},
		{"talent button", func(d map[string]any, _ *siteV2Store) { contentAt(d, 10)["button_label"] = strings.Repeat("a", 25) }, "blocks[10].content.button_label", "too_long"},
		{"talent unknown", func(d map[string]any, _ *siteV2Store) { contentAt(d, 10)["form"] = true }, "blocks[10].content.form", "unknown_key"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			store := &siteV2Store{t: t, draft: app.DefaultDocument(), version: 1, media: map[string]string{}}
			do := newSiteV2Router(t, store)
			doc := siteV2Complete(store)
			tt.change(doc, store)
			fields := siteV2Fields(t, do("PUT", "/v2/me/company/site/draft", siteV2Body(t, doc), `"1"`))
			if len(fields) != 1 || fields[0].Field != tt.field || fields[0].Code != tt.code {
				t.Fatalf("%+v", fields)
			}
			if store.saves != 0 || store.version != 1 {
				t.Fatal("invalid document written")
			}
		})
	}
}

func TestCompanySiteSectionsV2PublishIssues(t *testing.T) {
	for _, tt := range []struct {
		name   string
		change func(map[string]any)
		issues string
	}{
		{"background loop", func(d map[string]any) { d["blocks"].([]any)[0].(map[string]any)["variant"] = "background_loop" }, `[{"code":"hero_video_missing","field":"blocks[0]"}]`},
		{"hidden secondary target", func(d map[string]any) {
			d["blocks"].([]any)[2].(map[string]any)["hidden"] = true
			d["blocks"].([]any)[0].(map[string]any)["content"].(map[string]any)["secondary_target"] = d["blocks"].([]any)[2].(map[string]any)["id"]
		}, `[{"code":"secondary_target_hidden","field":"blocks[0].content.secondary_target"}]`},
		{"hidden secondary target with hidden button", func(d map[string]any) {
			d["blocks"].([]any)[2].(map[string]any)["hidden"] = true
			c := d["blocks"].([]any)[0].(map[string]any)["content"].(map[string]any)
			c["secondary_target"], c["secondary_visible"] = d["blocks"].([]any)[2].(map[string]any)["id"], false
		}, ``},
		{"collage with one image", func(d map[string]any) {
			c := d["blocks"].([]any)[0].(map[string]any)["content"].(map[string]any)
			c["images"] = c["images"].([]any)[:1]
		}, `[{"code":"hero_collage_images_missing","field":"blocks[0]"}]`},
		{"style image missing", func(d map[string]any) {
			delete(d["blocks"].([]any)[0].(map[string]any)["style"].(map[string]any), "image")
			d["blocks"].([]any)[4].(map[string]any)["style"] = map[string]any{"background": "image", "image": nil}
		}, `[{"code":"style_image_missing","field":"blocks[0].style.image"},{"code":"style_image_missing","field":"blocks[4].style.image"}]`},
		{"team without consent", func(d map[string]any) {
			d["blocks"].([]any)[7].(map[string]any)["content"].(map[string]any)["items"].([]any)[0].(map[string]any)["consent"] = false
		}, `[{"code":"block_incomplete","field":"blocks[7]"}]`},
		{"logo without image", func(d map[string]any) {
			d["blocks"].([]any)[8].(map[string]any)["content"].(map[string]any)["items"].([]any)[0].(map[string]any)["image"] = nil
		}, `[{"code":"block_incomplete","field":"blocks[8]"}]`},
		{"areas without title", func(d map[string]any) {
			d["blocks"].([]any)[9].(map[string]any)["content"].(map[string]any)["title"] = nil
		}, `[{"code":"block_incomplete","field":"blocks[9]"}]`},
		{"talent without title", func(d map[string]any) {
			d["blocks"].([]any)[10].(map[string]any)["content"].(map[string]any)["title"] = " "
		}, `[{"code":"block_incomplete","field":"blocks[10]"}]`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			store := &siteV2Store{t: t, draft: app.DefaultDocument(), version: 1, media: map[string]string{}}
			do := newSiteV2Router(t, store)
			doc := siteV2Complete(store)
			tt.change(doc)
			siteV2Draft(t, do("PUT", "/v2/me/company/site/draft", siteV2Body(t, doc), `"1"`))
			w := do("POST", "/v2/me/company/site/publish", "", `"2"`)
			if tt.issues == "" {
				if w.Code != 200 || store.published == nil {
					t.Fatalf("%d %s", w.Code, w.Body)
				}
				return
			}
			if w.Code != 422 || routeCatalogCode(t, w) != "publish_blocked" {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
			var env struct {
				Issues json.RawMessage `json:"issues"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
				t.Fatal(err)
			}
			if string(env.Issues) != tt.issues || store.published != nil {
				t.Fatal(string(env.Issues))
			}
		})
	}
}

// A document stored before slice A reads without any new key, echoes back as a
// no-op and publishes unchanged.
func TestCompanySiteSectionsV2StoredV1Document(t *testing.T) {
	stored := `{"slug":"nexo","theme":{"brand_color":"#0F766E","font_pair":"classic"},"seo":{"title":null,"description":null},"blocks":[` +
		`{"id":"11111111-1111-4111-8111-111111111111","type":"hero","variant":"photo","hidden":false,"content":{"title":"Únete","subtitle":null,"cover":null}},` +
		`{"id":"22222222-2222-4222-8222-222222222222","type":"jobs","variant":"list","hidden":false,"content":{"title":null,"intro":null}},` +
		`{"id":"33333333-3333-4333-8333-333333333333","type":"testimonials","variant":"quote","hidden":false,"content":{"items":[{"quote":"Gran lugar","name":"Ana","role":null,"photo":null,"consent":true}]}}]}`
	store := &siteV2Store{t: t, draft: []byte(stored), version: 4, media: map[string]string{}}
	do := newSiteV2Router(t, store)
	read := siteV2Draft(t, do("GET", "/v2/me/company/site", "", ""))
	// Only the pre-existing v1 normalization applies (canonical key order and the
	// §2.2 palette nulls); no sections v2 key is added on read.
	want := `{"blocks":[` +
		`{"content":{"cover":null,"subtitle":null,"title":"Únete"},"hidden":false,"id":"11111111-1111-4111-8111-111111111111","type":"hero","variant":"photo"},` +
		`{"content":{"intro":null,"title":null},"hidden":false,"id":"22222222-2222-4222-8222-222222222222","type":"jobs","variant":"list"},` +
		`{"content":{"items":[{"consent":true,"name":"Ana","photo":null,"quote":"Gran lugar","role":null}]},"hidden":false,"id":"33333333-3333-4333-8333-333333333333","type":"testimonials","variant":"quote"}],` +
		`"seo":{"description":null,"title":null},"slug":"nexo","theme":{"accent_color":null,"background_color":null,"brand_color":"#0F766E","font_pair":"classic"}}`
	if got := siteV2Body(t, read); got != want {
		t.Fatalf("read:\n%s\nwant:\n%s", got, want)
	}
	if w := do("PUT", "/v2/me/company/site/draft", siteV2Body(t, read), `"4"`); w.Code != 200 || w.Header().Get("ETag") != `"4"` || store.saves != 0 || string(store.draft) != stored {
		t.Fatalf("%d %s saves=%d", w.Code, w.Header(), store.saves)
	}
	if w := do("POST", "/v2/me/company/site/publish", "", `"4"`); w.Code != 200 || string(store.published) != stored {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

// The areas catalog is a copy of the vacancy professional_area literals (no
// cross-feature import from the slice); every key must be one vacancies accept.
func TestCompanySiteAreasMatchVacancyCatalog(t *testing.T) {
	if len(app.ProfessionalAreas) != 16 {
		t.Fatal(app.ProfessionalAreas)
	}
	for _, area := range app.ProfessionalAreas {
		if _, err := draftfields.ValidateScalars(map[string]any{"professional_area": area}); err != nil {
			t.Fatalf("%s: %v", area, err)
		}
	}
	if _, err := draftfields.ValidateScalars(map[string]any{"professional_area": "astronaut"}); err == nil {
		t.Fatal("vacancy catalog accepts unknown area")
	}
}
