//go:build integration

package main

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

func siteV2PNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.NRGBA{G: 200, A: 100})
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func siteV2Upload(t *testing.T, h *draftFlowHarness, token, kind string, data []byte) map[string]any {
	t.Helper()
	r := siteUpload(t, h, token, kind, data)
	if r.status != 201 {
		t.Fatalf("%s: %d %s", kind, r.status, r.body)
	}
	return map[string]any{"media_id": draftFlowObject(t, r.body)["id"]}
}

// Sections v2 through the production router, Postgres store and disk media:
// logo uploads, save/read/publish/public read of every addition, media
// ownership by kind, publish issues, and a stored v1 document.
func TestCompanySiteSectionsV2Flow(t *testing.T) {
	h := newCompanySiteFlowHarness(t)
	company, user, sub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, company.companyID)
	owner := h.actor(t, user, sub)
	other, otherUser, otherSub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, other.companyID)
	otherActor := h.actor(t, otherUser, otherSub)
	ctx := context.Background()
	if _, err := h.pool.Exec(ctx, `UPDATE companies SET rfc=upper(right(replace(id::text,'-',''),12)),logo_url='https://example.test/logo.png' WHERE id=$1`, company.companyID); err != nil {
		t.Fatal(err)
	}
	const path = "/v2/me/company/site"
	first := h.do(t, "GET", path, "", owner.token, nil)
	siteFlowDraft(t, first)

	// Logo uploads: 64 px PNG with alpha accepted; JPEG and 63 px rejected without rows.
	logo := siteV2Upload(t, h, owner.token, "logo", siteV2PNG(t, 64, 64))
	var kind, contentType string
	var width int
	if err := h.pool.QueryRow(ctx, `SELECT kind,content_type,width FROM company_site_media WHERE id=$1`, logo["media_id"]).Scan(&kind, &contentType, &width); err != nil || kind != "logo" || contentType != "image/png" || width != 64 {
		t.Fatalf("%s %s %d %v", kind, contentType, width, err)
	}
	var jpg bytes.Buffer
	if err := jpeg.Encode(&jpg, image.NewRGBA(image.Rect(0, 0, 200, 200)), nil); err != nil {
		t.Fatal(err)
	}
	draftFlowAssertError(t, siteUpload(t, h, owner.token, "logo", jpg.Bytes()), 415, "unsupported_media_type")
	draftFlowAssertError(t, siteUpload(t, h, owner.token, "logo", siteV2PNG(t, 63, 64)), 422, "image_too_small")
	draftFlowAssertError(t, siteUpload(t, h, owner.token, "cover", siteV2PNG(t, 64, 64)), 422, "image_too_small")
	if n := draftFlowCount(t, h.pool, `SELECT count(*) FROM company_site_media WHERE company_id=$1`, company.companyID); n != 1 {
		t.Fatal(n)
	}
	photo := siteV2PNG(t, 200, 200)
	cover, styleImage := siteV2Upload(t, h, owner.token, "cover", photo), siteV2Upload(t, h, owner.token, "cover", photo)
	g1, g2, g3 := siteV2Upload(t, h, owner.token, "gallery", photo), siteV2Upload(t, h, owner.token, "gallery", photo), siteV2Upload(t, h, owner.token, "gallery", photo)
	portrait := siteV2Upload(t, h, owner.token, "portrait", photo)
	foreign := siteV2Upload(t, h, otherActor.token, "cover", photo)

	slug := "secciones-" + company.companyID.String()
	jobs := uuid.NewString()
	block := func(kind, variant string, content map[string]any) map[string]any {
		return map[string]any{"id": uuid.NewString(), "type": kind, "variant": variant, "hidden": false, "content": content}
	}
	hero := block("hero", "collage", map[string]any{"title": "Únete", "cover": cover, "images": []any{g1, g2}, "primary_label": "Ver puestos", "secondary_visible": true, "secondary_label": "Conócenos", "secondary_target": jobs})
	hero["style"] = map[string]any{"background": "image", "spacing": "compact", "align": "center", "overlay": "strong", "image": styleImage}
	benefits := block("benefits", "bento", map[string]any{"items": []any{map[string]any{"title": "Salud", "icon": "heart"}}})
	benefits["style"] = map[string]any{"background": "tint"}
	doc := map[string]any{
		"slug": slug, "theme": map[string]any{"brand_color": "#0F766E", "font_pair": "modern"}, "seo": map[string]any{"title": nil, "description": nil},
		"blocks": []any{
			hero,
			map[string]any{"id": jobs, "type": "jobs", "variant": "by_area", "hidden": false, "content": map[string]any{}},
			benefits,
			block("values", "big_icons", map[string]any{"items": []any{map[string]any{"title": "Cuidado", "emoji": "❤️"}}}),
			block("stats", "brand_band", map[string]any{"items": []any{map[string]any{"value": "+300", "label": "personas"}}}),
			block("testimonials", "carousel", map[string]any{"items": []any{map[string]any{"quote": "Gran lugar", "name": "Ana", "photo": portrait, "consent": true, "video_url": "https://vimeo.com/76979871"}}}),
			block("gallery", "photo_strip", map[string]any{"items": []any{map[string]any{"alt": "a", "image": g1}, map[string]any{"alt": "b", "image": g3}}}),
			block("team", "portraits", map[string]any{"title": "Líderes", "items": []any{map[string]any{"name": "Luis", "role": "CEO", "photo": portrait, "consent": true}}}),
			block("logos", "grid", map[string]any{"title": "Reconocimientos", "items": []any{map[string]any{"name": "Great Place", "image": logo, "caption": "2026"}}}),
			block("areas", "photo_cards", map[string]any{"title": "Áreas", "overrides": []any{map[string]any{"key": "logistics_transport", "photo": g2}, map[string]any{"key": "legal", "icon": "scale"}}}),
			block("talent_cta", "banner", map[string]any{"title": "¿No hay vacante para ti?", "text": "Déjanos tu CV", "button_label": "Dejar mi CV"}),
		},
	}
	saved := h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": first.header.Get("ETag")})
	draft := siteFlowDraft(t, saved)
	read := h.do(t, "GET", path, "", owner.token, nil)
	if string(read.body) != string(saved.body) {
		t.Fatal("read differs from save")
	}
	env := draftFlowObject(t, read.body)
	kinds := map[string]bool{}
	for _, m := range env["media"].([]any) {
		kinds[m.(map[string]any)["kind"].(string)] = true
	}
	if !reflect.DeepEqual(kinds, map[string]bool{"cover": true, "gallery": true, "portrait": true, "logo": true}) || len(env["media"].([]any)) != 7 {
		t.Fatal(env["media"])
	}
	blocks := draft["blocks"].([]any)
	if got := blocks[0].(map[string]any)["style"]; !reflect.DeepEqual(got, map[string]any{"background": "image", "spacing": "compact", "align": "center", "overlay": "strong", "image": styleImage}) {
		t.Fatal(got)
	}
	if got := blocks[2].(map[string]any)["style"]; !reflect.DeepEqual(got, map[string]any{"background": "tint", "spacing": "airy", "align": "start", "overlay": nil, "image": nil}) {
		t.Fatal(got)
	}
	if c := blocks[0].(map[string]any)["content"].(map[string]any); c["secondary_target"] != jobs || c["primary_label"] != "Ver puestos" || len(c["images"].([]any)) != 2 {
		t.Fatal(c)
	}

	// Ownership is checked by company and kind for every new media position.
	for name, mutate := range map[string]func(map[string]any) (string, func()){
		"style image foreign": func(d map[string]any) (string, func()) {
			s := d["blocks"].([]any)[0].(map[string]any)["style"].(map[string]any)
			old := s["image"]
			s["image"] = foreign
			return "blocks[0].style.image", func() { s["image"] = old }
		},
		"style image logo kind": func(d map[string]any) (string, func()) {
			s := d["blocks"].([]any)[0].(map[string]any)["style"].(map[string]any)
			old := s["image"]
			s["image"] = logo
			return "blocks[0].style.image", func() { s["image"] = old }
		},
		"hero image cover kind": func(d map[string]any) (string, func()) {
			c := d["blocks"].([]any)[0].(map[string]any)["content"].(map[string]any)
			old := c["images"]
			c["images"] = []any{cover}
			return "blocks[0].content.images[0]", func() { c["images"] = old }
		},
		"logo gallery kind": func(d map[string]any) (string, func()) {
			item := d["blocks"].([]any)[8].(map[string]any)["content"].(map[string]any)["items"].([]any)[0].(map[string]any)
			old := item["image"]
			item["image"] = g1
			return "blocks[8].content.items[0].image", func() { item["image"] = old }
		},
		"team photo foreign": func(d map[string]any) (string, func()) {
			item := d["blocks"].([]any)[7].(map[string]any)["content"].(map[string]any)["items"].([]any)[0].(map[string]any)
			old := item["photo"]
			item["photo"] = foreign
			return "blocks[7].content.items[0].photo", func() { item["photo"] = old }
		},
		"area photo logo kind": func(d map[string]any) (string, func()) {
			item := d["blocks"].([]any)[9].(map[string]any)["content"].(map[string]any)["overrides"].([]any)[0].(map[string]any)
			old := item["photo"]
			item["photo"] = logo
			return "blocks[9].content.overrides[0].photo", func() { item["photo"] = old }
		},
	} {
		field, restore := mutate(draft)
		bad := h.do(t, "PUT", path+"/draft", siteFlowBody(t, draft), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
		draftFlowAssertError(t, bad, 400, "validation_error")
		fields := draftFlowObject(t, bad.body)["fields"].([]any)
		if len(fields) != 1 || fields[0].(map[string]any)["field"] != field || fields[0].(map[string]any)["code"] != "invalid" {
			t.Fatal(name, string(bad.body))
		}
		restore()
	}
	if after := h.do(t, "GET", path, "", owner.token, nil); string(after.body) != string(saved.body) {
		t.Fatal("rejected save mutated the draft")
	}

	// Publish and public read carry every addition and the logo media.
	published := h.do(t, "POST", path+"/publish", "", owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	siteFlowDraft(t, published)
	public := h.do(t, "GET", "/v2/company-sites/"+slug, "", "", nil)
	if public.status != 200 {
		t.Fatalf("%d %s", public.status, public.body)
	}
	pub := draftFlowObject(t, public.body)
	site := pub["site"].(map[string]any)
	delete(draft, "slug")
	if !reflect.DeepEqual(site, draft) {
		t.Fatalf("public site differs:\n%s", public.body)
	}
	if len(pub["media"].([]any)) != 7 {
		t.Fatal(pub["media"])
	}

	// background_loop without a background_video (slice B) is publish-blocked; a
	// hidden secondary target is its own issue; a missing style image too.
	draft["slug"] = slug
	blocks[0].(map[string]any)["variant"] = "background_loop"
	blocks[2].(map[string]any)["hidden"] = true
	blocks[0].(map[string]any)["content"].(map[string]any)["secondary_target"] = blocks[2].(map[string]any)["id"]
	blocks[3].(map[string]any)["style"] = map[string]any{"background": "image", "overlay": "soft"}
	next := h.do(t, "PUT", path+"/draft", siteFlowBody(t, draft), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	siteFlowDraft(t, next)
	blocked := h.do(t, "POST", path+"/publish", "", owner.token, map[string]string{"If-Match": next.header.Get("ETag")})
	draftFlowAssertError(t, blocked, 422, "publish_blocked")
	if got := siteFlowBody(t, map[string]any{"issues": draftFlowObject(t, blocked.body)["issues"]}); got != `{"issues":[{"code":"hero_video_missing","field":"blocks[0]"},{"code":"secondary_target_hidden","field":"blocks[0].content.secondary_target"},{"code":"style_image_missing","field":"blocks[3].style.image"}]}` {
		t.Fatal(got)
	}
	if again := h.do(t, "GET", "/v2/company-sites/"+slug, "", "", nil); string(again.body) != string(public.body) {
		t.Fatal("blocked publish changed the public site")
	}
}

// A document stored before sections v2 reads (draft and public) without any new
// key, echoes back as a no-op without rewriting stored bytes, and republishes.
func TestCompanySiteSectionsV2StoredV1DocumentFlow(t *testing.T) {
	h := newCompanySiteFlowHarness(t)
	company, user, sub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, company.companyID)
	owner := h.actor(t, user, sub)
	ctx := context.Background()
	if _, err := h.pool.Exec(ctx, `UPDATE companies SET rfc=upper(right(replace(id::text,'-',''),12)),logo_url='https://example.test/logo.png' WHERE id=$1`, company.companyID); err != nil {
		t.Fatal(err)
	}
	const path = "/v2/me/company/site"
	siteFlowDraft(t, h.do(t, "GET", path, "", owner.token, nil))
	slug := "v1-" + company.companyID.String()
	stored := `{"slug":"` + slug + `","theme":{"brand_color":"#0F766E","accent_color":null,"background_color":null,"font_pair":"classic"},"seo":{"title":null,"description":null},"blocks":[` +
		`{"id":"11111111-1111-4111-8111-111111111111","type":"hero","variant":"photo","hidden":false,"content":{"title":"Únete","subtitle":null,"cover":null}},` +
		`{"id":"22222222-2222-4222-8222-222222222222","type":"jobs","variant":"list","hidden":false,"content":{"title":null,"intro":null}},` +
		`{"id":"33333333-3333-4333-8333-333333333333","type":"testimonials","variant":"cards","hidden":false,"content":{"items":[{"quote":"Gran lugar","name":"Ana","role":null,"photo":null,"consent":true}]}},` +
		`{"id":"44444444-4444-4444-8444-444444444444","type":"closing","variant":"simple","hidden":true,"content":{"title":null,"text":null}}]}`
	if _, err := h.pool.Exec(ctx, `UPDATE company_sites SET draft=$2,draft_slug=$3,published=$2,published_version=draft_version,published_slug=$3,published_at=clock_timestamp() WHERE company_id=$1`, company.companyID, stored, slug); err != nil {
		t.Fatal(err)
	}
	var before string
	if err := h.pool.QueryRow(ctx, `SELECT draft::text FROM company_sites WHERE company_id=$1`, company.companyID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	// Nothing is added on read: the stored v1 document is already canonical.
	hero := `{"content":{"cover":null,"subtitle":null,"title":"Únete"},"hidden":false,"id":"11111111-1111-4111-8111-111111111111","type":"hero","variant":"photo"}`
	jobs := `{"content":{"intro":null,"title":null},"hidden":false,"id":"22222222-2222-4222-8222-222222222222","type":"jobs","variant":"list"}`
	testimonials := `{"content":{"items":[{"consent":true,"name":"Ana","photo":null,"quote":"Gran lugar","role":null}]},"hidden":false,"id":"33333333-3333-4333-8333-333333333333","type":"testimonials","variant":"cards"}`
	closing := `{"content":{"text":null,"title":null},"hidden":true,"id":"44444444-4444-4444-8444-444444444444","type":"closing","variant":"simple"}`
	tail := `"seo":{"description":null,"title":null}`
	theme := `"theme":{"accent_color":null,"background_color":null,"brand_color":"#0F766E","font_pair":"classic"}`
	wantDraft := `{"blocks":[` + hero + `,` + jobs + `,` + testimonials + `,` + closing + `],` + tail + `,"slug":"` + slug + `",` + theme + `}`
	wantPublic := `{"blocks":[` + hero + `,` + jobs + `,` + testimonials + `],` + tail + `,` + theme + `}`
	get := h.do(t, "GET", path, "", owner.token, nil)
	draft := siteFlowDraft(t, get)
	if got := siteFlowBody(t, draft); got != wantDraft {
		t.Fatalf("draft:\n%s\nwant:\n%s", got, wantDraft)
	}
	public := h.do(t, "GET", "/v2/company-sites/"+slug, "", "", nil)
	if public.status != 200 {
		t.Fatalf("%d %s", public.status, public.body)
	}
	if got := siteFlowBody(t, draftFlowObject(t, public.body)["site"].(map[string]any)); got != wantPublic {
		t.Fatalf("public:\n%s\nwant:\n%s", got, wantPublic)
	}
	echo := h.do(t, "PUT", path+"/draft", siteFlowBody(t, draft), owner.token, map[string]string{"If-Match": get.header.Get("ETag")})
	siteFlowDraft(t, echo)
	if echo.header.Get("ETag") != get.header.Get("ETag") || string(echo.body) != string(get.body) {
		t.Fatalf("echo not a no-op: %s %s", echo.header.Get("ETag"), echo.body)
	}
	var after string
	if err := h.pool.QueryRow(ctx, `SELECT draft::text FROM company_sites WHERE company_id=$1`, company.companyID).Scan(&after); err != nil || after != before {
		t.Fatalf("stored draft rewritten: %v", err)
	}
	siteFlowDraft(t, h.do(t, "POST", path+"/publish", "", owner.token, map[string]string{"If-Match": get.header.Get("ETag")}))
}
