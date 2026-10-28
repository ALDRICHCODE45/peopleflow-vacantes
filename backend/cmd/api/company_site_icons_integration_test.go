//go:build integration

package main

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestCompanySiteLegacyIconsPaletteRoundTrip(t *testing.T) {
	h := newCompanySiteFlowHarness(t)
	company, user, sub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, company.companyID)
	owner := h.actor(t, user, sub)
	const private = "/v2/me/company/site"
	doc := siteFlowDraft(t, h.do(t, "GET", private, "", owner.token, nil))
	slug := "legacy-" + company.companyID.String()
	doc["slug"] = slug
	theme := doc["theme"].(map[string]any)
	delete(theme, "accent_color")
	delete(theme, "background_color")
	blocks := doc["blocks"].([]any)
	blocks[0].(map[string]any)["content"].(map[string]any)["title"] = "Join us"
	doc["blocks"] = append(blocks, map[string]any{"id": uuid.NewString(), "type": "values", "variant": "grid", "hidden": false, "content": map[string]any{"items": []any{map[string]any{"title": "Care", "icon": nil}}}})
	ctx := context.Background()
	if _, err := h.pool.Exec(ctx, `UPDATE companies SET rfc=upper(right(replace(id::text,'-',''),12)),logo_url='https://example.test/logo.png' WHERE id=$1`, company.companyID); err != nil {
		t.Fatal(err)
	}
	// Persist precisely the pre-extension shape, bypassing the strict PUT grammar.
	if _, err := h.pool.Exec(ctx, `UPDATE company_sites SET draft=$2,draft_slug=$3,published=$2,published_version=draft_version,published_slug=$3,published_at=clock_timestamp() WHERE company_id=$1`, company.companyID, siteFlowBody(t, doc), slug); err != nil {
		t.Fatal(err)
	}
	assertCanonical := func(site map[string]any, emoji any) {
		t.Helper()
		palette := site["theme"].(map[string]any)
		for _, key := range []string{"accent_color", "background_color"} {
			if value, ok := palette[key]; !ok || value != nil {
				t.Fatal(key, palette)
			}
		}
		item := site["blocks"].([]any)[2].(map[string]any)["content"].(map[string]any)["items"].([]any)[0].(map[string]any)
		if value, ok := item["icon"]; !ok || value != nil {
			t.Fatal(item)
		}
		if value, ok := item["emoji"]; !ok || value != emoji {
			t.Fatal(item)
		}
	}
	getPublic := func() map[string]any {
		t.Helper()
		r := h.do(t, "GET", "/v2/company-sites/"+slug, "", "", nil)
		if r.status != 200 {
			t.Fatalf("%d %s", r.status, r.body)
		}
		return draftFlowObject(t, r.body)["site"].(map[string]any)
	}
	get := h.do(t, "GET", private, "", owner.token, nil)
	doc = siteFlowDraft(t, get)
	assertCanonical(doc, nil)
	assertCanonical(getPublic(), nil)
	published := h.do(t, "POST", private+"/publish", "", owner.token, map[string]string{"If-Match": get.header.Get("ETag")})
	assertCanonical(siteFlowDraft(t, published), nil)
	assertCanonical(getPublic(), nil)
	item := doc["blocks"].([]any)[2].(map[string]any)["content"].(map[string]any)["items"].([]any)[0].(map[string]any)
	item["emoji"] = "👩‍💻"
	saved := h.do(t, "PUT", private+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": get.header.Get("ETag")})
	assertCanonical(siteFlowDraft(t, saved), "👩‍💻")
	assertCanonical(siteFlowDraft(t, h.do(t, "GET", private, "", owner.token, nil)), "👩‍💻")
	item["icon"] = "heart"
	bad := h.do(t, "PUT", private+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	draftFlowAssertError(t, bad, 400, "validation_error")
	fields := draftFlowObject(t, bad.body)["fields"].([]any)
	if len(fields) != 1 || fields[0].(map[string]any)["field"] != "blocks[2].content.items[0].emoji" || fields[0].(map[string]any)["code"] != "not_allowed" {
		t.Fatal(string(bad.body))
	}
	assertCanonical(siteFlowDraft(t, h.do(t, "GET", private, "", owner.token, nil)), "👩‍💻")
	assertCanonical(getPublic(), nil)
	siteFlowDraft(t, h.do(t, "POST", private+"/publish", "", owner.token, map[string]string{"If-Match": saved.header.Get("ETag")}))
	assertCanonical(getPublic(), "👩‍💻")
}
