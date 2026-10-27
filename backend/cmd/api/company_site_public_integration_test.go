//go:build integration

package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestCompanySitePublicSnapshotHistoryAndLiveness(t *testing.T) {
	h := newDraftFlowHarness(t)
	ctx := context.Background()
	// Match the existing geo fixtures: preserve pre-existing catalog rows and
	// register cleanup before company fixtures so their foreign keys are gone first.
	country, err := h.pool.Exec(ctx, `INSERT INTO geo_countries(code,name_es,name_en) VALUES('US','Estados Unidos','United States') ON CONFLICT DO NOTHING`)
	if err != nil {
		t.Fatal(err)
	}
	if country.RowsAffected() == 1 {
		t.Cleanup(func() {
			if _, err := h.pool.Exec(ctx, `DELETE FROM geo_countries WHERE code='US'`); err != nil {
				t.Error(err)
			}
		})
	}
	c, user, sub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, c.companyID)
	owner := h.actor(t, user, sub)
	const private = "/v2/me/company/site"
	slug := "public-" + c.companyID.String()
	get := func(slug string) draftFlowResponse { return h.do(t, "GET", "/v2/company-sites/"+slug, "", "", nil) }
	missing := get(slug)
	draftFlowAssertError(t, missing, 404, "site_not_found")
	draftFlowAssertNoStore(t, missing)
	doc := siteFlowDraft(t, h.do(t, "GET", private, "", owner.token, nil))
	if got := get(slug); string(got.body) != string(missing.body) {
		t.Fatalf("never published differs: %s", got.body)
	}
	// Use a non-null location so parity exercises the real company serializer.
	if _, err := h.pool.Exec(ctx, `UPDATE companies SET rfc=upper(right(replace(id::text,'-',''),12)),logo_url='https://example.test/logo.png',country_code='US' WHERE id=$1`, c.companyID); err != nil {
		t.Fatal(err)
	}
	visible, hidden, unreferenced := uuid.New(), uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{visible, hidden, unreferenced} {
		if _, err := h.pool.Exec(ctx, `INSERT INTO company_site_media(id,company_id,kind,storage_key,content_type,width,height,byte_size,created_by) VALUES($1,$2,'cover',$3,'image/png',400,300,100,$4)`, id, c.companyID, id.String(), user); err != nil {
			t.Fatal(err)
		}
	}
	// Hidden story references a story-kind upload; cover stays on the hero.
	if _, err := h.pool.Exec(ctx, `UPDATE company_site_media SET kind='story' WHERE id=$1`, hidden); err != nil {
		t.Fatal(err)
	}
	blocks := doc["blocks"].([]any)
	hero := blocks[0].(map[string]any)["content"].(map[string]any)
	hero["title"] = "Published title"
	hero["cover"] = map[string]any{"media_id": visible.String()}
	doc["slug"] = slug
	doc["blocks"] = append(blocks,
		map[string]any{"id": uuid.NewString(), "type": "closing", "variant": "simple", "hidden": false, "content": map[string]any{"title": "Welcome"}},
		map[string]any{"id": uuid.NewString(), "type": "story", "variant": "text_image", "hidden": true, "content": map[string]any{"image": map[string]any{"media_id": hidden.String()}}})
	save := func(tag string) draftFlowResponse {
		return h.do(t, "PUT", private+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": tag})
	}
	publish := func(tag string) {
		siteFlowDraft(t, h.do(t, "POST", private+"/publish", "", owner.token, map[string]string{"If-Match": tag}))
	}
	saved := save(`"1"`)
	siteFlowDraft(t, saved)
	publish(saved.header.Get("ETag"))
	first := get(slug)
	if first.status != 200 || first.header.Get("Cache-Control") != "public, max-age=60" {
		t.Fatal(first.status, string(first.body))
	}
	var wire map[string]json.RawMessage
	if err := json.Unmarshal(first.body, &wire); err != nil {
		t.Fatal(err)
	}
	sitePublicKeys(t, wire, "company", "site", "slug", "published_at", "media")
	body := draftFlowObject(t, first.body)
	site := body["site"].(map[string]any)
	if len(site) != 3 || len(site["blocks"].([]any)) != 3 {
		t.Fatal(site)
	}
	media := body["media"].([]any)
	if len(media) != 1 || media[0].(map[string]any)["id"] != visible.String() {
		t.Fatal(media)
	}
	company := body["company"].(map[string]any)
	profile := h.do(t, "GET", "/companies/"+c.companyID.String(), "", "", nil)
	if profile.status != 200 {
		t.Fatal(profile.status, string(profile.body))
	}
	a, _ := json.Marshal(company["location"])
	b, _ := json.Marshal(draftFlowObject(t, profile.body)["location"])
	if string(a) != string(b) || string(a) == "null" {
		t.Fatalf("location differs: %s / %s", a, b)
	}
	if strings.Contains(string(first.body), hidden.String()) || strings.Contains(string(first.body), unreferenced.String()) {
		t.Fatal("private media exposed")
	}
	doc["seo"].(map[string]any)["title"] = "Draft-only SEO"
	saved = save(saved.header.Get("ETag"))
	siteFlowDraft(t, saved)
	if got := get(slug); string(got.body) != string(first.body) {
		t.Fatalf("draft leaked: %s", got.body)
	}
	next := "new-" + c.companyID.String()
	doc["slug"] = next
	saved = save(saved.header.Get("ETag"))
	siteFlowDraft(t, saved)
	publish(saved.header.Get("ETag"))
	current, old := get(next), get(slug)
	if current.status != 200 || old.status != 200 || string(current.body) != string(old.body) || draftFlowObject(t, old.body)["slug"] != next {
		t.Fatalf("history: %s %s", current.body, old.body)
	}
	// With history still intact, unpublishing makes both paths indistinguishable.
	siteFlowDraft(t, h.do(t, "POST", private+"/unpublish", "", owner.token, nil))
	for _, s := range []string{slug, next} {
		got := get(s)
		draftFlowAssertError(t, got, 404, "site_not_found")
		if string(got.body) != string(missing.body) {
			t.Fatal("unpublished history oracle")
		}
	}
	publish(saved.header.Get("ETag"))
	if got := get(slug); got.status != 200 || draftFlowObject(t, got.body)["slug"] != next {
		t.Fatalf("history not restored: %s", got.body)
	}
	// Claiming history removes the redirect immediately, even before publication.
	other, otherUser, otherSub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, other.companyID)
	otherOwner := h.actor(t, otherUser, otherSub)
	otherDoc := siteFlowDraft(t, h.do(t, "GET", private, "", otherOwner.token, nil))
	otherDoc["slug"] = slug
	otherBlocks := otherDoc["blocks"].([]any)
	otherBlocks[0].(map[string]any)["content"].(map[string]any)["title"] = "New owner"
	otherDoc["blocks"] = append(otherBlocks, map[string]any{"id": uuid.NewString(), "type": "closing", "variant": "simple", "hidden": false, "content": map[string]any{"title": "Hello"}})
	otherSave := h.do(t, "PUT", private+"/draft", siteFlowBody(t, otherDoc), otherOwner.token, map[string]string{"If-Match": `"1"`})
	siteFlowDraft(t, otherSave)
	draftFlowAssertError(t, get(slug), 404, "site_not_found")
	// Unpublish before the new claimant publishes: both old and current are 404.
	siteFlowDraft(t, h.do(t, "POST", private+"/unpublish", "", owner.token, nil))
	for _, s := range []string{slug, next} {
		got := get(s)
		draftFlowAssertError(t, got, 404, "site_not_found")
		if string(got.body) != string(missing.body) {
			t.Fatal("404 oracle")
		}
	}
	if _, err := h.pool.Exec(ctx, `UPDATE companies SET rfc=upper(right(replace(id::text,'-',''),12)),logo_url='https://example.test/logo.png' WHERE id=$1`, other.companyID); err != nil {
		t.Fatal(err)
	}
	siteFlowDraft(t, h.do(t, "POST", private+"/publish", "", otherOwner.token, map[string]string{"If-Match": otherSave.header.Get("ETag")}))
	newOwner := get(slug)
	if newOwner.status != 200 || draftFlowObject(t, newOwner.body)["company"].(map[string]any)["id"] != other.companyID.String() {
		t.Fatalf("new owner: %s", newOwner.body)
	}
	for _, sql := range []string{`UPDATE companies SET status='suspended' WHERE id=$1`, `UPDATE companies SET status='active',deleted_at=clock_timestamp() WHERE id=$1`} {
		if _, err := h.pool.Exec(ctx, sql, other.companyID); err != nil {
			t.Fatal(err)
		}
		got := get(slug)
		draftFlowAssertError(t, got, 404, "site_not_found")
		draftFlowAssertNoStore(t, got)
		if string(got.body) != string(missing.body) {
			t.Fatal("inactive/deleted oracle")
		}
	}
}
