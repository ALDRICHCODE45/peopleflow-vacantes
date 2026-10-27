//go:build integration

package main

import (
	"context"
	"testing"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
)

func TestCompanySitePublicationFlow(t *testing.T) {
	h := newCompanySiteFlowHarness(t)
	company, user, sub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, company.companyID)
	owner := h.actor(t, user, sub)
	recruiterID, recruiterSub := company.addUser(t, "recruiter")
	recruiter := h.actor(t, recruiterID, recruiterSub)
	ctx := context.Background()
	const path = "/v2/me/company/site"
	first := h.do(t, "GET", path, "", owner.token, nil)
	doc := siteFlowDraft(t, first)
	post := func(action, token, tag string) draftFlowResponse {
		return h.do(t, "POST", path+"/"+action, "", token, map[string]string{"If-Match": tag})
	}
	unchanged := func(before draftFlowResponse) {
		t.Helper()
		after := h.do(t, "GET", path, "", owner.token, nil)
		if string(after.body) != string(before.body) {
			t.Fatalf("unexpected mutation: %s != %s", after.body, before.body)
		}
	}
	for _, action := range []string{"publish", "unpublish"} {
		draftFlowAssertError(t, post(action, recruiter.token, `"1"`), 403, "forbidden")
		unchanged(first)
	}
	draftFlowAssertError(t, post("publish", owner.token, ""), 428, "precondition_required")
	draftFlowAssertError(t, post("publish", owner.token, "1"), 400, "invalid_request")
	blocked := post("publish", owner.token, `"1"`)
	draftFlowAssertError(t, blocked, 422, "publish_blocked")
	unchanged(first)
	if len(draftFlowObject(t, blocked.body)["issues"].([]any)) < 4 {
		t.Fatal(string(blocked.body))
	}
	if _, err := h.pool.Exec(ctx, `UPDATE companies SET logo_url='https://example.test/logo.png' WHERE id=$1`, company.companyID); err != nil {
		t.Fatal(err)
	}
	slug := "publish-" + company.companyID.String()
	doc["slug"] = slug
	blocks := doc["blocks"].([]any)
	blocks[0].(map[string]any)["content"].(map[string]any)["title"] = "Join us"
	blocks = append(blocks,
		map[string]any{"id": uuid.NewString(), "type": "closing", "variant": "simple", "hidden": false, "content": map[string]any{"title": "Welcome"}},
		map[string]any{"id": uuid.NewString(), "type": "closing", "variant": "simple", "hidden": true, "content": map[string]any{}},
	)
	doc["blocks"] = blocks
	save := h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": `"1"`})
	siteFlowDraft(t, save)
	stale := post("publish", owner.token, `"1"`)
	draftFlowAssertError(t, stale, 412, "version_conflict")
	if stale.header.Get("ETag") != `"2"` || siteFlowBody(t, draftFlowObject(t, stale.body)["current"].(map[string]any)) != siteFlowBody(t, draftFlowObject(t, save.body)) {
		t.Fatal(string(stale.body))
	}
	unchanged(save)
	published := post("publish", owner.token, `"2"`)
	siteFlowDraft(t, published)
	env := draftFlowObject(t, published.body)
	if env["published"].(map[string]any)["version"] != float64(2) || env["has_unpublished_changes"] != false {
		t.Fatal(env)
	}
	var exact bool
	if err := h.pool.QueryRow(ctx, `SELECT published=draft AND published_version=draft_version AND published_slug=draft_slug FROM company_sites WHERE company_id=$1`, company.companyID).Scan(&exact); err != nil || !exact {
		t.Fatalf("snapshot not exact: %v %v", exact, err)
	}
	var snapshot string
	if err := h.pool.QueryRow(ctx, `SELECT published::text FROM company_sites WHERE company_id=$1`, company.companyID).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	doc["seo"].(map[string]any)["title"] = "New draft only"
	saved := h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": `"2"`})
	siteFlowDraft(t, saved)
	if draftFlowObject(t, saved.body)["has_unpublished_changes"] != true {
		t.Fatal(string(saved.body))
	}
	var afterSnapshot string
	if err := h.pool.QueryRow(ctx, `SELECT published::text FROM company_sites WHERE company_id=$1`, company.companyID).Scan(&afterSnapshot); err != nil || snapshot != afterSnapshot {
		t.Fatalf("published changed: %v", err)
	}
	newSlug := "republish-" + company.companyID.String()
	doc["slug"] = newSlug
	saved = h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": `"3"`})
	siteFlowDraft(t, saved)
	// History never blocks a new claim; publishing must remove stale history too.
	other, otherUser, otherSub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, other.companyID)
	otherActor := h.actor(t, otherUser, otherSub)
	siteFlowDraft(t, h.do(t, "GET", path, "", otherActor.token, nil))
	if _, err := h.pool.Exec(ctx, `INSERT INTO company_site_slug_history(slug,company_id) VALUES($1,$2)`, newSlug, other.companyID); err != nil {
		t.Fatal(err)
	}
	siteFlowDraft(t, post("publish", owner.token, `"4"`))
	var retiredOwner uuid.UUID
	if err := h.pool.QueryRow(ctx, `SELECT company_id FROM company_site_slug_history WHERE slug=$1`, slug).Scan(&retiredOwner); err != nil || retiredOwner != company.companyID {
		t.Fatalf("history: %v %v", retiredOwner, err)
	}
	var count int
	if err := h.pool.QueryRow(ctx, `SELECT count(*) FROM company_site_slug_history WHERE slug=$1`, newSlug).Scan(&count); err != nil || count != 0 {
		t.Fatalf("new slug history: %d %v", count, err)
	}
	unpublished := post("unpublish", owner.token, "malformed is ignored")
	siteFlowDraft(t, unpublished)
	if draftFlowObject(t, unpublished.body)["published"] != nil {
		t.Fatal(string(unpublished.body))
	}
	again := post("unpublish", owner.token, "")
	if again.status != 200 || string(again.body) != string(unpublished.body) {
		t.Fatalf("not idempotent: %s", again.body)
	}
	if err := h.pool.QueryRow(ctx, `SELECT count(*) FROM company_sites WHERE company_id=$1 AND published IS NULL AND published_version IS NULL AND published_slug IS NULL AND published_at IS NULL`, company.companyID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("unpublish columns: %d %v", count, err)
	}
	if err := h.pool.QueryRow(ctx, `SELECT count(*) FROM company_site_slug_history WHERE slug=$1 AND company_id=$2`, slug, company.companyID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("lost history: %d %v", count, err)
	}
	for _, e := range []struct{ kind, version string }{{audit.EventCompanySitePublished, "2"}, {audit.EventCompanySitePublished, "4"}, {audit.EventCompanySiteUnpublished, "4"}} {
		if err := h.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_type=$1 AND entity_id=$2 AND actor_type='user' AND actor_id=$3 AND event_type=$4 AND metadata=jsonb_build_object('version',$5::text)`, audit.EntityCompanySite, company.companyID, user, e.kind, e.version).Scan(&count); err != nil || count != 1 {
			t.Fatalf("audit %s/%s: %d %v", e.kind, e.version, count, err)
		}
	}
	if err := h.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_type=$1 AND entity_id=$2`, audit.EntityCompanySite, company.companyID).Scan(&count); err != nil || count != 3 {
		t.Fatalf("extra audit: %d %v", count, err)
	}
}
